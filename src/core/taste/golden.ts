// Commitment Agent · 品味金标 —— 捕获边界 + 决策/措辞的 curated 真相集。
// EXTRACTION_GOLDEN 守「宁可漏不可误」；DECISION_GOLDEN 守隐形护栏的出声/闭嘴与措辞分寸。
// 见 docs/taste-guarantee.md。
import type { ScreenInput } from "../pipeline/interventionPolicy";
import type { TasteContext } from "./rubric";

// ——————————————————————————————————————————————————————————
// 抽取金标：一条触发消息（含可选前文）→ 期望的 isCommitment 判定。
// ——————————————————————————————————————————————————————————
export interface ExtractionGoldenCase {
  id: string;
  /** 窗口里的消息；最后一条是触发消息。 */
  conversation: { authorRef: string; text: string }[];
  now: string; // ISO 绝对时间
  timezone: string;
  expect: {
    isCommitment: boolean;
    /** 是承诺时置信度应 ≥ 此值；不是承诺时应 ≤ 此值。缺省 0.6。 */
    confidence?: number;
    /** 期望标题里出现的关键词（宽松包含）。 */
    titleIncludes?: string;
    /** 是否应解析出截止时间。 */
    hasDue?: boolean;
  };
  note: string;
}

const TZ = "Asia/Shanghai";
const D = "2026-06-13T02:00:00.000Z"; // 北京时间 10:00

export const EXTRACTION_GOLDEN: ExtractionGoldenCase[] = [
  {
    id: "ex-clear-due",
    conversation: [{ authorRef: "u-li", text: "我周五前把登录页的 PR 发出来" }],
    now: D,
    timezone: TZ,
    expect: { isCommitment: true, confidence: 0.7, titleIncludes: "登录", hasDue: true },
    note: "明确的人+事+时间，标准承诺。",
  },
  {
    id: "ex-firm-no-due",
    conversation: [{ authorRef: "u-li", text: "发布脚本我来负责写。" }],
    now: D,
    timezone: TZ,
    expect: { isCommitment: true, confidence: 0.6, titleIncludes: "发布", hasDue: false },
    note: "明确认领、无截止——仍是承诺，只是没 due。",
  },
  {
    id: "ex-relative-time",
    conversation: [{ authorRef: "u-zhang", text: "明天下班前给你初稿" }],
    now: D,
    timezone: TZ,
    expect: { isCommitment: true, confidence: 0.7, hasDue: true },
    note: "相对时间要按时区解析成绝对 due。",
  },
  {
    id: "ex-accept-handoff",
    conversation: [
      { authorRef: "u-wang", text: "@李 这个迁移你来跟吧？" },
      { authorRef: "u-li", text: "行，我接了，周五给结果。" },
    ],
    now: D,
    timezone: TZ,
    expect: { isCommitment: true, confidence: 0.7, hasDue: true },
    note: "接活也是承诺，触发消息作者是责任人。",
  },
  {
    id: "ex-vague-look",
    conversation: [{ authorRef: "u-li", text: "这个我看看吧" }],
    now: D,
    timezone: TZ,
    expect: { isCommitment: false, confidence: 0.4 },
    note: "「我看看」是含糊意向，不可跟踪。",
  },
  {
    id: "ex-chitchat",
    conversation: [{ authorRef: "u-li", text: "哈哈这个 demo 真有意思" }],
    now: D,
    timezone: TZ,
    expect: { isCommitment: false, confidence: 0.3 },
    note: "纯闲聊。",
  },
  {
    id: "ex-hypothetical",
    conversation: [{ authorRef: "u-zhang", text: "要不我们考虑下把这块重构了？" }],
    now: D,
    timezone: TZ,
    expect: { isCommitment: false, confidence: 0.4 },
    note: "设想/提议，没人认领，不算承诺。",
  },
  {
    id: "ex-question-to-others",
    conversation: [{ authorRef: "u-li", text: "谁能帮忙看下这个 CI 挂了？" }],
    now: D,
    timezone: TZ,
    expect: { isCommitment: false, confidence: 0.3 },
    note: "向别人求助 ≠ 自己承诺。",
  },
  {
    id: "ex-past-report",
    conversation: [{ authorRef: "u-li", text: "登录 bug 昨天已经修好了" }],
    now: D,
    timezone: TZ,
    expect: { isCommitment: false, confidence: 0.4 },
    note: "已完成的陈述是汇报，不是面向未来的承诺。",
  },
  {
    id: "ex-hedged",
    conversation: [{ authorRef: "u-zhang", text: "可能下周吧，看情况" }],
    now: D,
    timezone: TZ,
    expect: { isCommitment: false, confidence: 0.4 },
    note: "「看情况」是对冲，不可跟踪。",
  },
  {
    id: "ex-aspiration",
    conversation: [{ authorRef: "u-li", text: "今年得把测试覆盖率搞上去" }],
    now: D,
    timezone: TZ,
    expect: { isCommitment: false, confidence: 0.4 },
    note: "宽泛愿景，无具体可跟踪的交付。",
  },
  {
    id: "ex-deliver-tonight",
    conversation: [{ authorRef: "u-zhang", text: "合同我今晚之前发你邮箱" }],
    now: D,
    timezone: TZ,
    expect: { isCommitment: true, confidence: 0.7, titleIncludes: "合同", hasDue: true },
    note: "明确交付 + 当日截止。",
  },
];

// ——————————————————————————————————————————————————————————
// 决策金标：喂给确定性护栏 screenIntervention 的输入 + 期望出声/闭嘴。
// consult_llm 情形再给一个范例的合格措辞（dogfood：必须自检通过）。
// ——————————————————————————————————————————————————————————
export interface DecisionGoldenCase {
  id: string;
  /** 承诺标题（构造 LLM 简报与情境用）。 */
  title: string;
  screen: ScreenInput;
  expectedScreen: "silent" | "celebrate" | "consult_llm";
  /** consult_llm 情形：一条范例的、合格的群内措辞。 */
  goldenMessage?: string;
  /** goldenMessage 所处情境（跑确定性 floor 用）。 */
  context?: TasteContext;
  note: string;
}

const NOW = new Date("2026-06-13T06:00:00.000Z");
const H = 3_600_000;

function screen(over: Partial<ScreenInput>): ScreenInput {
  return {
    now: NOW,
    dueAt: new Date(NOW.getTime() + 48 * H),
    status: "active",
    latestVerdict: null,
    localHour: 14,
    quietHours: [23, 8],
    maxRemindersPerDay: 1,
    remindersToday: 0,
    canAutoComplete: false,
    hasUnansweredRecentRemind: false,
    ...over,
  };
}

export const DECISION_GOLDEN: DecisionGoldenCase[] = [
  {
    id: "de-on-track-silent",
    title: "重构搜索索引",
    screen: screen({}),
    expectedScreen: "silent",
    note: "远离 due、无回退 → 没消息就是好消息，闭嘴。",
  },
  {
    id: "de-quiet-hours",
    title: "发周报",
    screen: screen({
      localHour: 2,
      dueAt: new Date(NOW.getTime() + 3 * H),
      latestVerdict: "no_change",
    }),
    expectedScreen: "silent",
    note: "安静期不打扰，哪怕临期。",
  },
  {
    id: "de-non-active",
    title: "已交付的旧任务",
    screen: screen({ status: "fulfilled" }),
    expectedScreen: "silent",
    note: "非监督态不出声。",
  },
  {
    id: "de-github-complete",
    title: "修复登录 bug",
    screen: screen({ latestVerdict: "completed", canAutoComplete: true }),
    expectedScreen: "celebrate",
    note: "强证据（github）完成 → 模板庆祝，无需 LLM。",
  },
  {
    id: "de-reminded-cap",
    title: "补单测",
    screen: screen({
      dueAt: new Date(NOW.getTime() + 3 * H),
      latestVerdict: "no_change",
      remindersToday: 1,
    }),
    expectedScreen: "silent",
    note: "今日已达提醒上限 → 装死不连环。",
  },
  {
    id: "de-unanswered",
    title: "改文档",
    screen: screen({
      dueAt: new Date(NOW.getTime() + 3 * H),
      latestVerdict: "no_change",
      hasUnansweredRecentRemind: true,
    }),
    expectedScreen: "silent",
    note: "上次提醒没回 → 不追问。",
  },
  {
    id: "de-near-due-remind",
    title: "登录页 PR",
    screen: screen({ dueAt: new Date(NOW.getTime() + 3 * H), latestVerdict: "no_change" }),
    expectedScreen: "consult_llm",
    goldenMessage: "登录页 PR 离今天的 due 不远了，需要我把相关链接翻出来吗？",
    context: { decision: "remind", latestVerdict: "no_change" },
    note: "临期无进展、今日未提醒 → 交 LLM 措辞；范例给体面出口。",
  },
  {
    id: "de-weak-complete",
    title: "数据迁移脚本",
    screen: screen({
      dueAt: new Date(NOW.getTime() + 3 * H),
      latestVerdict: "completed",
      canAutoComplete: false,
    }),
    expectedScreen: "consult_llm",
    goldenMessage: "数据迁移脚本看着像好了，但链接是弱证据，要不要发个 PR 让我确认？",
    context: { decision: "remind", latestVerdict: "completed" },
    note: "弱来源 completed 不自动结案，让 LLM 措辞确认。",
  },
  {
    id: "de-at-risk",
    title: "发布脚本",
    screen: screen({ status: "at_risk", latestVerdict: "no_change" }),
    expectedScreen: "consult_llm",
    goldenMessage: "发布脚本这条卡了两天，要不要挪到下周再交？",
    context: { decision: "suggest_renegotiate", latestVerdict: "no_change" },
    note: "at_risk → 不是 on-track，给重新协商的体面出口。",
  },
  {
    id: "de-regressed",
    title: "支付回调",
    screen: screen({ latestVerdict: "regressed" }),
    expectedScreen: "consult_llm",
    goldenMessage: "支付回调相关的改动刚被回退了，需要我把上一版对比贴出来吗？",
    context: { decision: "remind", latestVerdict: "regressed" },
    note: "证据回退即便远离 due 也不沉默。",
  },
];
