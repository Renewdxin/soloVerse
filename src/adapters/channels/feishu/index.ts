import * as Lark from "@larksuiteoapi/node-sdk";
import type { Digest } from "../../../core/domain/types";
import type {
  ChannelAdapter,
  InboundMessage,
  OutboundDirectMessage,
  OutboundMessage,
} from "../../../core/ports";

/**
 * 飞书（Lark）频道 adapter。工作群一等支持。
 * 用长连接（WSClient）订阅 im.message.receive_v1，免公网回调；自建应用凭据放
 * FEISHU_APP_ID / FEISHU_APP_SECRET，并在开放平台开启「接收消息」事件与机器人能力。
 */
export class FeishuChannel implements ChannelAdapter {
  readonly kind = "feishu" as const;
  // 飞书 p2p：同一个 im.message.create，receive_id_type 换成 open_id 即可（见 im-v1 文档）。
  readonly canDirectMessage = true;
  private readonly client: Lark.Client;
  private readonly wsClient: Lark.WSClient;

  constructor(appId: string, appSecret: string) {
    this.client = new Lark.Client({ appId, appSecret });
    // 连接状态可观测：凭据错 / 掉线时要在日志里看得出来，而不是假装 listening。
    this.wsClient = new Lark.WSClient({
      appId,
      appSecret,
      onReady: () => console.log("[feishu] ready · 长连接已建立"),
      onError: (err) => console.error("[feishu] 连接失败（初次连接失败或重试耗尽）", err),
      onReconnecting: () => console.warn("[feishu] 连接断开，正在重连…"),
      onReconnected: () => console.log("[feishu] 重连成功"),
    });
  }

  async start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void> {
    const dispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => {
        // 丢弃应用 / 机器人消息（sender_type==="app"）：防自己发的消息回推成自循环，
        // 也不把别的 bot 当成承诺。注意 data.app_id 是「接收事件的应用」（永远是自己），
        // 不能用来判断发送者；真人消息 sender_type 恒为 "user"，不会被误丢。
        if (data.sender?.sender_type === "app") return;
        const msg = data.message;
        await onMessage({
          channel: "feishu",
          groupRef: msg.chat_id,
          chatType: msg.chat_type === "p2p" ? "p2p" : "group",
          authorRef: data.sender.sender_id?.open_id ?? "unknown",
          text: this.parseText(msg.content, msg.message_type),
          replyToRef: msg.parent_id ?? null,
          messageRef: msg.message_id,
          at: new Date(Number(msg.create_time)),
          raw: data,
        });
      },
    });
    this.wsClient.start({ eventDispatcher: dispatcher });
  }

  async send(m: OutboundMessage): Promise<{ dispatchRef: string }> {
    const ats = (m.mentions ?? []).map((id) => `<at user_id="${id}"></at>`).join("");
    const text = ats.length > 0 ? `${ats} ${m.text}` : m.text;
    const res = await this.client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: { receive_id: m.groupRef, msg_type: "text", content: JSON.stringify({ text }) },
    });
    return { dispatchRef: res.data?.message_id ?? "" };
  }

  /**
   * 私聊一个人：receive_id_type=open_id（接收人需在机器人可用范围内，否则 230013）。
   * 有 digest → 优先发互动卡片；卡片发送失败则 fallback 纯文本，保证日报送达。
   */
  async sendDirect(m: OutboundDirectMessage): Promise<{ dispatchRef: string }> {
    if (m.digest !== undefined) {
      try {
        return await this.p2p(m.userRef, "interactive", digestToCard(m.digest));
      } catch (err) {
        // 卡片渲染 / 发送失败 → 退回纯文本（记一笔，便于区分「卡片故意关」与「卡片坏了」）
        console.warn("[feishu] 卡片发送失败，退回纯文本", err instanceof Error ? err.message : err);
      }
    }
    return this.p2p(m.userRef, "text", { text: m.text });
  }

  private async p2p(
    openId: string,
    msgType: "text" | "interactive",
    content: unknown,
  ): Promise<{ dispatchRef: string }> {
    const res = await this.client.im.message.create({
      params: { receive_id_type: "open_id" },
      data: { receive_id: openId, msg_type: msgType, content: JSON.stringify(content) },
    });
    return { dispatchRef: res.data?.message_id ?? "" };
  }

  private parseText(content: string, type: string): string {
    if (type !== "text") return "";
    try {
      return (JSON.parse(content) as { text?: string }).text ?? "";
    } catch {
      return "";
    }
  }
}

/** Digest → 飞书互动卡片（lark_md），每个 section 一块，section 间分隔线。 */
function digestToCard(d: Digest): unknown {
  const elements: unknown[] = [];
  d.sections.forEach((section, i) => {
    if (i > 0) elements.push({ tag: "hr" });
    const body = section.items
      .map((it) => `- ${it.text}${it.link !== undefined ? ` [↗](${it.link})` : ""}`)
      .join("\n");
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: `**${section.heading}**\n${body}` },
    });
  });
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: d.title }, template: "blue" },
    elements,
  };
}
