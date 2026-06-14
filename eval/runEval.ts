// 品味金标 eval（ceiling）—— 跑真实 LLM + LLM-judge，打分卡，超阈值非零退出。
// 用法：npm run eval。读与 app 相同的 LLM_* 环境；只配 ANTHROPIC_API_KEY 即可（无需频道/库）。
// 这是「改 prompt / 换模型前先跑一遍」的闸门，不进 npm test（npm test 只跑确定性 floor）。
import { PiLlm } from "../src/adapters/llm/pi";
import { PiTasteJudge } from "../src/adapters/llm/tasteJudge";
import { loadConfig } from "../src/app/config";
import type { Commitment, Evidence } from "../src/core/domain/types";
import { InterventionPolicy } from "../src/core/pipeline/interventionPolicy";
import type { DecisionInput } from "../src/core/ports";
import type { DecisionGoldenCase } from "../src/core/taste/golden";
import { DECISION_GOLDEN, EXTRACTION_GOLDEN } from "../src/core/taste/golden";
import { fullTasteCheck } from "../src/core/taste/judge";
import type { TasteContext } from "../src/core/taste/rubric";

// —— 通过阈值（超出即非零退出）——
const EXTRACTION_PRECISION_MIN = 0.9;
const EXTRACTION_RECALL_MIN = 0.8;
const TASTE_PASS_MIN = 0.9;
const MIN_CONFIDENCE = 0.6; // 与 Extractor 默认一致

const TZ = "Asia/Shanghai";

function buildDecisionInput(c: DecisionGoldenCase): DecisionInput {
  const s = c.screen;
  const commitment: Commitment = {
    id: c.id,
    groupRef: "g-eval",
    assignee: "p-eval",
    title: c.title,
    rawText: c.title,
    source: { channel: "feishu", messageRef: "m-eval", at: s.now },
    status: s.status,
    dueAt: s.dueAt,
    verification: { kind: "none" },
    confidence: 0.9,
    tags: [],
    createdAt: s.now,
    confirmedAt: s.now,
    nextCheckAt: s.now,
  };
  const evidenceHistory: Evidence[] =
    s.latestVerdict === null
      ? []
      : [
          {
            id: "e-eval",
            commitmentId: c.id,
            capturedAt: s.now,
            source: s.canAutoComplete ? "github" : "link",
            verdict: s.latestVerdict,
            summary: `证据判定：${s.latestVerdict}`,
            raw: null,
          },
        ];
  const interactionHistory = s.hasUnansweredRecentRemind
    ? [
        {
          direction: "out" as const,
          text: "（上次提醒，对方未回）",
          at: new Date(s.now.getTime() - 3_600_000),
        },
      ]
    : [];
  return {
    commitment,
    evidenceHistory,
    interactionHistory,
    now: s.now,
    timezone: TZ,
    policy: {
      quietHours: s.quietHours,
      maxRemindersPerDay: s.maxRemindersPerDay,
      lastRemindAt: null,
      hasUnansweredRecentRemind: s.hasUnansweredRecentRemind,
    },
  };
}

function situationText(c: DecisionGoldenCase): string {
  const s = c.screen;
  const leftH =
    s.dueAt === null
      ? "无 due"
      : `${Math.round((s.dueAt.getTime() - s.now.getTime()) / 3_600_000)}h`;
  return `承诺「${c.title}」｜状态 ${s.status}｜距 due ${leftH}｜最近证据 ${s.latestVerdict ?? "无"}`;
}

async function runExtraction(
  llm: PiLlm,
): Promise<{ precision: number; recall: number; lines: string[] }> {
  const lines: string[] = [];
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const results = await Promise.all(
    EXTRACTION_GOLDEN.map(async (c) => {
      const now = new Date(c.now);
      const out = await llm.extractCommitment({
        recentMessages: c.conversation.map((m) => ({
          authorRef: m.authorRef,
          text: m.text,
          at: now,
        })),
        now,
        timezone: c.timezone,
        knownRepos: [],
      });
      const predicted = out.isCommitment && out.confidence >= MIN_CONFIDENCE;
      return { c, out, predicted };
    }),
  );
  for (const { c, out, predicted } of results) {
    const expected = c.expect.isCommitment;
    if (expected && predicted) tp++;
    else if (!expected && predicted) fp++;
    else if (expected && !predicted) fn++;
    else tn++;
    const mark = expected === predicted ? "OK  " : "MISS";
    lines.push(
      `  ${mark} ${c.id}: pred=${predicted}(${out.confidence.toFixed(2)}) exp=${expected}`,
    );
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  lines.push(`  TP=${tp} FP=${fp} FN=${fn} TN=${tn}`);
  return { precision, recall, lines };
}

async function runWording(
  llm: PiLlm,
  judge: PiTasteJudge,
): Promise<{ passRate: number; lines: string[] }> {
  const policy = new InterventionPolicy(llm);
  const cases = DECISION_GOLDEN.filter((c) => c.expectedScreen === "consult_llm");
  const lines: string[] = [];
  let passed = 0;
  let evaluated = 0;
  const results = await Promise.all(
    cases.map(async (c) => {
      const input = buildDecisionInput(c);
      const out = await policy.decide(input, {
        localHour: c.screen.localHour,
        remindersToday: c.screen.remindersToday,
      });
      return { c, out };
    }),
  );
  for (const { c, out } of results) {
    if (out.message === undefined) {
      lines.push(`  --   ${c.id}: 决定=${out.decision}（无措辞，跳过品味）`);
      continue;
    }
    evaluated++;
    const ctx: TasteContext = { decision: out.decision, latestVerdict: c.screen.latestVerdict };
    const verdict = await fullTasteCheck(out.message, ctx, situationText(c), judge);
    if (verdict.passed) passed++;
    const mark = verdict.passed ? "OK  " : "FAIL";
    lines.push(`  ${mark} ${c.id}: 「${out.message}」`);
    for (const v of verdict.violations) {
      lines.push(`         · [${v.severity}] ${v.dimension}: ${v.detail}`);
    }
  }
  const passRate = evaluated === 0 ? 1 : passed / evaluated;
  return { passRate, lines };
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.llm.provider !== "openai-compatible" && config.llm.apiKey.length === 0) {
    console.error(
      `[eval] 缺少 LLM API key。设置 ANTHROPIC_API_KEY（或对应 provider 的 key）后重试。\n` +
        `      provider=${config.llm.provider} model=${config.llm.modelId}`,
    );
    process.exitCode = 1;
    return;
  }
  const llm = new PiLlm(config.llm);
  const judge = new PiTasteJudge(config.llm);

  console.log(`\n品味金标 eval · model=${config.llm.provider}/${config.llm.modelId}\n`);

  console.log("【抽取边界 · 宁可漏不可误】");
  const ex = await runExtraction(llm);
  for (const l of ex.lines) console.log(l);
  console.log(
    `  → precision=${ex.precision.toFixed(2)} (≥${EXTRACTION_PRECISION_MIN}) ` +
      `recall=${ex.recall.toFixed(2)} (≥${EXTRACTION_RECALL_MIN})\n`,
  );

  console.log("【出声措辞 · 分寸】");
  const wd = await runWording(llm, judge);
  for (const l of wd.lines) console.log(l);
  console.log(`  → taste pass-rate=${wd.passRate.toFixed(2)} (≥${TASTE_PASS_MIN})\n`);

  const failed: string[] = [];
  if (ex.precision < EXTRACTION_PRECISION_MIN) failed.push("extraction precision");
  if (ex.recall < EXTRACTION_RECALL_MIN) failed.push("extraction recall");
  if (wd.passRate < TASTE_PASS_MIN) failed.push("taste pass-rate");

  if (failed.length > 0) {
    console.error(`✗ 未达标：${failed.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("✓ 全部达标");
  }
}

main().catch((err: unknown) => {
  console.error("[eval] 运行失败：", err);
  process.exitCode = 1;
});
