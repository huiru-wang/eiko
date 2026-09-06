import { loadConfig, loadEnv } from "../apps/server/src/env.js";
import { createDatabase, runMigrations } from "../apps/server/src/infrastructure/database.js";
import { SqliteRecordRepository } from "../apps/server/src/infrastructure/repositories/sqlite-record.repository.js";
import { SqliteTopicRepository } from "../apps/server/src/infrastructure/repositories/sqlite-topic.repository.js";
import { SqliteVecVectorStore } from "../apps/server/src/infrastructure/vector-store.js";

loadEnv();
const config = loadConfig();
const db = createDatabase(config.sqlitePath);

try {
  await runMigrations(db);

  const recordRepo = new SqliteRecordRepository(db);
  const topicRepo = new SqliteTopicRepository(db);
  const vectorStore = new SqliteVecVectorStore(db, config);

  const records = await recordRepo.findByUserId("default-user", { limit: 10_000 });
  for (const record of records) {
    await vectorStore.upsertRecord(record);
  }

  const topics = await topicRepo.findByUserId("default-user", { limit: 10_000 });
  for (const topic of topics) {
    await vectorStore.upsertTopic(topic);
  }

  console.log(`[vector] rebuilt index: records=${records.length}, topics=${topics.length}`);
} finally {
  await db.destroy();
}
