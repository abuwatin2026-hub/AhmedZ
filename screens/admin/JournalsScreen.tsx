import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import PageLoader from '../../components/PageLoader';
import { useToast } from '../../contexts/ToastContext';
import { Link } from 'react-router-dom';

type JournalRow = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
};

export default function JournalsScreen() {
  const { showNotification } = useToast();
  const supabase = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [draft, setDraft] = useState({ code: '', name: '', description: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('journals')
      .select('id,code,name,description,is_default,is_active,created_at')
      .order('is_default', { ascending: false })
      .order('code', { ascending: true });
    if (error) throw error;
    setRows((Array.isArray(data) ? data : []).map((r: any) => ({
      id: String(r.id),
      code: String(r.code || ''),
      name: String(r.name || ''),
      description: typeof r.description === 'string' ? r.description : null,
      is_default: Boolean(r.is_default),
      is_active: Boolean(r.is_active),
      created_at: String(r.created_at || ''),
    })));
  }, [supabase]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e: any) {
        showNotification(String(e?.message || 'تعذر تحميل دفاتر اليومية'), 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [load, showNotification]);

  const normalizedCode = useMemo(() => String(draft.code || '').trim().toUpperCase(), [draft.code]);
  const canCreate = normalizedCode.length >= 2 && String(draft.name || '').trim().length >= 2;

  const create = async () => {
    if (!supabase) return;
    if (!canCreate) {
      showNotification('أدخل كود واسم صالحين.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('journals').insert({
        id: crypto.randomUUID(),
        code: normalizedCode,
        name: String(draft.name || '').trim(),
        description: String(draft.description || '').trim() || null,
        is_default: false,
        is_active: true,
      });
      if (error) throw error;
      setDraft({ code: '', name: '', description: '' });
      showNotification('تم إنشاء دفتر اليومية.', 'success');
      await load();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر إنشاء دفتر اليومية'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (id: string) => {
    if (!supabase) return;
    try {
      const { error } = await supabase.rpc('set_default_journal', { p_journal_id: id });
      if (error) throw error;
      showNotification('تم تعيين الدفتر الافتراضي.', 'success');
      await load();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر تعيين الافتراضي'), 'error');
    }
  };

  const toggleActive = async (id: string, next: boolean) => {
    if (!supabase) return;
    try {
      const { error } = await supabase.from('journals').update({ is_active: next }).eq('id', id);
      if (error) throw error;
      showNotification(next ? 'تم تفعيل الدفتر.' : 'تم إيقاف الدفتر.', 'success');
      await load();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر تحديث الدفتر'), 'error');
    }
  };

  if (loading) return <PageLoader />;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold dark:text-white">دفاتر اليومية (Journals)</h1>
        <div className="text-sm text-gray-500 dark:text-gray-400">فصل القيود حسب دفتر يومية (مثل: عام/مبيعات/مشتريات/رواتب...)</div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
        <div className="font-semibold mb-3 text-gray-700 dark:text-gray-200">إنشاء دفتر</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input value={draft.code} onChange={(e) => setDraft((p) => ({ ...p, code: e.target.value }))} placeholder="الكود (مثال: SALES)" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
          <input value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} placeholder="الاسم" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
          <input value={draft.description} onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))} placeholder="وصف (اختياري)" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
          <button type="button" onClick={() => void create()} disabled={saving || !canCreate} className="px-4 py-2 rounded bg-emerald-600 text-white font-semibold disabled:opacity-60">
            {saving ? 'جاري الحفظ...' : 'إنشاء'}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto">
        <table className="min-w-[980px] w-full text-right">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الكود</th>
              <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الاسم</th>
              <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الحالة</th>
              <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">افتراضي</th>
              <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-gray-500">لا توجد دفاتر.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{r.code}</td>
                <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{r.name}</td>
                <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{r.is_active ? 'فعّال' : 'موقّف'}</td>
                <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{r.is_default ? 'نعم' : '—'}</td>
                <td className="p-3 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/admin/accounting?jId=${encodeURIComponent(r.id)}`} className="px-3 py-1 rounded bg-amber-600 text-white text-xs font-semibold">
                      التقارير
                    </Link>
                    <button type="button" onClick={() => void setDefault(r.id)} disabled={!r.is_active || r.is_default} className="px-3 py-1 rounded bg-gray-900 text-white text-xs font-semibold disabled:opacity-60">
                      تعيين افتراضي
                    </button>
                    <button type="button" onClick={() => void toggleActive(r.id, !r.is_active)} disabled={r.is_default && r.is_active} className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-semibold disabled:opacity-60">
                      {r.is_active ? 'إيقاف' : 'تفعيل'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
