/**
 * Hono App 构造 — 参照 pi-agent 的 server.ts。
 *
 * 注册 CORS 中间件，挂载所有 routes。
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppConfig } from "./env.js";
import type { SessionManager } from "./agent/session.js";
import type { RecordRepository } from "./modules/record/record.repository.js";
import type { TaskRepository } from "./modules/task/task.repository.js";
import type { TopicRepository } from "./modules/topic/topic.repository.js";
import type { MessageRepository } from "./modules/message/message.repository.js";
import type { VectorStore } from "./infrastructure/vector-store.js";
import { createRecordRoutes } from "./routes/records.js";
import { createTopicRoutes } from "./routes/topics.js";
import { createMessageRoutes } from "./routes/messages.js";
import { createAgentRoutes } from "./routes/agent.js";
import { createDigestRoutes } from "./routes/digest.js";
import { createContemplateRoutes } from "./routes/contemplate.js";
import { nowIso } from "./infrastructure/time.js";

export interface CreateAppOptions {
  config: AppConfig;
  sessionManager: SessionManager;
  recordRepo: RecordRepository;
  topicRepo: TopicRepository;
  messageRepo: MessageRepository;
  taskRepo: TaskRepository;
  vectorStore: VectorStore;
}

export function createApp(opts: CreateAppOptions): Hono {
  const app = new Hono();

  // CORS
  app.use("*", cors());

  // Health check
  app.get("/health", (c) => c.json({ status: "ok", timestamp: nowIso() }));

  // API Routes
  app.route("/api/records", createRecordRoutes(opts.recordRepo, opts.vectorStore));
  app.route("/api/topics", createTopicRoutes(opts.topicRepo));
  app.route("/api/messages", createMessageRoutes(opts.messageRepo, opts.topicRepo));
  app.route("/api/agent", createAgentRoutes(opts.sessionManager, opts.config, opts.messageRepo));
  app.route("/api/contemplate", createContemplateRoutes(opts.config, opts.recordRepo, opts.topicRepo, opts.taskRepo, opts.vectorStore));
  app.route("/api/digest", createDigestRoutes(opts.config, opts.recordRepo, opts.topicRepo, opts.taskRepo, opts.vectorStore));

  return app;
}
