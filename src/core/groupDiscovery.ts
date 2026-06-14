import type { Group } from "./domain/types";
import type { InboundMessage, Store } from "./ports";

/**
 * 群发现：bot 在群里第一次收到消息就把群记进库——省得人去飞书后台抄 chat_id。
 * 新群 mode 默认 **read**（加群即只读上岗，不主动发言；operator 私聊提权到 readwrite，
 * 见 core/operatorConsole）。私聊（p2p）不记。只记首次见到，不覆盖。
 *
 * 返回**新建的群**供调用方触发上岗私聊；已存在 / p2p 返回 null。
 */
export async function recordGroup(store: Store, msg: InboundMessage): Promise<Group | null> {
  if (msg.chatType === "p2p") return null;
  if ((await store.groups.get(msg.groupRef)) !== null) return null;
  const group: Group = {
    id: msg.groupRef,
    channel: msg.channel,
    name: null,
    firstSeenAt: msg.at,
    mode: "read",
    promptedAt: null,
  };
  await store.groups.put(group);
  return group;
}
