/** Task 实体 */
export type TaskType = "contemplate" | "topic_organize";
export type TaskStatus = "pending" | "planning" | "executing" | "verifying" | "completed" | "failed";

export interface Task {
  id: string;
  userId: string;
  type: TaskType;
  status: TaskStatus;
  input: Record<string, any> | null;
  result: Record<string, any> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
