export type MessageRole = 'user' | 'assistant' | 'toolResult';

export type MessageView = {
  id: number;
  sessionId: string;
  topicId: string;
  role: MessageRole;
  content: unknown;
  timestamp: number;
};
