import { describe, expect, it } from "vitest";
import { Extractor, type ExtractorOptions } from "../../src/core/pipeline/extractor";
import type { Clock, ExtractionOutput, InboundMessage, LlmPort } from "../../src/core/ports";

const NOW = new Date("2026-06-01T00:00:00Z");
const clock: Clock = { now: () => NOW };

function fakeLlm(out: ExtractionOutput): LlmPort {
  return {
    extractCommitment: async () => out,
    verifyLink: async () => {
      throw new Error("unused");
    },
    decideIntervention: async () => {
      throw new Error("unused");
    },
  };
}

function msg(text: string): InboundMessage {
  return {
    channel: "discord",
    groupRef: "g1",
    authorRef: "u-li",
    text,
    replyToRef: null,
    messageRef: "m1",
    at: NOW,
    raw: null,
  };
}

const opts: ExtractorOptions = {
  timezone: "Asia/Shanghai",
  knownRepos: [],
  minConfidence: 0.6,
  newId: () => "cid-1",
};

describe("Extractor.propose", () => {
  it("高置信承诺 → proposed Commitment，触发消息作者为 assignee，URL 绑成 link", async () => {
    const ex = new Extractor(
      fakeLlm({
        isCommitment: true,
        confidence: 0.9,
        title: "修复登录 bug",
        dueAt: "2026-06-03T15:59:00Z",
      }),
      clock,
      opts,
    );
    const c = await ex.propose([msg("周三前修复登录 https://github.com/x/y/pull/12")], "p-li");
    expect(c?.status).toBe("proposed");
    expect(c?.assignee).toBe("p-li");
    expect(c?.title).toBe("修复登录 bug");
    expect(c?.verification.kind).toBe("link");
    expect(c?.dueAt?.toISOString()).toBe("2026-06-03T15:59:00.000Z");
  });

  it("无 URL → verification none", async () => {
    const ex = new Extractor(
      fakeLlm({ isCommitment: true, confidence: 0.8, title: "给客户打电话", dueAt: null }),
      clock,
      opts,
    );
    const c = await ex.propose([msg("下午给客户打个电话")], "p-zhang");
    expect(c?.verification.kind).toBe("none");
  });

  it("低置信 → null（宁可漏不可误）", async () => {
    const ex = new Extractor(
      fakeLlm({ isCommitment: true, confidence: 0.3, title: "看看", dueAt: null }),
      clock,
      opts,
    );
    expect(await ex.propose([msg("我看看吧")], "p")).toBeNull();
  });

  it("非承诺 → null", async () => {
    const ex = new Extractor(
      fakeLlm({ isCommitment: false, confidence: 0.9, dueAt: null }),
      clock,
      opts,
    );
    expect(await ex.propose([msg("哈哈")], "p")).toBeNull();
  });

  it("LLM 回非 ISO 的 dueAt（「明天」）→ dueAt 置 null，不抛 RangeError", async () => {
    const ex = new Extractor(
      fakeLlm({ isCommitment: true, confidence: 0.9, title: "改文档", dueAt: "明天" }),
      clock,
      opts,
    );
    const c = await ex.propose([msg("明天改下文档")], "p");
    expect(c).not.toBeNull();
    expect(c?.dueAt).toBeNull(); // 解析失败 → 无截止，而不是 Invalid Date
    expect(() => c?.dueAt?.toISOString()).not.toThrow();
  });
});
