/**
 * Agent 运行时工厂 — 参照 pi-agent 的 createAgentRuntime()。
 *
 * 构造 Agent 实例，注入 streamFn、tools、prompts。
 */

import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, StreamFn } from "@earendil-works/pi-agent-core";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { AppConfig } from "../env.js";
import type { MessageRepository } from "../modules/message/message.repository.js";

export interface AgentRuntime {
  agent: Agent;
  cleanup: () => void;
}

export interface CreateAgentRuntimeOptions {
  config: AppConfig;
  messageRepo: MessageRepository;
  userId: string;
  topicId: string;
  sessionId: string;
}

/**
 * 创建一个 pi Agent 运行时实例。
 *
 * - streamFn 从 builtinModels() 解析
 * - agent.subscribe() 将 AgentEvent 持久化到 messages 表
 */
export async function createAgentRuntime(opts: CreateAgentRuntimeOptions): Promise<AgentRuntime> {
  const { config, messageRepo, userId, topicId, sessionId } = opts;

  const models = builtinModels();
  const streamFn: StreamFn = models.streamSimple.bind(models);

  const model = models.getModel(config.provider, config.model)
    ?? models.getModels().find((m: any) => m.id === config.model)
    ?? (() => { throw new Error(`Model "${config.model}" not found`); })();

  const agent = new Agent({
    streamFn,
    sessionId,
    initialState: { model },
  });

  // 订阅事件 → 持久化到 messages 表
  const unsubscribe = agent.subscribe(async (event: AgentEvent) => {
    await messageRepo.save({
      userId,
      topicId,
      sessionId,
      role: event.type,
      payload: JSON.stringify(event),
      timestamp: Date.now(),
    });
  });

  return {
    agent,
    cleanup: () => unsubscribe(),
  };
}
