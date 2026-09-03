import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .createTable("messages")
    .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("topic_id", "text", (c) => c.notNull())
    .addColumn("session_id", "text", (c) => c.notNull())
    .addColumn("role", "text", (c) => c.notNull())
    .addColumn("payload", "text", (c) => c.notNull())
    .addColumn("timestamp", "integer", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("idx_messages_topic_id")
    .on("messages")
    .columns(["topic_id", "timestamp"])
    .execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("messages").execute();
}
