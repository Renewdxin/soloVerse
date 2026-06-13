---
name: add-pi-tool
description: Use when giving the ToolRunner a new capability (websearch, webfetch, open-thread...). pi has no MCP, so tools are native pi AgentTools registered as extensions. Explains how to add one and keep it within guardrails.
---

# 加一个 pi 工具（ToolRunner 能力）

ToolRunner = 受控的工具型 agent（基于 `pi-agent-core`），干开放式动作：搜资料、抓链接、专业 review。pi **不支持 MCP**，所以工具都写成**原生 pi `AgentTool`**（省 context，见 §14.3）。

## 步骤
1. 在 `src/adapters/llm/tools/<name>.ts` 用 pi 的 `registerTool` 定义工具：typebox schema（从 `@earendil-works/pi-ai` 引 `Type`）+ handler。
2. 在装配 ToolRunner 处把工具挂上（基于 `pi-agent-core`）。
3. **写操作的工具**（如 `open-thread`：开 PR 评论 / issue）只允许评论/issue，用 `octokit`，**绝不碰代码**。
4. 用 agent-core 的 `beforeToolCall({ block: true })` 钩子兜底：拦掉任何越界调用（写代码、删文件、碰 main）。

## 不变量
- **只读代码 + 只写讨论**：可读、可搜、可抓、可开 thread（评论/issue），**绝不写代码、不开代码 PR**（§16）。
- 工具表面要**窄**：每个工具一件事、schema 收紧——省 context，也好审计。
- 工具属于 adapter 层；`core` 只通过 `ToolRunner` 接口用它。

## 参考
- 接口：`src/core/ports`（`ToolRunner` / `ToolTask`）
- pi 扩展 API：`@earendil-works/pi-coding-agent` 的 `registerTool` + `beforeToolCall`（示例见 pi 仓库 `examples/extensions/`：`tools.ts`、`permission-gate.ts`、`protected-paths.ts`）
- 设计：`docs/architecture.md` §9 / §14.3

## checklist
- [ ] typebox schema 收得够紧？
- [ ] 写操作只限评论/issue，`block` 钩子能拦住越界？
- [ ] 没给任何「写代码」的路径？
- [ ] 通过 `ToolRunner` 暴露，core 不直接依赖 pi？
