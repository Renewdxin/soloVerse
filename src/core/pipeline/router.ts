import type { Commitment, Person } from "../domain/types";
import type { GroupPolicy } from "../groupPolicy";
import type { Clock, InboundMessage, OutboundMessage, Store } from "../ports";
import { computeNextCheckAt } from "../scheduler/nextCheck";
import type { Extractor } from "./extractor";

const AFFIRM = /^(对|对的|是的?|好的?|确认|嗯|ok|yes)$/i;
const DENY = /^(不是|不对|取消|算了|no)$/i;
const EDIT = /^(改|改一下|重来)$/i;

export interface RouterDeps {
  store: Store;
  extractor: Extractor;
  groupPolicy: GroupPolicy;
  clock: Clock;
  send: (out: OutboundMessage) => Promise<{ dispatchRef: string }>;
  newId: () => string;
}

/**
 * 入站分流（plan M1）：
 * 1. 若发话人有待确认（proposed）承诺，且这条是确认/否认/改 → 处理之；
 * 2. 否则尝试抽取新承诺 → proposed 入库 + **群里公开确认**。
 * 确认匹配 M1 用「同人最近一条 proposed」启发式，后续可升级为按 replyToRef 精确匹配。
 */
export class Router {
  constructor(private readonly deps: RouterDeps) {}

  async handle(msg: InboundMessage): Promise<void> {
    // 只读群：只落库上下文，不抽取、不在群里发言（个人事项之后走私聊 digest）。
    if (!this.deps.groupPolicy.canPost(msg.groupRef)) {
      await this.recordInbound(msg, null);
      return;
    }

    const person = await this.resolvePerson(msg);
    const text = msg.text.trim();

    const pending = await this.findProposed(msg.groupRef, person.id);
    if (pending !== null) {
      await this.recordInbound(msg, pending.id);
      if (AFFIRM.test(text)) return this.confirm(pending, msg);
      if (DENY.test(text)) return this.discard(pending, msg, "好，那就不记了。");
      if (EDIT.test(text)) return this.discard(pending, msg, "好，你重新说一下。");
      // 有待确认时，非「对/不是/改」的话只记上下文、不再抽取——
      // 否则会生成第二条 proposed + 再发一次「记一笔」刷屏（铁律1）。
      return;
    }

    const proposed = await this.deps.extractor.propose([msg], person.id);
    if (proposed !== null) {
      await this.deps.store.commitments.put(proposed);
      await this.recordInbound(msg, proposed.id);
      const due = proposed.dueAt !== null ? ` · 截止 ${proposed.dueAt.toISOString()}` : "";
      try {
        await this.sendAndRecord(
          {
            channel: msg.channel,
            groupRef: msg.groupRef,
            text: `记一笔 👉 ${proposed.title}${due}。对吗？（不对回「改」/「不是」）`,
            mentions: [msg.authorRef],
          },
          proposed.id,
        );
      } catch (err) {
        // 确认消息没发出去 → 回滚刚存的 proposed，别留下用户没看到提示的孤儿记录。
        await this.deps.store.commitments.delete(proposed.id);
        console.error(
          `[router] 确认消息发送失败，已回滚 proposed（group=${msg.groupRef} author=${msg.authorRef}）`,
          err,
        );
      }
      return;
    }

    await this.recordInbound(msg, null);
  }

  private async confirm(c: Commitment, msg: InboundMessage): Promise<void> {
    const now = this.deps.clock.now();
    const activated: Commitment = {
      ...c,
      status: "active",
      confirmedAt: now,
      nextCheckAt: computeNextCheckAt(now, c.dueAt, "active"),
    };
    await this.deps.store.commitments.put(activated);
    await this.sendAndRecord(
      { channel: msg.channel, groupRef: msg.groupRef, text: "好，跟上了。" },
      c.id,
    );
  }

  private async discard(c: Commitment, msg: InboundMessage, reply: string): Promise<void> {
    await this.deps.store.commitments.delete(c.id);
    await this.sendAndRecord({ channel: msg.channel, groupRef: msg.groupRef, text: reply }, c.id);
  }

  private async findProposed(groupRef: string, assignee: string): Promise<Commitment | null> {
    const all = await this.deps.store.commitments.all();
    const mine = all
      .filter((c) => c.status === "proposed" && c.groupRef === groupRef && c.assignee === assignee)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return mine[0] ?? null;
  }

  /** 归因：按 (channel, authorRef) 找 Person；没有就建一个（M1，无账号）。 */
  private async resolvePerson(msg: InboundMessage): Promise<Person> {
    const all = await this.deps.store.people.all();
    const found = all.find((p) =>
      p.handles.some((h) => h.channel === msg.channel && h.userRef === msg.authorRef),
    );
    if (found !== undefined) return found;
    const person: Person = {
      id: this.deps.newId(),
      displayName: msg.authorRef,
      handles: [{ channel: msg.channel, userRef: msg.authorRef }],
      isOperator: false,
    };
    await this.deps.store.people.put(person);
    return person;
  }

  private async recordInbound(msg: InboundMessage, commitmentId: string | null): Promise<void> {
    await this.deps.store.interactions.put({
      id: this.deps.newId(),
      groupRef: msg.groupRef,
      channel: msg.channel,
      direction: "in",
      authorRef: msg.authorRef,
      text: msg.text,
      at: msg.at,
      commitmentId,
    });
  }

  private async sendAndRecord(
    out: OutboundMessage,
    commitmentId: string | null,
  ): Promise<{ dispatchRef: string }> {
    const sent = await this.deps.send(out);
    // 出站流水是 Evaluator 去重/审计的事实来源，不能只依赖平台发送结果。
    await this.deps.store.interactions.put({
      id: this.deps.newId(),
      groupRef: out.groupRef,
      channel: out.channel,
      direction: "out",
      authorRef: "bot",
      text: out.text,
      at: this.deps.clock.now(),
      commitmentId,
    });
    return sent;
  }
}
