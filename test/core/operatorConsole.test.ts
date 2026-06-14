import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../src/adapters/store/memory";
import type { Group } from "../../src/core/domain/types";
import { GroupPolicy } from "../../src/core/groupPolicy";
import { OperatorConsole } from "../../src/core/operatorConsole";
import type { Clock, OutboundDirectMessage } from "../../src/core/ports";

const NOW = new Date("2026-06-06T03:00:00Z");
const clock: Clock = { now: () => NOW };

function group(over: Partial<Group> = {}): Group {
  return {
    id: "oc_1",
    channel: "feishu",
    name: null,
    firstSeenAt: NOW,
    mode: "read",
    promptedAt: null,
    ...over,
  };
}

function setup() {
  const store = new InMemoryStore();
  const groupPolicy = new GroupPolicy();
  const dms: OutboundDirectMessage[] = [];
  const console = new OperatorConsole({
    store,
    groupPolicy,
    clock,
    sendDirect: async (out) => {
      dms.push(out);
      return { dispatchRef: "d" };
    },
    operator: { channel: "feishu", userRef: "ou_op" },
  });
  return { store, groupPolicy, dms, console };
}

describe("OperatorConsole", () => {
  it("新群上岗：私聊主人提议提权，并标记 promptedAt（不再重复问）", async () => {
    const { store, dms, console } = setup();
    const g = group();
    await store.groups.put(g);

    await console.offerNewGroup(g);
    expect(dms).toHaveLength(1);
    expect(dms[0]?.userRef).toBe("ou_op");
    expect(dms[0]?.text).toContain("只读待命");
    expect((await store.groups.get("oc_1"))?.promptedAt).toEqual(NOW);

    // 已问过的群不再打扰
    await console.offerNewGroup(await store.groups.get("oc_1").then((x) => x as Group));
    expect(dms).toHaveLength(1);
  });

  it("回「开启」→ 把最近问过的只读群提权为可发言（DB + policy 一起改）", async () => {
    const { store, groupPolicy, console } = setup();
    await store.groups.put(group({ promptedAt: NOW }));
    groupPolicy.setMode("oc_1", "read");

    await console.handleDm("开启");

    expect((await store.groups.get("oc_1"))?.mode).toBe("readwrite");
    expect(groupPolicy.canPost("oc_1")).toBe(true);
  });

  it("回「忽略」→ 群设为 off（不读不存）", async () => {
    const { store, groupPolicy, console } = setup();
    await store.groups.put(group({ promptedAt: NOW }));
    groupPolicy.setMode("oc_1", "read");

    await console.handleDm("忽略");

    expect((await store.groups.get("oc_1"))?.mode).toBe("off");
    expect(groupPolicy.canRead("oc_1")).toBe(false);
  });

  it("带 chat_id 的命令精确命中那个群", async () => {
    const { store, groupPolicy, console } = setup();
    await store.groups.put(group({ id: "oc_a", promptedAt: new Date("2026-06-06T01:00:00Z") }));
    await store.groups.put(group({ id: "oc_b", promptedAt: new Date("2026-06-06T02:00:00Z") }));
    groupPolicy.setMode("oc_a", "read");
    groupPolicy.setMode("oc_b", "read");

    await console.handleDm("开启 oc_a");

    expect((await store.groups.get("oc_a"))?.mode).toBe("readwrite");
    expect((await store.groups.get("oc_b"))?.mode).toBe("read"); // 没动
  });

  it("闲聊（非命令）不回、不改任何群", async () => {
    const { store, dms, console } = setup();
    await store.groups.put(group({ promptedAt: NOW }));

    await console.handleDm("今天天气不错");

    expect(dms).toHaveLength(0);
    expect((await store.groups.get("oc_1"))?.mode).toBe("read");
  });

  it("「列表」列出所有群及权限", async () => {
    const { store, dms, console } = setup();
    await store.groups.put(group({ id: "oc_1", mode: "readwrite" }));
    await store.groups.put(group({ id: "oc_2", mode: "read" }));

    await console.handleDm("列表");

    expect(dms).toHaveLength(1);
    expect(dms[0]?.text).toContain("oc_1");
    expect(dms[0]?.text).toContain("oc_2");
  });
});
