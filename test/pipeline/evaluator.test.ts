import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../src/adapters/store/memory";
import type { Commitment, Evidence, Person } from "../../src/core/domain/types";
import { Evaluator } from "../../src/core/pipeline/evaluator";
import { InterventionPolicy } from "../../src/core/pipeline/interventionPolicy";
import type {
  Clock,
  DecisionOutput,
  LlmPort,
  OutboundMessage,
  VerifierAdapter,
} from "../../src/core/ports";

const NOW = new Date("2026-06-01T10:00:00.000Z");
const H = 3_600_000;

const clock: Clock = { now: () => NOW };

function fakeLlm(decision: DecisionOutput): LlmPort {
  return {
    extractCommitment: async () => ({ isCommitment: false, confidence: 0 }),
    verifyLink: async () => ({ verdict: "inconclusive", summary: "unused", confidence: 0 }),
    decideIntervention: async () => decision,
  };
}

function commitment(over: Partial<Commitment> = {}): Commitment {
  return {
    id: "c1",
    groupRef: "g1",
    assignee: "p-li",
    title: "修复登录 bug",
    rawText: "周三前修复登录 bug",
    source: { channel: "discord", messageRef: "m1", at: NOW },
    status: "active",
    dueAt: new Date(NOW.getTime() + 3 * H),
    verification: { kind: "none" },
    confidence: 0.9,
    tags: [],
    createdAt: NOW,
    confirmedAt: NOW,
    nextCheckAt: NOW,
    ...over,
  };
}

function evidence(over: Partial<Evidence> = {}): Evidence {
  return {
    id: "e1",
    commitmentId: "c1",
    capturedAt: NOW,
    source: "github",
    verdict: "completed",
    summary: "PR merged",
    raw: null,
    ...over,
  };
}

async function setup(
  llmDecision: DecisionOutput,
  verifiers = new Map<VerifierAdapter["kind"], VerifierAdapter>(),
  sendImpl?: (out: OutboundMessage) => Promise<{ dispatchRef: string }>,
) {
  let n = 0;
  const store = new InMemoryStore();
  const sent: OutboundMessage[] = [];
  const person: Person = {
    id: "p-li",
    displayName: "小李",
    handles: [{ channel: "discord", userRef: "u-li" }],
    isOperator: false,
  };
  await store.people.put(person);
  const evaluator = new Evaluator({
    store,
    verifiers,
    policy: new InterventionPolicy(fakeLlm(llmDecision)),
    clock,
    config: { timezone: "Asia/Shanghai", quietHours: [23, 8], maxRemindersPerDay: 1 },
    send:
      sendImpl ??
      (async (out) => {
        sent.push(out);
        return { dispatchRef: "d1" };
      }),
    newId: () => `id-${++n}`,
  });
  return { store, sent, evaluator };
}

describe("Evaluator", () => {
  it("高可信 github completed 自动 fulfilled 并发完成消息", async () => {
    const { store, sent, evaluator } = await setup({ decision: "silent", reason: "unused" });
    await store.commitments.put(commitment());
    await store.evidence.put(evidence());

    await evaluator.evaluate(commitment());

    expect((await store.commitments.get("c1"))?.status).toBe("fulfilled");
    expect((await store.commitments.get("c1"))?.nextCheckAt).toBeNull();
    expect(sent[0]).toMatchObject({ groupRef: "g1", mentions: ["u-li"] });
    expect(sent[0]?.text).toContain("这条结了");
    expect((await store.interventions.all())[0]?.decision).toBe("celebrate");
  });

  it("弱来源 completed 不自动结案，交给 LLM 决策", async () => {
    const { store, sent, evaluator } = await setup({
      decision: "remind",
      message: "我看到链接像是有变化，你确认一下这条做完了吗？",
      reason: "弱信号不自动完成",
    });
    await store.commitments.put(commitment());
    await store.evidence.put(evidence({ source: "link", summary: "页面显示完成" }));

    await evaluator.evaluate(commitment());

    expect((await store.commitments.get("c1"))?.status).toBe("active");
    expect(sent[0]?.text).toContain("确认一下");
    expect((await store.interventions.all())[0]?.decision).toBe("remind");
  });

  it("逾期超过宽限窗直接 failed 并给改期出口", async () => {
    const { store, sent, evaluator } = await setup({ decision: "silent", reason: "unused" });
    const overdue = commitment({ dueAt: new Date(NOW.getTime() - 25 * H) });
    await store.commitments.put(overdue);

    await evaluator.evaluate(overdue);

    expect((await store.commitments.get("c1"))?.status).toBe("failed");
    expect(sent[0]?.text).toContain("改个新时间");
    expect((await store.interventions.all())[0]?.decision).toBe("suggest_renegotiate");
  });

  it("send 失败前已落 intervention：去重计数保住，下个 tick 不会重发", async () => {
    const { store, evaluator } = await setup(
      { decision: "remind", message: "进展如何？", reason: "临期" },
      undefined,
      async () => {
        throw new Error("feishu down");
      },
    );
    // 临期（<6h）→ 过护栏 → consult_llm → remind（带 message）
    const c = commitment({ dueAt: new Date(NOW.getTime() + 1 * H) });
    await store.commitments.put(c);

    await expect(evaluator.evaluate(c)).rejects.toThrow(/feishu down/);

    const ivs = await store.interventions.all();
    expect(ivs).toHaveLength(1); // send 失败前已记账
    expect(ivs[0]?.decision).toBe("remind"); // → remindersToday=1，下个 tick 被护栏挡住
    expect(ivs[0]?.dispatchRef).toBeNull(); // 但确实没发出去
  });

  it("逾期转 failed：当天已提醒过则静默转档，不二次出声", async () => {
    const { store, sent, evaluator } = await setup({ decision: "silent", reason: "unused" });
    const overdue = commitment({ dueAt: new Date(NOW.getTime() - 25 * H) });
    await store.commitments.put(overdue);
    // 当天早些时候已经提醒过一次
    await store.interventions.put({
      id: "iv-pre",
      commitmentId: "c1",
      at: new Date(NOW.getTime() - 2 * H),
      decision: "remind",
      reason: "earlier",
      message: "earlier",
      channel: "discord",
      dispatchRef: "d0",
    });

    await evaluator.evaluate(overdue);

    expect((await store.commitments.get("c1"))?.status).toBe("failed"); // 仍然转档
    expect(sent).toHaveLength(0); // 但不再发「改期」那句
  });

  it("link/github verifier 失败会抛出，不伪装成无变化", async () => {
    const failingVerifier: VerifierAdapter = {
      kind: "link",
      fetchState: async () => {
        throw new Error("network failed");
      },
    };
    const { evaluator } = await setup(
      { decision: "silent", reason: "unused" },
      new Map<VerifierAdapter["kind"], VerifierAdapter>([["link", failingVerifier]]),
    );

    await expect(
      evaluator.evaluate(
        commitment({ verification: { kind: "link", urls: ["https://x"], expectation: "done" } }),
      ),
    ).rejects.toThrow(/network failed/);
  });
});
