/**
 * Topic Tools — 供 Agent 使用的 4 个工具：
 *
 * - list_topics: 列出用户所有 Topic（摘要列表）
 * - read_topic: 获取单个 Topic 完整详情
 * - create_topic: 创建新 Topic
 * - update_topic: 更新已有 Topic 内容
 */

import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TopicRepository } from "../../modules/topic/topic.repository.js";

// ─── list_topics ──────────────────────────────────────────────

const ListTopicsParams = Type.Object({});

export function createListTopicsTool(topicRepo: TopicRepository, userId: string): AgentTool<typeof ListTopicsParams> {
  return {
    name: "list_topics",
    label: "List Topics",
    description: "列出用户的所有 Topic，返回 id、title、summary、tags、updatedAt 的摘要列表。",
    parameters: ListTopicsParams,
    async execute(): Promise<AgentToolResult<any>> {
      const topics = await topicRepo.findByUserId(userId, { limit: 200 });
      const list = topics.map((t) => ({
        id: t.id,
        title: t.title,
        summary: t.summary,
        tags: t.tags,
        updatedAt: t.updatedAt,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
        details: { count: list.length },
      };
    },
  };
}

// ─── read_topic ───────────────────────────────────────────────

const ReadTopicParams = Type.Object({
  topicId: Type.String({ description: "要读取的 Topic ID" }),
});

export function createReadTopicTool(topicRepo: TopicRepository): AgentTool<typeof ReadTopicParams> {
  return {
    name: "read_topic",
    label: "Read Topic",
    description: "获取指定 Topic 的完整详情，包括 title、summary、tags、content 等。",
    parameters: ReadTopicParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
      const topic = await topicRepo.findById(params.topicId);
      if (!topic) {
        return {
          content: [{ type: "text", text: `Topic "${params.topicId}" not found.` }],
          details: { found: false },
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(topic, null, 2) }],
        details: { found: true },
      };
    },
  };
}

// ─── create_topic ─────────────────────────────────────────────

const CreateTopicParams = Type.Object({
  title: Type.String({ description: "Topic 标题" }),
  summary: Type.String({ description: "Topic 简明摘要" }),
  tags: Type.Array(Type.String(), { description: "少量、稳定、便于识别主题的标签" }),
  content: Type.String({ description: "完整 Topic 正文（Markdown）" }),
});

export function createCreateTopicTool(topicRepo: TopicRepository, userId: string): AgentTool<typeof CreateTopicParams> {
  return {
    name: "create_topic",
    label: "Create Topic",
    description: "创建一个新 Topic，返回新创建的 Topic ID 和完整内容。",
    parameters: CreateTopicParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
      const topic = await topicRepo.create({
        userId,
        title: params.title,
      });

      // 创建后立即更新完整内容
      await topicRepo.update(topic.id, {
        summary: params.summary,
        tags: params.tags,
        content: params.content,
      });

      const full = await topicRepo.findById(topic.id);
      return {
        content: [{ type: "text", text: JSON.stringify(full, null, 2) }],
        details: { created: true, topicId: topic.id },
      };
    },
  };
}

// ─── update_topic ─────────────────────────────────────────────

const UpdateTopicParams = Type.Object({
  topicId: Type.String({ description: "要更新的 Topic ID" }),
  title: Type.Optional(Type.String({ description: "Topic 标题" })),
  summary: Type.Optional(Type.String({ description: "Topic 简明摘要" })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "少量、稳定、便于识别主题的标签" })),
  content: Type.Optional(Type.String({ description: "更新后的完整 Topic 正文（Markdown）" })),
});

export function createUpdateTopicTool(topicRepo: TopicRepository): AgentTool<typeof UpdateTopicParams> {
  return {
    name: "update_topic",
    label: "Update Topic",
    description: "更新已有 Topic 的内容。可以部分更新，只传需要修改的字段。",
    parameters: UpdateTopicParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
      const existing = await topicRepo.findById(params.topicId);
      if (!existing) {
        return {
          content: [{ type: "text", text: `Topic "${params.topicId}" not found.` }],
          details: { found: false },
        };
      }

      const patch: Record<string, any> = {};
      if (params.title !== undefined) patch.title = params.title;
      if (params.summary !== undefined) patch.summary = params.summary;
      if (params.tags !== undefined) patch.tags = params.tags;
      if (params.content !== undefined) patch.content = params.content;

      await topicRepo.update(params.topicId, patch);
      const updated = await topicRepo.findById(params.topicId);

      return {
        content: [{ type: "text", text: JSON.stringify(updated, null, 2) }],
        details: { updated: true },
      };
    },
  };
}

// ─── 工厂：一次创建全部 4 个 tools ──────────────────────────

export function createTopicTools(topicRepo: TopicRepository, userId: string) {
  return [
    createListTopicsTool(topicRepo, userId),
    createReadTopicTool(topicRepo),
    createCreateTopicTool(topicRepo, userId),
    createUpdateTopicTool(topicRepo),
  ];
}
