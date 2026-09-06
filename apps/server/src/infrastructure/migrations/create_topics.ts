import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .createTable("topics")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("session_id", "text", (c) => c.notNull())
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("summary", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("content", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("tags", "text", (c) => c.notNull().defaultTo("[]"))
    .addColumn("pending_actions", "text", (c) => c.notNull().defaultTo("[]"))
    .addColumn("status", "text", (c) => c.notNull().defaultTo("active"))
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema.createIndex("idx_topics_user_id").on("topics").columns(["user_id", "updated_at"]).execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("topics").execute();
}
