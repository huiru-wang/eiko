/** Record 仓库端口 */
import type { Record } from "./record.js";

export interface CreateRecordInput {
  userId: string;
  content: string;
  source?: string;
}

export interface RecordRepository {
  create(input: CreateRecordInput): Promise<Record>;
  findById(id: string): Promise<Record | null>;
  findByUserId(userId: string, opts: { cursor?: string; limit: number }): Promise<Record[]>;
  updateStatus(id: string, status: string): Promise<void>;
}
