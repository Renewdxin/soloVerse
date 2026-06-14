import type { Evidence, VerificationSpec } from "../../core/domain/types";
import type { LlmPort, VerifierAdapter } from "../../core/ports";
import type { SafeLinkFetcher } from "./safeLinkFetcher";

/** 默认 verifier：只经 SafeLinkFetcher 抓允许域名；弱信号不自动结案，由策略层继续控风险。 */
export class LinkVerifier implements VerifierAdapter {
  readonly kind = "link" as const;

  constructor(
    private readonly deps: {
      fetcher: SafeLinkFetcher;
      llm: LlmPort;
      clock: { now(): Date };
      newId(): string;
    },
  ) {}

  async fetchState(
    commitment: { id: string; title: string; verification: VerificationSpec },
    previous: Evidence | null,
  ): Promise<Evidence> {
    if (commitment.verification.kind !== "link") {
      throw new Error(`LinkVerifier 收到错误 verification kind：${commitment.verification.kind}`);
    }
    const result = await this.deps.fetcher.fetchMany(commitment.verification.urls);
    if (result.fetched.length === 0) {
      return {
        id: this.deps.newId(),
        commitmentId: commitment.id,
        capturedAt: this.deps.clock.now(),
        source: "link",
        verdict: "inconclusive",
        summary: `链接未抓取：${result.denied.map((d) => d.reason).join("；")}`,
        raw: result,
      };
    }
    const decision = await this.deps.llm.verifyLink({
      commitment: { title: commitment.title, expectation: commitment.verification.expectation },
      fetched: result.fetched.map((f) => ({
        url: f.url,
        status: f.status,
        content: f.content,
      })),
      previous,
    });
    return {
      id: this.deps.newId(),
      commitmentId: commitment.id,
      capturedAt: this.deps.clock.now(),
      source: "link",
      verdict: decision.verdict,
      summary: decision.summary,
      raw: { fetched: result.fetched, denied: result.denied, confidence: decision.confidence },
    };
  }
}
