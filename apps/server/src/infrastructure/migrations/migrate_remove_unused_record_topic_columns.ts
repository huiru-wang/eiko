import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await dropIndexIfExists(db, "idx_records_user_id");
  await dropColumnIfExists(db, "records", "digest_result");
  await dropColumnIfExists(db, "records", "digest_version");
  await dropColumnIfExists(db, "records", "occurred_at");
  await sql`create index if not exists idx_records_user_id on records(user_id, created_at)`.execute(db);

  const topicsColumns = await getColumns(db, "topics");
  if (topicsColumns.includes("body_markdown") && !topicsColumns.includes("content")) {
    await sql`alter table topics rename column body_markdown to content`.execute(db);
  }
  await dropColumnIfExists(db, "topics", "match_text");
  await dropColumnIfExists(db, "topics", "needs_organize");

  try {
    await sql`select vec_version()`.execute(db);
  } catch {
    return;
  }

  await sql`drop table if exists vec_records`.execute(db);
  await sql`
    create virtual table if not exists vec_records using vec0(
      record_id text primary key,
      user_id text partition key,
      embedding float[1536],
      created_at text,
      +embedding_text text
    )
  `.execute(db);
}

export async function down() {}

async function getColumns(db: Kysely<any>, tableName: string) {
  const result = await sql<{ name: string }>`pragma table_info(${sql.raw(tableName)})`.execute(db);
  return result.rows.map((row) => row.name);
}

async function dropColumnIfExists(db: Kysely<any>, tableName: string, columnName: string) {
  const columns = await getColumns(db, tableName);
  if (!columns.includes(columnName)) return;
  await sql`alter table ${sql.raw(tableName)} drop column ${sql.raw(columnName)}`.execute(db);
}

async function dropIndexIfExists(db: Kysely<any>, indexName: string) {
  await sql`drop index if exists ${sql.raw(indexName)}`.execute(db);
}
