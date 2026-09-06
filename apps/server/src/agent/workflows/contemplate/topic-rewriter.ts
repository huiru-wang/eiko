import type { AppConfig } from "../../../env.js";
import type { Record as UserRecord } from "../../../modules/record/record.js";
import type { Topic } from "../../../modules/topic/topic.js";
import type { TopicRepository } from "../../../modules/topic/topic.repository.js";
import type { VectorStore } from "../../../infrastructure/vector-store.js";
import { logInfo, logWarn } from "../../../infrastructure/logger.js";
import { buildRewritePrompt } from "./prompts.js";
import { assertTopicRewriteResult, type ContemplateAction, type TopicRewriteResult } from "./schemas.js";
import { runJsonStep, type JsonCompletion } from "./llm-json.js";

export async function rewriteAffectedTopics(opts: {
  config: AppConfig;
  taskId: string;
  topicIds: string[];
  topicRepo: TopicRepository;
  vectorStore: VectorStore;
  recordsByTopicId: Record<string, UserRecord[]>;
  sourceTopicsByTargetId: Record<string, Topic[]>;
  actions: ContemplateAction[];
  complete?: (prompt: string) => Promise<JsonCompletion>;
}): Promise<Record<string, TopicRewriteResult>> {
  const rewrites: Record<string, TopicRewriteResult> = {};

  for (const topicId of opts.topicIds) {
    const targetTopic = await opts.topicRepo.findById(topicId);
    if (!targetTopic || targetTopic.status === "archived") continue;

    const relatedRecords = await opts.topicRepo.findRelatedRecordsByTopicId(topicId);
    if (relatedRecords.length === 0) {
      await opts.topicRepo.update(topicId, { status: "archived", content: "", summary: "" });
      await opts.vectorStore.deleteTopic(topicId);
      rewrites[topicId] = { title: targetTopic.title, summary: "", content: "", tags: targetTopic.tags, changeSummary: "关联记录已移出，话题已归档。" };
      logInfo("contemplate-v2", "empty topic archived", { taskId: opts.taskId, topicId });
      continue;
    }
    const topicActions = opts.actions.filter((action) => {
      if (action.type === "merge_record") return action.targetTopicId === topicId;
      if (action.type === "create_topic") return (opts.recordsByTopicId[topicId] ?? []).some((record) => action.recordIds.includes(record.id));
      if (action.type === "merge_topic") return action.targetTopicId === topicId;
      return false;
    });

    logInfo("contemplate-v2", "rewrite prompt start", {
      taskId: opts.taskId,
      topicId,
      actionCount: topicActions.length,
      newRecordCount: opts.recordsByTopicId[topicId]?.length ?? 0,
      relatedRecordCount: relatedRecords.length,
    });

    const rewrite = await runJsonStep({
      config: opts.config,
      taskId: opts.taskId,
      step: `rewrite:${topicId}`,
      prompt: buildRewritePrompt({
        targetTopic,
        records: opts.recordsByTopicId[topicId] ?? [],
        actions: topicActions,
        sourceTopics: opts.sourceTopicsByTargetId[topicId] ?? [],
        relatedRecords: relatedRecords.map((record) => ({
          id: record.id,
          content: record.content,
          createdAt: record.createdAt,
        })),
      }),
      validate: assertTopicRewriteResult,
      complete: opts.complete,
    });

    await opts.topicRepo.update(topicId, rewrite);
    const updated = await opts.topicRepo.findById(topicId);
    if (updated) {
      await opts.vectorStore.upsertTopic(updated).catch((err) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        logWarn("contemplate-v2", "upsert topic vector failed", { taskId: opts.taskId, topicId, error: message });
      });
    }

    rewrites[topicId] = rewrite;
    logInfo("contemplate-v2", "topic rewritten", { taskId: opts.taskId, topicId, contentLength: rewrite.content.length });
  }

  return rewrites;
}
