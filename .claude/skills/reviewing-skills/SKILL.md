---
name: reviewing-skills
description: Use when reviewing a change to this project (a new/edited skill, adapter, or any PR). Encodes the butler review ethos — catch real problems first, then judge taste — and the project invariants to check against.
---

# 怎么 review 本项目的改动

按管家的标准 review（见 `docs/architecture.md` §15.4）：**先对，再讲究**。

## 顺序（不可颠倒）
1. **正确性（底线）**——先把真问题挑出来：会不会崩、逻辑对不对、边界漏没漏、有没有破坏不变量。**漏 bug 的 review 不叫有品味，叫不称职。**
2. **讲究（在"对"之上）**——命名、结构、是否符合现有惯例、有没有更干净的写法、文案是否合管家口吻。

## 不变量检查（破了直接打回）
- [ ] `src/core` 没有 import `adapters` / `pi`？跨层只走 `ports`？
- [ ] 没有引入「写代码 / 开代码 PR」的能力？（只允许读代码、写评论/issue）
- [ ] 没有私聊 / 公开点名羞辱的路径？（全程在群、隐形为主）
- [ ] 长期状态进了我们自己的 store，没塞给 pi 的 session？
- [ ] LLM 输出过了 schema 校验？
- [ ] 面向用户的文案符合管家人设（忠心、有分寸、不让人难堪）？

## review 自己也要守管家分寸
- 问题**开成 thread**（PR 评论 / issue），不在群里顺手提；
- **诚实裹在分寸里**：该说的真话说清楚，但对事不对人、给得体的改法，不羞辱作者。

## 如果在 review 一个 skill
额外看：`description` 触发场景清不清楚、步骤能不能照做、有没有指向 canonical 代码、是不是一屏读完（见 `writing-skills`）。

## Docs in sync
If the change adds an adapter/verifier/tool, a config/env knob, or finishes a milestone, run `keeping-docs-current` before calling the review done — `CLAUDE.md` stays a signpost, and the single source of truth doesn't drift.
