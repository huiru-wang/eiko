/** Message 路由 */
import { Hono } from "hono";
import type { MessageRepository } from "../modules/message/message.repository.js";
import type { TopicRepository } from "../modules/topic/topic.repository.js";

export function createMessageRoutes(messageRepo: MessageRepository, topicRepo: TopicRepository): Hono {
  const app = new Hono();

  // GET /api/messages?topicId=xxx — Topic 下的 Message 历史
  app.get("/", async (c) => {
    const topicId = c.req.query("topicId");
    if (!topicId) return c.json({ success: false, errorCode: "MISSING_PARAM", errorMsg: "topicId required" }, 400);

    const userId = c.req.header("x-user-id") ?? "default-user";
    const topic = await topicRepo.findById(topicId);
    if (!topic || topic.userId !== userId) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Topic not found" }, 404);
    const messages = await messageRepo.findByTopicId(topicId, { userId, sessionId: topic.sessionId });
    return c.json({ result: messages, success: true, errorCode: null, errorMsg: null });
  });

  return app;
}
