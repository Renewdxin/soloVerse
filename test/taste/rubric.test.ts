import { describe, expect, it } from "vitest";
import { scoreMessage, type TasteContext } from "../../src/core/taste/rubric";

// 这套测试是「判官的判官」：用手写的合格 / 不合格范例，证明确定性维度真的能区分。
const remind: TasteContext = { decision: "remind", latestVerdict: "no_change" };
const done: TasteContext = { decision: "celebrate", latestVerdict: "completed" };

function dims(message: string, ctx: TasteContext): string[] {
  return scoreMessage(message, ctx).violations.map((v) => v.dimension);
}

describe("rubric 确定性 floor", () => {
  describe("合格措辞通过", () => {
    it("临期提醒：一句话、给体面出口", () => {
      const r = scoreMessage("登录 bug 离 due 不远了，需要我把相关 PR 翻出来吗？", remind);
      expect(r.passed).toBe(true);
      expect(r.violations).toHaveLength(0);
      expect(r.score).toBe(1);
    });

    it("完成庆祝：单 emoji + 简短", () => {
      const r = scoreMessage("✅ 修复登录 bug，这条结了。", done);
      expect(r.passed).toBe(true);
      expect(r.violations).toHaveLength(0);
    });

    it("重新协商：体面出口", () => {
      const r = scoreMessage("发布脚本这条卡了两天，要不要挪到下周？", {
        decision: "suggest_renegotiate",
        latestVerdict: "no_change",
      });
      expect(r.passed).toBe(true);
    });
  });

  describe("blocker：出局", () => {
    it("管家 cosplay / 谄媚体被拦", () => {
      const m = "尊敬的主人，请允许我提醒您登录 bug。";
      expect(scoreMessage(m, remind).passed).toBe(false);
      expect(dims(m, remind)).toContain("no-cosplay");
    });

    it("羞辱 / 指责语气被拦", () => {
      const m = "你怎么还没修好登录 bug，拖延到现在。";
      expect(scoreMessage(m, remind).passed).toBe(false);
      expect(dims(m, remind)).toContain("no-shaming");
    });

    it("啰嗦（过长）被拦", () => {
      const m =
        "关于登录 bug 这件事我前前后后想了很久，觉得还是非常有必要专门花点时间提醒你一下，毕竟它已经被搁置好几天了，希望你能够尽快安排出时间把它彻底处理掉，谢谢你的配合与理解。";
      expect(scoreMessage(m, remind).passed).toBe(false);
      expect(dims(m, remind)).toContain("terse");
    });

    it("话多（超过两句）被拦", () => {
      const m = "登录 bug 还没动吧。这事拖着对大家都不太好。今天方便处理一下吗。";
      expect(scoreMessage(m, remind).passed).toBe(false);
      expect(dims(m, remind)).toContain("terse");
    });

    it("连环追问（两个问号）被拦", () => {
      const m = "要不要我来看？需要我盯一下吗？";
      expect(scoreMessage(m, remind).passed).toBe(false);
      expect(dims(m, remind)).toContain("single-ask");
    });

    it("无证据却声称完成被拦（依赖情境）", () => {
      const m = "这个我看已经完成了。";
      expect(scoreMessage(m, remind).passed).toBe(false);
      expect(dims(m, remind)).toContain("no-fake-progress");
    });

    it("有完成证据时说完成不拦", () => {
      const r = scoreMessage("这条完成了。", done);
      expect(r.passed).toBe(true);
      expect(dims("这条完成了。", done)).not.toContain("no-fake-progress");
    });
  });

  describe("warn：不致命但压低 score", () => {
    it("emoji 过多 → warn，仍 passed", () => {
      const m = "🎉🎉 登录 bug 修好啦 🚀";
      const r = scoreMessage(m, done);
      expect(r.passed).toBe(true);
      expect(dims(m, done)).toContain("no-emoji-spam");
      expect(r.score).toBeLessThan(1);
    });

    it("越界打包票 → warn", () => {
      const m = "这个我保证今晚弄好。";
      const r = scoreMessage(m, remind);
      expect(r.passed).toBe(true);
      expect(dims(m, remind)).toContain("no-over-promise");
    });
  });
});
