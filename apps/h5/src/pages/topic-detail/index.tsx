import { useEffect, useState } from 'react';
import { useRouter } from '../../lib/router';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { RecordReadDto } from '@fanto/shared';
import { Layout, ErrorNotice, Loading, More } from '../../components/layout';
import { RelatedRecordRow } from '../../components/records';
import { useTopic, useList } from '../../lib/api';
import { uniqueItems, organization, formatTime } from '../../lib/model';
import { useWorkspace } from '../../lib/state';
import { Markdown } from '../../components/markdown';

function RelatedRecords({ id }: { id: string }) {
  const [open, setOpen] = useState(true);
  const query = useList<RecordReadDto>('records', id);
  const records = uniqueItems(query.data?.pages);
  return <section id="related-records" className="section related"><button className="related-toggle" aria-expanded={open} aria-controls="related-content" onClick={() => setOpen(!open)}><span>相关原始记录</span>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button><div id="related-content" hidden={!open} className="related-scroll"><ErrorNotice error={query.error} retry={() => query.refetch()} />{query.isPending ? <Loading /> : !records.length && !query.error ? <p className="muted">暂无关联记录</p> : records.map(record => <RelatedRecordRow key={record.id} record={record} />)}<More hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} /></div></section>;
}
export default function TopicDetail() {
  const id = useRouter().params.id || '';
  const query = useTopic(id);
  const topic = query.data;
  const org = organization(topic?.extData || null);
  const { markRead } = useWorkspace();
  useEffect(() => { if (org?.taskId) markRead(id, org.taskId); }, [id, org?.taskId]);
  const headerMeta = topic && <div className="topic-detail-meta"><time>更新于 {formatTime(topic.updatedAt)}</time><span className="tags">{topic.tags.map(tag => <span key={tag}>#{tag}</span>)}</span></div>;
  return <Layout active="topics" title={topic?.title || '话题'} headerMeta={headerMeta} detail showBack={false}><ErrorNotice error={query.error} retry={() => query.refetch()} />{query.isPending ? <Loading /> : topic && <>
    {topic.status === 'archived' && <div className="notice">此话题已归档，保留内容供回看。</div>}
    <p className="detail-summary">{topic.summary}</p><RelatedRecords id={id} />
    {org?.summary && <section className="latest detail-latest">
      <span className="eyebrow">最近变化</span><p>{org.summary}</p><div className="row-meta"><time>{formatTime(org.organizedAt)}</time>{org.recordIds.length > 0 && <span>本次涉及 {org.recordIds.length} 条记录</span>}</div></section>}
    <Markdown content={topic.content} />
  </>}</Layout>;
}
