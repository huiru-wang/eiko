import { sql, type Kysely } from "kysely";
import type { AppConfig } from "../env.js";
import type { DB } from "./schema.js";
import { logInfo, logWarn } from "./logger.js";
import { nowIso } from "./time.js";

export interface TopicVectorSearchResult {
  topicId: string;
  distance: number;
  embeddingText: string;
}

export interface RecordVectorSearchResult {
  recordId: string;
  distance: number;
  embeddingText: string;
}

export interface VectorStore {
  upsertRecord(record: { id: string; content: string; userId: string; createdAt?: string }): Promise<void>;
  upsertTopic(topic: {
    id: string;
    title: string;
    summary: string;
    tags: string[];
    content: string;
    userId: string;
    updatedAt?: string;
  }): Promise<void>;
  deleteRecord(id: string): Promise<void>;
  deleteTopic(id: string): Promise<void>;
  searchTopics(opts: { query: string; topK: number; userId: string }): Promise<TopicVectorSearchResult[]>;
  searchRecords(opts: { query: string; topK: number; userId: string }): Promise<RecordVectorSearchResult[]>;
}

export class SqliteVecVectorStore implements VectorStore {
  private enabled: boolean | null = null;

  constructor(
    private db: Kysely<DB>,
    private config: AppConfig,
  ) {}

  async upsertRecord(record: { id: string; content: string; userId: string; createdAt?: string }): Promise<void> {
    if (!(await this.isEnabled())) return;
    logInfo("vector-store", "upsert record start", { recordId: record.id, userId: record.userId, contentLength: record.content.length });
    const embedding = await this.embed(record.content);
    if (!embedding) return;

    await sql`delete from vec_records where record_id = ${record.id}`.execute(this.db);
    await sql`
      insert into vec_records(record_id, user_id, embedding, created_at, embedding_text)
      values (${record.id}, ${record.userId}, ${JSON.stringify(embedding)}, ${record.createdAt ?? nowIso()}, ${record.content})
    `.execute(this.db);
    logInfo("vector-store", "upsert record completed", { recordId: record.id, userId: record.userId });
  }

  async upsertTopic(topic: {
    id: string;
    title: string;
    summary: string;
    tags: string[];
    content: string;
    userId: string;
    updatedAt?: string;
  }): Promise<void> {
    if (!(await this.isEnabled())) return;
    const embeddingText = buildTopicEmbeddingText(topic);
    logInfo("vector-store", "upsert topic start", { topicId: topic.id, userId: topic.userId, embeddingTextLength: embeddingText.length });
    const embedding = await this.embed(embeddingText);
    if (!embedding) return;

    await sql`delete from vec_topics where topic_id = ${topic.id}`.execute(this.db);
    await sql`
      insert into vec_topics(topic_id, user_id, embedding, updated_at, embedding_text)
      values (${topic.id}, ${topic.userId}, ${JSON.stringify(embedding)}, ${topic.updatedAt ?? nowIso()}, ${embeddingText})
    `.execute(this.db);
    logInfo("vector-store", "upsert topic completed", { topicId: topic.id, userId: topic.userId });
  }

  async deleteRecord(id: string): Promise<void> {
    if (!(await this.isEnabled())) return;
    await sql`delete from vec_records where record_id = ${id}`.execute(this.db);
    logInfo("vector-store", "delete record vector", { recordId: id });
  }

  async deleteTopic(id: string): Promise<void> {
    if (!(await this.isEnabled())) return;
    await sql`delete from vec_topics where topic_id = ${id}`.execute(this.db);
    logInfo("vector-store", "delete topic vector", { topicId: id });
  }

  async searchTopics(opts: { query: string; topK: number; userId: string }): Promise<TopicVectorSearchResult[]> {
    if (!(await this.isEnabled())) return [];
    logInfo("vector-store", "search topics start", { userId: opts.userId, topK: opts.topK, queryLength: opts.query.length });
    const embedding = await this.embed(opts.query);
    if (!embedding) return [];

    const result = await sql<{ topic_id: string; distance: number; embedding_text: string }>`
      select topic_id, distance, embedding_text
      from vec_topics
      where embedding match ${JSON.stringify(embedding)}
        and user_id = ${opts.userId}
        and k = ${opts.topK}
      order by distance
    `.execute(this.db);

    logInfo("vector-store", "search topics completed", { userId: opts.userId, hitCount: result.rows.length });
    return result.rows.map((row) => ({
      topicId: row.topic_id,
      distance: Number(row.distance),
      embeddingText: row.embedding_text,
    }));
  }

  async searchRecords(opts: { query: string; topK: number; userId: string }): Promise<RecordVectorSearchResult[]> {
    if (!(await this.isEnabled())) return [];
    logInfo("vector-store", "search records start", { userId: opts.userId, topK: opts.topK, queryLength: opts.query.length });
    const embedding = await this.embed(opts.query);
    if (!embedding) return [];

    const result = await sql<{ record_id: string; distance: number; embedding_text: string }>`
      select record_id, distance, embedding_text
      from vec_records
      where embedding match ${JSON.stringify(embedding)}
        and user_id = ${opts.userId}
        and k = ${opts.topK}
      order by distance
    `.execute(this.db);

    logInfo("vector-store", "search records completed", { userId: opts.userId, hitCount: result.rows.length });
    return result.rows.map((row) => ({
      recordId: row.record_id,
      distance: Number(row.distance),
      embeddingText: row.embedding_text,
    }));
  }

  private async isEnabled(): Promise<boolean> {
    if (this.enabled !== null) return this.enabled;
    if (!this.config.embeddingApiKey) {
      this.enabled = false;
      logWarn("vector-store", "disabled because embedding api key is missing");
      return false;
    }

    try {
      await sql`select vec_version()`.execute(this.db);
      await this.ensureTables();
      this.enabled = true;
      logInfo("vector-store", "enabled", { model: this.config.embeddingModel, dimension: this.config.embeddingDimension });
    } catch (err) {
      this.enabled = false;
      const message = err instanceof Error ? err.message : "Unknown error";
      logWarn("vector-store", "disabled because sqlite-vec is unavailable", { error: message });
    }
    return this.enabled;
  }

  private async embed(input: string): Promise<number[] | null> {
    if (!this.config.embeddingApiKey) return null;

    const response = await fetch(`${this.config.embeddingApiBase.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.embeddingApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.embeddingModel,
        input,
      }),
    });

    if (!response.ok) {
      logWarn("vector-store", "embedding request failed", { status: response.status, statusText: response.statusText });
      return null;
    }

    const body = await response.json() as { data?: Array<{ embedding?: number[] }> };
    const embedding = body.data?.[0]?.embedding;
    if (!embedding || embedding.length !== this.config.embeddingDimension) {
      logWarn("vector-store", "embedding dimension mismatch or empty embedding", {
        expected: this.config.embeddingDimension,
        actual: embedding?.length ?? 0,
      });
      return null;
    }
    return embedding;
  }

  private async ensureTables(): Promise<void> {
    await sql`
      create virtual table if not exists vec_topics using vec0(
        topic_id text primary key,
        user_id text partition key,
        embedding float[1536],
        updated_at text,
        +embedding_text text
      )
    `.execute(this.db);

    await sql`
      create virtual table if not exists vec_records using vec0(
        record_id text primary key,
        user_id text partition key,
        embedding float[1536],
        created_at text,
        +embedding_text text
      )
    `.execute(this.db);
  }
}

export function buildTopicEmbeddingText(topic: {
  title: string;
  summary: string;
  tags: string[];
  content: string;
}): string {
  const bodyPreview = topic.content.slice(0, 2000);
  return [
    `标题：${topic.title}`,
    topic.summary ? `摘要：${topic.summary}` : "",
    topic.tags.length > 0 ? `标签：${topic.tags.join(", ")}` : "",
    bodyPreview ? `正文片段：${bodyPreview}` : "",
  ].filter(Boolean).join("\n");
}
