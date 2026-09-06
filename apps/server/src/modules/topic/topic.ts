/** Topic 实体 */
export interface Topic {
  extData: { [key: string]: unknown } | null;
  id: string;
  userId: string;
  sessionId: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  pendingActions: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}
