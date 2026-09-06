import { useRouter } from '../../lib/router';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import type { RecordReadDto } from '@eiko/shared';
import { Layout, Loading, ErrorNotice, back } from '../../components/layout';
import { updateRecord, useRecord } from '../../lib/api';
import { readStorage, writeStorage } from '../../lib/state';

function Editor({ record }: { record: RecordReadDto }) {
  const key = `edit:${record.id}`;
  const [content, setContent] = useState(() => { const saved = readStorage(key); try { const draft = JSON.parse(saved); return draft && draft.base === record.updatedAt && typeof draft.content === 'string' ? draft.content : record.content; } catch { return record.content; } });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const lock = useRef(false);
  const client = useQueryClient();
  async function save() {
    if (lock.current || !content.trim()) return;
    if (content.trim() === record.content) { back('records'); return; }
    lock.current = true; setSaving(true); setError(null);
    try { await updateRecord(record.id, content.trim()); writeStorage(key, ''); await client.invalidateQueries({ queryKey: ['records'] }); back('records'); }
    catch (e) { setError(e as Error); } finally { lock.current = false; setSaving(false); }
  }
  return <><textarea aria-label="编辑原始记录" className="edit-input" value={content} disabled={saving || record.status === 'processing'} onChange={e => { setContent(e.target.value); writeStorage(key, JSON.stringify({ base: record.updatedAt, content: e.target.value })); }} /><p className="muted small">修改后将等待重新整理，上次整理结果会暂时保留。</p>{record.status === 'processing' && <p role="status">正在整理，请稍后再试。</p>}<ErrorNotice error={error} /><div className="edit-actions"><button className="secondary" disabled={saving} onClick={() => back('records')}>取消</button><button className="primary" disabled={saving || !content.trim() || record.status === 'processing'} onClick={save}><Check size={17} />{saving ? '保存中…' : '保存'}</button></div></>;
}
export default function RecordEdit() { const query = useRecord(useRouter().params.id || ''); return <Layout active="records" title="编辑记录" detail><ErrorNotice error={query.error} retry={() => query.refetch()} />{query.isPending ? <Loading /> : query.data && <Editor record={query.data} />}</Layout>; }
