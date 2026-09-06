import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppConfig } from "../../../env.js";
import type { TopicRepository } from "../../../modules/topic/topic.repository.js";
import { assertContemplatePlan, type ContemplateWorkflowContext } from "./schemas.js";
import { planContemplate } from "./planner.js";
import { type JsonAttempt, runJsonStep } from "./llm-json.js";
import { validateContemplatePlan } from "./plan-validator.js";
import { executeContemplatePlan } from "./executor.js";

const context: ContemplateWorkflowContext = {
  taskId: "test-task", userId: "test-user",
  records: ["r1", "r2"].map((id) => ({ id, content: id, status: "pending", createdAt: "2026-09-05" })),
  topics: ["t1", "t2"].map((id) => ({ id, title: id, summary: "", content: "", tags: [], status: "active", updatedAt: "2026-09-05" })),
  relatedRecordsByTopicId: {},
};
const topicRepo = { countTopicsByRecordId: async () => 0 } as unknown as TopicRepository;
const config = {} as AppConfig;
const skip = { id: "a1", type: "skip_record", recordIds: ["r1", "r2"], reason: "temporary" };
const valid = JSON.stringify({ actions: [skip] });

test("rejects empty and duplicate IDs and legacy skip field", () => {
  for (const recordIds of [[], ["r1", "r1"], ["r1", " r1 "]]) {
    assert.throws(() => assertContemplatePlan({ actions: [{ ...skip, recordIds }] }));
  }
  assert.throws(() => assertContemplatePlan({ actions: [{ ...skip, recordIds: undefined, recordId: "r1" }] }));
});

test("rejects uncovered, unknown and multiply covered records", async () => {
  for (const [actions, expected] of [
    [[{ ...skip, recordIds: ["r1"] }], "UNCOVERED_RECORD"],
    [[{ ...skip, recordIds: ["r1", "r2", "unknown"] }], "UNKNOWN_RECORD"],
    [[skip, { ...skip, id: "a2" }], "DUPLICATE_RECORD_ACTION"],
  ] as const) {
    const validation = await validateContemplatePlan({ plan: assertContemplatePlan({ actions }), context, topicRepo });
    assert.ok(validation.violations.some((item) => item.code === expected));
  }
});

test("rejects writing to an archived target regardless of action order", async () => {
  const actions = [
    { id: "merge", type: "merge_record", recordIds: ["r1", "r2"], targetTopicId: "t1", facet: "x", point: "x", reason: "x" },
    { id: "archive", type: "merge_topic", targetTopicId: "t2", sourceTopicIds: ["t1"], reason: "x" },
  ];
  for (const ordered of [actions, [...actions].reverse()]) {
    const result = await validateContemplatePlan({ plan: assertContemplatePlan({ actions: ordered }), context, topicRepo });
    assert.ok(result.violations.some((item) => item.code === "TARGET_WILL_BE_ARCHIVED"));
  }
});

test("batch skip expands to per-record results without topic writes", async () => {
  const execution = await executeContemplatePlan({ taskId: "test", userId: "test", records: [],
    plan: assertContemplatePlan({ actions: [skip] }), topicRepo: {} as TopicRepository });
  assert.deepEqual(execution.skipped, [{ recordId: "r1", reason: "temporary" }, { recordId: "r2", reason: "temporary" }]);
  assert.deepEqual(execution.affectedTopicIds, []);
});

for (const [first, code] of [
  ["{", "JSON_PARSE_ERROR"],
  [JSON.stringify({ actions: [{ ...skip, recordIds: undefined, recordId: "r1" }] }), "ACTION_SCHEMA_ERROR"],
  [JSON.stringify({ actions: [{ ...skip, recordIds: ["r1"] }] }), "PLAN_VALIDATION_ERROR"],
]) {
  test(`repairs ${code} once and persists both attempts`, async () => {
    const attempts: JsonAttempt[] = [];
    const prompts: string[] = [];
    const result = await planContemplate({ config, context, topicRepo,
      onAttempt: async (attempt) => { attempts.push(attempt); },
      complete: async (prompt) => { prompts.push(prompt); return { text: prompts.length === 1 ? first : valid, stopReason: "stop" }; },
    });
    assert.equal(prompts.length, 2);
    assert.equal(attempts[0].errorCode, code);
    assert.equal(attempts[0].output, first);
    assert.equal(attempts[1].passed, true);
    assert.ok(prompts[1].includes(JSON.stringify(first)));
    if (code === "ACTION_SCHEMA_ERROR") assert.equal(attempts[0].failedActions?.length, 1);
    assert.deepEqual(result.actions, [skip]);
  });
}

test("schema and business errors share one retry budget", async () => {
  const attempts: JsonAttempt[] = [];
  await assert.rejects(planContemplate({ config, context, topicRepo,
    onAttempt: async (attempt) => { attempts.push(attempt); },
    complete: async () => ({ text: attempts.length === 0 ? "{}" : '{"actions":[]}', stopReason: "stop" }),
  }), /PLAN_VALIDATION_ERROR/);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].errorCode, "ACTION_SCHEMA_ERROR");
});

test("truncation and provider errors fail without correction", async () => {
  for (const [stopReason, code] of [["length", "OUTPUT_TRUNCATED"], ["error", "MODEL_ERROR"]]) {
    const attempts: JsonAttempt[] = [];
    await assert.rejects(planContemplate({ config, context, topicRepo,
      onAttempt: async (attempt) => { attempts.push(attempt); },
      complete: async () => ({ text: valid, stopReason }),
    }), new RegExp(code));
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].stopReason, stopReason);
  }
});

test("valid output uses one call and diagnostic persistence failure does not retry", async () => {
  let calls = 0;
  await assert.rejects(runJsonStep({ config, taskId: "test", step: "plan", prompt: "test", maxAttempts: 2,
    validate: assertContemplatePlan,
    complete: async () => { calls++; return { text: valid, stopReason: "stop" }; },
    onAttempt: async () => { throw new Error("storage failed"); },
  }), /storage failed/);
  assert.equal(calls, 1);
});
