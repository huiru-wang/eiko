/**
 * Organizer 定时触发器 — 扫描 pending Records + needsOrganize Topics → 处理。
 * TODO: 完整实现。
 */
import type { RecordRepository } from "../modules/record/record.repository.js";
import type { TopicRepository } from "../modules/topic/topic.repository.js";

export function createOrganizerTrigger(
  recordRepo: RecordRepository,
  topicRepo: TopicRepository,
): () => Promise<void> {
  return async () => {
    // TODO: 扫描 pending Records → 批量消化
    // TODO: 扫描 needsOrganize Topics → 批量整理
    console.log("[organizer] tick - no pending items yet");
  };
}
