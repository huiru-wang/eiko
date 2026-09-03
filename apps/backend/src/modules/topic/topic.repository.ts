/** Topic 仓库端口 */
import type { Topic } from "./topic.js";

export interface TopicRepository {
  create(input: { userId: string; sessionId: string; title: string }): Promise<Topic>;
  findById(id: string): Promise<Topic | null>;
  findByUserId(userId: string, opts: { cursor?: string; limit: number }): Promise<Topic[]>;
  update(id: string, patch: Partial<Pick<Topic, "title" | "summary" | "bodyMarkdown" | "tags" | "matchText" | "needsOrganize" | "status">>): Promise<void>;
  linkRecord(recordId: string, topicId: string, relation?: string): Promise<void>;
  findTopicsByRecordId(recordId: string): Promise<Array<{ id: string; title: string }>>;
}
