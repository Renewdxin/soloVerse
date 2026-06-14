// nextCheckAt 调度策略（architecture §8.2）。纯函数、可测。
import type { CommitmentStatus } from "../domain/types";

const HOUR = 3_600_000;
/** 逾期宽限窗：超过则停止调度，由上层标记 failed。 */
export const GRACE_MS = 24 * HOUR;

/**
 * 算下一次检查时间。返回 null = 停止调度（终态 / 非监督态 / 逾期超宽限）。
 * snoozed 不走这里——由 snooze 逻辑直接把 nextCheckAt 设成 wakeAt。
 */
export function computeNextCheckAt(
  now: Date,
  dueAt: Date | null,
  status: CommitmentStatus,
): Date | null {
  if (status !== "active" && status !== "at_risk") return null;
  const t = now.getTime();
  if (dueAt === null) return new Date(t + 24 * HOUR);

  const left = dueAt.getTime() - t;
  if (left <= 0) {
    // 逾期：宽限内低频探，超出宽限停（上层判 failed）
    return left < -GRACE_MS ? null : new Date(t + 2 * HOUR);
  }
  if (status === "at_risk" || left < 6 * HOUR) return new Date(t + HOUR);
  if (left < 24 * HOUR) return new Date(t + 3 * HOUR);
  if (left < 7 * 24 * HOUR) return new Date(t + 12 * HOUR);
  return new Date(t + 24 * HOUR);
}
