# 判断 + 记忆：M3 主动回路 + 自进化 Profile · 设计文档

> 日期：2026-06-01 · 配套：[../architecture.md](../architecture.md)（§8 流程、§13 记忆、§15.4 人设）· [../flows.md](../flows.md)（§1/§6）· [../plan.md](../plan.md)（M3 / M5 §13.4）
>
> **目标**：在 pi 这个 runtime 之上，把我们差异化护城河里的两块——**判断**（要不要打扰、怎么开口）与**记忆**（越用越懂这个人）——做厚到能落代码。
>
> **中心是人设**（§0）：机制是管道，**保证它是个优秀管家**才是重点。判断/记忆都服务于此。核心主张——人设不是 prompt 出来的，是"让不像管家的输出根本不可能发生（结构焊死忠心/分寸/细致）+ 只对剩下的品味做可回归评测（契约 + flows golden + humanizer + judge）"。
>
> **范围（approach B）**：主动回路 + 判断 LLM 节点 + **反思式 Profile（提议制，不偷偷改）**。语义召回（pgvector + embedding，approach C）明确**推迟**，理由见 §6。
>
> **分两个可交付切片**：Stage A ≈ plan 的 **M3**（回路活、判断节点落地、记忆做到"确定性当下简报"）；Stage B ≈ 把 plan **M5 §13.4 自进化** 提前一部分（会学习的 Profile）。A 可独立验收、独立上线。
>
> **状态更新（2026-06-01 决定）**：**Stage B 整体推后**——核心回路（Stage A）先 dogfood 稳定，再做 Profile 反思与人设自动评测。本文档保留 Stage B 设计留档。

---

## 0. 人设工程：怎么保证它是个优秀管家（本设计的中心）

机制是管道，**人设是灵魂**。但"人设"最容易被做成"写一段漂亮 system prompt 然后祈祷"。本设计的核心主张相反：

> **优秀管家不是 prompt 出来的，是"让不像管家的输出根本不可能发生 + 只对剩下那层品味做评测"。** 人设落三层，prompt 是最弱的一层。

### 0.1 §15.4 四内核 → 靠什么保证

| 内核 | 靠什么保证 | 信任 LLM？ |
|---|---|---|
| **忠心** | 结构：架构里**没有私聊通道、没有向管理层上报的路径**、单 operator。想泄密/打小报告也无路可走。 | 否 |
| **有分寸** | 确定性护栏 + `InterventionDecision` union 里**压根没有 escalate / 公开点名**；on-track→silent、一天一次、quiet hours、未回不连环。LLM 只在护栏放行后才被问"怎么说"。 | 否 |
| **细致** | 结构：Evidence 一等公民、无证据不宣称完成；+ Profile 记住小规律（§4）。 | 半 |
| **有品味** | **唯一 structuralize 不掉、真正落在 LLM 上的一层**——措辞、临界判断、review 眼光。 | 是 → 见 0.3 |

前三个内核**用代码焊死到"想犯错也犯不了"**，不求模型自觉。只剩"有品味"需要被真正保证。

### 0.2 结构层（焊死，不靠 prompt）

- 已就位：`screenIntervention` 护栏、enum 无 escalate/点名、Evidence 驱动、全程在群（无私聊）。
- 本设计补强：§3.6 未回去重（不连环）、§3.2 失败即 silent（宁可漏不可误）、§3.5 提醒类 COUNT（一天一次的事实来源）。

### 0.3 品味层（可回归，prompt + eval）

品味 prompt 给不出"保证"，但可以**为它做选择（select）**。六件事：

1. **单一 persona 契约模块** `src/adapters/llm/prompts/persona.ts`（新）——决策措辞、`suggest_renegotiate`、`celebrate`、review、每日/每周面板、profile 提议……**所有生成出口共用一个嗓子**，不是六处各拷一段、漂成六个略不同的人格。当前 `interventionPolicy.ts`（模板话术）与 `toolRunner.ts` 各自内联口吻——本设计把它们收敛到这一个源。契约草案（从 §15.4 + flows 直译）：

   ```
   身份：顶级管家。只向着主人/团队。默认隐形——没消息 = 一切正常。
   出声时：一句话、就事论事；临期带上能用的资料（不只是催）；逾期给体面出口。
   不做：点名 / 羞辱 / 指责框架（"又""为什么还没"）· 私聊 · 抖机灵 · 奉承 ·
        堆形容词 · 连环追问 · 看不到却假装看得到 · 改代码。
   诚实裹在分寸里：该讲的真话讲给主人，只让他变好、绝不让他难堪。
   ```
   few-shot 范例直接取 flows.md 的真实对白。

2. **rubric（把 §15.4 写成可判定清单）**——每条生成输出可逐项判：
   - [ ] 提醒类 ≤ 1–2 句、单主题
   - [ ] 无点名/羞辱/指责框架
   - [ ] 临期 remind 附了可用资料（flows §1.3）
   - [ ] 看不到时明说看不到、不假装（flows §2.3）
   - [ ] 逾期给新时间/放弃的体面出口、不指责（flows §1.5）
   - [ ] 对方回话后收声、不追问（flows §1.3）
   - [ ] 过 `humanizer-zh`（无破折号滥用 / 三段式 / AI 腔 / 形容词堆砌）

3. **golden set = flows.md（已现成）**——§1–§4 每个 case 都写好了措辞/节奏/边界。映射：
   `§1.1` 捕获确认 · `§1.3` 临期带料一次 · `§1.4` 完成确认 · `§1.5` 逾期改期 · `§2.3` 打不开不假装 · `§4` review 群里一句话。不是新造测试，是把你写的剧本变基准。

4. **`humanizer-zh` 当嗓音守门员**——管家话必过它；这是"低调、不抖机灵、不奉承"的**可执行检查**，不是口号。

5. **LLM-judge + CI 闸（推后）**——跑 decide/render → judge 按 rubric 打分 → 不过不合并。**第一版先不上自动判官**：用 flows golden + 确定性不变量 + humanizer 手动 lint；dogfood 稳后再引 judge，避免过早把项目做成"AI 输出评测平台"。

6. **指标盘（不是"越沉默越好"）**——按危害排序：①**误完成率≈0**（没做却标完成，最伤；靠"仅高可信源自动结案"兜底）②误催率 ③误捕<漏捕 ④打扰率 ⑤闭环率。隐形率是其中一项，不是唯一。

### 0.4 自进化与 persona（不漂移）

Stage B 的 Profile 让品味 **per-person 适配**（这人要简、那人要背景），但行为改动**提议制**（§4.3）——persona 永不背着 operator 漂移，契约与 rubric 始终是基线。

> 一句话：**忠心/分寸/细致用代码保证到"想犯错也犯不了"；品味用 契约 + flows golden + humanizer + judge 保证到"可回归"。** 这才叫保证一个优秀管家，而不是写段 prompt 碰运气。

---

## 1. 现状（这份设计要接的桩）

| 件 | 现状 |
|---|---|
| `screenIntervention()` `interventionPolicy.ts` | ✅ 已实现 + 测试。确定性隐形护栏：非监督态/安静期/on-track/今日已达上限 → silent；completed → celebrate；其余 → `consult_llm`。 |
| `InterventionPolicy.decide()` | ✅ 已实现。screen → silent/celebrate(模板)/`llm.decideIntervention`。 |
| `computeNextCheckAt()` `scheduler/nextCheck.ts` | ✅ 纯函数 + 测试。终态/逾期超宽限 → null。 |
| `Store.dueCommitments(now)` | ✅ 端口已定义；PgStore + InMemoryStore 已实现。 |
| `Evaluator.evaluate()` | ❌ `throw 未实现（M3）`。 |
| `PiLlm.decideIntervention()` | ❌ `throw 未实现（M3）`。 |
| Scheduler tick 循环 | ❌ 不存在（只有纯策略函数）。 |
| `DecisionInput` | ⚠️ 已有 `commitment/evidenceHistory/interactionHistory/policy`，**缺 profile/学习上下文**。 |
| `feedback` 表 | ✅ schema 已建（§13.4 M0 约束），**无人写入**。 |
| `memory_embeddings`（pgvector） | ✅ 表已建，**embedding 未接**（pi 无 `embed`，approach C 才用）。 |
| Profile 实体 / 表 | ❌ 不存在。 |

**一句话**：判断节点的"确定性半边"（screen 护栏）已就位；缺的是 ① 驱动它的 tick 回路、② 判断的 LLM 半边、③ 喂判断的记忆简报、④ 会学习的 Profile。

---

## 2. 架构总览

```
                      ┌──────────── Stage A：主动回路 ────────────┐
  Scheduler.tick() ──► dueCommitments(now) ──► Evaluator.evaluate(c)
        ▲ 固定间隔轮询                              │
        │ 开机补跑                                  ├─1. 查证(M2缝, 可降级)──► Evidence
        └──────────────────────────────────────────┤
                                                    ├─2. 攒确定性简报 ────► DecisionInput
                                                    │       └─ <profile> 注入(Stage B)
                                                    ├─3. InterventionPolicy.decide()
                                                    │       screen ─► silent / celebrate / decideIntervention(LLM)
                                                    ├─4. 落地: 状态机校验 + render + send + 记 Intervention/Interaction
                                                    └─5. computeNextCheckAt(...) 重排
                              ┌──────────── Stage B：自进化 Profile ────────────┐
  信号捕获(确定性写 feedback): Router(correction) · Evaluator(reaction/outcome)
  Reflector(每晚): 读近期 feedback ─► 校准类(纯统计)直接更新 + 行为类 → 群里提议
        └─ 用户在群里回 接受/否决 ─► Router 应用/丢弃 ─► Profile 更新
```

两个驱动入口（入站环 Router、tick 环 Scheduler）汇聚到同一个 Store——本设计补的是 **tick 环**那一侧，并往 Router 上挂少量信号捕获。

---

## 3. Stage A — 主动回路 + 判断节点

### 3.1 Scheduler（新 `src/core/scheduler/scheduler.ts`）

持久时钟模型（架构原则 6）：**不**为每条承诺起定时器，而是固定间隔轮询 `dueCommitments`。

```ts
export interface SchedulerDeps {
  store: Store;
  evaluator: Evaluator;
  clock: Clock;
  tickMs: number;          // 默认 60_000，可配
  onError?: (e: unknown, ctx: string) => void;  // log，不抛
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly deps: SchedulerDeps) {}

  /** 开机补跑：把宕机期间错过的到期项全跑一遍，然后进入 tick 循环。 */
  async start(): Promise<void> { await this.tick(); }

  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  private async tick(): Promise<void> {
    try {
      const due = await this.deps.store.dueCommitments(this.deps.clock.now());
      for (const c of due) {
        try { await this.deps.evaluator.evaluate(c); }
        catch (e) { this.deps.onError?.(e, `evaluate ${c.id}`); } // 单条失败不波及其余
      }
    } catch (e) {
      this.deps.onError?.(e, "tick");                              // tick 自身永不死
    } finally {
      this.timer = setTimeout(() => void this.tick(), this.deps.tickMs);
    }
  }
}
```

**取舍**：固定 60s 轮询 vs per-commitment 定时器 vs 外部队列。选轮询——`nextCheckAt` 是小时级，60s 精度绰绰有余；轮询天然 **重启安全 + 补跑**（落库的 `nextCheckAt<=now` 自动被捞出）；单 operator 量级无需外部队列。串行处理到期项，不打爆 verifier/LLM。

### 3.2 Evaluator（实现 `src/core/pipeline/evaluator.ts`，改成带 deps 的 class，仿 `Router`）

```ts
export interface EvaluatorDeps {
  store: Store;
  verifiers: Map<VerifierKind, VerifierAdapter>;
  policy: InterventionPolicy;
  clock: Clock;
  config: { timezone: string; quietHours: [number, number]; maxRemindersPerDay: number };
  send: (out: OutboundMessage) => Promise<{ dispatchRef: string }>;
  newId: () => string;
}

export class Evaluator {
  constructor(private readonly deps: EvaluatorDeps) {}
  async evaluate(c: Commitment): Promise<void> { /* 见下五步 */ }
}
```

**五步（架构 §8.1）：**

0. **确定性逾期补丁**（前置，不调 LLM）：`dueAt` 已过且超 `GRACE_MS` 且非终态 → `status=failed`，发**一次** `suggest_renegotiate`（给体面出口，flows §1.5），`nextCheckAt=null`，return。`screenIntervention` 保持只管"此刻该不该出声"，不掺逾期判定。

1. **查证（M2 缝）**：按 `c.verification.kind` 选 `verifiers.get(kind)`。
   - `manual` / `none` → 跳过取证。
   - `link` / `github` → `verifier.fetchState(spec, lastEvidence)` → append `Evidence`。
   - **诚实降级（关键）**：verifier 仍 `未实现`(throw) 或网络失败 → catch → 当作"无新证据"（沿用上次 verdict，没有则 `inconclusive`），log 后继续。**这条让整条回路在 M2 verifier 落地前就能跑、能测**（用 `manual/none` 承诺 + 桩 LLM 即可端到端）。
   - **结案守门（误完成率≈0）**：`completed` 只有来自高可信源（github merged/CI、结构化 API）才自动转 `fulfilled`/celebrate；link/manual 的"看着像完成"最多提示用户确认、**不自动结案**（对齐架构 §5.2）。这条要落进 screen 的 celebrate 快路前置判断。

2. **攒确定性简报**（记忆所在）：从 store 现攒 `DecisionInput`：
   - `evidenceHistory` = 末 N 条（N≈5）。
   - `interactionHistory` = 本承诺 / 本群末 N 条。
   - `policy.lastRemindAt` + `remindersToday` = 对**当日** interventions 的 `COUNT`（decision ∈ 提醒类，见 §3.5）。
   - `profile`（Stage B 注入；Stage A 为 undefined）。

3. **决策**：`policy.decide(input, { localHour, remindersToday })`——复用现有 `InterventionPolicy`，无需改它的主路由。

4. **落地**：
   - `newStatus` 经状态机（`status.ts` 的合法转移表）校验后写回；非法转移 → log + 丢弃该字段（防 LLM 乱跳状态）。
   - 有 `message` → **渲染**（确定性渠道格式：Markdown 方言 / @mention / 长度切分，§7）→ `send` → 记 `Intervention`（带 `dispatchRef`）+ 记一条出站 `Interaction`。
   - `silent` 也记一条 `Intervention`（message=null，`reason` 说明为何沉默）——供审计 + COUNT。
   - `send` 失败 → 记 `Intervention{dispatchRef:null}` + log，**不丢决策、不重发**（幂等：本 tick 已记，下 tick 由护栏去重，不会连环）。

5. **重排**：`computeNextCheckAt(now, dueAt, status)`，按 `nextCheckHint`(soon/normal/later) 缩放（soon=取更短档、later=更长档）；终态 → null。

### 3.3 判断 LLM 节点（实现 `PiLlm.decideIntervention` + 新 `prompts/decision.ts`）

完全仿现有 `extractCommitment`（同一个 `structuredOutput` 薄封装、同样 typebox + tool-use、同样靠 system prompt 注入人设、§7 不再二次 LLM 渲染口吻）：

```ts
// prompts/decision.ts
export const DECISION_TOOL = "decide_intervention";
export const DecisionSchema = Type.Object({
  // ★ enum 收窄：LLM 仅在 screen 判 consult_llm（临期/regressed/要措辞）时被调，
  //   所以只能在这四个里选；celebrate 走模板、mark_failed 确定性，均不交给模型。
  decision: Type.Union([
    Type.Literal("silent"), Type.Literal("remind"),
    Type.Literal("mark_at_risk"), Type.Literal("suggest_renegotiate"),
  ]),
  newStatus: Type.Optional(Type.Union([Type.Literal("at_risk"), Type.Literal("active")])),
  message: Type.Optional(Type.String({ description: "已带管家口吻、就事论事、一句话；silent 时省略" })),
  nextCheckHint: Type.Optional(Type.Union([Type.Literal("soon"), Type.Literal("normal"), Type.Literal("later")])),
  reason: Type.String({ description: "为何这么决定，落进 Intervention.reason 便于调试" }),
});
import { BUTLER_PERSONA } from "./persona";   // ★ 单一嗓音源（§0.3）
export const DECISION_SYSTEM = `${BUTLER_PERSONA}\n\n【本节点任务】临期/无进展时决定此刻 silent/remind/mark_at_risk/suggest_renegotiate 并给措辞，按 schema 输出。`;
export function buildDecisionUserText(input: DecisionInput): string { /* §3.4 简报 */ }
```

`PiLlm.decideIntervention` = 一次 `structuredOutput(...)`，回填 `DecisionOutput`。

### 3.4 决策简报格式（§13.1 落地，预算 <700 token）—— "判断"的护城河

```
<now>         2026-06-01 18:00 +08, 周日
<commitment>  修复登录 bug | 小李 | due 今天23:59(剩6h) | active
<evidence>    轨迹: 周六有进展(2 commits)→此后停滞; 最新: no_change(无新提交)
<interaction> 今天已主动问1次(3h前), 未回
<policy>      今日额度 2/3; 非安静时段
<profile>     小李: deadline 常晚约1天; remind 一般会回; 周五易掉链子   ← Stage B
<task>        此刻 silent/remind/mark_at_risk/suggest_renegotiate? 按 schema 输出
```

**命门（§13.1/§13.3）**：`<evidence>` 轨迹行、`<interaction>` "今天问1次" 全是**确定性代码现算的结论**喂进去——"今天催过几次"是一次 `COUNT`，不是把 20 条原始消息丢给模型去数。简报小、高信号、结构化打标签、关键事实放两端。静态前缀（人设+策略+schema）走 prompt-cache，每次只新鲜攒这点 payload。

### 3.5 提醒类决策的定义（给 COUNT 用）
`remindersToday` 统计当日 `Intervention.decision ∈ { remind, mark_at_risk, suggest_renegotiate }`。`silent` / `celebrate` 不计入"打扰次数"。这是"一天最多一次"护栏的事实来源。

### 3.6 去重 / back-off（"不刷屏"，flows §6）
现 `screenIntervention` 只看次数上限。**补一条确定性去重**：若最近 X 小时内已发过 `remind` 且其后无该 assignee 的入站消息（未回）→ screen 直接 `silent`（"已问过、未回，不连环"）。实现：给 `ScreenInput` 加 `hasUnansweredRecentRemind: boolean`（Evaluator 从 interactions/interventions 现算），screen 在"今日上限"判断旁加这一支。

---

## 4. Stage B — 自进化 Profile（§13.4，提议制）

> **状态（2026-06-01 决定）：整体推后**到核心回路 dogfood 稳定之后；本节为设计留档，不在当前实施批次。Profile 的 schema/字段**可先建**（架构 §13.4 要求早建、免日后迁移），但 Reflector + 第 4 个 LLM 节点 + 自动评测**暂不做**。

### 4.1 Profile 实体（新 `src/core/domain/profile.ts` + `profiles` 表）

per-`Person`、**有界**、结构化的"它对这个人的理解"：

```ts
export interface Profile {
  personId: PersonId;
  // —— 校准类（数值/类别，低风险，可较自主更新）——
  deadlineBufferDays: number;                 // 这人 deadline 的有效缓冲（常晚 N 天）；初始 0
  responsiveness: "prompt" | "slow" | "silent" | "unknown";  // 对提醒的反应
  // —— 叙述类（小规律，LLM 蒸馏，封顶 K 条）——
  reliabilityHints: string[];                 // 如 ["周五易掉链子", "PR 常开太久"]，cap=5
  // —— 元 ——
  updatedAt: Date;
  version: number;                            // 每次反思 +1，审计用
  pendingProposals: ProfileProposal[];        // 待用户确认的行为型更新（cap=3）
}
export interface ProfileProposal {
  id: Id; at: Date;
  summary: string;                            // 群里发的那句："最近3次deadline都晚一天，默认放宽?"
  patch: Partial<Profile>;                    // 接受后应用的补丁
  status: "proposed" | "accepted" | "rejected";
}
```

落库：新 `profiles` 表（personId PK + 结构化列 + `pending_proposals` jsonb）。`Store` 加 `profiles: Repo<Profile>`；PgStore + InMemoryStore 各加实现。**有界保证**（§13.4"profile 本身有界、要 compaction"）：`reliabilityHints` cap=5、`pendingProposals` cap=3，反思时去重/合并/淘汰最旧。

### 4.2 信号捕获（确定性写 `feedback`，§13.4）
`feedback` 表已建、现无人写。挂三处确定性写入（零 LLM）：
- **correction**（`Router`）：用户回「改」并重述，或确认时 dueAt/title 与抽取值不同 → `feedback{kind:'correction', data:{field, from, to}}`。
- **reaction**（`Evaluator`/`Router`）：对一条 `remind` 之后该 assignee 是否回话、是否每次 snooze → `feedback{kind:'reaction'}`。
- **outcome**（`Evaluator`）：转入 `fulfilled/failed/abandoned` 终态时 → `feedback{kind:'outcome'}`。

### 4.3 Reflector（新 `src/core/pipeline/reflector.ts` + 每晚调度）

```ts
export class Reflector {
  async reflect(personId: PersonId): Promise<void> {
    // 1) 读近期 feedback（本人，时间窗内）
    // 2) 校准类 = 纯统计，直接更新（无 LLM）：
    //      deadlineBufferDays = median(观察到的逾期/改期天数)
    //      responsiveness     = 由 reaction 比例分档
    // 3) 叙述类 + 提议措辞 = 一次窄 LLM 调用 llm.reflectProfile(...)：
    //      产出 reliabilityHints（去重并入，cap） + 行为型 ProfileProposal[]
    // 4) 行为型 → 入 pendingProposals + 在群里发 proposal.summary（§13.4 提议、不偷偷改）
  }
}
```

**调度**：每晚一次（复用 Scheduler，或独立 daily timer）。反思失败 → log、今晚跳过、Profile 不变（安全）。

**用户回应**：群里对 proposal 回「好/不用」→ `Router` 捕获 → 应用 patch（version+1）/ 标记 rejected。仍**全程在群、不私聊**（原则 7）。

### 4.4 Profile → 简报注入
`DecisionInput` 加 `profile?: ProfileBrief`（渲染出的极小子集：bufferDays / responsiveness / hints）。Evaluator 第 2 步 `store.profiles.get(c.assignee)` → 渲染成 `<profile>` 一行。

**与 §13.1 的偏离（须知）**：§13.1 把 profile 放进**缓存的 system 前缀**，那是单用户假设。我们是 **single-operator / multi-subject**（§15，一个群多个 assignee），profile 是 per-person 的，放进共享缓存前缀不干净——故 profile 改放**每次简报的 `<profile>` 行**，人设+schema 仍留缓存前缀。代价：profile 这点 token 不缓存，但它有界且极小，可接受。

---

## 5. 错误处理（横切）

| 处 | 失败 | 处理（基调：宁可漏不可误） |
|---|---|---|
| Scheduler tick | 任意异常 | 单条 `evaluate` try/catch 不波及其余；tick 自身 catch 后照排下一轮，**永不死**。 |
| Verifier | 未实现 / 网络 | 当"无新证据"(`inconclusive`)，log 继续。 |
| `decideIntervention` | LLM 报错 / 没调工具 | **失败即 silent**——记 `Intervention{silent, reason:"决策失败，保守收声"}`，正常重排 nextCheckAt，下 tick 再试。绝不因报错乱发提醒。 |
| `send` | 发送失败 | 记 `Intervention{dispatchRef:null}` + log；不丢决策、不重发。 |
| Reflector | LLM / 统计失败 | log、今晚跳过、Profile 不变。 |
| 状态转移 | LLM 给非法 newStatus | 状态机校验挡掉，log，保持原状态。 |

---

## 6. 明确不做（YAGNI / 越线项）

- **approach C：语义召回（pgvector + embedding provider）** —— 推迟到 M3 之后。理由：① 回路都还没跑起来，先上检索是过早优化；② pi 无 `embed`，要引外部 provider（OpenAI/Voyage）+ key + 成本 + 检索调优——新依赖；③ **有违 §13"小才是最强的 attention 保证"**，语义召回最易把简报撑大反伤判断。届时单独做选型决策。
- **跨承诺/跨群记忆**：本轮 profile 只 per-person 当下；跨群 rollup 是 post-MVP。
- **recurring 承诺**：字段不动，引擎不做。
- **Stage B 自进化（本轮推后）**：Reflector / 第 4 个 LLM 节点 / 自动 judge-CI 闸——核心回路 dogfood 稳后再做（见 §4 状态）。

---

## 7. 一个需要你拍板的架构点

**反思引入"第 4 个 LLM 节点"**（`LlmPort.reflectProfile`）。架构 §5 写的是"LLM 只在这三处出现"（三个**决策**节点）。但 §13.4 本身就要求"一个周期性反思任务读近期 feedback → 提议更新 profile"——所以这不是新增需求，是把 §13.4 已承诺的反思**形式化**成第 4 个节点。它仍是**窄、周期性、schema 约束的单次调用**（非 loop），且校准类已剥离为纯统计、不过 LLM。

→ 倾向：**接受**，并在 architecture §5 注明"三个决策节点 + 一个周期性反思节点（§13.4）"。若你坚持不加第 4 节点，退路是反思也只用纯统计 + 模板措辞（不蒸馏叙述类 hints），Profile 表达力会弱一档。

其余已在文中替你默认掉的小决策：① Scheduler 固定轮询（非 per-commitment 定时器）；② Profile 放每次简报而非缓存前缀（因 multi-subject）；③ 校准类自主更新、行为类提议制。如有异议指出即可。

---

## 8. 测试策略

**纯/确定性（无需 API key，进 CI）：**
- Scheduler：假时钟 + InMemoryStore，驱动一条种子承诺走 active→at_risk→（逾期超宽限）failed；验证补跑、单条失败隔离、tick 不死。
- Evaluator：桩 `LlmPort` + InMemoryStore，验证五步 + 诚实降级（verifier 未实现时不崩）+ 逾期补丁 + 非法状态转移被挡。
- `screenIntervention`：补 `hasUnansweredRecentRemind` 去重分支用例。
- Reflector 校准：median buffer / responsiveness 分档纯函数。
- 信号捕获：correction/reaction/outcome 写 feedback 的断言。

**Golden / 契约（需 `ANTHROPIC_API_KEY`，本地/手动，沿用现有 keyless 启动姿态）：**
- `decideIntervention`：几个剧本（临期无进展 / 已问未回 / regressed / 远离 due）→ 期望的 decision **类别**（不锁字面措辞）。
- `reflectProfile`：给定 feedback → 期望 proposal 结构。

**人设评测（§0.3，CI 闸）：**
- **golden = flows.md §1–§4**：跑生成 → 对照各 case 的期望行为类别。
- **rubric LLM-judge**：每条生成输出按 §0.3 rubric 逐项打分，不过不合并。
- **humanizer-zh 嗓音闸**：管家话过 `humanizer-zh`，命中 AI 腔模式即失败。
- **隐形率断言**：on-track/quiet/已问未回 语料集上，silent 比例 = 100%（确定性，screen 保证；judge 复核 LLM 没在 message 里画蛇添足）。

**端到端**：用 `manual`/`none` 承诺 + 桩 LLM 跑通整条回路，**不依赖 M2**。

---

## 9. 文件改动清单

**新增**
- `src/adapters/llm/prompts/persona.ts` — **单一嗓音源 `BUTLER_PERSONA`（§0.3）**；所有生成出口共用。
- `src/core/scheduler/scheduler.ts` — tick 循环 + 补跑。
- `src/adapters/llm/prompts/decision.ts` — DecisionSchema + 引用 persona + buildDecisionUserText。
- `test/persona/` — flows.md golden + rubric judge + humanizer 嗓音闸 + 隐形率断言（§8）。
- `src/core/pipeline/reflector.ts` — 反思（统计 + 提议）。【Stage B】
- `src/core/domain/profile.ts` — Profile / ProfileProposal 类型。【Stage B】

**编辑**
- `src/core/pipeline/evaluator.ts` — 由桩改为带 deps 的实现（五步 + 逾期补丁）。
- `src/adapters/llm/pi.ts` — 实现 `decideIntervention`；【Stage B】加 `reflectProfile`。
- `src/core/ports/index.ts` — `DecisionInput.profile?`；`Store.profiles`【B】；`LlmPort.reflectProfile` + `ReflectInput/Output`【B】。
- `src/core/pipeline/interventionPolicy.ts` — `ScreenInput.hasUnansweredRecentRemind` + 去重支；celebrate 模板话术口径收敛引用 `persona.ts`（§0.3）。
- `src/adapters/llm/toolRunner.ts` — review 口吻收敛引用 `persona.ts`（不再内联）。
- `src/core/pipeline/router.ts` — 信号捕获(correction) + proposal 回应处理。【Stage B】
- `src/adapters/store/pg/schema.ts` + `pg/index.ts` + `store/memory.ts` — `profiles` 表 + repo。【Stage B】
- `src/app/container.ts` / `main.ts` / `config.ts` — 装配 Scheduler，启动 tick + 每晚反思【B】；config 加 `TICK_MS`、反思时刻。

**不动**：`computeNextCheckAt`、`status.ts`、`extractCommitment`、channel adapters、`InterventionPolicy.decide` 主路由。

---

## 10. 验收（对齐 plan.md）

- **Stage A（= M3 验收）**：建一条今天 due、小号当 assignee → 临期 bot 在群 @ 他**一次**；他给的 link 显示完成 → 下一 tick ✅ 转 `fulfilled`；全程不刷屏；宕机重启能补跑。
- **Stage B**：连续观察后，bot 在群里**提议**一条 profile 更新（如"默认放宽一天？"）；用户回「好」→ 下次决策简报 `<profile>` 反映该变化；**全程未偷偷改**。
