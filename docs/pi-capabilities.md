# pi 能力清单（v0.78）

> 我们把 pi 当引擎用，所以必须清楚它到底给了什么、哪些该用、哪些该自己写。
>
> 来源：实测 `node_modules/@earendil-works/*@0.78.0` 的导出与类型，并对照上游 `earendil-works/pi` 源码（2026-06-01 clone）。**底线：能用 pi 现成的，就别自己造；但不要把 CLI 能力误当成我们可直接引用的 SDK 边界。**

## 三个包

| 包 | 是什么 | 我们怎么用 |
|---|---|---|
| `pi-ai` | 多 provider LLM API（底层） | 决策节点（窄、单次、schema 约束） |
| `pi-agent-core` | 有状态 agent 运行时（loop + 工具 + 钩子 + 记忆压缩） | 开放式动作（review/搜/抓）的引擎 |
| `pi-coding-agent` | agent **SDK** + 现成工具 + skills + 扩展系统 | 现成只读工具、skills、会话/压缩 |

---

## 1. pi-ai —— LLM 层

- **取模型**：`getModel("anthropic", "claude-sonnet-4-6")`（类型安全，模型 id 来自内建注册表）。多 provider：Anthropic / OpenAI / Google / Bedrock / Azure / Mistral / OpenRouter…
- **调用**：`streamSimple(model, context, options?) → AssistantMessageEventStream`；`.result()` 直接拿最终 `AssistantMessage`（免手撸事件流）。
- **Context**：`{ systemPrompt?, messages: Message[], tools?: Tool[] }`。
- **结构化输出**：`Tool<TParameters extends TSchema>`（typebox schema，`Type` 从 pi-ai 导出）。模型回 `ToolCall { name, arguments }`，读 `arguments` 即结构化结果。
- **prompt caching**：`CacheRetention = "none" | "short" | "long"`；`Usage` 带 `cacheRead/cacheWrite/cost`，可观测命中与花费。
- **thinking**：`reasoning: ThinkingLevel`、`thinkingBudgets`。
- **transport**：`"sse" | "websocket" | "websocket-cached" | "auto"`。
- **key**：从 env 读（`ANTHROPIC_API_KEY`…），也可 `getApiKey` 注入。
- **没有**：embedding（`embed` 0 命中）→ pgvector 的向量得另接 provider。

## 2. pi-agent-core —— 有状态 agent 运行时

核心是 `Agent` 类（`new Agent(options)`），把"自由 agent loop"全包了：

- **工具循环**：`agent.prompt(text | messages)` / `agent.continue()` 跑一轮；模型自己决定调哪些 `AgentTool`，框架执行、回灌结果、继续，直到停。
- **AgentTool**：`{ name, description, label, parameters: TSchema, execute(id, params, signal?, onUpdate?) → AgentToolResult }`。带 `executionMode`（sequential/parallel）。
- **护栏钩子**（关键）：
  - `beforeToolCall(ctx) → { block?: true, reason? }` —— **拦掉任何工具调用**（我们卡"禁写代码/碰 main"就靠它）；
  - `afterToolCall(ctx) → 覆盖结果 / terminate`。
- **生命周期**：`agent.subscribe((event, signal) => …)` —— 监听 tool 开始/结束、turn、agent_end 等。
- **steering / follow-up**：`steer(msg)`（本轮后插话）、`followUp(msg)`（该停时再追一条）—— 适合"边跑边纠"。
- **session / 缓存**：`sessionId` 透给 provider 做 cache-aware；`thinkingBudgets`、`transport`、`toolExecution`。
- **记忆压缩**（直接可复用）：`compact`、`shouldCompact`、`prepareCompaction`、`generateSummary`、`branch-summarization`、`calculateContextTokens`、`DEFAULT_COMPACTION_SETTINGS` —— §13 的"滚动压缩工作上下文"现成。

## 3. pi-coding-agent —— agent SDK + 工具 + skills + 扩展

**不是只有 TUI**：导出一整套 SDK（`./core/sdk.ts`）。

### 现成工具（直接拿来用）
- `createReadOnlyTools(...)` —— **只读工具包（read/grep/find/ls，不含 bash/edit/write）**，正好是我们"有品味的 review / 搜资料"要的本地代码阅读引擎。
- `createCodingTools`、`createReadTool/createGrepTool/createFindTool/createLsTool/createBashTool/createEditTool/createWriteTool` —— 按需取。**我们当前只引只读工具；bash/edit/write 不进入工作群 bot 的 ToolRunner。**
- `defineTool(...)` —— 定义我们自己的工具（websearch / webfetch / 开-thread），注册进 agent。

### 起一个 agent（编程式，非 TUI）
- `createAgentSession(...)` / `createAgentSessionRuntime(...)` / `createAgentSessionServices(...)` / `createAgentSessionFromServices(...)` —— 高层工厂，直接拿到一个可 `prompt` 的 agent 会话，带工具、系统提示、模型。
- `AgentSession` + `AgentSessionEvent` —— 会话对象与事件。
- 更低层可直接用 `pi-agent-core` 的 `runAgentLoop` / `Agent`，传 `createReadOnlyTools(cwd)` 和 `beforeToolCall`。我们当前 `PiToolRunner` 走这条，边界更小、没有 TUI/session 管理负担。

### skills 系统（我们手写过 `.claude/skills`，pi 自带）
- `loadSkills` / `loadSkillsFromDir` / `formatSkillsForPrompt` / `Skill` / `SkillFrontmatter` —— 从目录加载 skill markdown（含 frontmatter）、拼进 system prompt。**应直接复用，别自造加载逻辑。**

### 会话持久化 / 分支
- `SessionManager`、`parseSessionEntries`、`buildSessionContext`、`migrateSessionEntries`、分支/压缩条目 —— 会话存取、分支、迁移。

### 扩展 / 事件系统
- `Extension` / `ExtensionAPI` / `ExtensionFactory` / `defineTool` / `discoverAndLoadExtensions`。
- 生命周期事件可挂：`SessionStartEvent`、`BeforeAgentStartEvent`、`BeforeProviderRequestEvent`、`ContextEvent`、`ToolCallEvent`、`ToolResultEvent`、`TurnStart/TurnEndEvent`、`SessionCompactEvent`、`SessionShutdownEvent` 等。
- `createEventBus` —— 事件总线。

### 其它
- `AuthStorage`（凭据存储，文件/内存后端）、`ModelRegistry`、`SettingsManager`、compaction（同 agent-core）。

### 没有（仍需我们建）
- **channel**（飞书/Discord）、**scheduler**、**承诺/证据领域**、**长期 Postgres 记忆**、**干预策略**、**embedding/向量**。
- **MCP adapter**：`pi-agent-core` / `pi-coding-agent` 当前公开 SDK 与源码中没有 MCP tool adapter/export。缺的外部能力写成 pi 原生 `Tool` / `AgentTool` 更清楚、更省上下文；`pi-chat` 是另一个项目，不能当成这里已可用的 channel 层。

---

## 这改变我们的架构（别再造轮子）

| 能力（"做"的部分） | 用 pi |
|---|---|
| `ToolRunner` + 自写本地读代码工具 | `createReadOnlyTools`；custom 外部工具用 `defineTool` |
| 自己拼 review/搜索的 agent 循环 | `runAgentLoop` / `Agent` / `createAgentSession`，护栏用 `beforeToolCall{block}` |
| §13 工作上下文压缩 | `compact` / `shouldCompact` / branch-summarization |
| 手写 `.claude/skills` 加载 | `loadSkills` / `formatSkillsForPrompt` |
| 决策节点（窄 LLM） | `pi-ai` `streamSimple` + typebox tool（**保持**） |

**仍然是我们的（pi 给不了）**：channel adapter、scheduler、承诺领域模型 + 状态机、长期 Postgres + pgvector 记忆、干预/隐形护栏、embedding 接入。

> 一句话：**"做"的部分交给 pi 的 agent（工具 + 护栏 + 压缩 + skills）；"判断要不要打扰、记什么、何时查"的部分是我们的确定性核心。**
