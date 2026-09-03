export type TopicView = {
  id: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  needsOrganize: boolean;
  relatedRecords: Array<{ id: string; text: string; occurredAt: string }>;
  sessionId: string;
  updatedAt: string;
};

export type TopicActionType = 'merge_insight' | 'correct' | 'reorganize';

export type TopicAction = {
  id: string;
  type: TopicActionType;
  content: string;
  createdAt: string;
};
