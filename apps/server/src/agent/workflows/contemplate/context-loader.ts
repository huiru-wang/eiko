import type { RecordRepository } from "../../../modules/record/record.repository.js";
import type { Topic } from "../../../modules/topic/topic.js";
import type { TopicRepository } from "../../../modules/topic/topic.repository.js";
import type { VectorStore } from "../../../infrastructure/vector-store.js";
import { logInfo, logWarn } from "../../../infrastructure/logger.js";
import type { ContemplateWorkflowContext } from "./schemas.js";

export async function loadContemplateContext(opts: {
  taskId: string;
  userId: string;
  records: Awaited<ReturnType<RecordRepository["findByUserId"]>>;
  topicRepo: TopicRepository;
  vectorStore: VectorStore;
}): Promise<ContemplateWorkflowContext> {
  const recentTopics = await opts.topicRepo.findByUserId(opts.userId, { limit: 50 });
  const topicIds = new Set(recentTopics.map((topic) => topic.id));
  for (const record of opts.records) {
    for (const topic of await opts.topicRepo.findTopicsByRecordId(record.id)) topicIds.add(topic.id);
  }

  for (const record of opts.records) {
    try {
      const hits = await opts.vectorStore.searchTopics({ query: record.content, topK: 8, userId: opts.userId });
      for (const hit of hits) topicIds.add(hit.topicId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logWarn("contemplate-v2", "vector topic search failed; fallback to recent topics", {
        taskId: opts.taskId,
        recordId: record.id,
        error: message,
      });
    }
  }

  const topics = (await Promise.all([...topicIds].map((id) => opts.topicRepo.findById(id))))
    .filter((topic): topic is Topic => !!topic && topic.userId === opts.userId && topic.status === "active");

  const relatedRecordsByTopicId: ContemplateWorkflowContext["relatedRecordsByTopicId"] = {};
  for (const topic of topics) {
    const relatedRecords = await opts.topicRepo.findRelatedRecordsByTopicId(topic.id);
    relatedRecordsByTopicId[topic.id] = relatedRecords.slice(-20).map((record) => ({
      id: record.id,
      content: record.content,
      createdAt: record.createdAt,
    }));
  }

  const context: ContemplateWorkflowContext = {
    taskId: opts.taskId,
    userId: opts.userId,
    records: opts.records.map((record) => ({
      id: record.id,
      content: record.content,
      status: record.status,
      createdAt: record.createdAt,
    })),
    topics: topics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      summary: topic.summary,
      content: topic.content.slice(0, 4000),
      tags: topic.tags,
      status: topic.status,
      updatedAt: topic.updatedAt,
    })),
    relatedRecordsByTopicId,
  };

  logInfo("contemplate-v2", "context loaded", {
    taskId: opts.taskId,
    recordCount: context.records.length,
    candidateTopicCount: context.topics.length,
  });

  return context;
}
