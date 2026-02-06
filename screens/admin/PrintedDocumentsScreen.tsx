import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';
import PageLoader from '../../components/PageLoader';

type Row = {
  id: string;
  performedAt: string;
  performedBy?: string | null;
  details?: string | null;
  docType?: string | null;
  docNumber?: string | null;
  status?: string | null;
  sourceTable?: string | null;
  sourceId?: string | null;
  template?: string | null;
};

const formatTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('ar-EG-u-nu-latn');
  } catch {
    return iso;
  }
};

export default function PrintedDocumentsScreen() {
  const { showNotification } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(200);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('system_audit_logs')
          .select('id,performed_at,performed_by,details,metadata')
          .eq('module', 'documents')
          .eq('action', 'print')
          .order('performed_at', { ascending: false })
          .limit(Math.max(20, Math.min(1000, Number(limit || 200))));
        if (error) throw error;
        const mapped: Row[] = (Array.isArray(data) ? data : []).map((r: any) => {
          const meta = r?.metadata || {};
          return {
            id: String(r.id),
            performedAt: String(r.performed_at || ''),
            performedBy: r.performed_by ? String(r.performed_by) : null,
            details: typeof r.details === 'string' ? r.details : null,
            docType: typeof meta.docType === 'string' ? meta.docType : null,
            docNumber: typeof meta.docNumber === 'string' ? meta.docNumber : null,
            status: typeof meta.status === 'string' ? meta.status : null,
            sourceTable: typeof meta.sourceTable === 'string' ? meta.sourceTable : null,
            sourceId: typeof meta.sourceId === 'string' ? meta.sourceId : null,
            template: typeof meta.template === 'string' ? meta.template : null,
          };
        });
        if (!cancelled) setRows(mapped);
      } catch (e: any) {
        if (!cancelled) {
          setRows([]);
          showNotification(String(e?.message || 'تعذر تحميل قائمة المستندات المطبوعة'), 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit, showNotification]);

  const filtered = useMemo(() => {
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const hay = [
        r.docType,
        r.docNumber,
        r.status,
        r.sourceTable,
        r.sourceId,
        r.template,
        r.details,
      ].map((x) => String(x || '').toLowerCase()).join(' | ');
      return hay.includes(needle);
    });
  }, [q, rows]);

  if (loading) return <PageLoader />;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">المستندات المطبوعة</h1>
          <div className="text-sm text-gray-500 dark:text-gray-400">سجل طباعة المستندات (Documents Print Audit)</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
            placeholder="بحث: رقم/نوع/حالة/مرجع..."
          />
          <select
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          >
            <option value="100">آخر 100</option>
            <option value="200">آخر 200</option>
            <option value="500">آخر 500</option>
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto">
        <table className="min-w-[1100px] w-full text-right">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الوقت</th>
              <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">النوع</th>
              <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">رقم المستند</th>
              <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الحالة</th>
              <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">المصدر</th>
              <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">القالب</th>
              <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">تفاصيل</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-gray-500">لا توجد سجلات.</td>
              </tr>
            ) : filtered.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="p-3 text-sm text-gray-700 dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{formatTime(r.performedAt)}</td>
                <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{r.docType || '—'}</td>
                <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{r.docNumber || '—'}</td>
                <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{r.status || '—'}</td>
                <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{r.sourceTable ? `${r.sourceTable}:${String(r.sourceId || '').slice(-8)}` : '—'}</td>
                <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{r.template || '—'}</td>
                <td className="p-3 text-sm text-gray-700 dark:text-gray-200">{r.details || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
