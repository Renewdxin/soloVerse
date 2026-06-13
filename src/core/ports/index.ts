// Commitment Agent · Ports（接口）—— 见 docs/architecture.md §4
// Core 只认这些接口；adapter 实现它们。pi 藏在 LlmPort / ToolRunner 后面，core 不直接依赖 pi。
import type {
  ChannelKind,
  Commitment,
  Digest,
  Evidence,
  Feedback,
  Group,
  Interaction,
  Intervention,
  Person,
  Verdict,
  VerificationSpec,
} from "../domain/types";

// —— 规范化消息（平台无关）——
export interface InboundMessage {
  channel: ChannelKind;
  groupRef: string;
  /** 群聊 / 私聊；缺省按群处理。私聊不当群记录。 */
  chatType?: "group" | "p2p";
  /** 谁说的（归因） */
  authorRef: string;
  text: string;
  replyToRef: string | null;
  messageRef: string;
  at: Date;
  raw: unknown;
}
export interface OutboundMessage {
  channel: ChannelKind;
  groupRef: string;
  text: string;
  /** @ 谁（userRef 列表） */
  mentions?: string[];
  replyToRef?: string | null;
}
/** 私聊（p2p）一个人——个人 digest / review 进展走这里，不进群。 */
export interface OutboundDirectMessage {
  channel: ChannelKind;
  /** 收件人在该平台的 id（飞书 open_id / Discord user id） */
  userRef: string;
  /** 纯文本形态，始终给——卡片不支持 / 渲染失败时的 fallback。 */
  text: string;
  /** 结构化 digest：adapter 可渲染成更丰富的形态（飞书互动卡片）。 */
  digest?: Digest;
}

// —— Channel：群（飞书 / Discord，均自建）——
export interface ChannelAdapter {
  readonly kind: ChannelKind;
  /** 是否支持私聊个人（飞书 true；Discord best-effort，本项目不追求 → false）。 */
  readonly canDirectMessage: boolean;
  start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void>;
  send(m: OutboundMessage): Promise<{ dispatchRef: string }>;
  sendDirect(m: OutboundDirectMessage): Promise<{ dispatchRef: string }>;
}

// —— Verifier：link / github / manual ——
export interface VerifierAdapter {
  readonly kind: VerificationSpec["kind"];
  fetchState(commitment: Commitment, previous: Evidence | null): Promise<Evidence>;
}

// —— LLM：三个决策节点（impl = pi-ai）——
export interface LlmPort {
  extractCommitment(input: ExtractionInput): Promise<ExtractionOutput>;
  verifyLink(input: VerifyInput): Promise<VerifyOutput>;
  decideIntervention(input: DecisionInput): Promise<DecisionOutput>;
}

// —— ToolRunner：受控的只读工具 agent（impl = pi-agent-core + 工具）——
// 用于开放式动作：搜资料 / 抓链接 / 专业 review。block-hook 保证只读、不改代码。
export interface ToolRunner {
  run(task: ToolTask): Promise<ToolRunResult>;
}
export interface ToolTask {
  kind: "review" | "search" | "fetch";
  prompt: string;
  /** 始终只读：ToolRunner 不写代码（见 architecture §16） */
  readOnly: true;
}
export interface ToolRunResult {
  text: string;
}

// —— Store / Clock ——
export interface Repo<T> {
  get(id: string): Promise<T | null>;
  put(item: T): Promise<void>;
  all(): Promise<T[]>;
  delete(id: string): Promise<void>;
}
export interface Store {
  commitments: Repo<Commitment>;
  evidence: Repo<Evidence>;
  interventions: Repo<Intervention>;
  interactions: Repo<Interaction>;
  people: Repo<Person>;
  groups: Repo<Group>;
  feedback: Repo<Feedback>;
  /** 到期需要评估的承诺（nextCheckAt <= now） */
  dueCommitments(now: Date): Promise<Commitment[]>;
}
export interface Clock {
  now(): Date;
}

// —— LLM 节点 I/O（见 architecture §5）——
export interface ExtractionInput {
  recentMessages: { authorRef: string; text: string; at: Date }[];
  now: Date;
  timezone: string;
  knownRepos: string[];
}
export interface ExtractionOutput {
  isCommitment: boolean;
  confidence: number;
  title?: string;
  dueAt?: string | null;
  verification?: VerificationSpec;
  clarifyingQuestion?: string;
}

export interface VerifyInput {
  commitment: { title: string; expectation: string };
  fetched: { url: string; status: number; content: string }[];
  previous: Evidence | null;
}
export interface VerifyOutput {
  verdict: Verdict;
  summary: string;
  confidence: number;
}

export interface DecisionInput {
  commitment: Commitment;
  evidenceHistory: Evidence[];
  interactionHistory: { direction: "in" | "out"; text: string; at: Date }[];
  now: Date;
  timezone: string;
  /** 隐形护栏：一天最多 maxRemindersPerDay 次提醒 */
  policy: {
    quietHours: [number, number];
    maxRemindersPerDay: number;
    lastRemindAt: Date | null;
    hasUnansweredRecentRemind?: boolean;
  };
}
export interface DecisionOutput {
  decision: Intervention["decision"];
  newStatus?: Commitment["status"];
  message?: string;
  nextCheckHint?: "soon" | "normal" | "later";
  reason: string;
}
