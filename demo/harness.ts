// Demo harness —— 只在"边缘"放替身（脚本化 LLM + 模拟的链接/GitHub 状态），
// "大脑"全是 src/core 里的真实代码：Extractor / Router / InterventionPolicy /
// Evaluator / CommitmentJob / DigestAssembler，以及真实的品味 rubric。
//
// 为什么边缘要替身：github/manual verifier 目前还是桩（throw 未实现，见 CLAUDE.md
// "Where things stand"），且演示要零配置可跑（无 API key / 无 Postgres / 无频道）。
// 默认用脚本化 FakeLlm；若设 DEMO_LLM=real 且配好 LLM_* 环境，则换成真实 PiLlm。
import { PiLlm } from "../src/adapters/llm/pi";
import { InMemoryStore } from "../src/adapters/store/memory";
import { loadConfig } from "../src/app/config";
import type { Commitment, Evidence, Verdict, VerificationSpec } from "../src/core/domain/types";
import { GroupPolicy } from "../src/core/groupPolicy";
import { newId } from "../src/core/ids";
import { DigestAssembler, renderDigestText } from "../src/core/pipeline/digestAssembler";
import { Evaluator } from "../src/core/pipeline/evaluator";
import { Extractor } from "../src/core/pipeline/extractor";
import { InterventionPolicy } from "../src/core/pipeline/interventionPolicy";
import { Router } from "../src/core/pipeline/router";
import type {
  Clock,
  DecisionInput,
  DecisionOutput,
  ExtractionInput,
  ExtractionOutput,
  InboundMessage,
  LlmPort,
  OutboundDirectMessage,
  OutboundMessage,
  Store,
  VerifierAdapter,
  VerifyInput,
  VerifyOutput,
} from "../src/core/ports";
import { CommitmentJob } from "../src/core/scheduler/commitmentJob";
import * as ui from "./ui";

export const GROUP = "g-core-dev";
const TZ = "Asia/Shanghai";

/** 北京时间（固定 +08:00，演示锁定 Asia/Shanghai）→ UTC Date；month 用 1-12，省得到处 -1。 */
export function beijing(y: number, m: number, d: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hour - 8, minute, 0));
}

/** 可推进的时钟：场景之间手动拨表，让调度/护栏的时间逻辑真实生效。 */
export class DemoClock implements Clock {
  private t: number;
  constructor(start: Date) {
    this.t = start.getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  set(at: Date): void {
    this.t = at.getTime();
  }
}

/** 被模拟的"外部世界"：链接进展与 PR 合并状态——替身 verifier 读它。 */
export interface World {
  /** commitmentId → 链接证据判定。 */
  link: Map<string, Verdict>;
  /** 已合并 PR 的 commitmentId。 */
  merged: Set<string>;
}

// ——————————————————————————————————————————————————————————
// 脚本化 LLM：站位真实 pi LLM 的三个窄决策，确定性、可离线跑。
// 不是"假装聪明"——只覆盖演示用到的输入，行为可解释。
// ——————————————————————————————————————————————————————————
const COMMIT_MARK =
  /我来|我接|接了|负责|发出来|提交|交付|周[一二三四五六日]前?|今晚.*[发给交出]|明天.*[发给交出]|PR/i;
const WEEKDAY: Record<string, number> = { 日: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

function localDateParts(now: Date): { y: number; m: number; d: number; wd: number } {
  const s = new Date(now.getTime() + 8 * 3_600_000);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate(), wd: s.getUTCDay() };
}

/**
 * 把"周五前 / 今晚 / 明天 / 下周"按北京时区（固定 +08:00）解析成绝对 ISO；解析不出给 null。
 * 周X 取本周或之后最近的同名日（含今天）——与「…前」的截止语义一致。
 */
function resolveDue(text: string, now: Date): string | null {
  const { y, m, d, wd } = localDateParts(now);
  const at = (addDays: number, hour: number): string =>
    new Date(Date.UTC(y, m, d + addDays, hour - 8, 0, 0)).toISOString();
  const wk = text.match(/周([一二三四五六日])/);
  const ch = wk?.[1];
  if (ch !== undefined && WEEKDAY[ch] !== undefined) {
    return at((WEEKDAY[ch] - wd + 7) % 7, 18);
  }
  if (/今晚/.test(text)) return at(0, 21);
  if (/明天|明日/.test(text)) return at(1, 18);
  if (/下周/.test(text)) return at(7, 18);
  return null;
}

/** 从触发消息里抠出一个干净的标题（砍 URL / 应答前缀 / 时间尾巴 / 交付套话）。 */
function titleOf(text: string): string {
  let t = text.replace(/https?:\/\/\S+/g, "").trim();
  t = t.replace(/^(行|好的?|嗯|可以|没问题|ok)[，,。.!！]?\s*/i, "");
  t = t.replace(/^我(来|接了?|负责)?[，,。.]?\s*/, "");
  const head = t.split(/周[一二三四五六日]前?|今晚|明天|明日|下周|本周|之前/)[0];
  if (head !== undefined && head.trim().length > 0) t = head;
  t = t.replace(/(发出来|发你|提交|交付|给你|搞定|完成)[。.，,！!：:]*$/g, "");
  t = t.replace(/[：:，,。.！!\s]+$/g, "").trim();
  if (t.length === 0) return text.slice(0, 20);
  return t.length > 24 ? `${t.slice(0, 24)}…` : t;
}

class FakeLlm implements LlmPort {
  async extractCommitment(input: ExtractionInput): Promise<ExtractionOutput> {
    const last = input.recentMessages.at(-1);
    if (last === undefined) return { isCommitment: false, confidence: 0 };
    const text = last.text;
    // 认领要有"我来/我接/负责/PR/周五前…"这类标记；问句（求助/提议）不算自我承诺。
    const isCommit = COMMIT_MARK.test(text) && !/[?？]\s*$/.test(text);
    if (!isCommit) return { isCommitment: false, confidence: 0.3 };
    return {
      isCommitment: true,
      confidence: 0.82,
      title: titleOf(text),
      dueAt: resolveDue(text, input.now),
    };
  }

  async verifyLink(_input: VerifyInput): Promise<VerifyOutput> {
    // 演示用替身 verifier 直接给判定，不走真实链接抓取，这里不会被调用。
    return { verdict: "no_change", summary: "（demo 未真实抓取链接）", confidence: 0.5 };
  }

  async decideIntervention(input: DecisionInput): Promise<DecisionOutput> {
    const c = input.commitment;
    const verdict = input.evidenceHistory.at(-1)?.verdict ?? null;
    if (verdict === "regressed") {
      return {
        decision: "remind",
        message: `${c.title} 的改动刚被回退了，要我把上一版对比贴出来吗？`,
        nextCheckHint: "soon",
        reason: "证据回退，远离 due 也不沉默",
      };
    }
    if (c.status === "at_risk") {
      return {
        decision: "suggest_renegotiate",
        message: `${c.title} 这条卡了两天，要不要挪到下周再交？`,
        nextCheckHint: "later",
        reason: "at_risk，给体面出口",
      };
    }
    return {
      decision: "remind",
      message: `${c.title} 离今天的 due 不远了，需要我把相关链接翻出来吗？`,
      nextCheckHint: "soon",
      reason: "临期无进展、今日未提醒",
    };
  }
}

function makeLlm(): LlmPort {
  if (process.env.DEMO_LLM !== "real") return new FakeLlm();
  // 真模型模式：先确认有 key，否则快速失败给一句可操作的话（别跑到一半甩个晦涩报错）。
  // 注意：不自动读 .env——key 要 export 到 shell（见 demo/README.md）。
  const cfg = loadConfig().llm;
  const hasKey =
    cfg.provider === "openai-compatible"
      ? cfg.baseUrl.length > 0 && cfg.apiKey.length > 0
      : cfg.apiKey.length > 0;
  if (!hasKey) {
    console.error(
      "DEMO_LLM=real 需要 LLM key：先 export ANTHROPIC_API_KEY（或对应 provider 的 LLM_API_KEY / LLM_BASE_URL）再重跑。",
    );
    process.exit(1);
  }
  return new PiLlm(cfg);
}

// —— 替身 verifier：站位还没实现的 github / 兜底 link 抓取，从 World 读"外部状态"。——
function summaryFor(v: Verdict): string {
  switch (v) {
    case "completed":
      return "看起来已完成";
    case "progressed":
      return "有新进展";
    case "no_change":
      return "无变化";
    case "regressed":
      return "改动被回退";
    case "inconclusive":
      return "无法判定";
  }
}

class FakeLinkVerifier implements VerifierAdapter {
  readonly kind = "link" as const;
  constructor(
    private readonly world: World,
    private readonly clock: Clock,
  ) {}
  async fetchState(commitment: Commitment, _previous: Evidence | null): Promise<Evidence> {
    const verdict = this.world.link.get(commitment.id) ?? "no_change";
    return {
      id: newId(),
      commitmentId: commitment.id,
      capturedAt: this.clock.now(),
      source: "link",
      verdict,
      summary: summaryFor(verdict),
      raw: null,
    };
  }
}

class FakeGithubVerifier implements VerifierAdapter {
  readonly kind = "github" as const;
  constructor(
    private readonly world: World,
    private readonly clock: Clock,
  ) {}
  async fetchState(commitment: Commitment, _previous: Evidence | null): Promise<Evidence> {
    const merged = this.world.merged.has(commitment.id);
    const verdict: Verdict = merged ? "completed" : "no_change";
    return {
      id: newId(),
      commitmentId: commitment.id,
      capturedAt: this.clock.now(),
      source: "github",
      verdict,
      summary: merged ? "PR 已合并" : "PR 未合并",
      raw: null,
    };
  }
}

/** 把入站消息包装成平台无关的 InboundMessage（演示频道 = feishu 群）。 */
export function inbound(authorRef: string, text: string, at: Date): InboundMessage {
  return {
    channel: "feishu",
    groupRef: GROUP,
    chatType: "group",
    authorRef,
    text,
    replyToRef: null,
    messageRef: `m-${newId()}`,
    at,
    raw: null,
  };
}

export interface Brain {
  store: Store;
  clock: DemoClock;
  world: World;
  router: Router;
  evaluator: Evaluator;
  commitmentJob: CommitmentJob;
  digest: DigestAssembler;
  outbox: OutboundMessage[];
  /** 私聊把某人的今日 todo 推给他；没事可报返回 false（不打扰）。 */
  pushPersonDigest: (personId: string) => Promise<boolean>;
}

/**
 * 一个大脑、两张脸：群内发言 / 私聊默认打到终端（demo/run.ts 用）；
 * web server 传入 sink，把同样的输出收成数据去渲染网页。core 逻辑两边完全一致。
 */
export interface BrainSinks {
  onGroupSend?: (out: OutboundMessage) => void;
  onDirectSend?: (out: OutboundDirectMessage, recipientName: string) => void;
}

/** 接好真实的"大脑"；不传 sink 时群内发言/私聊打到终端。 */
export function buildBrain(start: Date, sinks: BrainSinks = {}): Brain {
  const clock = new DemoClock(start);
  const store = new InMemoryStore();
  const world: World = { link: new Map(), merged: new Set() };
  const groupPolicy = new GroupPolicy({ readWrite: [GROUP], readOnly: [] });
  const llm = makeLlm();

  const outbox: OutboundMessage[] = [];
  const send = async (out: OutboundMessage): Promise<{ dispatchRef: string }> => {
    if (sinks.onGroupSend !== undefined) sinks.onGroupSend(out);
    else ui.butler(out.text);
    outbox.push(out);
    return { dispatchRef: `demo-${newId()}` };
  };
  const sendDirect = async (out: OutboundDirectMessage): Promise<{ dispatchRef: string }> => {
    const people = await store.people.all();
    const who = people.find((p) =>
      p.handles.some((h) => h.channel === out.channel && h.userRef === out.userRef),
    );
    const name = who?.displayName ?? out.userRef;
    if (sinks.onDirectSend !== undefined) sinks.onDirectSend(out, name);
    else ui.dm(name, out.text);
    return { dispatchRef: `demo-dm-${newId()}` };
  };

  const extractor = new Extractor(llm, clock, {
    timezone: TZ,
    knownRepos: [],
    minConfidence: 0.6,
    newId,
  });
  const router = new Router({ store, extractor, groupPolicy, clock, timezone: TZ, send, newId });
  const policy = new InterventionPolicy(llm);
  const verifiers = new Map<VerificationSpec["kind"], VerifierAdapter>([
    ["link", new FakeLinkVerifier(world, clock)],
    ["github", new FakeGithubVerifier(world, clock)],
  ]);
  const evaluator = new Evaluator({
    store,
    verifiers,
    policy,
    clock,
    config: { timezone: TZ, quietHours: [23, 8], maxRemindersPerDay: 1 },
    send,
    newId,
  });
  const commitmentJob = new CommitmentJob({
    store,
    evaluator,
    onError: (e, ctx) => ui.note(`  [scheduler ${ctx}] ${String(e)}`),
  });
  const digest = new DigestAssembler({ store, timezone: TZ });

  const pushPersonDigest = async (personId: string): Promise<boolean> => {
    const person = await store.people.get(personId);
    const handle = person?.handles.find((h) => h.channel === "feishu");
    if (handle === undefined) return false;
    const d = await digest.forPerson(personId, clock.now());
    if (d.sections.length === 0) return false;
    await sendDirect({
      channel: handle.channel,
      userRef: handle.userRef,
      text: renderDigestText(d),
      digest: d,
    });
    return true;
  };

  return {
    store,
    clock,
    world,
    router,
    evaluator,
    commitmentJob,
    digest,
    outbox,
    pushPersonDigest,
  };
}
