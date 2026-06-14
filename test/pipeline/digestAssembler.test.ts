import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../src/adapters/store/memory";
import type { Commitment, Evidence } from "../../src/core/domain/types";
import { DigestAssembler, renderDigestText } from "../../src/core/pipeline/digestAssembler";

const NOW = new Date("2026-06-02T04:00:00Z"); // Asia/Shanghai 12:00, 即 2026-06-02

function commitment(over: Partial<Commitment>): Commitment {
  return {
    id: "c1",
    groupRef: "g1",
    assignee: "p1",
    title: "做点事",
    rawText: "",
    source: { channel: "feishu", messageRef: "m", at: NOW },
    status: "active",
    dueAt: null,
    verification: { kind: "none" },
    confidence: 0.9,
    tags: [],
    createdAt: NOW,
    confirmedAt: NOW,
    nextCheckAt: null,
    ...over,
  };
}

async function assemblerWith(commitments: Commitment[], evidence: Evidence[] = []) {
  const store = new InMemoryStore();
  for (const c of commitments) await store.commitments.put(c);
  for (const e of evidence) await store.evidence.put(e);
  return new DigestAssembler({ store, timezone: "Asia/Shanghai" });
}

describe("DigestAssembler.forPerson", () => {
  it("只留两类:到期、卡住没动;on-track 和未来才到期的不进每日", async () => {
    const a = await assemblerWith([
      commitment({ id: "c1", title: "逾期的", dueAt: new Date("2026-06-01T10:00:00Z") }),
      commitment({ id: "c2", title: "今天的", dueAt: new Date("2026-06-02T09:00:00Z") }),
      commitment({ id: "c3", title: "未来的", dueAt: new Date("2026-06-09T10:00:00Z") }),
      commitment({ id: "c4", title: "没截止·进行中", dueAt: null }),
      commitment({ id: "c5", title: "at_risk·卡住", status: "at_risk", dueAt: null }),
      commitment({
        id: "c6",
        title: "别人的",
        assignee: "p2",
        dueAt: new Date("2026-06-01T10:00:00Z"),
      }),
      commitment({
        id: "c7",
        title: "已完成",
        status: "fulfilled",
        dueAt: new Date("2026-06-01T10:00:00Z"),
      }),
    ]);

    const d = await a.forPerson("p1", NOW);

    expect(d.title).toBe("今日 todo · 2026-06-02");
    expect(d.sections.map((s) => s.heading)).toEqual(["到期", "卡住没动"]);
    // 到期 = 逾期的 + 今天的（按 due 升序），不含别人的 / 已完成的
    expect(d.sections[0]?.items.map((i) => i.text)).toEqual(["逾期的", "今天的"]);
    expect(d.sections[0]?.items[0]?.status).toBe("overdue");
    expect(d.sections[0]?.items[1]?.status).toBe("due_today");
    // 卡住没动 = 仅 at_risk；未来的 / 没截止进行中的不进
    expect(d.sections[1]?.items.map((i) => i.text)).toEqual(["at_risk·卡住"]);
  });

  it("证据回退(no_change/regressed)的未到期承诺也算卡住", async () => {
    const a = await assemblerWith(
      [commitment({ id: "c1", title: "停滞的", dueAt: new Date("2026-06-09T10:00:00Z") })],
      [evidence("c1", "no_change", "页面还是空的")],
    );
    const d = await a.forPerson("p1", NOW);
    expect(d.sections.map((s) => s.heading)).toEqual(["卡住没动"]);
    expect(d.sections[0]?.items[0]?.text).toContain("停滞的");
    expect(d.sections[0]?.items[0]?.text).toContain("页面还是空的");
  });

  it("信号诚实:有证据给真话;link/github 没查到给「没确认」;none/manual 不给", async () => {
    const a = await assemblerWith(
      [
        commitment({
          id: "c1",
          title: "有证据",
          dueAt: new Date("2026-06-02T09:00:00Z"),
          verification: { kind: "link", urls: ["https://x/pr/12"], expectation: "merged" },
        }),
        commitment({
          id: "c2",
          title: "没查到",
          dueAt: new Date("2026-06-02T09:00:00Z"),
          verification: { kind: "link", urls: ["https://x/pr/13"], expectation: "merged" },
        }),
        commitment({ id: "c3", title: "无需查证", dueAt: new Date("2026-06-02T09:00:00Z") }),
      ],
      [evidence("c1", "progressed", "PR 开着,CI 绿")],
    );
    const items = (await a.forPerson("p1", NOW)).sections[0]?.items ?? [];
    expect(items.find((i) => i.text.startsWith("有证据"))?.text).toContain("PR 开着,CI 绿");
    expect(items.find((i) => i.text.startsWith("有证据"))?.link).toBe("https://x/pr/12");
    expect(items.find((i) => i.text.startsWith("没查到"))?.text).toBe("没查到 · 没确认");
    expect(items.find((i) => i.text.startsWith("无需查证"))?.text).toBe("无需查证");
  });

  it("没到期、没卡住 → sections 为空(不推空 digest)", async () => {
    const a = await assemblerWith([
      commitment({ id: "c1", dueAt: new Date("2026-06-09T10:00:00Z") }),
      commitment({ id: "c2", status: "fulfilled" }),
    ]);
    expect((await a.forPerson("p1", NOW)).sections).toEqual([]);
  });
});

describe("renderDigestText", () => {
  it("渲染成纯文本 fallback", () => {
    const text = renderDigestText({
      title: "今日 todo · 2026-06-02",
      audience: { kind: "person", ref: "p1" },
      sections: [
        {
          heading: "到期",
          items: [{ text: "登录修复", status: "due_today", link: "https://x/pr/12" }],
        },
      ],
    });
    expect(text).toBe("今日 todo · 2026-06-02\n\n到期\n· 登录修复 https://x/pr/12");
  });
});

function evidence(commitmentId: string, verdict: Evidence["verdict"], summary: string): Evidence {
  return {
    id: `e-${commitmentId}`,
    commitmentId,
    capturedAt: NOW,
    source: "link",
    verdict,
    summary,
    raw: null,
  };
}
