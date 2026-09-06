import type { TopicRepository } from "../../../modules/topic/topic.repository.js";
import type { ContemplatePlan, ContemplateWorkflowContext, ValidationResult } from "./schemas.js";

export async function validateContemplatePlan(opts: {
  plan: ContemplatePlan;
  context: ContemplateWorkflowContext;
  topicRepo: TopicRepository;
}): Promise<ValidationResult> {
  const violations: ValidationResult["violations"] = [];
  const recordIds = new Set(opts.context.records.map((record) => record.id));
  const topicIds = new Set(opts.context.topics.map((topic) => topic.id));
  const coveredRecordIds = new Set<string>();
  const recordCoverageActionIds = new Map<string, string>();
  const consumedSourceTopicIds = new Set<string>();
  const archivedTopicIds = new Set(opts.plan.actions.flatMap((action) => action.type === "merge_topic" ? action.sourceTopicIds : []));

  for (const action of opts.plan.actions) {
    if (action.type === "merge_record" || action.type === "merge_topic") {
      if (archivedTopicIds.has(action.targetTopicId)) {
        violations.push({ code: "TARGET_WILL_BE_ARCHIVED", message: `Target "${action.targetTopicId}" is archived by this plan.`, actionId: action.id });
      }
    }
    if (action.type === "merge_record") {
      if (!topicIds.has(action.targetTopicId)) {
        violations.push({ code: "UNKNOWN_TOPIC", message: `Unknown target topic "${action.targetTopicId}".`, actionId: action.id });
      }
      for (const recordId of action.recordIds) {
        addRecordCoverage(recordId, action.id);
      }
    }

    if (action.type === "create_topic") {
      if (!action.boundary.trim()) {
        violations.push({ code: "MISSING_BOUNDARY", message: "create_topic must include boundary.", actionId: action.id });
      }
      for (const recordId of action.recordIds) addRecordCoverage(recordId, action.id);
    }

    if (action.type === "merge_topic") {
      if (!topicIds.has(action.targetTopicId)) {
        violations.push({ code: "UNKNOWN_TOPIC", message: `Unknown target topic "${action.targetTopicId}".`, actionId: action.id });
      }
      for (const sourceTopicId of action.sourceTopicIds) {
        if (sourceTopicId === action.targetTopicId) {
          violations.push({ code: "SELF_MERGE_TOPIC", message: "sourceTopicIds must not include targetTopicId.", actionId: action.id });
        }
        if (!topicIds.has(sourceTopicId)) {
          violations.push({ code: "UNKNOWN_TOPIC", message: `Unknown source topic "${sourceTopicId}".`, actionId: action.id });
        }
        if (consumedSourceTopicIds.has(sourceTopicId)) {
          violations.push({ code: "DUPLICATE_SOURCE_TOPIC", message: `Source topic "${sourceTopicId}" is consumed by multiple merge_topic actions.`, actionId: action.id });
        }
        consumedSourceTopicIds.add(sourceTopicId);
      }
    }

    if (action.type === "skip_record") {
      for (const recordId of action.recordIds) addRecordCoverage(recordId, action.id);
    }
  }

  for (const recordId of recordIds) {
    if (!coveredRecordIds.has(recordId)) {
      violations.push({ code: "UNCOVERED_RECORD", message: `Record "${recordId}" is not covered by any action.` });
    }
  }

  const createCount = opts.plan.actions.filter((action) => action.type === "create_topic").length;
  if (createCount > opts.context.records.length) {
    violations.push({ code: "TOO_MANY_CREATED_TOPICS", message: `Plan creates ${createCount} topics for ${opts.context.records.length} records.` });
  }

  return { passed: violations.length === 0, violations };

  function addRecordCoverage(recordId: string, actionId: string) {
    if (!recordIds.has(recordId)) {
      violations.push({ code: "UNKNOWN_RECORD", message: `Unknown record "${recordId}".`, actionId });
      return;
    }
    coveredRecordIds.add(recordId);
    const existingActionId = recordCoverageActionIds.get(recordId);
    if (existingActionId) {
      violations.push({ code: "DUPLICATE_RECORD_ACTION", message: `Record "${recordId}" is covered by multiple actions.`, actionId });
      return;
    }
    recordCoverageActionIds.set(recordId, actionId);
  }
}
