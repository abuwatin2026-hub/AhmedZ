import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import * as Icons from '../../components/icons';

type EOSBRow = {
  employee_id: string;
  full_name: string;
  employee_code?: string | null;
  period_ym: string;
  years_of_service: number;
  base_for_eosb: number;
  accrual_amount: number;
  cumulative_amount: number;
  currency: string;
};

type EOSBSettings = {
  include_allowances: boolean;
  days_per_year_1: number;
  days_per_year_2: number;
  min_years_to_qualify: number;
};

export default function EOSBScreen() {
  const { showNotification } = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission?.('hr.manage') || hasPermission?.('accounting.manage');

  const currentYM = new Date().toISOString().slice(0, 7);
  const [period, setPeriod] = useState(currentYM);
  const [rows, setRows] = useState<EOSBRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [settings, setSettings] = useState<EOSBSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<'accruals' | 'settings'>('accruals');

  const loadSettings = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data } = await supabase.from('eosb_settings').select('*').limit(1).single();
    if (data) setSettings(data as EOSBSettings);
  }, []);

  const loadAccruals = useCallback(async () => {
    if (!period) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('employee_eosb_accruals')
        .select('employee_id, period_ym, years_of_service, base_for_eosb, accrual_amount, cumulative_amount, currency, payroll_employees(full_name, employee_code)')
        .eq('period_ym', period)
        .order('accrual_amount', { ascending: false });
      if (error) throw error;
      setRows((data || []).map((r: any) => ({
        employee_id: r.employee_id,
        full_name: r.payroll_employees?.full_name || '—',
        employee_code: r.payroll_employees?.employee_code,
        period_ym: r.period_ym,
        years_of_service: Number(r.years_of_service || 0),
        base_for_eosb: Number(r.base_for_eosb || 0),
        accrual_amount: Number(r.accrual_amount || 0),
        cumulative_amount: Number(r.cumulative_amount || 0),
        currency: r.currency,
      })));
    } catch (e: any) {
      showNotification(e.message || 'فشل التحميل', 'error');
    } finally {
      setLoading(false);
    }
  }, [period, showNotification]);

  useEffect(() => { void loadSettings(); void loadAccruals(); }, [loadSettings, loadAccruals]);

  const runAccruals = async () => {
    if (!canManage) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.rpc('run_monthly_eosb_accruals', { p_period_ym: period });
      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      showNotification(`تم الاحتساب: ${res?.processed_count || 0} موظف، إجمالي: ${Number(res?.total_accrual || 0).toFixed(0)}`, 'success');
      await loadAccruals();
    } catch (e: any) {
      showNotification(e.message || 'فشل الاحتساب', 'error');
    } finally {
      setRunning(false);
    }
  };

  const saveSettings = async () => {
    if (!settings || !canManage) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSavingSettings(true);
    try {
      const { error } = await supabase.from('eosb_settings').upsert({ ...settings });
      if (error) throw error;
      showNotification('تم حفظ الإعدادات', 'success');
    } catch (e: any) {
      showNotification(e.message, 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const totalAccrual = rows.reduce((s, r) => s + r.accrual_amount, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">مكافأة نهاية الخدمة</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">احتساب وتتبع استحقاق مكافأة نهاية الخدمة لجميع الموظفين</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            type="month"
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          />
          <button onClick={() => void loadAccruals()} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">تحديث</button>
          {canManage && (
            <button
              onClick={() => void runAccruals()}
              disabled={running}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60 flex items-center gap-2"
            >
              {running ? 'جاري الاحتساب...' : 'احتساب هذا الشهر'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 gap-4">
        {[
          { id: 'accruals' as const, label: 'الاستحقاقات الشهرية' },
          { id: 'settings' as const, label: 'إعدادات الاحتساب' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'accruals' && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'عدد الموظفين', value: rows.length },
              { label: 'إجمالي الاستحقاق الشهري', value: totalAccrual.toLocaleString('ar-YE', { minimumFractionDigits: 0 }) },
              { label: 'متوسط الاستحقاق', value: rows.length > 0 ? (totalAccrual / rows.length).toFixed(0) : '—' },
              { label: 'الفترة', value: period },
            ].map((item, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{item.label}</div>
                <div className="text-lg font-bold dark:text-white font-mono">{item.value}</div>
              </div>
            ))}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3">الموظف</th>
                  <th className="px-4 py-3 text-center">سنوات الخدمة</th>
                  <th className="px-4 py-3 text-center">القاعدة الشهرية</th>
                  <th className="px-4 py-3 text-center">استحقاق الشهر</th>
                  <th className="px-4 py-3 text-center">الرصيد التراكمي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading ? (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-400">جاري التحميل...</td></tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400">
                      لا توجد بيانات لهذه الفترة. اضغط "احتساب هذا الشهر" لبدء الاحتساب.
                    </td>
                  </tr>
                ) : (
                  rows.map(row => (
                    <tr key={row.employee_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-4 py-3">
                        <div className="font-semibold dark:text-white">{row.full_name}</div>
                        {row.employee_code && <div className="text-xs text-gray-400 font-mono">{row.employee_code}</div>}
                      </td>
                      <td className="px-4 py-3 text-center font-mono">{row.years_of_service.toFixed(2)} سنة</td>
                      <td className="px-4 py-3 text-center font-mono">{row.base_for_eosb.toLocaleString('ar-YE', { minimumFractionDigits: 0 })}</td>
                      <td className="px-4 py-3 text-center font-mono text-blue-700 dark:text-blue-300 font-bold">
                        {row.accrual_amount.toLocaleString('ar-YE', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-emerald-700 dark:text-emerald-300 font-bold">
                        {row.cumulative_amount.toLocaleString('ar-YE', { minimumFractionDigits: 2 })}
                        <div className="text-xs text-gray-400">{row.currency}</div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'settings' && settings && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-6 max-w-lg space-y-4">
          <h3 className="font-bold dark:text-white">إعدادات احتساب مكافأة نهاية الخدمة</h3>

          {[
            { label: 'عدد الأيام/السنة (للسنوات 1-5)', field: 'days_per_year_1' as const },
            { label: 'عدد الأيام/السنة (بعد 5 سنوات)', field: 'days_per_year_2' as const },
            { label: 'الحد الأدنى للاستحقاق (سنوات)', field: 'min_years_to_qualify' as const },
          ].map(item => (
            <div key={item.field}>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">{item.label}</label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={settings[item.field]}
                onChange={e => setSettings(s => s ? { ...s, [item.field]: Number(e.target.value) } : s)}
                disabled={!canManage}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
              />
            </div>
          ))}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.include_allowances}
              onChange={e => setSettings(s => s ? { ...s, include_allowances: e.target.checked } : s)}
              disabled={!canManage}
              className="rounded"
            />
            <span className="text-sm dark:text-gray-200">تشمل البدلات في قاعدة الاحتساب</span>
          </label>

          {canManage && (
            <button
              onClick={() => void saveSettings()}
              disabled={savingSettings}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-60"
            >
              {savingSettings ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
