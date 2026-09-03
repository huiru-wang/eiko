/** Topic 实体 */
export interface Topic {
  id: string;
  userId: string;
  sessionId: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  tags: string[];
  matchText: string;
  pendingActions: string;
  needsOrganize: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
}
