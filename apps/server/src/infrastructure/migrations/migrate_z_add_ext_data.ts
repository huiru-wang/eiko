import type { Kysely } from "kysely";

export async function up(db: Kysely<any>) {
  await db.schema.alterTable("records").addColumn("ext_data", "text").execute();
  await db.schema.alterTable("topics").addColumn("ext_data", "text").execute();
}

export async function down(db: Kysely<any>) {
  await db.schema.alterTable("topics").dropColumn("ext_data").execute();
  await db.schema.alterTable("records").dropColumn("ext_data").execute();
}
