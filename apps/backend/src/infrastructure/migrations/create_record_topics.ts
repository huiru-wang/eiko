import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .createTable("record_topics")
    .addColumn("record_id", "text", (c) => c.notNull())
    .addColumn("topic_id", "text", (c) => c.notNull())
    .addColumn("relation", "text", (c) => c.notNull().defaultTo("primary"))
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("idx_record_topics_record_id")
    .on("record_topics")
    .columns(["record_id"])
    .execute();

  await db.schema
    .createIndex("idx_record_topics_topic_id")
    .on("record_topics")
    .columns(["topic_id"])
    .execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.dropTable("record_topics").execute();
}
