import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';

type FxRateRow = {
  id: string;
  currency_code: string;
  rate: number;
  rate_date: string;
  rate_type: 'operational' | 'accounting';
};

type CurrencyRow = {
  code: string;
  is_base?: boolean;
  is_high_inflation?: boolean;
};

const toDateInput = (d: Date) => d.toISOString().slice(0, 10);

const FxRatesScreen: React.FC = () => {
  const { showNotification } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [rates, setRates] = useState<FxRateRow[]>([]);
  const [auditRows, setAuditRows] = useState<Array<{ id: string; action: string; details: string; performed_at: string; performed_by: string | null }>>([]);

  const [filterCurrency, setFilterCurrency] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'operational' | 'accounting'>('all');

  const [formCurrency, setFormCurrency] = useState<string>('');
  const [formType, setFormType] = useState<'operational' | 'accounting'>('operational');
  const [formDate, setFormDate] = useState<string>(() => toDateInput(new Date()));
  const [formRate, setFormRate] = useState<string>('1');

  const baseCurrency = useMemo(() => currencies.find(c => c.is_base)?.code?.toUpperCase() || '', [currencies]);
  const baseIsHighInflation = useMemo(() => {
    const row = currencies.find(c => c.is_base);
    return Boolean(row?.is_high_inflation);
  }, [currencies]);

  const loadAll = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: cur, error: curErr } = await supabase
        .from('currencies')
        .select('code,is_base,is_high_inflation')
        .order('code', { ascending: true });
      if (curErr) throw curErr;
      const list = (Array.isArray(cur) ? cur : []).map((r: any) => ({
        code: String(r.code || '').toUpperCase(),
        is_base: Boolean(r.is_base),
        is_high_inflation: Boolean(r.is_high_inflation),
      })).filter(r => r.code);
      setCurrencies(list);

      const { data: rows, error: rowsErr } = await supabase
        .from('fx_rates')
        .select('id,currency_code,rate,rate_date,rate_type')
        .order('rate_date', { ascending: false })
        .limit(500);
      if (rowsErr) throw rowsErr;
      setRates((Array.isArray(rows) ? rows : []).map((r: any) => ({
        id: String(r.id),
        currency_code: String(r.currency_code || '').toUpperCase(),
        rate: Number(r.rate) || 0,
        rate_date: String(r.rate_date || ''),
        rate_type: (String(r.rate_type || 'operational') === 'accounting' ? 'accounting' : 'operational') as any,
      })));

      const { data: logs, error: logsErr } = await supabase
        .from('system_audit_logs')
        .select('id,action,details,performed_at,performed_by,module')
        .eq('module', 'fx_rates')
        .order('performed_at', { ascending: false })
        .limit(50);
      if (logsErr) throw logsErr;
      setAuditRows((Array.isArray(logs) ? logs : []).map((l: any) => ({
        id: String(l.id),
        action: String(l.action || ''),
        details: String(l.details || ''),
        performed_at: String(l.performed_at || ''),
        performed_by: l.performed_by ? String(l.performed_by) : null,
      })));

      if (!formCurrency) {
        const first = list[0]?.code || '';
        setFormCurrency(first);
      }
    } catch (err: any) {
      showNotification(String(err?.message || 'تعذر تحميل أسعار الصرف.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [formCurrency, showNotification]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const filtered = useMemo(() => {
    const fc = filterCurrency.trim().toUpperCase();
    return rates.filter(r => {
      if (fc && r.currency_code !== fc) return false;
      if (filterType !== 'all' && r.rate_type !== filterType) return false;
      return true;
    });
  }, [rates, filterCurrency, filterType]);

  const handleUpsert = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const code = formCurrency.trim().toUpperCase();
    const date = formDate.trim();
    const rt = formType;
    const rate = Number(formRate);
    if (!code) {
      showNotification('اختر عملة.', 'error');
      return;
    }
    if (!date) {
      showNotification('اختر تاريخ السعر.', 'error');
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      showNotification('سعر الصرف غير صالح.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('fx_rates').upsert(
        { currency_code: code, rate, rate_date: date, rate_type: rt },
        { onConflict: 'currency_code,rate_date,rate_type' }
      );
      if (error) throw error;
      showNotification('تم حفظ سعر الصرف.', 'success');
      await loadAll();
    } catch (err: any) {
      showNotification(String(err?.message || 'تعذر حفظ سعر الصرف.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: FxRateRow) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setDeletingId(row.id);
    try {
      const { error } = await supabase.from('fx_rates').delete().eq('id', row.id);
      if (error) throw error;
      showNotification('تم حذف السعر.', 'success');
      await loadAll();
    } catch (err: any) {
      showNotification(String(err?.message || 'تعذر حذف السعر.'), 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-3xl font-bold dark:text-white">أسعار الصرف</h1>
          <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            {baseCurrency
              ? `العملة الأساسية: ${baseCurrency}${baseIsHighInflation ? ' (تضخم مرتفع)' : ''}`
              : 'العملة الأساسية غير محددة.'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => loadAll()}
          className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 font-semibold hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
          disabled={loading}
        >
          تحديث
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">العملة</label>
            <select
              value={formCurrency}
              onChange={(e) => setFormCurrency(String(e.target.value || '').toUpperCase())}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">اختر</option>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code}{c.is_base ? ' (أساسية)' : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">نوع السعر</label>
            <select
              value={formType}
              onChange={(e) => setFormType(String(e.target.value) === 'accounting' ? 'accounting' : 'operational')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="operational">تشغيلي (Operational)</option>
              <option value="accounting">محاسبي (Accounting)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">التاريخ</label>
            <input
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(String(e.target.value || ''))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">سعر الصرف</label>
            <input
              type="number"
              min="0"
              step="0.000001"
              value={formRate}
              onChange={(e) => setFormRate(String(e.target.value || ''))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleUpsert}
            disabled={saving || loading}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">فلترة بالعملة</label>
            <input
              value={filterCurrency}
              onChange={(e) => setFilterCurrency(String(e.target.value || '').toUpperCase())}
              placeholder="مثال: رمز العملة"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">فلترة بنوع السعر</label>
            <select
              value={filterType}
              onChange={(e) => {
                const v = String(e.target.value || 'all');
                setFilterType(v === 'accounting' ? 'accounting' : v === 'operational' ? 'operational' : 'all');
              }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">الكل</option>
              <option value="operational">تشغيلي</option>
              <option value="accounting">محاسبي</option>
            </select>
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300 flex items-end">
            {loading ? 'جاري التحميل...' : `${filtered.length} سجل`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-200">
                <th className="p-3 text-right">التاريخ</th>
                <th className="p-3 text-right">العملة</th>
                <th className="p-3 text-right">النوع</th>
                <th className="p-3 text-right">السعر</th>
                <th className="p-3 text-right">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="p-3 font-mono">{String(r.rate_date || '').slice(0, 10)}</td>
                  <td className="p-3 font-mono">{r.currency_code}</td>
                  <td className="p-3">{r.rate_type === 'accounting' ? 'محاسبي' : 'تشغيلي'}</td>
                  <td className="p-3 font-mono">{Number(r.rate || 0).toFixed(6)}</td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => handleDelete(r)}
                      disabled={deletingId === r.id}
                      className="px-3 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 disabled:opacity-60"
                    >
                      {deletingId === r.id ? '...' : 'حذف'}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-gray-600 dark:text-gray-300">
                    لا توجد أسعار مطابقة للفلترة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold dark:text-white">سجل التغييرات (Audit)</h2>
          <div className="text-xs text-gray-600 dark:text-gray-300">{auditRows.length} حدث</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-200">
                <th className="p-3 text-right">الوقت</th>
                <th className="p-3 text-right">العملية</th>
                <th className="p-3 text-right">التفاصيل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {auditRows.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="p-3 font-mono">{String(a.performed_at || '').replace('T', ' ').slice(0, 19)}</td>
                  <td className="p-3">{a.action || '—'}</td>
                  <td className="p-3">{a.details || '—'}</td>
                </tr>
              ))}
              {auditRows.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-gray-600 dark:text-gray-300">
                    لا توجد أحداث.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default FxRatesScreen;
