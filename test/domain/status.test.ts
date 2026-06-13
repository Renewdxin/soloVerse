import { describe, expect, it } from "vitest";
import { canTransition, isTerminal } from "../../src/core/domain/status";

describe("commitment 状态机", () => {
  it("确认：proposed → active", () => {
    expect(canTransition("proposed", "active")).toBe(true);
  });

  it("不能从 proposed 直接 fulfilled", () => {
    expect(canTransition("proposed", "fulfilled")).toBe(false);
  });

  it("active 可转 at_risk / fulfilled / failed / snoozed / abandoned", () => {
    for (const to of ["at_risk", "fulfilled", "failed", "snoozed", "abandoned"] as const) {
      expect(canTransition("active", to)).toBe(true);
    }
  });

  it("failed 可改期复活回 active", () => {
    expect(canTransition("failed", "active")).toBe(true);
  });

  it("fulfilled / abandoned 是终态", () => {
    expect(isTerminal("fulfilled")).toBe(true);
    expect(isTerminal("abandoned")).toBe(true);
    expect(isTerminal("active")).toBe(false);
  });
});
