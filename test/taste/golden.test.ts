import { describe, expect, it } from "vitest";
import { screenIntervention } from "../../src/core/pipeline/interventionPolicy";
import { DECISION_GOLDEN, EXTRACTION_GOLDEN } from "../../src/core/taste/golden";
import { scoreMessage } from "../../src/core/taste/rubric";

describe("golden 数据集完整性", () => {
  it("抽取金标 id 唯一、字段完备、正负两类都有", () => {
    const ids = EXTRACTION_GOLDEN.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(EXTRACTION_GOLDEN.some((c) => c.expect.isCommitment)).toBe(true);
    expect(EXTRACTION_GOLDEN.some((c) => !c.expect.isCommitment)).toBe(true);
    for (const c of EXTRACTION_GOLDEN) {
      expect(c.conversation.length, c.id).toBeGreaterThan(0);
      expect((c.conversation.at(-1)?.text.length ?? 0) > 0, c.id).toBe(true);
      expect(() => new Date(c.now).toISOString()).not.toThrow();
    }
  });

  it("决策金标 id 唯一、三种 expectedScreen 都覆盖", () => {
    const ids = DECISION_GOLDEN.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const screens = new Set(DECISION_GOLDEN.map((c) => c.expectedScreen));
    expect(screens.has("silent")).toBe(true);
    expect(screens.has("celebrate")).toBe(true);
    expect(screens.has("consult_llm")).toBe(true);
  });
});

describe("golden 与真实代码一致", () => {
  it("每个决策金标的 expectedScreen 等于真实 screenIntervention", () => {
    for (const c of DECISION_GOLDEN) {
      expect(screenIntervention(c.screen).action, c.id).toBe(c.expectedScreen);
    }
  });

  it("consult_llm 的范例措辞自检通过（dogfood：我们自己的金答案必须在角色里）", () => {
    const consult = DECISION_GOLDEN.filter((c) => c.expectedScreen === "consult_llm");
    expect(consult.length).toBeGreaterThan(0);
    for (const c of consult) {
      expect(c.goldenMessage, `${c.id} 应带范例措辞`).toBeDefined();
      expect(c.context, `${c.id} 应带情境`).toBeDefined();
      if (c.goldenMessage !== undefined && c.context !== undefined) {
        const r = scoreMessage(c.goldenMessage, c.context);
        expect(r.passed, `${c.id}: ${JSON.stringify(r.violations)}`).toBe(true);
      }
    }
  });
});
