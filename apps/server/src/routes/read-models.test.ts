import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase, runMigrations } from "../infrastructure/database.js";
import { SqliteRecordRepository } from "../infrastructure/repositories/sqlite-record.repository.js";
import { SqliteTopicRepository } from "../infrastructure/repositories/sqlite-topic.repository.js";
import { SqliteMessageRepository } from "../infrastructure/repositories/sqlite-message.repository.js";
import { createRecordRoutes } from "./records.js";
import { createTopicRoutes } from "./topics.js";
import { createMessageRoutes } from "./messages.js";
import type { RecordReadDto } from "@eiko/shared";

test("record read model batches links, includes archive status and isolates detail", async () => {
  const db = createDatabase(":memory:");
  try {
    await runMigrations(db);
    const records = new SqliteRecordRepository(db);
    const topics = new SqliteTopicRepository(db);
    const [r, unlinked] = await records.createMany([{ userId: "u", content: "r" }, { userId: "u", content: "empty" }]);
    const t = await topics.create({ userId: "u", title: "archived" });
    const other = await topics.create({ userId: "other", title: "private" });
    await topics.updateStatus(t.id, "archived");
    await topics.linkRecord(r.id, t.id);
    await topics.linkRecord(r.id, other.id);
    const app = createRecordRoutes(records);
    const headers = { "x-user-id": "u" };
    let batches = 0;
    const original = records.findTopicLinks.bind(records);
    records.findTopicLinks = async (...args) => { batches++; return original(...args); };
    const page = await (await app.request("/", { headers })).json() as { result: { data: RecordReadDto[] } };
    assert.equal(batches, 1);
    assert.deepEqual(page.result.data.find((item) => item.id === r.id)?.topics, [{ id: t.id, title: "archived", status: "archived" }]);
    assert.deepEqual(page.result.data.find((item) => item.id === unlinked.id)?.topics, []);
    const detail = await (await app.request(`/${r.id}`, { headers })).json() as { result: RecordReadDto };
    assert.equal(detail.result.content, "r");
    assert.equal(detail.result.extData, null);
    assert.equal(detail.result.topics.length, 1);
    assert.equal((await app.request(`/${r.id}`)).status, 404);
    assert.equal((await app.request("/missing", { headers })).status, 404);
  } finally { await db.destroy(); }
});

test("topic pagination handles tied timestamps and exact full pages with scoped details", async () => {
  const db = createDatabase(":memory:");
  try {
    await runMigrations(db);
    const repo = new SqliteTopicRepository(db);
    const active = await Promise.all(["a", "b", "c", "d"].map((title) => repo.create({ userId: "u", title })));
    const hidden = await repo.create({ userId: "u", title: "archived" });
    await repo.updateStatus(hidden.id, "archived");
    const other = await repo.create({ userId: "other", title: "private" });
    const time = "2026-09-05T17:00:00.000+08:00";
    await db.updateTable("topics").set({ updated_at: time }).execute();
    const app = createTopicRoutes(repo);
    const headers = { "x-user-id": "u" };
    type Page = { result: { data: Array<{ id: string }>; nextCursor: string | null; hasMore: boolean } };
    const first = await (await app.request("/?limit=2", { headers })).json() as Page;
    const second = await (await app.request(`/?limit=2&cursor=${first.result.nextCursor}`, { headers })).json() as Page;
    assert.deepEqual([...first.result.data, ...second.result.data].map((t) => t.id), active.map((t) => t.id).sort().reverse());
    assert.equal(second.result.hasMore, false);
    assert.equal(second.result.nextCursor, null);
    const legacy = await (await app.request(`/?cursor=${encodeURIComponent(time)}`, { headers })).json() as Page;
    assert.deepEqual(legacy.result.data, []);
    for (const query of ["limit=0", "limit=101", "limit=2.5", "limit=abc", "cursor=bad"]) {
      assert.equal((await app.request(`/?${query}`, { headers })).status, 400);
    }
    assert.equal((await app.request(`/${other.id}`, { headers })).status, 404);
    assert.equal((await app.request(`/${hidden.id}`, { headers })).status, 200);
  } finally { await db.destroy(); }
});

test("existing message read endpoint restricts user and current topic session", async () => {
  const db = createDatabase(":memory:");
  try {
    await runMigrations(db);
    const topics = new SqliteTopicRepository(db);
    const messages = new SqliteMessageRepository(db);
    const topic = await topics.create({ userId: "u", title: "t" });
    for (const [userId, sessionId] of [["u", topic.sessionId], ["u", "old"], ["other", topic.sessionId], ["u", topic.sessionId]]) {
      await messages.save({ userId, sessionId, topicId: topic.id, role: "message_end", payload: "{}", timestamp: 1 });
    }
    const app = createMessageRoutes(messages, topics);
    const response = await app.request(`/?topicId=${topic.id}`, { headers: { "x-user-id": "u" } });
    const body = await response.json() as { result: Array<{ id: number; role: string }> };
    assert.deepEqual(body.result.map((m) => m.id), [1, 4]);
    assert.equal(body.result[0].role, "message_end");
    assert.equal((await app.request(`/?topicId=${topic.id}`)).status, 404);
    assert.equal((await app.request("/")).status, 400);
  } finally { await db.destroy(); }
});
