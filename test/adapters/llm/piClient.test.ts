import { describe, expect, it } from "vitest";
import { type PiModelConfig, resolvePiModel } from "../../../src/adapters/llm/piClient";

function config(over: Partial<PiModelConfig> = {}): PiModelConfig {
  return {
    provider: "openai-compatible",
    modelId: "gpt-4o-mini",
    cacheRetention: "short",
    apiKey: "test-key",
    baseUrl: "https://proxy.example.com/v1",
    compat: {},
    ...over,
  };
}

describe("resolvePiModel", () => {
  it("把 openai-compatible 解析成 pi-ai 的 openai-completions 自定义模型", () => {
    const model = resolvePiModel(
      config({
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          maxTokensField: "max_tokens",
        },
      }),
    );

    expect(model).toMatchObject({
      id: "gpt-4o-mini",
      api: "openai-completions",
      provider: "openai-compatible",
      baseUrl: "https://proxy.example.com/v1",
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        maxTokensField: "max_tokens",
      },
    });
  });

  it("openai-compatible 缺少 baseUrl 时快速失败", () => {
    expect(() => resolvePiModel(config({ baseUrl: "" }))).toThrow(/LLM_BASE_URL/);
  });

  it("内建 provider 仍走 pi-ai registry", () => {
    const model = resolvePiModel(
      config({
        provider: "openai",
        modelId: "gpt-4o-mini",
        baseUrl: "",
      }),
    );

    expect(model.provider).toBe("openai");
    expect(model.id).toBe("gpt-4o-mini");
  });
});
