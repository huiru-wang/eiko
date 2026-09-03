/**
 * Kysely Database 类型定义。
 */

import type { Generated, Insertable, Selectable, Updateable } from "kysely";

// ─── users ──────────────────────────────────────────────────────

export interface UsersTable {
  id: string;
  wx_openid: string;
  created_at: string;
}

// ─── records ────────────────────────────────────────────────────

export interface RecordsTable {
  id: string;
  user_id: string;
  source: string;
  content: string;
  status: string;
  digest_result: string | null;
  digest_version: string | null;
  occurred_at: string;
  created_at: string;
  updated_at: string;
}

// ─── topics ─────────────────────────────────────────────────────

export interface TopicsTable {
  id: string;
  user_id: string;
  session_id: string;
  title: string;
  summary: string;
  body_markdown: string;
  tags: string;
  match_text: string;
  pending_actions: string;
  needs_organize: number;
  status: string;
  created_at: string;
  updated_at: string;
}

// ─── record_topics ──────────────────────────────────────────────

export interface RecordTopicsTable {
  record_id: string;
  topic_id: string;
  relation: string;
  created_at: string;
}

// ─── messages ───────────────────────────────────────────────────

export interface MessagesTable {
  id: Generated<number>;
  user_id: string;
  topic_id: string;
  session_id: string;
  role: string;
  payload: string;
  timestamp: number;
}

// ─── tasks ──────────────────────────────────────────────────────

export interface TasksTable {
  id: string;
  user_id: string;
  type: string;
  status: string;
  input: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// ─── DB ─────────────────────────────────────────────────────────

export interface DB {
  users: UsersTable;
  records: RecordsTable;
  topics: TopicsTable;
  record_topics: RecordTopicsTable;
  messages: MessagesTable;
  tasks: TasksTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

export type Record = Selectable<RecordsTable>;
export type NewRecord = Insertable<RecordsTable>;
export type RecordUpdate = Updateable<RecordsTable>;

export type Topic = Selectable<TopicsTable>;
export type NewTopic = Insertable<TopicsTable>;
export type TopicUpdate = Updateable<TopicsTable>;

export type RecordTopic = Selectable<RecordTopicsTable>;
export type NewRecordTopic = Insertable<RecordTopicsTable>;

export type Message = Selectable<MessagesTable>;
export type NewMessage = Insertable<MessagesTable>;

export type Task = Selectable<TasksTable>;
export type NewTask = Insertable<TasksTable>;
