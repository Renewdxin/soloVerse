import { Type } from "@earendil-works/pi-ai";
import type { DecisionInput } from "../../../core/ports";
import { BUTLER_PERSONA } from "./persona";

export const DECISION_TOOL = "decide_intervention";
export const DECISION_TOOL_DESC = "决定此刻是否对一条承诺发出干预，并返回可审计理由。";

export const DecisionSchema = Type.Object({
  decision: Type.Union([
    Type.Literal("silent"),
    Type.Literal("remind"),
    Type.Literal("mark_at_risk"),
    Type.Literal("suggest_renegotiate"),
  ]),
  newStatus: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("at_risk")])),
  message: Type.Optional(
    Type.String({
      description: "发到群里的一句话；silent 时省略。不要羞辱，不要假装看到了没有证据的进展。",
    }),
  ),
  nextCheckHint: Type.Optional(
    Type.Union([Type.Literal("soon"), Type.Literal("normal"), Type.Literal("later")]),
  ),
  reason: Type.String({ description: "给系统审计看的简短理由" }),
});

export const DECISION_SYSTEM = `${BUTLER_PERSONA}

任务：根据结构化简报决定此刻是否要干预一条承诺。

要求：
- 只能在 silent / remind / mark_at_risk / suggest_renegotiate 中选择。
- 信息不足、刚提醒过且对方没回、或没有明确收益时，保守 silent。
- remind / mark_at_risk / suggest_renegotiate 的 message 只写一句群里能直接发的话。
- 不得输出 celebrate 或 fulfilled；完成庆祝由高可信证据的确定性流程处理。
- 你必须调用工具 ${DECISION_TOOL} 返回结果。`;

export function buildDecisionUserText(input: DecisionInput): string {
  const latestEvidence = input.evidenceHistory.at(-1);
  const evidence = input.evidenceHistory.slice(-5).map((e) => {
    return `[${e.capturedAt.toISOString()}] ${e.source}:${e.verdict} ${e.summary}`;
  });
  const interactions = input.interactionHistory.slice(-5).map((i) => {
    return `[${i.at.toISOString()}] ${i.direction}: ${i.text}`;
  });

  // 这份简报是 M3 判断质量的核心：LLM 只读确定性结论，不从原始流水里猜。
  return [
    `<now> ${input.now.toISOString()} (${input.timezone})`,
    `<commitment> ${input.commitment.title} | assignee=${input.commitment.assignee} | status=${input.commitment.status} | due=${input.commitment.dueAt?.toISOString() ?? "none"}`,
    `<latest_evidence> ${
      latestEvidence === undefined
        ? "none"
        : `${latestEvidence.source}:${latestEvidence.verdict} ${latestEvidence.summary}`
    }`,
    "<evidence_history>",
    evidence.length > 0 ? evidence.join("\n") : "none",
    "<interaction_history>",
    interactions.length > 0 ? interactions.join("\n") : "none",
    `<policy> quietHours=${input.policy.quietHours.join("-")} maxRemindersPerDay=${input.policy.maxRemindersPerDay} lastRemindAt=${input.policy.lastRemindAt?.toISOString() ?? "none"}`,
    "<task> decide silent/remind/mark_at_risk/suggest_renegotiate",
  ].join("\n");
}
