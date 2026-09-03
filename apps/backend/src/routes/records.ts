/** Record 路由 */
import { Hono } from "hono";
import { z } from "zod";
import type { RecordRepository } from "../modules/record/record.repository.js";
import type { VectorStore } from "../infrastructure/vector-store.js";
import { logInfo, logWarn } from "../infrastructure/logger.js";

const CreateRecordSchema = z.object({
  content: z.string().min(1),
  source: z.string().optional(),
});

export function createRecordRoutes(recordRepo: RecordRepository, vectorStore?: VectorStore): Hono {
  const app = new Hono();

  // POST /api/records — 创建 Record
  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreateRecordSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, errorMsg: parsed.error.message }, 400);

    // TODO: 从认证中间件获取 userId
    const userId = c.req.header("x-user-id") ?? "default-user";

    const record = await recordRepo.create({ userId, ...parsed.data });
    logInfo("records", "record created", { recordId: record.id, userId, contentLength: record.content.length });
    if (vectorStore) {
      void vectorStore.upsertRecord(record).catch((err) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        logWarn("records", "upsert record vector failed", { recordId: record.id, userId, error: message });
      });
    }
    return c.json({ result: record, success: true, errorCode: null, errorMsg: null });
  });

  // GET /api/records — 分页查询
  app.get("/", async (c) => {
    const userId = c.req.header("x-user-id") ?? "default-user";
    const cursor = c.req.query("cursor") ?? undefined;
    const limit = parseInt(c.req.query("limit") ?? "20", 10);

    const records = await recordRepo.findByUserId(userId, { cursor, limit });
    const lastRecord = records[records.length - 1];

    return c.json({
      result: {
        data: records,
        nextCursor: records.length === limit ? lastRecord?.createdAt ?? null : null,
        hasMore: records.length === limit,
        total: 0, // TODO: count query
        pageSize: limit,
      },
      success: true,
      errorCode: null,
      errorMsg: null,
    });
  });

  return app;
}
