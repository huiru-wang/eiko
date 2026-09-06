/** Record 仓库端口 */
import type { Record, RecordStatus } from "./record.js";

export interface CreateRecordInput {
  userId: string;
  content: string;
  source?: string;
}

export interface RecordRepository {
  findTopicLinks(userId: string, recordIds: string[]): Promise<Array<{ recordId: string; id: string; title: string; status: string }>>;
  updateContent(id: string, userId: string, content: string): Promise<{ record: Record; changed: boolean } | "not_found" | "processing">;
  create(input: CreateRecordInput): Promise<Record>;
  createMany(inputs: CreateRecordInput[]): Promise<Record[]>;
  findById(id: string): Promise<Record | null>;
  findByUserId(userId: string, opts: { cursor?: string; topicId?: string; limit: number }): Promise<Record[]>;
  findProcessableByUserId(userId: string, opts: { statuses: RecordStatus[]; limit: number }): Promise<Record[]>;
  updateStatus(id: string, status: RecordStatus): Promise<void>;
  updateManyStatus(ids: string[], status: RecordStatus): Promise<void>;
}
