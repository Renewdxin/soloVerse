// 环境配置只在 app 层读取；core 只能接收解析后的参数，不能碰 process.env。
function optional(name: string, def: string): string {
  return process.env[name] ?? def;
}
function optionalList(name: string, def: string[] = []): string[] {
  const v = process.env[name];
  if (v === undefined || v.trim().length === 0) return def;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
function numberEnv(name: string, def: number, opts: { min?: number } = {}): number {
  const raw = optional(name, String(def));
  const value = Number(raw);
  if (!Number.isFinite(value) || (opts.min !== undefined && value < opts.min)) {
    throw new Error(`环境变量 ${name} 必须是有效数字（当前=${raw}）`);
  }
  return value;
}
function booleanEnv(name: string, def: boolean): boolean {
  const raw = optional(name, def ? "1" : "0").toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`环境变量 ${name} 必须是布尔值（1/0/true/false）`);
}
function optionalBooleanEnv(name: string): boolean | undefined {
  if (process.env[name] === undefined) return undefined;
  return booleanEnv(name, false);
}
function digestTimeEnv(): string {
  const raw = optional("DIGEST_TIME", "10:30");
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(raw)) {
    throw new Error(`DIGEST_TIME 必须形如 10:30（24h HH:MM）（当前=${raw}）`);
  }
  return raw;
}
function quietHoursEnv(): [number, number] {
  const raw = optional("QUIET_HOURS", "23-8");
  const [startRaw, endRaw] = raw.split("-");
  const start = Number(startRaw);
  const end = Number(endRaw);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > 23 ||
    end < 0 ||
    end > 23
  ) {
    throw new Error(`QUIET_HOURS 必须形如 23-8，小时范围 0-23（当前=${raw}）`);
  }
  return [start, end];
}

export interface Config {
  /** 读代码 + 写评论/issue（开 thread）；不给写代码权限 */
  githubToken: string;
  feishu: { appId: string; appSecret: string };
  discord: { botToken: string };
  /** 管家主人：群上岗审批 / 个人控制走他的私聊（飞书 open_id）。 */
  operator: { feishuOpenId: string };
  /** 兼容字段：ALLOWED_GROUP_REFS 解析结果，等价于 groups.readWrite 的来源之一。 */
  allowedGroupRefs: string[];
  /** 群发言权：readWrite 群里可发言，readOnly 只存上下文不发言，未列出默认 off。 */
  groups: { readWrite: string[]; readOnly: string[] };
  databaseUrl: string;
  timezone: string;
  quietHours: [number, number];
  /** 隐形：一天最多催一次（默认 1） */
  maxRemindersPerDay: number;
  tickMs: number;
  /** digest 默认发送本地时间 HH:MM（每人可在 Person.digestPref 覆盖） */
  digest: { defaultTime: string };
  llm: {
    provider: string;
    modelId: string;
    cacheRetention: "none" | "short" | "long";
    apiKey: string;
    baseUrl: string;
    compat: {
      supportsStore?: boolean;
      supportsDeveloperRole?: boolean;
      supportsReasoningEffort?: boolean;
      supportsUsageInStreaming?: boolean;
      supportsStrictMode?: boolean;
      maxTokensField?: "max_completion_tokens" | "max_tokens";
    };
  };
  toolRunner: {
    cwd: string;
    model: Config["llm"];
  };
  linkFetch: {
    allowedHosts: string[];
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
    allowedContentTypes: string[];
  };
  retention: {
    rawEvidenceDays: number;
    profileHintsCap: number;
    pendingProposalsCap: number;
  };
  features: {
    review: boolean;
    webfetch: boolean;
    profileReflection: boolean;
  };
}

export function loadConfig(): Config {
  const llmProvider = optional("LLM_PROVIDER", "anthropic");
  const llmModelId = optional("LLM_MODEL_ID", "claude-sonnet-4-6");
  const llm: Config["llm"] = {
    provider: llmProvider,
    modelId: llmModelId,
    cacheRetention: parseCacheRetention(optional("LLM_CACHE_RETENTION", "short")),
    apiKey: llmApiKey(llmProvider),
    baseUrl: optional("LLM_BASE_URL", ""),
    compat: openAiCompatEnv(),
  };
  const toolProvider = optional("TOOL_RUNNER_MODEL_PROVIDER", llm.provider);
  const toolModel: Config["llm"] = {
    ...llm,
    provider: toolProvider,
    modelId: optional("TOOL_RUNNER_MODEL_ID", llm.modelId),
    apiKey: toolRunnerApiKey(toolProvider, llm),
    baseUrl: optional("TOOL_RUNNER_BASE_URL", llm.baseUrl),
  };
  const allowedGroupRefs = optionalList("ALLOWED_GROUP_REFS");
  const config: Config = {
    githubToken: optional("GITHUB_TOKEN", ""),
    feishu: {
      appId: optional("FEISHU_APP_ID", ""),
      appSecret: optional("FEISHU_APP_SECRET", ""),
    },
    discord: { botToken: optional("DISCORD_BOT_TOKEN", "") },
    operator: { feishuOpenId: optional("OPERATOR_FEISHU_OPEN_ID", "") },
    allowedGroupRefs,
    groups: {
      // ALLOWED_GROUP_REFS（兼容）+ GROUPS_READ_WRITE 都算可读写；去重。
      readWrite: [...new Set([...allowedGroupRefs, ...optionalList("GROUPS_READ_WRITE")])],
      readOnly: optionalList("GROUPS_READ_ONLY"),
    },
    databaseUrl: optional("DATABASE_URL", ""), // 空 → 内存 Store；postgres://… → PgStore
    timezone: optional("TZ", "Asia/Shanghai"),
    quietHours: quietHoursEnv(),
    maxRemindersPerDay: numberEnv("MAX_REMINDERS_PER_DAY", 1, { min: 0 }),
    tickMs: numberEnv("TICK_MS", 60_000, { min: 1_000 }),
    digest: { defaultTime: digestTimeEnv() },
    llm,
    toolRunner: {
      cwd: optional("TOOL_RUNNER_CWD", process.cwd()),
      model: toolModel,
    },
    linkFetch: {
      allowedHosts: optionalList("LINK_FETCH_ALLOWED_HOSTS", [
        "github.com",
        "raw.githubusercontent.com",
        "docs.github.com",
      ]),
      timeoutMs: numberEnv("LINK_FETCH_TIMEOUT_MS", 5_000, { min: 100 }),
      maxBytes: numberEnv("LINK_FETCH_MAX_BYTES", 200_000, { min: 1_000 }),
      maxRedirects: numberEnv("LINK_FETCH_MAX_REDIRECTS", 3, { min: 0 }),
      allowedContentTypes: optionalList("LINK_FETCH_ALLOWED_CONTENT_TYPES", [
        "text/html",
        "text/plain",
        "application/json",
        "text/markdown",
      ]),
    },
    retention: {
      rawEvidenceDays: numberEnv("RAW_EVIDENCE_RETENTION_DAYS", 30, { min: 0 }),
      profileHintsCap: numberEnv("PROFILE_HINTS_CAP", 5, { min: 1 }),
      pendingProposalsCap: numberEnv("PENDING_PROFILE_PROPOSALS_CAP", 3, { min: 1 }),
    },
    features: {
      review: booleanEnv("ENABLE_REVIEW", false),
      webfetch: booleanEnv("ENABLE_WEBFETCH", false),
      profileReflection: booleanEnv("ENABLE_PROFILE_REFLECTION", false),
    },
  };
  validateRuntimeShape(config);
  return config;
}

function parseCacheRetention(raw: string): Config["llm"]["cacheRetention"] {
  if (raw === "none" || raw === "short" || raw === "long") return raw;
  throw new Error(`LLM_CACHE_RETENTION 必须是 none/short/long（当前=${raw}）`);
}

function llmApiKey(provider: string, overrideName = "LLM_API_KEY"): string {
  const explicit = optional(overrideName, "");
  if (explicit.length > 0) return explicit;
  if (provider === "anthropic") return optional("ANTHROPIC_API_KEY", "");
  if (provider === "openai") return optional("OPENAI_API_KEY", "");
  if (provider === "openrouter") return optional("OPENROUTER_API_KEY", "");
  return "";
}

function toolRunnerApiKey(provider: string, llm: Config["llm"]): string {
  const explicit = optional("TOOL_RUNNER_API_KEY", "");
  if (explicit.length > 0) return explicit;
  if (provider === llm.provider) return llm.apiKey;
  return llmApiKey(provider);
}

function openAiCompatEnv(): Config["llm"]["compat"] {
  const compat: Config["llm"]["compat"] = {};
  setOptionalBoolean(compat, "supportsStore", "LLM_COMPAT_SUPPORTS_STORE");
  setOptionalBoolean(compat, "supportsDeveloperRole", "LLM_COMPAT_SUPPORTS_DEVELOPER_ROLE");
  setOptionalBoolean(compat, "supportsReasoningEffort", "LLM_COMPAT_SUPPORTS_REASONING_EFFORT");
  setOptionalBoolean(compat, "supportsUsageInStreaming", "LLM_COMPAT_SUPPORTS_USAGE_IN_STREAMING");
  setOptionalBoolean(compat, "supportsStrictMode", "LLM_COMPAT_SUPPORTS_STRICT_MODE");

  const maxTokensField = optional("LLM_COMPAT_MAX_TOKENS_FIELD", "");
  if (maxTokensField.length > 0) {
    if (maxTokensField !== "max_completion_tokens" && maxTokensField !== "max_tokens") {
      throw new Error("LLM_COMPAT_MAX_TOKENS_FIELD 必须是 max_completion_tokens 或 max_tokens");
    }
    compat.maxTokensField = maxTokensField;
  }
  return compat;
}

function setOptionalBoolean(
  target: Config["llm"]["compat"],
  key: keyof Omit<Config["llm"]["compat"], "maxTokensField">,
  envName: string,
): void {
  const value = optionalBooleanEnv(envName);
  if (value !== undefined) target[key] = value;
}

function validateRuntimeShape(config: Config): void {
  const feishuOn = config.feishu.appId.length > 0 && config.feishu.appSecret.length > 0;
  const hasChannel = config.discord.botToken.length > 0 || feishuOn;
  if (!hasChannel) return;

  // 真实群接入必须持久化；内存 Store 只给无频道冒烟用。群发言权不再要求 env allowlist——
  // 群从消息流自助发现（默认只读），operator 私聊提权（见 core/operatorConsole）。
  if (!config.databaseUrl.startsWith("postgres")) {
    throw new Error("启用真实 channel 时必须配置 postgres DATABASE_URL");
  }
  // 启用飞书 → 必须有管家主人：群上岗审批走他的私聊，没有 operator 就没人能批。
  if (feishuOn && config.operator.feishuOpenId.length === 0) {
    throw new Error(
      "启用飞书时必须配置 OPERATOR_FEISHU_OPEN_ID（管家主人 open_id：群上岗审批走他的私聊）",
    );
  }
  validateLlmConfig(config.llm, "LLM");
  validateLlmConfig(config.toolRunner.model, "TOOL_RUNNER");
}

function validateLlmConfig(model: Config["llm"], prefix: string): void {
  if (model.provider !== "openai-compatible") {
    if (model.apiKey.length === 0) {
      throw new Error(`${prefix} provider=${model.provider} 缺少 API key`);
    }
    return;
  }
  if (model.baseUrl.length === 0) {
    throw new Error(`${prefix} openai-compatible 必须配置 BASE_URL`);
  }
  if (model.apiKey.length === 0) {
    throw new Error(`${prefix} openai-compatible 必须配置 API_KEY`);
  }
}
