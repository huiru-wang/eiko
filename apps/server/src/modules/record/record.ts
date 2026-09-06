/** Record 实体 */
export type RecordStatus = "pending" | "processing" | "organized" | "skipped" | "updated";

export interface Record {
  extData: { [key: string]: unknown } | null;
  id: string;
  userId: string;
  source: string;
  content: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}
