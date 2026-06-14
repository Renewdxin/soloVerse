import { describe, expect, it } from "vitest";
import { playscript } from "../../demo/web/server";

// 帧的最小结构（playscript 返回 unknown，这里按用到的字段窄化）。
interface FeedRow {
  kind: string;
  text?: string;
  reason?: string;
}
interface Frame {
  scene?: string;
  taste?: {
    good: { passed: boolean };
    bad: { passed: boolean; violations: unknown[] };
  };
  state: {
    feed: FeedRow[];
    ledger: { status: string }[];
    digest: { text: string } | null;
  };
}

describe("web 收发站 playscript", () => {
  it("跑完 7 幕：覆盖捕获 / 沉默 / 自动结案 / 临期催办 / digest / 品味", async () => {
    const { frames } = (await playscript()) as { frames: Frame[] };
    expect(frames.length).toBeGreaterThan(8);

    const botText = frames.flatMap((f) =>
      f.state.feed.filter((r) => r.kind === "bot").map((r) => r.text ?? ""),
    );
    const silences = frames.flatMap((f) => f.state.feed.filter((r) => r.kind === "silence"));

    // 捕获 → 确认
    expect(botText.some((t) => t.includes("记一笔"))).toBe(true);
    expect(botText.some((t) => t.includes("跟上了"))).toBe(true);
    // 自己核实 → 自动结案
    expect(botText.some((t) => t.includes("这条结了"))).toBe(true);
    // 临期催办
    expect(botText.some((t) => t.includes("due 不远了"))).toBe(true);
    // 挣来的沉默（含护栏静默）
    expect(silences.length).toBeGreaterThan(0);

    // 台账：支付承诺被结案
    const finalLedger = frames.at(-1)?.state.ledger ?? [];
    expect(finalLedger.some((c) => c.status === "fulfilled")).toBe(true);

    // digest：私聊台账推出去了
    const lastDigest = frames
      .map((f) => f.state.digest)
      .filter((d): d is { text: string } => d !== null)
      .at(-1);
    expect(lastDigest?.text).toContain("今日 todo");

    // 品味：好措辞 PASS、谄媚/羞辱措辞 FAIL（dogfood：管家自己的话过得了 floor）
    const taste = frames.map((f) => f.taste).find((t) => t !== undefined);
    expect(taste?.good.passed).toBe(true);
    expect(taste?.bad.passed).toBe(false);
    expect((taste?.bad.violations ?? []).length).toBeGreaterThan(0);
  });
});
