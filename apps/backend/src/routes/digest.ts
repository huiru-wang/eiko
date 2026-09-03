/**
 * Record 消化 HTTP 路由
 *
 * POST /api/digest — 触发一次 Record 消化任务
 */

import { Hono } from "hono";
import type { AppConfig } from "../env.js";
import type { RecordRepository } from "../modules/record/record.repository.js";
import type { TopicRepository } from "../modules/topic/topic.repository.js";
import { runDigest } from "../agent/digest.service.js";

export function createDigestRoutes(
  config: AppConfig,
  recordRepo: RecordRepository,
  topicRepo: TopicRepository,
): Hono {
  const app = new Hono();

  // POST /api/digest — 触发消化
  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const userId = (body as any).userId ?? c.req.header("x-user-id") ?? "default-user";

    try {
      const result = await runDigest({ config, recordRepo, topicRepo, userId });

      return c.json({
        result: {
          pendingCount: result.pendingCount,
          topicCount: result.topicCount,
          summary: result.summary,
          eventCount: result.events.length,
        },
        success: true,
        errorCode: null,
        errorMsg: null,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, errorCode: "DIGEST_FAILED", errorMsg }, 500);
    }
  });

  return app;
}
