/** SQLite Task 仓库实现 */
import { sql, type Kysely } from "kysely";
import type { DB } from "../../infrastructure/schema.js";
import type { Record as UserRecord } from "../../modules/record/record.js";
import type { Task, TaskStatus } from "../../modules/task/task.js";
import type { TaskRepository } from "../../modules/task/task.repository.js";
import { randomUUID } from "node:crypto";
import { nowIso } from "../time.js";

export class SqliteTaskRepository implements TaskRepository {
  constructor(private db: Kysely<DB>) {}

  async completeOrganization(id: string, input: Parameters<TaskRepository["completeOrganization"]>[1]): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      for (const record of input.records) {
        const result = await trx.updateTable("records").set({
          status: record.status, updated_at: nowIso(),
          ext_data: sql<string>`json_set(coalesce(ext_data, '{}'), '$.organization', json(${JSON.stringify(record.organization)}))`,
        }).where("id", "=", record.id).where("status", "=", "processing").executeTakeFirst();
        if (result.numUpdatedRows !== 1n) throw new Error(`Record ${record.id} is no longer processing`);
      }
      for (const topic of input.topics) {
        const result = await trx.updateTable("topics").set({
          ext_data: sql<string>`json_set(coalesce(ext_data, '{}'), '$.organization', json(${JSON.stringify(topic.organization)}))`,
        }).where("id", "=", topic.id).executeTakeFirst();
        if (result.numUpdatedRows !== 1n) throw new Error(`Topic ${topic.id} not found during finalization`);
      }
      const completed = await trx.updateTable("tasks").set({ status: "completed", error: null, result: JSON.stringify(input.result), updated_at: nowIso() }).where("id", "=", id).executeTakeFirst();
      if (completed.numUpdatedRows !== 1n) throw new Error(`Task ${id} not found during finalization`);
    });
  }

  async create(input: { userId: string; type: "contemplate" | "topic_organize"; input: Record<string, any> }): Promise<Task> {
    const now = nowIso();
    const row = {
      id: randomUUID(),
      user_id: input.userId,
      type: input.type,
      status: "pending",
      input: JSON.stringify(input.input),
      result: JSON.stringify({}),
      error: null,
      created_at: now,
      updated_at: now,
    };
    await this.db.insertInto("tasks").values(row).execute();
    return this.toEntity(row);
  }

  async createContemplateTaskWithRecords(input: {
    userId: string;
    statuses: Array<"pending" | "processing" | "organized" | "skipped" | "updated">;
    limit: number;
  }): Promise<{ pending: UserRecord[]; task: Task | null }> {
    return this.db.transaction().execute(async (trx) => {
      const rows = await trx
        .selectFrom("records")
        .selectAll()
        .where("user_id", "=", input.userId)
        .where("status", "in", input.statuses)
        .orderBy("created_at", "asc")
        .limit(input.limit)
        .execute();

      if (rows.length === 0) return { pending: [], task: null };

      const now = nowIso();
      const originalStatuses = rows.map((r) => ({ recordId: r.id, status: r.status }));
      const ids = rows.map((r) => r.id);

      await trx
        .updateTable("records")
        .set({ status: "processing", updated_at: now })
        .where("id", "in", ids)
        .execute();

      const taskRow = {
        id: randomUUID(),
        user_id: input.userId,
        type: "contemplate",
        status: "pending",
        input: JSON.stringify({ recordIds: ids, originalStatuses }),
        result: JSON.stringify({}),
        error: null,
        created_at: now,
        updated_at: now,
      };

      await trx.insertInto("tasks").values(taskRow).execute();

      return {
        pending: rows.map((r) => this.toRecordEntity({ ...r, status: "processing", updated_at: now })),
        task: this.toEntity(taskRow),
      };
    });
  }

  async findById(id: string): Promise<Task | null> {
    const row = await this.db.selectFrom("tasks").selectAll().where("id", "=", id).executeTakeFirst();
    return row ? this.toEntity(row) : null;
  }

  async findByUserId(userId: string, opts: { limit: number }): Promise<Task[]> {
    const rows = await this.db
      .selectFrom("tasks")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("updated_at", "desc")
      .limit(opts.limit)
      .execute();
    return rows.map((r) => this.toEntity(r));
  }

  async update(id: string, patch: Partial<Pick<Task, "result" | "error">> & { status?: TaskStatus }): Promise<void> {
    const row: any = { updated_at: nowIso() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.result !== undefined) row.result = JSON.stringify(patch.result);
    if (patch.error !== undefined) row.error = patch.error;
    await this.db.updateTable("tasks").set(row).where("id", "=", id).execute();
  }

  private toEntity(row: any): Task {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      status: row.status,
      input: row.input ? JSON.parse(row.input) : null,
      result: row.result ? JSON.parse(row.result) : null,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toRecordEntity(row: any): UserRecord {
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
