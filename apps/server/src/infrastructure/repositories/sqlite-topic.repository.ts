/** SQLite Topic 仓库实现 */
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/schema.js";
import type { TopicRepository } from "../../modules/topic/topic.repository.js";
import type { Topic } from "../../modules/topic/topic.js";
import type { Record as UserRecord } from "../../modules/record/record.js";
import { randomUUID } from "node:crypto";
import { nowIso } from "../time.js";
import { decodeTopicCursor } from "../../modules/topic/topic-cursor.js";

export class SqliteTopicRepository implements TopicRepository {
  constructor(private db: Kysely<DB>) {}

  async create(input: { userId: string; sessionId?: string; title: string }): Promise<Topic> {
    const now = nowIso();
    const id = randomUUID();
    const row = {
      id,
      user_id: input.userId,
      session_id: input.sessionId ?? `topic:${id}`,
      title: input.title,
      summary: "",
      content: "",
      tags: "[]",
      pending_actions: "[]",
      status: "active",
      created_at: now,
      updated_at: now,
    };
    await this.db.insertInto("topics").values(row).execute();
    return this.toEntity(row);
  }

  async findById(id: string): Promise<Topic | null> {
    const row = await this.db.selectFrom("topics").selectAll().where("id", "=", id).executeTakeFirst();
    return row ? this.toEntity(row) : null;
  }

  async findByUserId(userId: string, opts: { cursor?: string; limit: number }): Promise<Topic[]> {
    let query = this.db.selectFrom("topics").selectAll().where("user_id", "=", userId).where("status", "=", "active");
    if (opts.cursor) {
      const cursor = decodeTopicCursor(opts.cursor);
      query = query.where((eb) => cursor.id ? eb.or([
        eb("updated_at", "<", cursor.updatedAt),
        eb.and([eb("updated_at", "=", cursor.updatedAt), eb("id", "<", cursor.id)]),
      ]) : eb("updated_at", "<", cursor.updatedAt));
    }
    const rows = await query.orderBy("updated_at", "desc").orderBy("id", "desc").limit(opts.limit).execute();
    return rows.map((r) => this.toEntity(r));
  }

  async update(id: string, patch: Partial<Pick<Topic, "title" | "summary" | "content" | "tags" | "status">>): Promise<void> {
    const row: any = { updated_at: nowIso() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.summary !== undefined) row.summary = patch.summary;
    if (patch.content !== undefined) row.content = patch.content;
    if (patch.tags !== undefined) row.tags = JSON.stringify(patch.tags);
    if (patch.status !== undefined) row.status = patch.status;
    await this.db.updateTable("topics").set(row).where("id", "=", id).execute();
  }

  async updateStatus(topicId: string, status: "active" | "archived"): Promise<void> {
    await this.update(topicId, { status });
  }

  async linkRecord(recordId: string, topicId: string, relation = "primary"): Promise<void> {
    const existing = await this.db
      .selectFrom("record_topics")
      .select(["record_id", "topic_id"])
      .where("record_id", "=", recordId)
      .where("topic_id", "=", topicId)
      .executeTakeFirst();
    if (existing) return;

    const count = await this.countTopicsByRecordId(recordId);
    if (count >= 2) {
      throw new Error(`Record "${recordId}" already has ${count} linked topics.`);
    }

    await this.db.insertInto("record_topics").values({
      record_id: recordId,
      topic_id: topicId,
      relation,
      created_at: nowIso(),
    }).execute();
  }

  async unlinkRecord(recordId: string): Promise<void> {
    await this.db.deleteFrom("record_topics").where("record_id", "=", recordId).execute();
  }

  async countTopicsByRecordId(recordId: string): Promise<number> {
    const row = await this.db
      .selectFrom("record_topics")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("record_id", "=", recordId)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async moveRecordTopics(sourceTopicId: string, targetTopicId: string): Promise<void> {
    if (sourceTopicId === targetTopicId) return;

    const rows = await this.db
      .selectFrom("record_topics")
      .select(["record_id", "relation"])
      .where("topic_id", "=", sourceTopicId)
      .execute();

    for (const row of rows) {
      const existing = await this.db
        .selectFrom("record_topics")
        .select(["record_id", "topic_id"])
        .where("record_id", "=", row.record_id)
        .where("topic_id", "=", targetTopicId)
        .executeTakeFirst();

      if (existing) {
        await this.db
          .deleteFrom("record_topics")
          .where("record_id", "=", row.record_id)
          .where("topic_id", "=", sourceTopicId)
          .execute();
        continue;
      }

      await this.db
        .updateTable("record_topics")
        .set({ topic_id: targetTopicId, relation: row.relation })
        .where("record_id", "=", row.record_id)
        .where("topic_id", "=", sourceTopicId)
        .execute();
    }
  }

  async findTopicsByRecordId(recordId: string): Promise<Array<{ id: string; title: string }>> {
    const rows = await this.db
      .selectFrom("topics")
      .innerJoin("record_topics", "record_topics.topic_id", "topics.id")
      .select(["topics.id", "topics.title"])
      .where("record_topics.record_id", "=", recordId)
      .execute();
    return rows.map((r) => ({ id: r.id, title: r.title }));
  }

  async findRelatedRecordsByTopicId(topicId: string): Promise<UserRecord[]> {
    const rows = await this.db
      .selectFrom("records")
      .innerJoin("record_topics", "record_topics.record_id", "records.id")
      .select([
        "records.id",
        "records.ext_data",
        "records.user_id",
        "records.source",
        "records.content",
        "records.status",
        "records.created_at",
        "records.updated_at",
      ])
      .where("record_topics.topic_id", "=", topicId)
      .orderBy("records.created_at", "asc")
      .execute();

    return rows.map((row) => ({
      extData: row.ext_data ? JSON.parse(row.ext_data) : null,
      id: row.id,
      userId: row.user_id,
      source: row.source,
      content: row.content,
      status: row.status as UserRecord["status"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private toEntity(row: any): Topic {
    return {
      extData: row.ext_data ? JSON.parse(row.ext_data) : null,
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      title: row.title,
      summary: row.summary,
      content: row.content,
      tags: JSON.parse(row.tags || "[]"),
      pendingActions: row.pending_actions,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
