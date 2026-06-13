// 内存 Store（M0/测试用；M1 换 SqliteStore，schema 见 ./sqlite/schema.ts）
import type {
  Commitment,
  Evidence,
  Feedback,
  Group,
  Interaction,
  Intervention,
  Person,
} from "../../core/domain/types";
import type { Repo, Store } from "../../core/ports";

class MemRepo<T extends { id: string }> implements Repo<T> {
  private readonly items = new Map<string, T>();

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null;
  }
  async put(item: T): Promise<void> {
    this.items.set(item.id, item);
  }
  async all(): Promise<T[]> {
    return [...this.items.values()];
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemoryStore implements Store {
  readonly commitments = new MemRepo<Commitment>();
  readonly evidence = new MemRepo<Evidence>();
  readonly interventions = new MemRepo<Intervention>();
  readonly interactions = new MemRepo<Interaction>();
  readonly people = new MemRepo<Person>();
  readonly groups = new MemRepo<Group>();
  readonly feedback = new MemRepo<Feedback>();

  async dueCommitments(now: Date): Promise<Commitment[]> {
    const all = await this.commitments.all();
    return all.filter((c) => c.nextCheckAt !== null && c.nextCheckAt <= now);
  }
}
