/**
 * Session 管理 — 参照 pi-agent 的 SessionManager。
 *
 * WorkspaceKey = userId:sessionId，per-thread 持有 AgentRuntime。
 */

import type { AgentRuntime, CreateAgentRuntimeOptions } from "./runtime.js";
import { createAgentRuntime } from "./runtime.js";

interface Thread {
  threadId: string;
  userId: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  runtime: AgentRuntime;
}

export class SessionManager {
  private threads = new Map<string, Thread>();

  constructor(private makeRuntime: (opts: CreateAgentRuntimeOptions) => Promise<AgentRuntime>) {}

  private key(userId: string, sessionId: string) {
    return `${userId}:${sessionId}`;
  }

  async getOrCreate(userId: string, sessionId: string, opts: CreateAgentRuntimeOptions): Promise<Thread> {
    const k = this.key(userId, sessionId);
    const existing = this.threads.get(k);
    if (existing) {
      existing.updatedAt = Date.now();
      return existing;
    }

    const runtime = await this.makeRuntime(opts);
    const thread: Thread = {
      threadId: opts.topicId,
      userId,
      sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runtime,
    };
    this.threads.set(k, thread);
    return thread;
  }

  get(userId: string, sessionId: string): Thread | undefined {
    return this.threads.get(this.key(userId, sessionId));
  }

  list(): Thread[] {
    return [...this.threads.values()];
  }

  cleanup(userId: string, sessionId: string) {
    const k = this.key(userId, sessionId);
    const thread = this.threads.get(k);
    if (thread) {
      thread.runtime.cleanup();
      this.threads.delete(k);
    }
  }

  cleanupAll() {
    for (const [, thread] of this.threads) {
      thread.runtime.cleanup();
    }
    this.threads.clear();
  }
}
