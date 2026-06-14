import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../src/adapters/store/memory";
import { GroupPolicy } from "../../src/core/groupPolicy";
import { Extractor } from "../../src/core/pipeline/extractor";
import { Router } from "../../src/core/pipeline/router";
import type {
  Clock,
  ExtractionOutput,
  InboundMessage,
  LlmPort,
  OutboundMessage,
} from "../../src/core/ports";

const NOW = new Date("2026-06-01T00:00:00Z");
const clock: Clock = { now: () => NOW };

function fakeLlm(out: ExtractionOutput): LlmPort {
  return {
    extractCommitment: async () => out,
    verifyLink: async () => {
      throw new Error("unused");
    },
    decideIntervention: async () => {
      throw new Error("unused");
    },
  };
}

function msg(text: string): InboundMessage {
  return {
    channel: "discord",
    groupRef: "g1",
    authorRef: "u-li",
    text,
    replyToRef: null,
    messageRef: "m",
    at: NOW,
    raw: null,
  };
}

function setup(
  out: ExtractionOutput,
  groupPolicy = new GroupPolicy({ readWrite: ["g1"], readOnly: [] }),
  sendImpl?: (o: OutboundMessage) => Promise<{ dispatchRef: string }>,
) {
  let n = 0;
  const newId = () => `id-${++n}`;
  const store = new InMemoryStore();
  const sent: OutboundMessage[] = [];
  const extractor = new Extractor(fakeLlm(out), clock, {
    timezone: "Asia/Shanghai",
    knownRepos: [],
    minConfidence: 0.6,
    newId,
  });
  const router = new Router({
    store,
    extractor,
    groupPolicy,
    clock,
    timezone: "Asia/Shanghai",
    newId,
    send:
      sendImpl ??
      (async (o) => {
        sent.push(o);
        return { dispatchRef: "d" };
      }),
  });
  return { store, sent, router };
}

const COMMIT: ExtractionOutput = {
  isCommitment: true,
  confidence: 0.9,
  title: "修复登录 bug",
  dueAt: "2026-06-03T15:59:00Z",
};

describe("Router 捕获闭环", () => {
  it("说承诺 → 记一笔（proposed + @当事人）→ 回「对」→ active", async () => {
    const { store, sent, router } = setup(COMMIT);

    await router.handle(msg("周三前修复登录 bug"));
    let all = await store.commitments.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe("proposed");
    expect(sent.at(-1)?.text).toContain("记一笔");
    expect(sent.at(-1)?.mentions).toContain("u-li");

    await router.handle(msg("对"));
    all = await store.commitments.all();
    expect(all[0]?.status).toBe("active");
    expect(all[0]?.confirmedAt).not.toBeNull();
    expect(all[0]?.nextCheckAt).not.toBeNull();
    expect(sent.at(-1)?.text).toContain("跟上了");
    const interactions = await store.interactions.all();
    expect(interactions.map((i) => i.direction)).toEqual(["in", "out", "in", "out"]);
    expect(interactions.every((i) => i.commitmentId === all[0]?.id)).toBe(true);
  });

  it("回「不是」→ 丢弃，库里清空", async () => {
    const { store, router } = setup(COMMIT);
    await router.handle(msg("周三前修复登录 bug"));
    await router.handle(msg("不是"));
    expect(await store.commitments.all()).toHaveLength(0);
  });

  it("归因：自动建出说话人的 Person", async () => {
    const { store, router } = setup(COMMIT);
    await router.handle(msg("周三前修复登录 bug"));
    const people = await store.people.all();
    expect(people).toHaveLength(1);
    expect(people[0]?.handles[0]?.userRef).toBe("u-li");
  });

  it("非承诺消息也记 interaction，供后续去重判断是否已回复", async () => {
    const { store, router } = setup({ isCommitment: false, confidence: 0 });
    await router.handle(msg("收到，我晚点看"));
    const interactions = await store.interactions.all();
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({
      direction: "in",
      authorRef: "u-li",
      commitmentId: null,
    });
  });

  it("待确认期间回一句非「对/不是/改」→ 不重复抽取、不再发「记一笔」", async () => {
    const { store, sent, router } = setup(COMMIT);
    await router.handle(msg("周三前修复登录 bug"));
    expect(await store.commitments.all()).toHaveLength(1);
    expect(sent).toHaveLength(1);

    // 还有待确认时，发一句普通的话（既非「对」也非「不是」/「改」）
    await router.handle(msg("我尽量吧"));
    const all = await store.commitments.all();
    expect(all).toHaveLength(1); // 没有第二条 proposed
    expect(all[0]?.status).toBe("proposed");
    expect(sent).toHaveLength(1); // 没有第二次「记一笔」刷屏
    const inbound = (await store.interactions.all()).filter((i) => i.direction === "in");
    expect(inbound).toHaveLength(2); // 第二句仍记进上下文
  });

  it("确认消息发送失败 → 回滚刚存的 proposed，不留孤儿", async () => {
    const { store, router } = setup(COMMIT, undefined, async () => {
      throw new Error("feishu down");
    });
    await router.handle(msg("周三前修复登录 bug"));
    expect(await store.commitments.all()).toHaveLength(0); // 已回滚
  });

  it("只读群：只落上下文，不抽取承诺、不发言", async () => {
    const readOnly = new GroupPolicy({ readWrite: [], readOnly: ["g1"] });
    const { store, sent, router } = setup(COMMIT, readOnly);
    await router.handle(msg("周三前修复登录 bug"));
    expect(await store.commitments.all()).toHaveLength(0);
    expect(sent).toHaveLength(0);
    const interactions = await store.interactions.all();
    expect(interactions).toHaveLength(1);
    expect(interactions[0]?.commitmentId).toBeNull();
  });
});
