import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .createTable("tasks")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull().defaultTo("pending"))
    .addColumn("input", "text")
    .addColumn("result", "text")
    .addColumn("error", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema.createIndex("idx_tasks_user_id").on("tasks").columns(["user_id", "updated_at"]).execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("tasks").execute();
}
