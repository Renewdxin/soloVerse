// Commitment Agent · 品味 judge —— 组合确定性 floor 与 LLM-as-judge ceiling。
// core 只认 LlmTasteJudge 接口；pi 实现见 src/adapters/llm/tasteJudge.ts。
import type { TasteContext, TasteReport, TasteSeverity, TasteViolation } from "./rubric";
import { JUDGE_DIMENSIONS, scoreMessage } from "./rubric";

/** 主观维度的打分（ceiling，跑在 npm run eval）。 */
export interface LlmTasteJudge {
  judge(input: JudgeInput): Promise<JudgeOutput>;
}

export interface JudgeInput {
  /** 待判的出站措辞。 */
  message: string;
  /** 人类可读的情境简报（承诺、状态、距 due、最近证据、决定）。 */
  situation: string;
  dimensions: { id: string; rubric: string }[];
}

export interface JudgeOutput {
  verdicts: { dimension: string; pass: boolean; note: string }[];
}

export interface JudgedVerdict {
  dimension: string;
  severity: TasteSeverity;
  pass: boolean;
  note: string;
}

export interface FullTasteVerdict {
  /** floor + ceiling 都无 blocker 才算 passed。 */
  passed: boolean;
  deterministic: TasteReport;
  judged: JudgedVerdict[];
  /** floor 与 ceiling 合并后的全部违规。 */
  violations: TasteViolation[];
}

/**
 * 完整品味检查：确定性 floor 始终跑；提供了 LlmTasteJudge 时再跑主观 ceiling。
 * 任一层出现 blocker 违规即整体 passed=false。
 */
export async function fullTasteCheck(
  message: string,
  ctx: TasteContext,
  situation: string,
  llmJudge: LlmTasteJudge | null,
): Promise<FullTasteVerdict> {
  const deterministic = scoreMessage(message, ctx);
  const violations: TasteViolation[] = [...deterministic.violations];
  const judged: JudgedVerdict[] = [];

  if (llmJudge !== null) {
    const out = await llmJudge.judge({
      message,
      situation,
      dimensions: JUDGE_DIMENSIONS.map((d) => ({ id: d.id, rubric: d.rubric })),
    });
    for (const v of out.verdicts) {
      const dim = JUDGE_DIMENSIONS.find((d) => d.id === v.dimension);
      const severity: TasteSeverity = dim?.severity ?? "warn";
      judged.push({ dimension: v.dimension, severity, pass: v.pass, note: v.note });
      if (!v.pass) {
        violations.push({ dimension: v.dimension, severity, detail: v.note });
      }
    }
  }

  const passed = !violations.some((v) => v.severity === "blocker");
  return { passed, deterministic, judged, violations };
}
