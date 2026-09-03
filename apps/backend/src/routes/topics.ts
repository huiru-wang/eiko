/** Topic 路由 */
import { Hono } from "hono";
import type { TopicRepository } from "../modules/topic/topic.repository.js";

export function createTopicRoutes(topicRepo: TopicRepository): Hono {
  const app = new Hono();

  // GET /api/topics — 分页查询
  app.get("/", async (c) => {
    const userId = c.req.header("x-user-id") ?? "default-user";
    const cursor = c.req.query("cursor") ?? undefined;
    const limit = parseInt(c.req.query("limit") ?? "20", 10);

    const topics = await topicRepo.findByUserId(userId, { cursor, limit });
    const lastTopic = topics[topics.length - 1];

    return c.json({
      result: {
        data: topics,
        nextCursor: topics.length === limit ? lastTopic?.updatedAt ?? null : null,
        hasMore: topics.length === limit,
        total: 0,
        pageSize: limit,
      },
      success: true,
      errorCode: null,
      errorMsg: null,
    });
  });

  // GET /api/topics/:topicId — 详情 + relatedRecords
  app.get("/:topicId", async (c) => {
    const topic = await topicRepo.findById(c.req.param("topicId"));
    if (!topic) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Topic not found" }, 404);

    return c.json({ result: topic, success: true, errorCode: null, errorMsg: null });
  });

  return app;
}
