// Demo UI —— 终端排版与着色。零依赖；设 NO_COLOR 即降级为纯文本。
// 只负责"怎么显示"，不碰任何业务逻辑（业务全在 src/core 的真实代码里）。

const COLOR = process.env.NO_COLOR === undefined;
const paint =
  (code: string) =>
  (s: string): string =>
    COLOR ? `\x1b[${code}m${s}\x1b[0m` : s;

export const dim = paint("2");
export const bold = paint("1");
const green = paint("32");
const red = paint("31");
const cyan = paint("36");
const magenta = paint("35");
const yellow = paint("33");
const gray = paint("90");

const PAD = "          "; // 对齐人名列宽（管家/沉默占位）

/** 把时间格式化成北京时区的"周X HH:MM"，给聊天流当时间戳。 */
function stamp(at: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

export function banner(subtitle: string): void {
  console.log();
  console.log(bold(magenta("  管家 · Commitment Agent —— 实况演示")));
  console.log(dim(`  ${subtitle}`));
  console.log();
}

export function scene(n: number, title: string, pillar: string): void {
  console.log();
  console.log(magenta(bold(`━━━ 场景 ${n} · ${title}`)));
  console.log(dim(`    ${pillar}`));
  console.log();
}

/** 群里某个人说的话。 */
export function human(at: Date, name: string, text: string): void {
  console.log(`  ${gray(stamp(at))}  ${cyan(bold(name.padEnd(3)))}  ${text}`);
}

/** 管家在群里发言（确认 / 庆祝 / 催办）。 */
export function butler(text: string): void {
  console.log(`  ${PAD}${green("管家")}  ${green(text)}`);
}

/** 管家选择不出声——把它的理由也亮出来（这正是"分寸"所在）。 */
export function silence(reason: string): void {
  console.log(`  ${PAD}${dim("· 管家沉默")}  ${dim(reason)}`);
}

/** 旁白：解释刚刚发生了什么 / 为什么。 */
export function aside(text: string): void {
  console.log(dim(`    ⟂ ${text}`));
}

/** 私聊（DM）一个人的台账。 */
export function dm(to: string, body: string): void {
  console.log();
  console.log(`  ${yellow(`✉ 飞书私聊 → ${to}`)}  ${dim("（个人台账，不进群、不点名）")}`);
  for (const line of body.split("\n")) {
    console.log(`    ${yellow("│")} ${line.length > 0 ? line : ""}`);
  }
}

/** 品味判定一行：✓ PASS / ✗ FAIL。 */
export function taste(pass: boolean, label: string): void {
  const tag = pass ? green("✓ PASS") : red("✗ FAIL");
  console.log(`  ${tag}  ${label}`);
}

/** 品味违规明细（floor 里命中的维度）。 */
export function violation(severity: string, dimension: string, detail: string): void {
  console.log(`          ${red("·")} ${dim(`[${severity}] ${dimension} — ${detail}`)}`);
}

export function note(text: string): void {
  console.log(dim(text));
}

export function blank(): void {
  console.log();
}

export function rule(): void {
  console.log(dim("  ────────────────────────────────────────────────────────────"));
}
