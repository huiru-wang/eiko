/**
 * Topic 自动整理服务 — Agent 重写 Markdown。
 * TODO: 完整实现。
 */
import type { TopicRepository } from "../modules/topic/topic.repository.js";

export async function organizeTopic(topicRepo: TopicRepository, topicId: string) {
  const topic = await topicRepo.findById(topicId);
  if (!topic) throw new Error("Topic not found");

  // TODO: 通过 Agent 整理 Markdown
  // 1. 获取关联 Records
  // 2. 调用 Agent 生成结构化文档
  // 3. 更新 topic.bodyMarkdown

  await topicRepo.update(topicId, { needsOrganize: false });
}
