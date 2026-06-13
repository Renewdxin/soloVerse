# 部署选择：Railway / Cloudflare

本服务当前是常驻 worker：启动后监听飞书/Discord 消息，并由内置 scheduler 定时评估承诺。现有 channel adapter 都依赖长连接：

- Discord：`discord.js` gateway。
- 飞书：`@larksuiteoapi/node-sdk` 的 `WSClient`。

因此部署选择要看两件事：平台是否能跑 always-on worker，以及 websocket 连接断开后是否能稳定重连。

参考：

- Railway Deployments：https://docs.railway.com/deployments
- Railway Start Command：https://docs.railway.com/deployments/start-command
- Railway Pre-deploy Command：https://docs.railway.com/deployments/pre-deploy-command
- Railway Healthchecks：https://docs.railway.com/deployments/healthchecks
- Railway GitHub Autodeploys：https://docs.railway.com/deployments/github-autodeploys
- Railway SSE vs WebSockets：https://docs.railway.com/guides/sse-vs-websockets
- Railway Public Networking Specs & Limits：https://docs.railway.com/networking/public-networking/specs-and-limits
- Railway Cron / Workers / Queues：https://docs.railway.com/guides/cron-workers-queues
- Cloudflare Workers WebSockets：https://developers.cloudflare.com/workers/runtime-apis/websockets/
- Cloudflare Workers Limits：https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Durable Objects WebSocket Hibernation：https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/

## 结论

现有架构最省改动的选择是 **Railway persistent service**，不是 Cloudflare Workers。

依据：

- Railway 官方文档明确写了 WebSocket connections work via HTTP/1.1 upgrade。
- Public networking specs 也列了 support for websockets over HTTP/1.1。
- Railway 的 background worker 是 always-on service，适合 continuous event processing。
- 公网入站 WebSocket/SSE 有 15 分钟 request duration 上限，必须实现重连。我们当前主要是出站连 Discord/飞书 gateway，不直接受这个入站 15 分钟限制，但仍要按平台重启、远端断线、滚动部署来设计重连。

所以：Hermes 能部署在 Railway 且你说话它能收到，这个现象是合理的，不是偶然。我们这类 bot 也可以先按 Railway worker 路线走。

Cloudflare 可以作为后续目标，但需要改架构：

- 飞书可以从 `WSClient` 改成 HTTP event callback，然后放到 Cloudflare Workers。
- scheduler 可以拆成 Cloudflare Cron Trigger。
- 队列可以用 Cloudflare Queues。
- 存储可以继续外接 Postgres，或评估 D1/Hyperdrive。
- Discord 常规群消息仍需要 gateway websocket；Cloudflare Durable Objects 的 hibernation 只适用于 DO 作为 websocket server，不适用于 outgoing websocket client。把 Discord gateway 放在 Cloudflare 主链路里不合适。

如果你不想部署服务器，又想最少改代码，先用 Railway。若要 Cloudflare-first，就要优先改成飞书 HTTP callback；Discord 另放一个很小的 gateway relay。

## Railway 方案

1. 在 Railway 新建 Project，选择 GitHub repo。
2. Service 连接 `main` 分支。
3. Node 版本使用 `>=22.19.0`。项目的 `package.json` 已声明 engines。
4. Start Command 设置为：

```bash
npm run start
```

5. 变量按 Production 配齐，至少包括：

```bash
DATABASE_URL=postgres://...
ALLOWED_GROUP_REFS=your-group-ref

# 优先推荐：OpenAI-compatible endpoint（OpenAI / OpenRouter proxy / LiteLLM / 自建网关）
LLM_PROVIDER=openai-compatible
LLM_MODEL_ID=gpt-4o-mini
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=...

# 如果你的兼容网关不支持 OpenAI 新字段，再按需关闭：
# LLM_COMPAT_SUPPORTS_STORE=0
# LLM_COMPAT_SUPPORTS_DEVELOPER_ROLE=0
# LLM_COMPAT_SUPPORTS_REASONING_EFFORT=0
# LLM_COMPAT_MAX_TOKENS_FIELD=max_tokens

# 二选一或都配
DISCORD_BOT_TOKEN=...
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...

TZ=Asia/Shanghai
TICK_MS=60000
ENABLE_WEBFETCH=0
LINK_FETCH_ALLOWED_HOSTS=github.com,raw.githubusercontent.com,docs.github.com
```

6. 打开 GitHub Autodeploys，并开启 Wait for CI。Railway 会在目标分支 push 后部署；开启 Wait for CI 后，CI 失败会跳过部署。

## LLM Provider

生产优先用 `LLM_PROVIDER=openai-compatible`。这不是绑定某一家厂商，而是要求模型服务实现 OpenAI Chat Completions 兼容接口：

```bash
LLM_PROVIDER=openai-compatible
LLM_MODEL_ID=gpt-4o-mini
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=...
```

如果用 LiteLLM、OpenRouter 自建网关、vLLM、Ollama 或其他兼容端点，把 `LLM_BASE_URL` 指向对应 `/v1` endpoint。兼容性不完整时，先关掉 provider 不支持的字段：

```bash
LLM_COMPAT_SUPPORTS_STORE=0
LLM_COMPAT_SUPPORTS_DEVELOPER_ROLE=0
LLM_COMPAT_SUPPORTS_REASONING_EFFORT=0
LLM_COMPAT_MAX_TOKENS_FIELD=max_tokens
```

`TOOL_RUNNER_*` 默认继承 `LLM_*`。只有 review/search/fetch agent 想用另一个模型时才单独配置：

```bash
TOOL_RUNNER_MODEL_PROVIDER=openai-compatible
TOOL_RUNNER_MODEL_ID=gpt-4o-mini
TOOL_RUNNER_BASE_URL=https://api.openai.com/v1
TOOL_RUNNER_API_KEY=...
```

## Railway 长连接要求

Railway 这边不是 blocker；真正要盯的是我们自己的连接恢复能力：

- Discord adapter 依赖 `discord.js` gateway，生产要监听 ready/error/shardDisconnect/reconnecting 这类事件并打日志。
- 飞书 `WSClient` 需要确认 SDK 自带重连；如果没有足够日志，补一层连接状态日志和进程级 restart。
- 进程收到 SIGTERM 时要停 scheduler、断开 channel，避免滚动部署时半处理。
- Store 必须用 Postgres；重启后靠 `nextCheckAt` 恢复调度，不能依赖内存。
- Railway 服务不需要 public domain，除非后面加 `/health` 或改飞书 HTTP callback。

Hermes 的可用性给我们的判断是：Railway 上跑这类消息 bot 的基础链路成立。我们需要补的是工程化的重连、日志和退出处理，不是换平台。

## Link Fetch 策略

生产默认建议 `ENABLE_WEBFETCH=0`。要启用公开链接查证时，先只开放可信 host：

```bash
ENABLE_WEBFETCH=1
LINK_FETCH_ALLOWED_HOSTS=github.com,raw.githubusercontent.com,docs.github.com
LINK_FETCH_TIMEOUT_MS=5000
LINK_FETCH_MAX_BYTES=200000
LINK_FETCH_MAX_REDIRECTS=3
LINK_FETCH_ALLOWED_CONTENT_TYPES=text/html,text/plain,application/json,text/markdown
```

未知域名不会抓取，`LinkVerifier` 会记录 `inconclusive`。这不是 fallback，而是安全策略：不把用户链接直接变成服务端任意出站请求。

## Pre-deploy

Railway 的 pre-deploy command 在 build 之后、应用上线前执行；失败会阻止部署继续。当前项目还没有数据库迁移命令，所以先不要配置 pre-deploy。

以后如果加 Drizzle migration，建议只放短时间、可重复执行、失败即停的命令，例如：

```bash
npm run db:migrate
```

不要在 pre-deploy 里依赖应用已启动，也不要写本地文件作为持久化状态。

## Healthcheck

当前不要配置 healthcheck path，因为服务不监听 `PORT`。Railway 的 healthcheck 需要 endpoint 返回 HTTP 200，且 Railway 会使用注入的 `PORT` 做检查。

如果后面加健康端口，需要：

1. 应用监听 `process.env.PORT`。
2. 提供 `/health`，ready 后返回 200。
3. Railway Service Settings 里配置 healthcheck path 为 `/health`。

## 生产检查

- `ALLOWED_GROUP_REFS` 必须非空，防止 bot 响应错误群。
- `DATABASE_URL` 必须是 postgres，真实 channel 不能用内存 store。
- `ENABLE_WEBFETCH` 只有在 allowlist 和大小限制确认后再打开。
- Railway 部署日志里应看到 `commitment-agent up`。
- 修改 `main` 前先保证 `npm run typecheck`、`npm test`、`npm run check` 通过。

## Cloudflare 方案草案

Cloudflare 不建议直接跑当前代码。要上 Cloudflare，先把 app 拆成 HTTP/queue 模式：

1. `ChannelAdapter` 增加 webhook 型实现：`FeishuHttpChannel`。
2. `Router` 做成 Worker 的 `fetch(request)` handler 调用。
3. `Scheduler` 改成 Cron Trigger 触发一次性 tick，而不是进程内 `setInterval`。
4. 出站消息继续调用飞书 REST API。
5. Evidence/link fetch 继续走 `SafeLinkFetcher`，并保持 allowlist。
6. Discord 如果仍要支持，需要独立 gateway worker/service；不要放进 Cloudflare Worker 主链路。

这个方向更 serverless，但改动比 Railway 大。当前阶段先用 Railway 验证产品闭环更实际。
