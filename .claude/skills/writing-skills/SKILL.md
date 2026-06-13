---
name: writing-skills
description: Use when adding or editing a project skill under .claude/skills/. Explains the conventions for authoring a skill for the Commitment Agent so contributors (human or AI) extend the project consistently.
---

# 怎么给本项目写一个 skill

skill = 一份**短**的操作手册，把一类「会重复做」的扩展任务（加频道、加 verifier、加工具）固定下来，让下一个人（或下一个 AI）不读完整个代码库也能做对。

## 什么时候该写一个新 skill
- 某个扩展点会被反复加（新平台、新证据源、新工具）；
- 或者有一条**项目不变量**容易被新人破坏，需要随手提醒。

## 结构
```
---
name: kebab-case-name
description: 「什么时候用我」——写清触发场景，这是别人/AI 找到它的唯一线索
---
# 标题
## 什么时候用
## 步骤（可执行、带文件路径）
## 不变量（本项目的红线，必须守）
## 参考（指向 canonical 代码/文档，而不是抄一遍）
## checklist（做完自检）
```

## 原则
- **短**。能指到代码就别复述代码。一屏读完。
- **可执行**。步骤带真实文件路径（`src/adapters/...`），不要泛泛而谈。
- **编码不变量**。把容易踩的红线写进去（见下）。
- **带 checklist**。让人做完能自查。

## 本项目的不变量（任何 skill 都要尊重）
1. **管家灵魂**（见 `docs/architecture.md` §15.4）：忠心 / 细致 / 有品味 / 有分寸。任何面向用户的文案都从这里推。
2. **依赖方向**：`src/core` 永不 import `src/adapters` 或 `pi`；跨层只走 `src/core/ports`。
3. **不改代码**：bot 可读代码、写评论/开 issue，**绝不写代码、不开代码 PR**。
4. **全程在群、不私聊**；**隐形为主**，on-track 不出声。
5. **记忆是我们的**：长期状态落本地 SQLite+FTS5，不交给 pi。

## checklist
- [ ] frontmatter 的 `description` 写清了触发场景？
- [ ] 步骤带真实路径、可照做？
- [ ] 列了相关不变量？
- [ ] 指向了 canonical 代码而非复制？
- [ ] 一屏读得完？
