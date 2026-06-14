// Demo 剧本 —— 一段工作群的时间线，跑在真实的捕获/评估/护栏/台账/品味代码上。
// 跑：npm run demo   （零配置；要看真实 LLM：DEMO_LLM=real + 配好 LLM_* 后再跑）
//
// 每个场景对应一条产品主张（capture-not-log / 挣来的沉默 / verify-not-ask /
// 临期分寸 / 群问责·私聊个人 / 品味是机制不是运气）。被模拟的只有边缘：
// 脚本化 LLM 和链接/GitHub 状态；中间的判断全是 src/core 的真实代码。
import { BUTLER_PERSONA } from "../src/adapters/llm/prompts/persona";
import type { Commitment } from "../src/core/domain/types";
import { fullTasteCheck } from "../src/core/taste/judge";
import type { TasteContext } from "../src/core/taste/rubric";
import { beijing, buildBrain, GROUP, inbound } from "./harness";
import * as ui from "./ui";

const LI = { id: "p-li", name: "李四", ref: "ou-li" };
const ZHANG = { id: "p-zhang", name: "张伟", ref: "ou-zhang" };
const WANG = { id: "p-wang", name: "王芳", ref: "ou-wang" };

async function main(): Promise<void> {
  const brain = buildBrain(beijing(2026, 6, 16, 10));
  const { store, clock, world, router, commitmentJob, outbox, pushPersonDigest } = brain;

  // 轻量身份（无账号；真实运行里 Router 也会从消息流里自动建人）。
  for (const p of [LI, ZHANG, WANG]) {
    await store.people.put({
      id: p.id,
      displayName: p.name,
      handles: [{ channel: "feishu", userRef: p.ref }],
      isOperator: false,
    });
  }

  // —— 小工具：拨表 / 改调度锚点 / 跑一次到期评估并把"管家的理由"亮出来。——
  const at = (d: Date): void => clock.set(d);
  const setNext = async (id: string, next: Date | null): Promise<void> => {
    const c = await store.commitments.get(id);
    if (c !== null) await store.commitments.put({ ...c, nextCheckAt: next });
  };
  const say = async (
    who: { name: string; ref: string },
    text: string,
    silentReason?: string,
  ): Promise<void> => {
    ui.human(clock.now(), who.name, text);
    const before = outbox.length;
    await router.handle(inbound(who.ref, text, clock.now()));
    if (outbox.length === before && silentReason !== undefined) ui.silence(silentReason);
  };
  /** 真实调度作业（CommitmentJob.runDue）：取到期承诺 → 评估；再回读它的决定与理由打印出来。 */
  const tick = async (): Promise<void> => {
    const due = await store.dueCommitments(clock.now());
    await commitmentJob.runDue(clock.now());
    for (const c of due) {
      const iv = (await store.interventions.all())
        .filter((i) => i.commitmentId === c.id)
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .at(-1);
      if (iv === undefined) continue;
      if (iv.message === null) ui.silence(`${c.title} —— ${iv.reason}`);
      else ui.aside(`管家决定：${iv.decision} —— ${iv.reason}`);
    }
  };

  ui.banner(
    "团队答应的事总没下文，你又不想天天追、更不想给团队装个监工。它替你盯：该记的记、该催的催，平时不出声——下面是它陪一个小团队的一周。",
  );
  ui.note("  它的行事分寸：");
  for (const line of BUTLER_PERSONA.split("\n").slice(1)) {
    if (line.trim().length > 0) ui.note(`    ${line.trim()}`);
  }

  // 预置一条"上周已绑到 GitHub PR"的承诺（张伟），用于演示强证据自动结案。
  const payback: Commitment = {
    id: "c-payback",
    groupRef: GROUP,
    assignee: ZHANG.id,
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
  await store.commitments.put(payback);

  // ———————————————————————————————————————————————————————
  ui.scene(
    1,
    "捕获，而不是记账",
    "痛点：嘴上答应的事没人记、群一刷就埋了。它从对话里自动记下、确认一句就跟上——没人需要去填表。",
  );
  // ———————————————————————————————————————————————————————
  at(beijing(2026, 6, 16, 10));
  await say(WANG, "@李四 登录鉴权这块你来跟一下？", "不抢话：这是派活，等李四自己认领。");
  await say(LI, "行，我接了。登录 API 的 PR 周五前发出来：https://github.com/acme/app/pull/42");
  await say(LI, "对");
  await say(ZHANG, "今晚团建去哪吃？", "闲聊，不是承诺——不接。");

  const login = (await store.commitments.all()).find(
    (c) => c.assignee === LI.id && c.status === "active",
  );
  if (login === undefined) throw new Error("demo 装配失败：登录承诺没建起来");
  ui.aside(`已建档：「${login.title}」· 截止 ${fmt(login.dueAt)} · 状态 ${login.status}`);

  // ———————————————————————————————————————————————————————
  ui.scene(
    2,
    "挣来的沉默",
    "痛点：管理工具整天弹通知，团队烦、你也麻木。在 track 的事它一个字不说；它一出声，就是真有事。",
  );
  // ———————————————————————————————————————————————————————
  world.link.set(login.id, "progressed");
  await setNext(login.id, beijing(2026, 6, 17, 10));
  at(beijing(2026, 6, 17, 10));
  ui.note("  · 调度器到点，巡检李四的登录 PR……");
  await tick();
  ui.aside("你只在该管的时候被惊动；其余时间它替你扛着，不刷存在感。");
  await setNext(login.id, beijing(2026, 6, 19, 15)); // 下次巡检挪到临期那天

  // ———————————————————————————————————————————————————————
  ui.scene(
    3,
    "自己去核实，而不是问人",
    "痛点：『做完没』『在做了』来回扯皮。它自己看 PR——合并了直接结案，不靠嘴汇报。",
  );
  // ———————————————————————————————————————————————————————
  world.merged.add(payback.id);
  at(beijing(2026, 6, 18, 9));
  ui.note("  · GitHub：acme/app#57 已 merge；调度器到点巡检……");
  await tick();
  ui.aside("进度有据可查、不是谁说了算——你看到『结了』就是真的结了。");

  // ———————————————————————————————————————————————————————
  ui.scene(
    4,
    "临期，才出声",
    "痛点：等你察觉要黄，已经来不及。它赶在 due 前提醒当事人、给台阶，还把材料备好——不用你出面。",
  );
  // ———————————————————————————————————————————————————————
  world.link.set(login.id, "no_change");
  at(beijing(2026, 6, 19, 15));
  ui.note("  · 距登录 PR 的 due 还剩 3 小时，链接没新进展；调度器巡检……");
  await tick();
  const nudge = outbox.at(-1)?.text ?? "";
  ui.aside("提醒落到当事人头上、带台阶，还顺手把材料备好——你不用当坏人。");

  // 当场把这句催办喂回真实的品味 floor：管家自己说的话也要过关。
  ui.blank();
  ui.note("  这句催办，当场用分寸规则量了一遍：");
  await checkTaste(nudge, { decision: "remind", latestVerdict: "no_change" });

  // ———————————————————————————————————————————————————————
  ui.scene(
    5,
    "护栏有牙：不连环、不扰人",
    "痛点：催狠了团队反感，催松了没用。一天最多一次、深夜不扰——盯得住，又不招人烦。",
  );
  // ———————————————————————————————————————————————————————
  await setNext(login.id, beijing(2026, 6, 19, 15, 30));
  at(beijing(2026, 6, 19, 15, 30));
  ui.note("  · 半小时后又到点……");
  await tick();
  await setNext(login.id, beijing(2026, 6, 19, 23, 30));
  at(beijing(2026, 6, 19, 23, 30));
  ui.note("  · 当晚 23:30 又到点……");
  await tick();
  ui.aside("盯得勤但不扰人，是写死的纪律，不靠 AI 自觉——它不会半夜骚扰团队。");

  // ———————————————————————————————————————————————————————
  ui.scene(
    6,
    "群里问责，私聊管人",
    "痛点：当众点名伤人，私下又怕漏。共事的留在群里透明，个人逾期私聊本人——盯人不伤人。",
  );
  // ———————————————————————————————————————————————————————
  at(beijing(2026, 6, 20, 9));
  ui.note("  · 周六早 9:00，给李四推送他的个人台账……");
  const sent = await pushPersonDigest(LI.id);
  if (!sent) ui.note("  （无可报事项，不打扰）");
  ui.aside("该公开的透明、该私下的私下——团队有安全感，你有掌控感。");

  // ———————————————————————————————————————————————————————
  ui.scene(
    7,
    "品味是机制，不是运气",
    "痛点：AI 一张嘴就尬、谄媚或阴阳，砸的是你的场子。它说的每句先过分寸关——好好说话是写死的。",
  );
  // ———————————————————————————————————————————————————————
  const ctx: TasteContext = { decision: "remind", latestVerdict: "no_change" };
  ui.note("  它会说的话：");
  await checkTaste(nudge, ctx);
  ui.blank();
  ui.note("  它不会说的话（被分寸关挡下）：");
  await checkTaste("@李四 你怎么还没发登录 PR？？说过多少次了，这周必须给我搞定！！", ctx);
  ui.blank();
  ui.note("  好好说话被写成了规则、有测试兜底——不靠每次碰运气，也不怕换了模型就翻车。");

  // —— 收尾：一句价值 + 一行可信度脚注 ——
  ui.blank();
  ui.rule();
  ui.note("  一句话：让团队答应的事不落空，而你几乎不用管。");
  ui.note(
    "  （演示零配置离线跑；判断逻辑全是真实代码，只有外部接口[LLM/链接/GitHub]在本机模拟。" +
      "想看真模型 DEMO_LLM=real；细节见 demo/README.md。）",
  );
  ui.blank();
}

/** 跑真实的品味 floor 并把结果打印出来。 */
async function checkTaste(message: string, ctx: TasteContext): Promise<void> {
  const v = await fullTasteCheck(message, ctx, "演示自检", null);
  ui.taste(v.passed, `「${message}」`);
  for (const x of v.violations) ui.violation(x.severity, x.dimension, x.detail);
}

function fmt(d: Date | null): string {
  if (d === null) return "无";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
