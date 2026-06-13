// 核心 6 表的幂等建表 DDL。**改了 schema.ts 记得同步这里**（两者必须一致）。
// 为什么手写而非 drizzle-kit migrate：当前 drizzle-kit 0.28 在本机 esbuild 报 "Invalid target es2023"
// （工具版本 bug）。等修好可切回生成式迁移（drizzle.config.ts 已就位）。
// memory_embeddings（pgvector）不在内——它需要 CREATE EXTENSION（平台 user-only），Stage B 再单独迁移。
export const CORE_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS commitments (
  id text PRIMARY KEY,
  group_ref text NOT NULL,
  assignee text NOT NULL,
  title text NOT NULL,
  raw_text text NOT NULL,
  source_channel text NOT NULL,
  source_message_ref text NOT NULL,
  source_at timestamptz NOT NULL,
  status text NOT NULL,
  due_at timestamptz,
  verification jsonb NOT NULL,
  confidence double precision NOT NULL,
  tags jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  next_check_at timestamptz
);
CREATE TABLE IF NOT EXISTS evidence (
  id text PRIMARY KEY,
  commitment_id text NOT NULL,
  captured_at timestamptz NOT NULL,
  source text NOT NULL,
  verdict text NOT NULL,
  summary text NOT NULL,
  raw jsonb
);
CREATE TABLE IF NOT EXISTS interventions (
  id text PRIMARY KEY,
  commitment_id text NOT NULL,
  at timestamptz NOT NULL,
  decision text NOT NULL,
  reason text NOT NULL,
  message text,
  channel text,
  dispatch_ref text
);
CREATE TABLE IF NOT EXISTS interactions (
  id text PRIMARY KEY,
  group_ref text NOT NULL,
  channel text NOT NULL,
  direction text NOT NULL,
  author_ref text NOT NULL,
  text text NOT NULL,
  at timestamptz NOT NULL,
  commitment_id text
);
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  handles jsonb NOT NULL,
  is_operator boolean NOT NULL,
  digest_pref jsonb,
  last_digest_at timestamptz
);
CREATE TABLE IF NOT EXISTS groups (
  id text PRIMARY KEY,
  channel text NOT NULL,
  name text,
  first_seen_at timestamptz NOT NULL,
  mode text NOT NULL DEFAULT 'read',
  prompted_at timestamptz
);
-- 旧库（建表早于 per-group 权限）补列：幂等，安全反复执行。
ALTER TABLE groups ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'read';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS prompted_at timestamptz;
CREATE TABLE IF NOT EXISTS feedback (
  id text PRIMARY KEY,
  at timestamptz NOT NULL,
  kind text NOT NULL,
  commitment_id text,
  note text NOT NULL,
  data jsonb
);
`;
