/**
 * Contemplate 服务 — 执行 Record 沉思整理任务。
 */

import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, StreamFn } from "@earendil-works/pi-agent-core";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { AppConfig } from "../env.js";
import type { RecordStatus } from "../modules/record/record.js";
import type { RecordRepository } from "../modules/record/record.repository.js";
import type { TaskRepository } from "../modules/task/task.repository.js";
import type { TopicRepository } from "../modules/topic/topic.repository.js";
import type { VectorStore } from "../infrastructure/vector-store.js";
import { logError, logInfo, logWarn } from "../infrastructure/logger.js";
import { SYSTEM_PROMPT } from "./prompts/system.prompt.js";
import { buildContemplatePrompt } from "./prompts/contemplate.prompt.js";
import { createContemplateTools } from "./tools/contemplate.tools.js";

export interface ContemplateOptions {
  config: AppConfig;
  recordRepo: RecordRepository;
  topicRepo: TopicRepository;
  taskRepo: TaskRepository;
  vectorStore: VectorStore;
  userId: string;
}

export interface ContemplateResult {
  taskId: string | null;
  pendingCount: number;
  topicCount: number;
  events: AgentEvent[];
  summary: string;
}

export async function runContemplate(opts: ContemplateOptions): Promise<ContemplateResult> {
  const { config, recordRepo, topicRepo, taskRepo, vectorStore, userId } = opts;
  logInfo("contemplate", "claim records start", { userId, statuses: ["pending", "updated", "skipped"], limit: 30 });

  const { pending, task } = await taskRepo.createContemplateTaskWithRecords({
    userId,
    statuses: ["pending", "updated", "skipped"],
    limit: 30,
  });

  if (pending.length === 0 || !task) {
    logInfo("contemplate", "no processable records", { userId });
    return { taskId: null, pendingCount: 0, topicCount: 0, events: [], summary: "没有待沉思整理的 Record" };
  }

  logInfo("contemplate", "task created and records claimed", {
    taskId: task.id,
    userId,
    recordIds: pending.map((record) => record.id),
    pendingCount: pending.length,
  });

  const topics = await topicRepo.findByUserId(userId, { limit: 50 });
  logInfo("contemplate", "fallback topics loaded", { taskId: task.id, userId, topicCount: topics.length });
  await taskRepo.update(task.id, { status: "planning" });
  logInfo("contemplate", "task status updated", { taskId: task.id, status: "planning" });

  const models = builtinModels();
  const streamFn: StreamFn = models.streamSimple.bind(models);
  const model = models.getModel(config.provider, config.model)
    ?? models.getModels().find((m: any) => m.id === config.model)
    ?? (() => { throw new Error(`Model "${config.model}" not found`); })();

  const agent = new Agent({
    streamFn,
    sessionId: `${userId}:contemplate:${task.id}`,
    initialState: {
      model,
      systemPrompt: SYSTEM_PROMPT,
      tools: createContemplateTools({ recordRepo, topicRepo, taskRepo, vectorStore, userId, taskId: task.id }),
    },
  });

  const events: AgentEvent[] = [];
  const unsubscribe = agent.subscribe(async (event: AgentEvent) => {
    events.push(event);
    if (event.type === "agent_start" || event.type === "agent_end") {
      logInfo("contemplate", `agent event ${event.type}`, { taskId: task.id, eventCount: events.length });
    }
  });

  try {
    logInfo("contemplate", "agent prompt start", { taskId: task.id, userId, model: config.model, provider: config.provider });
    await agent.prompt(buildContemplatePrompt(pending, topics, task.id));
    await agent.waitForIdle();
    logInfo("contemplate", "agent idle", { taskId: task.id, eventCount: events.length });

    const finalTask = await taskRepo.findById(task.id);
    const plan = finalTask?.result?.plan as ContemplatePlan | undefined;
    if (!plan) {
      logError("contemplate", "missing plan after agent run", { taskId: task.id, status: finalTask?.status });
      throw new Error("Contemplate task completed without plan.");
    }

    const organizedIds = new Set<string>();
    for (const item of plan.items ?? []) {
      for (const recordId of item.recordIds ?? []) organizedIds.add(recordId);
    }
    await recordRepo.updateManyStatus([...organizedIds], "organized");
    logInfo("contemplate", "records marked organized", { taskId: task.id, recordIds: [...organizedIds] });

    const skippedIds = (plan.skipped ?? []).map((item) => item.recordId).filter(Boolean);
    await recordRepo.updateManyStatus(skippedIds, "skipped");
    logInfo("contemplate", "records marked skipped", { taskId: task.id, recordIds: skippedIds });

    const touchedIds = new Set([...organizedIds, ...skippedIds]);
    const untouchedOriginalStatuses = (task.input?.originalStatuses ?? []).filter((item: { recordId: string }) => !touchedIds.has(item.recordId));
    if (untouchedOriginalStatuses.length > 0) {
      logWarn("contemplate", "restoring untouched processing records", {
        taskId: task.id,
        recordIds: untouchedOriginalStatuses.map((item: { recordId: string }) => item.recordId),
      });
      await restoreProcessingRecords(recordRepo, { originalStatuses: untouchedOriginalStatuses }, task.id);
    }

    const latestTask = await taskRepo.findById(task.id);
    if (latestTask?.status !== "completed") {
      await taskRepo.update(task.id, {
        status: "completed",
        result: {
          ...(latestTask?.result ?? {}),
          verification: { passed: true, unresolved: [] },
        },
      });
      logInfo("contemplate", "task status updated", { taskId: task.id, status: "completed" });
    }

    logInfo("contemplate", "task completed", {
      taskId: task.id,
      organizedCount: organizedIds.size,
      skippedCount: skippedIds.length,
      eventCount: events.length,
    });

    return {
      taskId: task.id,
      pendingCount: pending.length,
      topicCount: topics.length,
      events,
      summary: extractSummary(events) || "沉思整理任务已完成",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logError("contemplate", "task failed", { taskId: task.id, userId, error: message });
    await taskRepo.update(task.id, { status: "failed", error: message }).catch(() => {});
    await restoreProcessingRecords(recordRepo, task.input, task.id).catch((restoreErr) => {
      const restoreMessage = restoreErr instanceof Error ? restoreErr.message : "Unknown error";
      logError("contemplate", "restore processing records failed", { taskId: task.id, error: restoreMessage });
    });
    throw err;
  } finally {
    unsubscribe();
  }
}

interface ContemplatePlan {
  items?: Array<{ recordIds?: string[] }>;
  skipped?: Array<{ recordId: string }>;
}

function extractSummary(events: AgentEvent[]): string {
  const endEvent = events.find((event) => event.type === "agent_end");
  if (!endEvent || !("messages" in endEvent)) return "";
  const lastMsg = endEvent.messages[endEvent.messages.length - 1];
  if (!lastMsg || !("content" in lastMsg) || !Array.isArray(lastMsg.content)) return "";
  return lastMsg.content
    .filter((content: any) => content.type === "text")
    .map((content: any) => content.text)
    .join("");
}

async function restoreProcessingRecords(recordRepo: RecordRepository, input: Record<string, any> | null, taskId?: string) {
  const originalStatuses = input?.originalStatuses as Array<{ recordId: string; status: RecordStatus }> | undefined;
  if (!originalStatuses) return;
  for (const item of originalStatuses) {
    await recordRepo.updateStatus(item.recordId, item.status);
  }
  logInfo("contemplate", "processing records restored", {
    taskId,
    records: originalStatuses.map((item) => ({ recordId: item.recordId, status: item.status })),
  });
}
