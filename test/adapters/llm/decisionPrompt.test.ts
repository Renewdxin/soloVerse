import { describe, expect, it } from "vitest";
import { buildDecisionUserText, DECISION_SYSTEM } from "../../../src/adapters/llm/prompts/decision";
import type { Commitment, Evidence } from "../../../src/core/domain/types";
import type { DecisionInput } from "../../../src/core/ports";

const NOW = new Date("2026-06-01T10:00:00.000Z");

function commitment(over: Partial<Commitment> = {}): Commitment {
  return {
    id: "c1",
    groupRef: "g1",
    assignee: "p-li",
    title: "修复登录 bug",
    rawText: "周三前修复登录 bug",
    source: { channel: "discord", messageRef: "m1", at: NOW },
    status: "active",
    dueAt: new Date("2026-06-01T18:00:00.000Z"),
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
    source: "link",
    verdict: "no_change",
    summary: "链接内容没有变化",
    raw: null,
    ...over,
  };
}

function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    commitment: commitment(),
    evidenceHistory: [evidence()],
    interactionHistory: [{ direction: "out", text: "今天提醒过一次", at: NOW }],
    now: NOW,
    timezone: "Asia/Shanghai",
    policy: {
      quietHours: [23, 8],
      maxRemindersPerDay: 1,
      lastRemindAt: NOW,
    },
    ...over,
  };
}

describe("decision prompt", () => {
  it("system prompt 收窄实时决策枚举，不允许完成庆祝交给 LLM", () => {
    expect(DECISION_SYSTEM).toContain("silent / remind / mark_at_risk / suggest_renegotiate");
    expect(DECISION_SYSTEM).toContain("不得输出 celebrate 或 fulfilled");
  });

  it("user brief 只包含结构化决策事实", () => {
    const text = buildDecisionUserText(input());

    expect(text).toContain("<commitment> 修复登录 bug");
    expect(text).toContain("<latest_evidence> link:no_change 链接内容没有变化");
    expect(text).toContain("<interaction_history>");
    expect(text).toContain("out: 今天提醒过一次");
    expect(text).toContain("quietHours=23-8");
    expect(text).toContain("lastRemindAt=2026-06-01T10:00:00.000Z");
  });

  it("evidence / interaction 简报封顶为最近 5 条", () => {
    const manyEvidence = Array.from({ length: 7 }, (_, i) =>
      evidence({
        id: `e${i}`,
        capturedAt: new Date(NOW.getTime() + i),
        summary: `证据 ${i}`,
      }),
    );
    const manyInteractions = Array.from({ length: 7 }, (_, i) => ({
      direction: "in" as const,
      text: `消息 ${i}`,
      at: new Date(NOW.getTime() + i),
    }));

    const text = buildDecisionUserText(
      input({ evidenceHistory: manyEvidence, interactionHistory: manyInteractions }),
    );

    expect(text).not.toContain("证据 0");
    expect(text).not.toContain("消息 0");
    expect(text).toContain("证据 6");
    expect(text).toContain("消息 6");
  });
});
