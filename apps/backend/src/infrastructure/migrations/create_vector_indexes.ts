import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  try {
    await sql`select vec_version()`.execute(db);
  } catch {
    console.warn("[migration] sqlite-vec is not loaded; skip vector index creation");
    return;
  }

  await sql`
    create virtual table if not exists vec_topics using vec0(
      topic_id text primary key,
      user_id text partition key,
      embedding float[1536],
      updated_at text,
      +embedding_text text
    )
  `.execute(db);

  await sql`
    create virtual table if not exists vec_records using vec0(
      record_id text primary key,
      user_id text partition key,
      embedding float[1536],
      occurred_at text,
      +embedding_text text
    )
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`drop table if exists vec_topics`.execute(db);
  await sql`drop table if exists vec_records`.execute(db);
}
