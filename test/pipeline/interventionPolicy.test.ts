import { describe, expect, it } from "vitest";
import { type ScreenInput, screenIntervention } from "../../src/core/pipeline/interventionPolicy";

const NOW = new Date("2026-06-01T03:00:00Z");
const H = 3_600_000;

function base(over: Partial<ScreenInput> = {}): ScreenInput {
  return {
    now: NOW,
    dueAt: new Date(NOW.getTime() + 48 * H),
    status: "active",
    latestVerdict: null,
    localHour: 14,
    quietHours: [23, 8],
    maxRemindersPerDay: 1,
    remindersToday: 0,
    canAutoComplete: true,
    hasUnansweredRecentRemind: false,
    ...over,
  };
}

describe("screenIntervention 隐形护栏", () => {
  it("完成 → celebrate", () => {
    expect(screenIntervention(base({ latestVerdict: "completed" })).action).toBe("celebrate");
  });

  it("安静期 → silent", () => {
    expect(screenIntervention(base({ localHour: 2 })).action).toBe("silent");
  });

  it("on-track（远离 due，有进展）→ silent", () => {
    const o = screenIntervention(base({ latestVerdict: "progressed" }));
    expect(o.action).toBe("silent");
  });

  it("远离 due、无证据也 silent（隐形，没消息=好消息）", () => {
    expect(screenIntervention(base({ latestVerdict: null })).action).toBe("silent");
  });

  it("临期无进展、今日未提醒 → 交给 LLM 措辞", () => {
    const o = screenIntervention(
      base({ dueAt: new Date(NOW.getTime() + 3 * H), latestVerdict: "no_change" }),
    );
    expect(o.action).toBe("consult_llm");
  });

  it("临期但今日已提醒达上限 → silent（装死不点名、不连环）", () => {
    const o = screenIntervention(
      base({
        dueAt: new Date(NOW.getTime() + 3 * H),
        latestVerdict: "no_change",
        remindersToday: 1,
      }),
    );
    expect(o.action).toBe("silent");
  });

  it("临期但最近提醒后未回 → silent（不连环追问）", () => {
    const o = screenIntervention(
      base({
        dueAt: new Date(NOW.getTime() + 3 * H),
        latestVerdict: "no_change",
        hasUnansweredRecentRemind: true,
      }),
    );
    expect(o.action).toBe("silent");
  });

  it("弱来源 completed 不能自动 celebrate", () => {
    const o = screenIntervention(
      base({
        dueAt: new Date(NOW.getTime() + 3 * H),
        latestVerdict: "completed",
        canAutoComplete: false,
      }),
    );
    expect(o.action).toBe("consult_llm");
  });

  it("at_risk → 不算 on-track，未达上限则交给 LLM", () => {
    const o = screenIntervention(base({ status: "at_risk", latestVerdict: "no_change" }));
    expect(o.action).toBe("consult_llm");
  });

  it("证据回退（regressed）即便远离 due 也不沉默", () => {
    const o = screenIntervention(base({ latestVerdict: "regressed" }));
    expect(o.action).toBe("consult_llm");
  });
});
