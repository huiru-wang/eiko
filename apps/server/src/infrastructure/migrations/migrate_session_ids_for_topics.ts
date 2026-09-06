import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await sql`
    update topics
    set session_id = 'topic:' || id
    where session_id like 'contemplate-%'
      or session_id like 'digest-%'
  `.execute(db);
}

export async function down() {}
