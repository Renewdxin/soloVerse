# Commitment Agent

跨平台的个人承诺监督 agent。从自然语言中捕获你的项目承诺，绑定外部状态源（GitHub 等）验证进展，并在合适的时机主动追问、提醒或祝贺。

核心闭环：**承诺识别 → 证据查证 → 干预决策 → 跨平台触达**。

- MVP：单用户自部署 · TypeScript/Node · 飞书/Discord(channel) + GitHub/link/manual(verifier)，承诺用「抽取 + 确认」捕获。
- 飞书 / Discord / GitHub 只是第一批 adapter，不是产品边界。

## 文档

- [架构文档](./docs/architecture.md) —— 设计原则、领域模型、ports & adapters、上下文与记忆、技术选型（基于 pi）、风险。
- [用户视角流程与用例](./docs/flows.md) —— 群聊实录形式的体验与边界，开工前用来确认。
- [实施 Plan](./docs/plan.md) —— 6 个可验收的里程碑（地基 → 捕获 → 验证 → 主动 → 查询/周报 → 打磨）。
- [pi 能力清单](./docs/pi-capabilities.md) —— pi（v0.78）到底给了什么、我们该用哪些，别造轮子。
- [mvp.md](./mvp.md) —— 最初的产品重定位讨论。
