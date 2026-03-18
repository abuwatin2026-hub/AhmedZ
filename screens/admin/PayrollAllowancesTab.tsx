import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

/* =====================================================================
   PayrollAllowancesTab — تبويب بدلات الراتب المستقلة
   يُستخدم داخل PayrollScreen كتبويب إضافي
   ===================================================================== */

type EmployeeRow = {
  id: string;
  full_name: string;
  employee_code?: string | null;
  monthly_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  food_allowance: number;
  other_allowances: number;
  currency: string;
};

export default function PayrollAllowancesTab() {
  const { showNotification } = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission?.('hr.manage') || hasPermission?.('accounting.manage');

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    housing_allowance: '',
    transport_allowance: '',
    food_allowance: '',
    other_allowances: '',
  });

  const loadEmployees = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('payroll_employees')
        .select('id,full_name,employee_code,monthly_salary,housing_allowance,transport_allowance,food_allowance,other_allowances,currency')
        .eq('is_active', true)
        .order('full_name');
      if (error) throw error;
      setEmployees((data || []).map((r: any) => ({
        id: r.id,
        full_name: r.full_name,
        employee_code: r.employee_code,
        monthly_salary: Number(r.monthly_salary || 0),
        housing_allowance: Number(r.housing_allowance || 0),
        transport_allowance: Number(r.transport_allowance || 0),
        food_allowance: Number(r.food_allowance || 0),
        other_allowances: Number(r.other_allowances || 0),
        currency: r.currency || 'YER',
      })));
    } catch (e: any) {
      showNotification(e.message || 'فشل تحميل الموظفين', 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => { void loadEmployees(); }, [loadEmployees]);

  const startEdit = (emp: EmployeeRow) => {
    setEditingId(emp.id);
    setForm({
      housing_allowance: String(emp.housing_allowance || ''),
      transport_allowance: String(emp.transport_allowance || ''),
      food_allowance: String(emp.food_allowance || ''),
      other_allowances: String(emp.other_allowances || ''),
    });
  };

  const saveAllowances = async (empId: string) => {
    if (!canManage) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSaving(empId);
    try {
      const { error } = await supabase
        .from('payroll_employees')
        .update({
          housing_allowance:   Number(form.housing_allowance || 0),
          transport_allowance: Number(form.transport_allowance || 0),
          food_allowance:      Number(form.food_allowance || 0),
          other_allowances:    Number(form.other_allowances || 0),
        })
        .eq('id', empId);
      if (error) throw error;
      showNotification('تم حفظ البدلات بنجاح', 'success');
      setEditingId(null);
      await loadEmployees();
    } catch (e: any) {
      showNotification(e.message || 'فشل الحفظ', 'error');
    } finally {
      setSaving(null);
    }
  };

  const totalFor = (emp: EmployeeRow) =>
    emp.housing_allowance + emp.transport_allowance + emp.food_allowance + emp.other_allowances;

  const grossFor = (emp: EmployeeRow) => emp.monthly_salary + totalFor(emp);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold dark:text-white">بدلات الرواتب المستقلة</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">إدارة بدل السكن والمواصلات والغذاء وغيرها لكل موظف</p>
        </div>
        <button
          onClick={() => void loadEmployees()}
          className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
        >
          تحديث
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">جاري التحميل...</div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
              <tr>
                <th className="px-4 py-3">الموظف</th>
                <th className="px-4 py-3 text-center">الراتب الأساسي</th>
                <th className="px-4 py-3 text-center">بدل السكن</th>
                <th className="px-4 py-3 text-center">بدل المواصلات</th>
                <th className="px-4 py-3 text-center">بدل الغذاء</th>
                <th className="px-4 py-3 text-center">بدلات أخرى</th>
                <th className="px-4 py-3 text-center">إجمالي الراتب</th>
                {canManage && <th className="px-4 py-3 text-center">إجراء</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {employees.map(emp => (
                <tr key={emp.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3">
                    <div className="font-semibold dark:text-white">{emp.full_name}</div>
                    {emp.employee_code && (
                      <div className="text-xs text-gray-400 font-mono">{emp.employee_code}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-blue-700 dark:text-blue-300">
                    {emp.monthly_salary.toLocaleString('ar-YE', { minimumFractionDigits: 0 })}
                  </td>

                  {editingId === emp.id ? (
                    <>
                      {(['housing_allowance','transport_allowance','food_allowance','other_allowances'] as const).map(field => (
                        <td key={field} className="px-2 py-1">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={form[field]}
                            onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                            className="w-24 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-center font-mono"
                          />
                        </td>
                      ))}
                      <td className="px-4 py-3 text-center font-mono font-bold text-emerald-700 dark:text-emerald-300">
                        {(emp.monthly_salary +
                          Number(form.housing_allowance || 0) +
                          Number(form.transport_allowance || 0) +
                          Number(form.food_allowance || 0) +
                          Number(form.other_allowances || 0)).toLocaleString('ar-YE', { minimumFractionDigits: 0 })}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => void saveAllowances(emp.id)}
                            disabled={saving === emp.id}
                            className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs disabled:opacity-60"
                          >
                            {saving === emp.id ? 'جاري...' : 'حفظ'}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-xs"
                          >
                            إلغاء
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-center font-mono text-gray-700 dark:text-gray-200">{emp.housing_allowance.toLocaleString('ar-YE', { minimumFractionDigits: 0 })}</td>
                      <td className="px-4 py-3 text-center font-mono text-gray-700 dark:text-gray-200">{emp.transport_allowance.toLocaleString('ar-YE', { minimumFractionDigits: 0 })}</td>
                      <td className="px-4 py-3 text-center font-mono text-gray-700 dark:text-gray-200">{emp.food_allowance.toLocaleString('ar-YE', { minimumFractionDigits: 0 })}</td>
                      <td className="px-4 py-3 text-center font-mono text-gray-700 dark:text-gray-200">{emp.other_allowances.toLocaleString('ar-YE', { minimumFractionDigits: 0 })}</td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-emerald-700 dark:text-emerald-300">
                        {grossFor(emp).toLocaleString('ar-YE', { minimumFractionDigits: 0 })}
                        <div className="text-xs text-gray-400">{emp.currency}</div>
                      </td>
                      {canManage && (
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => startEdit(emp)}
                            className="px-3 py-1 rounded-lg border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          >
                            تعديل
                          </button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
              {employees.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400">لا يوجد موظفون نشطون.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
