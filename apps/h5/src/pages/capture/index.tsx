import { useRef, useState } from 'react';
import { ArrowUp, ArrowRight, Feather } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Layout, go, ErrorNotice } from '../../components/layout';
import { createRecord } from '../../lib/api';
import { readStorage, writeStorage } from '../../lib/state';
import { afterSave } from '../../lib/model';

export default function Capture() {
  const [draft, setDraft] = useState(() => readStorage('capture'));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const lock = useRef(false);
  const current = useRef(draft);
  const client = useQueryClient();
  function change(value: string) { current.current = value; setDraft(value); if (!writeStorage('capture', value)) setMessage('草稿暂时无法保存到本设备，请勿关闭页面。'); }
  async function save() {
    if (lock.current || !current.current.trim()) return;
    const submitted = current.current;
    lock.current = true; setSaving(true); setError(null); setMessage('');
    try {
      await createRecord(submitted.trim());
      change(afterSave(current.current, submitted)); setMessage('已记录，等待整理成新的回声。');
      await client.invalidateQueries({ queryKey: ['records'] });
    } catch (e) { setError(e as Error); }
    finally { lock.current = false; setSaving(false); }
  }
  return <Layout active="capture" title="捕获" subtitle={new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}>
    <div className="capture-intro"><span className="capture-emblem"><Feather size={32} strokeWidth={1.2} /></span><p>让想法先留下来。</p><span>不必完整，也不用急着想清楚。</span></div><section className="composer"><label className="composer-label" htmlFor="capture">此刻，想记下什么？</label>
      <textarea id="capture" className="capture-input" autoFocus placeholder="一个念头、一段观察，或还没想清楚的事…" value={draft} onChange={e => change(e.target.value)} />
      <div className="composer-footer"><span className="muted small">{draft.length ? `${draft.length} 字` : '随手记下就好'}</span><button className="primary" disabled={saving || !draft.trim()} onClick={save}><span>{saving ? '保存中…' : '记录'}</span><ArrowUp size={18} /></button></div>
    </section>
    <div className="save-status" role="status">{message}</div><ErrorNotice error={error} />
    {error && <button className="text-button" onClick={() => go('records')}>查看记录<ArrowRight size={16} /></button>}
    <div className="capture-bottom"><span className="quiet-line" /><span>每一个念头，都有回响。</span></div>
  </Layout>;
}
