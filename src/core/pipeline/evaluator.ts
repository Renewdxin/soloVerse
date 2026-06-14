import { canTransition } from "../domain/status";
import type {
  Commitment,
  CommitmentStatus,
  Evidence,
  Interaction,
  Intervention,
  InterventionDecision,
  VerificationSpec,
} from "../domain/types";
import type { Clock, OutboundMessage, Store, VerifierAdapter } from "../ports";
import { computeNextCheckAt, GRACE_MS } from "../scheduler/nextCheck";
import { type InterventionPolicy, inQuietHours } from "./interventionPolicy";

const HOUR = 3_600_000;
const RECENT_REMIND_WINDOW_MS = 6 * HOUR;
const REMINDER_DECISIONS = new Set<InterventionDecision>([
  "remind",
  "mark_at_risk",
  "suggest_renegotiate",
]);

export interface EvaluatorDeps {
  store: Store;
  verifiers: Map<VerificationSpec["kind"], VerifierAdapter>;
  policy: InterventionPolicy;
  clock: Clock;
  config: {
    timezone: string;
    quietHours: [number, number];
    maxRemindersPerDay: number;
  };
  send: (out: OutboundMessage) => Promise<{ dispatchRef: string }>;
  newId: () => string;
}

/**
 * 到期承诺评估器：先取证，再交给 InterventionPolicy 做“该不该出声”。
 * 这里不把 verifier/send 失败伪装成无进展；失败交给 Scheduler 隔离并记录。
 */
export class Evaluator {
  constructor(private readonly deps: EvaluatorDeps) {}

  async evaluate(c: Commitment): Promise<void> {
    const now = this.deps.clock.now();
    if (this.shouldMarkFailed(c, now)) {
      await this.markFailed(c, now);
      return;
    }

    const existingEvidence = await this.evidenceFor(c.id);
    const freshEvidence = await this.fetchEvidenceIfNeeded(c, existingEvidence.at(-1) ?? null);
    const evidenceHistory =
      freshEvidence === null ? existingEvidence : [...existingEvidence, freshEvidence];
    const interactions = await this.interactionsFor(c);
    const interventions = await this.interventionsFor(c.id);
    const remindersToday = interventions.filter(
      (i) =>
        REMINDER_DECISIONS.has(i.decision) && sameLocalDay(i.at, now, this.deps.config.timezone),
    ).length;

    const decision = await this.deps.policy.decide(
      {
        commitment: c,
        evidenceHistory,
        interactionHistory: interactions.slice(-5).map((i) => ({
          direction: i.direction,
          text: i.text,
          at: i.at,
        })),
        now,
        timezone: this.deps.config.timezone,
        policy: {
          quietHours: this.deps.config.quietHours,
          maxRemindersPerDay: this.deps.config.maxRemindersPerDay,
          lastRemindAt: latestReminder(interventions)?.at ?? null,
          hasUnansweredRecentRemind: await this.hasUnansweredRecentRemind(
            c,
            interventions,
            interactions,
            now,
          ),
        },
      },
      { localHour: localHour(now, this.deps.config.timezone), remindersToday },
    );

    const requestedStatus =
      decision.newStatus ?? (decision.decision === "mark_at_risk" ? "at_risk" : undefined);
    const updated = this.applyDecision(c, requestedStatus, decision.nextCheckHint, now);
    await this.deps.store.commitments.put(updated);
    await this.recordDecision(updated, decision, now);
  }

  private shouldMarkFailed(c: Commitment, now: Date): boolean {
    if (c.dueAt === null) return false;
    if (c.status !== "active" && c.status !== "at_risk") return false;
    return now.getTime() - c.dueAt.getTime() > GRACE_MS;
  }

  private async markFailed(c: Commitment, now: Date): Promise<void> {
    const status: CommitmentStatus = canTransition(c.status, "failed") ? "failed" : c.status;
    const updated: Commitment = { ...c, status, nextCheckAt: null };
    await this.deps.store.commitments.put(updated);

    // 转 failed 是状态变更，必须发生；但「要不要改期」这句话仍走同样的护栏：
    // 安静期 / 当天该条已提醒过 → 静默转档，不重复出声（铁律1：每条一天最多一次）。
    const interventions = await this.interventionsFor(c.id);
    const remindersToday = interventions.filter(
      (i) =>
        REMINDER_DECISIONS.has(i.decision) && sameLocalDay(i.at, now, this.deps.config.timezone),
    ).length;
    const muted =
      inQuietHours(localHour(now, this.deps.config.timezone), this.deps.config.quietHours) ||
      remindersToday >= this.deps.config.maxRemindersPerDay;
    await this.recordDecision(
      updated,
      {
        decision: "suggest_renegotiate",
        newStatus: status,
        reason: "逾期超过宽限窗",
        // 被护栏静默时不带 message → 只转档不发声。
        ...(muted
          ? {}
          : { message: `${c.title} 已过截止时间。要不要改个新时间，或者先标成放弃？` }),
      },
      now,
    );
  }

  private async fetchEvidenceIfNeeded(
    c: Commitment,
    previous: Evidence | null,
  ): Promise<Evidence | null> {
    if (c.verification.kind === "none" || c.verification.kind === "manual") return null;
    const verifier = this.deps.verifiers.get(c.verification.kind);
    if (verifier === undefined) throw new Error(`未配置 verifier ${c.verification.kind}`);
    const evidence = await verifier.fetchState(c, previous);
    await this.deps.store.evidence.put(evidence);
    return evidence;
  }

  private applyDecision(
    c: Commitment,
    requestedStatus: CommitmentStatus | undefined,
    hint: "soon" | "normal" | "later" | undefined,
    now: Date,
  ): Commitment {
    const status = this.safeStatus(c.status, requestedStatus);
    return {
      ...c,
      status,
      nextCheckAt: adjustNextCheck(now, computeNextCheckAt(now, c.dueAt, status), hint),
    };
  }

  private safeStatus(from: CommitmentStatus, to: CommitmentStatus | undefined): CommitmentStatus {
    if (to === undefined || to === from) return from;
    if (canTransition(from, to)) return to;
    throw new Error(`非法状态转移：${from} → ${to}`);
  }

  private async recordDecision(
    c: Commitment,
    decision: {
      decision: InterventionDecision;
      reason: string;
      message?: string;
      newStatus?: CommitmentStatus;
    },
    now: Date,
  ): Promise<void> {
    const text =
      decision.message !== undefined && decision.message.trim().length > 0
        ? decision.message
        : null;
    const channel: Intervention["channel"] = text !== null ? c.source.channel : null;
    const interventionId = this.deps.newId();
    const record = {
      id: interventionId,
      commitmentId: c.id,
      at: now,
      decision: decision.decision,
      reason: decision.reason,
      message: decision.message ?? null,
      channel,
    };

    // 先落 intervention（即计入「今日已提醒」）再发送：万一 send 失败，这条已记账，
    // 下个 tick 不会重发——宁可少发不可重发（铁律1：每条一天最多一次）。
    await this.deps.store.interventions.put({ ...record, dispatchRef: null });
    if (text === null || channel === null) return;

    const sent = await this.deps.send({
      channel,
      groupRef: c.groupRef,
      text,
      mentions: await this.mentionRefs(c),
    });
    await this.deps.store.interactions.put({
      id: this.deps.newId(),
      groupRef: c.groupRef,
      channel,
      direction: "out",
      authorRef: "bot",
      text,
      at: now,
      commitmentId: c.id,
    });
    // 回填 dispatchRef（put 按 id upsert；仅审计用，不影响去重正确性）。
    await this.deps.store.interventions.put({ ...record, dispatchRef: sent.dispatchRef });
  }

  private async mentionRefs(c: Commitment): Promise<string[]> {
    const person = await this.deps.store.people.get(c.assignee);
    const userRef = person?.handles.find((h) => h.channel === c.source.channel)?.userRef;
    return userRef === undefined ? [] : [userRef];
  }

  private async evidenceFor(commitmentId: string): Promise<Evidence[]> {
    return (await this.deps.store.evidence.all())
      .filter((e) => e.commitmentId === commitmentId)
      .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  }

  private async interventionsFor(commitmentId: string): Promise<Intervention[]> {
    return (await this.deps.store.interventions.all())
      .filter((i) => i.commitmentId === commitmentId)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  private async interactionsFor(c: Commitment): Promise<Interaction[]> {
    return (await this.deps.store.interactions.all())
      .filter(
        (i) => i.groupRef === c.groupRef && (i.commitmentId === c.id || i.commitmentId === null),
      )
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  private async hasUnansweredRecentRemind(
    c: Commitment,
    interventions: Intervention[],
    interactions: Interaction[],
    now: Date,
  ): Promise<boolean> {
    const latest = latestReminder(interventions);
    if (latest === null) return false;
    if (now.getTime() - latest.at.getTime() > RECENT_REMIND_WINDOW_MS) return false;

    const person = await this.deps.store.people.get(c.assignee);
    const assigneeRefs = new Set([c.assignee, ...(person?.handles.map((h) => h.userRef) ?? [])]);
    return !interactions.some(
      (i) => i.direction === "in" && i.at > latest.at && assigneeRefs.has(i.authorRef),
    );
  }
}

function latestReminder(interventions: Intervention[]): Intervention | null {
  return interventions.filter((i) => REMINDER_DECISIONS.has(i.decision)).at(-1) ?? null;
}

function adjustNextCheck(
  now: Date,
  next: Date | null,
  hint: "soon" | "normal" | "later" | undefined,
): Date | null {
  if (next === null || hint === undefined || hint === "normal") return next;
  const delta = Math.max(next.getTime() - now.getTime(), 0);
  if (hint === "soon") return new Date(now.getTime() + Math.max(15 * 60_000, delta / 2));
  return new Date(now.getTime() + delta * 2);
}

function localHour(date: Date, timezone: string): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  })
    .formatToParts(date)
    .find((p) => p.type === "hour")?.value;
  const hour = Number(part ?? "0");
  return hour === 24 ? 0 : hour;
}

function sameLocalDay(a: Date, b: Date, timezone: string): boolean {
  return localYmd(a, timezone) === localYmd(b, timezone);
}

function localYmd(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  const day = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}
