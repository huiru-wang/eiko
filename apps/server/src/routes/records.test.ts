import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import type { DB } from "../infrastructure/schema.js";
import { SqliteRecordRepository } from "../infrastructure/repositories/sqlite-record.repository.js";
import { createRecordRoutes } from "./records.js";
import type { Record as UserRecord } from "../modules/record/record.js";
import { encodeRecordCursor } from "../modules/record/record-cursor.js";

test("batch validates before writing and preserves input order and user", async () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE records (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source TEXT NOT NULL,
    content TEXT NOT NULL CHECK (content != 'reject'), status TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
  const repo = new SqliteRecordRepository(db);
  const app = createRecordRoutes(repo);
  const post = (body: string) => app.request("/batch", {
    method: "POST", headers: { "Content-Type": "application/json", "x-user-id": "batch-test" }, body,
  });
  try {
    for (const body of ["{", '{"records":[]}', JSON.stringify({ records: [{ content: "valid" }, { content: "  " }] }),
      JSON.stringify({ records: Array.from({ length: 101 }, () => ({ content: "x" })) })]) {
      assert.equal((await post(body)).status, 400);
    }
    assert.equal((await db.selectFrom("records").selectAll().execute()).length, 0);

    await assert.rejects(repo.createMany([{ userId: "batch-test", content: "valid" }, { userId: "batch-test", content: "reject" }]));
    assert.equal((await db.selectFrom("records").selectAll().execute()).length, 0);

    const response = await post(JSON.stringify({ records: [{ content: " first " }, { content: "second", source: "test" }] }));
    assert.equal(response.status, 200);
    const body = await response.json() as { success: boolean; result: { count: number; data: UserRecord[] } };
    assert.equal(body.success, true);
    assert.equal(body.result.count, 2);
    assert.deepEqual(body.result.data.map((r: { content: string }) => r.content), ["first", "second"]);
    assert.equal(new Set(body.result.data.map((r: { id: string }) => r.id)).size, 2);
    for (const record of body.result.data) {
      assert.equal(record.userId, "batch-test");
      assert.equal(record.status, "pending");
      assert.equal((await repo.findById(record.id))?.content, record.content);
    }
    assert.equal(body.result.data[0].source, "home");
    assert.equal(body.result.data[1].source, "test");
  } finally {
    await db.destroy();
  }
});

test("topic filter and composite pagination preserve tied records and user isolation", async () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE records (
    id TEXT PRIMARY KEY, user_id TEXT, source TEXT, content TEXT, status TEXT,
    created_at TEXT, updated_at TEXT
  ); CREATE TABLE topics (id TEXT PRIMARY KEY, user_id TEXT, title TEXT DEFAULT 'topic', status TEXT DEFAULT 'active');
  CREATE TABLE record_topics (record_id TEXT, topic_id TEXT);
  INSERT INTO topics (id, user_id) VALUES ('t1', 'u1'), ('t2', 'u1'), ('private', 'u2');`);
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
  const repo = new SqliteRecordRepository(db);
  const app = createRecordRoutes(repo);
  const time = "2026-09-05T17:00:00.000+08:00";
  try {
    for (const id of ["a", "b", "c", "d", "e"]) {
      sqlite.prepare("INSERT INTO records VALUES (?, ?, 'home', ?, 'organized', ?, ?)")
        .run(id, id === "e" ? "u2" : "u1", id, id === "a" ? "2026-09-04T17:00:00.000+08:00" : time, time);
    }
    sqlite.exec(`INSERT INTO record_topics VALUES
      ('a','t1'), ('b','t1'), ('c','t1'), ('c','t1'), ('d','t2'), ('e','t1'), ('c','private');`);
    const get = async (query: string) => app.request(`/?${query}`, { headers: { "x-user-id": "u1" } });
    const page = async (query: string) => (await (await get(query)).json()) as {
      result: { data: UserRecord[]; nextCursor: string | null; hasMore: boolean };
    };
    const first = (await page("topicId=t1&limit=2")).result;
    assert.deepEqual(first.data.map((r) => r.id), ["c", "b"]);
    assert.equal(first.hasMore, true);
    const second = (await page(`topicId=t1&limit=2&cursor=${first.nextCursor}`)).result;
    assert.deepEqual(second.data.map((r) => r.id), ["a"]);
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);
    const tied = (await page(`topicId=t1&limit=1&cursor=${encodeRecordCursor(first.data[0])}`)).result;
    assert.equal(tied.data[0].id, "b");
    assert.deepEqual((await page("topicId=private")).result.data, []);
    assert.deepEqual((await page("topicId=missing")).result.data, []);
    const all = (await page("limit=4")).result;
    assert.deepEqual(all.data.map((r) => r.id), ["d", "c", "b", "a"]);
    assert.equal(all.hasMore, false);
    const legacy = (await page(`cursor=${encodeURIComponent(time)}`)).result;
    assert.deepEqual(legacy.data.map((r) => r.id), ["a"]);
    for (const query of ["limit=0", "limit=101", "limit=1.5", "limit=bad", "topicId=", "cursor=invalid"]) {
      assert.equal((await get(query)).status, 400);
    }
  } finally { await db.destroy(); }
});
