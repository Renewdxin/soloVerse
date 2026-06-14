// 品味 LLM-as-judge 的 pi 实现（ceiling）。core 只认 LlmTasteJudge 接口；这里把它接到 pi-ai。
// 单次结构化输出，跟三个决策节点同款用法（窄 LLM，不跑 loop）。
import { Type } from "@earendil-works/pi-ai";
import type { JudgeInput, JudgeOutput, LlmTasteJudge } from "../../core/taste/judge";
import { type PiModelConfig, structuredOutput } from "./piClient";

export const TASTE_JUDGE_TOOL = "score_taste";
export const TASTE_JUDGE_TOOL_DESC = "按给定维度逐条判定一句管家措辞是否合格，并给一句理由。";

export const TasteJudgeSchema = Type.Object({
  verdicts: Type.Array(
    Type.Object({
      dimension: Type.String({ description: "维度 id，与输入一致" }),
      pass: Type.Boolean(),
      note: Type.String({ description: "一句话理由；不合格时点明问题" }),
    }),
  ),
});

export const TASTE_JUDGE_SYSTEM = `你是「管家品味」评审。
给你一句机器人将要发到工作群的话、它所处的情境、以及若干评审维度。
对每个维度给出 pass(true/false) 和一句话理由。
严格、保守：拿不准就判 false。只依据情境里写明的事实，不要替机器人脑补依据。
你必须调用工具 ${TASTE_JUDGE_TOOL} 返回结果。`;

export function buildTasteJudgeUserText(input: JudgeInput): string {
  const dims = input.dimensions.map((d) => `- ${d.id}: ${d.rubric}`).join("\n");
  return [
    "<message>",
    input.message,
    "<situation>",
    input.situation,
    "<dimensions>",
    dims,
    "<task> 逐维度判定 pass 与一句话理由",
  ].join("\n");
}

export class PiTasteJudge implements LlmTasteJudge {
  constructor(private readonly model: PiModelConfig) {}

  async judge(input: JudgeInput): Promise<JudgeOutput> {
    const out = await structuredOutput({
      model: this.model,
      systemPrompt: TASTE_JUDGE_SYSTEM,
      userText: buildTasteJudgeUserText(input),
      toolName: TASTE_JUDGE_TOOL,
      toolDescription: TASTE_JUDGE_TOOL_DESC,
      schema: TasteJudgeSchema,
    });
    return { verdicts: out.verdicts };
  }
}
