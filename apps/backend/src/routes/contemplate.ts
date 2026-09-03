/** Contemplate HTTP 路由 */

import { Hono } from "hono";
import type { AppConfig } from "../env.js";
import type { RecordRepository } from "../modules/record/record.repository.js";
import type { TaskRepository } from "../modules/task/task.repository.js";
import type { TopicRepository } from "../modules/topic/topic.repository.js";
import type { VectorStore } from "../infrastructure/vector-store.js";
import { runContemplate } from "../agent/contemplate.service.js";

export function createContemplateRoutes(
  config: AppConfig,
  recordRepo: RecordRepository,
  topicRepo: TopicRepository,
  taskRepo: TaskRepository,
  vectorStore: VectorStore,
): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const userId = (body as any).userId ?? c.req.header("x-user-id") ?? "default-user";

    try {
      const result = await runContemplate({ config, recordRepo, topicRepo, taskRepo, vectorStore, userId });
      return c.json({
        result: {
          taskId: result.taskId,
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
      return c.json({ success: false, errorCode: "CONTEMPLATE_FAILED", errorMsg }, 500);
    }
  });

  app.get("/tasks", async (c) => {
    const userId = c.req.header("x-user-id") ?? "default-user";
    const limit = parseInt(c.req.query("limit") ?? "20", 10);
    const tasks = await taskRepo.findByUserId(userId, { limit });
    return c.json({ result: tasks, success: true, errorCode: null, errorMsg: null });
  });

  app.get("/:id", async (c) => {
    const userId = c.req.header("x-user-id") ?? "default-user";
    const task = await taskRepo.findById(c.req.param("id"));
    if (!task || task.userId !== userId) {
      return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Task not found" }, 404);
    }
    return c.json({ result: task, success: true, errorCode: null, errorMsg: null });
  });

  return app;
}
