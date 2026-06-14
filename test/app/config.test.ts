import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/app/config";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function resetEnv(): void {
  process.env = { ANTHROPIC_API_KEY: "test-key" };
}

describe("loadConfig", () => {
  it("从 env 解析模型、策略、retention 和 feature flags", () => {
    resetEnv();
    process.env.LLM_PROVIDER = "openrouter";
    process.env.LLM_MODEL_ID = "anthropic/claude-sonnet-4.5";
    process.env.OPENROUTER_API_KEY = "openrouter-key";
    process.env.LLM_CACHE_RETENTION = "long";
    process.env.TOOL_RUNNER_CWD = "/tmp/work";
    process.env.QUIET_HOURS = "22-7";
    process.env.MAX_REMINDERS_PER_DAY = "2";
    process.env.TICK_MS = "30000";
    process.env.RAW_EVIDENCE_RETENTION_DAYS = "14";
    process.env.PROFILE_HINTS_CAP = "7";
    process.env.PENDING_PROFILE_PROPOSALS_CAP = "4";
    process.env.ENABLE_REVIEW = "1";
    process.env.ENABLE_WEBFETCH = "1";
    process.env.LINK_FETCH_ALLOWED_HOSTS = "github.com,docs.github.com";
    process.env.LINK_FETCH_TIMEOUT_MS = "2500";
    process.env.LINK_FETCH_MAX_BYTES = "50000";
    process.env.LINK_FETCH_MAX_REDIRECTS = "2";
    process.env.LINK_FETCH_ALLOWED_CONTENT_TYPES = "text/html,text/plain";

    const config = loadConfig();

    expect(config.llm).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-sonnet-4.5",
      cacheRetention: "long",
      apiKey: "openrouter-key",
      baseUrl: "",
      compat: {},
    });
    expect(config.toolRunner).toMatchObject({
      cwd: "/tmp/work",
      model: {
        provider: "openrouter",
        modelId: "anthropic/claude-sonnet-4.5",
        apiKey: "openrouter-key",
      },
    });
    expect(config.quietHours).toEqual([22, 7]);
    expect(config.maxRemindersPerDay).toBe(2);
    expect(config.tickMs).toBe(30_000);
    expect(config.retention).toEqual({
      rawEvidenceDays: 14,
      profileHintsCap: 7,
      pendingProposalsCap: 4,
    });
    expect(config.linkFetch).toEqual({
      allowedHosts: ["github.com", "docs.github.com"],
      timeoutMs: 2500,
      maxBytes: 50_000,
      maxRedirects: 2,
      allowedContentTypes: ["text/html", "text/plain"],
    });
    expect(config.features.review).toBe(true);
    expect(config.features.webfetch).toBe(true);
  });

  it("真实 channel 必须配置 postgres，避免静默落到本地冒烟模式", () => {
    resetEnv();
    process.env.DISCORD_BOT_TOKEN = "discord-token";

    // 群发言权不再要求 env allowlist——群自助发现、operator 私聊提权。
    expect(() => loadConfig()).toThrow(/postgres DATABASE_URL/);

    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    expect(loadConfig().databaseUrl).toContain("postgres");
  });

  it("启用飞书必须配置 OPERATOR_FEISHU_OPEN_ID（群上岗审批走私聊）", () => {
    resetEnv();
    process.env.FEISHU_APP_ID = "cli_x";
    process.env.FEISHU_APP_SECRET = "sec";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";

    expect(() => loadConfig()).toThrow(/OPERATOR_FEISHU_OPEN_ID/);

    process.env.OPERATOR_FEISHU_OPEN_ID = "ou_operator";
    expect(loadConfig().operator.feishuOpenId).toBe("ou_operator");
  });

  it("支持 OpenAI-compatible endpoint，并从 env 解析兼容性开关", () => {
    resetEnv();
    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.LLM_MODEL_ID = "gpt-4o-mini";
    process.env.LLM_BASE_URL = "https://proxy.example.com/v1";
    process.env.LLM_API_KEY = "proxy-key";
    process.env.LLM_COMPAT_SUPPORTS_STORE = "0";
    process.env.LLM_COMPAT_SUPPORTS_DEVELOPER_ROLE = "0";
    process.env.LLM_COMPAT_SUPPORTS_REASONING_EFFORT = "0";
    process.env.LLM_COMPAT_MAX_TOKENS_FIELD = "max_tokens";

    const config = loadConfig();

    expect(config.llm).toEqual({
      provider: "openai-compatible",
      modelId: "gpt-4o-mini",
      cacheRetention: "short",
      apiKey: "proxy-key",
      baseUrl: "https://proxy.example.com/v1",
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: "max_tokens",
      },
    });
    expect(config.toolRunner.model).toMatchObject({
      provider: "openai-compatible",
      baseUrl: "https://proxy.example.com/v1",
      apiKey: "proxy-key",
    });
  });

  it("真实 channel 下 OpenAI-compatible 必须显式配置 base url 和 api key", () => {
    resetEnv();
    process.env.DISCORD_BOT_TOKEN = "discord-token";
    process.env.ALLOWED_GROUP_REFS = "g1";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.LLM_PROVIDER = "openai-compatible";

    expect(() => loadConfig()).toThrow(/BASE_URL/);

    process.env.LLM_BASE_URL = "https://proxy.example.com/v1";
    expect(() => loadConfig()).toThrow(/API_KEY/);

    process.env.LLM_API_KEY = "proxy-key";
    expect(loadConfig().llm.provider).toBe("openai-compatible");
  });

  it("拒绝无效 quiet hours / cache retention / boolean", () => {
    resetEnv();
    process.env.QUIET_HOURS = "25-8";
    expect(() => loadConfig()).toThrow(/QUIET_HOURS/);

    resetEnv();
    process.env.LLM_CACHE_RETENTION = "forever";
    expect(() => loadConfig()).toThrow(/LLM_CACHE_RETENTION/);

    resetEnv();
    process.env.ENABLE_REVIEW = "maybe";
    expect(() => loadConfig()).toThrow(/ENABLE_REVIEW/);

    resetEnv();
    process.env.LLM_COMPAT_MAX_TOKENS_FIELD = "tokens";
    expect(() => loadConfig()).toThrow(/LLM_COMPAT_MAX_TOKENS_FIELD/);
  });
});
