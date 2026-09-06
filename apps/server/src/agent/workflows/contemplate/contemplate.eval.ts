import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadEnv, loadConfig } from "../../../env.js";
import { createDatabase } from "../../../infrastructure/database.js";
import { SqliteRecordRepository } from "../../../infrastructure/repositories/sqlite-record.repository.js";
import { SqliteTopicRepository } from "../../../infrastructure/repositories/sqlite-topic.repository.js";
import { SqliteTaskRepository } from "../../../infrastructure/repositories/sqlite-task.repository.js";
import { SqliteVecVectorStore } from "../../../infrastructure/vector-store.js";
import { runContemplateWorkflow } from "./contemplate.workflow.js";

// Explicit live evaluation: only backups are mutated; never run as an automatic unit test.
loadEnv();
const config = loadConfig();
const source = new Database(resolve(config.sqlitePath), { readonly: true });
const directory = await mkdtemp(join(tmpdir(), "fanto-contemplate-eval-"));
const baseline = join(directory, "baseline.sqlite");
try { await source.backup(baseline); } finally { source.close(); }
console.log("Evaluation directory:", directory);
for (const order of ["original", "reversed"]) {
  const path = join(directory, `${order}.sqlite`);
  const snapshot = new Database(baseline, { readonly: true });
  try { await snapshot.backup(path); } finally { snapshot.close(); }
  const db = createDatabase(path);
  try {
    const recordRepo = new SqliteRecordRepository(db);
    const topicRepo = new SqliteTopicRepository(db);
    const taskRepo = new SqliteTaskRepository(db);
    const pending = await recordRepo.findProcessableByUserId("default-user", { statuses: ["pending", "updated", "skipped"], limit: 30 });
    assert.equal(pending.length, 10, "This evaluation expects the ten pending incremental records.");
    const initialTopics = await topicRepo.findByUserId("default-user", { limit: 100 });
    assert.equal(initialTopics.length, 2, "This evaluation expects the two baseline topics.");
    if (order === "reversed") {
      for (const [index, record] of [...pending].reverse().entries()) {
        await db.updateTable("records").set({ created_at: `2026-09-05T16:59:${String(index).padStart(2, "0")}.000+08:00` }).where("id", "=", record.id).execute();
      }
    }
    const result = await runContemplateWorkflow({ config: { ...config, sqlitePath: path }, recordRepo, topicRepo, taskRepo,
      vectorStore: new SqliteVecVectorStore(db, config), userId: "default-user" });
    const topics = await topicRepo.findByUserId("default-user", { limit: 100 });
    const task = await taskRepo.findById(result.taskId!);
    assert.equal(task?.status, "completed");
    assert.equal(topics.filter((topic) => topic.status === "active").length, 4);
    assert.equal(task?.result?.skipped.length, 1);
    for (const initial of initialTopics) assert.ok(topics.some((topic) => topic.id === initial.id && topic.status === "active"));
    console.log(JSON.stringify({ order, taskId: result.taskId, attempts: task?.result?.planningAttempts.length,
      plan: task?.result?.plan, topics: topics.map(({ id, title, content }) => ({ id, title, content })) }, null, 2));
  } finally { await db.destroy(); }
}
