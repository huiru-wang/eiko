/**
 * Contemplate Tools — Record 沉思任务专用工具集。
 */

import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { RecordRepository } from "../../modules/record/record.repository.js";
import type { TaskRepository } from "../../modules/task/task.repository.js";
import type { TopicRepository } from "../../modules/topic/topic.repository.js";
import type { VectorStore } from "../../infrastructure/vector-store.js";
import { logInfo, logWarn } from "../../infrastructure/logger.js";

export interface ContemplateToolsOptions {
  recordRepo: RecordRepository;
  topicRepo: TopicRepository;
  taskRepo: TaskRepository;
  vectorStore: VectorStore;
  userId: string;
  taskId: string;
}

const RagSearchParams = Type.Object({
  scope: Type.Union([Type.Literal("record"), Type.Literal("topic")]),
  query: Type.String(),
});

export function createRagSearchTool(opts: ContemplateToolsOptions): AgentTool<typeof RagSearchParams> {
  return {
    name: "rag_search",
    label: "RAG Search",
    description: "通过向量搜索查找相关 record 或 topic，返回候选 ID 和摘要。",
    parameters: RagSearchParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
      logInfo("contemplate-tool", "rag_search start", {
        taskId: opts.taskId,
        userId: opts.userId,
        scope: params.scope,
        queryLength: params.query.length,
      });
      if (params.scope === "topic") {
        const hits = await opts.vectorStore.searchTopics({ query: params.query, topK: 10, userId: opts.userId });
        const topics = await Promise.all(hits.map(async (hit) => {
          const topic = await opts.topicRepo.findById(hit.topicId);
          if (!topic || topic.userId !== opts.userId) return null;
          return {
            topicId: hit.topicId,
            title: topic.title,
            snippet: topic.summary || hit.embeddingText.slice(0, 200),
            score: hit.distance,
          };
        }));
        const filtered = topics.filter(Boolean);
        logInfo("contemplate-tool", "rag_search completed", { taskId: opts.taskId, scope: "topic", hitCount: hits.length, returnedCount: filtered.length });
        return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }], details: { scope: "topic", count: hits.length } };
      }

      const hits = await opts.vectorStore.searchRecords({ query: params.query, topK: 10, userId: opts.userId });
      const records = await Promise.all(hits.map(async (hit) => {
        const record = await opts.recordRepo.findById(hit.recordId);
        if (!record || record.userId !== opts.userId) return null;
        return {
          recordId: hit.recordId,
          snippet: record.content.slice(0, 200),
          score: hit.distance,
        };
      }));
      const filtered = records.filter(Boolean);
      logInfo("contemplate-tool", "rag_search completed", { taskId: opts.taskId, scope: "record", hitCount: hits.length, returnedCount: filtered.length });
      return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }], details: { scope: "record", count: hits.length } };
    },
  };
}

const GetTopicParams = Type.Object({
  topicId: Type.String(),
});

export function createGetTopicTool(opts: ContemplateToolsOptions): AgentTool<typeof GetTopicParams> {
  return {
    name: "get_topic",
    label: "Get Topic",
    description: "获取指定 Topic 的完整详情。",
    parameters: GetTopicParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
      logInfo("contemplate-tool", "get_topic", { taskId: opts.taskId, topicId: params.topicId });
      const topic = await opts.topicRepo.findById(params.topicId);
      if (!topic || topic.userId !== opts.userId) {
        logWarn("contemplate-tool", "get_topic not found", { taskId: opts.taskId, topicId: params.topicId });
        return { content: [{ type: "text", text: `Topic "${params.topicId}" not found.` }], details: { found: false } };
      }
      return { content: [{ type: "text", text: JSON.stringify(topic, null, 2) }], details: { found: true } };
    },
  };
}

const GetRecordParams = Type.Object({
  recordId: Type.String(),
});

export function createGetRecordTool(opts: ContemplateToolsOptions): AgentTool<typeof GetRecordParams> {
  return {
    name: "get_record",
    label: "Get Record",
    description: "获取指定 Record 的完整原文。",
    parameters: GetRecordParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
      logInfo("contemplate-tool", "get_record", { taskId: opts.taskId, recordId: params.recordId });
      const record = await opts.recordRepo.findById(params.recordId);
      if (!record || record.userId !== opts.userId) {
        logWarn("contemplate-tool", "get_record not found", { taskId: opts.taskId, recordId: params.recordId });
        return { content: [{ type: "text", text: `Record "${params.recordId}" not found.` }], details: { found: false } };
      }
      return { content: [{ type: "text", text: JSON.stringify(record, null, 2) }], details: { found: true } };
    },
  };
}

const CreateTopicParams = Type.Object({
  title: Type.String(),
  summary: Type.String(),
  tags: Type.Array(Type.String()),
  bodyMarkdown: Type.String(),
  matchText: Type.Optional(Type.String()),
});

export function createCreateTopicTool(opts: ContemplateToolsOptions): AgentTool<typeof CreateTopicParams> {
  return {
    name: "create_topic",
    label: "Create Topic",
    description: "创建一个新 Topic，返回新创建的 Topic ID 和完整内容。",
    parameters: CreateTopicParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
      logInfo("contemplate-tool", "create_topic start", { taskId: opts.taskId, title: params.title, tagCount: params.tags.length });
      const topic = await opts.topicRepo.create({
        userId: opts.userId,
        sessionId: `contemplate-${Date.now()}`,
        title: params.title,
      });

      await opts.topicRepo.update(topic.id, {
        summary: params.summary,
        tags: params.tags,
        bodyMarkdown: params.bodyMarkdown,
        matchText: params.matchText ?? "",
      });

      const full = await opts.topicRepo.findById(topic.id);
      if (full) {
        await opts.vectorStore.upsertTopic(full).catch((err) => {
          const message = err instanceof Error ? err.message : "Unknown error";
          logWarn("contemplate-tool", "upsert topic vector failed", { taskId: opts.taskId, topicId: topic.id, error: message });
        });
      }
      logInfo("contemplate-tool", "create_topic completed", { taskId: opts.taskId, topicId: topic.id });

      return {
        content: [{ type: "text", text: JSON.stringify(full, null, 2) }],
        details: { created: true, topicId: topic.id },
      };
    },
  };
}

const UpdateTopicParams = Type.Object({
  topicId: Type.String(),
  title: Type.Optional(Type.String()),
  summary: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  bodyMarkdown: Type.Optional(Type.String()),
  matchText: Type.Optional(Type.String()),
});

export function createUpdateTopicTool(opts: ContemplateToolsOptions): AgentTool<typeof UpdateTopicParams> {
  return {
    name: "update_topic",
    label: "Update Topic",
    description: "更新已有 Topic 的内容。可以部分更新，只传需要修改的字段。",
    parameters: UpdateTopicParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
      logInfo("contemplate-tool", "update_topic start", {
        taskId: opts.taskId,
        topicId: params.topicId,
        fields: Object.keys(params).filter((key) => key !== "topicId"),
      });
      const existing = await opts.topicRepo.findById(params.topicId);
      if (!existing || existing.userId !== opts.userId) {
        logWarn("contemplate-tool", "update_topic not found", { taskId: opts.taskId, topicId: params.topicId });
        return { content: [{ type: "text", text: `Topic "${params.topicId}" not found.` }], details: { found: false } };
      }

      const patch: Record<string, any> = {};
      if (params.title !== undefined) patch.title = params.title;
      if (params.summary !== undefined) patch.summary = params.summary;
      if (params.tags !== undefined) patch.tags = params.tags;
      if (params.bodyMarkdown !== undefined) patch.bodyMarkdown = params.bodyMarkdown;
      if (params.matchText !== undefined) patch.matchText = params.matchText;

      await opts.topicRepo.update(params.topicId, patch);
      const updated = await opts.topicRepo.findById(params.topicId);
      if (updated) {
        await opts.vectorStore.upsertTopic(updated).catch((err) => {
          const message = err instanceof Error ? err.message : "Unknown error";
          logWarn("contemplate-tool", "upsert topic vector failed", { taskId: opts.taskId, topicId: params.topicId, error: message });
        });
      }
      logInfo("contemplate-tool", "update_topic completed", { taskId: opts.taskId, topicId: params.topicId });

      return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }], details: { updated: true } };
    },
  };
}

const LinkRecordTopicParams = Type.Object({
  recordId: Type.String(),
  topicId: Type.String(),
  relation: Type.Optional(Type.Union([Type.Literal("primary"), Type.Literal("secondary")])),
});

export function createLinkRecordTopicTool(opts: ContemplateToolsOptions): AgentTool<typeof LinkRecordTopicParams> {
  return {
    name: "link_record_topic",
    label: "Link Record Topic",
    description: "建立 Record 与 Topic 的关系。每个 Record 最多自动关联两个 Topic。",
    parameters: LinkRecordTopicParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
      logInfo("contemplate-tool", "link_record_topic start", {
        taskId: opts.taskId,
        recordId: params.recordId,
        topicId: params.topicId,
        relation: params.relation ?? "primary",
      });
      const [record, topic] = await Promise.all([
        opts.recordRepo.findById(params.recordId),
        opts.topicRepo.findById(params.topicId),
      ]);
      if (!record || record.userId !== opts.userId) {
        logWarn("contemplate-tool", "link_record_topic record not found", { taskId: opts.taskId, recordId: params.recordId });
        return { content: [{ type: "text", text: `Record "${params.recordId}" not found.` }], details: { linked: false } };
      }
      if (!topic || topic.userId !== opts.userId) {
        logWarn("contemplate-tool", "link_record_topic topic not found", { taskId: opts.taskId, topicId: params.topicId });
        return { content: [{ type: "text", text: `Topic "${params.topicId}" not found.` }], details: { linked: false } };
      }

      await opts.topicRepo.linkRecord(params.recordId, params.topicId, params.relation ?? "primary");
      logInfo("contemplate-tool", "link_record_topic completed", { taskId: opts.taskId, recordId: params.recordId, topicId: params.topicId });
      return {
        content: [{ type: "text", text: JSON.stringify({ linked: true, recordId: params.recordId, topicId: params.topicId }) }],
        details: { linked: true },
      };
    },
  };
}

const UpdateTaskParams = Type.Object({
  status: Type.Union([
    Type.Literal("planning"),
    Type.Literal("executing"),
    Type.Literal("verifying"),
    Type.Literal("completed"),
    Type.Literal("failed"),
  ]),
  result: Type.Optional(Type.Any()),
  error: Type.Optional(Type.String()),
});

export function createUpdateTaskTool(opts: ContemplateToolsOptions): AgentTool<typeof UpdateTaskParams> {
  return {
    name: "update_task",
    label: "Update Task",
    description: "更新当前 Contemplate Task 的状态和阶段性结果。",
    parameters: UpdateTaskParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
      logInfo("contemplate-tool", "update_task start", {
        taskId: opts.taskId,
        status: params.status,
        resultKeys: params.result && typeof params.result === "object" ? Object.keys(params.result) : [],
        hasError: !!params.error,
      });
      const existing = await opts.taskRepo.findById(opts.taskId);
      const merged = params.result ? deepMerge(existing?.result ?? {}, params.result) : existing?.result ?? {};
      await opts.taskRepo.update(opts.taskId, {
        status: params.status,
        result: merged,
        error: params.error,
      });
      logInfo("contemplate-tool", "update_task completed", { taskId: opts.taskId, status: params.status });
      return { content: [{ type: "text", text: JSON.stringify({ updated: true, status: params.status }) }], details: { updated: true } };
    },
  };
}

export function createContemplateTools(opts: ContemplateToolsOptions) {
  return [
    createRagSearchTool(opts),
    createGetTopicTool(opts),
    createGetRecordTool(opts),
    createCreateTopicTool(opts),
    createUpdateTopicTool(opts),
    createLinkRecordTopicTool(opts),
    createUpdateTaskTool(opts),
  ];
}

function deepMerge(base: any, patch: any): any {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) ? deepMerge(out[key], value) : value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
