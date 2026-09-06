import type { RecordReadDto } from '@fanto/shared';
import { ArrowUpRight } from 'lucide-react';
import { formatTime, organization, statusLabels } from '../lib/model';
import { go } from './layout';

export function RecordRow({ record }: { record: RecordReadDto }) {
  return <article className="record-row">
    <button className="record-content" onClick={() => go('record-detail', record.id)}>{record.content}</button>
    <div className="record-meta"><time>{formatTime(record.createdAt)}</time><span className={`status status-${record.status}`}>{statusLabels[record.status] || record.status}</span><TopicLinks topics={record.topics} /></div>
  </article>;
}
export function RelatedRecordRow({ record }: { record: RecordReadDto }) {
  return <article className="related-record-row"><time>{formatTime(record.createdAt)}</time><p>{record.content}</p></article>;
}
export function TopicLinks({ topics }: { topics: RecordReadDto['topics'] }) { return topics.length ? <div className="topic-links">{topics.map(topic => <button className="topic-link" key={topic.id} onClick={() => go('topic-detail', topic.id)}><ArrowUpRight size={14} /><span>{topic.title}{topic.status === 'archived' ? ' · 已归档' : ''}</span></button>)}</div> : null; }
export function OrganizationNote({ record }: { record: RecordReadDto }) {
  const org = organization(record.extData);
  const previous = record.status === 'updated' || record.status === 'processing';
  const actions: Record<string, string> = { merge_record: '归入已有话题', create_topic: '形成新话题', skip_record: '暂未归入话题' };
  return <section className="section organization"><h2>{previous ? '上次整理' : '整理说明'}</h2>{org ? <><div className="row-meta"><span className="accent">{actions[org.action] || '已整理'}</span><time>{formatTime(org.organizedAt)}</time></div><p>{org.reason || '暂无整理说明'}</p>{previous && <p className="muted small">当前内容尚未完成本轮整理，以下关联可能来自上次整理。</p>}</> : <p className="muted">暂无整理说明</p>}<TopicLinks topics={record.topics} /></section>;
}
