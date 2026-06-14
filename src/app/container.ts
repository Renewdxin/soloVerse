// 手动 DI / 组合根：把 adapter 接到 port 上，串好捕获闭环。
// core 不出现在这里以外的地方依赖 adapter。
import { DiscordChannel } from "../adapters/channels/discord";
import { FeishuChannel } from "../adapters/channels/feishu";
import { SystemClock } from "../adapters/clock";
import { PiLlm } from "../adapters/llm/pi";
import { PiToolRunner } from "../adapters/llm/toolRunner";
import { InMemoryStore } from "../adapters/store/memory";
import { createPgStore } from "../adapters/store/pg";
import { GithubVerifier } from "../adapters/verifiers/github";
import { LinkVerifier } from "../adapters/verifiers/link";
import { ManualVerifier } from "../adapters/verifiers/manual";
import { SafeLinkFetcher } from "../adapters/verifiers/safeLinkFetcher";
import { GroupPolicy } from "../core/groupPolicy";
import { newId } from "../core/ids";
import { OperatorConsole } from "../core/operatorConsole";
import { DigestAssembler, renderDigestText } from "../core/pipeline/digestAssembler";
import { Evaluator } from "../core/pipeline/evaluator";
import { Extractor } from "../core/pipeline/extractor";
import { InterventionPolicy } from "../core/pipeline/interventionPolicy";
import { Router } from "../core/pipeline/router";
import type {
  ChannelAdapter,
  Clock,
  LlmPort,
  OutboundDirectMessage,
  OutboundMessage,
  Store,
  ToolRunner,
  VerifierAdapter,
} from "../core/ports";
import { CommitmentJob } from "../core/scheduler/commitmentJob";
import { DigestJob } from "../core/scheduler/digestJob";
import type { Job } from "../core/scheduler/job";
import { Scheduler } from "../core/scheduler/scheduler";
import type { Config } from "./config";

export interface Container {
  clock: Clock;
  store: Store;
  channels: ChannelAdapter[];
  verifiers: VerifierAdapter[];
  llm: LlmPort;
  toolRunner: ToolRunner;
  groupPolicy: GroupPolicy;
  /** 群上岗审批 / operator 私聊控制（开启 / 只读 / 忽略 / 列表）。 */
  operatorConsole: OperatorConsole;
  digestAssembler: DigestAssembler;
  router: Router;
  evaluator: Evaluator;
  scheduler: Scheduler;
  /** 私聊把某人的今日 todo 推给他（卡片优先、文本兜底）；没 DM 渠道 / 没事可报则不发，返回 null。 */
  pushPersonDigest: (personId: string) => Promise<{ dispatchRef: string } | null>;
  /** 优雅停机：停调度器、关 PG 连接池（重部署 SIGTERM 时调用，避免连接泄漏）。 */
  shutdown: () => Promise<void>;
}

/** 只装配凭据已配置的频道；其余里程碑的实现（verifier/llm 决策等）仍为骨架。 */
export function buildContainer(config: Config): Container {
  const clock = new SystemClock();
  // DATABASE_URL 指向 Supabase/Neon 的 Postgres → PgStore；否则内存（测试 / 无凭据冒烟）。
  // close 留着给 shutdown 用，别丢——否则每次重部署都泄漏一个连接池。
  let closeStore: () => Promise<void> = async () => {};
  let store: Store;
  if (config.databaseUrl.startsWith("postgres")) {
    const pg = createPgStore(config.databaseUrl);
    store = pg.store;
    closeStore = pg.close;
  } else {
    store = new InMemoryStore();
  }
  const llm = new PiLlm(config.llm);
  const toolRunner = new PiToolRunner(config.toolRunner);
  const linkFetcher = new SafeLinkFetcher({
    enabled: config.features.webfetch,
    ...config.linkFetch,
  });
  const verifiers = [
    new LinkVerifier({ fetcher: linkFetcher, llm, clock, newId }),
    new GithubVerifier(),
    new ManualVerifier(),
  ];

  const channels: ChannelAdapter[] = [];
  if (config.discord.botToken.length > 0)
    channels.push(new DiscordChannel(config.discord.botToken));
  if (config.feishu.appId.length > 0) {
    channels.push(new FeishuChannel(config.feishu.appId, config.feishu.appSecret));
  }

  const groupPolicy = new GroupPolicy(config.groups);
  const byKind = new Map(channels.map((c) => [c.kind, c] as const));
  const send = async (out: OutboundMessage): Promise<{ dispatchRef: string }> => {
    // 结构性硬门：只读 / off 群不允许发言（正常路径不会走到这，这是兜底墙）。
    if (!groupPolicy.canPost(out.groupRef)) {
      throw new Error(`群 ${out.groupRef} 不可发言（mode=${groupPolicy.mode(out.groupRef)}）`);
    }
    const ch = byKind.get(out.channel);
    if (ch === undefined) throw new Error(`未配置频道 ${out.channel}`);
    return ch.send(out);
  };

  const sendDirect = async (out: OutboundDirectMessage): Promise<{ dispatchRef: string }> => {
    const ch = byKind.get(out.channel);
    if (ch === undefined) throw new Error(`未配置频道 ${out.channel}`);
    if (!ch.canDirectMessage) throw new Error(`频道 ${out.channel} 不支持私聊`);
    return ch.sendDirect(out);
  };

  const extractor = new Extractor(llm, clock, {
    timezone: config.timezone,
    knownRepos: [],
    minConfidence: 0.6,
    newId,
  });
  const digestAssembler = new DigestAssembler({ store, timezone: config.timezone });
  const pushPersonDigest = async (personId: string): Promise<{ dispatchRef: string } | null> => {
    const person = await store.people.get(personId);
    // 选一个支持私聊的 handle（飞书）；没有就推不了。
    const handle = person?.handles.find((h) => byKind.get(h.channel)?.canDirectMessage === true);
    if (handle === undefined) return null;
    const digest = await digestAssembler.forPerson(personId, clock.now());
    if (digest.sections.length === 0) return null; // 没事可报，不打扰
    return sendDirect({
      channel: handle.channel,
      userRef: handle.userRef,
      text: renderDigestText(digest),
      digest,
    });
  };
  const router = new Router({ store, extractor, groupPolicy, clock, send, newId });
  const operatorConsole = new OperatorConsole({
    store,
    groupPolicy,
    clock,
    sendDirect,
    operator: { channel: "feishu", userRef: config.operator.feishuOpenId },
  });
  const policy = new InterventionPolicy(llm);
  const evaluator = new Evaluator({
    store,
    verifiers: new Map(verifiers.map((v) => [v.kind, v] as const)),
    policy,
    clock,
    config: {
      timezone: config.timezone,
      quietHours: config.quietHours,
      maxRemindersPerDay: config.maxRemindersPerDay,
    },
    send,
    newId,
  });
  const onSchedulerError = (error: unknown, context: string): void =>
    console.error(`[commitment-agent] scheduler ${context}`, error);
  const jobs: Job[] = [
    new CommitmentJob({ store, evaluator, onError: onSchedulerError }),
    new DigestJob({
      store,
      push: pushPersonDigest,
      defaultTimezone: config.timezone,
      defaultTime: config.digest.defaultTime,
      onError: onSchedulerError,
    }),
  ];
  const scheduler = new Scheduler({
    jobs,
    clock,
    tickMs: config.tickMs,
    onError: onSchedulerError,
  });

  const shutdown = async (): Promise<void> => {
    scheduler.stop();
    await closeStore();
  };

  return {
    clock,
    store,
    channels,
    verifiers,
    llm,
    toolRunner,
    groupPolicy,
    operatorConsole,
    digestAssembler,
    router,
    evaluator,
    scheduler,
    pushPersonDigest,
    shutdown,
  };
}
