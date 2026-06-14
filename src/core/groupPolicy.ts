import type { GroupMode } from "./domain/types";

export type { GroupMode };

export interface GroupPolicyConfig {
  readWrite: string[];
  readOnly: string[];
}

/**
 * 群发言权：按 groupRef 圈定 bot 在每个群的能力（off / read / readwrite，语义见 domain GroupMode）。
 *
 * 运行时真相在 DB（groups.mode）；本对象是它的**同步内存投影**——boot 时从 DB 载入（load），
 * 加群默认只读 / operator 私聊提权时和 DB 一起改（setMode）。env 种子经构造函数预置，DB 载入后覆盖。
 * readWrite 优先于 readOnly。纯内存、无副作用；由 app 层接线后注入 core。
 */
export class GroupPolicy {
  private readonly modes = new Map<string, GroupMode>();

  constructor(seed?: GroupPolicyConfig) {
    if (seed === undefined) return;
    for (const ref of seed.readOnly) this.modes.set(ref, "read");
    for (const ref of seed.readWrite) this.modes.set(ref, "readwrite"); // rw 覆盖 ro
  }

  mode(groupRef: string): GroupMode {
    return this.modes.get(groupRef) ?? "off";
  }

  /** 是否监听 / 落库这个群的上下文。 */
  canRead(groupRef: string): boolean {
    return this.mode(groupRef) !== "off";
  }

  /** 是否允许在这个群里发言（确认 / 催办 / 台账）。 */
  canPost(groupRef: string): boolean {
    return this.mode(groupRef) === "readwrite";
  }

  /** 运行时改一个群的权限（加群默认只读 / operator DM 提权）；调用方负责同时落 DB。 */
  setMode(groupRef: string, mode: GroupMode): void {
    this.modes.set(groupRef, mode);
  }

  /** boot 时从 DB 载入已知群权限（DB 是运行时真相，覆盖 env 种子）。 */
  load(groups: { id: string; mode: GroupMode }[]): void {
    for (const g of groups) this.modes.set(g.id, g.mode);
  }
}
