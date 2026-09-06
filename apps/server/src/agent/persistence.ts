/**
 * Agent 持久化辅助 — 消息存储到 SQLite messages 表。
 *
 * AgentEvent 通过 subscribe() 自动写入，payload 存完整 JSON。
 * 支持后续 Compaction：当消息数超阈值时，调用 Agent 压缩历史。
 */

import type { Kysely } from "kysely";
import type { DB } from "../infrastructure/schema.js";

/**
 * 读取 Topic 下的消息数量（用于判断是否需要 Compaction）。
 */
export async function getMessageCount(db: Kysely<DB>, topicId: string): Promise<number> {
  const result = await db
    .selectFrom("messages")
    .select(db.fn.countAll<number>().as("count"))
    .where("topic_id", "=", topicId)
    .executeTakeFirstOrThrow();
  return result.count;
}

/**
 * Compaction 阈值配置。
 */
export const COMPACTION_THRESHOLD = 50;
