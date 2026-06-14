# Commitment Agent

团队在群里答应的事，常常说完就没了下文。这个 agent 替你盯着它们不落空——从聊天里记下承诺、自己查证进展、到点才提醒，平时隐形。不用谁填表，也不用你天天追。

核心闭环：**承诺识别 → 证据查证 → 干预决策 → 跨平台触达**。

> 想先看效果？`npm run demo` —— 零配置，在终端里跑一周的工作群时间线（捕获 / 挣来的沉默 / 自动结案 / 临期分寸 / 私聊台账 / 品味自检），全程跑真实 core 代码。见 [demo/README.md](./demo/README.md)。

- MVP：单用户自部署 · TypeScript/Node · 飞书/Discord(channel) + GitHub/link/manual(verifier)，承诺用「抽取 + 确认」捕获。
- 飞书 / Discord / GitHub 只是第一批 adapter，不是产品边界。

## 快速开始

需 Node ≥ 22。先零配置看 demo（不需要 key / 数据库 / 频道）：

```bash
npm install
npm run demo
```

接真实频道跑起来：

```bash
cp .env.example .env   # 填飞书 + LLM key（无频道也能起，只是不监听）
npm run dev            # 开发：tsx watch
```

> 上岗细节（飞书自定义应用 / Discord bot / operator open_id）见 [CLAUDE.md](./CLAUDE.md) 的 Onboarding。

常用命令：

| 命令 | 作用 |
| --- | --- |
| `npm run demo` | 终端跑七幕实况演示（零配置） |
| `npm run dev` | 开发模式（tsx watch） |
| `npm start` | 直接运行 |
| `npm test` | vitest（含品味 floor 离线门） |
| `npm run eval` | 品味金标：真 LLM + LLM-judge 打分（需 key，改 prompt/换模型前跑） |
| `npm run typecheck` | tsc |
| `npm run check` | Biome lint + format |

## 架构一句话

`pi` 是引擎（LLM / 工具循环 / 护栏 / 压缩）；**我们是大脑**（承诺 / 证据 / 问责 / 长期记忆 / 频道 / 调度）。六边形 ports 在 `src/core/ports`，pi 藏在 `LlmPort` / `ToolRunner` 之后，core 不直接依赖 pi。三个窄决策（是不是承诺 / 怎么措辞 / 该不该出声）是 schema 焊死的单次 LLM 调用；开放式动作（搜资料 / 抓链接 / review）走 pi 的工具循环，`block` 护栏保证只读。详见 [architecture.md](./docs/architecture.md)。

## 目录

```
src/core/domain    领域类型（契约）
src/core/ports     port 接口（core 只认这些）
src/core/pipeline  Router · Extractor · Evaluator（捕获 / 评估）
src/core/scheduler 主动回路（轮询到期承诺）
src/core/taste     品味 rubric / golden / judge（把分寸做成可校验）
src/adapters       实现：channels(feishu/discord) · verifiers(link/github/manual) · llm(pi) · store(pg/memory)
src/app            config · main · 装配（container）
demo/              零配置实况演示（驱动真实 core）
eval/              品味金标 eval（真 LLM）
docs/              架构 · plan · flows
```

## 现状

粗粒度：**M0/M1 完成 · M2 link 路径已通（github/manual verifier 待做）· M3 主动回路已成代码**。细节会过时，单一真相在别处：

- 里程碑勾选 → [docs/plan.md](./docs/plan.md)
- 未实现的点 → 代码里 grep `未实现`
- 类型 / 测试 / lint → `npm run typecheck` · `npm test` · `npm run check`
- 改了什么 → `git log`

## 文档

- [CLAUDE.md](./CLAUDE.md) —— 路标：项目是什么、铁律、怎么扩展（给人也给 Claude 看）。
- [架构文档](./docs/architecture.md) —— 设计原则、领域模型、ports & adapters、上下文与记忆、技术选型（基于 pi）、风险。
- [用户视角流程与用例](./docs/flows.md) —— 群聊实录形式的体验与边界，开工前用来确认。
- [实施 Plan](./docs/plan.md) —— 6 个可验收的里程碑（地基 → 捕获 → 验证 → 主动 → 查询/周报 → 打磨）。
- [pi 能力清单](./docs/pi-capabilities.md) —— pi（v0.78）到底给了什么、我们该用哪些，别造轮子。
- [品味保证](./docs/taste-guarantee.md) —— 把「分寸」从散文做成可校验机制（rubric / golden / judge / eval）。
- [demo/README.md](./demo/README.md) —— 演示怎么跑，以及真实 vs 模拟的边界。
- [mvp.md](./mvp.md) —— 最初的产品重定位讨论。
