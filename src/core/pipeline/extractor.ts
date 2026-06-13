import type { Commitment, PersonId, VerificationSpec } from "../domain/types";
import type { Clock, InboundMessage, LlmPort } from "../ports";

const URL_RE = /https?:\/\/[^\s)]+/g;

/** M1：消息里有 URL → link 证据；无 → none。M2 升级：识别 github.com → github spec（planner）。 */
function bindVerification(text: string, expectation: string): VerificationSpec {
  const urls = text.match(URL_RE) ?? [];
  return urls.length > 0 ? { kind: "link", urls, expectation } : { kind: "none" };
}

/**
 * LLM 给的 dueAt 应是绝对 ISO，但偶尔会回非 ISO（"明天"/"周五前"）→ new Date 得 Invalid Date。
 * 解析失败按「无截止」处理，不让它在下游 toISOString 时抛 RangeError、把承诺变成孤儿。
 */
function parseDueAt(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ExtractorOptions {
  timezone: string;
  knownRepos: string[];
  /** 低于此置信度不建档（宁可漏不可误） */
  minConfidence: number;
  newId: () => string;
}

/**
 * 自然语言 → 候选承诺（plan M1）。
 * 窗口最后一条为触发消息，其作者 = assignee（责任人）。
 * 抽取走 LlmPort（pi-ai）；verification 在此按 URL 确定性绑定。
 */
export class Extractor {
  constructor(
    private readonly llm: LlmPort,
    private readonly clock: Clock,
    private readonly opts: ExtractorOptions,
  ) {}

  async propose(recent: InboundMessage[], assignee: PersonId): Promise<Commitment | null> {
    const trigger = recent.at(-1);
    if (trigger === undefined) return null;

    const out = await this.llm.extractCommitment({
      recentMessages: recent.map((m) => ({ authorRef: m.authorRef, text: m.text, at: m.at })),
      now: this.clock.now(),
      timezone: this.opts.timezone,
      knownRepos: this.opts.knownRepos,
    });

    if (!out.isCommitment || out.confidence < this.opts.minConfidence || out.title === undefined) {
      return null;
    }

    const now = this.clock.now();
    return {
      id: this.opts.newId(),
      groupRef: trigger.groupRef,
      assignee,
      title: out.title,
      rawText: trigger.text,
      source: { channel: trigger.channel, messageRef: trigger.messageRef, at: trigger.at },
      status: "proposed",
      dueAt: parseDueAt(out.dueAt),
      verification: bindVerification(trigger.text, out.title),
      confidence: out.confidence,
      tags: [],
      createdAt: now,
      confirmedAt: null,
      nextCheckAt: null,
    };
  }
}
