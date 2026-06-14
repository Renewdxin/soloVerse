import type { Clock } from "../ports";
import type { Job } from "./job";

export interface SchedulerDeps {
  jobs: Job[];
  clock: Clock;
  tickMs: number;
  onError: (error: unknown, context: string) => void;
}

/**
 * 进程内轮询调度器：通用 tick 循环，每 tick 依次跑各 Job，Job 之间隔离失败。
 * 启动时先补跑一次（错过的到期项在 Job 内按落库的到期时间补上，重启安全）。
 * 「做什么」全在 Job 里——加行为不改这里。
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(private readonly deps: SchedulerDeps) {}

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.tickOnce();
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  async tickOnce(): Promise<void> {
    const now = this.deps.clock.now();
    for (const job of this.deps.jobs) {
      try {
        await job.runDue(now);
      } catch (error) {
        this.deps.onError(error, `job ${job.name}`);
      }
    }
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runScheduledTick();
    }, this.deps.tickMs);
  }

  private async runScheduledTick(): Promise<void> {
    await this.tickOnce();
    this.schedule();
  }
}
