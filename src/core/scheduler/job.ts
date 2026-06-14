/**
 * 调度作业：一件「到点要做的事」。Scheduler 只管按 tick 轮询、补跑、隔离失败；
 * 「做什么、什么算到期」交给各 Job 自己（评估到期承诺、推 digest、日后周报/清理…）。
 * 加新定时行为 = 加一个 Job，不动 Scheduler。
 */
export interface Job {
  readonly name: string;
  /** 跑这一 tick 该 Job 所有到期的工作；Job 内部自己隔离单条失败。 */
  runDue(now: Date): Promise<void>;
}
