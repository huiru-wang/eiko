import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AppConfig } from "../../../env.js";
import type { RecordStatus } from "../../../modules/record/record.js";
import type { RecordRepository } from "../../../modules/record/record.repository.js";
import type { TaskRepository } from "../../../modules/task/task.repository.js";
import type { TopicRepository } from "../../../modules/topic/topic.repository.js";
import type { VectorStore } from "../../../infrastructure/vector-store.js";
import { logError, logInfo } from "../../../infrastructure/logger.js";
import { WORKFLOW_VERSION } from "./schemas.js";
import type { JsonAttempt, JsonCompletion } from "./llm-json.js";
import { loadContemplateContext } from "./context-loader.js";
import { planContemplate } from "./planner.js";
import { executeContemplatePlan } from "./executor.js";
import { rewriteAffectedTopics } from "./topic-rewriter.js";
import { nowIso } from "../../../infrastructure/time.js";

export interface ContemplateWorkflowOptions {
  config: AppConfig;
  recordRepo: RecordRepository;
  topicRepo: TopicRepository;
  taskRepo: TaskRepository;
  vectorStore: VectorStore;
  userId: string;
  complete?: (prompt: string) => Promise<JsonCompletion>;
}

export interface ContemplateWorkflowResult {
  taskId: string | null;
  pendingCount: number;
  topicCount: number;
  events: AgentEvent[];
  summary: string;
}

export async function runContemplateWorkflow(opts: ContemplateWorkflowOptions): Promise<ContemplateWorkflowResult> {
  const { config, recordRepo, topicRepo, taskRepo, vectorStore, userId } = opts;
  const result: Record<string, any> = {
    workflowVersion: WORKFLOW_VERSION,
    context: { recordCount: 0, candidateTopicCount: 0 },
    plan: { actions: [] },
    planningAttempts: [],
    validation: { passed: false, violations: [] },
    execution: { actions: {} },
    rewrites: {},
    skipped: [],
  };

  logInfo("contemplate-v2", "claim start", { userId, statuses: ["pending", "updated", "skipped"], limit: 30 });
  const { pending, task } = await taskRepo.createContemplateTaskWithRecords({
    userId,
    statuses: ["pending", "updated", "skipped"],
    limit: 30,
  });

  if (pending.length === 0 || !task) {
    logInfo("contemplate-v2", "no processable records", { userId });
    return { taskId: null, pendingCount: 0, topicCount: 0, events: [], summary: "没有待沉思整理的 Record" };
  }

  const originalInput = {
    ...(task.input ?? {}),
    workflowVersion: WORKFLOW_VERSION,
  };
  const previousTopics = new Map<string, Array<{ id: string; title: string }>>();
  let associationsChanged = false;

  try {
    logInfo("contemplate-v2", "records claimed", {
      taskId: task.id,
      userId,
      recordIds: pending.map((record) => record.id),
      recordCount: pending.length,
    });
    await taskRepo.update(task.id, { status: "planning", result });

    const context = await loadContemplateContext({ taskId: task.id, userId, records: pending, topicRepo, vectorStore });
    result.context = {
      recordCount: context.records.length,
      candidateTopicCount: context.topics.length,
    };
    await taskRepo.update(task.id, { status: "planning", result });

    logInfo("contemplate-v2", "plan prompt start", { taskId: task.id });
    const plan = await planContemplate({
      config, context, topicRepo,
      complete: opts.complete,
      onAttempt: async (attempt: JsonAttempt) => {
        result.planningAttempts.push(attempt);
        result.validation = { passed: attempt.passed, violations: attempt.violations ?? (attempt.error ? [{ code: attempt.errorCode, message: attempt.error }] : []) };
        await taskRepo.update(task.id, { status: "planning", result });
      },
    });
    result.plan = plan;
    logInfo("contemplate-v2", "plan action counts", {
      taskId: task.id,
      createCount: plan.actions.filter((action) => action.type === "create_topic").length,
      mergeRecordCount: plan.actions.filter((action) => action.type === "merge_record").length,
      mergeTopicCount: plan.actions.filter((action) => action.type === "merge_topic").length,
      skipCount: plan.actions.filter((action) => action.type === "skip_record").reduce((count, action) => count + action.recordIds.length, 0),
    });
    await taskRepo.update(task.id, { status: "planning", result });
    logInfo("contemplate-v2", "plan generated", { taskId: task.id, actionCount: plan.actions.length });

    await taskRepo.update(task.id, { status: "executing", result, error: null });
    logInfo("contemplate-v2", "plan validation passed", { taskId: task.id });

    for (const record of pending) previousTopics.set(record.id, await topicRepo.findTopicsByRecordId(record.id));
    result.previousTopics = Object.fromEntries(previousTopics);
    await taskRepo.update(task.id, { status: "executing", result });
    associationsChanged = true;
    const execution = await executeContemplatePlan({ taskId: task.id, userId, records: pending, plan, topicRepo,
      previousTopicIds: [...new Set([...previousTopics.values()].flatMap((topics) => topics.map((topic) => topic.id)))],
    });
    result.execution = { actions: execution.actions };
    result.skipped = execution.skipped;
    await taskRepo.update(task.id, { status: "executing", result });

    for (const sourceTopics of Object.values(execution.sourceTopicsByTargetId)) {
      for (const sourceTopic of sourceTopics) {
        await vectorStore.deleteTopic(sourceTopic.id).catch(() => {});
      }
    }

    const rewrites = await rewriteAffectedTopics({
      config,
      taskId: task.id,
      topicIds: execution.affectedTopicIds,
      topicRepo,
      vectorStore,
      recordsByTopicId: execution.recordsByTopicId,
      sourceTopicsByTargetId: execution.sourceTopicsByTargetId,
      actions: plan.actions,
      complete: opts.complete,
    });
    result.rewrites = rewrites;

    const organizedAt = nowIso();
    const recordResults = plan.actions.flatMap((action) => action.type === "merge_topic" ? [] : action.recordIds.map((id) => ({
      id, status: action.type === "skip_record" ? "skipped" as const : "organized" as const,
      organization: { taskId: task.id, organizedAt, action: action.type, reason: action.reason },
    })));
    const topicResults: Array<{ id: string; organization: Record<string, unknown> }> = [];
    for (const [id, rewrite] of Object.entries(rewrites)) {
      const currentRecords = await topicRepo.findRelatedRecordsByTopicId(id);
      topicResults.push({ id, organization: { taskId: task.id, organizedAt,
        recordIds: currentRecords.filter((record) => pending.some((item) => item.id === record.id)).map((record) => record.id),
        summary: rewrite.changeSummary,
      } });
    }
    for (const sources of Object.values(execution.sourceTopicsByTargetId)) {
      for (const source of sources) topicResults.push({ id: source.id, organization: {
        taskId: task.id, organizedAt, recordIds: [], summary: "内容已并入其他话题，本话题已归档。",
      } });
    }
    await taskRepo.completeOrganization(task.id, { records: recordResults, topics: topicResults, result });
    associationsChanged = false;
    logInfo("contemplate-v2", "records finalized", {
      taskId: task.id,
      organizedCount: execution.organizedRecordIds.length,
      skippedCount: execution.skipped.length,
    });

    logInfo("contemplate-v2", "task completed", { taskId: task.id, workflowVersion: WORKFLOW_VERSION });

    return {
      taskId: task.id,
      pendingCount: pending.length,
      topicCount: context.topics.length,
      events: [],
      summary: "沉思整理任务已完成",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logError("contemplate-v2", "task failed", { taskId: task.id, userId, error: message });
    await taskRepo.update(task.id, { status: "failed", result, error: message }).catch(() => {});
    if (associationsChanged) {
      for (const [recordId, topics] of previousTopics) {
        try {
          await topicRepo.unlinkRecord(recordId);
          for (const topic of topics) await topicRepo.linkRecord(recordId, topic.id);
        } catch (restoreErr) {
          logError("contemplate-v2", "record associations restore failed", { taskId: task.id, recordId, error: String(restoreErr) });
        }
      }
    }
    await restoreProcessingRecords(recordRepo, originalInput, task.id).catch((restoreErr) => {
      const restoreMessage = restoreErr instanceof Error ? restoreErr.message : "Unknown error";
      logError("contemplate-v2", "records restore failed", { taskId: task.id, error: restoreMessage });
    });
    throw err;
  }
}

async function restoreProcessingRecords(recordRepo: RecordRepository, input: Record<string, any> | null, taskId?: string) {
  const originalStatuses = input?.originalStatuses as Array<{ recordId: string; status: RecordStatus }> | undefined;
  if (!originalStatuses) return;
  for (const item of originalStatuses) {
    await recordRepo.updateStatus(item.recordId, item.status);
  }
  logInfo("contemplate-v2", "records restored", {
    taskId,
    records: originalStatuses.map((item) => ({ recordId: item.recordId, status: item.status })),
  });
}
