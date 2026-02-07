import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useSessionScope } from '../../contexts/SessionScopeContext';
import { useAuth } from '../../contexts/AuthContext';
import PageLoader from '../../components/PageLoader';
import { toDateTimeLocalInputValue } from '../../utils/dateUtils';
import { printJournalVoucherByEntryId, printPaymentVoucherByPaymentId } from '../../utils/vouchers';

type PayrollEmployee = {
  id: string;
  full_name: string;
  employee_code?: string | null;
  is_active: boolean;
  monthly_salary: number;
  currency: string;
  notes?: string | null;
};

type PayrollRun = {
  id: string;
  period_ym: string;
  status: 'draft' | 'accrued' | 'paid' | 'voided' | string;
  expense_id?: string | null;
  memo?: string | null;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  created_at: string;
  accrued_at?: string | null;
  paid_at?: string | null;
};

type PayrollLine = {
  id: string;
  employee_id: string;
  gross: number;
  allowances?: number;
  deductions: number;
  net: number;
  foreign_amount?: number;
  fx_rate?: number;
  currency_code?: string;
  line_memo?: string | null;
  cost_center_id?: string | null;
  employee_name?: string;
  employee_code?: string | null;
};

type ActiveAccount = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  normal_balance: string;
};

type PayrollSettingsRow = {
  salary_expense_account_id: string | null;
  salary_payable_account_id: string | null;
  default_cost_center_id: string | null;
};

const toMonthValue = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const formatMoney = (n: number) => {
  const v = Number(n || 0);
  try {
    return v.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return v.toFixed(2);
  }
};

const formatTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('ar-EG-u-nu-latn');
  } catch {
    return iso;
  }
};

export default function PayrollScreen() {
  const { showNotification } = useToast();
  const { settings } = useSettings();
  const { scope } = useSessionScope();
  const { hasPermission } = useAuth();

  const baseCurrencyCode = String((settings as any)?.baseCurrency || '').toUpperCase() || '—';

  const canViewAccounting = hasPermission('accounting.view');
  const canManageAccounting = hasPermission('accounting.manage');

  const [tab, setTab] = useState<'runs' | 'employees' | 'settings'>('runs');
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState<PayrollEmployee[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);

  const [createPeriod, setCreatePeriod] = useState(toMonthValue());
  const [createMemo, setCreateMemo] = useState('');

  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [employeeEditing, setEmployeeEditing] = useState<PayrollEmployee | null>(null);
  const [employeeForm, setEmployeeForm] = useState({
    full_name: '',
    employee_code: '',
    monthly_salary: 0,
    currency: 'YER',
    is_active: true,
    notes: '',
  });

  const [runModalOpen, setRunModalOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [runLines, setRunLines] = useState<PayrollLine[]>([]);
  const [runPaidSum, setRunPaidSum] = useState(0);
  const [runLoading, setRunLoading] = useState(false);
  const [costCenters, setCostCenters] = useState<Array<{ id: string; name: string; code?: string | null }>>([]);
  const [runCostCenterId, setRunCostCenterId] = useState<string>('');
  const [isEditingLines, setIsEditingLines] = useState(false);
  const [savingLines, setSavingLines] = useState(false);

  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payMethod, setPayMethod] = useState('cash');
  const [payOccurredAt, setPayOccurredAt] = useState(toDateTimeLocalInputValue());
  const [payAmount, setPayAmount] = useState<number>(0);

  const [accounts, setAccounts] = useState<ActiveAccount[]>([]);
  const [payrollSettingsLoading, setPayrollSettingsLoading] = useState(false);
  const [payrollSettings, setPayrollSettings] = useState<PayrollSettingsRow>({
    salary_expense_account_id: null,
    salary_payable_account_id: null,
    default_cost_center_id: null,
  });
  const [payrollSettingsDraft, setPayrollSettingsDraft] = useState<PayrollSettingsRow>({
    salary_expense_account_id: null,
    salary_payable_account_id: null,
    default_cost_center_id: null,
  });
  const [savingPayrollSettings, setSavingPayrollSettings] = useState(false);

  const buildBrand = useCallback(async () => {
    const supabase = getSupabaseClient();
    const base = {
      name: (settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '').trim(),
      address: (settings.address || '').trim(),
      contactNumber: (settings.contactNumber || '').trim(),
      logoUrl: (settings.logoUrl || '').trim(),
      branchName: '',
      branchCode: '',
    };
    if (!supabase) return base;
    try {
      const branchId = String(scope?.branchId || '').trim();
      if (!branchId) return base;
      const { data } = await supabase.from('branches').select('name,code').eq('id', branchId).maybeSingle();
      return {
        ...base,
        branchName: String((data as any)?.name || ''),
        branchCode: String((data as any)?.code || ''),
      };
    } catch {
      return base;
    }
  }, [scope?.branchId, settings.address, settings.cafeteriaName, settings.contactNumber, settings.logoUrl]);

  const loadAll = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setEmployees([]);
      setRuns([]);
      setCostCenters([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [{ data: emps, error: eErr }, { data: rs, error: rErr }, { data: cc, error: cErr }] = await Promise.all([
        supabase.from('payroll_employees').select('*').order('full_name', { ascending: true }),
        supabase.from('payroll_runs').select('*').order('period_ym', { ascending: false }).limit(120),
        supabase.from('cost_centers').select('id,name,code').order('name', { ascending: true }),
      ]);
      if (eErr) throw eErr;
      if (rErr) throw rErr;
      if (cErr) throw cErr;
      setEmployees((Array.isArray(emps) ? emps : []).map((e: any) => ({
        id: String(e.id),
        full_name: String(e.full_name || ''),
        employee_code: e.employee_code ? String(e.employee_code) : null,
        is_active: Boolean(e.is_active),
        monthly_salary: Number(e.monthly_salary || 0),
        currency: String(e.currency || 'YER'),
        notes: e.notes ? String(e.notes) : null,
      })));
      setRuns((Array.isArray(rs) ? rs : []).map((r: any) => ({
        id: String(r.id),
        period_ym: String(r.period_ym || ''),
        status: String(r.status || 'draft'),
        expense_id: r.expense_id ? String(r.expense_id) : null,
        memo: r.memo ? String(r.memo) : null,
        total_gross: Number(r.total_gross || 0),
        total_deductions: Number(r.total_deductions || 0),
        total_net: Number(r.total_net || 0),
        created_at: String(r.created_at || ''),
        accrued_at: r.accrued_at ? String(r.accrued_at) : null,
        paid_at: r.paid_at ? String(r.paid_at) : null,
      })));
      setCostCenters((Array.isArray(cc) ? cc : []).map((x: any) => ({ id: String(x.id), name: String(x.name || ''), code: x.code ? String(x.code) : null })));
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر تحميل الرواتب'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const loadPayrollSettings = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAccounts([]);
      setPayrollSettings({ salary_expense_account_id: null, salary_payable_account_id: null, default_cost_center_id: null });
      setPayrollSettingsDraft({ salary_expense_account_id: null, salary_payable_account_id: null, default_cost_center_id: null });
      return;
    }
    setPayrollSettingsLoading(true);
    try {
      if (!canViewAccounting) {
        setAccounts([]);
        setPayrollSettings({ salary_expense_account_id: null, salary_payable_account_id: null, default_cost_center_id: null });
        setPayrollSettingsDraft({ salary_expense_account_id: null, salary_payable_account_id: null, default_cost_center_id: null });
        return;
      }

      const [{ data: accountsRows, error: aErr }, { data: row, error: sErr }] = await Promise.all([
        supabase.rpc('list_active_accounts'),
        supabase
          .from('payroll_settings')
          .select('salary_expense_account_id,salary_payable_account_id,default_cost_center_id')
          .eq('id', 'app')
          .maybeSingle(),
      ]);
      if (aErr) throw aErr;
      if (sErr) throw sErr;

      setAccounts((Array.isArray(accountsRows) ? accountsRows : []).map((r: any) => ({
        id: String(r.id),
        code: String(r.code || ''),
        name: String(r.name || ''),
        account_type: String(r.account_type || ''),
        normal_balance: String(r.normal_balance || ''),
      })));
      const next = {
        salary_expense_account_id: row?.salary_expense_account_id ? String((row as any).salary_expense_account_id) : null,
        salary_payable_account_id: row?.salary_payable_account_id ? String((row as any).salary_payable_account_id) : null,
        default_cost_center_id: row?.default_cost_center_id ? String((row as any).default_cost_center_id) : null,
      };
      setPayrollSettings(next);
      setPayrollSettingsDraft(next);
    } catch (e: any) {
      setAccounts([]);
      setPayrollSettings({ salary_expense_account_id: null, salary_payable_account_id: null, default_cost_center_id: null });
      setPayrollSettingsDraft({ salary_expense_account_id: null, salary_payable_account_id: null, default_cost_center_id: null });
      showNotification(String(e?.message || 'تعذر تحميل إعدادات الرواتب'), 'error');
    } finally {
      setPayrollSettingsLoading(false);
    }
  }, [canViewAccounting, showNotification]);

  useEffect(() => {
    if (tab === 'settings') {
      void loadPayrollSettings();
    }
  }, [loadPayrollSettings, tab]);

  const savePayrollSettings = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!canManageAccounting) {
      showNotification('لا تملك صلاحية تعديل إعدادات المحاسبة.', 'error');
      return;
    }
    setSavingPayrollSettings(true);
    try {
      const payload = {
        id: 'app',
        salary_expense_account_id: payrollSettingsDraft.salary_expense_account_id,
        salary_payable_account_id: payrollSettingsDraft.salary_payable_account_id,
        default_cost_center_id: payrollSettingsDraft.default_cost_center_id,
        updated_at: new Date().toISOString(),
      } as any;
      const { error } = await supabase.from('payroll_settings').upsert(payload, { onConflict: 'id' });
      if (error) throw error;
      setPayrollSettings(payrollSettingsDraft);
      showNotification('تم حفظ إعدادات الرواتب.', 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر حفظ الإعدادات'), 'error');
    } finally {
      setSavingPayrollSettings(false);
    }
  };

  const openEmployeeModal = (emp?: PayrollEmployee) => {
    if (emp) {
      setEmployeeEditing(emp);
      setEmployeeForm({
        full_name: emp.full_name || '',
        employee_code: String(emp.employee_code || ''),
        monthly_salary: Number(emp.monthly_salary || 0),
        currency: String(emp.currency || 'YER'),
        is_active: Boolean(emp.is_active),
        notes: String(emp.notes || ''),
      });
    } else {
      setEmployeeEditing(null);
      setEmployeeForm({ full_name: '', employee_code: '', monthly_salary: 0, currency: 'YER', is_active: true, notes: '' });
    }
    setEmployeeModalOpen(true);
  };

  const saveEmployee = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const payload = {
      full_name: String(employeeForm.full_name || '').trim(),
      employee_code: String(employeeForm.employee_code || '').trim() || null,
      monthly_salary: Number(employeeForm.monthly_salary || 0),
      currency: String(employeeForm.currency || 'YER').toUpperCase() || 'YER',
      is_active: Boolean(employeeForm.is_active),
      notes: String(employeeForm.notes || '').trim() || null,
    };
    if (!payload.full_name) {
      showNotification('يرجى إدخال اسم الموظف.', 'error');
      return;
    }
    if (!Number.isFinite(payload.monthly_salary) || payload.monthly_salary < 0) {
      showNotification('الراتب الشهري غير صالح.', 'error');
      return;
    }
    try {
      if (employeeEditing) {
        const { error } = await supabase.from('payroll_employees').update(payload).eq('id', employeeEditing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('payroll_employees').insert(payload);
        if (error) throw error;
      }
      setEmployeeModalOpen(false);
      setEmployeeEditing(null);
      await loadAll();
      showNotification('تم حفظ الموظف.', 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر حفظ الموظف'), 'error');
    }
  };

  const createRun = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const period = String(createPeriod || '').trim();
    if (!/^\d{4}-\d{2}$/.test(period)) {
      showNotification('الفترة غير صحيحة (YYYY-MM).', 'error');
      return;
    }
    try {
      const { data, error } = await supabase.rpc('create_payroll_run', { p_period_ym: period, p_memo: String(createMemo || '').trim() || null });
      if (error) throw error;
      const runId = typeof data === 'string' ? data : String(data || '');
      await loadAll();
      showNotification('تم إنشاء مسير الرواتب.', 'success');
      if (runId) {
        try {
          const { data: fresh, error: fErr } = await supabase.from('payroll_runs').select('*').eq('id', runId).maybeSingle();
          if (!fErr && fresh) {
            await openRun({
              id: String((fresh as any).id),
              period_ym: String((fresh as any).period_ym || ''),
              status: String((fresh as any).status || 'draft'),
              expense_id: (fresh as any).expense_id ? String((fresh as any).expense_id) : null,
              memo: (fresh as any).memo ? String((fresh as any).memo) : null,
              total_gross: Number((fresh as any).total_gross || 0),
              total_deductions: Number((fresh as any).total_deductions || 0),
              total_net: Number((fresh as any).total_net || 0),
              created_at: String((fresh as any).created_at || ''),
              accrued_at: (fresh as any).accrued_at ? String((fresh as any).accrued_at) : null,
              paid_at: (fresh as any).paid_at ? String((fresh as any).paid_at) : null,
            });
          }
        } catch {
        }
      }
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر إنشاء المسير'), 'error');
    }
  };

  const openRun = async (run: PayrollRun) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSelectedRun(run);
    setRunModalOpen(true);
    setRunLoading(true);
    setIsEditingLines(false);
    try {
      setRunCostCenterId(String((run as any).cost_center_id || ''));
      const { data: lines, error: lErr } = await supabase
        .from('payroll_run_lines')
        .select('id,employee_id,gross,allowances,deductions,net,foreign_amount,fx_rate,currency_code,line_memo,cost_center_id,payroll_employees(full_name,employee_code)')
        .eq('run_id', run.id)
        .order('created_at', { ascending: true });
      if (lErr) throw lErr;
      const mapped: PayrollLine[] = (Array.isArray(lines) ? lines : []).map((l: any) => ({
        id: String(l.id),
        employee_id: String(l.employee_id),
        gross: Number(l.gross || 0),
        allowances: Number(l.allowances || 0),
        deductions: Number(l.deductions || 0),
        net: Number(l.net || 0),
        foreign_amount: Number(l.foreign_amount || 0),
        fx_rate: Number(l.fx_rate || 0),
        currency_code: l.currency_code ? String(l.currency_code || '').toUpperCase() : undefined,
        line_memo: l.line_memo ? String(l.line_memo) : null,
        cost_center_id: l.cost_center_id ? String(l.cost_center_id) : null,
        employee_name: String(l?.payroll_employees?.full_name || ''),
        employee_code: l?.payroll_employees?.employee_code ? String(l.payroll_employees.employee_code) : null,
      }));
      setRunLines(mapped);

      const expenseId = String(run.expense_id || '').trim();
      if (expenseId) {
        const { data: pRows, error: pErr } = await supabase
          .from('payments')
          .select('amount')
          .eq('reference_table', 'expenses')
          .eq('reference_id', expenseId)
          .eq('direction', 'out');
        if (pErr) throw pErr;
        const sum = (Array.isArray(pRows) ? pRows : []).reduce((s, x: any) => s + Number(x?.amount || 0), 0);
        setRunPaidSum(sum);
      } else {
        setRunPaidSum(0);
      }
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر تحميل تفاصيل المسير'), 'error');
      setRunLines([]);
      setRunPaidSum(0);
    } finally {
      setRunLoading(false);
    }
  };

  const accrueSelectedRun = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !selectedRun) return;
    try {
      const occurredAtIso = new Date().toISOString();
      const { data, error } = await supabase.rpc('record_payroll_run_accrual_v2', { p_run_id: selectedRun.id, p_occurred_at: occurredAtIso });
      if (error) throw error;
      await loadAll();
      const entryId = typeof data === 'string' ? data : String(data || '');
      const ok = entryId ? window.confirm('تم ترحيل الاستحقاق. هل تريد طباعة قيد اليومية (JV) الآن؟') : false;
      if (ok && entryId) {
        const brand = await buildBrand();
        await printJournalVoucherByEntryId(entryId, brand);
      }
      showNotification('تم ترحيل استحقاق الرواتب.', 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر ترحيل الاستحقاق'), 'error');
    }
  };
  const computeSelectedRun = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !selectedRun) return;
    try {
      const { error } = await supabase.rpc('compute_payroll_run_v3', { p_run_id: selectedRun.id } as any);
      if (error) throw error;
      await openRun(selectedRun);
      await loadAll();
      showNotification('تم احتساب الرواتب وتحديث السطور.', 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر احتساب الرواتب'), 'error');
    }
  };

  const saveRunCostCenter = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !selectedRun) return;
    try {
      const next = String(runCostCenterId || '').trim() || null;
      const { error } = await supabase.from('payroll_runs').update({ cost_center_id: next }).eq('id', selectedRun.id);
      if (error) throw error;
      await supabase.rpc('recalc_payroll_run_totals', { p_run_id: selectedRun.id } as any);
      await loadAll();
      showNotification('تم حفظ مركز التكلفة.', 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر حفظ مركز التكلفة'), 'error');
    }
  };

  const saveLines = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !selectedRun) return;
    setSavingLines(true);
    try {
      const updates = runLines.map((l) => ({
        id: l.id,
        gross: Number(l.gross || 0),
        allowances: Number(l.allowances || 0),
        deductions: Number(l.deductions || 0),
        cost_center_id: String(l.cost_center_id || '').trim() || null,
        line_memo: String(l.line_memo || '').trim() || null,
      }));
      await Promise.all(updates.map((u) => supabase.from('payroll_run_lines').update(u).eq('id', u.id)));
      await supabase.rpc('recalc_payroll_run_totals', { p_run_id: selectedRun.id } as any);
      const { data: fresh } = await supabase.from('payroll_runs').select('*').eq('id', selectedRun.id).maybeSingle();
      if (fresh) {
        const nextRun: any = {
          ...selectedRun,
          total_gross: Number((fresh as any).total_gross || 0),
          total_deductions: Number((fresh as any).total_deductions || 0),
          total_net: Number((fresh as any).total_net || 0),
          status: String((fresh as any).status || selectedRun.status),
          accrued_at: (fresh as any).accrued_at ? String((fresh as any).accrued_at) : null,
          paid_at: (fresh as any).paid_at ? String((fresh as any).paid_at) : null,
          expense_id: (fresh as any).expense_id ? String((fresh as any).expense_id) : selectedRun.expense_id,
          cost_center_id: (fresh as any).cost_center_id ? String((fresh as any).cost_center_id) : null,
        };
        setSelectedRun(nextRun);
      }
      setIsEditingLines(false);
      showNotification('تم حفظ سطور المسير.', 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر حفظ السطور'), 'error');
    } finally {
      setSavingLines(false);
    }
  };

  const openPayModal = () => {
    if (!selectedRun) return;
    const remaining = Math.max(0, Number(selectedRun.total_net || 0) - Number(runPaidSum || 0));
    setPayAmount(Number(remaining.toFixed(2)));
    setPayMethod('cash');
    setPayOccurredAt(toDateTimeLocalInputValue());
    setPayModalOpen(true);
  };

  const confirmPay = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !selectedRun) return;
    const amount = Number(payAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      showNotification('أدخل مبلغًا صحيحًا.', 'error');
      return;
    }
    try {
      const occurredAtIso = payOccurredAt ? new Date(payOccurredAt).toISOString() : new Date().toISOString();
      const { data, error } = await supabase.rpc('record_payroll_run_payment', {
        p_run_id: selectedRun.id,
        p_amount: amount,
        p_method: payMethod,
        p_occurred_at: occurredAtIso,
      });
      if (error) throw error;
      const paymentId = typeof data === 'string' ? data : String(data || '');
      setPayModalOpen(false);
      await loadAll();
      if (paymentId) {
        const ok = window.confirm('تم تسجيل الدفع. هل تريد طباعة سند الصرف الآن؟');
        if (ok) {
          const brand = await buildBrand();
          await printPaymentVoucherByPaymentId(paymentId, brand);
        }
      }
      showNotification('تم دفع الرواتب.', 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر دفع الرواتب'), 'error');
    }
  };

  const filteredRuns = useMemo(() => runs, [runs]);

  if (loading) return <PageLoader />;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">الرواتب (Payroll)</h1>
          <div className="text-sm text-gray-500 dark:text-gray-400">مسير رواتب خفيف مرتبط بالمصروفات والقيود</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('runs')}
            className={`px-3 py-2 rounded-lg text-sm font-semibold ${tab === 'runs' ? 'bg-gray-900 text-white' : 'border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'}`}
          >
            المسيرات
          </button>
          <button
            type="button"
            onClick={() => setTab('employees')}
            className={`px-3 py-2 rounded-lg text-sm font-semibold ${tab === 'employees' ? 'bg-gray-900 text-white' : 'border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'}`}
          >
            الموظفون
          </button>
          <button
            type="button"
            onClick={() => setTab('settings')}
            className={`px-3 py-2 rounded-lg text-sm font-semibold ${tab === 'settings' ? 'bg-gray-900 text-white' : 'border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'}`}
          >
            الإعدادات
          </button>
        </div>
      </div>

      {tab === 'runs' ? (
        <div className="space-y-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4 flex flex-col md:flex-row gap-3 md:items-end md:justify-between">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full">
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">الفترة</div>
                <input
                  type="month"
                  value={createPeriod}
                  onChange={(e) => setCreatePeriod(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                />
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">ملاحظة (اختياري)</div>
                <input
                  value={createMemo}
                  onChange={(e) => setCreateMemo(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                  placeholder="مثال: رواتب الشهر + إضافات..."
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => void createRun()}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold"
            >
              إنشاء مسير
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto">
            <table className="min-w-[980px] w-full text-right">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الفترة</th>
                  <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الحالة</th>
                  <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الإجمالي</th>
                  <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">تاريخ الإنشاء</th>
                  <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredRuns.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-gray-500">لا توجد مسيرات.</td></tr>
                ) : filteredRuns.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{r.period_ym}</td>
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{r.status}</td>
                    <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{formatMoney(r.total_net)} YER</td>
                    <td className="p-3 text-sm text-gray-700 dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{formatTime(r.created_at)}</td>
                    <td className="p-3 text-sm">
                      <button
                        type="button"
                        onClick={() => void openRun(r)}
                        className="px-3 py-1 rounded bg-gray-900 text-white text-xs font-semibold"
                      >
                        عرض
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'employees' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500 dark:text-gray-400">إدارة بيانات الموظفين ورواتبهم الشهرية.</div>
            <button
              type="button"
              onClick={() => openEmployeeModal()}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold"
            >
              إضافة موظف
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto">
            <table className="min-w-[980px] w-full text-right">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الاسم</th>
                  <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الكود</th>
                  <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الراتب</th>
                  <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الحالة</th>
                  <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {employees.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-gray-500">لا توجد بيانات.</td></tr>
                ) : employees.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{e.full_name}</td>
                    <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{e.employee_code || '—'}</td>
                    <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{formatMoney(e.monthly_salary)} {String(e.currency || '').toUpperCase()}</td>
                    <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{e.is_active ? 'نشط' : 'موقوف'}</td>
                    <td className="p-3 text-sm">
                      <button
                        type="button"
                        onClick={() => openEmployeeModal(e)}
                        className="px-3 py-1 rounded bg-gray-900 text-white text-xs font-semibold"
                      >
                        تعديل
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {!canViewAccounting ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-6 text-center text-gray-500 dark:text-gray-400 font-semibold">
              لا تملك صلاحية عرض إعدادات المحاسبة.
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-bold dark:text-white">إعدادات الرواتب</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">تُستخدم هذه الإعدادات عند ترحيل استحقاق الرواتب فقط.</div>
                </div>
                <button
                  type="button"
                  disabled={!canManageAccounting || savingPayrollSettings}
                  onClick={() => void savePayrollSettings()}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-60"
                >
                  حفظ الإعدادات
                </button>
              </div>

              {payrollSettingsLoading ? (
                <div className="py-8 text-center text-gray-500 dark:text-gray-400 font-semibold">جاري التحميل...</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">حساب مصروف الرواتب (Debit)</div>
                    <select
                      value={payrollSettingsDraft.salary_expense_account_id || ''}
                      onChange={(e) => setPayrollSettingsDraft(prev => ({ ...prev, salary_expense_account_id: e.target.value || null }))}
                      disabled={!canManageAccounting}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-60"
                    >
                      <option value="">—</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {`${a.code} - ${a.name}`}
                        </option>
                      ))}
                    </select>
                    {payrollSettings.salary_expense_account_id ? (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {`الحالي: ${accounts.find(a => a.id === payrollSettings.salary_expense_account_id)?.code || ''}`}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">حساب ذمم الرواتب (Credit)</div>
                    <select
                      value={payrollSettingsDraft.salary_payable_account_id || ''}
                      onChange={(e) => setPayrollSettingsDraft(prev => ({ ...prev, salary_payable_account_id: e.target.value || null }))}
                      disabled={!canManageAccounting}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-60"
                    >
                      <option value="">—</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {`${a.code} - ${a.name}`}
                        </option>
                      ))}
                    </select>
                    {payrollSettings.salary_payable_account_id ? (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {`الحالي: ${accounts.find(a => a.id === payrollSettings.salary_payable_account_id)?.code || ''}`}
                      </div>
                    ) : null}
                  </div>

                  <div className="md:col-span-2">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">مركز تكلفة افتراضي (اختياري)</div>
                    <select
                      value={payrollSettingsDraft.default_cost_center_id || ''}
                      onChange={(e) => setPayrollSettingsDraft(prev => ({ ...prev, default_cost_center_id: e.target.value || null }))}
                      disabled={!canManageAccounting}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-60"
                    >
                      <option value="">—</option>
                      {costCenters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code ? `${c.code} - ${c.name}` : c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {!canManageAccounting ? (
                    <div className="md:col-span-2 text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-200 px-3 py-2 rounded-lg">
                      وضع القراءة فقط: تحتاج صلاحية accounting.manage لتعديل الإعدادات.
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {employeeModalOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEmployeeModalOpen(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-xl bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <div className="text-lg font-bold dark:text-white">{employeeEditing ? 'تعديل موظف' : 'إضافة موظف'}</div>
                <button type="button" onClick={() => setEmployeeModalOpen(false)} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700">إغلاق</button>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">الاسم</div>
                  <input value={employeeForm.full_name} onChange={(e) => setEmployeeForm(prev => ({ ...prev, full_name: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">الكود (اختياري)</div>
                  <input value={employeeForm.employee_code} onChange={(e) => setEmployeeForm(prev => ({ ...prev, employee_code: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono" />
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">العملة</div>
                  <input value={employeeForm.currency} onChange={(e) => setEmployeeForm(prev => ({ ...prev, currency: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono" />
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">الراتب الشهري</div>
                  <input type="number" value={employeeForm.monthly_salary} onChange={(e) => setEmployeeForm(prev => ({ ...prev, monthly_salary: Number(e.target.value) }))} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
                </div>
                <div className="flex items-center gap-2 mt-6">
                  <input id="empActive" type="checkbox" checked={employeeForm.is_active} onChange={(e) => setEmployeeForm(prev => ({ ...prev, is_active: e.target.checked }))} />
                  <label htmlFor="empActive" className="text-sm dark:text-gray-200">نشط</label>
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">ملاحظات</div>
                  <input value={employeeForm.notes} onChange={(e) => setEmployeeForm(prev => ({ ...prev, notes: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
                </div>
              </div>
              <div className="p-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-end gap-2">
                <button type="button" onClick={() => setEmployeeModalOpen(false)} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700">إلغاء</button>
                <button type="button" onClick={() => void saveEmployee()} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold">حفظ</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {runModalOpen && selectedRun && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setRunModalOpen(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-4xl bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-lg font-bold dark:text-white truncate">{`مسير رواتب ${selectedRun.period_ym}`}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{`Status: ${selectedRun.status} · Total: ${formatMoney(selectedRun.total_net)} ${baseCurrencyCode}`}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void computeSelectedRun()} className="px-3 py-2 rounded-lg bg-indigo-600 text-white font-semibold">احتساب الرواتب</button>
                  <button type="button" onClick={() => void accrueSelectedRun()} className="px-3 py-2 rounded-lg bg-blue-600 text-white font-semibold">ترحيل الاستحقاق</button>
                  <button type="button" onClick={openPayModal} className="px-3 py-2 rounded-lg bg-emerald-600 text-white font-semibold">دفع</button>
                  <button type="button" onClick={() => setRunModalOpen(false)} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700">إغلاق</button>
                </div>
              </div>
              <div className="p-4 space-y-3">
                {runLoading ? (
                  <div className="py-8 text-center text-gray-500 dark:text-gray-400 font-semibold">جاري التحميل...</div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400">إجمالي المسير</div>
                        <div className="mt-1 font-mono dark:text-white" dir="ltr">{formatMoney(selectedRun.total_net)} {baseCurrencyCode}</div>
                      </div>
                      <div className="p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400">مدفوع</div>
                        <div className="mt-1 font-mono dark:text-white" dir="ltr">{formatMoney(runPaidSum)} {baseCurrencyCode}</div>
                      </div>
                      <div className="p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400">متبقي</div>
                        <div className="mt-1 font-mono dark:text-white" dir="ltr">{formatMoney(Math.max(0, selectedRun.total_net - runPaidSum))} {baseCurrencyCode}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-2">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">مركز التكلفة (اختياري)</div>
                        <select
                          value={runCostCenterId}
                          onChange={(e) => setRunCostCenterId(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                        >
                          <option value="">—</option>
                          {costCenters.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.code ? `${c.code} - ${c.name}` : c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end gap-2">
                        <button type="button" onClick={() => void saveRunCostCenter()} className="px-3 py-2 rounded-lg bg-gray-900 text-white font-semibold">حفظ المركز</button>
                        <button type="button" onClick={() => setIsEditingLines(v => !v)} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 font-semibold dark:text-gray-200">
                          {isEditingLines ? 'إلغاء التعديل' : 'تعديل السطور'}
                        </button>
                        {isEditingLines && (
                          <button type="button" disabled={savingLines} onClick={() => void saveLines()} className="px-3 py-2 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-60">
                            حفظ السطور
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-100 dark:border-gray-700 overflow-x-auto">
                      <table className="min-w-[1180px] w-full text-right">
                        <thead>
                          <tr>
                            <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الموظف</th>
                            <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الكود</th>
                            <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">{`إجمالي (${baseCurrencyCode})`}</th>
                            <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">بدلات</th>
                            <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">استقطاع</th>
                            <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">{`صافي (${baseCurrencyCode})`}</th>
                            <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">العملة</th>
                            <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الأصلي</th>
                            <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">FX</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {runLines.length === 0 ? (
                            <tr><td colSpan={10} className="p-6 text-center text-gray-500">لا توجد سطور.</td></tr>
                          ) : runLines.map((l) => (
                            <tr key={l.id}>
                              <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{l.employee_name || '—'}</td>
                              <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{l.employee_code || '—'}</td>
                              <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">
                                {isEditingLines ? (
                                  <input
                                    type="number"
                                    value={Number(l.gross || 0)}
                                    onChange={(e) => setRunLines(prev => prev.map(x => x.id === l.id ? { ...x, gross: Number(e.target.value) } : x))}
                                    className="w-28 px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900"
                                  />
                                ) : formatMoney(l.gross)}
                              </td>
                              <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">
                                {isEditingLines ? (
                                  <input
                                    type="number"
                                    value={Number(l.allowances || 0)}
                                    onChange={(e) => setRunLines(prev => prev.map(x => x.id === l.id ? { ...x, allowances: Number(e.target.value) } : x))}
                                    className="w-24 px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900"
                                  />
                                ) : formatMoney(Number(l.allowances || 0))}
                              </td>
                              <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">
                                {isEditingLines ? (
                                  <input
                                    type="number"
                                    value={Number(l.deductions || 0)}
                                    onChange={(e) => setRunLines(prev => prev.map(x => x.id === l.id ? { ...x, deductions: Number(e.target.value) } : x))}
                                    className="w-24 px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900"
                                  />
                                ) : formatMoney(l.deductions)}
                              </td>
                              <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{formatMoney(l.net)}</td>
                              <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{l.currency_code || '—'}</td>
                              <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{Number(l.foreign_amount || 0) ? formatMoney(Number(l.foreign_amount || 0)) : '—'}</td>
                              <td className="p-3 text-sm font-mono dark:text-gray-200" dir="ltr">{Number(l.fx_rate || 0) ? String(l.fx_rate) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {payModalOpen && selectedRun && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPayModalOpen(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <div className="text-lg font-bold dark:text-white">دفع الرواتب</div>
                <button type="button" onClick={() => setPayModalOpen(false)} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700">إغلاق</button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">المبلغ</div>
                  <input type="number" value={payAmount} onChange={(e) => setPayAmount(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">طريقة الدفع</div>
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                    <option value="cash">نقدًا</option>
                    <option value="network">حوالات</option>
                    <option value="kuraimi">حسابات بنكية</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">وقت العملية</div>
                  <input type="datetime-local" value={payOccurredAt} onChange={(e) => setPayOccurredAt(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
                </div>
              </div>
              <div className="p-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-end gap-2">
                <button type="button" onClick={() => setPayModalOpen(false)} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700">إلغاء</button>
                <button type="button" onClick={() => void confirmPay()} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold">تأكيد الدفع</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
