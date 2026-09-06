import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema
    .createIndex("idx_record_topics_unique")
    .on("record_topics")
    .columns(["record_id", "topic_id"])
    .unique()
    .execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.dropIndex("idx_record_topics_unique").execute();
}
