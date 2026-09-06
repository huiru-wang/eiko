/** Topic 仓库端口 */
import type { Topic } from "./topic.js";
import type { Record } from "../record/record.js";

export interface TopicRepository {
  unlinkRecord(recordId: string): Promise<void>;
  create(input: { userId: string; sessionId?: string; title: string }): Promise<Topic>;
  findById(id: string): Promise<Topic | null>;
  findByUserId(userId: string, opts: { cursor?: string; limit: number }): Promise<Topic[]>;
  update(id: string, patch: Partial<Pick<Topic, "title" | "summary" | "content" | "tags" | "status">>): Promise<void>;
  updateStatus(topicId: string, status: "active" | "archived"): Promise<void>;
  linkRecord(recordId: string, topicId: string, relation?: string): Promise<void>;
  moveRecordTopics(sourceTopicId: string, targetTopicId: string): Promise<void>;
  countTopicsByRecordId(recordId: string): Promise<number>;
  findTopicsByRecordId(recordId: string): Promise<Array<{ id: string; title: string }>>;
  findRelatedRecordsByTopicId(topicId: string): Promise<Record[]>;
}
