// 持久化模型（Drizzle + Postgres，托管走 Supabase/Neon 的连接串）。
// 顶层时间用 timestamptz(mode:date) 自动收发 Date；嵌套对象（verification/tags/handles/raw/data）用 jsonb。
import { boolean, doublePrecision, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const commitments = pgTable("commitments", {
  id: text("id").primaryKey(),
  groupRef: text("group_ref").notNull(),
  assignee: text("assignee").notNull(),
  title: text("title").notNull(),
  rawText: text("raw_text").notNull(),
  sourceChannel: text("source_channel").notNull(),
  sourceMessageRef: text("source_message_ref").notNull(),
  sourceAt: ts("source_at").notNull(),
  status: text("status").notNull(),
  dueAt: ts("due_at"),
  verification: jsonb("verification").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  tags: jsonb("tags").notNull(),
  createdAt: ts("created_at").notNull(),
  confirmedAt: ts("confirmed_at"),
  nextCheckAt: ts("next_check_at"),
});

export const evidence = pgTable("evidence", {
  id: text("id").primaryKey(),
  commitmentId: text("commitment_id").notNull(),
  capturedAt: ts("captured_at").notNull(),
  source: text("source").notNull(),
  verdict: text("verdict").notNull(),
  summary: text("summary").notNull(),
  raw: jsonb("raw"),
});

export const interventions = pgTable("interventions", {
  id: text("id").primaryKey(),
  commitmentId: text("commitment_id").notNull(),
  at: ts("at").notNull(),
  decision: text("decision").notNull(),
  reason: text("reason").notNull(),
  message: text("message"),
  channel: text("channel"),
  dispatchRef: text("dispatch_ref"),
});

export const interactions = pgTable("interactions", {
  id: text("id").primaryKey(),
  groupRef: text("group_ref").notNull(),
  channel: text("channel").notNull(),
  direction: text("direction").notNull(),
  authorRef: text("author_ref").notNull(),
  text: text("text").notNull(),
  at: ts("at").notNull(),
  commitmentId: text("commitment_id"),
});

export const people = pgTable("people", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  handles: jsonb("handles").notNull(),
  isOperator: boolean("is_operator").notNull(),
  digestPref: jsonb("digest_pref"),
  lastDigestAt: ts("last_digest_at"),
});

export const groups = pgTable("groups", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  name: text("name"),
  firstSeenAt: ts("first_seen_at").notNull(),
  mode: text("mode").notNull().default("read"),
  promptedAt: ts("prompted_at"),
});

export const feedback = pgTable("feedback", {
  id: text("id").primaryKey(),
  at: ts("at").notNull(),
  kind: text("kind").notNull(),
  commitmentId: text("commitment_id"),
  note: text("note").notNull(),
  data: jsonb("data"),
});

// memory_embeddings（pgvector，§13.4 语义召回）拆到 schema.memory.ts：它需要 vector 扩展，
// 而 CREATE EXTENSION 是平台 user-only 操作。Stage B 落地时单独迁移，别拖累 6 张核心表上线。
