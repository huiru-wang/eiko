/** Topic 路由 */
import { Hono } from "hono";
import { z } from "zod";
import { decodeTopicCursor, encodeTopicCursor } from "../modules/topic/topic-cursor.js";
import type { TopicRepository } from "../modules/topic/topic.repository.js";

export function createTopicRoutes(topicRepo: TopicRepository): Hono {
  const app = new Hono();

  // GET /api/topics — 分页查询
  app.get("/", async (c) => {
    const userId = c.req.header("x-user-id") ?? "default-user";
    const parsed = z.object({ cursor: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }).safeParse(c.req.query());
    if (!parsed.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: parsed.error.message }, 400);
    const { cursor, limit } = parsed.data;
    try { if (cursor) decodeTopicCursor(cursor); }
    catch { return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid topic cursor" }, 400); }

    const rows = await topicRepo.findByUserId(userId, { cursor, limit: limit + 1 });
    const hasMore = rows.length > limit;
    const topics = rows.slice(0, limit);
    const lastTopic = topics[topics.length - 1];

    return c.json({
      result: {
        data: topics,
        nextCursor: hasMore && lastTopic ? encodeTopicCursor(lastTopic) : null,
        hasMore,
        total: 0,
        pageSize: limit,
      },
      success: true,
      errorCode: null,
      errorMsg: null,
    });
  });

  // GET /api/topics/:topicId — 详情，关联记录通过 records 接口读取
  app.get("/:topicId", async (c) => {
    const topic = await topicRepo.findById(c.req.param("topicId"));
    const userId = c.req.header("x-user-id") ?? "default-user";
    if (!topic || topic.userId !== userId) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Topic not found" }, 404);

    return c.json({ result: topic, success: true, errorCode: null, errorMsg: null });
  });

  return app;
}
