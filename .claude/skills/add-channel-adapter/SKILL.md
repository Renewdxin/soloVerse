---
name: add-channel-adapter
description: Use when adding support for a new chat platform (Slack, 企业微信, etc.). Feishu and Discord already exist as references. Explains how to implement a ChannelAdapter so the core stays platform-agnostic.
---

# 加一个频道（ChannelAdapter）

频道 = bot 待的工作群入口。飞书、Discord 已有，照着加。

## 步骤
1. 新建 `src/adapters/channels/<name>/index.ts`，实现 `ChannelAdapter`（见 `src/core/ports`）：
   - `start(onMessage)`：监听**群消息**，每条映射成 `InboundMessage`，回调出去；
   - `send(m)`：把 `OutboundMessage` 发到群，支持 `@mention`，返回 `dispatchRef`。
2. **入站映射**必须填全：`groupRef`（哪个群）、`authorRef`（**谁说的**，用于归因到 `Person`）、`replyToRef`、`messageRef`、`at`、原始 `raw`。
3. **出站**：`mentions` → 平台的 @ 语法；`replyToRef` → 平台的回复/thread。
4. 在 `ChannelKind`（`src/core/domain/types.ts`）加上 `"<name>"`。
5. 在 `src/app/container.ts` 注册；在 `src/app/config.ts` + `.env.example` 加凭据。

## 不变量
- 必须支持**群会话 + @mention + 作者归因**三件套（少一个，问责/隐形语义就崩）。
- **只在群里**收发，**不开私聊后门**（原则 7）。
- `core` 不 import 你这个 adapter；只通过 `ChannelAdapter` 接口被调用。

## 参考
- 接口：`src/core/ports`（`ChannelAdapter` / `InboundMessage` / `OutboundMessage`）
- 样板：`src/adapters/channels/feishu`、`src/adapters/channels/discord`
- 行为：`docs/flows.md`（bot 在群里到底说什么）

## checklist
- [ ] 群消息能归因到正确的 `authorRef`？
- [ ] `send` 的 @mention 在真实客户端里能 ping 到人？
- [ ] 没有任何私聊路径？
- [ ] `ChannelKind` / container / config 三处都登记了？
