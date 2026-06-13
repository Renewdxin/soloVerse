# Commitment Agent —— 工作群里的管家（butler）· 架构文档

> 一个跨平台的个人承诺监督 agent。它接入用户日常沟通平台，从自然语言中捕获个人项目承诺；接入用户实际工作的工具链，验证任务是否真的有进展；并根据 deadline、历史行为和外部证据，决定**沉默、提醒、追问或改期**（不升级施压——管家不是监工，§15.4）。
>
> 核心不是某个聊天机器人，而是：**承诺识别 → 证据查证 → 干预决策 → 跨平台触达**。
> 飞书 / Discord 是 MVP 的头两个 channel，GitHub 只是第一个 verifier，都不是产品边界。
>
> **它的灵魂是一个顶级管家，不是问责工具。** 忠心（只向着你）· 细致（记得一切、不漏 bug）· 深谙圈层（有判断、有品味）· 有分寸（低调、护主、不让你难堪）。它盯每个人的承诺、绑证据查进度、预判式备好材料、做有品味的 review——什么都懂一点（80% 够用，深问题转真专家），但越隐形越核心。详见 §15.4。

---

## 0. 关键设计决策

- **形态**：常驻工作群（飞书 / Discord）的**管家** bot；单 operator 自部署。
- **基调**：隐形为主、有分寸（§15.4）；承诺用**抽取 + 确认**捕获，宁可漏不可误。
- **架构**：六边形 Ports & Adapters；**窄决策 + 受控动作 + 宽确定性代码**（§1）；`Evidence` 是一等实体。
- **引擎**：pi（agent / 工具 / LLM / 记忆压缩）；我们只写差异化内核（承诺 / 隐形判断 / 调度 / 渠道 / 长期记忆）。
- **存储**：Postgres（Supabase / Neon）+ pgvector。

---

## 1. 设计原则

这七条是后面所有结构的来源，优先级从高到低：

1. **窄决策、受控动作、宽确定性代码** —— LLM 用法分两类：**① 决策**（是不是承诺 / link 算不算做完 / 此刻怎么开口）走**三个 schema 约束的单次调用**，不跑自由 loop——可测、可控、不会在群里乱说话；**② 开放式动作**（搜资料 / 抓链接 / **专业 review**，全程**只读**）走 **pi agent-core 的工具 loop（`beforeToolCall{block}` 确保只读、不越界）**。记忆、调度、限流、聚合仍全是确定性代码。**决策窄、动作受控**，是这个 bot 在工作群里能被信任的前提。
2. **Ports & Adapters（六边形）** —— Core 只依赖接口（`ChannelAdapter` / `VerifierAdapter` / `LlmPort` / `Store` / `Clock`），不依赖任何具体平台。**加一个 channel = 实现一个 `ChannelAdapter`；加一个 verifier = 实现一个 `VerifierAdapter`；Core 一行不改。** 这就是"可挂到任何入口和工具链"的产品命题落到代码上的样子。
3. **证据驱动（Evidence-based）** —— 系统永远不在没有 `Evidence` 快照的情况下宣称"完成"。每个承诺绑定一个 `VerificationSpec`，每次查证产出一条 append-only 的 `Evidence`。"证据"是产品的差异化，必须是一等公民。
4. **先确认，后建档** —— 抽取出来的承诺是**提案**不是事实，用户确认前不进入监督。
5. **给大脑套护栏** —— 主动触达由确定性规则限流：quiet hours、每日上限、去重、back-off。无论 LLM 多想说话，护栏先过一遍。不烦人是这个产品能被长期使用的前提。
6. **持久化时钟** —— `nextCheckAt` 落库，重启安全。自部署在笔记本/小 VPS 上可随时休眠重启而不丢调度。
7. **群 = 问责，私聊 = 个人 digest** —— 共享 / 问责性的事（确认、催办、群台账、查询）在群里公开发生，职场逻辑里**透明本身就是问责**；而**个人化的助理服务**（今日 todo、review 进展、贴身提醒）走**飞书私聊**——信息给全，又不污染群、不让人被围观。红线只有一条：**别把 A 群的原话原样搬到 B 群公开**。（取代旧的"全程不私聊"——见 [plans/2026-06-01-entity-model-dm-digest-design.md](./plans/2026-06-01-entity-model-dm-digest-design.md)。）

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                          ADAPTERS（平台相关）                          │
│   Channel In/Out        │    Verifiers       │    LLM    │   Store    │
│   飞书 · Discord…       │    GitHub · Linear…│   Claude  │  Postgres  │
└───────▲───────────┬─────┴─────────▲──────────┴─────▲─────┴─────▲──────┘
   Inbound │   Outbound │     fetchState │       complete │       │ r/w
           │            ▼                │                ▼       ▼
┌──────────┴──────────────────────────────────────────────────────────┐
│                        AGENT CORE（平台无关）                          │
│                                                                       │
│   Router ─► Extractor ─►[确认]─┐                                       │
│                                ▼                                       │
│                         Commitment Store                              │
│                                ▲                                       │
│   Scheduler ─► Evaluator ──────┘                                      │
│                   │                                                    │
│                   ├─► Verification   （取证据 → 算 verdict）            │
│                   └─► Intervention Policy （护栏 + LLM 决策）           │
│                                │                                       │
│                                ▼                                       │
│                      Rendering（persona + 渠道格式）                    │
│                                │                                       │
└────────────────────────────────┼──────────────────────────────────────┘
                                 ▼   Dispatcher ─► Channel Out
```

**两个驱动入口，汇聚到同一个 Store 和同一套触达：**

- **入站环（事件驱动）**：消息到达某个 channel → Router 分流 → 新陈述走 Extractor → 确认 → 建档。*反应式。*
- **Tick 环（时间驱动）**：Scheduler 到点 → 取出到期承诺 → Evaluator（查证 → 决策）→ 可能触达。*主动式。*

---

## 3. 领域模型（核心实体）

> 下面是设计级 TypeScript 草图，用来固定字段与语义，不是最终实现。

### 3.1 Commitment —— 系统的中心实体

```ts
type CommitmentStatus =
  | 'proposed'    // 已抽取，待用户确认
  | 'active'      // 已确认，监督中
  | 'at_risk'     // 临近 due 且无进展证据
  | 'fulfilled'   // 有证据证明完成
  | 'failed'      // 过期未完成（宽限后）
  | 'abandoned'   // 用户主动放弃
  | 'snoozed';    // 用户暂缓，带 wakeAt

interface Commitment {
  id: CommitmentId;
  userId: UserId;                 // 操作者（你）；单用户也保留，零成本留口子
  assignee: PersonRef;            // 责任人：你，或群里的协作方（§15）
  title: string;                  // 规范化承诺，如「写完架构文档」
  rawText: string;                // 触发抽取的原始消息（可回放）
  source: { channel: ChannelKind; messageRef: string; at: Date };
  status: CommitmentStatus;
  dueAt: Date | null;             // 绝对时间(UTC)；模糊承诺可为 null
  verification: VerificationSpec; // 如何查证（见 3.2）
  confidence: number;             // 抽取置信度 0–1
  tags: string[];
  createdAt: Date;
  confirmedAt: Date | null;
  nextCheckAt: Date | null;       // 调度锚点，落库，重启安全
}
```

> **Person**（轻量身份，无账号）：承诺的 assignee 指向它；群场景下用于 @mention 与消息归因（见 §15.2）。

```ts
interface Person {
  id: PersonId;
  displayName: string;
  handles: { channel: ChannelKind; userRef: string }[];  // 每 channel 一个 handle
  isOperator: boolean;            // true = 你本人；其余是被你盯的协作方
}
```

### 3.2 VerificationSpec —— 承诺绑定的证据来源

"证据驱动"的关键：承诺 = 一句话 **+ 一个可被查证的证据指针**。证据的**主形态是 link**——人在群里给出的任何链接（PR、文档、设计稿、工单、部署地址……），bot 去**抓取 + 判定**（§5.2）。GitHub 只是其中一种，且是第一个做了认证的结构化来源。

```ts
type VerificationSpec =
  // 默认：跟着人给的 link 查（fetch + LLM 判定，见 §5.2）
  | { kind: 'link'; urls: string[]; expectation: string }   // expectation = "什么样算做完" 的自然语言
  // 结构化来源：高价值/私有平台用其 API（GitHub 第一个；后续 Linear/Notion/…）
  | { kind: 'github'; repo: string; ref?: { pr?: number; issue?: number };
      pathGlob?: string; mustBeMerged?: boolean }
  | { kind: 'manual' }   // 自报进度（无可查链接时的兜底）
  | { kind: 'none' };    // 纯 deadline 提醒，不查证据
```

- **`link` 是默认**：零 per-platform 集成，人给啥链接就查啥。**公开链接**直接抓；**私有链接**（私有库 / Google Doc / Notion）要么走对应平台的认证 adapter，要么优雅降级成「我打不开，你确认一下」。
- **`github` 是第一个认证 adapter**：私有仓库、merged/CI 这类信号公开抓取看不到，必须用 token。
- **`manual` / `none` 兜底**：不是所有承诺都有可查链接（"给妈妈打电话"）。

**verifier 可信度分层**（决定能不能自动结案，服务"误完成率≈0"）：`github merged/CI`、结构化 API = **高可信，可自动 `fulfilled`**；`link` 抓取 + LLM = **弱信号，最多 `progressed`/`inconclusive`**；`manual` = 低但明确（自报）；`none` = 无证据，只提醒。详见 §5.2。

### 3.3 Evidence —— 某次查证时对外部状态的快照（append-only）

```ts
type Verdict = 'completed' | 'progressed' | 'no_change' | 'regressed' | 'inconclusive';

interface Evidence {
  id: EvidenceId;
  commitmentId: CommitmentId;
  capturedAt: Date;
  source: VerifierKind;           // 'link' | 'github' | 'manual' | …
  verdict: Verdict;               // verifier 对比上一份快照后给出
  summary: string;                // 人类可读，如「docs/ 下新增 2 个提交」
  raw: unknown;                   // 原始 API 切片，便于审计/回放
}
```

### 3.4 Intervention —— 一次决策 + 实际动作

```ts
type InterventionDecision =
  | 'silent' | 'remind' | 'celebrate'
  | 'mark_at_risk' | 'mark_failed' | 'suggest_renegotiate';
// 刻意没有 escalate / 公开点名——管家不是监工（§15.4）。
// 「升级」至多是让事项留在每日 todo / 周报的中性台账里，不额外施压。

interface Intervention {
  id: InterventionId;
  commitmentId: CommitmentId;
  at: Date;
  decision: InterventionDecision;
  reason: string;                 // LLM 给的理由，便于调试"它为什么这么说"
  message: string | null;         // 实际发出的话（silent 时为 null）
  channel: ChannelKind | null;
  dispatchRef: string | null;     // 平台侧消息 id
}
```

### 3.5 Interaction —— 入站/出站消息流水

每条进出消息都记一行（方向、文本、时间、关联承诺）。用途有二：审计；以及作为决策节点的上下文（"我今天已经追问过两次了"）。

---

## 4. Ports（接口）—— 让一切平台无关的那层抽象

Core 只认这些接口。Adapter 实现它们。这一节就是整个产品命题的技术兑现。

```ts
// —— 规范化的入站/出站消息（平台无关形态）——
interface InboundMessage {
  channel: ChannelKind; groupRef: string; authorRef: string; text: string;
  replyToRef: string | null;      // 用于把回复关联到某条提醒
  messageRef: string; at: Date; raw: unknown;
}
interface OutboundMessage {
  channel: ChannelKind; groupRef: string; text: string;
  mentions?: string[]; replyToRef?: string | null;
}

// —— Channel：沟通入口（飞书 / Discord / …）——
interface ChannelAdapter {
  kind: ChannelKind;
  start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void>; // 长轮询/监听
  send(m: OutboundMessage): Promise<{ dispatchRef: string }>;
}

// —— Verifier：link 抓取 + 平台适配（GitHub / Linear / …）——
interface VerifierAdapter {
  kind: VerifierKind;
  fetchState(spec: VerificationSpec, previous: Evidence | null): Promise<Evidence>;
}

// —— LLM：三个决策节点（实现 = pi-ai）——
interface LlmPort {
  extractCommitment(input: ExtractionInput): Promise<ExtractionOutput>;
  verifyLink(input: VerifyInput): Promise<VerifyOutput>;     // 读 link 内容 → verdict（见 §5.2）
  decideIntervention(input: DecisionInput): Promise<DecisionOutput>;
}

// —— ToolRunner：受控的工具型 agent（实现 = pi agent-core + 工具）——
// 开放式动作：搜资料 / 抓链接 / 专业 review（全程只读）。
// 用 agent-core 的 beforeToolCall{block} 确保只读、不越界（不改代码，见 §16）。
interface ToolRunner {
  run(task: ToolTask): Promise<ToolRunResult>;
}

// —— 持久化 & 时钟（抽象出来便于测试）——
interface Store {
  commitments: CommitmentRepo; evidence: EvidenceRepo;
  interventions: InterventionRepo; interactions: InteractionRepo;
  people: PersonRepo; feedback: FeedbackRepo;
  dueCommitments(now: Date): Promise<Commitment[]>;
}
interface Clock { now(): Date; }
```

> **加 channel/verifier 的成本**：新 channel 只需实现 `start` + `send` 两个方法并做消息映射；新 verifier 只需实现 `fetchState`。Core、调度、决策、状态机全部不动。post-MVP 第一件事就是加第二个 adapter 来**验证这层缝是真的存在**（见 plan）。

> **谁来填这些 port（基于 pi，见 §14.3）**：`LlmPort` = **pi-ai**；`ToolRunner` = **pi-agent-core + pi-coding-agent 的 `read/grep/find/ls` 只读工具**（再补 `websearch`/`webfetch`/开 thread 工具）；`ChannelAdapter`（群）、`Store`（我们的 commitment/evidence/profile，Postgres+pgvector）、`Clock`、`VerifierAdapter`、scheduler、问责策略 = **自建**。六边形不变，pi 只填引擎层，产品内核不交给 pi。

---

## 5. 三个 LLM 节点的契约

**实时发言相关**的 LLM 节点必须窄输入、schema 输出、单次调用——当前是这三个（extract / verifyLink / decideIntervention）。反思类节点（§13.4 自进化）**另列、永不参与实时发言**。所有 LLM I/O 都用 schema 强约束（Claude tool-use 结构化输出）。「只有三个」是阶段约束，不是架构铁律。

### 5.1 Extractor —— 自然语言 → 候选承诺

```ts
interface ExtractionInput {
  recentMessages: { role: 'user' | 'agent'; text: string; at: Date }[];
  now: Date; timezone: string;
  knownRepos: string[];           // 帮 LLM 绑定 verification
}
interface ExtractionOutput {
  isCommitment: boolean;
  confidence: number;             // < 阈值则不打扰，或仅轻问一句
  title?: string;
  dueAt?: string | null;          // ISO；已按 tz 把"周末前"解析成绝对时间
  verification?: VerificationSpec;
  clarifyingQuestion?: string;    // 信息不足时反问，而不是瞎猜
}
```

### 5.2 Verify-Judge —— 读人给的 link，判断做没做

仅 `kind:'link'` 走这个节点；结构化 adapter（github）多数能确定性判定，不必过 LLM。

> **可信度上限（硬约束，服务"误完成率≈0"）**：link 抓取 + LLM 判定是**弱信号**——默认最多给 `progressed` / `inconclusive`，**只有证据非常明确**才允许 `completed`。**自动转 `fulfilled` 仅限高可信来源**（github merged/CI、结构化 API）；link / manual 的"看着像完成"不足以自动结案，至多提示用户确认。

```ts
interface VerifyInput {
  commitment: { title: string; expectation: string };
  fetched: { url: string; status: number; content: string }[];  // 抓到的内容（截断）
  previous: Evidence | null;     // 上次快照，用于判 progressed/regressed
}
interface VerifyOutput {
  verdict: Verdict;              // completed / progressed / no_change / regressed / inconclusive
  summary: string;              // 人类可读，如「文档已填好架构章节」
  confidence: number;
}
```

### 5.3 Intervention Policy —— 状态 + 证据 + 历史 → 决策 + 话术

```ts
interface DecisionInput {
  commitment: Commitment;
  evidenceHistory: Evidence[];    // 最近若干条
  interactionHistory: { dir: 'in' | 'out'; text: string; at: Date }[];
  now: Date; timezone: string;
  policy: { quietHours: [number, number]; maxProactivePerDay: number;
            lastProactiveAt: Date | null };
}
interface DecisionOutput {
  decision: InterventionDecision;
  newStatus?: CommitmentStatus;
  message?: string;               // 已带 persona 口吻（见 §7）
  nextCheckHint?: 'soon' | 'normal' | 'later';
  reason: string;                 // 落进 Intervention.reason
}
```

---

## 6. 承诺生命周期（状态机）

```
                    confirm                    evidence: progressed / no_change
        ┌────────┐  ───────►  ┌────────┐  ─────────────────────────────────┐
 in ──► │proposed│            │ active │ ◄────────────────────────────────┘
        └────┬───┘            └──┬──┬──┘
         reject│            near due│  │evidence: completed
             ▼                & no  │  ▼
         (discard)        evidence  │ ┌──────────┐  celebrate
                              ▼     │ │fulfilled │ ──► (停止)
                          ┌────────┐│ └──────────┘
                          │at_risk ││
                          └───┬────┘│ user: 放弃        user: snooze(wakeAt)
                     past due │     ├──────────► abandoned   ├──► snoozed ──┐
                     (宽限后)  ▼     │              (停止)     │   wakeAt 到  │
                          ┌────────┐│                        └─────────────┘
                          │ failed │◄ user: 改期 → 回 active(新 dueAt)
                          └────────┘
                            (停止)
```

转移由 **确定性代码**驱动（基于 `dueAt`、`Verdict`、用户命令），LLM 只在 `active`/`at_risk` 上决定"此刻说不说话、说什么"。`fulfilled` / `failed` / `abandoned` 为终态，`nextCheckAt` 置 null，停止调度。

---

## 7. Rendering Layer 的 MVP 处理

mvp.md 把 Rendering 列为独立第三层（persona + 语言风格 + 渠道格式）。MVP 做一处务实合并，但**保留缝**：

- **persona / 口吻**：折叠进 Intervention Policy 的 **system prompt**，决策 LLM 直接输出"已经在角色里"的 `message`。省掉第二次 LLM 调用与延迟。
- **渠道格式**：保留为独立的**确定性**步骤——Markdown 方言、长度切分、飞书 / Discord 的 reply / 按钮形态等机械转换。

这条缝意味着：将来要 A/B 不同 persona、或支持一个格式差异很大的 channel 时，可以把 persona 拆成独立的 render 调用，而 policy 不动。

---

## 8. 关键流程

### 8.1 Evaluator（每个到期承诺的核心逻辑）

```
对每个 nextCheckAt <= now 的 active/at_risk 承诺:
  1. 若 spec ∈ {github_*}: verifier.fetchState(spec, lastEvidence) → 新 Evidence (落库)
     若 spec = manual/none: 跳过取证
  2. 确定性快路（省 LLM 调用）:
       verdict = completed                  → status=fulfilled; celebrate ── 仅高可信源(github/CI/API); 弱源(link/manual)→不自动结案、提示确认
       far from due 且 verdict∈{progressed,no_change} → decision=silent; 仅重排 nextCheckAt
       其余                                  → 调 LLM decideIntervention(...)
  3. 护栏过滤 LLM 输出:
       quiet hours 内                       → 推迟到安静期结束
       今日提醒次数 >= 上限                  → 降级为 silent
       已发提醒且用户未回                    → back-off，不重复（不连环）
  4. 落 Intervention；若有 message → Rendering → Dispatcher → channel.send
  5. 依据 nextCheckHint + 下面的策略重排 nextCheckAt
```

### 8.2 nextCheckAt 调度策略（确定性）

| 承诺状态 | 下次检查 |
|---|---|
| 无 due | +24h |
| due 在 7 天外 | +24h（每日） |
| due 在 1–7 天 | +12h |
| due 在 24h 内 | +3h |
| due 在 6h 内 / at_risk | +1h |
| 过期（宽限窗内） | +2h；超过宽限 → `mark_failed` |
| snoozed | = wakeAt |
| fulfilled / failed / abandoned | null（停止） |

### 8.3 端到端剧本

**① 捕获**
> 你 → bot：「我这周末前把架构文档写完，提交到 pm 仓库」
> Extractor → `{ title:"写完架构文档", dueAt: 周日 23:59(本地→UTC), verification:{kind:'github_commit', repo:'xinren/pm', pathGlob:'docs/**', sinceSha:HEAD}, confidence:0.86 }`
> bot → 你：「我理解你承诺：**周日前**把架构文档写完并提交到 `pm/docs/`，对吗？回复 *改一下* 可调整。」
> 你：「对」 → 承诺 `active`，`nextCheckAt` = 周六上午。

**② 静默进展**
> 周六 tick → GitHub 轮询 → `docs/` 新增 2 个提交 → `Evidence{verdict:'progressed'}`。
> 快路命中（离 due 还远 + 有进展）→ `decision=silent`，不调 LLM，`nextCheckAt`=周日中午。**它知道你在动，于是闭嘴。**

**③ 临期追问**
> 周日 18:00 tick → 自周六无新提交、PR 未开 → `Evidence{verdict:'no_change'}`，临近 due。
> 调 LLM → `decision=remind` → bot → 你：「离你说的周日截止还有 6 小时，`docs/` 这边我没看到新提交，进度怎么样？要不要把时间往后挪？」

**④ 达成 / 祝贺**
> 你 push 了 `docs/architecture.md` → 下次 tick 命中 spec → `verdict:'completed'` → `status=fulfilled` → bot：「看到 `docs/architecture.md` 进来了，这周的承诺达成 ✅」→ 停止调度。

**⑤ 失败 / 改期**
> 过期且无证据 → 宽限内继续低频探，超宽限 → `mark_failed` + `suggest_renegotiate`：「这条这周没成。是放弃，还是定个新时间？」

### 8.4 判断质量的指标（不是"越沉默越好"）

隐形率（该闭嘴时闭嘴的比例）只是其一。按危害排序盯五个：

1. **误完成率 ≈ 0（最狠）**——没完成却标 `fulfilled`。摧毁信任，最高优先；靠"只有高可信 verifier 能自动结案"（§5.2）兜底。
2. **误催率极低**——不该出声时出声（on-track / 已回 / 安静期）。
3. **误捕率 < 漏捕率**——把闲聊当承诺，比漏记更伤（宁可漏不可误）。
4. **打扰率**——主动消息密度，越低越好但不为零。
5. **闭环率**——承诺最终 fulfilled / renegotiated / abandoned，不悬空。

---

## 9. 技术栈

| 关注点 | 选型 | 理由 |
|---|---|---|
| 语言/运行时 | **TypeScript / Node 22+（ESM）** | pi 要求 Node ≥22.19；单语言贯穿 |
| **LLM** | **`@earendil-works/pi-ai`**（Claude Sonnet） | 多 provider · **typebox 结构化输出** · **prompt caching**（`CacheRetention`）· usage 统计——`LlmPort` 的需求现成 |
| **Agent / 工具** | **`@earendil-works/pi-agent-core`** + pi 的 `read/grep/find/ls`（**只读**） | 工具 loop · **`block` 护栏（保证只读）** · **compaction**；**专业 review** 引擎现成 |
| 我们补的工具 | `websearch` · `webfetch` · **开 thread**（PR 评论 / issue） | 写成 pi 原生 `AgentTool` / `defineTool`；当前 SDK 无 MCP adapter/export；开 thread 走 octokit（只评论 / issue，**不碰代码**） |
| Channel（飞书 / Discord 群） | **@larksuiteoapi**（飞书长连接）· **discord.js** | 群消息 + @mention + 作者归因；长连接 / gateway，自部署无需公网 webhook |
| Verifier（GitHub） | **@octokit/rest** + PAT（读代码 + 写评论/issue） | 私有 / merged / CI（读）；review 开 thread（写评论 / issue）；**不写代码** |
| 持久化（**我们的记忆**） | **Postgres**（托管 Supabase/Neon，`postgres-js`）+ **Drizzle** + **pgvector** | commitment/evidence/profile 的系统记录 + §15.3 查询；pgvector 留给语义召回（§13.4）。**与 pi 的 compaction 是两层（§13）** |
| 结构化校验 | **typebox**（LLM，对齐 pi-ai）；zod 可选（配置） | 统一 schema 库 |
| 调度 | **进程内 tick** + 落库 `nextCheckAt` | 不引外部队列；重启安全 |
| 测试 / 日志 / 部署 | **vitest** / **pino** / `node`·pm2·systemd | 自部署 |

---

## 10. 仓库结构

```
src/
  core/                         # 平台无关，不 import 任何 adapter
    domain/        commitment.ts evidence.ts intervention.ts status.ts(状态机)
    ports/         channel.ts verifier.ts llm.ts store.ts clock.ts
    pipeline/      router.ts extractor.ts verificationPlanner.ts
                   evaluator.ts interventionPolicy.ts renderer.ts
    scheduler/     scheduler.ts          # tick 循环 + nextCheckAt 策略
  adapters/
    channels/feishu/ discord/   # 映射 In/OutboundMessage；群锁定 + @mention
    verifiers/github/ link/ manual/  # fetchState(spec) → Evidence
    llm/pi.ts                   # LlmPort 实现（pi-ai）；结构化输出 + prompt caching
    store/pg/                   # Drizzle pg schema + PgStore（store/memory.ts 测试用）
    clock/systemClock.ts
  app/
    config.ts                   # env 加载与校验
    container.ts                # 手动 DI：把 ports ↔ adapters 接线
    main.ts                     # 启动：飞书/Discord 监听 + Scheduler
  prompts/         extraction.ts decision.ts persona.ts
  shared/          logger.ts ids.ts result.ts
test/
```

依赖方向严格单向：`adapters → core`，`core` 永不 import `adapters`（靠 ports 反转）。

---

## 11. 配置与安全（单用户自部署）

`.env`：

```
DISCORD_BOT_TOKEN=...             # Discord bot（开 MESSAGE CONTENT INTENT）
FEISHU_APP_ID=... FEISHU_APP_SECRET=...   # 飞书自建应用（长连接，免公网回调）
# 群锁定：bot 只服务已接入的工作群，陌生人忽略
GITHUB_TOKEN=...                 # 细粒度 PAT，只读你要跟踪的仓库
ANTHROPIC_API_KEY=...
DATABASE_URL=postgres://...      # Supabase / Neon（你掌控的库）+ pgvector
TZ=Asia/Shanghai
QUIET_HOURS=23-8
MAX_REMINDERS_PER_DAY=1          # 同一承诺一天最多提醒一次（§15.4）
```

- **群锁定**：bot 只服务已接入的工作群，杜绝别人盗用你的 bot。
- **最小权限**：GitHub 用细粒度只读 PAT，只勾选要跟踪的仓库。
- **数据在你自己的库**：Postgres 托管在你的 Supabase/Neon 项目（你掌控的库，不是第三方 SaaS）；secrets 只在 env；`Evidence.raw` 可设保留窗口定期清理。

### 11.1 配置边界：能抽环境变量的，不写死

实现时按三层配置处理，避免把 dogfood 阶段的个人偏好写进 core：

| 类别 | 应配置项 | 默认值 / 原则 |
|---|---|---|
| Runtime | `TZ`、`QUIET_HOURS`、`MAX_REMINDERS_PER_DAY`、`TICK_MS` | 影响节奏与时间判断，必须 env 化 |
| Channel | 启用哪些 channel、允许的 `groupRef`、bot identity、mention 格式 | channel adapter 只做映射，不把群 id 写进 core |
| LLM / pi | provider、model id、thinking level、transport、prompt cache retention | `PiLlm` / `PiToolRunner` 自己读配置，core 不知道模型 |
| Store / retention | `DATABASE_URL`、raw evidence 保留天数、profile/feedback cap | DB 是长期记忆，但 raw 内容要可清理 |
| Policy | 提醒窗口、逾期宽限、去重窗口、每日/每周清单时间 | `InterventionPolicy` 接收参数，不读 env |
| Feature flags | `ENABLE_REVIEW`、`ENABLE_WEBFETCH`、`ENABLE_PROFILE_REFLECTION` | 高副作用能力默认可关，逐步 dogfood |

**规则**：env 只在 `app/config.ts` 解析，之后通过 `container.ts` 注入 ports / policies。`core` 不读 `process.env`，不 import adapter，不知道飞书、Discord、pi、Postgres 的具体类。

### 11.2 知情与同意（multi-subject 必须）

bot 会记录**非 operator 成员**的承诺，这有组织行为风险，立几条硬规矩：

- **知情**：bot 只在**已明确接入**的工作群里记事；进群时一条说明它会记录与项目事项相关的内容。
- **可纠正 / 可删除**：任何人可在群里纠正或删除**自己**的事项记录；支持 `/forget <id>`、`/stop tracking me`。
- **保留期**：`Evidence.raw` 可能含敏感文档片段——设保留窗口、到期清理；profile / feedback 同样有界。
- **谁能查**：「谁没交」这类查询默认群内公开（透明），但只答**事项事实**，不做评价、不导出群外。
- **可纠错**：bot 判错（误捕 / 误标完成）时，群内一句即可推翻；纠正信号进 `feedback`（§13.4）。

---

## 12. 风险与对策

| 风险 | 对策 |
|---|---|
| 抽取误判（把闲聊当承诺） | 确认步骤 + 置信度阈值 + 一键「不是承诺/算了」；低置信只轻问不建档 |
| 过度打扰（变成 nag bot） | 确定性护栏：每日上限、quiet hours、去重、back-off；`/snooze`、`/stop` 命令 |
| 承诺无法干净映射到 GitHub | `manual` 自报 + `none` 纯提醒兜底；planner 不确定时让用户选查证方式 |
| 隐私（bot 在读你的对话） | 群锁定 + 自部署 runtime + 你自己的 Postgres（Supabase/Neon）+ env secrets + 最小留存 |
| LLM 成本/延迟 | prompt caching；抽取用便宜档；**确定性快路**在"显然该沉默/已完成"时根本不调 LLM |
| 时区 / 相对时间解析 | 抽取时按用户 TZ 把"周末前"解析成绝对时间，落库存 UTC |
| 自部署进程挂掉漏 tick | `nextCheckAt` 落库；重启后补跑所有 `<= now` 的到期项；pm2/systemd 守护 |

---

## 13. 上下文与记忆

**主原则：数据库是记忆，context window 不是。** 每次调 LLM，context 都是从结构化状态**临时重建的一份简报**，用完即弃，**不随承诺寿命增长**——跟了三个月的承诺和刚建的，喂进去的体积一样小。这条立住，内存 / attention / 自进化基本都解了。

### 13.1 每次调用怎么组织

- **抽取调用**：天然小。最近 N 条消息的滑动窗口 + 时间 + 已知仓库，够消解"它 / 周五前"即可，无增长。
- **决策调用**：增长风险全在这，按固定布局现攒：

```
[system 前缀 — 静态, prompt-cached, ~1.5k]
  角色 + persona 契约(§15.4) + 决策策略 + 输出 schema + 用户 profile(§13.4)
[per-call 简报 — 每次重建, 预算 < ~700 tokens]
  <now>         2026-05-31 18:00 +08, 周日
  <commitment>  写完架构文档 | assignee=你 | due 今天23:59(剩6h) | active
  <evidence>    轨迹: 周六有进展(2 commits)→此后停滞; 最新: 无新提交(no_change)
  <interaction> 今天已主动问1次(3h前), 未回
  <policy>      今日主动额度 2/3; 非安静时段
  <task>        此刻该 silent/remind/mark_at_risk/suggest_renegotiate? 按 schema 输出
```

**核心手法：把 LLM 本要从原始历史推导的结论，提前用确定性代码算好、当事实喂进去**——「今天催过几次」是一次 `COUNT`，不是让模型数 20 条消息。这一条同时服务内存与 attention。

### 13.2 控制 token / 内存

不累积（每次重建，体积由构造封顶）· 按承诺隔离（决策只看一条，O(1)）· 证据分层（raw 存 DB **永不进 context**，只 `verdict+summary` 进）· 滚动 compaction（超阈值折叠成 digest）· 快路不攒 context（显然该沉默时连简报都不组）· prompt caching（静态前缀缓存）。预算：前缀 ~1.5k（缓存）+ 每次新鲜 payload **< ~700**。

### 13.3 保证 attention

**"小"本身就是最强保证**——多数 attention 失败其实是"塞太多"。再加：结构化打标签（`<commitment>` / `<evidence>`）· 关键事实放两端（对抗 lost-in-the-middle）· 喂结论不喂原料 · 一次一主题 · schema + 护栏兜底。

### 13.4 自进化（学习在数据 / prompt 层，不动权重）

两层记忆：
- **per-commitment 工作记忆**：那份滚动 evidence/interaction digest，承诺终结即归档。
- **per-user profile**：从信号蒸馏出"它对你的理解"。信号 = 确认时的纠正（它猜周五你改周日）、对干预的反应（提醒有没有回、是否每次都 snooze）、最终结果（达成 / 放弃）。落成结构化 `feedback` 行。

**一个周期性（如每晚）反思任务**读近期 feedback → **提议**更新 profile（「最近 3 次 deadline 你都往后改一天，默认放宽？」）。**改行为的学习是提议、不是偷偷生效**（同"先确认后落地"，不背着你漂移）；校准类（阈值）可更自主。profile 注入 cached 前缀，**本身有界、要 compaction**。先例见 §14.2（Hermes 分层 SQLite+FTS5、pi-mem 反思引擎）。

> **对 M0 的约束**：`feedback` 表与 profile 字段**从一开始就建**，否则回头是大改。

---

## 14. 技术选型与先例

### 14.1 库（对着 port 选）

| 层 / port | 库 | 备注 |
|---|---|---|
| 运行时 | Node 22+ · TypeScript · ESM | pi 要求 ≥22.19 |
| **LlmPort** | **`@earendil-works/pi-ai`** | 多 provider · typebox 结构化 · prompt caching |
| **ToolRunner** | **`@earendil-works/pi-agent-core`** + pi 只读工具 | loop · `block` 护栏（保证只读）· compaction |
| 代码 review | pi 的 `read/grep/find/ls`（只读） | 专业 review 引擎现成；不引 bash/edit/write |
| 我们补的工具 | `websearch` · `webfetch` · 开 thread | 当前 pi SDK 无 MCP adapter/export；开 thread = octokit 写评论 / issue（不碰代码） |
| ChannelAdapter | **@larksuiteoapi** · **discord.js** | 群 + @mention + 长连接 / gateway |
| VerifierAdapter | **@octokit/rest** | 私有/merged；开 review thread / issue 也走它 |
| Store（我们的记忆） | **Postgres**（Supabase/Neon）+ **Drizzle** + **pgvector** | 系统记录 + §15.3 查询；语义召回（§13.4） |
| 结构化校验 | **typebox**（对齐 pi-ai）；zod 可选 | |
| Scheduler / 日志 / 测试 | 自写 tick / **pino** / **vitest** | |

schema 用 typebox（跟 pi-ai 一致）；结构化/全文查询用 Postgres，语义召回用 **pgvector**（§13.4，到记忆层再接 embedding provider）。

### 14.2 同类先例（同物种：自部署 / 单用户 / 持久记忆 / 自改进）

- **OpenClaw**（MIT；control-plane 网关 + 20+ channel + `SOUL.md`）：**借** channel 网关形状（证明 ChannelAdapter 抽象能撑 20+）；**不借**"全权限、什么都能干"。
- **Hermes**（Nous，Python；自改进 loop；**分层 SQLite + FTS5**）：**借**分层记忆 + FTS5 + 反思 loop；**不借**通用 autonomous loop。
- **pi-mem**（纯 Markdown 记忆 + 反思引擎迭代规则 / 身份）：自进化层（§13.4）的参考实现。
- 研究侧：O-Mem、ELL → "per-user profile + 反思更新"是当前共识。

### 14.3 基于 pi 的分工（已定）

**决策：基于 pi 的 SDK 来做**——用它的 SDK + 扩展机制（`agent-core` 干净导出，`coding-agent` 导出 `.`+`./hooks` 并有 `examples/sdk`），**不 fork 它的 TUI/CLI**。依据是实测的能力盘点：

| pi 给的（实测） | 我们的用法 |
|---|---|
| `pi-ai`：多 provider · **typebox 结构化输出** · **prompt caching** · streaming | 当 `LlmPort`（3 个决策节点） |
| `pi-agent-core`：工具 loop · **`beforeToolCall{block}` 护栏** · **compaction/branch-summarization** · session | 当 `ToolRunner`（开放式动作 + 护栏）；compaction 喂 §13 *工作上下文* |
| `pi-coding-agent`：`read`·`grep`·`find`·`ls`（**只读**） | **专业 review** 引擎（不改代码） |

**pi 没有、我们补**：

- **工具**：`websearch`、`webfetch`(link 查证)、**开 thread**（review 评论 / issue，走 octokit）——写成 pi 原生 `AgentTool` / coding-agent `defineTool`。`pi-agent-core` / `pi-coding-agent` 当前没有公开 MCP adapter/export；且**刻意不走 MCP**——MCP 会把工具 schema 灌进 context、费 token，原生工具更省（§13）。**注**：开 thread 只写评论 / issue，**不引 pi 的 bash/edit/write 工具**（不改代码，见 §16）。
- **整层**：channel（群）· scheduler · **commitment store + 我们的记忆/profile（Postgres+pgvector）** · 跨群 · 问责策略。

**记忆边界（关键）**：pi 的 compaction = *单次跑动*的工作上下文；**我们的记忆 = 长期系统记录（DB），是差异化，不交给 pi**（§13）。

一句话：**pi 当引擎（LLM / 工具 / 只读 review / 记忆压缩），我们当大脑（承诺 / 证据 / 问责 / 长期记忆）。**

---

## 15. 协作模式与人设（@别人 · 项目查询 · 管家）

> 本节涉及 §3 领域模型、§4 Ports、§8 干预的协作维度。

### 15.1 single-operator，multi-subject（与自部署不冲突）

区分**操作者**与**对象**：
- **操作者 = 你**：运行 bot、bot 唯一服务的主人。单用户 · 自部署 · 无多租户——**不变**。
- **对象 = 你让 bot 替你盯的协作方**：出现在**共享群**（飞书群 / Discord 频道），bot 在群里 @他们、问进度、催办、提供资料。**他们不是系统用户**——无账号 · 无 onboarding · 无数据隔离。

→ 这是 **single-operator / multi-subject**，**不是**多租户（多租户 = 多操作者）。bot 是**你的** PM，只是触达面延伸到了群里你的协作方。

### 15.2 @别人：三处 delta

- **§3 领域模型**：`Commitment` 增 `assignee`（责任人）；新增轻量 `Person`（每 channel 一个 handle，无账号）。承诺可属于你、也可属于别人。
- **§4 Channel**：adapter 需支持 (a) 群 / 多方会话、(b) `@mention` 指定某人、(c) 把入站消息归因到作者。`OutboundMessage` 增 mention 能力。
- **§8 干预**：多一个"对谁说"维度。别人的承诺 → 在共享群 `@assignee` 就事论事问一句（**点任务、不点人格**）。**卡住不公开施压、不羞辱**——只是把它留在每日 todo / 周报的中性台账里，必要时 @ 上 operator 由你私下定夺。问责留在群里公开；个人化的提醒 / digest 走私聊（原则 7）。
- 边界：仍是你一个人在配 / 管，**只是 bot 的嘴变宽了**——但永远对着整个群说话。

### 15.3 项目面板：今日 todo · 本周进度 · 随时查（群内一等能力）

PM 价值 = **及时** + **搜索调度**。三个形态，全在群里、全员可见：
- **每日「今日 todo」**：每天定时列出今天 due / 待办，按人。**主要的、被动的问责面**（清单本身就是温和压力，不靠催）。
- **每周「本周进度」**：完成 / 逾期 / 改期 / 零进展，每条带证据链接。
- **随时查**：群里任何人问「谁没交？」「X 进度？」「上次 Y 说了啥？」→ bot 查 store + evidence + people（结构化查询 + pgvector 语义召回）**在群里**直接答。

把 §13 的内部记忆检索，升级成**全员可见的项目面板**（答案公开 → 信息层次齐）。

### 15.4 人设：一个顶级管家

整个产品的总开关。所有 prompt、口吻、review、干预，都从这里推出来。

**它是一个顶级（欧洲）管家**，四个内核拧成一股：

- **忠心**——只向着你/你的团队，不是管理层派来查岗的。看见一切、说出去的是零；知道的事绝不被拿来对付谁。这是"它不是问责工具"的根：问责是上对下的监视，管家是并肩的忠诚。
- **细致**——记得一切、不漏、不让人重说一遍；连小规律都看在眼里（这人周五总掉链子、那个 PR 开太久了）。**细致首先意味着不放过真问题**——review 先挑出 bug（底线），再谈讲究。
- **深谙圈层（有品味）**——不只是知道，更有**判断**：什么得体、什么寒酸、什么做得讲究。这是 AI 才给得了的那层，也是工具迈成管家的坎。落到 review：在"对"之上再看"够不够讲究"。
- **有分寸**——低调、护主，从不在群里让人难堪，该烂在肚子里的烂在肚子里。我们的"不点名 / 不羞辱 / 不私下打小报告"都源于此。

**两个把它焊成一体的原则**：

1. **隐形即核心**——越好越隐形，却越不可替代。感觉不到它使劲、一切就是顺。"隐形为主"和"地位核心"不矛盾，隐形正是它坐上核心的方式。
2. **诚实裹在分寸里**——该讲的真话讲给你，但只让你变好、绝不让你难堪。只会奉承的不是好管家，直愣愣戳穿的更不是。

**行为库（能做）**：
- **打理台账**：每日 todo + 每周进度（§15.3）——被动、中性的面板，不靠催。
- **预判式准备**：临期前就把相关材料 / 一版 draft 备好递上来（"我先备着了"），不只是提醒。
- **温和提醒**：对有事要办的人可推，但**一天最多一次**、就事论事。
- **有品味的 review**：只读 → **先挑真 bug、再评讲究** → 问题开成 GitHub thread（评论 / issue），**不改代码**。
- **答疑帮忙**：什么都懂一点（80% 够用；深问题转真专家），随时答 §15.3 的提问。

**不做**：不公开点名 / 羞辱 · 不跨群把原话搬到别的群公开（原则 7）· 不改代码（§16）· on-track 不出声 · 不重复问已知的事。

> 一句话：**一个有品、会预判、滴水不漏、只向着你的顶级管家。** 做到了，它就是团队中枢。

---

## 16. 非目标（MVP 明确不做）

- ❌ 多租户 / SaaS / 注册 / OAuth / 密钥托管（**单用户自部署**，根本用不上）
- ❌ 飞书 / Discord 之外的 channel、GitHub 之外的认证 verifier（架构留好，MVP 只做这些 + link / manual 兜底）
- ❌ 被动静默抽取（选了「抽取 + 确认」）
- ❌ Web / GUI dashboard
- ❌ recurring / 习惯类承诺（字段预留，引擎不做）
- ❌ **改代码 / 自动开代码 PR**（先不做）——bot **读代码 + 开 thread**（PR review 评论 / issue）来提问题，但**不写代码、不开代码 PR**
- ❌ **多操作者**团队（每人各自账号 / 各自的 bot）——但**单操作者 @ 协作方**（§15）是计划方向，不在此列
- ❌ 语音、附件

> 这些不是"永远不做"，而是**架构已经为它们留好接缝**（ports、`userId` / `assignee` 字段、`VerificationSpec` 的可扩展 union），但 MVP 不投入实现。
```
