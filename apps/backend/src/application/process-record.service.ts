/**
 * Record 消化服务 — Agent 判断关联/创建 Topic。
 * TODO: 接入 Agent 完整消化流程。
 */
import type { RecordRepository } from "../modules/record/record.repository.js";
import type { TopicRepository } from "../modules/topic/topic.repository.js";

export async function processRecord(
  recordRepo: RecordRepository,
  topicRepo: TopicRepository,
  recordId: string,
  userId: string,
) {
  await recordRepo.updateStatus(recordId, "processing");

  // TODO: 调用 Agent 进行消化判断
  // 1. 获取已有 Topics
  // 2. 让 Agent 判断：link / create / skip
  // 3. 执行相应操作

  await recordRepo.updateStatus(recordId, "digested");
}
