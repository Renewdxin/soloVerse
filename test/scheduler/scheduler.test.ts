import { describe, expect, it } from "vitest";
import type { Job } from "../../src/core/scheduler/job";
import { Scheduler } from "../../src/core/scheduler/scheduler";

const NOW = new Date("2026-06-01T10:00:00.000Z");

describe("Scheduler", () => {
  it("每 tick 依次跑各 job，单个 job 失败隔离、不阻断其余", async () => {
    const ran: string[] = [];
    const errors: string[] = [];
    const job = (name: string, fail = false): Job => ({
      name,
      runDue: async () => {
        if (fail) throw new Error("boom");
        ran.push(name);
      },
    });
    const scheduler = new Scheduler({
      jobs: [job("a"), job("bad", true), job("c")],
      clock: { now: () => NOW },
      tickMs: 60_000,
      onError: (_error, context) => errors.push(context),
    });

    await scheduler.tickOnce();

    expect(ran).toEqual(["a", "c"]);
    expect(errors).toEqual(["job bad"]);
  });
});
