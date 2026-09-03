/** Record 实体 */
export type RecordStatus = "pending" | "processing" | "organized" | "skipped" | "updated";

export interface Record {
  id: string;
  userId: string;
  source: string;
  content: string;
  status: RecordStatus;
  digestResult: string | null;
  digestVersion: string | null;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}
