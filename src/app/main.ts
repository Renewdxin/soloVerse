import { ensurePgSchema } from "../adapters/store/pg";
import { recordGroup } from "../core/groupDiscovery";
import type { GroupMode, GroupPolicy } from "../core/groupPolicy";
import type { Store } from "../core/ports";
import { loadConfig } from "./config";
import { buildContainer } from "./container";

// 启动：装配容器，启动已配置的频道，把入站消息喂给 Router（捕获闭环）。
// 未配置任何频道时也能起（只是不监听），方便无凭据冒烟。
// M2+：Scheduler → Evaluator → Verifier/ToolRunner → Intervention（见 docs/plan.md）。
async function main(): Promise<void> {
  const config = loadConfig();
  // 启动即幂等建表（Postgres）；内存 Store 跳过。
  if (config.databaseUrl.startsWith("postgres")) {
    await ensurePgSchema(config.databaseUrl);
    console.log("[commitment-agent] pg schema ensured");
  }
  const container = buildContainer(config);
  // 群权限：DB 是运行时真相，env(GROUPS_READ_WRITE/READ_ONLY) 只是首次种子。对齐进内存 policy。
  await reconcileGroups(
    container.store,
    container.groupPolicy,
    config.groups,
    container.clock.now(),
  );

  const operatorRef = config.operator.feishuOpenId;
  // 给 operator 的私聊失败（最常见：operator 还没和 bot 开过会话 → 飞书 230013）只记一条可操作的日志，
  // 绝不冒泡成异常去打断消息处理（上岗私聊失败不该吞掉群里的承诺捕获）。
  const logDmFailure = (err: unknown): void =>
    console.error(
      "[commitment-agent] 给 operator 的私聊失败——operator 是否已和 bot 开过会话？（飞书 230013）",
      err instanceof Error ? err.message : err,
    );
  for (const channel of container.channels) {
    await channel.start(async (msg) => {
      // 私聊：operator 的控制命令走控制台；别人的私聊只记一行（方便你抄自己的 open_id 去配 operator）。
      if (msg.chatType === "p2p") {
        if (operatorRef.length > 0 && msg.authorRef === operatorRef) {
          await container.operatorConsole.handleDm(msg.text).catch(logDmFailure);
        } else {
          console.log(
            `[feishu] 收到私聊 from ${msg.authorRef}（若这是你，设 OPERATOR_FEISHU_OPEN_ID=${msg.authorRef} 即可控制管家）`,
          );
        }
        return;
      }
      // 群：先发现——新群默认只读上岗 + 私聊问主人要不要提权（不在新群里自报家门）。
      const newGroup = await recordGroup(container.store, msg);
      if (newGroup !== null) {
        container.groupPolicy.setMode(newGroup.id, newGroup.mode);
        await container.operatorConsole.offerNewGroup(newGroup).catch(logDmFailure);
      }
      // off 群：不读不存，直接丢；read/readwrite 交给 Router（read 群 Router 只落上下文不发言）。
      if (!container.groupPolicy.canRead(msg.groupRef)) return;
      await container.router.handle(msg);
    });
  }
  await container.scheduler.start();

  // 优雅停机：重部署 / Ctrl-C 时停调度、关 PG 连接池，别泄漏连接、别让 in-flight 查询挂着。
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[commitment-agent] ${signal} 收到，正在优雅停机…`);
    try {
      await container.shutdown();
    } catch (err) {
      console.error("[commitment-agent] 停机出错", err);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  const listening = container.channels.map((c) => c.kind).join("+") || "(无频道，仅冒烟)";
  console.log(
    `[commitment-agent] up · listening=${listening} · tz=${config.timezone} · tick=${config.tickMs}ms`,
  );
}

/**
 * 对齐群权限：env 种子里 DB 还没有的群先落库（视为已授权、已问过，不再打扰），
 * 然后用 DB 的权限覆盖内存 policy（DB 是运行时真相，优先于 env 种子）。
 */
async function reconcileGroups(
  store: Store,
  groupPolicy: GroupPolicy,
  seed: { readWrite: string[]; readOnly: string[] },
  now: Date,
): Promise<void> {
  const seeds: { id: string; mode: GroupMode }[] = [
    ...seed.readWrite.map((id) => ({ id, mode: "readwrite" as const })),
    ...seed.readOnly.map((id) => ({ id, mode: "read" as const })),
  ];
  for (const s of seeds) {
    if ((await store.groups.get(s.id)) === null) {
      await store.groups.put({
        id: s.id,
        channel: "feishu",
        name: null,
        firstSeenAt: now,
        mode: s.mode,
        promptedAt: now,
      });
    }
  }
  groupPolicy.load(await store.groups.all());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
