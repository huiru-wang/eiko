/** SQLite Record 仓库实现 */
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/schema.js";
import type { RecordRepository, CreateRecordInput } from "../../modules/record/record.repository.js";
import type { Record } from "../../modules/record/record.js";
import { randomUUID } from "node:crypto";

export class SqliteRecordRepository implements RecordRepository {
  constructor(private db: Kysely<DB>) {}

  async create(input: CreateRecordInput): Promise<Record> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const row = {
      id,
      user_id: input.userId,
      source: input.source ?? "home",
      content: input.content,
      status: "pending",
      digest_result: null,
      digest_version: null,
      occurred_at: now,
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

  async findByUserId(userId: string, opts: { cursor?: string; limit: number }): Promise<Record[]> {
    let query = this.db.selectFrom("records").selectAll().where("user_id", "=", userId);
    if (opts.cursor) query = query.where("created_at", "<", opts.cursor);
    const rows = await query.orderBy("occurred_at", "desc").limit(opts.limit).execute();
    return rows.map((r) => this.toEntity(r));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db.updateTable("records").set({ status, updated_at: new Date().toISOString() }).where("id", "=", id).execute();
  }

  private toEntity(row: any): Record {
    return {
      id: row.id,
      userId: row.user_id,
      source: row.source,
      content: row.content,
      status: row.status,
      digestResult: row.digest_result,
      digestVersion: row.digest_version,
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
