export type TopicView = {
  extData: { [key: string]: unknown } | null;
  id: string;
  title: string;
  summary: string;
  content: string;
  relatedRecords: Array<{ id: string; text: string; createdAt: string }>;
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
