import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../src/adapters/store/memory";
import type { Commitment } from "../../src/core/domain/types";
import type { Evaluator } from "../../src/core/pipeline/evaluator";
import { CommitmentJob } from "../../src/core/scheduler/commitmentJob";

const NOW = new Date("2026-06-01T10:00:00.000Z");

function commitment(id: string): Commitment {
  return {
    id,
    groupRef: "g1",
    assignee: "p",
    title: id,
    rawText: id,
    source: { channel: "discord", messageRef: id, at: NOW },
    status: "active",
    dueAt: null,
    verification: { kind: "none" },
    confidence: 1,
    tags: [],
    createdAt: NOW,
    confirmedAt: NOW,
    nextCheckAt: NOW,
  };
}

describe("CommitmentJob", () => {
  it("评估所有到期承诺，并隔离单条失败", async () => {
    const store = new InMemoryStore();
    await store.commitments.put(commitment("ok"));
    await store.commitments.put(commitment("bad"));
    const evaluated: string[] = [];
    const errors: string[] = [];
    const evaluator = {
      evaluate: async (c: Commitment) => {
        evaluated.push(c.id);
        if (c.id === "bad") throw new Error("boom");
      },
    } as Evaluator;

    const job = new CommitmentJob({
      store,
      evaluator,
      onError: (_error, context) => errors.push(context),
    });
    await job.runDue(NOW);

    expect(evaluated).toEqual(["ok", "bad"]);
    expect(errors).toEqual(["evaluate bad"]);
  });
});
