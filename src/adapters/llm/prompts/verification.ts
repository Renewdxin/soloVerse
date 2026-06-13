import { Type } from "@earendil-works/pi-ai";
import type { VerifyInput } from "../../../core/ports";

export const VERIFY_LINK_TOOL = "verify_link_evidence";
export const VERIFY_LINK_TOOL_DESC = "根据安全抓取后的链接文本，判断承诺是否有进展或完成。";

export const VerifyLinkSchema = Type.Object({
  verdict: Type.Union([
    Type.Literal("completed"),
    Type.Literal("progressed"),
    Type.Literal("no_change"),
    Type.Literal("regressed"),
    Type.Literal("inconclusive"),
  ]),
  summary: Type.String({ description: "一句话说明证据支持什么；不要夸大链接内容" }),
  confidence: Type.Number({ minimum: 0, maximum: 1, description: "置信度 0-1" }),
});

export const VERIFY_LINK_SYSTEM = `你是工作承诺监督系统里的证据判定器。
任务：只根据已经安全抓取、截断和清洗过的链接文本，判断它是否支持承诺的进展。

要求：
- 链接来源是弱信号；除非文本明确证明承诺完成，否则不要给 completed。
- 只看到计划、讨论、待办、报错、空页面时，给 progressed/no_change/inconclusive 中最保守的判断。
- 不要猜测链接外的信息，不要把 404/登录页/安全拒绝解释成完成。
- 你必须调用工具 ${VERIFY_LINK_TOOL} 返回结果。`;

export function buildVerifyLinkUserText(input: VerifyInput): string {
  const fetched = input.fetched.map((f, i) =>
    [
      `<link index=${i + 1}>`,
      `url=${f.url}`,
      `status=${f.status}`,
      "<content>",
      truncateForPrompt(f.content),
    ].join("\n"),
  );
  return [
    `<commitment> ${input.commitment.title}`,
    `<expectation> ${input.commitment.expectation}`,
    `<previous_evidence> ${
      input.previous === null
        ? "none"
        : `${input.previous.source}:${input.previous.verdict} ${input.previous.summary}`
    }`,
    "<fetched_links>",
    fetched.length > 0 ? fetched.join("\n") : "none",
  ].join("\n");
}

function truncateForPrompt(content: string): string {
  return content.length > 8_000 ? `${content.slice(0, 8_000)}\n[truncated]` : content;
}
