import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase, runMigrations } from "../../../infrastructure/database.js";
import { SqliteRecordRepository } from "../../../infrastructure/repositories/sqlite-record.repository.js";
import { SqliteTopicRepository } from "../../../infrastructure/repositories/sqlite-topic.repository.js";
import { SqliteTaskRepository } from "../../../infrastructure/repositories/sqlite-task.repository.js";
import { createRecordRoutes } from "../../../routes/records.js";
import { executeContemplatePlan } from "./executor.js";
import { rewriteAffectedTopics } from "./topic-rewriter.js";
import type { VectorStore } from "../../../infrastructure/vector-store.js";
import type { AppConfig } from "../../../env.js";
import { runContemplateWorkflow } from "./contemplate.workflow.js";

async function fixture() {
  const db = createDatabase(":memory:");
  await runMigrations(db);
  return { db, records: new SqliteRecordRepository(db), topics: new SqliteTopicRepository(db), tasks: new SqliteTaskRepository(db) };
}

test("PATCH updates content and status, preserves ext data and rejects processing and other users", async () => {
  const { db, records } = await fixture();
  try {
    const record = await records.create({ userId: "u", content: "before" });
    const ext = { custom: "keep", organization: { reason: "old" } };
    await db.updateTable("records").set({ ext_data: JSON.stringify(ext), status: "organized" }).where("id", "=", record.id).execute();
    const app = createRecordRoutes(records);
    const patch = (body: unknown, user = "u") => app.request(`/${record.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-user-id": user }, body: JSON.stringify(body),
    });
    assert.equal((await patch({ content: "after" }, "other")).status, 404);
    assert.equal((await patch({ content: " " })).status, 400);
    assert.equal((await patch({ content: "after", status: "organized" })).status, 400);
    assert.equal((await patch({ content: "after" })).status, 200);
    const updated = await records.findById(record.id);
    assert.equal(updated?.status, "updated");
    assert.equal(updated?.content, "after");
    assert.deepEqual(updated?.extData, ext);
    assert.equal(updated?.createdAt, record.createdAt);
    await patch({ content: "after" });
    assert.equal((await records.findById(record.id))?.updatedAt, updated?.updatedAt);
    await records.updateStatus(record.id, "processing");
    assert.equal((await patch({ content: "new" })).status, 409);
    assert.equal((await records.findById(record.id))?.content, "after");
  } finally { await db.destroy(); }
});

test("finalization merges only organization and rolls back all summaries on failure", async () => {
  const { db, records, topics, tasks } = await fixture();
  try {
    const record = await records.create({ userId: "u", content: "x" });
    const topic = await topics.create({ userId: "u", title: "t" });
    for (const table of ["records", "topics"] as const) {
      await db.updateTable(table).set({ ext_data: JSON.stringify({ custom: 7, organization: { reason: "old" } }) }).execute();
    }
    const { task } = await tasks.createContemplateTaskWithRecords({ userId: "u", statuses: ["pending"], limit: 10 });
    const update = { records: [{ id: record.id, status: "organized" as const, organization: { reason: "new" } }],
      topics: [{ id: topic.id, organization: { summary: "changed" } }], result: { passed: true } };
    await assert.rejects(tasks.completeOrganization(task!.id, { ...update, records: [...update.records,
      { id: "missing", status: "skipped", organization: {} }] }));
    assert.deepEqual((await records.findById(record.id))?.extData, { custom: 7, organization: { reason: "old" } });
    assert.equal((await records.findById(record.id))?.status, "processing");
    assert.notEqual((await tasks.findById(task!.id))?.status, "completed");
    await tasks.completeOrganization(task!.id, update);
    assert.deepEqual((await records.findById(record.id))?.extData, { custom: 7, organization: { reason: "new" } });
    assert.deepEqual((await topics.findById(topic.id))?.extData, { custom: 7, organization: { summary: "changed" } });
    assert.equal((await tasks.findById(task!.id))?.status, "completed");
  } finally { await db.destroy(); }
});

test("replanning replaces old links and rebuilds old and new topics from current records", async () => {
  const { db, records, topics } = await fixture();
  try {
    const moved = await records.create({ userId: "u", content: "new subject" });
    const retained = await records.create({ userId: "u", content: "remaining evidence" });
    const old = await topics.create({ userId: "u", title: "old" });
    const target = await topics.create({ userId: "u", title: "target" });
    await topics.linkRecord(moved.id, old.id);
    await topics.linkRecord(retained.id, old.id);
    const plan = { actions: [{ id: "a", type: "merge_record" as const, recordIds: [moved.id], targetTopicId: target.id,
      facet: "f", point: "p", reason: "r" }] };
    const execution = await executeContemplatePlan({ taskId: "test", userId: "u", records: [moved], plan, topicRepo: topics, previousTopicIds: [old.id] });
    assert.deepEqual((await topics.findTopicsByRecordId(moved.id)).map((t) => t.id), [target.id]);
    assert.deepEqual((await topics.findRelatedRecordsByTopicId(old.id)).map((r) => r.id), [retained.id]);
    const prompts: string[] = [];
    const vectorStore = { upsertTopic: async () => {}, deleteTopic: async () => {} } as unknown as VectorStore;
    await rewriteAffectedTopics({ config: {} as AppConfig, taskId: "test", topicIds: execution.affectedTopicIds, topicRepo: topics, vectorStore,
      recordsByTopicId: execution.recordsByTopicId, sourceTopicsByTargetId: {}, actions: plan.actions,
      complete: async (prompt) => { prompts.push(prompt); return { stopReason: "stop", text: JSON.stringify({
        title: "rewritten", summary: "s", tags: ["t"], content: "current evidence only", changeSummary: "updated", }) }; },
    });
    assert.equal(prompts.length, 2);
    assert.ok(prompts[0].includes("remaining evidence"));
    assert.ok(!prompts[0].includes("new subject"));
    assert.ok(prompts[1].includes("new subject"));
    await topics.unlinkRecord(retained.id);
    await rewriteAffectedTopics({ config: {} as AppConfig, taskId: "test", topicIds: [old.id], topicRepo: topics, vectorStore,
      recordsByTopicId: {}, sourceTopicsByTargetId: {}, actions: [], complete: async () => { throw new Error("must not call model"); } });
    assert.equal((await topics.findById(old.id))?.status, "archived");
    assert.equal((await topics.findById(old.id))?.content, "");
  } finally { await db.destroy(); }
});

test("workflow persists actual per-record decisions and topic changes only on success", async () => {
  const { db, records, topics, tasks } = await fixture();
  try {
    const [record, skipped] = await records.createMany([{ userId: "u", content: "updated idea" }, { userId: "u", content: "reminder" }]);
    const topic = await topics.create({ userId: "u", title: "t" });
    await topics.linkRecord(record.id, topic.id);
    const vectorStore = { searchTopics: async () => [], upsertTopic: async () => {}, deleteTopic: async () => {} } as unknown as VectorStore;
    const plan = { actions: [
      { id: "a", type: "merge_record", recordIds: [record.id], targetTopicId: topic.id, facet: "f", point: "p", reason: "补充观点" },
      { id: "b", type: "skip_record", recordIds: [skipped.id], reason: "暂未归入" },
    ] };
    let calls = 0;
    const result = await runContemplateWorkflow({ config: {} as AppConfig, userId: "u", recordRepo: records, topicRepo: topics, taskRepo: tasks, vectorStore,
      complete: async () => ({ stopReason: "stop", text: JSON.stringify(calls++ === 0 ? plan : {
        title: "t", summary: "s", tags: ["t"], content: "updated idea", changeSummary: "补充观点",
      }) }),
    });
    assert.equal(calls, 2);
    assert.equal((await records.findById(record.id))?.status, "organized");
    assert.equal((await records.findById(skipped.id))?.status, "skipped");
    const org = (await records.findById(skipped.id))?.extData?.organization as { taskId: string; reason: string; action: string };
    assert.equal(org.taskId, result.taskId);
    assert.equal(org.action, "skip_record");
    assert.equal(org.reason, "暂未归入");
    const change = (await topics.findById(topic.id))?.extData?.organization as { recordIds: string[]; summary: string };
    assert.deepEqual(change.recordIds, [record.id]);
    assert.equal(change.summary, "补充观点");
    await records.updateContent(record.id, "u", "another update");
    const oldExt = (await records.findById(record.id))?.extData;
    let failureCalls = 0;
    await assert.rejects(runContemplateWorkflow({ config: {} as AppConfig, userId: "u", recordRepo: records, topicRepo: topics, taskRepo: tasks, vectorStore,
      complete: async () => failureCalls++ === 0 ? { stopReason: "stop", text: JSON.stringify(plan) } : { stopReason: "error", text: "", errorMessage: "test failure" },
    }), /test failure/);
    assert.deepEqual((await records.findById(record.id))?.extData, oldExt);
    assert.equal((await records.findById(record.id))?.status, "updated");
    assert.deepEqual((await topics.findTopicsByRecordId(record.id)).map((item) => item.id), [topic.id]);
  } finally { await db.destroy(); }
});
