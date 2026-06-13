---
name: add-verifier
description: Use when adding a new evidence source for verifying commitments (Linear, Notion, Google Docs, CI, calendar...). link / github / manual already exist. Explains how to implement a VerifierAdapter.
---

# 加一个 verifier（证据源）

verifier = 把承诺绑定的外部状态拉回来、判断有没有进展。`link` / `github` / `manual` 已有。

## 步骤
1. 如果是新形态，在 `VerificationSpec`（`src/core/domain/types.ts`）加一个 variant，字段够定位证据即可。
2. 新建 `src/adapters/verifiers/<name>/index.ts`，实现 `VerifierAdapter.fetchState(spec, previous)`：
   - 拉当前状态；
   - 和 `previous`（上一份 `Evidence`）对比，算出 `verdict`（completed / progressed / no_change / regressed / inconclusive）；
   - 写一句人类可读的 `summary`，原始切片放 `raw`。
3. 在 `src/app/container.ts` 注册；私有源要在 config 加只读凭据。

## 不变量
- **只读**。verifier 拉状态、判进度，**绝不写任何东西**（写评论/issue 是 review 工具的事，不是 verifier 的事）。
- **私有/打不开的优雅降级**：拿不到（无权限/404）→ 返回 `inconclusive`，让上层降级成 manual 自报，**绝不假装看到了**。
- `summary` 要让管家能直接引用（细致、准确）。

## 参考
- 接口：`src/core/ports`（`VerifierAdapter`）、`src/core/domain/types.ts`（`VerificationSpec` / `Evidence` / `Verdict`）
- 设计：`docs/architecture.md` §3.2 / §3.3

## checklist
- [ ] verdict 是和 `previous` 对比算出来的，不是凭空？
- [ ] 拿不到时返回 `inconclusive`，没有假阳性？
- [ ] 全程只读？
- [ ] container 注册了？
