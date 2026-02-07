import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import PageLoader from '../../components/PageLoader';
import { useToast } from '../../contexts/ToastContext';

type RuleRow = { id: string; rule_type: 'allowance' | 'deduction' | string; name: string; amount_type: 'fixed' | 'percent' | string; amount_value: number; is_active: boolean; };
type TaxRow = { id: string; name: string; rate: number; applies_to: 'gross' | 'net' | string; is_active: boolean; };

export default function PayrollConfigScreen() {
  const { showNotification } = useToast();
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [taxes, setTaxes] = useState<TaxRow[]>([]);
  const [draftRule, setDraftRule] = useState({ rule_type: 'allowance', name: '', amount_type: 'fixed', amount_value: 0, is_active: true });
  const [draftTax, setDraftTax] = useState({ name: '', rate: 0, applies_to: 'gross', is_active: true });

  const supabase = getSupabaseClient();

  const loadAll = useCallback(async () => {
    if (!supabase) return;
    const [r1, r2] = await Promise.all([
      supabase.from('payroll_rule_defs').select('id,rule_type,name,amount_type,amount_value,is_active').order('created_at', { ascending: true }),
      supabase.from('payroll_tax_defs').select('id,name,rate,applies_to,is_active').order('created_at', { ascending: true }),
    ]);
    if (r1.error) throw r1.error;
    if (r2.error) throw r2.error;
    setRules((Array.isArray(r1.data) ? r1.data : []).map((x: any) => ({
      id: String(x.id), rule_type: String(x.rule_type), name: String(x.name || ''), amount_type: String(x.amount_type), amount_value: Number(x.amount_value || 0), is_active: Boolean(x.is_active),
    })));
    setTaxes((Array.isArray(r2.data) ? r2.data : []).map((x: any) => ({
      id: String(x.id), name: String(x.name || ''), rate: Number(x.rate || 0), applies_to: String(x.applies_to), is_active: Boolean(x.is_active),
    })));
  }, [supabase]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadAll();
      } catch (e: any) {
        showNotification(String(e?.message || 'تعذر تحميل إعدادات الرواتب'), 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAll, showNotification]);

  const addRule = async () => {
    try {
      if (!supabase) return;
      if (!draftRule.name.trim()) {
        showNotification('اسم القاعدة مطلوب', 'error');
        return;
      }
      const { error } = await supabase.from('payroll_rule_defs').insert({
        rule_type: draftRule.rule_type,
        name: draftRule.name.trim(),
        amount_type: draftRule.amount_type,
        amount_value: draftRule.amount_value,
        is_active: draftRule.is_active,
      });
      if (error) throw error;
      showNotification('تم إضافة القاعدة.', 'success');
      setDraftRule({ rule_type: 'allowance', name: '', amount_type: 'fixed', amount_value: 0, is_active: true });
      await loadAll();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر إضافة القاعدة'), 'error');
    }
  };

  const addTax = async () => {
    try {
      if (!supabase) return;
      if (!draftTax.name.trim()) {
        showNotification('اسم الضريبة مطلوب', 'error');
        return;
      }
      const { error } = await supabase.from('payroll_tax_defs').insert({
        name: draftTax.name.trim(),
        rate: draftTax.rate,
        applies_to: draftTax.applies_to,
        is_active: draftTax.is_active,
      });
      if (error) throw error;
      showNotification('تم إضافة الضريبة.', 'success');
      setDraftTax({ name: '', rate: 0, applies_to: 'gross', is_active: true });
      await loadAll();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر إضافة الضريبة'), 'error');
    }
  };

  if (loading) return <PageLoader />;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold dark:text-white">إعدادات الرواتب (قواعد/ضرائب)</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
          <div className="font-semibold mb-3 text-gray-700 dark:text-gray-200">القواعد</div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select value={draftRule.rule_type} onChange={e => setDraftRule({ ...draftRule, rule_type: e.target.value as any })} className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600">
                <option value="allowance">بدل</option>
                <option value="deduction">استقطاع</option>
              </select>
              <input value={draftRule.name} onChange={e => setDraftRule({ ...draftRule, name: e.target.value })} placeholder="الاسم" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
              <select value={draftRule.amount_type} onChange={e => setDraftRule({ ...draftRule, amount_type: e.target.value as any })} className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600">
                <option value="fixed">مبلغ ثابت</option>
                <option value="percent">نسبة من الإجمالي</option>
              </select>
              <input type="number" value={draftRule.amount_value} onChange={e => setDraftRule({ ...draftRule, amount_value: Number(e.target.value || 0) })} placeholder="القيمة" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draftRule.is_active} onChange={e => setDraftRule({ ...draftRule, is_active: e.target.checked })} />
                فعّال
              </label>
              <button type="button" onClick={() => void addRule()} className="px-4 py-2 rounded bg-emerald-600 text-white font-semibold">إضافة قاعدة</button>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[680px] w-full text-right">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">النوع</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">الاسم</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">طريقة</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">القيمة</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id} className="border-t dark:border-gray-700">
                    <td className="p-2 text-sm">{r.rule_type === 'allowance' ? 'بدل' : 'استقطاع'}</td>
                    <td className="p-2 text-sm">{r.name}</td>
                    <td className="p-2 text-sm">{r.amount_type === 'percent' ? 'نسبة' : 'مبلغ'}</td>
                    <td className="p-2 text-sm">{r.amount_value}</td>
                    <td className="p-2 text-xs">{r.is_active ? 'فعّال' : 'موقّف'}</td>
                  </tr>
                ))}
                {rules.length === 0 && (
                  <tr><td colSpan={5} className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">لا توجد قواعد.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
          <div className="font-semibold mb-3 text-gray-700 dark:text-gray-200">الضرائب</div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input value={draftTax.name} onChange={e => setDraftTax({ ...draftTax, name: e.target.value })} placeholder="اسم الضريبة" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
              <input type="number" value={draftTax.rate} onChange={e => setDraftTax({ ...draftTax, rate: Number(e.target.value || 0) })} placeholder="النسبة %" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
              <select value={draftTax.applies_to} onChange={e => setDraftTax({ ...draftTax, applies_to: e.target.value as any })} className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600">
                <option value="gross">على الإجمالي</option>
                <option value="net">على الصافي</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draftTax.is_active} onChange={e => setDraftTax({ ...draftTax, is_active: e.target.checked })} />
                فعّال
              </label>
              <button type="button" onClick={() => void addTax()} className="px-4 py-2 rounded bg-emerald-600 text-white font-semibold">إضافة ضريبة</button>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[680px] w-full text-right">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">الاسم</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">النسبة</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">النطاق</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {taxes.map(t => (
                  <tr key={t.id} className="border-t dark:border-gray-700">
                    <td className="p-2 text-sm">{t.name}</td>
                    <td className="p-2 text-sm">{t.rate}%</td>
                    <td className="p-2 text-sm">{t.applies_to === 'gross' ? 'إجمالي' : 'صافي'}</td>
                    <td className="p-2 text-xs">{t.is_active ? 'فعّال' : 'موقّف'}</td>
                  </tr>
                ))}
                {taxes.length === 0 && (
                  <tr><td colSpan={4} className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">لا توجد ضرائب.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

