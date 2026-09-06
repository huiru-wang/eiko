import type { Record as UserRecord } from "../../../modules/record/record.js";
import type { Topic } from "../../../modules/topic/topic.js";
import type { TopicRepository } from "../../../modules/topic/topic.repository.js";
import { logInfo } from "../../../infrastructure/logger.js";
import type { ContemplatePlan, ExecuteResult } from "./schemas.js";

export async function executeContemplatePlan(opts: {
  taskId: string;
  userId: string;
  records: UserRecord[];
  plan: ContemplatePlan;
  topicRepo: TopicRepository;
  previousTopicIds?: string[];
}): Promise<ExecuteResult> {
  const affectedTopicIds = new Set<string>(opts.previousTopicIds ?? []);
  const organizedRecordIds = new Set<string>();
  const skipped: ExecuteResult["skipped"] = [];
  const actions: ExecuteResult["actions"] = {};
  const sourceTopicsByTargetId: ExecuteResult["sourceTopicsByTargetId"] = {};
  const recordsByTopicId: ExecuteResult["recordsByTopicId"] = {};
  const recordById = new Map(opts.records.map((record) => [record.id, record]));

  // Replanning replaces the batch's associations rather than appending stale links.
  for (const record of opts.records) await opts.topicRepo.unlinkRecord(record.id);

  for (const action of opts.plan.actions.filter((item) => item.type === "merge_topic")) {
    try {
      const sourceTopics: Topic[] = [];
      for (const sourceTopicId of action.sourceTopicIds) {
        const sourceTopic = await opts.topicRepo.findById(sourceTopicId);
        if (sourceTopic) sourceTopics.push(sourceTopic);
        await opts.topicRepo.moveRecordTopics(sourceTopicId, action.targetTopicId);
        await opts.topicRepo.updateStatus(sourceTopicId, "archived");
      }
      if (action.newTitle) await opts.topicRepo.update(action.targetTopicId, { title: action.newTitle });
      sourceTopicsByTargetId[action.targetTopicId] = [
        ...(sourceTopicsByTargetId[action.targetTopicId] ?? []),
        ...sourceTopics,
      ];
      affectedTopicIds.add(action.targetTopicId);
      actions[action.id] = { status: "done", details: { targetTopicId: action.targetTopicId, sourceTopicIds: action.sourceTopicIds } };
      logInfo("contemplate-v2", "action executed", { taskId: opts.taskId, actionId: action.id, type: action.type });
    } catch (err) {
      actions[action.id] = { status: "failed", error: err instanceof Error ? err.message : "Unknown error" };
      throw err;
    }
  }

  for (const action of opts.plan.actions.filter((item) => item.type === "create_topic")) {
    try {
      const topic = await opts.topicRepo.create({ userId: opts.userId, title: action.title });
      for (const recordId of action.recordIds) {
        await opts.topicRepo.linkRecord(recordId, topic.id);
        const record = recordById.get(recordId);
        if (record) {
          organizedRecordIds.add(recordId);
          addRecordForTopic(topic.id, record);
        }
      }
      affectedTopicIds.add(topic.id);
      actions[action.id] = { status: "done", details: { topicId: topic.id, recordIds: action.recordIds } };
      logInfo("contemplate-v2", "action executed", { taskId: opts.taskId, actionId: action.id, type: action.type, topicId: topic.id });
    } catch (err) {
      actions[action.id] = { status: "failed", error: err instanceof Error ? err.message : "Unknown error" };
      throw err;
    }
  }

  for (const action of opts.plan.actions.filter((item) => item.type === "merge_record")) {
    try {
      for (const recordId of action.recordIds) {
        await opts.topicRepo.linkRecord(recordId, action.targetTopicId);
        const record = recordById.get(recordId);
        if (record) {
          organizedRecordIds.add(recordId);
          addRecordForTopic(action.targetTopicId, record);
        }
      }
      affectedTopicIds.add(action.targetTopicId);
      actions[action.id] = { status: "done", details: { targetTopicId: action.targetTopicId, recordIds: action.recordIds } };
      logInfo("contemplate-v2", "action executed", { taskId: opts.taskId, actionId: action.id, type: action.type });
    } catch (err) {
      actions[action.id] = { status: "failed", error: err instanceof Error ? err.message : "Unknown error" };
      throw err;
    }
  }

  for (const action of opts.plan.actions.filter((item) => item.type === "skip_record")) {
    for (const recordId of action.recordIds) skipped.push({ recordId, reason: action.reason });
    actions[action.id] = { status: "done", details: { recordIds: action.recordIds, reason: action.reason } };
    logInfo("contemplate-v2", "action executed", { taskId: opts.taskId, actionId: action.id, type: action.type });
  }

  return {
    affectedTopicIds: [...affectedTopicIds],
    sourceTopicsByTargetId,
    recordsByTopicId,
    organizedRecordIds: [...organizedRecordIds],
    skipped,
    actions,
  };

  function addRecordForTopic(topicId: string, record: UserRecord) {
    recordsByTopicId[topicId] = [...(recordsByTopicId[topicId] ?? []), record];
  }
}
