import type {
  Commitment,
  Digest,
  DigestItem,
  DigestItemStatus,
  DigestSection,
  Evidence,
  Verdict,
} from "../domain/types";
import type { Store } from "../ports";

// 证据回退/停滞的判定:除此之外不臆测"没动"。
const STALE_VERDICTS: Verdict[] = ["no_change", "regressed"];

/**
 * Digest 组装器：把承诺 + 证据投影成「某人 / 某群」的台账（plan M4）。纯确定性、平台无关。
 * 只两类——到期(clock's up)、卡住没动(at_risk / 证据回退)。on-track 和未来才到期的**不进每日**。
 * 信号只给真话：有证据给证据，该查没查给「没确认」，无需查证的不给——绝不编 on-track。
 * 见 docs/plans/2026-06-01-entity-model-dm-digest-design.md。
 */
export class DigestAssembler {
  constructor(private readonly deps: { store: Store; timezone: string }) {}

  async forPerson(personId: string, now: Date): Promise<Digest> {
    const open = (await this.deps.store.commitments.all()).filter(
      (c) => c.assignee === personId && (c.status === "active" || c.status === "at_risk"),
    );
    return {
      title: `今日 todo · ${localYmd(now, this.deps.timezone)}`,
      audience: { kind: "person", ref: personId },
      sections: this.sections(open, await this.deps.store.evidence.all(), now),
    };
  }

  async forGroup(groupRef: string, now: Date): Promise<Digest> {
    const open = (await this.deps.store.commitments.all()).filter(
      (c) => c.groupRef === groupRef && (c.status === "active" || c.status === "at_risk"),
    );
    return {
      title: `群进度 · ${localYmd(now, this.deps.timezone)}`,
      audience: { kind: "group", ref: groupRef },
      sections: this.sections(open, await this.deps.store.evidence.all(), now),
    };
  }

  private sections(commitments: Commitment[], evidence: Evidence[], now: Date): DigestSection[] {
    const today = localYmd(now, this.deps.timezone);
    const due: DigestItem[] = [];
    const stuck: DigestItem[] = [];
    for (const c of [...commitments].sort(byDue)) {
      const latest = latestEvidence(c.id, evidence);
      if (c.dueAt !== null && localYmd(c.dueAt, this.deps.timezone) <= today) {
        const overdue = localYmd(c.dueAt, this.deps.timezone) < today;
        due.push(toItem(c, latest, overdue ? "overdue" : "due_today"));
      } else if (
        c.status === "at_risk" ||
        (latest !== null && STALE_VERDICTS.includes(latest.verdict))
      ) {
        stuck.push(toItem(c, latest, "stuck"));
      }
      // 其余(on-track / 未来才到期)不进每日。
    }
    const sections: DigestSection[] = [];
    if (due.length > 0) sections.push({ heading: "到期", items: due });
    if (stuck.length > 0) sections.push({ heading: "卡住没动", items: stuck });
    return sections;
  }
}

/** 纯文本渲染:卡片不支持 / 渲染失败时的 fallback。 */
export function renderDigestText(d: Digest): string {
  const lines = [d.title];
  for (const section of d.sections) {
    lines.push("", section.heading);
    for (const item of section.items) {
      lines.push(`· ${item.text}${item.link !== undefined ? ` ${item.link}` : ""}`);
    }
  }
  return lines.join("\n");
}

function toItem(c: Commitment, latest: Evidence | null, status: DigestItemStatus): DigestItem {
  const link = c.verification.kind === "link" ? c.verification.urls[0] : undefined;
  const signal = digestSignal(c, latest);
  return {
    text: signal === undefined ? c.title : `${c.title} · ${signal}`,
    status,
    ...(link !== undefined ? { link } : {}),
  };
}

/** 有证据给真话；该查(link/github)却没查到给「没确认」；无需查证的(none/manual)不给。 */
function digestSignal(c: Commitment, latest: Evidence | null): string | undefined {
  if (latest !== null) return latest.summary;
  if (c.verification.kind === "link" || c.verification.kind === "github") return "没确认";
  return undefined;
}

function latestEvidence(commitmentId: string, evidence: Evidence[]): Evidence | null {
  return (
    evidence
      .filter((e) => e.commitmentId === commitmentId)
      .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())
      .at(-1) ?? null
  );
}

function byDue(a: Commitment, b: Commitment): number {
  if (a.dueAt === null) return b.dueAt === null ? 0 : 1;
  if (b.dueAt === null) return -1;
  return a.dueAt.getTime() - b.dueAt.getTime();
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
