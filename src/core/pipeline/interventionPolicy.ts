import type { CommitmentStatus, Verdict } from "../domain/types";
import type { DecisionInput, DecisionOutput, LlmPort } from "../ports";

const HOUR = 3_600_000;

export interface ScreenInput {
  now: Date;
  dueAt: Date | null;
  status: CommitmentStatus;
  latestVerdict: Verdict | null;
  /** 当前在用户时区的小时 0-23 */
  localHour: number;
  quietHours: [number, number];
  maxRemindersPerDay: number;
  remindersToday: number;
  /** 弱来源的 completed 不自动结案，避免“看起来完成”变成误完成。 */
  canAutoComplete: boolean;
  /** 最近已提醒且对方未回时直接沉默，避免连环追问。 */
  hasUnansweredRecentRemind: boolean;
}

export type ScreenOutcome =
  | { action: "silent"; reason: string }
  | { action: "celebrate" }
  | { action: "consult_llm" };

export function inQuietHours(hour: number, [start, end]: [number, number]): boolean {
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * 隐形护栏（architecture §8.1 步骤 3 / §15.4）：在调 LLM 之前，确定性地决定要不要出声。
 * 体现管家分寸：on-track 不出声、安静期不打扰、一天最多一次、装死不点名。
 */
export function screenIntervention(i: ScreenInput): ScreenOutcome {
  if (i.status !== "active" && i.status !== "at_risk") {
    return { action: "silent", reason: "非监督态" };
  }
  if (inQuietHours(i.localHour, i.quietHours)) {
    return { action: "silent", reason: "安静期" };
  }
  if (i.latestVerdict === "completed" && i.canAutoComplete) {
    return { action: "celebrate" };
  }

  const left = i.dueAt === null ? Number.POSITIVE_INFINITY : i.dueAt.getTime() - i.now.getTime();
  const nearDue = left < 6 * HOUR;
  const onTrack = i.status === "active" && !nearDue && i.latestVerdict !== "regressed";
  if (onTrack) {
    return { action: "silent", reason: "on-track / 远离 due" };
  }

  if (i.remindersToday >= i.maxRemindersPerDay) {
    return { action: "silent", reason: "今日提醒已达上限（装死不点名、不连环）" };
  }
  if (i.hasUnansweredRecentRemind) {
    return { action: "silent", reason: "已提醒且对方未回，不连环追问" };
  }

  return { action: "consult_llm" };
}

/**
 * 干预策略：护栏先行，仅在确实需要措辞时才调 LLM（窄 LLM）。
 * celebrate 用模板，无需 LLM；silent 直接收声。
 */
export class InterventionPolicy {
  constructor(private readonly llm: LlmPort) {}

  async decide(
    input: DecisionInput,
    ctx: { localHour: number; remindersToday: number },
  ): Promise<DecisionOutput> {
    const latestEvidence = input.evidenceHistory.at(-1);
    const latestVerdict = latestEvidence?.verdict ?? null;
    const outcome = screenIntervention({
      now: input.now,
      dueAt: input.commitment.dueAt,
      status: input.commitment.status,
      latestVerdict,
      localHour: ctx.localHour,
      quietHours: input.policy.quietHours,
      maxRemindersPerDay: input.policy.maxRemindersPerDay,
      remindersToday: ctx.remindersToday,
      canAutoComplete: latestEvidence?.source === "github",
      hasUnansweredRecentRemind: input.policy.hasUnansweredRecentRemind ?? false,
    });

    switch (outcome.action) {
      case "silent":
        return { decision: "silent", reason: outcome.reason };
      case "celebrate":
        return {
          decision: "celebrate",
          newStatus: "fulfilled",
          message: `✅ ${input.commitment.title}，这条结了。`,
          reason: "证据显示完成",
        };
      case "consult_llm":
        return this.llm.decideIntervention(input);
    }
  }
}
