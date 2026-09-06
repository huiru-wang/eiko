import { useRouter } from '../../lib/router';
import { Pencil } from 'lucide-react';
import { Layout, Loading, ErrorNotice, go } from '../../components/layout';
import { OrganizationNote } from '../../components/records';
import { useRecord } from '../../lib/api';
import { formatTime, statusLabels } from '../../lib/model';

export default function RecordDetail() {
  const id = useRouter().params.id || '';
  const query = useRecord(id);
  const record = query.data;
  return <Layout active="records" title="原始记录" detail><ErrorNotice error={query.error} retry={() => query.refetch()} />{query.isPending ? <Loading /> : record && <><div className="detail-toolbar"><div className="row-meta"><time>{formatTime(record.createdAt)}</time><span className={`status status-${record.status}`}>{statusLabels[record.status]}</span></div><button className="text-button" disabled={record.status === 'processing'} onClick={() => go('record-edit', id)}><Pencil size={16} />编辑</button></div><div className="original-text">{record.content}</div><OrganizationNote record={record} /></>}</Layout>;
}
