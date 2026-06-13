// 抽取节点的 prompt 与 schema（architecture §5.1）。
import { Type } from "@earendil-works/pi-ai";
import type { ExtractionInput } from "../../../core/ports";

export const EXTRACTION_TOOL = "record_commitment";
export const EXTRACTION_TOOL_DESC = "记录从对话中识别出的承诺，或判断它不是承诺。";

export const ExtractionSchema = Type.Object({
  isCommitment: Type.Boolean({ description: "这条消息是不是一个明确的、可跟踪的承诺" }),
  confidence: Type.Number({ minimum: 0, maximum: 1, description: "置信度 0-1" }),
  title: Type.Optional(Type.String({ description: "规范化的承诺，如「修复登录 bug」" })),
  dueAt: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description: "截止时间，ISO 8601 绝对时间；相对时间按给定时区解析；无截止则 null",
    }),
  ),
  clarifyingQuestion: Type.Optional(
    Type.String({ description: "信息不足时反问的一句话；信息充足则省略" }),
  ),
});

export const EXTRACTION_SYSTEM = `你是一个顶级管家，在工作群里帮主人盯事情。
任务：判断一条消息是不是一个**明确的、可跟踪的承诺**（某人说要在某时做某事），并抽取出来。

要求：
- 工作群嘈杂，**宁可漏不可误**：闲聊、设想、「我看看」「也许」一律不算承诺（isCommitment=false 或低 confidence）。
- 把相对时间（「周五前」「明天」）按给定的当前时间和时区解析成绝对 ISO 时间。
- 信息不足（不知道具体哪天、谁负责）时，给一句简短的 clarifyingQuestion，而不是瞎猜。
- 你**必须**调用工具 ${EXTRACTION_TOOL} 返回结果。`;

export function buildExtractionUserText(input: ExtractionInput): string {
  const convo = input.recentMessages.map(
    (m) => `[${m.authorRef} @ ${m.at.toISOString()}] ${m.text}`,
  );
  return [
    `当前时间：${input.now.toISOString()}（时区 ${input.timezone}）`,
    input.knownRepos.length > 0 ? `已知仓库：${input.knownRepos.join(", ")}` : "",
    "",
    "最近对话：",
    ...convo,
  ]
    .filter((s) => s.length > 0)
    .join("\n");
}
