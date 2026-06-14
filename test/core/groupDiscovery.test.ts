import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../src/adapters/store/memory";
import { recordGroup } from "../../src/core/groupDiscovery";
import type { InboundMessage } from "../../src/core/ports";

const NOW = new Date("2026-06-05T00:00:00Z");

function msg(over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: "feishu",
    groupRef: "oc_1",
    chatType: "group",
    authorRef: "u1",
    text: "hi",
    replyToRef: null,
    messageRef: "m1",
    at: NOW,
    raw: null,
    ...over,
  };
}

describe("recordGroup", () => {
  it("第一次见到群就记下来（默认只读上岗 + 返回新群供上岗私聊）", async () => {
    const store = new InMemoryStore();
    const created = await recordGroup(store, msg());
    expect(created).toMatchObject({ id: "oc_1", mode: "read", promptedAt: null });
    const groups = await store.groups.all();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: "oc_1",
      channel: "feishu",
      name: null,
      firstSeenAt: NOW,
      mode: "read",
    });
  });

  it("已记过的群返回 null（不重复上岗私聊）", async () => {
    const store = new InMemoryStore();
    await recordGroup(store, msg());
    expect(await recordGroup(store, msg())).toBeNull();
  });

  it("已记过的群不覆盖（保留 firstSeenAt）", async () => {
    const store = new InMemoryStore();
    await recordGroup(store, msg());
    await recordGroup(store, msg({ at: new Date("2026-06-06T00:00:00Z") }));
    const groups = await store.groups.all();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.firstSeenAt).toEqual(NOW);
  });

  it("私聊（p2p）不当群记录", async () => {
    const store = new InMemoryStore();
    await recordGroup(store, msg({ chatType: "p2p", groupRef: "p2p_x" }));
    expect(await store.groups.all()).toHaveLength(0);
  });
});
