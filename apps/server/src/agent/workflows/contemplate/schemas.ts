import type { Record as UserRecord } from "../../../modules/record/record.js";
import type { Topic } from "../../../modules/topic/topic.js";

export const WORKFLOW_VERSION = "contemplate-workflow-v2.2-simple";

export interface ContemplateWorkflowContext {
  taskId: string;
  userId: string;
  records: Array<Pick<UserRecord, "id" | "content" | "status" | "createdAt">>;
  topics: Array<Pick<Topic, "id" | "title" | "summary" | "content" | "tags" | "status" | "updatedAt">>;
  relatedRecordsByTopicId: Record<string, Array<Pick<UserRecord, "id" | "content" | "createdAt">>>;
}

export type ContemplateAction =
  | {
      id: string;
      type: "merge_record";
      recordIds: string[];
      targetTopicId: string;
      facet: string;
      point: string;
      reason: string;
    }
  | {
      id: string;
      type: "create_topic";
      recordIds: string[];
      title: string;
      boundary: string;
      point: string;
      reason: string;
    }
  | {
      id: string;
      type: "merge_topic";
      targetTopicId: string;
      sourceTopicIds: string[];
      newTitle?: string;
      reason: string;
    }
  | {
      id: string;
      type: "skip_record";
      recordIds: string[];
      reason: string;
    };

export interface ContemplatePlan {
  actions: ContemplateAction[];
}

export interface TopicRewriteResult {
  changeSummary: string;
  title: string;
  summary: string;
  tags: string[];
  content: string;
}

export interface ValidationResult {
  passed: boolean;
  violations: Array<{ code: string; message: string; actionId?: string }>;
}

export interface ExecuteResult {
  affectedTopicIds: string[];
  sourceTopicsByTargetId: Record<string, Topic[]>;
  recordsByTopicId: Record<string, UserRecord[]>;
  organizedRecordIds: string[];
  skipped: Array<{ recordId: string; reason: string }>;
  actions: Record<string, { status: "done" | "failed"; details?: unknown; error?: string }>;
}

export function assertContemplatePlan(value: unknown): ContemplatePlan {
  if (!isObject(value) || !Array.isArray(value.actions)) {
    throw new Error("Plan must be an object with actions array.");
  }

  const ids = new Set<string>();
  const actions: ContemplateAction[] = value.actions.map((action, index) => {
    if (!isObject(action)) throw new Error(`actions[${index}] must be an object.`);
    const id = readString(action, "id", `actions[${index}]`);
    if (ids.has(id)) throw new Error(`Duplicate action id "${id}".`);
    ids.add(id);

    const type = readString(action, "type", `actions[${index}]`);
    if (type === "merge_record") {
      return {
        id,
        type: "merge_record",
        recordIds: readStringArray(action, "recordIds", id),
        targetTopicId: readString(action, "targetTopicId", id),
        facet: readString(action, "facet", id),
        point: readString(action, "point", id),
        reason: readString(action, "reason", id),
      };
    }
    if (type === "create_topic") {
      return {
        id,
        type: "create_topic",
        recordIds: readStringArray(action, "recordIds", id),
        title: readString(action, "title", id),
        boundary: readString(action, "boundary", id),
        point: readString(action, "point", id),
        reason: readString(action, "reason", id),
      };
    }
    if (type === "merge_topic") {
      return {
        id,
        type: "merge_topic",
        targetTopicId: readString(action, "targetTopicId", id),
        sourceTopicIds: readStringArray(action, "sourceTopicIds", id),
        newTitle: typeof action.newTitle === "string" && action.newTitle.trim() ? action.newTitle : undefined,
        reason: readString(action, "reason", id),
      };
    }
    if (type === "skip_record") {
      return {
        id,
        type: "skip_record",
        recordIds: readStringArray(action, "recordIds", id),
        reason: readString(action, "reason", id),
      };
    }

    throw new Error(`Unsupported action type "${type}" at actions[${index}].`);
  });

  return { actions };
}

export function assertTopicRewriteResult(value: unknown): TopicRewriteResult {
  if (!isObject(value)) throw new Error("Rewrite result must be an object.");
  const title = readString(value, "title", "rewrite");
  const summary = readString(value, "summary", "rewrite");
  const tags = readStringArray(value, "tags", "rewrite");
  const content = readString(value, "content", "rewrite");
  const changeSummary = readString(value, "changeSummary", "rewrite");
  return { title, summary, tags, content, changeSummary };
}

function readString(value: Record<string, unknown>, key: string, scope: string) {
  const field = value[key];
  if (typeof field !== "string" || !field.trim()) {
    throw new Error(`${scope}.${key} must be a non-empty string.`);
  }
  return field.trim();
}

function readStringArray(value: Record<string, unknown>, key: string, scope: string) {
  const field = value[key];
  if (!Array.isArray(field) || field.length === 0 || field.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${scope}.${key} must be a non-empty string array.`);
  }
  const values = field.map((item) => item.trim());
  if (new Set(values).size !== values.length) throw new Error(`${scope}.${key} must not contain duplicate values.`);
  return values;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
