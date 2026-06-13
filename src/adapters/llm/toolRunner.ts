import {
  type AgentContext,
  type AgentLoopConfig,
  type AgentMessage,
  runAgentLoop,
} from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import { convertToLlm, createReadOnlyTools } from "@earendil-works/pi-coding-agent";
import type { ToolRunner, ToolRunResult, ToolTask } from "../../core/ports";
import { type PiModelConfig, resolvePiModel } from "./piClient";

const SYSTEM: Record<ToolTask["kind"], string> = {
  review:
    "你是顶级管家里懂行的那部分，review 代码/产出。先挑出真 bug（底线），再评够不够讲究。全程只读，不改任何东西。",
  search: "搜集与任务相关的资料，给出要点与来源链接。",
  fetch: "抓取并理解给定内容，判断与任务的相关性，给出结论。",
};

/**
 * ToolRunner = 用 pi 的 agent 跑**只读**工具（review / 搜 / 抓）。
 * 架在 pi-agent-core 的 `runAgentLoop` + pi-coding-agent 的 `createReadOnlyTools` 上——
 * 只读工具集（read/grep/find/ls，无 edit/write）= 天然不改代码、不开代码 PR（架构 §16）。
 * cwd：review 时是 checkout 出来的仓库目录。
 */
export class PiToolRunner implements ToolRunner {
  constructor(
    private readonly opts: {
      cwd: string;
      model: PiModelConfig;
    },
  ) {}

  async run(task: ToolTask): Promise<ToolRunResult> {
    const context: AgentContext = {
      systemPrompt: SYSTEM[task.kind],
      messages: [],
      tools: createReadOnlyTools(this.opts.cwd),
    };
    const config: AgentLoopConfig = {
      model: resolvePiModel(this.opts.model),
      convertToLlm,
    };
    const prompts: AgentMessage[] = [{ role: "user", content: task.prompt, timestamp: Date.now() }];
    const final = await runAgentLoop(prompts, context, config, () => {});
    return { text: lastAssistantText(final) };
  }
}

function lastAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m !== undefined && m.role === "assistant") {
      return m.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    }
  }
  return "";
}
