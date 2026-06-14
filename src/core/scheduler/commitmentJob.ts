import type { Evaluator } from "../pipeline/evaluator";
import type { Store } from "../ports";
import type { Job } from "./job";

/**
 * 到期承诺评估作业：nextCheckAt 落库是事实来源，启动补跑靠它。
 * 单条 evaluate 失败只记录，不阻断同一 tick 的其他承诺。
 */
export class CommitmentJob implements Job {
  readonly name = "commitments";

  constructor(
    private readonly deps: {
      store: Store;
      evaluator: Evaluator;
      onError: (error: unknown, context: string) => void;
    },
  ) {}

  async runDue(now: Date): Promise<void> {
    const due = await this.deps.store.dueCommitments(now);
    for (const c of due) {
      try {
        await this.deps.evaluator.evaluate(c);
      } catch (error) {
        this.deps.onError(error, `evaluate ${c.id}`);
      }
    }
  }
}
