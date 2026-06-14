// Web 收发站 —— 后端（Node 自带 http，零新依赖，tsx 跑：npm run demo:web）。
// 复用 demo/harness 的真实大脑；网页层只渲染，不含业务逻辑。见
// docs/plans/2026-06-15-web-demo-sandbox-design.md。
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Commitment, Verdict } from "../../src/core/domain/types";
import { fullTasteCheck } from "../../src/core/taste/judge";
import type { TasteContext } from "../../src/core/taste/rubric";
import { type Brain, beijing, buildBrain, GROUP, inbound, type World } from "../harness";

const WEB_DIR = dirname(fileURLToPath(import.meta.url));
const TZ = "Asia/Shanghai";
const START = beijing(2026, 6, 16, 10); // 周二 10:00

const CAST = [
  { id: "p-li", name: "李四", ref: "ou-li" },
  { id: "p-zhang", name: "张伟", ref: "ou-zhang" },
  { id: "p-wang", name: "王芳", ref: "ou-wang" },
];

interface Session {
  brain: Brain;
  /** 最近一次私聊 digest（sendDirect 收上来的）。 */
  state: { lastDigest: { recipient: string; text: string } | null };
}

/** 起一个新会话：接好大脑、把私聊 digest 收进 session、预置示例剧组与一条 GitHub 承诺。 */
async function freshSession(): Promise<Session> {
  const state: Session["state"] = { lastDigest: null };
  const brain = buildBrain(START, {
    onDirectSend: (out, recipient) => {
      state.lastDigest = { recipient, text: out.text };
    },
  });
  for (const p of CAST) {
    await brain.store.people.put({
      id: p.id,
      displayName: p.name,
      handles: [{ channel: "feishu", userRef: p.ref }],
      isOperator: false,
    });
  }
  // 预置一条上周已绑到 GitHub PR 的承诺（张伟），用于演示「自己核实 → 结案」。
  const payback: Commitment = {
    id: "c-payback",
    groupRef: GROUP,
    assignee: "p-zhang",
    title: "支付回调修复（PR #57）",
    rawText: "支付回调这块我来修，PR #57",
    source: { channel: "feishu", messageRef: "m-seed", at: beijing(2026, 6, 15, 10) },
    status: "active",
    dueAt: beijing(2026, 6, 18, 18),
    verification: { kind: "github", repo: "acme/app", ref: { pr: 57 }, mustBeMerged: true },
    confidence: 0.9,
    tags: [],
    createdAt: beijing(2026, 6, 15, 10),
    confirmedAt: beijing(2026, 6, 15, 10),
    nextCheckAt: beijing(2026, 6, 18, 9),
  };
  await brain.store.commitments.put(payback);
  return { brain, state };
}

let session: Session = await freshSession();

// —— 状态快照：网页要画的一切都从真实 store 里读出来 ——
async function snapshot(): Promise<unknown> {
  const { store, clock, world } = session.brain;
  const people = await store.people.all();
  const nameOf = (ref: string): string =>
    ref === "bot"
      ? "管家"
      : (people.find((p) => p.handles.some((h) => h.userRef === ref))?.displayName ?? ref);

  const interactions = await store.interactions.all();
  const interventions = await store.interventions.all();
  const commitments = await store.commitments.all();
  const evidence = await store.evidence.all();
  const titleOf = (cid: string | null): string =>
    commitments.find((c) => c.id === cid)?.title ?? "";

  type Row =
    | { kind: "human"; at: number; name: string; text: string }
    | { kind: "bot"; at: number; text: string }
    | { kind: "silence"; at: number; reason: string; title: string };
  const feed: Row[] = [];
  for (const i of interactions) {
    if (i.direction === "in")
      feed.push({ kind: "human", at: i.at.getTime(), name: nameOf(i.authorRef), text: i.text });
    else feed.push({ kind: "bot", at: i.at.getTime(), text: i.text });
  }
  for (const v of interventions) {
    if (v.message === null)
      feed.push({
        kind: "silence",
        at: v.at.getTime(),
        reason: v.reason,
        title: titleOf(v.commitmentId),
      });
  }
  feed.sort((a, b) => a.at - b.at);

  const latestVerdict = (cid: string): Verdict | null =>
    evidence
      .filter((e) => e.commitmentId === cid)
      .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())
      .at(-1)?.verdict ?? null;

  const ledger = commitments
    .filter((c) => c.status !== "proposed")
    .map((c) => ({
      id: c.id,
      title: c.title,
      assigneeId: c.assignee,
      assignee: nameOf(people.find((p) => p.id === c.assignee)?.handles[0]?.userRef ?? ""),
      due: c.dueAt === null ? null : fmtDue(c.dueAt),
      status: c.status,
      verdict: latestVerdict(c.id),
      kind: c.verification.kind,
      world:
        c.verification.kind === "github"
          ? world.merged.has(c.id)
            ? "merged"
            : "open"
          : (world.link.get(c.id) ?? "no_change"),
    }));

  return {
    clock: { iso: clock.now().toISOString(), label: fmtClock(clock.now()) },
    feed,
    ledger,
    digest: session.state.lastDigest,
  };
}

function fmtClock(d: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ,
    weekday: "short",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}
function fmtDue(d: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ,
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

// —— 动作 ——
async function handleSay(as: string, text: string): Promise<void> {
  await session.brain.router.handle(inbound(as, text, session.brain.clock.now()));
}

async function handleAdvance(to: string): Promise<void> {
  const { clock, store, commitmentJob } = session.brain;
  const now = clock.now();
  const active = (await store.commitments.all()).filter(
    (c) => (c.status === "active" || c.status === "at_risk") && c.dueAt !== null,
  );
  const soonestDue = active
    .map((c) => (c.dueAt as Date).getTime())
    .sort((a, b) => a - b)
    .at(0);
  if (to === "due" && soonestDue !== undefined) clock.set(new Date(soonestDue - 3 * 3_600_000));
  else if (to === "overdue" && soonestDue !== undefined)
    clock.set(new Date(soonestDue + 15 * 3_600_000));
  else clock.set(new Date(now.getTime() + 24 * 3_600_000));
  await commitmentJob.runDue(clock.now());
}

async function handleWorld(commitmentId: string, set: string): Promise<void> {
  const w: World = session.brain.world;
  if (set === "merged") w.merged.add(commitmentId);
  else w.link.set(commitmentId, set as Verdict);
}

async function handleDigest(personId: string): Promise<void> {
  await session.brain.pushPersonDigest(personId);
}

async function handleTaste(message: string): Promise<unknown> {
  const ctx: TasteContext = { decision: "remind", latestVerdict: "no_change" };
  const v = await fullTasteCheck(message, ctx, "web demo", null);
  return { passed: v.passed, violations: v.violations };
}

// —— HTTP ——
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      try {
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function json(res: ServerResponse, body: unknown, code = 200): void {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(s);
}

async function serveStatic(res: ServerResponse, path: string): Promise<void> {
  const file = path === "/" ? "index.html" : path.replace(/^\//, "");
  try {
    const buf = await readFile(join(WEB_DIR, file));
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404).end("not found");
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  try {
    if (!url.startsWith("/api/")) return await serveStatic(res, url.split("?")[0] ?? "/");

    const body = req.method === "POST" ? await readBody(req) : {};
    switch (url) {
      case "/api/state":
        return json(res, await snapshot());
      case "/api/say":
        await handleSay(str(body.as), str(body.text));
        return json(res, await snapshot());
      case "/api/advance":
        await handleAdvance(str(body.to));
        return json(res, await snapshot());
      case "/api/world":
        await handleWorld(str(body.commitmentId), str(body.set));
        return json(res, await snapshot());
      case "/api/digest":
        await handleDigest(str(body.personId));
        return json(res, await snapshot());
      case "/api/taste":
        return json(res, await handleTaste(str(body.message)));
      case "/api/reset":
        session = await freshSession();
        return json(res, await snapshot());
      default:
        return json(res, { error: "unknown endpoint" }, 404);
    }
  } catch (err) {
    json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

const PORT = Number(process.env.PORT ?? 5173);
server.listen(PORT, () => {
  console.log(`[收发站] http://localhost:${PORT}  （Ctrl-C 退出）`);
});
