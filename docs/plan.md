# Commitment Agent · 实施 Plan

> 配套：[architecture.md](./architecture.md) · [flows.md](./flows.md)。6 个里程碑，每个**可单独运行、可验收**。
>
> **形态**：常驻**工作群**的低调 bot，盯每个人的承诺（盯你自己 = 群里只有你，n=1）。单 operator · 自部署 · TS/Node。
> **基调**：**隐形为主**——默认不出声，只在 许诺 / 每日清单 / 临期一次 / 完成 / 被问 时出现。
> **引擎**：基于 **pi 的 SDK**——`pi-ai`(LLM+cache+typebox) + `pi-agent-core`(工具 loop / `block` 护栏 / compaction) + pi 的 `read/grep/find/ls` 工具(**只读 review**)。我们补 `websearch`/`webfetch` 工具，自建编排层。
> **脊柱**：**承诺** → 查证 → 隐形跟进。今日 todo / 本周进度是衍生面板。
> **沟通**：问责在群里公开，**个人 digest（今日 todo / review 进展）走私聊**，**不点名羞辱**（架构原则 7 + flows §6）。

> **实时进度看 `CLAUDE.md`「当前进度」**；本文件是路线图，里程碑勾选可能领先 / 落后于代码。

## 设计取舍（与你确认）

- **隐形为主**：on-track 一律不出声；催是辅助，**一天最多一次**、只催有事要办的人；装死的人**不追加点名催问**，留在「今日 todo」里就行。
- **基于 pi 的 SDK，不 fork CLI**：pi 当引擎（LLM / 只读工具 / review / 记忆压缩），我们当大脑（承诺 / 证据 / 问责 / 长期记忆）。`pi-agent-core` / `pi-coding-agent` 当前没有公开 MCP adapter/export，缺的工具写成 pi 原生 `AgentTool` / `defineTool`。
- **记忆是我们的**：commitment/evidence/profile 落自己的 **Postgres + pgvector（Drizzle）**；pi compaction 只管单次跑动（§13）。
- **承诺为脊柱**；**verifier = link 优先**；**问责在群、个人 digest 走私聊**。
- **code review 保留、做专业；不改代码**：只读 PR 给意见，不动代码库、不开 PR（先不做）。
- **group-native，自己先 dogfood**（`assignee`/`Person` 从 M0 就有）。

## 实现前架构约束

- **配置化优先**：节奏、阈值、模型、channel/group allowlist、raw evidence 保留期、功能开关都走 env/config；实现里不要硬编码 dogfood 群、模型名、提醒时间。
- **依赖注入优先**：`app/config.ts` 只解析 env，`app/container.ts` 只接线；`core` 只能拿 ports 和 policy 参数，不能读 `process.env`。
- **解耦优先**：`core` 不 import `adapters`；pi 只出现在 `adapters/llm/*` / `ToolRunner`；channel/verifier/store/clock 都可替换。
- **副作用隔离**：查证、发消息、写 GitHub thread、webfetch 都必须在 adapter/tool 层；状态机、调度、干预筛选保持可测的确定性代码。
- **最小 pi 边界**：决策用 `pi-ai` 单次结构化输出；开放动作用 `pi-agent-core` loop + pi 只读工具；缺的工具写原生 `AgentTool` / `defineTool`，不引 MCP 假设。

---

## 里程碑总览

| | 里程碑 | 产出 | 验收 |
|---|---|---|---|
| **M0** | 地基与契约 | 类型 + ports（含 `ToolRunner`）+ Postgres/pgvector + 接上 pi | 编译/迁移/冒烟过 |
| **M1** | 群内捕获 | 群消息归因 → 抽取 → 群里公开确认 → 落库 | 群里说一句，确认后入库 |
| **M2** | 查证 + 专业 review | link 抓取 + 判定 → Evidence；GitHub adapter；只读 review | `/check` 出 verdict；review 给出专业意见 |
| **M3** | 隐形主动闭环 | 调度 → 查证 → 临期一次温和提醒 / 给资料 | 全自动：临期 @人一次、完成 ✅、on-track 静默 |
| **M4** | 今日 todo + 本周进度 | 每日清单 + 每周小结 + 随时查 | 到点自动发清单；群里一句话查状态 |
| **M5** | 打磨与自用 | 人设（隐形）、护栏、自进化、测试、部署 | 真实工作群跑一周不烦人 |

**硬依赖链**：M0→M1→M2→M3。M4 建在 M3 的 store 上。M5 横向加固。

---

## M0 —— 地基与契约

- [x] 仓库 / TS(ESM, Node 22+) / vitest / pino；config 校验 `.env` + `.env.example`。（pino 装了未用）
- [x] **依赖装好**：`pi-ai` / `pi-agent-core` / `pi-coding-agent` / discord.js / @larksuiteoapi 等已装。（pi 实际调用桩在 `adapters/llm`，M1/M2 跑通冒烟）
- [x] `core/domain/`：types（含 `assignee`/`Person`/`feedback`、link 优先 `VerificationSpec`、隐形决策）+ 状态机（`status.ts`，含测试）。
- [x] `core/ports/`：`ChannelAdapter`/`VerifierAdapter`/`LlmPort`/`ToolRunner`/`Store`/`Clock` 全部定义。
- [x] `adapters/store/pg/schema.ts`：Drizzle schema（Postgres + pgvector）。**剩**：迁移落地（测试先用 `store/memory.ts`）。
- [x] `container.ts` 装配（clock/store/飞书+Discord/verifiers/llm/toolRunner/evaluator/scheduler）；`main.ts` 启动频道与主动 tick。
- [x] **额外**：`scheduler/nextCheck.ts`（§8.2 策略，含测试）、`Scheduler`/`Evaluator` 主动回路（M3 骨架已变实现）、verifier 骨架。

**验收**：✅ typecheck 通过、12 测试通过（状态机 5 + nextCheckAt 7）。**剩**：PgStore 迁移/真实连接冒烟 + pi 冒烟（滚入 M1/M2）。

---

## M1 —— 群内捕获（→ 群里公开确认 → 落库）

- [x] `adapters/channels/feishu/` + `discord/`：飞书长连接 / Discord gateway；群消息入站 + 归因到 `Person`；`send` 支持 `@mention`；群锁定。（代码已实现，见 CLAUDE.md）
- [x] `LlmPort.extractCommitment` **在 pi-ai 上**（typebox + tool-use）；prompt：相对时间→绝对、**群场景高置信阈值**、低置信反问。
- [x] `router.ts` 分流；确认流：`proposed` → **群里公开确认**(@当事人「对吗?」) → ack/超时 → `active`。**不私聊。** 同时记录 interaction，供后续去重判断。

**验收**：群里说"周三前修登录，PR 在 …/pull/12" → 群里公开确认 → 「对」→ 入库 `active`、`assignee` 正确。

---

## M2 —— 查证 + 专业 review

- [x] **link verifier**：`SafeLinkFetcher`（SSRF 加固：scheme/host allowlist + DNS→私网 IP 拦截 + redirect/字节/content-type 上限）抓 URL → `verifyLink`(§5.2，**弱信号：最多 progressed/inconclusive，不自动结案**) → `Evidence`+verdict。默认 `ENABLE_WEBFETCH=0` 关着；私有链接降级 manual（待做）。
- [ ] **GitHub adapter**：`@octokit/rest` + 只读 token，`kind:'github'`（私有/merged/CI），确定性判定（**唯一可自动转 `fulfilled` 的高可信来源**）。← M2 真正剩的高价值件。
- [ ] `manual` verifier；verdict 对比上次快照；临时命令 `/check <id>`。
- [ ] **专业 review**：`ToolRunner`（pi `read/grep/find/ls`，**只读代码**）读 PR diff → 出同事级反馈 → 用我们的 octokit 工具**在 PR 上开 review thread / 或开 issue**（不在群里顺手提）。`block` 护栏保证不碰代码。

**验收**：link 承诺 `/check` 出正确 verdict；私有 PR 看到 merged；对一个真实 PR，review 给出有价值、专业的意见（不只是"看起来 OK"）。

---

## M3 —— 隐形主动闭环 ★ 它活了

- [x] `scheduler`：tick + `nextCheckAt`(§8.2) + 启动补跑，单条失败隔离。
- [x] `evaluator`：到期承诺 → 查证 → 决策 → 状态转移 → send/intervention/interaction 落库。
- [x] `interventionPolicy`：**隐形快路**（on-track / 远离 due → silent，不调 LLM）+ `decideIntervention` + **护栏**（quiet hours、**每条一天最多一次提醒**、去重、back-off）。
- [ ] **行为库**（§15.4）：临期**一次**温和提醒 + **提供资料**（websearch / 已存 link）；完成 ✅。**装死不追加催问、不升级施压**。
- [ ] **对谁说**：有事要办的人 → 群里 @ 一句（问责，公开）；个人化的今日 todo / review 进展走私聊 digest；**不公开施压**。
- [ ] `renderer` + `Dispatcher`；状态转移接全；`/snooze`、`/done`、`/drop`。

**验收**：建一条今天 due、小号当 assignee → 临期 bot 在群 @他**一次**；他给的 link 显示完成 → 下一 tick ✅ 转 `fulfilled`；全程不刷屏。

---

## M4 —— 今日 todo + 本周进度

- [ ] **每日「今日 todo」**：定时群里列今天 due/待办，按人（被动问责面）。
- [ ] **每周「本周进度」**：完成 / 逾期 / 改期 / 零进展，每条带证据链接。
- [ ] **随时查**（群内）：谁都能问「谁没交 / X 进度 / 上次 Y 说啥」→ 查 store+evidence+people（Postgres 结构化索引 / 全文索引）在群里答。

**验收**：到点自动发出今日 todo 与本周进度；群里一句话查到准确状态。

---

## M5 —— 打磨与自用

- [ ] **人设（隐形）落 prompt 并调**：默认沉默阈值、一天一次的提醒节奏、不点名；quiet hours / snooze / stop。
- [ ] **自进化**（§13.4，**已决定推后**：核心回路 dogfood 稳后再做）：`feedback` 落库 + 每晚反思 → **群里提议**更新 profile（不偷偷改）。
- [ ] 成本：复用 pi-ai **caching** + agent-core **compaction**；隐形快路省 LLM；link 内容截断。
- [ ] 测试：状态机、extract/verify/decide/review golden 测试、adapter 契约测试。
- [ ] 部署：README、`.env.example`、pm2/systemd。**真实工作群 dogfood 一周。**

**验收**：连续一周真实群里用，**不烦人**（同事不想把它踢出群）；经历"建档→静默→临期一次→完成"和"改期/放弃"各一次 + 每日 todo / 周报正常。

---

## Post-MVP（留口，先不做）

1. **review 做更深**（更结构化的反馈、跨文件理解）——仍**只读**，不改代码。
2. 更多**认证 verifier**（Linear / Notion / Google Docs / 日历）。
3. **跨群 + 管理群总览**（多群部署；rollup 发到指定管理群，仍透明）。
4. 更多 channel（Slack / Discord / 飞书）——评估接 pi-chat 或自写 adapter。
5. recurring 承诺；GitHub webhook 替代轮询。
6. **Profile 自进化反思 + persona 自动评测（judge/CI 闸）**——框架见 `docs/plans/2026-06-01-judgment-memory-m3-design.md`，dogfood 稳后再做。
6. ~~改代码 / 自动开 PR~~ —— **明确不做**（flows §4 / 架构 §16）。

---

## 给执行者的提醒

- **隐形是第一要务**：on-track 不出声、一天最多催一次、装死不追加催问——**群里烦一次，信任就没了**。
- **别提前打磨**：M0–M2 允许临时命令和 console 输出。
- **守依赖方向**：`core` 不 import `adapters`；pi 藏在 `LlmPort`/`ToolRunner` 后面，core 不直接依赖 pi。
- **LLM 输出过 typebox**：extract/verify/decide 三处都校验。
- **ToolRunner 只读**：只装 `read/grep/find/ls`，再用 `block`-hook 兜底保证 review 不写、不越界——**不改代码**。
- **增值不只施压**：带资料、做专业 review，但不催过头、不点名。
