/**
 * Record 消化服务 — 触发 Agent 消化 pending Records。
 *
 * 流程：
 * 1. 获取 userId 下所有 pending Records + 所有 Topics
 * 2. 构造 Agent，注入 topic_tools + record-digest prompt
 * 3. Agent 自主通过工具读取/创建/更新 Topic
 * 4. 完成后将 Records 标记为 digested
 */

import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, StreamFn } from "@earendil-works/pi-agent-core";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { AppConfig } from "../env.js";
import type { RecordRepository } from "../modules/record/record.repository.js";
import type { TopicRepository } from "../modules/topic/topic.repository.js";
import { SYSTEM_PROMPT } from "./prompts/system.prompt.js";
import { buildRecordDigestPrompt } from "./prompts/record-digest.prompt.js";
import { createTopicTools } from "./tools/topic.tools.js";

export interface DigestOptions {
  config: AppConfig;
  recordRepo: RecordRepository;
  topicRepo: TopicRepository;
  userId: string;
}

export interface DigestResult {
  pendingCount: number;
  topicCount: number;
  events: AgentEvent[];
  summary: string;
}

/**
 * 触发一次 Record 消化任务。
 *
 * - 创建临时 Agent（不复用 SessionManager，每次独立运行）
 * - 将 pending records 和 topics 注入 prompt
 * - Agent 自主调用 topic_tools 完成消化
 * - 返回全部事件流供调试/日志
 */
export async function runDigest(opts: DigestOptions): Promise<DigestResult> {
  const { config, recordRepo, topicRepo, userId } = opts;

  // 1. 获取待消化数据
  const pendingRecords = await recordRepo.findByUserId(userId, { limit: 100 });
  const pending = pendingRecords.filter((r) => r.status === "pending");

  if (pending.length === 0) {
    return { pendingCount: 0, topicCount: 0, events: [], summary: "没有待消化的 Record" };
  }

  const topics = await topicRepo.findByUserId(userId, { limit: 200 });

  // 2. 构造 prompt
  const currentTime = new Date().toISOString();
  const recordsText = pending.map((r) => `[${r.id}] (${r.occurredAt}) ${r.content}`).join("\n\n");
  const topicsText = topics.length > 0
    ? JSON.stringify(topics.map((t) => ({ id: t.id, title: t.title, summary: t.summary, tags: t.tags, updatedAt: t.updatedAt })), null, 2)
    : "（暂无 Topic）";

  const userMessage = buildRecordDigestPrompt(recordsText, topicsText, currentTime);

  // 3. 创建 Agent
  const models = builtinModels();
  const streamFn: StreamFn = models.streamSimple.bind(models);

  const model = models.getModel(config.provider, config.model)
    ?? models.getModels().find((m: any) => m.id === config.model)
    ?? (() => { throw new Error(`Model "${config.model}" not found`); })();

  const agent = new Agent({
    streamFn,
    sessionId: `${userId}:digest`,
    initialState: {
      model,
      systemPrompt: SYSTEM_PROMPT,
      tools: createTopicTools(topicRepo, userId),
    },
  });

  // 4. 收集事件
  const events: AgentEvent[] = [];
  const unsubscribe = agent.subscribe(async (event: AgentEvent) => {
    events.push(event);
  });

  try {
    // 5. 发送消息并等待完成
    await agent.prompt(userMessage);
    await agent.waitForIdle();

    // 6. 提取 agent_end 中的 assistant 文本作为 summary
    const endEvent = events.find((e) => e.type === "agent_end");
    let summary = "";
    if (endEvent && "messages" in endEvent) {
      const lastMsg = endEvent.messages[endEvent.messages.length - 1];
      if (lastMsg && "content" in lastMsg && Array.isArray(lastMsg.content)) {
        summary = lastMsg.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("");
      }
    }

    // 7. 标记 records 为 digested
    for (const record of pending) {
      await recordRepo.updateStatus(record.id, "digested");
    }

    return {
      pendingCount: pending.length,
      topicCount: topics.length,
      events,
      summary,
    };
  } finally {
    unsubscribe();
  }
}
