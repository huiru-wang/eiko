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
import type { TopicRepository } from "./modules/topic/topic.repository.js";
import type { MessageRepository } from "./modules/message/message.repository.js";
import { createRecordRoutes } from "./routes/records.js";
import { createTopicRoutes } from "./routes/topics.js";
import { createMessageRoutes } from "./routes/messages.js";
import { createAgentRoutes } from "./routes/agent.js";
import { createDigestRoutes } from "./routes/digest.js";

export interface CreateAppOptions {
  config: AppConfig;
  sessionManager: SessionManager;
  recordRepo: RecordRepository;
  topicRepo: TopicRepository;
  messageRepo: MessageRepository;
}

export function createApp(opts: CreateAppOptions): Hono {
  const app = new Hono();

  // CORS
  app.use("*", cors());

  // Health check
  app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  // API Routes
  app.route("/api/records", createRecordRoutes(opts.recordRepo));
  app.route("/api/topics", createTopicRoutes(opts.topicRepo));
  app.route("/api/messages", createMessageRoutes(opts.messageRepo));
  app.route("/api/agent", createAgentRoutes(opts.sessionManager, opts.config, opts.messageRepo));
  app.route("/api/digest", createDigestRoutes(opts.config, opts.recordRepo, opts.topicRepo));

  return app;
}
