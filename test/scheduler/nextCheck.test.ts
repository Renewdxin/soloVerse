import { describe, expect, it } from "vitest";
import { computeNextCheckAt } from "../../src/core/scheduler/nextCheck";

const H = 3_600_000;
const now = new Date("2026-06-01T00:00:00Z");
const at = (ms: number) => now.getTime() + ms;

describe("nextCheckAt 策略（§8.2）", () => {
  it("无 due → +24h", () => {
    expect(computeNextCheckAt(now, null, "active")?.getTime()).toBe(at(24 * H));
  });
  it("due 3 天后 → +12h", () => {
    expect(computeNextCheckAt(now, new Date(at(3 * 24 * H)), "active")?.getTime()).toBe(at(12 * H));
  });
  it("due 12 小时后 → +3h", () => {
    expect(computeNextCheckAt(now, new Date(at(12 * H)), "active")?.getTime()).toBe(at(3 * H));
  });
  it("due 3 小时后 → +1h", () => {
    expect(computeNextCheckAt(now, new Date(at(3 * H)), "active")?.getTime()).toBe(at(H));
  });
  it("at_risk → +1h（不论 due 多远）", () => {
    expect(computeNextCheckAt(now, new Date(at(2 * 24 * H)), "at_risk")?.getTime()).toBe(at(H));
  });
  it("终态 → null", () => {
    expect(computeNextCheckAt(now, null, "fulfilled")).toBeNull();
  });
  it("逾期超宽限 → null", () => {
    expect(computeNextCheckAt(now, new Date(at(-2 * 24 * H)), "active")).toBeNull();
  });
});
