/**
 * Agent SSE 流式路由 — 参照 pi-agent 的 server.ts。
 *
 * POST /api/agent/stream
 * 使用 agent.subscribe() → AgentEvent → SSE frame
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { SessionManager } from "../agent/session.js";
import type { AppConfig } from "../env.js";
import type { MessageRepository } from "../modules/message/message.repository.js";

export function createAgentRoutes(
  sessionManager: SessionManager,
  config: AppConfig,
  messageRepo: MessageRepository,
): Hono {
  const app = new Hono();

  // POST /api/agent/stream
  app.post("/stream", async (c) => {
    const body = await c.req.json();
    const { sessionId, topicId, userId, message } = body as {
      sessionId: string;
      topicId: string;
      userId: string;
      message: string;
    };

    if (!sessionId || !topicId || !userId || !message) {
      return c.json({ success: false, errorCode: "MISSING_PARAM", errorMsg: "sessionId, topicId, userId, message required" }, 400);
    }

    const thread = await sessionManager.getOrCreate(userId, sessionId, {
      config,
      messageRepo,
      userId,
      topicId,
      sessionId,
    });

    const { agent } = thread.runtime;

    return streamSSE(c, async (stream) => {
      const unsubscribe = agent.subscribe(async (event: AgentEvent) => {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
        });
      });

      try {
        // 发送用户消息并等待完成
        await agent.prompt(message);
        await agent.waitForIdle();

        await stream.writeSSE({ data: "[DONE]", event: "done" });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        await stream.writeSSE({ data: JSON.stringify({ error: errorMsg }), event: "error" });
      } finally {
        unsubscribe();
      }
    });
  });

  return app;
}
