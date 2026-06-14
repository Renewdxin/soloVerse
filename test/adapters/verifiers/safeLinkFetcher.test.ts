import { describe, expect, it, vi } from "vitest";
import {
  type SafeLinkFetchConfig,
  SafeLinkFetcher,
} from "../../../src/adapters/verifiers/safeLinkFetcher";

const BASE_CONFIG: SafeLinkFetchConfig = {
  enabled: true,
  allowedHosts: ["example.com", "github.com"],
  timeoutMs: 1_000,
  maxBytes: 64,
  maxRedirects: 2,
  allowedContentTypes: ["text/plain", "text/html"],
};

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain", ...(init.headers ?? {}) },
    ...init,
  });
}

describe("SafeLinkFetcher", () => {
  it("webfetch 关闭时不访问网络", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const fetcher = new SafeLinkFetcher(
      { ...BASE_CONFIG, enabled: false },
      { fetch, resolve: async () => ["93.184.216.34"] },
    );

    const result = await fetcher.fetchMany(["https://example.com/a"]);

    expect(result.fetched).toEqual([]);
    expect(result.denied[0]?.reason).toContain("webfetch 未启用");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("拒绝非 http(s)、credentials URL 和非 allowlist host", async () => {
    const fetcher = new SafeLinkFetcher(BASE_CONFIG, {
      fetch: vi.fn<typeof globalThis.fetch>(),
      resolve: async () => ["93.184.216.34"],
    });

    const result = await fetcher.fetchMany([
      "file:///etc/passwd",
      "https://user:pass@example.com/a",
      "https://evil.test/a",
    ]);

    expect(result.fetched).toHaveLength(0);
    expect(result.denied.map((d) => d.reason).join("\n")).toContain("scheme 不允许");
    expect(result.denied.map((d) => d.reason).join("\n")).toContain("username/password");
    expect(result.denied.map((d) => d.reason).join("\n")).toContain("host 不在 allowlist");
  });

  it("DNS 解析到私网或 metadata IP 时拒绝请求", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const fetcher = new SafeLinkFetcher(BASE_CONFIG, {
      fetch,
      resolve: async () => ["169.254.169.254"],
    });

    const result = await fetcher.fetchMany(["https://example.com/latest"]);

    expect(result.fetched).toEqual([]);
    expect(result.denied[0]?.reason).toContain("非公网 IP");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("redirect 后重新校验目标 host 和 IP", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response("", { status: 302, headers: { location: "https://github.com/org/repo" } }),
      )
      .mockResolvedValueOnce(textResponse("merged"));
    const fetcher = new SafeLinkFetcher(BASE_CONFIG, {
      fetch,
      resolve: async (host) => (host === "github.com" ? ["140.82.114.4"] : ["93.184.216.34"]),
    });

    const result = await fetcher.fetchMany(["https://example.com/start"]);

    expect(result.denied).toEqual([]);
    expect(result.fetched[0]).toMatchObject({
      url: "https://github.com/org/repo",
      status: 200,
      content: "merged",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("拒绝不允许的 content-type 和超限响应", async () => {
    const fetcher = new SafeLinkFetcher(BASE_CONFIG, {
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(
          textResponse("zip", { headers: { "content-type": "application/zip" } }),
        )
        .mockResolvedValueOnce(textResponse("x".repeat(65))),
      resolve: async () => ["93.184.216.34"],
    });

    const result = await fetcher.fetchMany(["https://example.com/a", "https://example.com/b"]);

    expect(result.fetched).toEqual([]);
    expect(result.denied.map((d) => d.reason).join("\n")).toContain("content-type 不允许");
    expect(result.denied.map((d) => d.reason).join("\n")).toContain("响应超过 64 bytes");
  });
});
