/**
 * Topic 对话服务 — Agent 流式回复 + TopicAction 提取。
 * TODO: 完整实现。
 */
import type { TopicRepository } from "../modules/topic/topic.repository.js";

export async function topicChat(
  topicRepo: TopicRepository,
  topicId: string,
  userMessage: string,
) {
  const topic = await topicRepo.findById(topicId);
  if (!topic) throw new Error("Topic not found");

  // TODO: 通过 SessionManager 获取 Agent，发送消息，返回 SSE 流
  return { topicId, message: "TODO: Agent response" };
}
