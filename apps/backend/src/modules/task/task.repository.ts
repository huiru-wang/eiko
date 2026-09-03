/** Task 仓库端口 */
import type { Record as UserRecord, RecordStatus } from "../record/record.js";
import type { Task, TaskStatus, TaskType } from "./task.js";

export interface TaskRepository {
  create(input: { userId: string; type: TaskType; input: Record<string, any> }): Promise<Task>;
  createContemplateTaskWithRecords(input: {
    userId: string;
    statuses: RecordStatus[];
    limit: number;
  }): Promise<{ pending: UserRecord[]; task: Task | null }>;
  findById(id: string): Promise<Task | null>;
  findByUserId(userId: string, opts: { limit: number }): Promise<Task[]>;
  update(id: string, patch: Partial<Pick<Task, "result" | "error">> & { status?: TaskStatus }): Promise<void>;
}
