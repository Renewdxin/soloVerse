// 承诺状态机（architecture §6）。纯逻辑、可测。
import type { CommitmentStatus } from "./types";

/** 合法转移：from → 允许的 to 集合。拒绝 proposed 时不建档，不进状态机。 */
const TRANSITIONS: Record<CommitmentStatus, readonly CommitmentStatus[]> = {
  proposed: ["active"],
  active: ["at_risk", "fulfilled", "snoozed", "abandoned", "failed"],
  at_risk: ["active", "fulfilled", "snoozed", "abandoned", "failed"],
  snoozed: ["active", "abandoned"],
  failed: ["active"], // 改期复活
  fulfilled: [], // 终态
  abandoned: [], // 终态
};

export function canTransition(from: CommitmentStatus, to: CommitmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: CommitmentStatus, to: CommitmentStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`非法状态转移：${from} → ${to}`);
  }
}

export function isTerminal(status: CommitmentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
