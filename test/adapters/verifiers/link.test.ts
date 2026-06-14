import { describe, expect, it } from "vitest";
import { LinkVerifier } from "../../../src/adapters/verifiers/link";
import type { SafeLinkFetcher } from "../../../src/adapters/verifiers/safeLinkFetcher";
import type { Commitment, Evidence } from "../../../src/core/domain/types";
import type { LlmPort } from "../../../src/core/ports";

const NOW = new Date("2026-06-01T10:00:00.000Z");

function commitment(): Commitment {
  return {
    id: "c1",
    groupRef: "g1",
    assignee: "p1",
    title: "发布 Railway 部署文档",
    rawText: "我今天发 Railway 部署文档",
    source: { channel: "discord", messageRef: "m1", at: NOW },
    status: "active",
    dueAt: null,
    verification: {
      kind: "link",
      urls: ["https://github.com/org/repo/pull/1"],
      expectation: "文档 PR 已合并或内容已发布",
    },
    confidence: 0.9,
    tags: [],
    createdAt: NOW,
    confirmedAt: NOW,
    nextCheckAt: NOW,
  };
}

describe("LinkVerifier", () => {
  it("没有任何安全抓取结果时返回 inconclusive，不调用 LLM", async () => {
    const llm: LlmPort = {
      extractCommitment: async () => ({ isCommitment: false, confidence: 0 }),
      verifyLink: async () => {
        throw new Error("should not call llm");
      },
      decideIntervention: async () => ({ decision: "silent", reason: "unused" }),
    };
    const fetcher = {
      fetchMany: async () => ({
        fetched: [],
        denied: [{ url: "https://github.com/org/repo/pull/1", reason: "webfetch 未启用" }],
      }),
    } as Pick<SafeLinkFetcher, "fetchMany"> as SafeLinkFetcher;
    const verifier = new LinkVerifier({
      fetcher,
      llm,
      clock: { now: () => NOW },
      newId: () => "e1",
    });

    const evidence = await verifier.fetchState(commitment(), null);

    expect(evidence).toMatchObject({
      id: "e1",
      commitmentId: "c1",
      source: "link",
      verdict: "inconclusive",
    });
    expect(evidence.summary).toContain("webfetch 未启用");
  });

  it("把安全抓取文本交给 LLM，并保留 denied 作为 raw 审计", async () => {
    const previous: Evidence = {
      id: "old",
      commitmentId: "c1",
      capturedAt: NOW,
      source: "link",
      verdict: "progressed",
      summary: "看到草稿",
      raw: null,
    };
    let seenPrevious: Evidence | null = null;
    const llm: LlmPort = {
      extractCommitment: async () => ({ isCommitment: false, confidence: 0 }),
      verifyLink: async (input) => {
        seenPrevious = input.previous;
        expect(input.commitment.expectation).toContain("文档 PR");
        expect(input.fetched[0]?.content).toContain("merged");
        return { verdict: "completed", summary: "PR merged", confidence: 0.92 };
      },
      decideIntervention: async () => ({ decision: "silent", reason: "unused" }),
    };
    const fetcher = {
      fetchMany: async () => ({
        fetched: [
          {
            url: "https://github.com/org/repo/pull/1",
            status: 200,
            contentType: "text/html",
            content: "merged",
          },
        ],
        denied: [{ url: "https://example.com/private", reason: "host 不在 allowlist" }],
      }),
    } as Pick<SafeLinkFetcher, "fetchMany"> as SafeLinkFetcher;
    const verifier = new LinkVerifier({
      fetcher,
      llm,
      clock: { now: () => NOW },
      newId: () => "e2",
    });

    const evidence = await verifier.fetchState(commitment(), previous);

    expect(seenPrevious).toBe(previous);
    expect(evidence).toMatchObject({
      id: "e2",
      commitmentId: "c1",
      verdict: "completed",
      summary: "PR merged",
    });
    expect(evidence.raw).toMatchObject({ confidence: 0.92 });
  });
});
