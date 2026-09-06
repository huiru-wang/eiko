import { ArrowLeft, Feather, Layers, AudioLines } from 'lucide-react';
import type { PropsWithChildren, ReactNode } from 'react';
import { useWorkspace } from '../lib/state';
import { go, back } from '../lib/router';
export { go, back } from '../lib/router';

export function Layout({ active, title, subtitle, headerMeta, children, detail = false, showBack = detail }: PropsWithChildren<{ active: 'capture' | 'records' | 'topics'; title: string; subtitle?: string; headerMeta?: ReactNode; detail?: boolean; showBack?: boolean }>) {
  const { organizing } = useWorkspace();
  return <div className="workspace">
    <main className={`main ${active === 'capture' ? 'capture-main' : ''} ${detail ? 'detail-main' : ''}`}>
      {showBack && <div className="detail-nav"><button className="icon-button" aria-label="返回" onClick={() => back(active)}><ArrowLeft size={21} /></button><span>{active === 'topics' ? '回声' : '记录'}</span></div>}
      <header className={`page-header ${detail ? 'detail-page-header' : 'primary-page-header'}`}><div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}{headerMeta}</div>{active === 'capture' && <span className="wordmark">eiko<span className="brand-dot">.</span></span>}</header>
      {children}
    </main>
    <nav className="bottom-nav" aria-label="主导航">{([['capture', '捕获', Feather], ['records', '记录', Layers], ['topics', '回声', AudioLines]] as const).map(([page, label, Icon]) => <button key={page} className={`nav-item ${active === page ? 'active' : ''}`} aria-current={active === page ? 'page' : undefined} onClick={() => go(page)}><Icon size={21} strokeWidth={1.6} /><span>{label}</span>{page === 'topics' && organizing && <i className="running-dot" />}</button>)}</nav>
  </div>;
}
export function ErrorNotice({ error, retry }: { error: Error | null; retry?: () => void }) { return error ? <div className="notice error" role="alert"><span>{error.message}</span>{retry && <button onClick={retry}>重试</button>}</div> : null; }
export function Loading() { return <div className="empty" role="status">正在读取…</div>; }
export function More({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) { return hasMore ? <button className="load-more" disabled={loading} onClick={onClick}>{loading ? '加载中…' : '加载更多'}</button> : null; }
