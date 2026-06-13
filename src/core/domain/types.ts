// Commitment Agent · 核心领域类型（M0 契约）
// 见 docs/architecture.md §3。纯类型，无运行时。

export type Id = string;
export type CommitmentId = Id;
export type PersonId = Id;
export type EvidenceId = Id;
export type InterventionId = Id;

/** MVP 两个频道；架构无关，后续可扩。pi 不提供频道，均为自建 adapter。 */
export type ChannelKind = "feishu" | "discord";

export type VerifierKind = "link" | "github" | "manual";

// —— 人（轻量身份，无账号）——
export interface Person {
  id: PersonId;
  displayName: string;
  /** 每个频道一个 handle，用于 @mention 与消息归因 */
  handles: { channel: ChannelKind; userRef: string }[];
  /** true = operator（自部署、配置 bot 的那个人） */
  isOperator: boolean;
  /** digest 偏好：本地发送时间 HH:MM（缺省用 config DIGEST_TIME）+ 时区（缺省用全局 TZ） */
  digestPref?: { localTime: string; timezone?: string };
  /** 上次发（或检查）digest 的时间；落库、重启安全，保证一天最多一次 */
  lastDigestAt?: Date | null;
}

/**
 * bot 在某个群的发言权（运行时真相落 DB groups.mode；GroupPolicy 是它的同步内存投影）。
 * - off：不读不存（未授权 / operator 忽略的群）。
 * - read：监听 + 落库上下文，但绝不在群里发言。
 * - readwrite：完整管家——群里可确认 / 催办 / 发台账。
 */
export type GroupMode = "off" | "read" | "readwrite";

// —— 群：bot 从消息流里发现并记住（省得去飞书后台抄 chat_id）——
export interface Group {
  id: string; // chatRef（飞书 chat_id）
  channel: ChannelKind;
  name: string | null;
  firstSeenAt: Date;
  /** 加群默认 read（只读上岗）；operator 私聊提权到 readwrite（见 core/operatorConsole）。 */
  mode: GroupMode;
  /** 上次就这个群私聊问过 operator 的时间；null=还没问过。避免重启反复打扰。 */
  promptedAt: Date | null;
}

// —— 承诺状态机（见 architecture §6）——
export type CommitmentStatus =
  | "proposed" // 已抽取，待群内确认
  | "active" // 已确认，监督中
  | "at_risk" // 临近 due 且无进展
  | "fulfilled" // 有证据证明完成
  | "failed" // 过期未完成
  | "abandoned" // 主动放弃
  | "snoozed"; // 暂缓

// —— 查证规格：link 优先（architecture §3.2）——
export type VerificationSpec =
  | { kind: "link"; urls: string[]; expectation: string }
  | {
      kind: "github";
      repo: string;
      ref?: { pr?: number; issue?: number };
      pathGlob?: string;
      mustBeMerged?: boolean;
    }
  | { kind: "manual" }
  | { kind: "none" };

export interface Commitment {
  id: CommitmentId;
  /** 哪个群（公司有多群；MVP 单群，字段先留） */
  groupRef: string;
  /** 责任人：可以是 operator 本人，也可以是群里协作方 */
  assignee: PersonId;
  title: string;
  rawText: string;
  source: { channel: ChannelKind; messageRef: string; at: Date };
  status: CommitmentStatus;
  dueAt: Date | null;
  verification: VerificationSpec;
  confidence: number;
  tags: string[];
  createdAt: Date;
  confirmedAt: Date | null;
  /** 调度锚点，落库、重启安全 */
  nextCheckAt: Date | null;
}

export type Verdict = "completed" | "progressed" | "no_change" | "regressed" | "inconclusive";

// —— 证据：append-only 快照 ——
export interface Evidence {
  id: EvidenceId;
  commitmentId: CommitmentId;
  capturedAt: Date;
  source: VerifierKind;
  verdict: Verdict;
  summary: string;
  raw: unknown;
}

/**
 * 干预决策。隐形为主（flows §6）：没有 escalate / 公开点名。
 * 临期最多一次 remind；其余靠每日 todo / 每周进度的被动面板。
 */
export type InterventionDecision =
  | "silent"
  | "remind"
  | "celebrate"
  | "mark_at_risk"
  | "mark_failed"
  | "suggest_renegotiate";

export interface Intervention {
  id: InterventionId;
  commitmentId: CommitmentId;
  at: Date;
  decision: InterventionDecision;
  reason: string;
  message: string | null;
  channel: ChannelKind | null;
  dispatchRef: string | null;
}

// —— 入站/出站消息流水（审计 + 决策上下文）——
export interface Interaction {
  id: Id;
  groupRef: string;
  channel: ChannelKind;
  direction: "in" | "out";
  /** 谁说的（归因到 Person.handles 里的 userRef） */
  authorRef: string;
  text: string;
  at: Date;
  commitmentId: CommitmentId | null;
}

// —— Digest：个人 / 群的台账投影（平台无关；adapter 渲染成飞书卡片或文本）——
// 见 docs/plans/2026-06-01-entity-model-dm-digest-design.md。
export type DigestItemStatus = "overdue" | "due_today" | "stuck";
export interface DigestItem {
  text: string;
  status: DigestItemStatus;
  /** 证据 / PR 链接，渲染成可点 */
  link?: string;
}
export interface DigestSection {
  heading: string;
  items: DigestItem[];
}
export interface Digest {
  title: string;
  audience: { kind: "person" | "group"; ref: string };
  /** 只放非空 section；sections 为空 = 没什么可报的（别推空 digest 烦人） */
  sections: DigestSection[];
}

// —— 自进化反馈（architecture §13.4）——
export interface Feedback {
  id: Id;
  at: Date;
  kind: "correction" | "reaction" | "outcome";
  commitmentId: CommitmentId | null;
  note: string;
  data: unknown;
}
