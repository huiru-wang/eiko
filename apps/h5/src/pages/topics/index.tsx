import { ArrowUpRight } from 'lucide-react';
import type { TopicDto } from '@eiko/shared';
import { Layout, ErrorNotice, Loading, More, go } from '../../components/layout';
import { useList } from '../../lib/api';
import { uniqueItems, organization, formatTime } from '../../lib/model';
import { useWorkspace } from '../../lib/state';

export default function Topics() {
  const query = useList<TopicDto>('topics');
  const topics = uniqueItems(query.data?.pages);
  const { unread } = useWorkspace();
  return <Layout active="topics" title="回声" subtitle="零散的想法，逐渐有了联系。">
    <ErrorNotice error={query.error} retry={() => query.refetch()} />
    {query.isPending ? <Loading /> : !topics.length && !query.error ? <div className="empty"><p>回声还在酝酿</p><span className="muted">有了记录，再来整理。</span></div> : <div className="topic-list">{topics.map(topic => {
      const org = organization(topic.extData);
      return <article className="topic-row" key={topic.id}><div className="row-meta"><time>{formatTime(topic.updatedAt)}</time>{org && unread(topic.id, org.taskId) && <span className="unread"><i />有新变化</span>}</div>
        <button className="topic-title" onClick={() => go('topic-detail', topic.id)}><h2>{topic.title}</h2><ArrowUpRight size={20} /></button><p className="topic-summary">{topic.summary}</p>
        {org?.summary && <div className="latest"><span className="eyebrow">最近变化</span><p>{org.summary}</p>{org.recordIds.length > 0 && <span className="muted small">本次涉及 {org.recordIds.length} 条记录</span>}</div>}
        <div className="tags">{topic.tags.slice(0, 4).map(tag => <span key={tag}>#{tag}</span>)}</div>
      </article>;
    })}</div>}
    <More hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
  </Layout>;
}
