export type RecordStatus = 'pending' | 'processing' | 'organized' | 'skipped' | 'updated';

export type RecordView = {
  extData: { [key: string]: unknown } | null;
  id: string;
  text: string;
  status: RecordStatus;
  topics: Array<{ id: string; title: string }>;
  createdAt: string;
};
