/** Message 仓库端口 */
import type { Message } from "./message.js";

export interface MessageRepository {
  save(input: Omit<Message, "id">): Promise<number>;
  findByTopicId(topicId: string, scope: { userId: string; sessionId: string }): Promise<Message[]>;
}
