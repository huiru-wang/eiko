export type RecordStatus = 'pending' | 'processing' | 'digested';

export type RecordView = {
  id: string;
  text: string;
  status: RecordStatus;
  topics: Array<{ id: string; title: string }>;
  occurredAt: string;
};
