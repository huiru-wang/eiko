import type { RecordReadDto } from '@eiko/shared';
import { Layout, ErrorNotice, Loading, More, go } from '../../components/layout';
import { RecordRow } from '../../components/records';
import { useList } from '../../lib/api';
import { uniqueItems } from '../../lib/model';

export default function Records() {
  const query = useList<RecordReadDto>('records');
  const records = uniqueItems(query.data?.pages);
  return <Layout active="records" title="记录" subtitle="你的原始想法，始终留在这里。"><ErrorNotice error={query.error} retry={() => query.refetch()} />{query.isPending ? <Loading /> : !records.length && !query.error ? <div className="empty"><p>还没有记录</p><button className="text-button" onClick={() => go('capture')}>记下第一个念头</button></div> : records.map(record => <RecordRow key={record.id} record={record} />)}<More hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} /></Layout>;
}
