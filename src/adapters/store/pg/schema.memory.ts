// Stage B（语义召回）专用：pgvector 记忆向量表。
// 不在默认迁移里——它需要 `CREATE EXTENSION IF NOT EXISTS vector;`，而启用扩展是平台 user-only 操作。
// Stage B 落地时：先由 operator 装好 vector 扩展，再单独为这张表生成/应用迁移。
import { pgTable, text, timestamp, vector } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const memoryEmbeddings = pgTable("memory_embeddings", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // 'commitment' | 'interaction' | 'profile' …
  refId: text("ref_id"),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: ts("created_at").notNull(),
});
