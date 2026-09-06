/** SQLite Message 仓库实现 */
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/schema.js";
import type { MessageRepository } from "../../modules/message/message.repository.js";
import type { Message } from "../../modules/message/message.js";

export class SqliteMessageRepository implements MessageRepository {
  constructor(private db: Kysely<DB>) {}

  async save(input: Omit<Message, "id">): Promise<number> {
    const result = await this.db.insertInto("messages").values({
      user_id: input.userId,
      topic_id: input.topicId,
      session_id: input.sessionId,
      role: input.role,
      payload: input.payload,
      timestamp: input.timestamp,
    }).returning("id").executeTakeFirstOrThrow();
    return result.id;
  }

  async findByTopicId(topicId: string, scope: { userId: string; sessionId: string }): Promise<Message[]> {
    const rows = await this.db
      .selectFrom("messages")
      .selectAll()
      .where("topic_id", "=", topicId)
      .where("user_id", "=", scope.userId)
      .where("session_id", "=", scope.sessionId)
      .orderBy("timestamp", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      topicId: r.topic_id,
      sessionId: r.session_id,
      role: r.role,
      payload: r.payload,
      timestamp: r.timestamp,
    }));
  }
}
