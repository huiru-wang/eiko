/** Message 实体 */
export interface Message {
  id: number;
  userId: string;
  topicId: string;
  sessionId: string;
  role: string;
  payload: string;
  timestamp: number;
}
