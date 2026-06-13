import type {
  DecisionInput,
  DecisionOutput,
  ExtractionInput,
  ExtractionOutput,
  LlmPort,
  VerifyInput,
  VerifyOutput,
} from "../../core/ports";
import { type PiModelConfig, structuredOutput } from "./piClient";
import {
  buildDecisionUserText,
  DECISION_SYSTEM,
  DECISION_TOOL,
  DECISION_TOOL_DESC,
  DecisionSchema,
} from "./prompts/decision";
import {
  buildExtractionUserText,
  EXTRACTION_SYSTEM,
  EXTRACTION_TOOL,
  EXTRACTION_TOOL_DESC,
  ExtractionSchema,
} from "./prompts/extraction";
import {
  buildVerifyLinkUserText,
  VERIFY_LINK_SYSTEM,
  VERIFY_LINK_TOOL,
  VERIFY_LINK_TOOL_DESC,
  VerifyLinkSchema,
} from "./prompts/verification";

/**
 * LlmPort 实现，基于 @earendil-works/pi-ai（typebox 结构化输出 + prompt caching）。
 * 三个决策节点；verification 的具体绑定由 Extractor 按 URL 确定性完成。
 */
export class PiLlm implements LlmPort {
  constructor(private readonly model: PiModelConfig) {}

  async extractCommitment(input: ExtractionInput): Promise<ExtractionOutput> {
    const out = await structuredOutput({
      model: this.model,
      systemPrompt: EXTRACTION_SYSTEM,
      userText: buildExtractionUserText(input),
      toolName: EXTRACTION_TOOL,
      toolDescription: EXTRACTION_TOOL_DESC,
      schema: ExtractionSchema,
    });
    return {
      isCommitment: out.isCommitment,
      confidence: out.confidence,
      dueAt: out.dueAt ?? null,
      ...(out.title !== undefined ? { title: out.title } : {}),
      ...(out.clarifyingQuestion !== undefined
        ? { clarifyingQuestion: out.clarifyingQuestion }
        : {}),
    };
  }

  async verifyLink(input: VerifyInput): Promise<VerifyOutput> {
    const out = await structuredOutput({
      model: this.model,
      systemPrompt: VERIFY_LINK_SYSTEM,
      userText: buildVerifyLinkUserText(input),
      toolName: VERIFY_LINK_TOOL,
      toolDescription: VERIFY_LINK_TOOL_DESC,
      schema: VerifyLinkSchema,
    });
    return {
      verdict: out.verdict,
      summary: out.summary,
      confidence: out.confidence,
    };
  }

  async decideIntervention(input: DecisionInput): Promise<DecisionOutput> {
    const out = await structuredOutput({
      model: this.model,
      systemPrompt: DECISION_SYSTEM,
      userText: buildDecisionUserText(input),
      toolName: DECISION_TOOL,
      toolDescription: DECISION_TOOL_DESC,
      schema: DecisionSchema,
    });
    return {
      decision: out.decision,
      ...(out.newStatus !== undefined ? { newStatus: out.newStatus } : {}),
      ...(out.message !== undefined ? { message: out.message } : {}),
      ...(out.nextCheckHint !== undefined ? { nextCheckHint: out.nextCheckHint } : {}),
      reason: out.reason,
    };
  }
}
