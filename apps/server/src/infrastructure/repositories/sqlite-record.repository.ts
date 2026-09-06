/** SQLite Record 仓库实现 */
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/schema.js";
import type { RecordRepository, CreateRecordInput } from "../../modules/record/record.repository.js";
import type { Record, RecordStatus } from "../../modules/record/record.js";
import { randomUUID } from "node:crypto";
import { nowIso } from "../time.js";
import { decodeRecordCursor } from "../../modules/record/record-cursor.js";

export class SqliteRecordRepository implements RecordRepository {
  constructor(private db: Kysely<DB>) {}

  async findTopicLinks(userId: string, recordIds: string[]) {
    if (recordIds.length === 0) return [];
    return this.db.selectFrom("record_topics")
      .innerJoin("records", "records.id", "record_topics.record_id")
      .innerJoin("topics", "topics.id", "record_topics.topic_id")
      .select(["record_topics.record_id as recordId", "topics.id", "topics.title", "topics.status"])
      .where("records.user_id", "=", userId).where("topics.user_id", "=", userId)
      .where("record_topics.record_id", "in", recordIds).distinct().orderBy("topics.id", "asc").execute();
  }

  async updateContent(id: string, userId: string, content: string): Promise<{ record: Record; changed: boolean } | "not_found" | "processing"> {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx.selectFrom("records").selectAll().where("id", "=", id).where("user_id", "=", userId).executeTakeFirst();
      if (!row) return "not_found";
      if (row.status === "processing") return "processing";
      if (row.content === content) return { record: this.toEntity(row), changed: false };
      const updated = await trx.updateTable("records").set({ content, status: "updated", updated_at: nowIso() })
        .where("id", "=", id).where("user_id", "=", userId).where("status", "!=", "processing")
        .returningAll().executeTakeFirst();
      return updated ? { record: this.toEntity(updated), changed: true } : "processing";
    });
  }

  async create(input: CreateRecordInput): Promise<Record> {
    const now = nowIso();
    const id = randomUUID();
    const row = {
      id,
      user_id: input.userId,
      source: input.source ?? "home",
      content: input.content,
      status: "pending",
      created_at: now,
      updated_at: now,
    };
    await this.db.insertInto("records").values(row).execute();
    return this.toEntity(row);
  }

  async findById(id: string): Promise<Record | null> {
    const row = await this.db.selectFrom("records").selectAll().where("id", "=", id).executeTakeFirst();
    return row ? this.toEntity(row) : null;
  }

  async createMany(inputs: CreateRecordInput[]): Promise<Record[]> {
    if (inputs.length === 0) return [];
    const now = nowIso();
    const rows = inputs.map((input) => ({
      id: randomUUID(),
      user_id: input.userId,
      source: input.source ?? "home",
      content: input.content,
      status: "pending",
      created_at: now,
      updated_at: now,
    }));
    // A single INSERT makes the batch atomic.
    await this.db.insertInto("records").values(rows).execute();
    return rows.map((row) => this.toEntity(row));
  }

  async findByUserId(userId: string, opts: { cursor?: string; topicId?: string; limit: number }): Promise<Record[]> {
    let query = this.db.selectFrom("records").selectAll("records").where("records.user_id", "=", userId);
    if (opts.topicId) {
      query = query.where((eb) => eb.exists(
        eb.selectFrom("record_topics")
          .innerJoin("topics", "topics.id", "record_topics.topic_id")
          .select("record_topics.record_id")
          .whereRef("record_topics.record_id", "=", "records.id")
          .where("record_topics.topic_id", "=", opts.topicId!)
          .where("topics.user_id", "=", userId),
      ));
    }
    if (opts.cursor) {
      const cursor = decodeRecordCursor(opts.cursor);
      query = query.where((eb) => cursor.id
        ? eb.or([eb("records.created_at", "<", cursor.createdAt), eb.and([
          eb("records.created_at", "=", cursor.createdAt), eb("records.id", "<", cursor.id),
        ])])
        : eb("records.created_at", "<", cursor.createdAt));
    }
    const rows = await query.orderBy("records.created_at", "desc").orderBy("records.id", "desc").limit(opts.limit).execute();
    return rows.map((r) => this.toEntity(r));
  }

  async findProcessableByUserId(userId: string, opts: { statuses: RecordStatus[]; limit: number }): Promise<Record[]> {
    const rows = await this.db
      .selectFrom("records")
      .selectAll()
      .where("user_id", "=", userId)
      .where("status", "in", opts.statuses)
      .orderBy("created_at", "asc")
      .limit(opts.limit)
      .execute();
    return rows.map((r) => this.toEntity(r));
  }

  async updateStatus(id: string, status: RecordStatus): Promise<void> {
    await this.db.updateTable("records").set({ status, updated_at: nowIso() }).where("id", "=", id).execute();
  }

  async updateManyStatus(ids: string[], status: RecordStatus): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .updateTable("records")
      .set({ status, updated_at: nowIso() })
      .where("id", "in", ids)
      .execute();
  }

  private toEntity(row: any): Record {
    return {
      extData: row.ext_data ? JSON.parse(row.ext_data) : null,
      id: row.id,
      userId: row.user_id,
      source: row.source,
      content: row.content,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
