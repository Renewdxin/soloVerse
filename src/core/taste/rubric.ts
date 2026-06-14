// Commitment Agent · 品味 rubric —— 把 BUTLER_PERSONA 的「分寸」从散文落成可校验的维度。
// 一部分是确定性检查（floor，进 npm test，离线）；一部分留给 LLM judge（ceiling，进 npm run eval）。
// 见 docs/taste-guarantee.md。persona 原文见 src/adapters/llm/prompts/persona.ts。
import type { InterventionDecision, Verdict } from "../domain/types";

export const RUBRIC_VERSION = "2026-06-13";

export type TasteSeverity = "blocker" | "warn";

/** 一条出站措辞所处的情境；确定性检查里要用到（如「没证据别假装完成」依赖最近 verdict）。 */
export interface TasteContext {
  decision: InterventionDecision;
  /** 最近一次证据判定；null = 还没有证据。 */
  latestVerdict: Verdict | null;
  /** 一句话字数上限；缺省 80。 */
  maxChars?: number;
}

export interface TasteViolation {
  dimension: string;
  severity: TasteSeverity;
  detail: string;
}

export interface TasteReport {
  /** 无 blocker 违规即通过（warn 不影响通过，只压低 score）。 */
  passed: boolean;
  /** 通过的确定性维度 / 确定性维度总数，0-1。 */
  score: number;
  violations: TasteViolation[];
  /** 实际跑过的确定性维度 id（便于审计）。 */
  checked: string[];
}

const DEFAULT_MAX_CHARS = 80;

// 管家 cosplay / 谄媚体：真正的管家低调，不演「忠仆」。
const COSPLAY = [
  "主人",
  "尊敬的",
  "请允许我",
  "容我",
  "为您效劳",
  "鞠躬",
  "卑职",
  "恭候",
  "谨遵",
  "随时为您",
  "听候差遣",
];
// 羞辱 / 指责 / 连环追问语气：管家给体面出口，不点名、不质问。
const SHAMING = [
  "你怎么还",
  "你又",
  "怎么回事",
  "到底行不行",
  "别再",
  "再次提醒你",
  "拖延",
  "催你",
  "怎么又",
  "说过多少次",
  "有没有在做",
];
// 声称完成的措辞：没有证据时不许说。
const COMPLETION_CLAIM = ["已完成", "已搞定", "搞定了", "完成了", "已经好了", "已交付", "done"];
// 越界承诺：bot 替自己 / 替责任人打包票。
const OVER_PROMISE = ["保证", "一定", "绝对", "包在我身上", "马上就好", "立刻搞定"];

function countMatches(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length;
}

function firstHit(s: string, words: string[]): string | null {
  const lower = s.toLowerCase();
  for (const w of words) {
    if (lower.includes(w.toLowerCase())) return w;
  }
  return null;
}

interface DeterministicDimension {
  id: string;
  severity: TasteSeverity;
  /** 违规时返回一句中文说明；合规返回 null。 */
  check: (message: string, ctx: TasteContext) => string | null;
}

/** 确定性维度（floor）：能写成规则的分寸都在这里，离线可判。 */
export const DETERMINISTIC_DIMENSIONS: DeterministicDimension[] = [
  {
    id: "terse",
    severity: "blocker",
    check: (m, ctx) => {
      const max = ctx.maxChars ?? DEFAULT_MAX_CHARS;
      const len = m.trim().length;
      if (len > max) return `过长：${len} 字 > ${max}（管家一句话）`;
      const sentences = countMatches(m, /[。！？!?]/g);
      if (sentences > 2) return `句子过多：${sentences} > 2`;
      return null;
    },
  },
  {
    id: "single-ask",
    severity: "blocker",
    check: (m) => {
      const q = countMatches(m, /[？?]/g);
      return q > 1 ? `连环发问：${q} 个问号（不连环追问）` : null;
    },
  },
  {
    id: "no-cosplay",
    severity: "blocker",
    check: (m) => {
      const hit = firstHit(m, COSPLAY);
      return hit === null ? null : `管家 cosplay / 谄媚体：「${hit}」`;
    },
  },
  {
    id: "no-shaming",
    severity: "blocker",
    check: (m) => {
      const hit = firstHit(m, SHAMING);
      return hit === null ? null : `羞辱 / 指责语气：「${hit}」`;
    },
  },
  {
    id: "no-fake-progress",
    severity: "blocker",
    check: (m, ctx) => {
      if (ctx.latestVerdict === "completed") return null; // 有完成证据，允许说完成
      const hit = firstHit(m, COMPLETION_CLAIM);
      return hit === null ? null : `无证据却声称完成：「${hit}」`;
    },
  },
  {
    id: "no-over-promise",
    severity: "warn",
    check: (m) => {
      const hit = firstHit(m, OVER_PROMISE);
      return hit === null ? null : `越界打包票：「${hit}」`;
    },
  },
  {
    id: "no-emoji-spam",
    severity: "warn",
    check: (m) => {
      const n = countMatches(m, /\p{Extended_Pictographic}/gu);
      return n > 1 ? `表情过多：${n} 个（管家克制，最多 1 个）` : null;
    },
  },
];

/** 对一条出站措辞跑确定性 floor。无 blocker 即 passed。 */
export function scoreMessage(message: string, ctx: TasteContext): TasteReport {
  const violations: TasteViolation[] = [];
  const checked: string[] = [];
  for (const dim of DETERMINISTIC_DIMENSIONS) {
    checked.push(dim.id);
    const detail = dim.check(message, ctx);
    if (detail !== null) {
      violations.push({ dimension: dim.id, severity: dim.severity, detail });
    }
  }
  const passedCount = checked.length - violations.length;
  const score = checked.length === 0 ? 1 : passedCount / checked.length;
  const passed = !violations.some((v) => v.severity === "blocker");
  return { passed, score, violations, checked };
}

export interface JudgeDimension {
  id: string;
  severity: TasteSeverity;
  /** 给 LLM judge 看的判定标准。 */
  rubric: string;
}

/** 主观维度（ceiling）：写不成确定性规则、要靠品味判的，交给 LLM judge。 */
export const JUDGE_DIMENSIONS: JudgeDimension[] = [
  {
    id: "tone-appropriate",
    severity: "blocker",
    rubric: "整体像一个低调、得体的管家：不居高临下、不阴阳怪气、不过度热情；临期提醒带体面出口。",
  },
  {
    id: "grounded",
    severity: "blocker",
    rubric: "只说情境简报里有依据的事；不编造进展、不替责任人下结论、不假设看不到的信息。",
  },
  {
    id: "actionable",
    severity: "warn",
    rubric: "出声时指向一个具体、可执行的下一步，而不是空泛催促。",
  },
];
