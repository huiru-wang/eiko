/** Message 路由 */
import { Hono } from "hono";
import type { MessageRepository } from "../modules/message/message.repository.js";

export function createMessageRoutes(messageRepo: MessageRepository): Hono {
  const app = new Hono();

  // GET /api/messages?topicId=xxx — Topic 下的 Message 历史
  app.get("/", async (c) => {
    const topicId = c.req.query("topicId");
    if (!topicId) return c.json({ success: false, errorCode: "MISSING_PARAM", errorMsg: "topicId required" }, 400);

    const messages = await messageRepo.findByTopicId(topicId);
    return c.json({ result: messages, success: true, errorCode: null, errorMsg: null });
  });

  return app;
}
