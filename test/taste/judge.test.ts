import { describe, expect, it } from "vitest";
import { fullTasteCheck, type JudgeOutput, type LlmTasteJudge } from "../../src/core/taste/judge";
import type { TasteContext } from "../../src/core/taste/rubric";

const remind: TasteContext = { decision: "remind", latestVerdict: "no_change" };
const GOOD = "登录 bug 离 due 不远了，需要我把相关 PR 翻出来吗？";
const COSPLAY = "尊敬的主人，请允许我提醒您。";

function fakeJudge(verdicts: JudgeOutput["verdicts"]): LlmTasteJudge {
  return { judge: async (): Promise<JudgeOutput> => ({ verdicts }) };
}

const allPass = fakeJudge([
  { dimension: "tone-appropriate", pass: true, note: "得体" },
  { dimension: "grounded", pass: true, note: "有依据" },
  { dimension: "actionable", pass: true, note: "具体" },
]);

describe("fullTasteCheck 组合 floor + ceiling", () => {
  it("floor 与 ceiling 都过 → passed", async () => {
    const v = await fullTasteCheck(GOOD, remind, "情境", allPass);
    expect(v.passed).toBe(true);
    expect(v.judged).toHaveLength(3);
    expect(v.violations).toHaveLength(0);
  });

  it("ceiling 的 blocker（grounded=false）即便 floor 过也整体 fail", async () => {
    const judge = fakeJudge([
      { dimension: "tone-appropriate", pass: true, note: "ok" },
      { dimension: "grounded", pass: false, note: "编了没依据的进展" },
    ]);
    const v = await fullTasteCheck(GOOD, remind, "情境", judge);
    expect(v.passed).toBe(false);
    expect(v.violations.some((x) => x.dimension === "grounded" && x.severity === "blocker")).toBe(
      true,
    );
  });

  it("ceiling 的 warn（actionable=false）不致命", async () => {
    const judge = fakeJudge([{ dimension: "actionable", pass: false, note: "略空泛" }]);
    const v = await fullTasteCheck(GOOD, remind, "情境", judge);
    expect(v.passed).toBe(true);
    expect(v.violations.some((x) => x.dimension === "actionable" && x.severity === "warn")).toBe(
      true,
    );
  });

  it("llmJudge 为 null → 只跑 floor", async () => {
    const good = await fullTasteCheck(GOOD, remind, "情境", null);
    expect(good.passed).toBe(true);
    expect(good.judged).toHaveLength(0);

    const bad = await fullTasteCheck(COSPLAY, remind, "情境", null);
    expect(bad.passed).toBe(false);
    expect(bad.violations.some((x) => x.dimension === "no-cosplay")).toBe(true);
  });
});
