import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageLoader from '../../../components/PageLoader';
import { useToast } from '../../../contexts/ToastContext';
import { getSupabaseClient } from '../../../supabase';

type JournalRow = {
  id: string;
  code: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
};

export default function FinancialReportsByJournal() {
  const supabase = getSupabaseClient();
  const { showNotification } = useToast();
  const [loading, setLoading] = useState(true);
  const [journals, setJournals] = useState<JournalRow[]>([]);

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('journals')
          .select('id,code,name,is_default,is_active')
          .order('is_default', { ascending: false })
          .order('code', { ascending: true });
        if (error) throw error;
        setJournals((Array.isArray(data) ? data : []).map((r: any) => ({
          id: String(r.id),
          code: String(r.code || ''),
          name: String(r.name || ''),
          is_default: Boolean(r.is_default),
          is_active: Boolean(r.is_active),
        })));
      } catch (e: any) {
        showNotification(String(e?.message || 'تعذر تحميل دفاتر اليومية'), 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [showNotification, supabase]);

  const active = useMemo(() => journals.filter(j => j.is_active), [journals]);
  const inactive = useMemo(() => journals.filter(j => !j.is_active), [journals]);

  if (loading) return <PageLoader />;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold dark:text-white">التقارير المالية حسب دفتر اليومية</h1>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          افتح نفس شاشة التقارير المالية مع تطبيق فلتر دفتر اليومية مباشرةً.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {active.map((j) => (
          <div key={j.id} className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-mono text-gray-700 dark:text-gray-200" dir="ltr">{j.code}</div>
                <div className="text-lg font-bold text-gray-900 dark:text-white">{j.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{j.is_default ? 'الدفتر الافتراضي' : '—'}</div>
              </div>
              <Link
                to={`/admin/accounting?jId=${encodeURIComponent(j.id)}`}
                className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold"
              >
                فتح التقارير
              </Link>
            </div>
          </div>
        ))}
      </div>

      {inactive.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">دفاتر موقّفة</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {inactive.map((j) => (
              <div key={j.id} className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4 opacity-70">
                <div className="text-sm font-mono text-gray-700 dark:text-gray-200" dir="ltr">{j.code}</div>
                <div className="text-lg font-bold text-gray-900 dark:text-white">{j.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">موقّف</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

