import type { ChannelKind, Group, GroupMode } from "./domain/types";
import type { GroupPolicy } from "./groupPolicy";
import type { Clock, OutboundDirectMessage, Store } from "./ports";

export interface OperatorConsoleDeps {
  store: Store;
  groupPolicy: GroupPolicy;
  clock: Clock;
  sendDirect: (out: OutboundDirectMessage) => Promise<{ dispatchRef: string }>;
  /** 管家主人：群上岗审批走他的私聊。 */
  operator: { channel: ChannelKind; userRef: string };
}

const MODE_LABEL: Record<GroupMode, string> = {
  off: "忽略（不管这个群了）",
  read: "只读（只听不发言）",
  readwrite: "可发言（完整管家）",
};

/**
 * 管家控制台：群上岗走 operator 私聊，不在群里自报家门（分寸）。
 * - offerNewGroup：被拉进新群（默认只读）后，私聊问 operator 要不要提权（一个群只问一次）。
 * - handleDm：operator 私聊回「开启 / 只读 / 忽略 / 列表」→ 改群权限（DB + policy 一起改），立刻生效不重部署。
 *
 * 不是控制命令的私聊（闲聊）直接忽略——不让 DM 退化成聊天。
 */
export class OperatorConsole {
  constructor(private readonly deps: OperatorConsoleDeps) {}

  /** 新群默认只读上岗后，私聊 operator 提议提权（promptedAt 标记，避免重启反复打扰）。 */
  async offerNewGroup(group: Group): Promise<void> {
    if (group.promptedAt !== null) return;
    const name = group.name ?? group.id;
    await this.dm(
      `有人把我拉进群「${name}」（${group.id}），我先只读待命。\n` +
        "要我在这群也能发言就回「开启」；只听就回「只读」；不管它回「忽略」。",
    );
    await this.deps.store.groups.put({ ...group, promptedAt: this.deps.clock.now() });
  }

  /** operator 私聊控制命令。非命令直接忽略。 */
  async handleDm(text: string): Promise<void> {
    const t = text.trim();
    if (/^(列表|群|状态|list)$/i.test(t)) return this.replyList();

    let mode: GroupMode | null = null;
    if (/^(开启|开通|可发言|发言)/.test(t)) mode = "readwrite";
    else if (/^(只读|静音|只听)/.test(t)) mode = "read";
    else if (/^(忽略|关闭|关掉|不管)/.test(t)) mode = "off";
    if (mode === null) return; // 不是控制命令

    const target = await this.resolveTarget(t);
    if (target === null) {
      await this.dm("现在没有待我处理的群。发「列表」看看我都在哪些群。");
      return;
    }
    await this.deps.store.groups.put({ ...target, mode, promptedAt: this.deps.clock.now() });
    this.deps.groupPolicy.setMode(target.id, mode);
    await this.dm(`好，「${target.name ?? target.id}」设为 ${MODE_LABEL[mode]}。`);
  }

  /** 命令里带了 chat_id（整 token 精确匹配）就用它；否则默认「最近问过、还只读着的那个群」。 */
  private async resolveTarget(text: string): Promise<Group | null> {
    const groups = (await this.deps.store.groups.all()).filter(
      (g) => g.channel === this.deps.operator.channel,
    );
    const tokens = text.split(/\s+/);
    const byRef = groups.find((g) => tokens.includes(g.id));
    if (byRef !== undefined) return byRef;
    const pending = groups.filter(
      (g): g is Group & { promptedAt: Date } => g.mode === "read" && g.promptedAt !== null,
    );
    pending.sort((a, b) => b.promptedAt.getTime() - a.promptedAt.getTime());
    return pending[0] ?? null;
  }

  private async replyList(): Promise<void> {
    const groups = (await this.deps.store.groups.all()).filter(
      (g) => g.channel === this.deps.operator.channel,
    );
    if (groups.length === 0) {
      await this.dm("我还没在任何群里。把我拉进群就行。");
      return;
    }
    const lines = groups.map((g) => `· ${g.name ?? g.id}（${g.id}）— ${MODE_LABEL[g.mode]}`);
    await this.dm(
      `我现在的群：\n${lines.join("\n")}\n\n回「开启 <chat_id>」「只读 <chat_id>」「忽略 <chat_id>」改权限。`,
    );
  }

  private async dm(text: string): Promise<void> {
    await this.deps.sendDirect({
      channel: this.deps.operator.channel,
      userRef: this.deps.operator.userRef,
      text,
    });
  }
}
