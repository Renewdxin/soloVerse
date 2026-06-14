# Web 收发站 —— 演示视频用的交互沙盒（design）

> 状态：已批准（2026-06-15 brainstorm）。配套：`demo/`（终端版）、[CLAUDE.md](../../CLAUDE.md)。
> 主要产出是**演示视频**（给领导看）；UI 走「极简高级」（Linear/Apple 风）。

## 目标 / 非目标

**目标**
- 一个网页版「收发站」：左边在群里收发消息，右边实时台账 + 快进时间。
- **剧场模式**：一键 ▶ 自动演那 7 幕（电影节奏），按下录屏即得演示视频。
- 全程跑**真实 core**（与 `demo/` 同一个大脑），零配置离线可开。

**非目标（YAGNI）**
- 不做登录 / 数据库 / 多会话 / 持久化 / 真飞书 / 真协作端。**不是「新飞书」**——是沙盒 + 演示台。
- 真模型 / 真库不在本期；留 `DEMO_LLM=real` 开关以后用。

## 决策（来自 brainstorm）

| 项 | 选择 |
| --- | --- |
| 定位 | 互动收发台（沙盒 / 演示），主用于录视频 |
| 后端 | 离线自带：真实 core + 脚本化 LLM + 内存库 |
| 布局 | 双栏：左群聊收发，右台账 + 快进 + digest |
| 视觉 | 极简高级（Linear/Apple）：净色、留白、考究字体、克制微动效 |
| 栈 | 原生 JS + 重 CSS，零构建；Node 自带 `http` 起服务，零新依赖 |

## 架构：一个大脑，两张脸

`demo/harness.ts` 现在直接往终端打印（`ui.butler` 等）。重构成**发结构化事件**，终端与网页消费同一份事件：

```
            ┌─ demo/run.ts  → demo/ui.ts（终端）
Brain ──事件─┤
（真实 core） └─ demo/web/server.ts → 浏览器（网页）
```

- 抽出 `DemoEvent`（`group_msg` / `bot_msg` / `silence` / `commitment_upserted` / `digest` / `clock` / `scene` …）。
- harness 的 `send` / `sendDirect` 由「打印」改为「push 事件到 sink」；终端版接一个把事件转 `ui.*` 的 sink，行为不变（既有 demo 输出不回归）。
- 网页层**不含业务逻辑**，只把事件渲染成 UI。

## 后端 `demo/web/server.ts`（Node `http`，零新依赖，`tsx` 跑）

单内存会话（一个 `Brain` + 事件日志 + 快照状态）。

- `GET /` → 静态页；静态资源从 `demo/web/` 读。
- `GET /api/state` → `{ clock, messages[], commitments[], digest?, scene? }`
- `POST /api/say {as, text}` → `router.handle(inbound)` → 新状态
- `POST /api/advance {to:"+1d"|"due"|"sat"}` → 拨 `DemoClock` + `commitmentJob.runDue` → 新状态
- `POST /api/world {commitmentId, set:"progressed"|"completed"|"merged"|"no_change"}` → 设模拟外部状态（演「自己核实→结案」）
- `POST /api/digest {personId}` → `pushPersonDigest`
- `POST /api/play` → 返回剧场脚本（前端按节奏逐步调上面这些接口；脚本即 `demo/run.ts` 那 7 幕的数据化版本）
- `POST /api/reset {seed?}` → 重开，可预置王芳/李四/张伟 + 支付回调#57

> 实时：每个动作的响应直接带回最新状态，前端重渲染。不上 WebSocket（够用、零依赖）。

## 前端 `demo/web/index.html` + `app.js` + `app.css`（原生，无构建）

**双栏**
- 左「群聊 #core-dev」：消息流（真人 / 管家 / 灰色"沉默 + 理由"）；底部发言人下拉（李四/张伟/王芳/自定义）+ 几个快捷句 + 发送。
- 右「台账」：承诺卡片（标题/责任人/due/状态/最近证据）；每条一个"外部状态"小开关；顶部时间条（当前时钟 + ⏩+1天 / ⏩到 due / ⏩到周六）；「看某人 digest」。

**剧场模式**：顶部 ▶ 播放 / ⏸ / ⏭。按脚本逐幕：场景标题卡淡入 → 消息逐条带打字效果 → 台账/时钟平滑更新 → 第 7 幕品味 PASS/✗FAIL 用对比特写。给录屏用。

## 视觉：极简高级

- 深色为主、单一强调色、克制；大留白；考究字体（系统 UI / Inter 类）；细边框 + 轻阴影做层次。
- 动效：淡入 + 轻位移 + 弹性缓动；台账重排用 FLIP；时钟数字滚动。**只增可读性，不喧宾夺主。**
- **铁律**：炫的是外壳和动效，**管家说的话仍然克制**（不加表情堆叠、不变话痨）。反差才高级。见 [[taste-plain-not-performative]]。

## 测试

- 大脑已有 109 测试，事件重构后须保持终端 demo 输出不变（跑一遍 `npm run demo` 对照）。
- 补 server handler 测试：say→台账出现；advance→催办/沉默；world=merged→结案；digest→有内容。
- 前端薄壳，手测 + 截图核对。

## 实现计划（phases）

1. **事件层**：定义 `DemoEvent`；harness 改为发事件 + 一个 terminal sink；`run.ts` 接 sink，`npm run demo` 输出不回归。
2. **后端**：`demo/web/server.ts`（http + 路由 + 会话 + state 快照）；`npm run demo:web`。
3. **前端骨架**：双栏布局 + 收发 + 台账 + 快进，能手动跑通闭环。
4. **剧场模式**：`/api/play` 脚本 + 前端播放器 + 打字/标题卡/品味特写。
5. **视觉打磨**：极简高级主题 + 动效；用浏览器实测截图迭代。
6. **测试 + 文档**：server 测试；`demo/README.md` 加 web 段落。
