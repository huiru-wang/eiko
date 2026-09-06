/** Record 路由 */
import { Hono } from "hono";
import { z } from "zod";
import type { RecordRepository } from "../modules/record/record.repository.js";
import type { VectorStore } from "../infrastructure/vector-store.js";
import { logInfo, logWarn } from "../infrastructure/logger.js";
import { decodeRecordCursor, encodeRecordCursor } from "../modules/record/record-cursor.js";

const CreateRecordSchema = z.object({
  content: z.string().min(1),
  source: z.string().optional(),
});

const CreateRecordBatchSchema = z.object({
  records: z.array(CreateRecordSchema.extend({ content: z.string().trim().min(1) })).min(1).max(100),
});

export function createRecordRoutes(recordRepo: RecordRepository, vectorStore?: VectorStore): Hono {
  const app = new Hono();

  app.patch("/:id", async (c) => {
    const parsed = z.object({ content: z.string().trim().min(1) }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: parsed.error.message }, 400);
    const userId = c.req.header("x-user-id") ?? "default-user";
    const result = await recordRepo.updateContent(c.req.param("id"), userId, parsed.data.content);
    if (result === "not_found") return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Record not found" }, 404);
    if (result === "processing") return c.json({ success: false, errorCode: "RECORD_PROCESSING", errorMsg: "Record is being organized" }, 409);
    if (result.changed) {
      logInfo("records", "record updated", { recordId: result.record.id, userId, status: result.record.status });
      if (vectorStore) void vectorStore.upsertRecord(result.record).catch((err) => {
        logWarn("records", "upsert record vector failed", { recordId: result.record.id, userId, error: err instanceof Error ? err.message : "Unknown error" });
      });
    }
    return c.json({ result: result.record, success: true, errorCode: null, errorMsg: null });
  });

  app.post("/batch", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateRecordBatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: parsed.error.message }, 400);
    }
    const userId = c.req.header("x-user-id") ?? "default-user";
    const records = await recordRepo.createMany(parsed.data.records.map((record) => ({ ...record, userId })));
    logInfo("records", "record batch created", { userId, recordCount: records.length, recordIds: records.map((record) => record.id) });

    if (vectorStore) {
      // Keep embedding requests sequential without delaying the HTTP response.
      void (async () => {
        let failedCount = 0;
        for (const record of records) {
          try {
            await vectorStore.upsertRecord(record);
          } catch (err) {
            failedCount++;
            logWarn("records", "upsert record vector failed", {
              recordId: record.id, userId, error: err instanceof Error ? err.message : "Unknown error",
            });
          }
        }
        logInfo("records", "record batch vectorization completed", { userId, recordCount: records.length, failedCount });
      })();
    }
    return c.json({ result: { data: records, count: records.length }, success: true, errorCode: null, errorMsg: null });
  });

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
    const parsed = z.object({
      cursor: z.string().min(1).optional(),
      topicId: z.string().trim().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }).safeParse(c.req.query());
    if (!parsed.success) return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: parsed.error.message }, 400);
    const { cursor, topicId, limit } = parsed.data;
    try { if (cursor) decodeRecordCursor(cursor); }
    catch { return c.json({ success: false, errorCode: "INVALID_INPUT", errorMsg: "Invalid record cursor" }, 400); }

    const rows = await recordRepo.findByUserId(userId, { cursor, topicId, limit: limit + 1 });
    const hasMore = rows.length > limit;
    const records = rows.slice(0, limit);
    const links = await recordRepo.findTopicLinks(userId, records.map((record) => record.id));
    const topicsByRecord = new Map<string, Array<{ id: string; title: string; status: string }>>();
    for (const { recordId, ...topic } of links) {
      const topics = topicsByRecord.get(recordId) ?? [];
      topics.push(topic);
      topicsByRecord.set(recordId, topics);
    }
    const lastRecord = records[records.length - 1];

    return c.json({
      result: {
        data: records.map((record) => ({ ...record, topics: topicsByRecord.get(record.id) ?? [] })),
        nextCursor: hasMore && lastRecord ? encodeRecordCursor(lastRecord) : null,
        hasMore,
        total: 0, // TODO: count query
        pageSize: limit,
      },
      success: true,
      errorCode: null,
      errorMsg: null,
    });
  });

  app.get("/:id", async (c) => {
    const userId = c.req.header("x-user-id") ?? "default-user";
    const record = await recordRepo.findById(c.req.param("id"));
    if (!record || record.userId !== userId) return c.json({ success: false, errorCode: "NOT_FOUND", errorMsg: "Record not found" }, 404);
    const topics = (await recordRepo.findTopicLinks(userId, [record.id])).map(({ recordId, ...topic }) => topic);
    return c.json({ result: { ...record, topics }, success: true, errorCode: null, errorMsg: null });
  });

  return app;
}
