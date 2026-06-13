import { defineConfig } from "drizzle-kit";

// 迁移：`npm run db:generate` 生成 SQL；应用走 app 启动时的 runPgMigrations（store/pg）。
// 只覆盖 schema.ts 的 6 张核心表；memory_embeddings（schema.memory.ts，需 pgvector）不在内。
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/adapters/store/pg/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
