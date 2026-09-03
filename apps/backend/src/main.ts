/**
 * 入口文件 — 参照 pi-agent 的 main.ts。
 *
 * loadEnv() → loadConfig() → initDatabase() → SessionManager → createApp() → startServer()
 */

import { serve } from "@hono/node-server";
import { loadEnv, loadConfig } from "./env.js";
import { createDatabase, runMigrations } from "./infrastructure/database.js";
import { createApp } from "./server.js";
import { SessionManager } from "./agent/session.js";
import { createAgentRuntime } from "./agent/runtime.js";
import { SqliteRecordRepository } from "./infrastructure/repositories/sqlite-record.repository.js";
import { SqliteTopicRepository } from "./infrastructure/repositories/sqlite-topic.repository.js";
import { SqliteMessageRepository } from "./infrastructure/repositories/sqlite-message.repository.js";
import { SqliteTaskRepository } from "./infrastructure/repositories/sqlite-task.repository.js";
import { SqliteVecVectorStore } from "./infrastructure/vector-store.js";
import { Scheduler } from "./scheduler/scheduler.js";
import { createOrganizerTrigger } from "./scheduler/organizer-trigger.js";

// ─── 1. 加载环境配置 ──────────────────────────────────────────────
loadEnv();
const config = loadConfig();

console.log("[main] Config:", { provider: config.provider, model: config.model, port: config.port });

// ─── 2. 初始化数据库 ──────────────────────────────────────────────
const db = createDatabase(config.sqlitePath);
console.log("[main] Database initialized:", config.sqlitePath);

await runMigrations(db);
console.log("[main] Migrations completed");

// ─── 2.5 确保默认用户存在 ────────────────────────────────────────
const existingUser = await db.selectFrom("users").select("id").where("id", "=", "default-user").executeTakeFirst();
if (!existingUser) {
  await db.insertInto("users").values({ id: "default-user", wx_openid: "default", created_at: new Date().toISOString() }).execute();
  console.log("[main] Default user created");
}

// ─── 3. 创建仓库实例 ─────────────────────────────────────────────
const recordRepo = new SqliteRecordRepository(db);
const topicRepo = new SqliteTopicRepository(db);
const messageRepo = new SqliteMessageRepository(db);
const taskRepo = new SqliteTaskRepository(db);
const vectorStore = new SqliteVecVectorStore(db, config);

// ─── 4. 创建 SessionManager ──────────────────────────────────────
const sessionManager = new SessionManager((opts) => createAgentRuntime(opts));

// ─── 5. 构建 Hono App ────────────────────────────────────────────
const app = createApp({
  config,
  sessionManager,
  recordRepo,
  topicRepo,
  messageRepo,
  taskRepo,
  vectorStore,
});

// ─── 6. 启动调度器 ────────────────────────────────────────────────
const scheduler = new Scheduler();
scheduler.register("organizer", config.organizerCron, createOrganizerTrigger(recordRepo, topicRepo));
scheduler.start();

// ─── 7. 启动 HTTP 服务 ────────────────────────────────────────────
const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
});

console.log(`[main] Server listening on http://${config.host}:${config.port}`);

// ─── 8. 优雅退出 ──────────────────────────────────────────────────
const shutdown = async () => {
  console.log("\n[main] Shutting down...");
  scheduler.stop();
  sessionManager.cleanupAll();
  db.destroy();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
