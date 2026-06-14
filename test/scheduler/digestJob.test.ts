import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../src/adapters/store/memory";
import type { Person } from "../../src/core/domain/types";
import { DigestJob } from "../../src/core/scheduler/digestJob";

const NOW = new Date("2026-06-02T04:00:00Z"); // Asia/Shanghai 12:00, 即 2026-06-02

function person(over: Partial<Person>): Person {
  return {
    id: "p1",
    displayName: "p1",
    handles: [{ channel: "feishu", userRef: "o1" }],
    isOperator: false,
    ...over,
  };
}

function jobWith(
  store: InMemoryStore,
  push: (id: string) => Promise<{ dispatchRef: string } | null>,
  errors: string[] = [],
) {
  return new DigestJob({
    store,
    push,
    defaultTimezone: "Asia/Shanghai",
    defaultTime: "10:30",
    onError: (_e, ctx) => errors.push(ctx),
  });
}

describe("DigestJob", () => {
  it("过了发送时间、今天没发过 → push + 记 lastDigestAt", async () => {
    const store = new InMemoryStore();
    await store.people.put(person({}));
    const pushed: string[] = [];
    await jobWith(store, async (id) => {
      pushed.push(id);
      return { dispatchRef: "d" };
    }).runDue(NOW);

    expect(pushed).toEqual(["p1"]);
    expect((await store.people.get("p1"))?.lastDigestAt).toEqual(NOW);
  });

  it("还没到发送时间 → 不发", async () => {
    const store = new InMemoryStore();
    await store.people.put(person({ digestPref: { localTime: "22:00" } })); // 现在本地 12:00 < 22:00
    const pushed: string[] = [];
    await jobWith(store, async (id) => {
      pushed.push(id);
      return { dispatchRef: "d" };
    }).runDue(NOW);

    expect(pushed).toEqual([]);
  });

  it("今天已发过 → 不重发", async () => {
    const store = new InMemoryStore();
    await store.people.put(person({ lastDigestAt: new Date("2026-06-02T03:00:00Z") })); // 本地今天 11:00
    const pushed: string[] = [];
    await jobWith(store, async (id) => {
      pushed.push(id);
      return { dispatchRef: "d" };
    }).runDue(NOW);

    expect(pushed).toEqual([]);
  });

  it("单人失败隔离，其余照常", async () => {
    const store = new InMemoryStore();
    await store.people.put(person({ id: "p1" }));
    await store.people.put(person({ id: "p2" }));
    const errors: string[] = [];
    await jobWith(
      store,
      async (id) => {
        if (id === "p1") throw new Error("boom");
        return { dispatchRef: "d" };
      },
      errors,
    ).runDue(NOW);

    expect(errors).toEqual(["digest p1"]);
    expect((await store.people.get("p1"))?.lastDigestAt).toBeUndefined(); // 失败没记
    expect((await store.people.get("p2"))?.lastDigestAt).toEqual(NOW);
  });
});
