// pi-ai 薄封装：单次结构化输出。模型由 app/config 注入，core 不知道 provider/model。
import {
  type Api,
  type CacheRetention,
  type Context,
  getModel,
  type KnownProvider,
  type Model,
  type OpenAICompletionsCompat,
  type Static,
  streamSimple,
  type ToolCall,
  type TSchema,
} from "@earendil-works/pi-ai";

export interface PiModelConfig {
  provider: string;
  modelId: string;
  cacheRetention: CacheRetention;
  apiKey: string;
  baseUrl: string;
  compat: OpenAICompletionsCompat;
}

/**
 * 给模型一个 tool（typebox schema），让它填，取回 arguments。
 * 这是「窄 LLM」的决策节点用法：一次调用、schema 约束、不跑 loop。
 */
export async function structuredOutput<T extends TSchema>(args: {
  model: PiModelConfig;
  systemPrompt: string;
  userText: string;
  toolName: string;
  toolDescription: string;
  schema: T;
}): Promise<Static<T>> {
  const model = resolvePiModel(args.model);
  const context: Context = {
    systemPrompt: args.systemPrompt,
    messages: [{ role: "user", content: args.userText, timestamp: Date.now() }],
    tools: [{ name: args.toolName, description: args.toolDescription, parameters: args.schema }],
  };
  const message = await streamSimple(model, context, {
    ...(args.model.apiKey.length > 0 ? { apiKey: args.model.apiKey } : {}),
    cacheRetention: args.model.cacheRetention,
  }).result();
  const call = message.content.find((c): c is ToolCall => c.type === "toolCall");
  if (!call) {
    throw new Error(`模型未调用工具 ${args.toolName}（stopReason=${message.stopReason}）`);
  }
  return call.arguments as Static<T>;
}

export function resolvePiModel(config: PiModelConfig): Model<Api> {
  if (config.provider === "openai-compatible") {
    if (config.baseUrl.length === 0) {
      throw new Error("LLM_PROVIDER=openai-compatible 时必须配置 LLM_BASE_URL");
    }
    return {
      id: config.modelId,
      name: `${config.modelId} (${config.provider})`,
      api: "openai-completions",
      provider: config.provider,
      baseUrl: config.baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
      compat: config.compat,
    };
  }
  return getModel(config.provider as KnownProvider, config.modelId as never);
}
