// Postgres Store（Drizzle + postgres-js）。托管走 Supabase/Neon 的连接串（标准 PG，不走 MCP）。
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type {
  ChannelKind,
  Commitment,
  CommitmentStatus,
  Evidence,
  Feedback,
  Group,
  Interaction,
  Intervention,
  InterventionDecision,
  Person,
  Verdict,
  VerificationSpec,
  VerifierKind,
} from "../../../core/domain/types";
import type { Repo, Store } from "../../../core/ports";
import { CORE_SCHEMA_DDL } from "./ddl";
import * as schema from "./schema";

type Db = PostgresJsDatabase<typeof schema>;

/** 通用单表 repo：CRUD + 行↔领域映射。table/行的具体类型交给 drizzle 运行期，这里只保证 Repo<T> 对外类型安全。 */
class PgRepo<T extends { id: string }> implements Repo<T> {
  constructor(
    private readonly db: Db,
    // biome-ignore lint/suspicious/noExplicitAny: drizzle 表泛型，运行期安全
    private readonly table: any,
    private readonly toRow: (d: T) => Record<string, unknown>,
    // biome-ignore lint/suspicious/noExplicitAny: 行类型由具体表决定
    private readonly toDomain: (r: any) => T,
  ) {}

  async get(id: string): Promise<T | null> {
    const rows = await this.db.select().from(this.table).where(eq(this.table.id, id));
    return rows[0] === undefined ? null : this.toDomain(rows[0]);
  }
  async put(item: T): Promise<void> {
    const row = this.toRow(item);
    await this.db
      .insert(this.table)
      .values(row)
      .onConflictDoUpdate({ target: this.table.id, set: row });
  }
  async all(): Promise<T[]> {
    const rows = await this.db.select().from(this.table);
    return rows.map((r) => this.toDomain(r));
  }
  async delete(id: string): Promise<void> {
    await this.db.delete(this.table).where(eq(this.table.id, id));
  }
}

type CommitmentRow = typeof schema.commitments.$inferSelect;
const commitmentToRow = (c: Commitment): Record<string, unknown> => ({
  id: c.id,
  groupRef: c.groupRef,
  assignee: c.assignee,
  title: c.title,
  rawText: c.rawText,
  sourceChannel: c.source.channel,
  sourceMessageRef: c.source.messageRef,
  sourceAt: c.source.at,
  status: c.status,
  dueAt: c.dueAt,
  verification: c.verification,
  confidence: c.confidence,
  tags: c.tags,
  createdAt: c.createdAt,
  confirmedAt: c.confirmedAt,
  nextCheckAt: c.nextCheckAt,
});
const rowToCommitment = (r: CommitmentRow): Commitment => ({
  id: r.id,
  groupRef: r.groupRef,
  assignee: r.assignee,
  title: r.title,
  rawText: r.rawText,
  source: {
    channel: r.sourceChannel as ChannelKind,
    messageRef: r.sourceMessageRef,
    at: r.sourceAt,
  },
  status: r.status as CommitmentStatus,
  dueAt: r.dueAt,
  verification: r.verification as VerificationSpec,
  confidence: r.confidence,
  tags: r.tags as string[],
  createdAt: r.createdAt,
  confirmedAt: r.confirmedAt,
  nextCheckAt: r.nextCheckAt,
});

type EvidenceRow = typeof schema.evidence.$inferSelect;
const rowToEvidence = (r: EvidenceRow): Evidence => ({
  id: r.id,
  commitmentId: r.commitmentId,
  capturedAt: r.capturedAt,
  source: r.source as VerifierKind,
  verdict: r.verdict as Verdict,
  summary: r.summary,
  raw: r.raw,
});

type InterventionRow = typeof schema.interventions.$inferSelect;
const rowToIntervention = (r: InterventionRow): Intervention => ({
  id: r.id,
  commitmentId: r.commitmentId,
  at: r.at,
  decision: r.decision as InterventionDecision,
  reason: r.reason,
  message: r.message,
  channel: r.channel as ChannelKind | null,
  dispatchRef: r.dispatchRef,
});

type InteractionRow = typeof schema.interactions.$inferSelect;
const rowToInteraction = (r: InteractionRow): Interaction => ({
  id: r.id,
  groupRef: r.groupRef,
  channel: r.channel as ChannelKind,
  direction: r.direction as "in" | "out",
  authorRef: r.authorRef,
  text: r.text,
  at: r.at,
  commitmentId: r.commitmentId,
});

type PersonRow = typeof schema.people.$inferSelect;
const rowToPerson = (r: PersonRow): Person => ({
  id: r.id,
  displayName: r.displayName,
  handles: r.handles as Person["handles"],
  isOperator: r.isOperator,
  ...(r.digestPref != null
    ? { digestPref: r.digestPref as NonNullable<Person["digestPref"]> }
    : {}),
  ...(r.lastDigestAt != null ? { lastDigestAt: r.lastDigestAt } : {}),
});

type GroupRow = typeof schema.groups.$inferSelect;
const rowToGroup = (r: GroupRow): Group => ({
  id: r.id,
  channel: r.channel as ChannelKind,
  name: r.name,
  firstSeenAt: r.firstSeenAt,
  mode: r.mode as Group["mode"],
  promptedAt: r.promptedAt,
});

type FeedbackRow = typeof schema.feedback.$inferSelect;
const rowToFeedback = (r: FeedbackRow): Feedback => ({
  id: r.id,
  at: r.at,
  kind: r.kind as Feedback["kind"],
  commitmentId: r.commitmentId,
  note: r.note,
  data: r.data,
});

/** 领域键名与 schema 列名一致的实体，直接浅拷贝即可入库（Commitment 因 source 拆列单独处理）。 */
const spread = <T extends object>(d: T): Record<string, unknown> =>
  ({ ...d }) as Record<string, unknown>;

export class PgStore implements Store {
  readonly commitments: Repo<Commitment>;
  readonly evidence: Repo<Evidence>;
  readonly interventions: Repo<Intervention>;
  readonly interactions: Repo<Interaction>;
  readonly people: Repo<Person>;
  readonly groups: Repo<Group>;
  readonly feedback: Repo<Feedback>;

  constructor(private readonly db: Db) {
    this.commitments = new PgRepo(db, schema.commitments, commitmentToRow, rowToCommitment);
    this.evidence = new PgRepo(db, schema.evidence, spread<Evidence>, rowToEvidence);
    this.interventions = new PgRepo(
      db,
      schema.interventions,
      spread<Intervention>,
      rowToIntervention,
    );
    this.interactions = new PgRepo(db, schema.interactions, spread<Interaction>, rowToInteraction);
    this.people = new PgRepo(db, schema.people, spread<Person>, rowToPerson);
    this.groups = new PgRepo(db, schema.groups, spread<Group>, rowToGroup);
    this.feedback = new PgRepo(db, schema.feedback, spread<Feedback>, rowToFeedback);
  }

  async dueCommitments(now: Date): Promise<Commitment[]> {
    const c = schema.commitments;
    const rows = await this.db
      .select()
      .from(c)
      .where(and(isNotNull(c.nextCheckAt), lte(c.nextCheckAt, now)));
    return rows.map(rowToCommitment);
  }
}

export function createPgStore(url: string): { store: PgStore; close: () => Promise<void> } {
  const sql = postgres(url);
  const db = drizzle(sql, { schema });
  return { store: new PgStore(db), close: () => sql.end() };
}

/** 启动时幂等建表（CREATE TABLE IF NOT EXISTS）。在 Railway 内部用内网 DATABASE_URL 跑。 */
export async function ensurePgSchema(url: string): Promise<void> {
  // onnotice 静默：CREATE TABLE IF NOT EXISTS 对已存在的表会发一堆 NOTICE，不是错误，别刷日志。
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(CORE_SCHEMA_DDL);
  } finally {
    await sql.end();
  }
}
