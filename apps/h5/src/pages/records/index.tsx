import type { RecordReadDto } from '@fanto/shared';
import { Layout, ErrorNotice, Loading, More } from '../../components/layout';
import { RecordRow } from '../../components/records';
import { useList } from '../../lib/api';
import { uniqueItems } from '../../lib/model';

export default function Records() {
  const query = useList<RecordReadDto>('records');
  const records = uniqueItems(query.data?.pages);
  return <Layout active="records" title="记录" subtitle="每一条想法，都是正在被收下的一根线。"><ErrorNotice error={query.error} retry={() => query.refetch()} />{query.isPending ? <Loading /> : !records.length && !query.error ? <div className="empty"><p>还没有记录</p><span className="muted">点击底部 + 号，收下第一根线。</span></div> : <div className="record-timeline">{records.map(record => <RecordRow key={record.id} record={record} />)}</div>}<More hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} /></Layout>;
}
