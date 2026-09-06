import { useSyncExternalStore } from 'react';
import Capture from '../pages/capture';
import Records from '../pages/records';
import Topics from '../pages/topics';
import RecordDetail from '../pages/record-detail';
import RecordEdit from '../pages/record-edit';
import TopicDetail from '../pages/topic-detail';

const pages = { capture: Capture, records: Records, topics: Topics, 'record-detail': RecordDetail, 'record-edit': RecordEdit, 'topic-detail': TopicDetail };
const subscribe = (listener: () => void) => { window.addEventListener('hashchange', listener); window.addEventListener('popstate', listener); return () => { window.removeEventListener('hashchange', listener); window.removeEventListener('popstate', listener); }; };
export function useRouter() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
  return { page: path || 'capture', params: { id: new URLSearchParams(search).get('id') || '' } };
}
export function go(page: string, id?: string) { const hash = `#/${page}${id ? `?id=${encodeURIComponent(id)}` : ''}`; if (window.location.hash === hash) return; window.history.pushState({ eiko: true }, '', hash); window.dispatchEvent(new HashChangeEvent('hashchange')); window.scrollTo(0, 0); }
export function back(fallback: string) { if (window.history.state?.eiko) window.history.back(); else go(fallback); }
export function Routes() {
  const { page, params } = useRouter();
  const Page = Object.hasOwn(pages, page) ? pages[page as keyof typeof pages] : undefined;
  if (!Page) return <main className="empty"><h1>页面不存在</h1><button className="text-button" onClick={() => go('capture')}>返回捕获</button></main>;
  if (page.endsWith('detail') || page === 'record-edit') {
    if (!params.id) return <main className="empty"><h1>缺少内容编号</h1><button className="text-button" onClick={() => go(page === 'topic-detail' ? 'topics' : 'records')}>返回列表</button></main>;
  }
  return <Page key={`${page}:${params.id}`} />;
}
