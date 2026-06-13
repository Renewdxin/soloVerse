import { Client, Events, GatewayIntentBits, type Message } from "discord.js";
import type {
  ChannelAdapter,
  InboundMessage,
  OutboundDirectMessage,
  OutboundMessage,
} from "../../../core/ports";

/**
 * Discord 频道 adapter（discord.js v14）。工作群一等支持。
 * 需要在 Developer Portal 开启 MESSAGE CONTENT INTENT，bot token 放 DISCORD_BOT_TOKEN。
 */
export class DiscordChannel implements ChannelAdapter {
  readonly kind = "discord" as const;
  // 项目飞书 only：Discord 的 bot DM 是 best-effort（仅共群且未关私信，否则 50007），不做。
  readonly canDirectMessage = false;
  private readonly client: Client;

  constructor(private readonly token: string) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void> {
    this.client.on(Events.MessageCreate, async (msg: Message) => {
      if (msg.author.bot) return; // 忽略 bot（含自己）
      if (!msg.inGuild()) return; // 只在群里，不私聊
      await onMessage(this.toInbound(msg));
    });
    await this.client.login(this.token);
  }

  async send(m: OutboundMessage): Promise<{ dispatchRef: string }> {
    const channel = await this.client.channels.fetch(m.groupRef);
    if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
      throw new Error(`Discord 频道 ${m.groupRef} 不可发消息`);
    }
    const mentions = (m.mentions ?? []).map((id) => `<@${id}>`).join(" ");
    const text = mentions.length > 0 ? `${mentions} ${m.text}` : m.text;
    const sent = await channel.send(text);
    return { dispatchRef: sent.id };
  }

  async sendDirect(_m: OutboundDirectMessage): Promise<{ dispatchRef: string }> {
    throw new Error("Discord 私聊未启用（项目飞书 only，见设计文档）");
  }

  private toInbound(msg: Message<true>): InboundMessage {
    return {
      channel: "discord",
      groupRef: msg.channelId,
      chatType: "group", // 入站已过滤 inGuild，只有群消息
      authorRef: msg.author.id,
      text: msg.content,
      replyToRef: msg.reference?.messageId ?? null,
      messageRef: msg.id,
      at: msg.createdAt,
      raw: msg,
    };
  }
}
