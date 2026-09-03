/** SQLite Topic 仓库实现 */
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/schema.js";
import type { TopicRepository } from "../../modules/topic/topic.repository.js";
import type { Topic } from "../../modules/topic/topic.js";
import { randomUUID } from "node:crypto";

export class SqliteTopicRepository implements TopicRepository {
  constructor(private db: Kysely<DB>) {}

  async create(input: { userId: string; sessionId: string; title: string }): Promise<Topic> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const row = {
      id,
      user_id: input.userId,
      session_id: input.sessionId,
      title: input.title,
      summary: "",
      body_markdown: "",
      tags: "[]",
      match_text: "",
      pending_actions: "[]",
      needs_organize: 0,
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
    if (opts.cursor) query = query.where("updated_at", "<", opts.cursor);
    const rows = await query.orderBy("updated_at", "desc").limit(opts.limit).execute();
    return rows.map((r) => this.toEntity(r));
  }

  async update(id: string, patch: Partial<Pick<Topic, "title" | "summary" | "bodyMarkdown" | "tags" | "matchText" | "needsOrganize" | "status">>): Promise<void> {
    const row: any = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.summary !== undefined) row.summary = patch.summary;
    if (patch.bodyMarkdown !== undefined) row.body_markdown = patch.bodyMarkdown;
    if (patch.tags !== undefined) row.tags = JSON.stringify(patch.tags);
    if (patch.matchText !== undefined) row.match_text = patch.matchText;
    if (patch.needsOrganize !== undefined) row.needs_organize = patch.needsOrganize ? 1 : 0;
    if (patch.status !== undefined) row.status = patch.status;
    await this.db.updateTable("topics").set(row).where("id", "=", id).execute();
  }

  async linkRecord(recordId: string, topicId: string, relation = "primary"): Promise<void> {
    await this.db.insertInto("record_topics").values({
      record_id: recordId,
      topic_id: topicId,
      relation,
      created_at: new Date().toISOString(),
    }).execute();
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

  private toEntity(row: any): Topic {
    return {
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      title: row.title,
      summary: row.summary,
      bodyMarkdown: row.body_markdown,
      tags: JSON.parse(row.tags || "[]"),
      matchText: row.match_text,
      pendingActions: row.pending_actions,
      needsOrganize: !!row.needs_organize,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
