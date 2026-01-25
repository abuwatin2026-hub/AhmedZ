import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '../../../supabase';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { sharePdf, exportToXlsx } from '../../../utils/export';
import { buildPdfBrandOptions, buildXlsxBrandOptions } from '../../../utils/branding';
import { printContent } from '../../../utils/printUtils';
import { CostCenter } from '../../../types';
import { useSettings } from '../../../contexts/SettingsContext';
import LineChart from '../../../components/admin/charts/LineChart';

type TrialBalanceRow = {
  account_code: string;
  account_name: string;
  account_type: string;
  normal_balance: string;
  debit: number;
  credit: number;
  balance: number;
};

type IncomeStatementRow = {
  income: number;
  expenses: number;
  net_profit: number;
};

type IncomeBreakdown = {
  revenue: number;
  discounts: number;
  returns: number;
  otherIncome: number;
  netRevenue: number;
  cogs: number;
  shrinkage: number;
  promotionExpense: number;
  operatingExpenses: number;
  grossProfit: number;
  netProfitDerived: number;
};

type BalanceSheetRow = {
  assets: number;
  liabilities: number;
  equity: number;
};

type LedgerRow = {
  entry_date: string;
  journal_entry_id: string;
  memo: string | null;
  source_table: string | null;
  source_id: string | null;
  source_event: string | null;
  debit: number;
  credit: number;
  amount: number;
  running_balance: number;
};

type AgingCustomerRow = {
  customer_auth_user_id: string | null;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_91_plus: number;
  total_outstanding: number;
};

type AgingSupplierRow = {
  supplier_id: string | null;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_91_plus: number;
  total_outstanding: number;
};

type AccountingPeriodRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
  closed_at: string | null;
};

type ManualLine = {
  accountCode: string;
  debit: string;
  credit: string;
  memo: string;
  costCenterId?: string;
};

type CashFlowRow = {
  operating_activities: number;
  investing_activities: number;
  financing_activities: number;
  net_cash_flow: number;
  opening_cash: number;
  closing_cash: number;
};
type ARInvoiceRow = {
  id: string;
  date: string;
  total: number;
  paid: number;
  outstanding: number;
  invoice_number?: string | null;
};
type APDocumentRow = {
  id: string;
  date: string;
  total: number;
  paid: number;
  outstanding: number;
  reference_number?: string | null;
};

type PromotionPerformanceRow = {
  promotion_id: string;
  promotion_name: string;
  usage_count: number;
  bundles_sold: number;
  gross_before_promo: number;
  net_after_promo: number;
  promotion_expense: number;
};

type PromotionUsageDrillRow = {
  promotion_usage_id: string;
  order_id: string;
  invoice_number: string | null;
  channel: string | null;
  created_at: string;
  computed_original_total: number;
  final_total: number;
  promotion_expense: number;
  journal_entry_id: string | null;
};

type PromotionExpenseDrillRow = {
  entry_date: string;
  journal_entry_id: string;
  order_id: string;
  invoice_number: string | null;
  debit: number;
  credit: number;
  amount: number;
  promotion_usage_ids: string[];
  promotion_ids: string[];
};

type OfflineReconciliationRow = {
  offline_id: string;
  order_id: string;
  warehouse_id: string | null;
  state: string;
  created_by: string | null;
  created_at: string;
  synced_at: string | null;
  updated_at: string;
  last_error: string | null;
  reconciliation_status: string;
  reconciliation_approval_request_id: string | null;
  reconciled_by: string | null;
  reconciled_at: string | null;
};

type FinancialReportFilters = {
  startDate: string;
  endDate: string;
  asOfDate: string;
  costCenterId?: string;
};

type LoadingKey = 'statements' | 'cashFlow' | 'aging' | 'periods' | 'ledger' | 'manualEntry' | 'closingPeriod' | 'creatingPeriod' | 'drilldown';

type DrilldownKind = 'income' | 'expense' | 'assets' | 'liabilities' | 'equity';

type DrilldownRow = {
  account_code: string;
  account_name: string;
  account_type: string;
  debit: number;
  credit: number;
  amount: number;
};

type AccountRow = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  normal_balance: string;
};

type JournalEntryHeader = {
  id: string;
  entry_date: string;
  memo: string | null;
  source_table: string | null;
  source_id: string | null;
  source_event: string | null;
  created_by: string | null;
  created_at: string;
  status?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  voided_by?: string | null;
  voided_at?: string | null;
  void_reason?: string | null;
};

type JournalEntryLine = {
  id: string;
  account_id: string;
  debit: number;
  credit: number;
  line_memo: string | null;
  account_code: string;
  account_name: string;
};

const toISODateLocal = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getMonthRange = (d: Date) => {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: toISODateLocal(start), end: toISODateLocal(end) };
};

const getPreviousMonthRange = (d: Date) => {
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return getMonthRange(prev);
};

const getPreviousAsOfDate = (asOf: string) => {
  if (!asOf) return '';
  const dt = new Date(asOf);
  if (Number.isNaN(dt.getTime())) return '';
  const prev = new Date(dt.getFullYear(), dt.getMonth() - 1, dt.getDate());
  return toISODateLocal(prev);
};

const computeAccountAmount = (accountType: string, debit: number, credit: number) => {
  switch (accountType) {
    case 'income':
    case 'liability':
    case 'equity':
      return (credit - debit);
    default:
      return (debit - credit);
  }
};

const formatMoney = (value: number) => {
  const n = Number(value) || 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};


const shortRef = (value: unknown, takeLast: number = 6) => {
  const s = value === null || value === undefined ? '' : String(value);
  if (!s) return '';
  if (s.length <= takeLast) return s.toUpperCase();
  return s.slice(-takeLast).toUpperCase();
};

const isUuidLike = (s: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s);

const shortenIdsInText = (text: string) => {
  return text.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, (m) => `#${shortRef(m)}`);
};

const sourceTableLabel = (t: string | null) => {
  const key = (t || '').toLowerCase();
  switch (key) {
    case 'orders':
      return 'الطلبات';
    case 'payments':
      return 'المدفوعات';
    case 'sales_returns':
      return 'المرتجعات';
    case 'inventory_movements':
      return 'حركات المخزون';
    case 'journal_entries':
      return 'القيود';
    default:
      return t || '';
  }
};

const sourceEventLabel = (e: string | null) => {
  const key = (e || '').toLowerCase();
  switch (key) {
    case 'delivered':
      return 'تم التوصيل';
    case 'cash_in':
      return 'إيداع نقدي';
    case 'cash_out':
      return 'سحب نقدي';
    case 'purchase_in':
      return 'شراء';
    case 'sale_out':
      return 'بيع';
    case 'wastage_out':
      return 'هالك';
    case 'adjust_in':
      return 'تسوية (إضافة)';
    case 'adjust_out':
      return 'تسوية (خصم)';
    default:
      return e || '';
  }
};

const ledgerTitle = (memo: string | null, sourceTable: string | null, sourceId: string | null, sourceEvent: string | null) => {
  const m = (memo || '').trim();
  if (m) {
    const deliveredMatch = m.match(/^Order delivered\s+([0-9a-fA-F-]{8,})/i);
    if (deliveredMatch) return `تم توصيل الطلب #${shortRef(deliveredMatch[1])}`;

    const inventoryMatch = m.match(/^Inventory movement\s+([a-zA-Z_]+)\s+(.+)$/i);
    if (inventoryMatch) return `حركة مخزون: ${sourceEventLabel(inventoryMatch[1])} #${shortRef(inventoryMatch[2])}`;

    return shortenIdsInText(m);
  }

  const st = sourceTableLabel(sourceTable);
  const ev = sourceEventLabel(sourceEvent);
  const sid = sourceId ? `#${shortRef(sourceId)}` : '';
  return [st, ev, sid].filter(Boolean).join(' - ') || 'قيد محاسبي';
};

const ledgerMeta = (sourceTable: string | null, sourceId: string | null, sourceEvent: string | null) => {
  const st = sourceTableLabel(sourceTable);
  const ev = sourceEventLabel(sourceEvent);
  const sid = sourceId ? `#${shortRef(sourceId)}` : '';
  return [st, sid, ev].filter(Boolean).join(' • ');
};

const formatDateInput = (d: string) => {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const FinancialReports: React.FC = () => {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const { showNotification } = useToast();
  const { user, hasPermission } = useAuth();
  const { settings } = useSettings();
  const ledgerSectionRef = useRef<HTMLDivElement | null>(null);
  const canViewAccounting = hasPermission('accounting.view');
  const canManageAccounting = hasPermission('accounting.manage');
  const canCloseAccountingPeriods = hasPermission('accounting.periods.close');
  const canApproveAccounting = hasPermission('accounting.approve');
  const canVoidAccounting = hasPermission('accounting.void');

  useEffect(() => {
    if (!canViewAccounting) {
      showNotification('ليس لديك صلاحية عرض المحاسبة.', 'error');
    }
  }, [canViewAccounting, showNotification]);

  if (!canViewAccounting) {
    return (
      <div className="p-6 text-sm text-gray-700 dark:text-gray-200">
        ليس لديك صلاحية عرض المحاسبة.
      </div>
    );
  }
  
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  useEffect(() => {
    const fetchCC = async () => {
      if (!supabase) return;
      const { data } = await supabase.from('cost_centers').select('*').eq('is_active', true).order('name');
      setCostCenters(data || []);
    };
    fetchCC();
  }, [supabase]);

  const defaultFilters = useMemo<FinancialReportFilters>(() => {
    const now = new Date();
    const { start, end } = getMonthRange(now);
    return { startDate: start, endDate: end, asOfDate: toISODateLocal(now) };
  }, []);

  const [appliedFilters, setAppliedFilters] = useState<FinancialReportFilters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<FinancialReportFilters>(defaultFilters);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const start = params.get('start') || '';
    const end = params.get('end') || '';
    const asOf = params.get('asOf') || '';
    const ccId = params.get('ccId') || '';
    if (start || end || asOf || ccId) {
      const f = { startDate: start, endDate: end, asOfDate: asOf || toISODateLocal(new Date()), costCenterId: ccId };
      setDraftFilters(f);
      setAppliedFilters(f);
    }
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    const setOrDelete = (key: string, value: string) => {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    };
    setOrDelete('start', appliedFilters.startDate);
    setOrDelete('end', appliedFilters.endDate);
    setOrDelete('asOf', appliedFilters.asOfDate);
    setOrDelete('ccId', appliedFilters.costCenterId || '');
    window.history.replaceState({}, '', url.toString());
  }, [appliedFilters]);

  const [trialBalance, setTrialBalance] = useState<TrialBalanceRow[]>([]);
  const [trialBalanceAsOf, setTrialBalanceAsOf] = useState<TrialBalanceRow[]>([]);
  const [trialBalanceAsOfDate, setTrialBalanceAsOfDate] = useState<string>('');
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatementRow | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetRow | null>(null);
  const [incomeTrend, setIncomeTrend] = useState<{ label: string; value: number }[]>([]);
  const breakdown = useMemo<IncomeBreakdown>(() => {
    const sumIncome = (filter?: (code: string) => boolean) => {
      return trialBalance
        .filter((r) => r.account_type === 'income' && (!filter || filter(r.account_code)))
        .reduce((s, r) => s + computeAccountAmount(r.account_type, r.debit, r.credit), 0);
    };
    const sumExpense = (filter?: (code: string) => boolean) => {
      return trialBalance
        .filter((r) => r.account_type === 'expense' && (!filter || filter(r.account_code)))
        .reduce((s, r) => s + computeAccountAmount(r.account_type, r.debit, r.credit), 0);
    };
    const revenue = sumIncome((code) => code.startsWith('401') || code === '4020');
    const discounts = sumIncome((code) => code === '4025');
    const returns = sumIncome((code) => code === '4026');
    const otherIncome = sumIncome((code) => code === '4021');
    const netRevenue = revenue + discounts + returns;
    const cogs = sumExpense((code) => code === '5010');
    const shrinkage = sumExpense((code) => code === '5020');
    const promotionExpense = sumExpense((code) => code === '6150');
    const operatingExpenses = sumExpense((code) => code !== '5010' && code !== '5020' && code !== '6150');
    const grossProfit = netRevenue - cogs - shrinkage;
    const netProfitDerived = grossProfit - operatingExpenses - promotionExpense + otherIncome;
    return { revenue, discounts, returns, otherIncome, netRevenue, cogs, shrinkage, promotionExpense, operatingExpenses, grossProfit, netProfitDerived };
  }, [trialBalance]);
  const [compareIncome, setCompareIncome] = useState(false);
  const [compareBalance, setCompareBalance] = useState(false);
  const [compareCashFlow, setCompareCashFlow] = useState(false);
  const [prevIncomeStatement, setPrevIncomeStatement] = useState<IncomeStatementRow | null>(null);
  const [prevBalanceSheet, setPrevBalanceSheet] = useState<BalanceSheetRow | null>(null);
  const [prevCashFlow, setPrevCashFlow] = useState<CashFlowRow | null>(null);
  const grossMarginPct = useMemo(() => {
    return breakdown.netRevenue !== 0 ? ((breakdown.grossProfit / breakdown.netRevenue) * 100) : 0;
  }, [breakdown.grossProfit, breakdown.netRevenue]);
  const netMarginPct = useMemo(() => {
    const net = (incomeStatement?.net_profit ?? breakdown.netProfitDerived);
    return breakdown.netRevenue !== 0 ? ((net / breakdown.netRevenue) * 100) : 0;
  }, [breakdown.netRevenue, breakdown.netProfitDerived, incomeStatement?.net_profit]);

  const [accountCode, setAccountCode] = useState('1010');
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountsError, setAccountsError] = useState('');
  const [ledgerQuery, setLedgerQuery] = useState('');
  const [ledgerMinAmount, setLedgerMinAmount] = useState('');
  const [ledgerView, setLedgerView] = useState<'all' | 'debit' | 'credit'>('all');
  const [ledgerSort, setLedgerSort] = useState<'asc' | 'desc'>('asc');
  const [ledgerPageSize, setLedgerPageSize] = useState(50);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [entryModalId, setEntryModalId] = useState<string | null>(null);
  const [entryHeader, setEntryHeader] = useState<JournalEntryHeader | null>(null);
  const [entryLines, setEntryLines] = useState<JournalEntryLine[]>([]);
  const [isEntryLoading, setIsEntryLoading] = useState(false);

  const [arAging, setArAging] = useState<AgingCustomerRow[]>([]);
  const [apAging, setApAging] = useState<AgingSupplierRow[]>([]);
  const [cashFlow, setCashFlow] = useState<CashFlowRow | null>(null);
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  const [supplierNames, setSupplierNames] = useState<Record<string, string>>({});
  const [arDetailsOpen, setArDetailsOpen] = useState<{ open: boolean; customerId: string; title: string }>({ open: false, customerId: '', title: '' });
  const [apDetailsOpen, setApDetailsOpen] = useState<{ open: boolean; supplierId: string; title: string }>({ open: false, supplierId: '', title: '' });
  const [arDetailsLoading, setArDetailsLoading] = useState(false);
  const [apDetailsLoading, setApDetailsLoading] = useState(false);
  const [arDetailsRows, setArDetailsRows] = useState<ARInvoiceRow[]>([]);
  const [apDetailsRows, setApDetailsRows] = useState<APDocumentRow[]>([]);

  const [periods, setPeriods] = useState<AccountingPeriodRow[]>([]);
  const [showCreatePeriodModal, setShowCreatePeriodModal] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ name: '', start_date: '', end_date: '' });

  const [manualDate, setManualDate] = useState(defaultFilters.asOfDate);
  const [manualMemo, setManualMemo] = useState('');
  const [manualLines, setManualLines] = useState<ManualLine[]>([
    { accountCode: '1010', debit: '', credit: '', memo: '', costCenterId: '' },
    { accountCode: '6100', debit: '', credit: '', memo: '', costCenterId: '' },
  ]);
  const [draftManualEntries, setDraftManualEntries] = useState<Array<{
    id: string;
    entry_date: string;
    memo: string | null;
    created_at: string;
    debit: number;
    credit: number;
  }>>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [loading, setLoading] = useState<Record<LoadingKey, boolean>>({
    statements: false,
    cashFlow: false,
    aging: false,
    periods: false,
    ledger: false,
    manualEntry: false,
    closingPeriod: false,
    drilldown: false,
    creatingPeriod: false,
  });
  const [lastUpdated, setLastUpdated] = useState<{
    statements: string | null;
    cashFlow: string | null;
    aging: string | null;
    periods: string | null;
  }>({
    statements: null,
    cashFlow: null,
    aging: null,
    periods: null,
  });

  const promoExpensePolicyText = useMemo(() => {
    return [
      'سياسة محاسبية:',
      'تُسجّل خصومات العروض الترويجية كمصروف مستقل (Promotion Expense) بدل خصمها من إيراد الصنف.',
      'الهدف هو الحفاظ على “إيراد الصنف الحقيقي” بدون تعديل، مع إظهار تكلفة التسويق كمصروف واضح وقابل للتدقيق.',
    ].join(' ');
  }, []);

  const [promotionExpenseDrillOpen, setPromotionExpenseDrillOpen] = useState(false);
  const [promotionExpenseDrillLoading, setPromotionExpenseDrillLoading] = useState(false);
  const [promotionExpenseDrillRows, setPromotionExpenseDrillRows] = useState<PromotionExpenseDrillRow[]>([]);

  const [promotionPerformanceLoading, setPromotionPerformanceLoading] = useState(false);
  const [promotionPerformanceRows, setPromotionPerformanceRows] = useState<PromotionPerformanceRow[]>([]);
  const [promotionDrillOpen, setPromotionDrillOpen] = useState<{ promotionId: string; name: string } | null>(null);
  const [promotionDrillLoading, setPromotionDrillLoading] = useState(false);
  const [promotionDrillRows, setPromotionDrillRows] = useState<PromotionUsageDrillRow[]>([]);

  const [offlineReconciliationLoading, setOfflineReconciliationLoading] = useState(false);
  const [offlineReconciliationState, setOfflineReconciliationState] = useState<string>('');
  const [offlineReconciliationRows, setOfflineReconciliationRows] = useState<OfflineReconciliationRow[]>([]);

  const isBusy = useMemo(() => Object.values(loading).some(Boolean), [loading]);

  const setLoadingKey = useCallback((key: LoadingKey, value: boolean) => {
    setLoading((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);

  const draftError = useMemo(() => {
    const { startDate, endDate } = draftFilters;
    if ((startDate && !endDate) || (!startDate && endDate)) return 'اختر تاريخ بداية ونهاية معاً، أو اتركهما فارغين.';
    if (startDate && endDate && startDate > endDate) return 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية.';
    return '';
  }, [draftFilters]);

  const isDraftDirty = useMemo(() => {
    return (
      draftFilters.startDate !== appliedFilters.startDate ||
      draftFilters.endDate !== appliedFilters.endDate ||
      draftFilters.asOfDate !== appliedFilters.asOfDate ||
      draftFilters.costCenterId !== appliedFilters.costCenterId
    );
  }, [appliedFilters, draftFilters]);

  const accountsByCode = useMemo(() => {
    const m = new Map<string, AccountRow>();
    accounts.forEach((a) => m.set(a.code, a));
    return m;
  }, [accounts]);

  const selectedAccount = useMemo(() => accountsByCode.get(accountCode) || null, [accountCode, accountsByCode]);

  const periodRangeParams = useMemo(() => {
    const p_start = appliedFilters.startDate ? appliedFilters.startDate : null;
    const p_end = appliedFilters.endDate ? appliedFilters.endDate : null;
    const p_cost_center_id = appliedFilters.costCenterId ? appliedFilters.costCenterId : null;
    return { p_start, p_end, p_cost_center_id };
  }, [appliedFilters.endDate, appliedFilters.startDate, appliedFilters.costCenterId]);

  const loadAccounts = useCallback(async () => {
    if (!supabase) return;
    try {
      setAccountsError('');
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id,code,name,account_type,normal_balance')
        .eq('is_active', true)
        .order('code', { ascending: true });
      if (error) throw error;
      setAccounts(((data as any[]) || []).map((r) => ({
        id: String(r.id),
        code: String(r.code),
        name: String(r.name),
        account_type: String(r.account_type),
        normal_balance: String(r.normal_balance),
      })));
    } catch (err: any) {
      setAccounts([]);
      setAccountsError(err?.message || 'تعذر تحميل دليل الحسابات');
    }
  }, [supabase]);

  const loadLedgerFor = useCallback(async (code: string) => {
    if (!supabase) return;
    setLoadingKey('ledger', true);
    try {
      const { data, error } = await supabase.rpc('general_ledger', {
        p_account_code: code,
        p_start: appliedFilters.startDate ? appliedFilters.startDate : null,
        p_end: appliedFilters.endDate ? appliedFilters.endDate : null,
        p_cost_center_id: appliedFilters.costCenterId ? appliedFilters.costCenterId : null,
      });
      if (error) throw error;
      setLedgerRows(((data as any[]) || []).map((r) => ({
        entry_date: String(r.entry_date),
        journal_entry_id: String(r.journal_entry_id),
        memo: typeof r.memo === 'string' ? r.memo : null,
        source_table: typeof r.source_table === 'string' ? r.source_table : null,
        source_id: typeof r.source_id === 'string' ? r.source_id : null,
        source_event: typeof r.source_event === 'string' ? r.source_event : null,
        debit: Number(r.debit) || 0,
        credit: Number(r.credit) || 0,
        amount: Number(r.amount) || 0,
        running_balance: Number(r.running_balance) || 0,
      })));
    } catch (err: any) {
      showNotification(err?.message || 'تعذر تحميل دفتر الأستاذ', 'error');
      setLedgerRows([]);
    } finally {
      setLoadingKey('ledger', false);
    }
  }, [appliedFilters.endDate, appliedFilters.startDate, setLoadingKey, showNotification, supabase]);

  const loadStatements = useCallback(async () => {
    if (!supabase) return;
    setLoadingKey('statements', true);
    try {
      const [{ data: tbData, error: tbError }, { data: isData, error: isError }, { data: bsData, error: bsError }] = await Promise.all([
        supabase.rpc('trial_balance', periodRangeParams),
        supabase.rpc('income_statement', periodRangeParams),
        supabase.rpc('balance_sheet', { 
          p_as_of: appliedFilters.asOfDate || null,
          p_cost_center_id: appliedFilters.costCenterId ? appliedFilters.costCenterId : null 
        }),
      ]);

      if (tbError) throw tbError;
      if (isError) throw isError;
      if (bsError) throw bsError;

      setTrialBalance(((tbData as any[]) || []).map((r) => ({
        account_code: String(r.account_code),
        account_name: String(r.account_name),
        account_type: String(r.account_type),
        normal_balance: String(r.normal_balance),
        debit: Number(r.debit) || 0,
        credit: Number(r.credit) || 0,
        balance: Number(r.balance) || 0,
      })));

      const isRow = ((isData as any[]) || [])[0];
      setIncomeStatement(isRow ? { income: Number(isRow.income) || 0, expenses: Number(isRow.expenses) || 0, net_profit: Number(isRow.net_profit) || 0 } : null);

      const bsRow = ((bsData as any[]) || [])[0];
      setBalanceSheet(bsRow ? { assets: Number(bsRow.assets) || 0, liabilities: Number(bsRow.liabilities) || 0, equity: Number(bsRow.equity) || 0 } : null);
      setLastUpdated((prev) => ({ ...prev, statements: new Date().toISOString() }));
    } catch (err: any) {
      showNotification(err?.message || 'تعذر تحميل القوائم المالية', 'error');
      setTrialBalance([]);
      setTrialBalanceAsOf([]);
      setTrialBalanceAsOfDate('');
      setIncomeStatement(null);
      setBalanceSheet(null);
    } finally {
      setLoadingKey('statements', false);
    }
  }, [appliedFilters.asOfDate, periodRangeParams, setLoadingKey, showNotification, supabase]);

  const getEffectiveStartEnd = useCallback(() => {
    if (appliedFilters.startDate && appliedFilters.endDate) {
      return { start: appliedFilters.startDate, end: appliedFilters.endDate };
    }
    const { start, end } = getMonthRange(new Date());
    return { start, end };
  }, [appliedFilters.endDate, appliedFilters.startDate]);

  const loadPromotionExpenseDrilldown = useCallback(async () => {
    if (!supabase) return;
    const { start, end } = getEffectiveStartEnd();
    setPromotionExpenseDrillLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_promotion_expense_drilldown', {
        p_start_date: start,
        p_end_date: end,
        p_min_amount: 0,
      });
      if (error) throw error;
      setPromotionExpenseDrillRows(((data as any[]) || []).map((r) => ({
        entry_date: String(r.entry_date),
        journal_entry_id: String(r.journal_entry_id),
        order_id: String(r.order_id),
        invoice_number: r.invoice_number ? String(r.invoice_number) : null,
        debit: Number(r.debit) || 0,
        credit: Number(r.credit) || 0,
        amount: Number(r.amount) || 0,
        promotion_usage_ids: Array.isArray(r.promotion_usage_ids) ? r.promotion_usage_ids.map((x: any) => String(x)) : [],
        promotion_ids: Array.isArray(r.promotion_ids) ? r.promotion_ids.map((x: any) => String(x)) : [],
      })));
      setPromotionExpenseDrillOpen(true);
    } catch (err: any) {
      showNotification(err?.message || 'تعذر تحميل تفاصيل مصروف العروض', 'error');
      setPromotionExpenseDrillRows([]);
      setPromotionExpenseDrillOpen(true);
    } finally {
      setPromotionExpenseDrillLoading(false);
    }
  }, [getEffectiveStartEnd, showNotification, supabase]);

  const loadPromotionPerformance = useCallback(async () => {
    if (!supabase) return;
    const { start, end } = getEffectiveStartEnd();
    setPromotionPerformanceLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_promotion_performance', {
        p_start_date: start,
        p_end_date: end,
        p_promotion_id: null,
      });
      if (error) throw error;
      setPromotionPerformanceRows(((data as any[]) || []).map((r) => ({
        promotion_id: String(r.promotion_id),
        promotion_name: String(r.promotion_name),
        usage_count: Number(r.usage_count) || 0,
        bundles_sold: Number(r.bundles_sold) || 0,
        gross_before_promo: Number(r.gross_before_promo) || 0,
        net_after_promo: Number(r.net_after_promo) || 0,
        promotion_expense: Number(r.promotion_expense) || 0,
      })));
    } catch (err: any) {
      showNotification(err?.message || 'تعذر تحميل تقرير العروض', 'error');
      setPromotionPerformanceRows([]);
    } finally {
      setPromotionPerformanceLoading(false);
    }
  }, [getEffectiveStartEnd, showNotification, supabase]);

  const openPromotionDrilldown = useCallback(async (promotionId: string, name: string) => {
    if (!supabase) return;
    const { start, end } = getEffectiveStartEnd();
    setPromotionDrillOpen({ promotionId, name });
    setPromotionDrillLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_promotion_usage_drilldown', {
        p_promotion_id: promotionId,
        p_start_date: start,
        p_end_date: end,
      });
      if (error) throw error;
      setPromotionDrillRows(((data as any[]) || []).map((r) => ({
        promotion_usage_id: String(r.promotion_usage_id),
        order_id: String(r.order_id),
        invoice_number: r.invoice_number ? String(r.invoice_number) : null,
        channel: r.channel ? String(r.channel) : null,
        created_at: String(r.created_at),
        computed_original_total: Number(r.computed_original_total) || 0,
        final_total: Number(r.final_total) || 0,
        promotion_expense: Number(r.promotion_expense) || 0,
        journal_entry_id: r.journal_entry_id ? String(r.journal_entry_id) : null,
      })));
    } catch (err: any) {
      showNotification(err?.message || 'تعذر تحميل تفاصيل العرض', 'error');
      setPromotionDrillRows([]);
    } finally {
      setPromotionDrillLoading(false);
    }
  }, [getEffectiveStartEnd, showNotification, supabase]);

  const loadOfflineReconciliation = useCallback(async () => {
    if (!supabase) return;
    setOfflineReconciliationLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_pos_offline_sales_dashboard', {
        p_state: offlineReconciliationState ? offlineReconciliationState : null,
        p_limit: 200,
      });
      if (error) throw error;
      setOfflineReconciliationRows(((data as any[]) || []).map((r) => ({
        offline_id: String(r.offline_id),
        order_id: String(r.order_id),
        warehouse_id: r.warehouse_id ? String(r.warehouse_id) : null,
        state: String(r.state),
        created_by: r.created_by ? String(r.created_by) : null,
        created_at: String(r.created_at),
        synced_at: r.synced_at ? String(r.synced_at) : null,
        updated_at: String(r.updated_at),
        last_error: typeof r.last_error === 'string' ? r.last_error : null,
        reconciliation_status: String(r.reconciliation_status || 'NONE'),
        reconciliation_approval_request_id: r.reconciliation_approval_request_id ? String(r.reconciliation_approval_request_id) : null,
        reconciled_by: r.reconciled_by ? String(r.reconciled_by) : null,
        reconciled_at: r.reconciled_at ? String(r.reconciled_at) : null,
      })));
    } catch (err: any) {
      showNotification(err?.message || 'تعذر تحميل تسوية الأوفلاين', 'error');
      setOfflineReconciliationRows([]);
    } finally {
      setOfflineReconciliationLoading(false);
    }
  }, [offlineReconciliationState, showNotification, supabase]);

  const loadStatementsComparison = useCallback(async () => {
    if (!supabase) return;
    try {
      const now = new Date(appliedFilters.startDate || toISODateLocal(new Date()));
      const { start, end } = getPreviousMonthRange(now);
      const [{ data: isData, error: isError }] = await Promise.all([
        supabase.rpc('income_statement', { 
          p_start: start || null, 
          p_end: end || null,
          p_cost_center_id: appliedFilters.costCenterId ? appliedFilters.costCenterId : null
        }),
      ]);
      if (isError) throw isError;
      const isRow = ((isData as any[]) || [])[0];
      setPrevIncomeStatement(isRow ? { income: Number(isRow.income) || 0, expenses: Number(isRow.expenses) || 0, net_profit: Number(isRow.net_profit) || 0 } : null);
    } catch (err: any) {
      setPrevIncomeStatement(null);
    }
  }, [appliedFilters.startDate, supabase]);

  const loadCashFlow = useCallback(async () => {
    if (!supabase) return;
    setLoadingKey('cashFlow', true);
    try {
      const { data: cfData, error: cfError } = await supabase.rpc('cash_flow_statement', periodRangeParams);
      if (cfError) throw cfError;

      const cfRow = ((cfData as any[]) || [])[0];
      setCashFlow(cfRow ? {
        operating_activities: Number(cfRow.operating_activities) || 0,
        investing_activities: Number(cfRow.investing_activities) || 0,
        financing_activities: Number(cfRow.financing_activities) || 0,
        net_cash_flow: Number(cfRow.net_cash_flow) || 0,
        opening_cash: Number(cfRow.opening_cash) || 0,
        closing_cash: Number(cfRow.closing_cash) || 0,
      } : null);
      setLastUpdated((prev) => ({ ...prev, cashFlow: new Date().toISOString() }));
    } catch (err: any) {
      showNotification(err?.message || 'تعذر تحميل قائمة التدفقات النقدية', 'error');
      setCashFlow(null);
    } finally {
      setLoadingKey('cashFlow', false);
    }
  }, [periodRangeParams, setLoadingKey, showNotification, supabase]);

  const loadCashFlowComparison = useCallback(async () => {
    if (!supabase) return;
    try {
      const now = new Date(appliedFilters.startDate || toISODateLocal(new Date()));
      const { start, end } = getPreviousMonthRange(now);
      const { data: cfData, error: cfError } = await supabase.rpc('cash_flow_statement', {
        p_start: start || null,
        p_end: end || null,
        p_cost_center_id: appliedFilters.costCenterId ? appliedFilters.costCenterId : null
      });
      if (cfError) throw cfError;
      const cfRow = ((cfData as any[]) || [])[0];
      setPrevCashFlow(cfRow ? {
        operating_activities: Number(cfRow.operating_activities) || 0,
        investing_activities: Number(cfRow.investing_activities) || 0,
        financing_activities: Number(cfRow.financing_activities) || 0,
        net_cash_flow: Number(cfRow.net_cash_flow) || 0,
        opening_cash: Number(cfRow.opening_cash) || 0,
        closing_cash: Number(cfRow.closing_cash) || 0,
      } : null);
    } catch {
      setPrevCashFlow(null);
    }
  }, [appliedFilters.startDate, appliedFilters.costCenterId, supabase]);
  const loadIncomeSeries = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase.rpc('income_statement_series', {
        p_start: appliedFilters.startDate ? appliedFilters.startDate : null,
        p_end: appliedFilters.endDate ? appliedFilters.endDate : null,
        p_cost_center_id: appliedFilters.costCenterId ? appliedFilters.costCenterId : null
      });
      if (error) throw error;
      const rows = ((data as any[]) || []).map((r) => ({
        label: new Date(String(r.period)).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        value: Number(r.net_profit) || 0
      }));
      setIncomeTrend(rows);
    } catch {
      setIncomeTrend([]);
    }
  }, [appliedFilters.costCenterId, appliedFilters.endDate, appliedFilters.startDate, supabase]);

  const loadLedger = useCallback(async () => {
    await loadLedgerFor(accountCode);
  }, [accountCode, loadLedgerFor]);

  const closeEntryModal = useCallback(() => {
    setEntryModalId(null);
    setEntryHeader(null);
    setEntryLines([]);
    setIsEntryLoading(false);
  }, []);

  const openEntryModal = useCallback(async (journalEntryId: string) => {
    if (!supabase) return;
    setEntryModalId(journalEntryId);
    setEntryHeader(null);
    setEntryLines([]);
    setIsEntryLoading(true);
    try {
      const [{ data: header, error: headerError }, { data: lines, error: linesError }] = await Promise.all([
        supabase
          .from('journal_entries')
          .select('id,entry_date,memo,source_table,source_id,source_event,created_by,created_at,status,approved_by,approved_at,voided_by,voided_at,void_reason')
          .eq('id', journalEntryId)
          .single(),
        supabase
          .from('journal_lines')
          .select('id,account_id,debit,credit,line_memo,chart_of_accounts(code,name)')
          .eq('journal_entry_id', journalEntryId)
          .order('created_at', { ascending: true }),
      ]);

      if (headerError) throw headerError;
      if (linesError) throw linesError;

      setEntryHeader({
        id: String((header as any).id),
        entry_date: String((header as any).entry_date),
        memo: typeof (header as any).memo === 'string' ? (header as any).memo : null,
        source_table: typeof (header as any).source_table === 'string' ? (header as any).source_table : null,
        source_id: typeof (header as any).source_id === 'string' ? (header as any).source_id : null,
        source_event: typeof (header as any).source_event === 'string' ? (header as any).source_event : null,
        created_by: (header as any).created_by ? String((header as any).created_by) : null,
        created_at: String((header as any).created_at),
        status: typeof (header as any).status === 'string' ? (header as any).status : null,
        approved_by: (header as any).approved_by ? String((header as any).approved_by) : null,
        approved_at: typeof (header as any).approved_at === 'string' ? (header as any).approved_at : null,
        voided_by: (header as any).voided_by ? String((header as any).voided_by) : null,
        voided_at: typeof (header as any).voided_at === 'string' ? (header as any).voided_at : null,
        void_reason: typeof (header as any).void_reason === 'string' ? (header as any).void_reason : null,
      });

      setEntryLines(((lines as any[]) || []).map((l) => ({
        id: String(l.id),
        account_id: String(l.account_id),
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        line_memo: typeof l.line_memo === 'string' ? l.line_memo : null,
        account_code: typeof l.chart_of_accounts?.code === 'string' ? l.chart_of_accounts.code : '',
        account_name: typeof l.chart_of_accounts?.name === 'string' ? l.chart_of_accounts.name : '',
      })));
    } catch (err: any) {
      showNotification(err?.message || 'تعذر تحميل القيد', 'error');
      closeEntryModal();
    } finally {
      setIsEntryLoading(false);
    }
  }, [closeEntryModal, showNotification, supabase]);

  const loadDraftManualEntries = useCallback(async () => {
    if (!supabase) return;
    setDraftsLoading(true);
    try {
      const { data: drafts, error } = await supabase
        .from('journal_entries')
        .select('id,entry_date,memo,created_at')
        .eq('source_table', 'manual')
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const ids = ((drafts as any[]) || []).map((d) => String(d.id));
      if (!ids.length) {
        setDraftManualEntries([]);
        return;
      }
      const { data: lines, error: linesError } = await supabase
        .from('journal_lines')
        .select('journal_entry_id,debit,credit')
        .in('journal_entry_id', ids);
      if (linesError) throw linesError;
      const totals = new Map<string, { debit: number; credit: number }>();
      ((lines as any[]) || []).forEach((l) => {
        const id = String(l.journal_entry_id);
        const prev = totals.get(id) || { debit: 0, credit: 0 };
        totals.set(id, {
          debit: prev.debit + (Number(l.debit) || 0),
          credit: prev.credit + (Number(l.credit) || 0),
        });
      });
      setDraftManualEntries(
        ((drafts as any[]) || []).map((d) => {
          const t = totals.get(String(d.id)) || { debit: 0, credit: 0 };
          return {
            id: String(d.id),
            entry_date: String(d.entry_date),
            memo: typeof d.memo === 'string' ? d.memo : null,
            created_at: String(d.created_at),
            debit: t.debit,
            credit: t.credit,
          };
        })
      );
    } catch {
      setDraftManualEntries([]);
    } finally {
      setDraftsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (!canViewAccounting) return;
    void loadDraftManualEntries();
  }, [canViewAccounting, loadDraftManualEntries]);

  const approveDraftEntry = useCallback(async (entryId: string) => {
    if (!supabase) return;
    if (!canApproveAccounting) {
      showNotification('ليس لديك صلاحية اعتماد القيود المحاسبية.', 'error');
      return;
    }
    try {
      const { data: header, error: headerError } = await supabase
        .from('journal_entries')
        .select('id, created_by')
        .eq('id', entryId)
        .maybeSingle();
      if (headerError) throw headerError;
      const createdBy = (header as any)?.created_by ? String((header as any).created_by) : '';
      if (createdBy && user?.id && createdBy === user.id) {
        throw new Error('لا يمكن اعتماد قيد أنشأته أنت.');
      }
      const { error } = await supabase.rpc('approve_journal_entry', { p_entry_id: entryId });
      if (error) throw error;
      showNotification('تم اعتماد القيد.', 'success');
      await loadDraftManualEntries();
      await loadStatements();
      await loadCashFlow();
    } catch (err: any) {
      showNotification(err?.message || 'تعذر اعتماد القيد.', 'error');
    }
  }, [canApproveAccounting, loadCashFlow, loadDraftManualEntries, loadStatements, showNotification, supabase, user?.id]);

  const voidEntry = useCallback(async (entryId: string) => {
    if (!supabase) return;
    if (!canVoidAccounting) {
      showNotification('ليس لديك صلاحية عكس/إلغاء القيود المحاسبية.', 'error');
      return;
    }
    const reason = window.prompt('أدخل سبب عكس/إلغاء القيد:') || '';
    if (!reason.trim()) return;
    try {
      const { error } = await supabase.rpc('void_journal_entry', { p_entry_id: entryId, p_reason: reason.trim() });
      if (error) throw error;
      showNotification('تم عكس/إلغاء القيد بنجاح.', 'success');
      await loadStatements();
      await loadCashFlow();
      closeEntryModal();
    } catch (err: any) {
      showNotification(err?.message || 'تعذر عكس/إلغاء القيد.', 'error');
    }
  }, [canVoidAccounting, closeEntryModal, loadCashFlow, loadStatements, showNotification, supabase]);

  const loadTrialBalanceAsOf = useCallback(async (asOfDate: string) => {
    if (!supabase) return;
    setLoadingKey('drilldown', true);
    try {
      const { data, error } = await supabase.rpc('trial_balance', {
        p_start: null,
        p_end: asOfDate || null,
        p_cost_center_id: appliedFilters.costCenterId || null
      });
      if (error) throw error;
      const rows = ((data as any[]) || []).map((r) => ({
        account_code: String(r.account_code),
        account_name: String(r.account_name),
        account_type: String(r.account_type),
        normal_balance: String(r.normal_balance),
        debit: Number(r.debit) || 0,
        credit: Number(r.credit) || 0,
        balance: Number(r.balance) || 0,
      })) as TrialBalanceRow[];
      setTrialBalanceAsOf(rows);
      setTrialBalanceAsOfDate(asOfDate);
    } catch (err: any) {
      showNotification(err?.message || 'تعذر تحميل ميزان المراجعة (كما في)', 'error');
      setTrialBalanceAsOf([]);
      setTrialBalanceAsOfDate('');
    } finally {
      setLoadingKey('drilldown', false);
    }
  }, [setLoadingKey, showNotification, supabase]);

  const loadBalanceSheetComparison = useCallback(async () => {
    if (!supabase) return;
    try {
      const prevAsOf = getPreviousAsOfDate(appliedFilters.asOfDate);
      if (!prevAsOf) {
        setPrevBalanceSheet(null);
        return;
      }
      const { data: bsData, error: bsError } = await supabase.rpc('balance_sheet', { 
        p_as_of: prevAsOf || null,
        p_cost_center_id: appliedFilters.costCenterId ? appliedFilters.costCenterId : null
      });
      if (bsError) throw bsError;
      const bsRow = ((bsData as any[]) || [])[0];
      setPrevBalanceSheet(bsRow ? { assets: Number(bsRow.assets) || 0, liabilities: Number(bsRow.liabilities) || 0, equity: Number(bsRow.equity) || 0 } : null);
    } catch {
      setPrevBalanceSheet(null);
    }
  }, [appliedFilters.asOfDate, supabase]);

  useEffect(() => {
    if (compareIncome) void loadStatementsComparison();
    else setPrevIncomeStatement(null);
  }, [compareIncome, loadStatementsComparison]);
  useEffect(() => {
    void loadIncomeSeries();
  }, [loadIncomeSeries]);

  useEffect(() => {
    if (compareCashFlow) void loadCashFlowComparison();
    else setPrevCashFlow(null);
  }, [compareCashFlow, loadCashFlowComparison]);

  useEffect(() => {
    if (compareBalance) void loadBalanceSheetComparison();
    else setPrevBalanceSheet(null);
  }, [compareBalance, loadBalanceSheetComparison]);

  const [drilldown, setDrilldown] = useState<{ open: boolean; kind: DrilldownKind; title: string }>({
    open: false,
    kind: 'income',
    title: '',
  });

  const openDrilldown = useCallback(async (kind: DrilldownKind) => {
    if (kind === 'assets' || kind === 'liabilities' || kind === 'equity') {
      if (trialBalanceAsOfDate !== appliedFilters.asOfDate) {
        await loadTrialBalanceAsOf(appliedFilters.asOfDate);
      }
    }
    const titleByKind: Record<DrilldownKind, string> = {
      income: 'تفاصيل الدخل',
      expense: 'تفاصيل المصاريف',
      assets: 'تفاصيل الأصول',
      liabilities: 'تفاصيل الالتزامات',
      equity: 'تفاصيل حقوق الملكية',
    };
    setDrilldown({ open: true, kind, title: titleByKind[kind] });
  }, [appliedFilters.asOfDate, loadTrialBalanceAsOf, trialBalanceAsOfDate]);

  const closeDrilldown = useCallback(() => setDrilldown((prev) => ({ ...prev, open: false })), []);

  const drilldownRows = useMemo<DrilldownRow[]>(() => {
    const base = (drilldown.kind === 'assets' || drilldown.kind === 'liabilities' || drilldown.kind === 'equity')
      ? trialBalanceAsOf
      : trialBalance;

    const typeMap: Record<DrilldownKind, string> = {
      income: 'income',
      expense: 'expense',
      assets: 'asset',
      liabilities: 'liability',
      equity: 'equity',
    };

    const desiredType = typeMap[drilldown.kind];
    return base
      .filter((r) => r.account_type === desiredType)
      .map((r) => ({
        account_code: r.account_code,
        account_name: r.account_name,
        account_type: r.account_type,
        debit: r.debit,
        credit: r.credit,
        amount: computeAccountAmount(r.account_type, r.debit, r.credit),
      }))
      .filter((r) => Math.abs(r.amount) > 1e-9)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }, [drilldown.kind, trialBalance, trialBalanceAsOf]);

  const drilldownTotal = useMemo(() => drilldownRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0), [drilldownRows]);

  const handleDrilldownAccountClick = useCallback(async (code: string) => {
    setAccountCode(code);
    closeDrilldown();
    await loadLedgerFor(code);
    ledgerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [closeDrilldown, loadLedgerFor]);

  useEffect(() => {
    if (!drilldown.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrilldown();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDrilldown, drilldown.open]);

  const loadAging = useCallback(async () => {
    if (!supabase) return;
    
    // Aging reports do not support Cost Center filtering yet.
    if (appliedFilters.costCenterId) {
      setArAging([]);
      setApAging([]);
      return;
    }

    setLoadingKey('aging', true);
    try {
      const [{ data: arData, error: arError }, { data: apData, error: apError }] = await Promise.all([
        supabase.rpc('ar_aging_summary', { p_as_of: appliedFilters.asOfDate || null }),
        supabase.rpc('ap_aging_summary', { p_as_of: appliedFilters.asOfDate || null }),
      ]);
      if (arError) throw arError;
      if (apError) throw apError;

      setArAging(((arData as any[]) || []).map((r) => ({
        customer_auth_user_id: r.customer_auth_user_id ? String(r.customer_auth_user_id) : null,
        current: Number(r.current) || 0,
        days_1_30: Number(r.days_1_30) || 0,
        days_31_60: Number(r.days_31_60) || 0,
        days_61_90: Number(r.days_61_90) || 0,
        days_91_plus: Number(r.days_91_plus) || 0,
        total_outstanding: Number(r.total_outstanding) || 0,
      })));

      setApAging(((apData as any[]) || []).map((r) => ({
        supplier_id: r.supplier_id ? String(r.supplier_id) : null,
        current: Number(r.current) || 0,
        days_1_30: Number(r.days_1_30) || 0,
        days_31_60: Number(r.days_31_60) || 0,
        days_61_90: Number(r.days_61_90) || 0,
        days_91_plus: Number(r.days_91_plus) || 0,
        total_outstanding: Number(r.total_outstanding) || 0,
      })));
      setLastUpdated((prev) => ({ ...prev, aging: new Date().toISOString() }));
    } catch (err: any) {
      showNotification(err?.message || 'تعذر تحميل أعمار الذمم', 'error');
      setArAging([]);
      setApAging([]);
    } finally {
      setLoadingKey('aging', false);
    }
  }, [appliedFilters.asOfDate, setLoadingKey, showNotification, supabase]);

  const loadPeriods = useCallback(async () => {
    if (!supabase) return;
    setLoadingKey('periods', true);
    try {
      const { data, error } = await supabase
        .from('accounting_periods')
        .select('id,name,start_date,end_date,status,closed_at')
        .order('start_date', { ascending: false });
      if (error) throw error;
      setPeriods(((data as any[]) || []).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        start_date: String(r.start_date),
        end_date: String(r.end_date),
        status: r.status === 'closed' ? 'closed' : 'open',
        closed_at: typeof r.closed_at === 'string' ? r.closed_at : null,
      })));
      setLastUpdated((prev) => ({ ...prev, periods: new Date().toISOString() }));
    } catch (err: any) {
      showNotification(err?.message || 'تعذر تحميل الفترات المحاسبية', 'error');
      setPeriods([]);
    } finally {
      setLoadingKey('periods', false);
    }
  }, [setLoadingKey, showNotification, supabase]);

  useEffect(() => {
    void loadStatements();
    void loadCashFlow();
    void loadAging();
    void loadPeriods();
    void loadPromotionPerformance();
    void loadOfflineReconciliation();
  }, [appliedFilters, loadAging, loadCashFlow, loadOfflineReconciliation, loadPeriods, loadPromotionPerformance, loadStatements]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);
  useEffect(() => {
    const ids = Array.from(new Set(arAging.map((r) => r.customer_auth_user_id).filter(Boolean))) as string[];
    if (!supabase || ids.length === 0) return;
    void supabase
      .from('customers')
      .select('auth_user_id,full_name,phone_number')
      .in('auth_user_id', ids)
      .then(({ data, error }) => {
        if (error) return;
        const map: Record<string, string> = {};
        ((data as any[]) || []).forEach((c) => {
          const name = typeof c.full_name === 'string' && c.full_name.trim() ? c.full_name : (typeof c.phone_number === 'string' ? c.phone_number : '');
          map[String(c.auth_user_id)] = name;
        });
        setCustomerNames((prev) => ({ ...prev, ...map }));
      });
  }, [arAging, supabase]);
  useEffect(() => {
    const ids = Array.from(new Set(apAging.map((r) => r.supplier_id).filter(Boolean))) as string[];
    if (!supabase || ids.length === 0) return;
    void supabase
      .from('suppliers')
      .select('id,name,phone')
      .in('id', ids)
      .then(({ data, error }) => {
        if (error) return;
        const map: Record<string, string> = {};
        ((data as any[]) || []).forEach((s) => {
          const name = typeof s.name === 'string' && s.name.trim() ? s.name : (typeof s.phone === 'string' ? s.phone : '');
          map[String(s.id)] = name;
        });
        setSupplierNames((prev) => ({ ...prev, ...map }));
      });
  }, [apAging, supabase]);
  const openArDetails = useCallback(async (customerId: string) => {
    if (!supabase || !customerId) return;
    setArDetailsOpen({ open: true, customerId, title: customerNames[customerId] || `#${shortRef(customerId, 8)}` });
    setArDetailsLoading(true);
  try {
      const { data: orders, error: oErr } = await supabase
        .from('orders')
        .select('id,updated_at,data,status,customer_auth_user_id,invoice_number')
        .eq('status', 'delivered')
        .eq('customer_auth_user_id', customerId)
        .lte('updated_at', appliedFilters.asOfDate || null)
        .order('updated_at', { ascending: false });
      if (oErr) throw oErr;
      const orderIds = ((orders as any[]) || []).map((o) => String(o.id));
      const { data: pays, error: pErr } = await supabase
        .from('payments')
        .select('reference_id,amount,direction,occurred_at,reference_table')
        .eq('reference_table', 'orders')
        .eq('direction', 'in')
        .lte('occurred_at', appliedFilters.asOfDate || null)
        .in('reference_id', orderIds);
      if (pErr) throw pErr;
      const paidMap = new Map<string, number>();
      ((pays as any[]) || []).forEach((p) => {
        const id = String(p.reference_id);
        const amt = Number(p.amount) || 0;
        paidMap.set(id, (paidMap.get(id) || 0) + amt);
      });
      const rows = ((orders as any[]) || []).map((o) => {
        const total = Number(o?.data?.total) || 0;
        const paid = paidMap.get(String(o.id)) || 0;
        const outstanding = Math.max(0, total - paid);
        return { id: String(o.id), date: String(o.updated_at), total, paid, outstanding, invoice_number: typeof o.invoice_number === 'string' ? o.invoice_number : null };
      }).filter((r) => r.outstanding > 1e-9);
      setArDetailsRows(rows);
    } catch (err: any) {
      setArDetailsRows([]);
      setArDetailsOpen((prev) => ({ ...prev, title: prev.title || 'تفاصيل' }));
    } finally {
      setArDetailsLoading(false);
    }
  }, [appliedFilters.asOfDate, customerNames, supabase]);
  const openApDetails = useCallback(async (supplierId: string) => {
    if (!supabase || !supplierId) return;
    setApDetailsOpen({ open: true, supplierId, title: supplierNames[supplierId] || `#${shortRef(supplierId, 8)}` });
    setApDetailsLoading(true);
  try {
      const { data: pos, error: poErr } = await supabase
        .from('purchase_orders')
        .select('id,purchase_date,status,total_amount,paid_amount,supplier_id,reference_number')
        .neq('status', 'cancelled')
        .eq('supplier_id', supplierId)
        .lte('purchase_date', appliedFilters.asOfDate || null)
        .order('purchase_date', { ascending: false });
      if (poErr) throw poErr;
      const poIds = ((pos as any[]) || []).map((p) => String(p.id));
      const { data: pays, error: pErr } = await supabase
        .from('payments')
        .select('reference_id,amount,direction,occurred_at,reference_table')
        .eq('reference_table', 'purchase_orders')
        .eq('direction', 'out')
        .lte('occurred_at', appliedFilters.asOfDate || null)
        .in('reference_id', poIds);
      if (pErr) throw pErr;
      const paidMap = new Map<string, number>();
      ((pays as any[]) || []).forEach((p) => {
        const id = String(p.reference_id);
        const amt = Number(p.amount) || 0;
        paidMap.set(id, (paidMap.get(id) || 0) + amt);
      });
      const rows = ((pos as any[]) || []).map((p) => {
        const total = Number(p.total_amount) || 0;
        const paid = paidMap.get(String(p.id)) || 0;
        const outstanding = Math.max(0, total - paid);
        return { id: String(p.id), date: String(p.purchase_date), total, paid, outstanding, reference_number: typeof p.reference_number === 'string' ? p.reference_number : null };
      }).filter((r) => r.outstanding > 1e-9);
      setApDetailsRows(rows);
    } catch {
      setApDetailsRows([]);
      setApDetailsOpen((prev) => ({ ...prev, title: prev.title || 'تفاصيل' }));
    } finally {
      setApDetailsLoading(false);
    }
  }, [appliedFilters.asOfDate, supplierNames, supabase]);

  useEffect(() => {
    if (!entryModalId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeEntryModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeEntryModal, entryModalId]);

  const ledgerMinAmountNumber = useMemo(() => {
    const n = Number(ledgerMinAmount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [ledgerMinAmount]);

  const filteredLedgerRows = useMemo(() => {
    const q = ledgerQuery.trim().toLowerCase();
    let rows = ledgerRows;

    if (ledgerView !== 'all') {
      rows = rows.filter((r) => (ledgerView === 'debit' ? r.debit > 0 : r.credit > 0));
    }

    if (ledgerMinAmountNumber > 0) {
      rows = rows.filter((r) => Math.abs(Number(r.amount) || 0) >= ledgerMinAmountNumber);
    }

    if (q) {
      rows = rows.filter((r) => {
        const hay = [
          r.memo || '',
          r.source_table || '',
          r.source_id || '',
          r.source_event || '',
          r.journal_entry_id,
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    const sorted = [...rows].sort((a, b) => {
      const da = a.entry_date;
      const db = b.entry_date;
      if (da !== db) return ledgerSort === 'asc' ? (da < db ? -1 : 1) : (da < db ? 1 : -1);
      if (a.journal_entry_id !== b.journal_entry_id) return a.journal_entry_id < b.journal_entry_id ? -1 : 1;
      return (Number(a.debit) || 0) - (Number(b.debit) || 0);
    });

    return sorted;
  }, [ledgerMinAmountNumber, ledgerQuery, ledgerRows, ledgerSort, ledgerView]);

  const ledgerPageCount = useMemo(() => {
    const total = filteredLedgerRows.length;
    return Math.max(1, Math.ceil(total / Math.max(1, ledgerPageSize)));
  }, [filteredLedgerRows.length, ledgerPageSize]);

  useEffect(() => {
    setLedgerPage(1);
  }, [accountCode, ledgerMinAmountNumber, ledgerPageSize, ledgerQuery, ledgerSort, ledgerView]);

  useEffect(() => {
    setLedgerPage((p) => Math.min(Math.max(1, p), ledgerPageCount));
  }, [ledgerPageCount]);

  const pagedLedgerRows = useMemo(() => {
    const size = Math.max(1, ledgerPageSize);
    const page = Math.min(Math.max(1, ledgerPage), ledgerPageCount);
    const start = (page - 1) * size;
    return filteredLedgerRows.slice(start, start + size);
  }, [filteredLedgerRows, ledgerPage, ledgerPageCount, ledgerPageSize]);

  const exportLedgerCsv = useCallback(async (rows: LedgerRow[]) => {
    const headers = ['date', 'journal_entry_id', 'memo', 'source_table', 'source_id', 'source_event', 'debit', 'credit', 'amount', 'running_balance'];
    const data: (string | number)[][] = rows.map(r => ([
      r.entry_date,
      r.journal_entry_id,
      r.memo || '',
      r.source_table || '',
      r.source_id || '',
      r.source_event || '',
      Number(r.debit) || 0,
      Number(r.credit) || 0,
      Number(r.amount) || 0,
      Number(r.running_balance) || 0,
    ]));
    await exportToXlsx(
      headers,
      data,
      `ledger_${accountCode}_${appliedFilters.startDate || 'all'}_${appliedFilters.endDate || 'all'}.xlsx`,
      { 
        sheetName: 'Ledger', 
        currencyColumns: [6, 7, 8, 9], 
        currencyFormat: '#,##0.00',
        preludeRows: [
          [settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '', '', '', '', '', '', '', '', '', ''],
          ['تقرير: دفتر الأستاذ','','','','','','','','',''],
          [`الفترة: ${appliedFilters.startDate || '—'} → ${appliedFilters.endDate || '—'}`,'','','','','','','','','']
        ],
        accentColor: settings.brandColors?.primary || '#2F2B7C'
      }
    );
  }, [accountCode, appliedFilters.endDate, appliedFilters.startDate]);

  const createPeriod = async () => {
    if (!supabase || !newPeriod.name || !newPeriod.start_date || !newPeriod.end_date) return;
    if (!canManageAccounting) {
      showNotification('ليس لديك صلاحية إدارة المحاسبة.', 'error');
      return;
    }
    setLoadingKey('creatingPeriod', true);
    try {
      const { error } = await supabase.from('accounting_periods').insert({
        name: newPeriod.name,
        start_date: newPeriod.start_date,
        end_date: newPeriod.end_date,
        status: 'open',
      });
      if (error) throw error;
      showNotification('تم إنشاء الفترة بنجاح', 'success');
      setShowCreatePeriodModal(false);
      setNewPeriod({ name: '', start_date: '', end_date: '' });
      await loadPeriods();
    } catch (err: any) {
      showNotification(err?.message || 'تعذر إنشاء الفترة', 'error');
    } finally {
      setLoadingKey('creatingPeriod', false);
    }
  };

  const closePeriod = async (periodId: string) => {
    if (!supabase) return;
    if (!canCloseAccountingPeriods) {
      showNotification('ليس لديك صلاحية إقفال الفترات المحاسبية.', 'error');
      return;
    }
    setLoadingKey('closingPeriod', true);
    try {
      const { error } = await supabase.rpc('close_accounting_period', { p_period_id: periodId });
      if (error) throw error;
      showNotification('تم إقفال الفترة بنجاح', 'success');
      await loadPeriods();
    } catch (err: any) {
      showNotification(err?.message || 'تعذر إقفال الفترة', 'error');
    } finally {
      setLoadingKey('closingPeriod', false);
    }
  };

  const totals = useMemo(() => {
    const debit = manualLines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
    const credit = manualLines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
    return { debit, credit, diff: debit - credit };
  }, [manualLines]);

  const submitManualEntry = async () => {
    if (!supabase) return;
    if (!canManageAccounting) {
      showNotification('ليس لديك صلاحية إدارة المحاسبة.', 'error');
      return;
    }
    setLoadingKey('manualEntry', true);
    try {
      const payloadLines = manualLines
        .map((l) => ({
          accountCode: l.accountCode.trim(),
          debit: l.debit ? Number(l.debit) : 0,
          credit: l.credit ? Number(l.credit) : 0,
          memo: l.memo.trim(),
          costCenterId: l.costCenterId || null,
        }))
        .filter((l) => l.accountCode && ((l.debit > 0) !== (l.credit > 0)));

      const { data, error } = await supabase.rpc('create_manual_journal_entry', {
        p_entry_date: new Date(`${manualDate}T12:00:00.000Z`).toISOString(),
        p_memo: manualMemo,
        p_lines: payloadLines,
      });
      if (error) throw error;
      const entryId = typeof data === 'string' ? data : (data ? String(data) : '');
      showNotification('تم حفظ القيد كمسودة بانتظار الاعتماد.', 'success');
      setManualMemo('');
      setManualLines([
        { accountCode: '1010', debit: '', credit: '', memo: '', costCenterId: '' },
        { accountCode: '6100', debit: '', credit: '', memo: '', costCenterId: '' },
      ]);
      await loadDraftManualEntries();
      if (entryId) {
        await openEntryModal(entryId);
      }
    } catch (err: any) {
      showNotification(err?.message || 'تعذر إنشاء القيد', 'error');
    } finally {
      setLoadingKey('manualEntry', false);
    }
  };

  return (
    <div className="animate-fade-in space-y-8">
      {entryModalId && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeEntryModal} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-3xl bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-700">
                <div className="min-w-0">
                  <div className="text-lg font-bold dark:text-white truncate">تفاصيل القيد</div>
                  {entryHeader && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1" dir="ltr">
                      {formatDateInput(String(entryHeader.entry_date))} · {isUuidLike(entryHeader.id) ? `#${shortRef(entryHeader.id, 8)}` : entryHeader.id}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {entryHeader?.status === 'draft' && canApproveAccounting && (
                    <button
                      type="button"
                      onClick={() => void approveDraftEntry(entryHeader.id)}
                      className="px-3 py-2 rounded-lg bg-green-600 text-white font-semibold"
                    >
                      اعتماد
                    </button>
                  )}
                  {entryHeader?.status !== 'draft' && canVoidAccounting && entryHeader && (
                    <button
                      type="button"
                      onClick={() => void voidEntry(entryHeader.id)}
                      className="px-3 py-2 rounded-lg bg-red-600 text-white font-semibold"
                    >
                      عكس/إلغاء
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={closeEntryModal}
                    className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    إغلاق
                  </button>
                </div>
              </div>
              <div className="p-4 space-y-4">
                {isEntryLoading && (
                  <div className="py-8 text-center text-gray-500 dark:text-gray-400 font-semibold">جاري التحميل...</div>
                )}
                {!isEntryLoading && entryHeader && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                      <div className="text-xs text-gray-500 dark:text-gray-400">البيان</div>
                      <div className="mt-1 font-semibold dark:text-white">
                        {ledgerTitle(entryHeader.memo, entryHeader.source_table, entryHeader.source_id, entryHeader.source_event) || '—'}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                      <div className="text-xs text-gray-500 dark:text-gray-400">المصدر</div>
                      <div
                        className="mt-1 text-sm dark:text-white"
                        title={[entryHeader.source_table, entryHeader.source_id, entryHeader.source_event].filter(Boolean).join(' / ') || ''}
                      >
                        {ledgerMeta(entryHeader.source_table, entryHeader.source_id, entryHeader.source_event) || '—'}
                      </div>
                    </div>
                  </div>
                )}
                {!isEntryLoading && (
                  <div className="overflow-auto max-h-[50vh]">
                    <table className="min-w-full text-sm">
                      <thead className="text-gray-500 dark:text-gray-400">
                        <tr className="border-b dark:border-gray-700">
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">الحساب</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">مدين</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">دائن</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">ملاحظة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entryLines.map((l) => (
                          <tr key={l.id} className="border-b dark:border-gray-700">
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">
                              <div className="font-semibold">{l.account_name || '—'}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{l.account_code || ''}</div>
                            </td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(l.debit)}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(l.credit)}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{l.line_memo || ''}</td>
                          </tr>
                        ))}
                        {entryLines.length === 0 && (
                          <tr><td colSpan={4} className="py-8 text-center text-gray-500 dark:text-gray-400">لا توجد أسطر</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
            <div className="p-3 rounded-lg border border-gray-100 dark:border-gray-700 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400">هامش الربح الإجمالي</div>
              <div className="text-xl font-bold dark:text-white" dir="ltr">{grossMarginPct.toFixed(1)}%</div>
            </div>
            <div className="p-3 rounded-lg border border-gray-100 dark:border-gray-700 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400">هامش الربح الصافي</div>
              <div className="text-xl font-bold dark:text-white" dir="ltr">{netMarginPct.toFixed(1)}%</div>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-sm text-gray-500 dark:text-gray-400">اتجاه صافي الربح (شهرياً)</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const headers = ['الفترة', 'صافي الربح'];
                    const rows = incomeTrend.map((r) => [r.label, r.value]);
                    void exportToXlsx(
                      headers, 
                      rows, 
                      `income_trend_${appliedFilters.startDate || 'all'}_${appliedFilters.endDate || 'all'}.xlsx`, 
                      { sheetName: 'Net Profit Trend', currencyColumns: [1], currencyFormat: '#,##0.00', ...buildXlsxBrandOptions(settings, 'اتجاه صافي الربح', headers.length, { periodText: `الفترة: ${appliedFilters.startDate || '—'} → ${appliedFilters.endDate || '—'}` }) }
                    );
                  }}
                  className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200"
                >
                  تصدير Excel
                </button>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-2">
              <LineChart data={incomeTrend} title="" unit="ر.ي" color="#22c55e" showArea={true} />
            </div>
          </div>
        </div>
      )}
      {promotionExpenseDrillOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPromotionExpenseDrillOpen(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-4xl bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-700">
                <div className="min-w-0">
                  <div className="text-lg font-bold dark:text-white truncate">تفاصيل مصروف العروض (6150)</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    الرابط: قائمة الدخل → دفتر الأستاذ → القيد
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAccountCode('6150');
                      void loadLedgerFor('6150');
                      ledgerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      setPromotionExpenseDrillOpen(false);
                    }}
                    className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    فتح دفتر الأستاذ
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromotionExpenseDrillOpen(false)}
                    className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    إغلاق
                  </button>
                </div>
              </div>
              <div className="p-4">
                {promotionExpenseDrillLoading && <div className="py-8 text-center text-gray-500 dark:text-gray-400 font-semibold">جاري التحميل...</div>}
                {!promotionExpenseDrillLoading && (
                  <div className="overflow-auto max-h-[70vh]">
                    <table className="min-w-full text-sm">
                      <thead className="text-gray-500 dark:text-gray-400">
                        <tr className="border-b dark:border-gray-700">
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">التاريخ</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">الفاتورة</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">المبلغ</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">الطلب</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">القيد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {promotionExpenseDrillRows.map((r) => (
                          <tr key={`${r.journal_entry_id}-${r.order_id}`} className="border-b dark:border-gray-700">
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatDateInput(r.entry_date)}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{r.invoice_number ? r.invoice_number : '—'}</td>
                            <td className="py-2 px-3 font-bold dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.amount)}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">#{shortRef(r.order_id, 8)}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">
                              <button
                                type="button"
                                onClick={() => void openEntryModal(r.journal_entry_id)}
                                className="px-2 py-1 rounded-md bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 text-xs font-semibold"
                                dir="ltr"
                              >
                                #{shortRef(r.journal_entry_id, 8)}
                              </button>
                            </td>
                          </tr>
                        ))}
                        {promotionExpenseDrillRows.length === 0 && (
                          <tr><td colSpan={5} className="py-8 text-center text-gray-500 dark:text-gray-400">لا توجد بيانات</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {promotionDrillOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPromotionDrillOpen(null)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-5xl bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-700">
                <div className="min-w-0">
                  <div className="text-lg font-bold dark:text-white truncate">تفاصيل العرض</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate" dir="ltr">
                    {promotionDrillOpen.name} · {promotionDrillOpen.promotionId}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPromotionDrillOpen(null)}
                  className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  إغلاق
                </button>
              </div>
              <div className="p-4">
                {promotionDrillLoading && <div className="py-8 text-center text-gray-500 dark:text-gray-400 font-semibold">جاري التحميل...</div>}
                {!promotionDrillLoading && (
                  <div className="overflow-auto max-h-[70vh]">
                    <table className="min-w-full text-sm">
                      <thead className="text-gray-500 dark:text-gray-400">
                        <tr className="border-b dark:border-gray-700">
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">التاريخ</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">الفاتورة</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">قبل</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">بعد</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">تكلفة العرض</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">القيد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {promotionDrillRows.map((r) => (
                          <tr key={r.promotion_usage_id} className="border-b dark:border-gray-700">
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatDateInput(r.created_at)}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{r.invoice_number ? r.invoice_number : `#${shortRef(r.order_id, 8)}`}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.computed_original_total)}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.final_total)}</td>
                            <td className="py-2 px-3 font-bold dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.promotion_expense)}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">
                              {r.journal_entry_id ? (
                                <button
                                  type="button"
                                  onClick={() => void openEntryModal(r.journal_entry_id as string)}
                                  className="px-2 py-1 rounded-md bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 text-xs font-semibold"
                                  dir="ltr"
                                >
                                  #{shortRef(r.journal_entry_id, 8)}
                                </button>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))}
                        {promotionDrillRows.length === 0 && (
                          <tr><td colSpan={6} className="py-8 text-center text-gray-500 dark:text-gray-400">لا توجد بيانات</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {arDetailsOpen.open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setArDetailsOpen({ open: false, customerId: '', title: '' })} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-3xl bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-700">
                <div className="min-w-0">
                  <div className="text-lg font-bold dark:text-white truncate">طلبات العميل</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{arDetailsOpen.title}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ['المرجع', 'التاريخ', 'الإجمالي', 'المدفوع', 'المتبقي'];
                      const rows = arDetailsRows.map((r) => ([
                        r.invoice_number ? r.invoice_number : `#${shortRef(r.id, 8)}`,
                        new Date(r.date).toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }),
                        r.total,
                        r.paid,
                        r.outstanding,
                      ]));
                      void exportToXlsx(
                        headers,
                        rows,
                        `ar_details_${appliedFilters.asOfDate || 'asof'}.xlsx`,
                        { 
                          sheetName: 'AR Details', 
                          currencyColumns: [2, 3, 4], 
                          currencyFormat: '#,##0.00',
                          preludeRows: [
                            [settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '', '','','',''],
                            ['تقرير: تفاصيل ذمم العملاء','','','',''],
                            [`كما في: ${appliedFilters.asOfDate || '—'}`,'','','','']
                          ],
                          accentColor: settings.brandColors?.primary || '#2F2B7C'
                        }
                      );
                    }}
                    className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    تصدير Excel
                  </button>
                  <button type="button" onClick={() => setArDetailsOpen({ open: false, customerId: '', title: '' })} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700">إغلاق</button>
                </div>
              </div>
              <div className="p-4">
                {arDetailsLoading && <div className="py-8 text-center text-gray-500 dark:text-gray-400 font-semibold">جاري التحميل...</div>}
                {!arDetailsLoading && (
                  <div className="overflow-auto max-h-[70vh]">
                    <table className="min-w-full text-sm">
                      <thead className="text-gray-500 dark:text-gray-400">
                        <tr className="border-b dark:border-gray-700">
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">المرجع</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">التاريخ</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">الإجمالي</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">المدفوع</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">المتبقي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {arDetailsRows.map((r) => (
                          <tr key={r.id} className="border-b dark:border-gray-700">
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{r.invoice_number ? r.invoice_number : `#${shortRef(r.id, 8)}`}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{new Date(r.date).toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.total)}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.paid)}</td>
                            <td className="py-2 px-3 font-bold dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.outstanding)}</td>
                          </tr>
                        ))}
                        {arDetailsRows.length === 0 && (
                          <tr><td colSpan={5} className="py-8 text-center text-gray-500 dark:text-gray-400">لا توجد بيانات</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {apDetailsOpen.open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setApDetailsOpen({ open: false, supplierId: '', title: '' })} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-3xl bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-700">
                <div className="min-w-0">
                  <div className="text-lg font-bold dark:text-white truncate">مستندات المورد</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{apDetailsOpen.title}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ['المرجع', 'التاريخ', 'الإجمالي', 'المدفوع', 'المتبقي'];
                      const rows = apDetailsRows.map((r) => ([
                        r.reference_number ? r.reference_number : `#${shortRef(r.id, 8)}`,
                        new Date(r.date).toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }),
                        r.total,
                        r.paid,
                        r.outstanding,
                      ]));
                      void exportToXlsx(
                        headers,
                        rows,
                        `ap_details_${appliedFilters.asOfDate || 'asof'}.xlsx`,
                        { 
                          sheetName: 'AP Details', 
                          currencyColumns: [2, 3, 4], 
                          currencyFormat: '#,##0.00',
                          preludeRows: [
                            [settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '', '','','',''],
                            ['تقرير: تفاصيل ذمم الموردين','','','',''],
                            [`كما في: ${appliedFilters.asOfDate || '—'}`,'','','','']
                          ],
                          accentColor: settings.brandColors?.primary || '#2F2B7C'
                        }
                      );
                    }}
                    className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    تصدير Excel
                  </button>
                  <button type="button" onClick={() => setApDetailsOpen({ open: false, supplierId: '', title: '' })} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700">إغلاق</button>
                </div>
              </div>
              <div className="p-4">
                {apDetailsLoading && <div className="py-8 text-center text-gray-500 dark:text-gray-400 font-semibold">جاري التحميل...</div>}
                {!apDetailsLoading && (
                  <div className="overflow-auto max-h-[70vh]">
                    <table className="min-w-full text-sm">
                      <thead className="text-gray-500 dark:text-gray-400">
                        <tr className="border-b dark:border-gray-700">
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">المرجع</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">التاريخ</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">الإجمالي</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">المدفوع</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">المتبقي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apDetailsRows.map((r) => (
                          <tr key={r.id} className="border-b dark:border-gray-700">
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{r.reference_number ? r.reference_number : `#${shortRef(r.id, 8)}`}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{new Date(r.date).toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.total)}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.paid)}</td>
                            <td className="py-2 px-3 font-bold dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.outstanding)}</td>
                          </tr>
                        ))}
                        {apDetailsRows.length === 0 && (
                          <tr><td colSpan={5} className="py-8 text-center text-gray-500 dark:text-gray-400">لا توجد بيانات</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {drilldown.open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeDrilldown} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-3xl bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-700">
                <div className="min-w-0">
                  <div className="text-lg font-bold dark:text-white truncate">{drilldown.title}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    الإجمالي: <span className="font-bold dark:text-white" dir="ltr">{formatMoney(drilldownTotal)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeDrilldown}
                  className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  إغلاق
                </button>
              </div>
              <div className="p-4">
                {loading.drilldown && (
                  <div className="py-8 text-center text-gray-500 dark:text-gray-400 font-semibold">جاري التحميل...</div>
                )}
                {!loading.drilldown && (
                  <div className="overflow-auto max-h-[70vh]">
                    <table className="min-w-full text-sm">
                      <thead className="text-gray-500 dark:text-gray-400">
                        <tr className="border-b dark:border-gray-700">
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">الكود</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">الحساب</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">مدين</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">دائن</th>
                          <th className="py-2 px-3 text-right border-l dark:border-gray-700">المبلغ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drilldownRows.map((r) => (
                          <tr
                            key={`${r.account_code}-${r.account_type}`}
                            className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer"
                            onClick={() => void handleDrilldownAccountClick(r.account_code)}
                            title="عرض دفتر الأستاذ لهذا الحساب"
                          >
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{r.account_code}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{r.account_name}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.debit)}</td>
                            <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.credit)}</td>
                            <td className="py-2 px-3 font-bold dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.amount)}</td>
                          </tr>
                        ))}
                        {drilldownRows.length === 0 && (
                          <tr><td colSpan={5} className="py-8 text-center text-gray-500 dark:text-gray-400">لا توجد بيانات</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">التقارير المالية</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">دفتر الأستاذ، القوائم المالية، أعمار الذمم، وإقفال الفترات</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { void loadStatements(); void loadCashFlow(); void loadAging(); void loadPeriods(); }}
            disabled={draftError !== '' || isDraftDirty || loading.statements || loading.cashFlow || loading.aging || loading.periods}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white font-semibold disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900"
            title={isDraftDirty ? 'طبّق التغييرات أولاً' : 'تحديث القوائم والتدفقات والأعمار والفترات'}
          >
            تحديث الكل
          </button>
          <button
            type="button"
            onClick={() => void loadStatements()}
            disabled={draftError !== '' || isDraftDirty || loading.statements}
            className="px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold disabled:opacity-60"
            title={isDraftDirty ? 'طبّق التغييرات أولاً' : 'تحديث القوائم المالية حسب الفترة المطبقة'}
          >
            {loading.statements ? 'جاري تحديث القوائم...' : 'تحديث القوائم'}
          </button>
          <button
            type="button"
            onClick={() => void loadAging()}
            disabled={draftError !== '' || isDraftDirty || loading.aging}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold disabled:opacity-60"
            title={isDraftDirty ? 'طبّق التغييرات أولاً' : 'تحديث أعمار الذمم حسب تاريخ (كما في) المطبق'}
          >
            {loading.aging ? 'جاري تحديث الأعمار...' : 'تحديث الأعمار'}
          </button>
          <button
            type="button"
            onClick={() => void sharePdf(
              'header-summary',
              'ملخص التقارير',
              `financial_summary_${appliedFilters.startDate || 'all'}_${appliedFilters.endDate || 'all'}`,
              buildPdfBrandOptions(settings, 'ملخص التقارير', { pageNumbers: true })
            )}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold"
            title="تصدير ملخص الهيدر إلى PDF"
          >
            تصدير PDF
          </button>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById('header-summary');
              const content = el ? el.innerHTML : '';
              printContent(content, 'ملخص التقارير');
            }}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold"
            title="طباعة ملخص الهيدر"
          >
            طباعة
          </button>
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-700 rounded-xl p-3 text-sm text-blue-800 dark:text-blue-200">
        <div className="font-semibold mb-1">ملاحظة السياسة المحاسبية: حسابات الترحيل الآلي vs بقية الحسابات</div>
        <ul className="list-disc rtl:list-disc ms-5 space-y-1">
          <li>حسابات الترحيل الآلي (Control Accounts) تُعرّف في إعدادات التطبيق تحت accounting_accounts وتُستخدم حصريًا في دوال الترحيل الآلي: post_inventory_movement، post_order_delivery، post_payment.</li>
          <li>هذه الحسابات تمثل نقاط الربط الأساسية (Inventory, COGS, AR, AP, Cash, Bank, Deposits, VAT…) وتُحمّل ديناميكيًا مع قيم افتراضية سليمة؛ لا تُستخدم حسابات غير مُعرّفة أو عشوائية.</li>
          <li>بقية شجرة الحسابات تُستخدم بحرية للقيود اليدوية والمصاريف والإيرادات والتسويات دون الحاجة لإضافتها في accounting_accounts.</li>
          <li>إضافة حساب جديد لا تتطلب تعديل إعدادات الترحيل الآلي؛ accounting_accounts ليست تمثيلًا كاملًا للدليل بل حسابات التحكم فقط.</li>
          <li>أي قيد آلي يفشل صراحةً إذا كان الحساب المعيّن غير موجود في COA؛ لا يتم الترحيل إلى حساب بديل صامت.</li>
        </ul>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              const today = toISODateLocal(now);
              setDraftFilters((prev) => ({ ...prev, startDate: today, endDate: today, asOfDate: today }));
            }}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            اليوم
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              const { start, end } = getMonthRange(now);
              setDraftFilters((prev) => ({ ...prev, startDate: start, endDate: end, asOfDate: toISODateLocal(now) }));
            }}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            هذا الشهر
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
              const { start, end } = getMonthRange(lastMonth);
              setDraftFilters((prev) => ({ ...prev, startDate: start, endDate: end, asOfDate: toISODateLocal(now) }));
            }}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            الشهر الماضي
          </button>
          <div className="flex-1" />
          {isDraftDirty && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (draftError) return;
                  setAppliedFilters(draftFilters);
                }}
                disabled={draftError !== '' || isBusy}
                className="px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold disabled:opacity-60"
              >
                تطبيق
              </button>
              <button
                type="button"
                onClick={() => setDraftFilters(appliedFilters)}
                disabled={isBusy}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold disabled:opacity-60"
              >
                تراجع
              </button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200" title="في المحاسبة: الفترة تُطبّق على تاريخ القيد (journal_entries.entry_date) وتقارير GL/P&L.">من</label>
            <input value={draftFilters.startDate} onChange={(e) => setDraftFilters((prev) => ({ ...prev, startDate: e.target.value }))} type="date" className="mt-1 w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200" title="في المحاسبة: الفترة تُطبّق على تاريخ القيد (journal_entries.entry_date) وتقارير GL/P&L.">إلى</label>
            <input value={draftFilters.endDate} onChange={(e) => setDraftFilters((prev) => ({ ...prev, endDate: e.target.value }))} type="date" className="mt-1 w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200" title="كما في: تاريخ مرجعي للميزانية العمومية/ميزان المراجعة/أعمار الذمم.">كما في</label>
            <input value={draftFilters.asOfDate} onChange={(e) => setDraftFilters((prev) => ({ ...prev, asOfDate: e.target.value }))} type="date" className="mt-1 w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200">مركز التكلفة</label>
            <select
              value={draftFilters.costCenterId || ''}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, costCenterId: e.target.value || undefined }))}
              className="mt-1 w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900"
            >
              <option value="">الكل</option>
              {costCenters.map(cc => (
                <option key={cc.id} value={cc.id}>{cc.name}</option>
              ))}
            </select>
          </div>
        </div>
        {draftError && (
          <div className="text-sm font-semibold text-red-600 dark:text-red-400">
            {draftError}
          </div>
        )}
        <div className="text-xs text-gray-500 dark:text-gray-400">
          الفترة المطبقة: <span dir="ltr">{appliedFilters.startDate || '—'}</span> → <span dir="ltr">{appliedFilters.endDate || '—'}</span> | كما في: <span dir="ltr">{appliedFilters.asOfDate || '—'}</span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          تعريف التواريخ: من/إلى = entry_date للقيود · كما في = لقطة الميزانية/الذمم
        </div>
      </div>

      <div id="header-summary" className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div id="card-income" className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-gray-500 dark:text-gray-400">قائمة الدخل</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void openDrilldown('income')}
                disabled={loading.statements || loading.drilldown}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-60"
              >
                تفاصيل الدخل
              </button>
              <button
                type="button"
                onClick={() => void openDrilldown('expense')}
                disabled={loading.statements || loading.drilldown}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-60"
              >
                تفاصيل المصاريف
              </button>
              <button
                type="button"
                onClick={() => setCompareIncome((v) => !v)}
                disabled={loading.statements}
                className={`px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold ${compareIncome ? 'bg-primary-500 text-white' : 'text-gray-700 dark:text-gray-200'}`}
                title="مقارنة هذا الشهر مع السابق"
              >
                قارن
              </button>
              <button
                type="button"
                onClick={() => {
                  const headers = ['الدخل', 'المصاريف', 'صافي الربح'];
                  const rows = [[incomeStatement?.income || 0, incomeStatement?.expenses || 0, incomeStatement?.net_profit || 0]];
                  void exportToXlsx(
                    headers,
                    rows,
                    `income_statement_${appliedFilters.startDate || 'all'}_${appliedFilters.endDate || 'all'}.xlsx`,
                    { sheetName: 'Income Statement', currencyColumns: [0, 1, 2], currencyFormat: '#,##0.00', ...buildXlsxBrandOptions(settings, 'قائمة الدخل', headers.length, { periodText: `الفترة: ${appliedFilters.startDate || '—'} → ${appliedFilters.endDate || '—'}` }) }
                  );
                }}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200"
              >
                تصدير Excel
              </button>
              <button
                type="button"
                onClick={() => {
                  const headers = ['البند', 'المبلغ'];
                  const rows = [
                    ['إيرادات المبيعات/التوصيل', breakdown.revenue],
                    ['خصومات المبيعات', breakdown.discounts],
                    ['مرتجعات المبيعات', breakdown.returns],
                    ['إيرادات أخرى', breakdown.otherIncome],
                    ['صافي الإيرادات', breakdown.netRevenue],
                    ['تكلفة البضاعة المباعة (COGS)', breakdown.cogs],
                    ['هالك/نقص المخزون', breakdown.shrinkage],
                    ['مصروف العروض الترويجية (Promotion Expense)', breakdown.promotionExpense],
                    ['مصروفات تشغيلية (بدون العروض)', breakdown.operatingExpenses],
                    ['مجمل الربح', breakdown.grossProfit],
                    ['صافي الربح (مشتق)', breakdown.netProfitDerived],
                  ];
                  void exportToXlsx(
                    headers,
                    rows,
                    `income_breakdown_${appliedFilters.startDate || 'all'}_${appliedFilters.endDate || 'all'}.xlsx`,
                    { sheetName: 'Income Breakdown', currencyColumns: [1], currencyFormat: '#,##0.00', ...buildXlsxBrandOptions(settings, 'تحليل قائمة الدخل', headers.length, { periodText: `الفترة: ${appliedFilters.startDate || '—'} → ${appliedFilters.endDate || '—'}` }) }
                  );
                }}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200"
              >
                تفصيل Excel
              </button>
              <button
                type="button"
                onClick={() => void sharePdf(
                  'card-income',
                  'قائمة الدخل',
                  `income_${appliedFilters.startDate || 'all'}_${appliedFilters.endDate || 'all'}`,
                  buildPdfBrandOptions(settings, 'قائمة الدخل', { pageNumbers: true })
                )}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200"
              >
                PDF
              </button>
            </div>
          </div>
          {lastUpdated.statements && (
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-1" dir="ltr">
              آخر تحديث: {new Date(lastUpdated.statements).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' })}
            </div>
          )}
          <div className="mt-3 space-y-1">
            <div className="flex justify-between"><span className="font-semibold dark:text-white">الدخل</span><span className={`dark:text-white ${loading.statements ? 'opacity-60' : ''}`}>{loading.statements ? '—' : formatMoney(incomeStatement?.income || 0)}</span></div>
            {compareIncome && prevIncomeStatement && (
              <div className="text-xs">
                الفرق: <span className={`${((incomeStatement?.income || 0) - (prevIncomeStatement?.income || 0)) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} dir="ltr">
                  {formatMoney((incomeStatement?.income || 0) - (prevIncomeStatement?.income || 0))} ({((prevIncomeStatement?.income || 0) !== 0 ? (((incomeStatement?.income || 0) - (prevIncomeStatement?.income || 0)) / (prevIncomeStatement?.income || 1)) * 100 : 0).toFixed(1)}%)
                </span>
              </div>
            )}
            <div className="flex justify-between"><span className="font-semibold dark:text-white">المصاريف</span><span className={`dark:text-white ${loading.statements ? 'opacity-60' : ''}`}>{loading.statements ? '—' : formatMoney(incomeStatement?.expenses || 0)}</span></div>
            {compareIncome && prevIncomeStatement && (
              <div className="text-xs">
                الفرق: <span className={`${((incomeStatement?.expenses || 0) - (prevIncomeStatement?.expenses || 0)) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} dir="ltr">
                  {formatMoney((incomeStatement?.expenses || 0) - (prevIncomeStatement?.expenses || 0))} ({((prevIncomeStatement?.expenses || 0) !== 0 ? (((incomeStatement?.expenses || 0) - (prevIncomeStatement?.expenses || 0)) / (prevIncomeStatement?.expenses || 1)) * 100 : 0).toFixed(1)}%)
                </span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 mt-2"><span className="font-bold dark:text-white">صافي الربح</span><span className={`font-bold dark:text-white ${loading.statements ? 'opacity-60' : ''}`}>{loading.statements ? '—' : formatMoney(incomeStatement?.net_profit || 0)}</span></div>
            {compareIncome && prevIncomeStatement && (
              <div className="text-xs">
                الفرق: <span className={`${((incomeStatement?.net_profit || 0) - (prevIncomeStatement?.net_profit || 0)) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} dir="ltr">
                  {formatMoney((incomeStatement?.net_profit || 0) - (prevIncomeStatement?.net_profit || 0))} ({((prevIncomeStatement?.net_profit || 0) !== 0 ? (((incomeStatement?.net_profit || 0) - (prevIncomeStatement?.net_profit || 0)) / (prevIncomeStatement?.net_profit || 1)) * 100 : 0).toFixed(1)}%)
                </span>
              </div>
            )}
          </div>
          <div className="mt-4 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="text-gray-500 dark:text-gray-400">
                <tr className="border-b dark:border-gray-700">
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">البند</th>
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b dark:border-gray-700">
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">إيرادات المبيعات/التوصيل</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(breakdown.revenue)}</td>
                </tr>
                <tr className="border-b dark:border-gray-700">
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">خصومات المبيعات</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(breakdown.discounts)}</td>
                </tr>
                <tr className="border-b dark:border-gray-700">
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">مرتجعات المبيعات</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(breakdown.returns)}</td>
                </tr>
                <tr className="border-b dark:border-gray-700">
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">إيرادات أخرى</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(breakdown.otherIncome)}</td>
                </tr>
                <tr className="border-b dark:border-gray-700">
                  <td className="py-2 px-3 font-semibold dark:text-white border-l dark:border-gray-700">صافي الإيرادات</td>
                  <td className="py-2 px-3 font-semibold dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(breakdown.netRevenue)}</td>
                </tr>
                <tr className="border-b dark:border-gray-700">
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">تكلفة البضاعة المباعة (COGS)</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(breakdown.cogs)}</td>
                </tr>
                <tr className="border-b dark:border-gray-700">
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">هالك/نقص المخزون</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(breakdown.shrinkage)}</td>
                </tr>
                <tr className="border-b dark:border-gray-700">
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">
                    <div className="flex items-center justify-between gap-2">
                      <span>مصروف العروض الترويجية (Promotion Expense)</span>
                      <button
                        type="button"
                        onClick={() => void loadPromotionExpenseDrilldown()}
                        disabled={promotionExpenseDrillLoading}
                        className="px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-60"
                        title="تفاصيل القيود المرتبطة بحساب مصروف العروض"
                      >
                        تفاصيل
                      </button>
                    </div>
                  </td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(breakdown.promotionExpense)}</td>
                </tr>
                <tr className="border-b dark:border-gray-700">
                  <td className="py-2 px-3 font-semibold dark:text-white border-l dark:border-gray-700">مجمل الربح</td>
                  <td className="py-2 px-3 font-semibold dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(breakdown.grossProfit)}</td>
                </tr>
                <tr className="border-b dark:border-gray-700">
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">مصروفات تشغيلية (بدون العروض)</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(breakdown.operatingExpenses)}</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-bold dark:text-white border-l dark:border-gray-700">صافي الربح (مشتق)</td>
                  <td className="py-2 px-3 font-bold dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(breakdown.netProfitDerived)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
            {promoExpensePolicyText}
          </div>
        </div>
        <div id="card-promotions" className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">تقرير أثر العروض (Promotion Impact)</div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                الفترة: {appliedFilters.startDate && appliedFilters.endDate ? `${appliedFilters.startDate} → ${appliedFilters.endDate}` : 'الشهر الحالي'}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void loadPromotionPerformance()}
                disabled={promotionPerformanceLoading}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-60"
              >
                تحديث
              </button>
              <button
                type="button"
                onClick={() => {
                  const headers = ['promotion_id', 'promotion_name', 'usage_count', 'bundles_sold', 'gross_before_promo', 'net_after_promo', 'promotion_expense'];
                  const rows = promotionPerformanceRows.map((r) => ([
                    r.promotion_id,
                    r.promotion_name,
                    r.usage_count,
                    r.bundles_sold,
                    r.gross_before_promo,
                    r.net_after_promo,
                    r.promotion_expense,
                  ]));
                  void exportToXlsx(
                    headers,
                    rows,
                    `promotion_impact_${appliedFilters.startDate || 'month'}_${appliedFilters.endDate || 'month'}.xlsx`,
                    { sheetName: 'Promotion Impact', currencyColumns: [4, 5, 6], currencyFormat: '#,##0.00' }
                  );
                }}
                disabled={promotionPerformanceRows.length === 0}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-60"
              >
                Excel
              </button>
            </div>
          </div>
          <div className="mt-3 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="text-gray-500 dark:text-gray-400">
                <tr className="border-b dark:border-gray-700">
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">العرض</th>
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">عدد الاستخدام</th>
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">Bundles</th>
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">قبل</th>
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">بعد</th>
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">تكلفة</th>
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">تفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {promotionPerformanceRows.map((r) => (
                  <tr key={r.promotion_id} className="border-b dark:border-gray-700">
                    <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">
                      <div className="font-semibold">{r.promotion_name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{shortRef(r.promotion_id, 8)}</div>
                    </td>
                    <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{Number(r.usage_count || 0).toLocaleString('en-US')}</td>
                    <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{Number(r.bundles_sold || 0).toLocaleString('en-US')}</td>
                    <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.gross_before_promo)}</td>
                    <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.net_after_promo)}</td>
                    <td className="py-2 px-3 font-bold dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(r.promotion_expense)}</td>
                    <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">
                      <button
                        type="button"
                        onClick={() => void openPromotionDrilldown(r.promotion_id, r.promotion_name)}
                        className="px-2 py-1 rounded-md bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 text-xs font-semibold"
                      >
                        Drill-down
                      </button>
                    </td>
                  </tr>
                ))}
                {!promotionPerformanceLoading && promotionPerformanceRows.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-500 dark:text-gray-400">لا توجد بيانات</td></tr>
                )}
                {promotionPerformanceLoading && (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-500 dark:text-gray-400">جاري التحميل...</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
            {promoExpensePolicyText}
          </div>
        </div>
        <div id="card-offline" className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm text-gray-500 dark:text-gray-400">لوحة تسوية أوفلاين POS</div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                تمنع إعادة ترحيل حالات CONFLICT/FAILED بدون اعتماد تسوية
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={offlineReconciliationState}
                onChange={(e) => setOfflineReconciliationState(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"
                title="فلترة حسب حالة عملية الأوفلاين"
              >
                <option value="">الكل</option>
                <option value="CREATED_OFFLINE">CREATED_OFFLINE</option>
                <option value="SYNCED">SYNCED</option>
                <option value="DELIVERED">DELIVERED</option>
                <option value="CONFLICT">CONFLICT</option>
                <option value="FAILED">FAILED</option>
              </select>
              <button
                type="button"
                onClick={() => void loadOfflineReconciliation()}
                disabled={offlineReconciliationLoading}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-60"
              >
                تحديث
              </button>
            </div>
          </div>
          <div className="mt-3 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="text-gray-500 dark:text-gray-400">
                <tr className="border-b dark:border-gray-700">
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">Offline ID</th>
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">الحالة</th>
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">الإنشاء</th>
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">المزامنة</th>
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">المنشئ</th>
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">اعتماد</th>
                  <th className="py-2 px-3 text-right border-l dark:border-gray-700">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {offlineReconciliationRows.map((r) => {
                  const canRequest = (r.state === 'CONFLICT' || r.state === 'FAILED') && r.reconciliation_status !== 'APPROVED';
                  return (
                    <tr key={r.offline_id} className="border-b dark:border-gray-700">
                      <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700 font-mono" dir="ltr">{r.offline_id}</td>
                      <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700 font-semibold" dir="ltr">{r.state}</td>
                      <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatDateInput(r.created_at)}</td>
                      <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{r.synced_at ? formatDateInput(r.synced_at) : '—'}</td>
                      <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{r.created_by ? shortRef(r.created_by, 8) : '—'}</td>
                      <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">
                        <div className="flex flex-col gap-1">
                          <div className="font-semibold" dir="ltr">{r.reconciliation_status}</div>
                          {r.reconciliation_approval_request_id ? (
                            <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">#{shortRef(r.reconciliation_approval_request_id, 8)}</div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">
                        <button
                          type="button"
                          disabled={!canRequest}
                          onClick={() => {
                            const reason = window.prompt('سبب طلب اعتماد تسوية الأوفلاين (اختياري):', r.last_error || '') || '';
                            void (async () => {
                              if (!supabase) return;
                              try {
                                const { data, error } = await supabase.rpc('request_offline_reconciliation', {
                                  p_offline_id: r.offline_id,
                                  p_reason: reason ? reason : null,
                                });
                                if (error) throw error;
                                const status = String((data as any)?.status || '');
                                const reqId = String((data as any)?.approvalRequestId || '');
                                if (status === 'PENDING' && reqId) {
                                  showNotification(`تم إرسال طلب اعتماد: #${shortRef(reqId, 8)}`, 'success');
                                } else {
                                  showNotification('تم تحديث حالة التسوية', 'success');
                                }
                                await loadOfflineReconciliation();
                              } catch (err: any) {
                                showNotification(err?.message || 'تعذر إرسال طلب الاعتماد', 'error');
                              }
                            })();
                          }}
                          className="px-2 py-1 rounded-md bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50"
                        >
                          طلب اعتماد
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!offlineReconciliationLoading && offlineReconciliationRows.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-500 dark:text-gray-400">لا توجد بيانات</td></tr>
                )}
                {offlineReconciliationLoading && (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-500 dark:text-gray-400">جاري التحميل...</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div id="card-balance" className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-gray-500 dark:text-gray-400">الميزانية العمومية (كما في)</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void openDrilldown('assets')}
                disabled={loading.statements || loading.drilldown}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-60"
              >
                تفاصيل الأصول
              </button>
              <button
                type="button"
                onClick={() => void openDrilldown('liabilities')}
                disabled={loading.statements || loading.drilldown}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-60"
              >
                تفاصيل الالتزامات
              </button>
              <button
                type="button"
                onClick={() => void openDrilldown('equity')}
                disabled={loading.statements || loading.drilldown}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-60"
              >
                تفاصيل حقوق الملكية
              </button>
              <button
                type="button"
                onClick={() => setCompareBalance((v) => !v)}
                disabled={loading.statements}
                className={`px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold ${compareBalance ? 'bg-primary-500 text-white' : 'text-gray-700 dark:text-gray-200'}`}
                title="مقارنة كما في مع الشهر السابق"
              >
                قارن
              </button>
              <button
                type="button"
                onClick={() => {
                  const headers = ['الأصول', 'الالتزامات', 'حقوق الملكية'];
                  const rows = [[balanceSheet?.assets || 0, balanceSheet?.liabilities || 0, balanceSheet?.equity || 0]];
                  void exportToXlsx(
                    headers,
                    rows,
                    `balance_sheet_${appliedFilters.asOfDate || 'asof'}.xlsx`,
                    { sheetName: 'Balance Sheet', currencyColumns: [0, 1, 2], currencyFormat: '#,##0.00', ...buildXlsxBrandOptions(settings, 'الميزانية العمومية', headers.length, { periodText: `كما في: ${appliedFilters.asOfDate || '—'}` }) }
                  );
                }}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200"
              >
                تصدير Excel
              </button>
              <button
                type="button"
                onClick={() => void sharePdf(
                  'card-balance',
                  'الميزانية العمومية',
                  `balance_sheet_${appliedFilters.asOfDate || 'asof'}`,
                  buildPdfBrandOptions(settings, 'الميزانية العمومية', { pageNumbers: true })
                )}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200"
              >
                PDF
              </button>
            </div>
          </div>
          {lastUpdated.statements && (
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-1" dir="ltr">
              آخر تحديث: {new Date(lastUpdated.statements).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' })}
            </div>
          )}
          <div className="mt-3 space-y-1">
            <div className="flex justify-between"><span className="font-semibold dark:text-white">الأصول</span><span className={`dark:text-white ${loading.statements ? 'opacity-60' : ''}`}>{loading.statements ? '—' : formatMoney(balanceSheet?.assets || 0)}</span></div>
            {compareBalance && prevBalanceSheet && (
              <div className="text-xs">
                الفرق: <span className={`${((balanceSheet?.assets || 0) - (prevBalanceSheet?.assets || 0)) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} dir="ltr">
                  {formatMoney((balanceSheet?.assets || 0) - (prevBalanceSheet?.assets || 0))} ({((prevBalanceSheet?.assets || 0) !== 0 ? (((balanceSheet?.assets || 0) - (prevBalanceSheet?.assets || 0)) / (prevBalanceSheet?.assets || 1)) * 100 : 0).toFixed(1)}%)
                </span>
              </div>
            )}
            <div className="flex justify-between"><span className="font-semibold dark:text-white">الالتزامات</span><span className={`dark:text-white ${loading.statements ? 'opacity-60' : ''}`}>{loading.statements ? '—' : formatMoney(balanceSheet?.liabilities || 0)}</span></div>
            {compareBalance && prevBalanceSheet && (
              <div className="text-xs">
                الفرق: <span className={`${((balanceSheet?.liabilities || 0) - (prevBalanceSheet?.liabilities || 0)) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} dir="ltr">
                  {formatMoney((balanceSheet?.liabilities || 0) - (prevBalanceSheet?.liabilities || 0))} ({((prevBalanceSheet?.liabilities || 0) !== 0 ? (((balanceSheet?.liabilities || 0) - (prevBalanceSheet?.liabilities || 0)) / (prevBalanceSheet?.liabilities || 1)) * 100 : 0).toFixed(1)}%)
                </span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 mt-2"><span className="font-bold dark:text-white">حقوق الملكية</span><span className={`font-bold dark:text-white ${loading.statements ? 'opacity-60' : ''}`}>{loading.statements ? '—' : formatMoney(balanceSheet?.equity || 0)}</span></div>
            {compareBalance && prevBalanceSheet && (
              <div className="text-xs">
                الفرق: <span className={`${((balanceSheet?.equity || 0) - (prevBalanceSheet?.equity || 0)) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} dir="ltr">
                  {formatMoney((balanceSheet?.equity || 0) - (prevBalanceSheet?.equity || 0))} ({((prevBalanceSheet?.equity || 0) !== 0 ? (((balanceSheet?.equity || 0) - (prevBalanceSheet?.equity || 0)) / (prevBalanceSheet?.equity || 1)) * 100 : 0).toFixed(1)}%)
                </span>
              </div>
            )}
          </div>
        </div>
        <div id="card-cashflow" className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">قائمة التدفقات النقدية</div>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => setCompareCashFlow((v) => !v)}
              disabled={loading.cashFlow}
              className={`px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold ${compareCashFlow ? 'bg-primary-500 text-white' : 'text-gray-700 dark:text-gray-200'}`}
              title="مقارنة هذا الشهر مع السابق"
            >
              قارن
            </button>
            <button
              type="button"
              onClick={() => {
                const headers = ['تشغيلية', 'استثمارية', 'تمويلية', 'صافي التدفق', 'رصيد افتتاحي', 'رصيد ختامي'];
                const rows = [[
                  cashFlow?.operating_activities || 0,
                  cashFlow?.investing_activities || 0,
                  cashFlow?.financing_activities || 0,
                  cashFlow?.net_cash_flow || 0,
                  cashFlow?.opening_cash || 0,
                  cashFlow?.closing_cash || 0,
                ]];
                void exportToXlsx(
                  headers,
                  rows,
                  `cash_flow_${appliedFilters.startDate || 'all'}_${appliedFilters.endDate || 'all'}.xlsx`,
                  { sheetName: 'Cash Flow', currencyColumns: [0, 1, 2, 3, 4, 5], currencyFormat: '#,##0.00' }
                );
              }}
              className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200"
            >
              تصدير Excel
            </button>
            <button
              type="button"
              onClick={() => void sharePdf(
                'card-cashflow',
                'قائمة التدفقات النقدية',
                `cash_flow_${appliedFilters.startDate || 'all'}_${appliedFilters.endDate || 'all'}`,
                {
                  headerTitle: settings.cafeteriaName?.ar || 'تقارير',
                  headerSubtitle: 'قائمة التدفقات النقدية',
                  logoUrl: settings.logoUrl || '',
                    footerText: `${settings.address || ''} • ${settings.contactNumber || ''}`,
                    accentColor: settings.brandColors?.primary || '#2F2B7C',
                    brandLines: [
                      settings.taxSettings?.taxNumber ? `الرقم الضريبي: ${settings.taxSettings.taxNumber}` : ''
                    ],
                    pageNumbers: true
                }
              )}
              className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200"
            >
              PDF
            </button>
          </div>
          {lastUpdated.cashFlow && (
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-1" dir="ltr">
              آخر تحديث: {new Date(lastUpdated.cashFlow).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' })}
            </div>
          )}
          <div className="mt-3 space-y-1">
            <div className="flex justify-between"><span className="font-semibold dark:text-white">الأنشطة التشغيلية</span><span className={`dark:text-white ${loading.cashFlow ? 'opacity-60' : ''}`}>{loading.cashFlow ? '—' : formatMoney(cashFlow?.operating_activities || 0)}</span></div>
            {compareCashFlow && prevCashFlow && (
              <div className="text-xs">
                الفرق: <span className={`${((cashFlow?.operating_activities || 0) - (prevCashFlow?.operating_activities || 0)) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} dir="ltr">
                  {formatMoney((cashFlow?.operating_activities || 0) - (prevCashFlow?.operating_activities || 0))} ({((prevCashFlow?.operating_activities || 0) !== 0 ? (((cashFlow?.operating_activities || 0) - (prevCashFlow?.operating_activities || 0)) / (prevCashFlow?.operating_activities || 1)) * 100 : 0).toFixed(1)}%)
                </span>
              </div>
            )}
            <div className="flex justify-between"><span className="font-semibold dark:text-white">الأنشطة الاستثمارية</span><span className={`dark:text-white ${loading.cashFlow ? 'opacity-60' : ''}`}>{loading.cashFlow ? '—' : formatMoney(cashFlow?.investing_activities || 0)}</span></div>
            {compareCashFlow && prevCashFlow && (
              <div className="text-xs">
                الفرق: <span className={`${((cashFlow?.investing_activities || 0) - (prevCashFlow?.investing_activities || 0)) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} dir="ltr">
                  {formatMoney((cashFlow?.investing_activities || 0) - (prevCashFlow?.investing_activities || 0))} ({((prevCashFlow?.investing_activities || 0) !== 0 ? (((cashFlow?.investing_activities || 0) - (prevCashFlow?.investing_activities || 0)) / (prevCashFlow?.investing_activities || 1)) * 100 : 0).toFixed(1)}%)
                </span>
              </div>
            )}
            <div className="flex justify-between"><span className="font-semibold dark:text-white">الأنشطة التمويلية</span><span className={`dark:text-white ${loading.cashFlow ? 'opacity-60' : ''}`}>{loading.cashFlow ? '—' : formatMoney(cashFlow?.financing_activities || 0)}</span></div>
            {compareCashFlow && prevCashFlow && (
              <div className="text-xs">
                الفرق: <span className={`${((cashFlow?.financing_activities || 0) - (prevCashFlow?.financing_activities || 0)) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} dir="ltr">
                  {formatMoney((cashFlow?.financing_activities || 0) - (prevCashFlow?.financing_activities || 0))} ({((prevCashFlow?.financing_activities || 0) !== 0 ? (((cashFlow?.financing_activities || 0) - (prevCashFlow?.financing_activities || 0)) / (prevCashFlow?.financing_activities || 1)) * 100 : 0).toFixed(1)}%)
                </span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 mt-2"><span className="font-bold dark:text-white">صافي التدفق النقدي</span><span className={`font-bold dark:text-white ${loading.cashFlow ? 'opacity-60' : ''}`}>{loading.cashFlow ? '—' : formatMoney(cashFlow?.net_cash_flow || 0)}</span></div>
            {compareCashFlow && prevCashFlow && (
              <div className="text-xs">
                الفرق: <span className={`${((cashFlow?.net_cash_flow || 0) - (prevCashFlow?.net_cash_flow || 0)) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} dir="ltr">
                  {formatMoney((cashFlow?.net_cash_flow || 0) - (prevCashFlow?.net_cash_flow || 0))} ({((prevCashFlow?.net_cash_flow || 0) !== 0 ? (((cashFlow?.net_cash_flow || 0) - (prevCashFlow?.net_cash_flow || 0)) / (prevCashFlow?.net_cash_flow || 1)) * 100 : 0).toFixed(1)}%)
                </span>
              </div>
            )}
          </div>
        </div>
        <div id="card-periods" className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-gray-500 dark:text-gray-400">الفترات المحاسبية</div>
            {user?.role === 'owner' && (
              <button
                type="button"
                onClick={() => setShowCreatePeriodModal(true)}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                فترة جديدة
              </button>
            )}
          </div>
          {lastUpdated.periods && (
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-1" dir="ltr">
              آخر تحديث: {new Date(lastUpdated.periods).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' })}
            </div>
          )}
          <div className="mt-3 space-y-2 max-h-56 overflow-auto">
            {periods.length === 0 && <div className="text-sm text-gray-500 dark:text-gray-400">لا توجد فترات</div>}
            {periods.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 p-2 rounded-lg border border-gray-100 dark:border-gray-700">
                <div className="min-w-0">
                  <div className="font-semibold truncate dark:text-white">{p.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{p.start_date} → {p.end_date}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2 py-1 rounded ${p.status === 'closed' ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'}`}>
                    {p.status === 'closed' ? 'مقفلة' : 'مفتوحة'}
                  </span>
                  {user?.role === 'owner' && p.status !== 'closed' && (
                    <button
                      type="button"
                      disabled={loading.closingPeriod}
                      onClick={() => void closePeriod(p.id)}
                      className="px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-semibold disabled:opacity-60"
                    >
                      {loading.closingPeriod ? '...' : 'إقفال'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showCreatePeriodModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4 dark:text-white">فترة محاسبية جديدة</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">اسم الفترة</label>
                <input
                  value={newPeriod.name}
                  onChange={(e) => setNewPeriod({ ...newPeriod, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900"
                  placeholder="مثال: يناير 2024"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">تاريخ البداية</label>
                <input
                  type="date"
                  value={newPeriod.start_date}
                  onChange={(e) => setNewPeriod({ ...newPeriod, start_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">تاريخ النهاية</label>
                <input
                  type="date"
                  value={newPeriod.end_date}
                  onChange={(e) => setNewPeriod({ ...newPeriod, end_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setShowCreatePeriodModal(false)}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void createPeriod()}
                disabled={loading.creatingPeriod || !newPeriod.name || !newPeriod.start_date || !newPeriod.end_date}
                className="px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold disabled:opacity-60"
              >
                {loading.creatingPeriod ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold dark:text-white">ميزان المراجعة</h2>
            <div className="text-sm text-gray-500 dark:text-gray-400">حسب الفترة المحددة</div>
          </div>
        </div>
        <div className="mt-4 overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr className="border-b dark:border-gray-700">
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">الكود</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">الحساب</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">النوع</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">مدين</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">دائن</th>
              </tr>
            </thead>
            <tbody>
              {trialBalance.map((r) => (
                <tr
                  key={r.account_code}
                  className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer"
                  onClick={() => {
                    const code = r.account_code;
                    setAccountCode(code);
                    void loadLedgerFor(code).then(() => ledgerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                  }}
                  title="عرض دفتر الأستاذ لهذا الحساب"
                >
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{r.account_code}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{r.account_name}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{r.account_type}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.debit)}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.credit)}</td>
                </tr>
              ))}
              {trialBalance.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-gray-500 dark:text-gray-400">لا توجد بيانات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-4">
        <div ref={ledgerSectionRef} className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold dark:text-white">دفتر الأستاذ</h2>
            <div className="text-sm text-gray-500 dark:text-gray-400">حسب كود الحساب والفترة</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
              placeholder="مثال: 1010"
              className="px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900 w-36"
              dir="ltr"
              list="coa-codes"
            />
            <datalist id="coa-codes">
              {accounts.map((a) => (
                <option key={a.id} value={a.code}>{a.code} - {a.name}</option>
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => void loadLedger()}
              disabled={isBusy}
              className="px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold disabled:opacity-60"
            >
              تحميل
            </button>
            <button
              type="button"
              onClick={() => exportLedgerCsv(filteredLedgerRows)}
              disabled={isBusy || filteredLedgerRows.length === 0}
              className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold disabled:opacity-60"
            >
              تصدير Excel
            </button>
          </div>
        </div>
        {accountsError && (
          <div className="text-sm text-red-600 dark:text-red-400">{accountsError}</div>
        )}
        {selectedAccount && (
          <div className="text-sm text-gray-600 dark:text-gray-300">
            الحساب: <span className="font-bold dark:text-white">{selectedAccount.name}</span>{' '}
            <span className="text-gray-400 dark:text-gray-500" dir="ltr">({selectedAccount.code})</span>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">
          <input
            value={ledgerQuery}
            onChange={(e) => setLedgerQuery(e.target.value)}
            placeholder="بحث في البيان/المصدر/رقم القيد"
            className="px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900 lg:col-span-2"
          />
          <input
            value={ledgerMinAmount}
            onChange={(e) => setLedgerMinAmount(e.target.value)}
            placeholder="أقل مبلغ"
            className="px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900"
            dir="ltr"
          />
          <select
            value={ledgerView}
            onChange={(e) => setLedgerView(e.target.value as any)}
            className="px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            <option value="all">الكل</option>
            <option value="debit">مدين فقط</option>
            <option value="credit">دائن فقط</option>
          </select>
          <div className="flex gap-2">
            <select
              value={ledgerSort}
              onChange={(e) => setLedgerSort(e.target.value as any)}
              className="flex-1 px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900"
            >
              <option value="asc">الأقدم أولاً</option>
              <option value="desc">الأحدث أولاً</option>
            </select>
            <select
              value={ledgerPageSize}
              onChange={(e) => setLedgerPageSize(Number(e.target.value) || 50)}
              className="w-28 px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            النتائج: <span className="font-bold dark:text-white" dir="ltr">{filteredLedgerRows.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={ledgerPage <= 1}
              onClick={() => setLedgerPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold disabled:opacity-60"
            >
              السابق
            </button>
            <div className="text-sm text-gray-600 dark:text-gray-300" dir="ltr">
              {ledgerPage} / {ledgerPageCount}
            </div>
            <button
              type="button"
              disabled={ledgerPage >= ledgerPageCount}
              onClick={() => setLedgerPage((p) => Math.min(ledgerPageCount, p + 1))}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold disabled:opacity-60"
            >
              التالي
            </button>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr className="border-b dark:border-gray-700">
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">التاريخ</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">البيان</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">مدين</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">دائن</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">الرصيد التراكمي</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">المرجع</th>
              </tr>
            </thead>
            <tbody>
              {pagedLedgerRows.map((r) => (
                <tr
                  key={`${r.journal_entry_id}-${r.entry_date}-${r.debit}-${r.credit}`}
                  className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer"
                  onClick={() => void openEntryModal(r.journal_entry_id)}
                  title="عرض تفاصيل القيد"
                >
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{r.entry_date}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">
                    <div className="font-semibold">
                      {ledgerTitle(r.memo, r.source_table, r.source_id, r.source_event)}
                    </div>
                    <div
                      className="text-xs text-gray-500 dark:text-gray-400"
                      title={[r.source_table, r.source_id, r.source_event].filter(Boolean).join(' / ') || ''}
                    >
                      {ledgerMeta(r.source_table, r.source_id, r.source_event)}
                    </div>
                  </td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.debit)}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.credit)}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.running_balance)}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{`#${shortRef(r.journal_entry_id, 8)}`}</td>
                </tr>
              ))}
              {pagedLedgerRows.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-gray-500 dark:text-gray-400">لا توجد بيانات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 overflow-auto">
          <h2 className="text-lg font-bold dark:text-white">أعمار الذمم المدينة (AR)</h2>
          <table className="min-w-full text-sm mt-3">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr className="border-b dark:border-gray-700">
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">العميل</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">حالي</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">1-30</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">31-60</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">61-90</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">91+</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">الإجمالي</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">تفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {arAging.map((r) => (
                <tr key={r.customer_auth_user_id || Math.random()} className="border-b dark:border-gray-700">
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">
                    <div className="font-semibold">{r.customer_auth_user_id ? (customerNames[r.customer_auth_user_id] || '—') : '—'}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{r.customer_auth_user_id ? `#${shortRef(r.customer_auth_user_id, 8)}` : ''}</div>
                  </td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.current)}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.days_1_30)}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.days_31_60)}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.days_61_90)}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.days_91_plus)}</td>
                  <td className="py-2 px-3 font-bold dark:text-white border-l dark:border-gray-700">{formatMoney(r.total_outstanding)}</td>
                  <td className="py-2 px-3 border-l dark:border-gray-700">
                    <button
                      type="button"
                      disabled={!r.customer_auth_user_id || arDetailsLoading}
                      onClick={() => r.customer_auth_user_id && void openArDetails(r.customer_auth_user_id)}
                      className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-60"
                    >
                      عرض الطلبات
                    </button>
                  </td>
                </tr>
              ))}
              {arAging.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-gray-500 dark:text-gray-400">لا توجد بيانات</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 overflow-auto">
          <h2 className="text-lg font-bold dark:text-white">أعمار الذمم الدائنة (AP)</h2>
          <table className="min-w-full text-sm mt-3">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr className="border-b dark:border-gray-700">
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">المورد</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">حالي</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">1-30</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">31-60</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">61-90</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">91+</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">الإجمالي</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">تفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {apAging.map((r) => (
                <tr key={r.supplier_id || Math.random()} className="border-b dark:border-gray-700">
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">
                    <div className="font-semibold">{r.supplier_id ? (supplierNames[r.supplier_id] || '—') : '—'}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{r.supplier_id ? `#${shortRef(r.supplier_id, 8)}` : ''}</div>
                  </td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.current)}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.days_1_30)}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.days_31_60)}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.days_61_90)}</td>
                  <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{formatMoney(r.days_91_plus)}</td>
                  <td className="py-2 px-3 font-bold dark:text-white border-l dark:border-gray-700">{formatMoney(r.total_outstanding)}</td>
                  <td className="py-2 px-3 border-l dark:border-gray-700">
                    <button
                      type="button"
                      disabled={!r.supplier_id || apDetailsLoading}
                      onClick={() => r.supplier_id && void openApDetails(r.supplier_id)}
                      className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-60"
                    >
                      عرض المستندات
                    </button>
                  </td>
                </tr>
              ))}
              {apAging.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-gray-500 dark:text-gray-400">لا توجد بيانات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold dark:text-white">مسودات القيود</h2>
            <div className="text-sm text-gray-500 dark:text-gray-400">قيود يدوية بانتظار الاعتماد</div>
          </div>
          <button
            type="button"
            onClick={() => void loadDraftManualEntries()}
            disabled={draftsLoading}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold disabled:opacity-60"
          >
            تحديث
          </button>
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr className="border-b dark:border-gray-700">
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">الرقم</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">التاريخ</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">البيان</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">مدين</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">دائن</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">الفرق</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {draftManualEntries.map((d) => {
                const diff = (Number(d.debit) || 0) - (Number(d.credit) || 0);
                return (
                  <tr key={d.id} className="border-b dark:border-gray-700">
                    <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">#{shortRef(d.id, 8)}</td>
                    <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatDateInput(d.entry_date)}</td>
                    <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700">{d.memo || '—'}</td>
                    <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(d.debit)}</td>
                    <td className="py-2 px-3 dark:text-white border-l dark:border-gray-700" dir="ltr">{formatMoney(d.credit)}</td>
                    <td className={`py-2 px-3 border-l dark:border-gray-700 font-semibold ${Math.abs(diff) <= 1e-6 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} dir="ltr">
                      {formatMoney(diff)}
                    </td>
                    <td className="py-2 px-3 border-l dark:border-gray-700">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void openEntryModal(d.id)}
                          className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200"
                        >
                          عرض
                        </button>
                        {canApproveAccounting && Math.abs(diff) <= 1e-6 && d.debit > 0 && (
                          <button
                            type="button"
                            onClick={() => void approveDraftEntry(d.id)}
                            className="px-2.5 py-1 rounded-lg bg-green-600 text-white text-xs font-semibold"
                          >
                            اعتماد
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!draftsLoading && draftManualEntries.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-gray-500 dark:text-gray-400">لا توجد مسودات</td></tr>
              )}
              {draftsLoading && (
                <tr><td colSpan={7} className="py-6 text-center text-gray-500 dark:text-gray-400">جاري التحميل...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold dark:text-white">قيد يدوي (تسوية)</h2>
            <div className="text-sm text-gray-500 dark:text-gray-400">يُستخدم للتسويات عند الحاجة</div>
          </div>
          <button
            type="button"
            onClick={() => void submitManualEntry()}
            disabled={isBusy || Math.abs(totals.diff) > 1e-6 || (totals.debit <= 0 && totals.credit <= 0)}
            className="px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold disabled:opacity-60"
          >
            حفظ كمسودة
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200">التاريخ</label>
            <input value={manualDate} onChange={(e) => setManualDate(e.target.value)} type="date" className="mt-1 w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200">البيان</label>
            <input value={manualMemo} onChange={(e) => setManualMemo(e.target.value)} type="text" className="mt-1 w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900" />
          </div>
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr className="border-b dark:border-gray-700">
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">كود الحساب</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">مدين</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">دائن</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">ملاحظة</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700">مركز التكلفة</th>
                <th className="py-2 px-3 text-right border-l dark:border-gray-700"></th>
              </tr>
            </thead>
            <tbody>
              {manualLines.map((l, idx) => (
                <tr key={idx} className="border-b dark:border-gray-700">
                  <td className="py-2 px-3 border-l dark:border-gray-700">
                    <input
                      value={l.accountCode}
                      onChange={(e) => setManualLines((prev) => prev.map((p, i) => i === idx ? ({ ...p, accountCode: e.target.value }) : p))}
                      className="w-32 px-2 py-1 rounded border dark:border-gray-700 bg-white dark:bg-gray-900"
                      dir="ltr"
                    />
                  </td>
                  <td className="py-2 px-3 border-l dark:border-gray-700">
                    <input
                      value={l.debit}
                      onChange={(e) => setManualLines((prev) => prev.map((p, i) => i === idx ? ({ ...p, debit: e.target.value, credit: '' }) : p))}
                      className="w-28 px-2 py-1 rounded border dark:border-gray-700 bg-white dark:bg-gray-900"
                      dir="ltr"
                    />
                  </td>
                  <td className="py-2 px-3 border-l dark:border-gray-700">
                    <input
                      value={l.credit}
                      onChange={(e) => setManualLines((prev) => prev.map((p, i) => i === idx ? ({ ...p, credit: e.target.value, debit: '' }) : p))}
                      className="w-28 px-2 py-1 rounded border dark:border-gray-700 bg-white dark:bg-gray-900"
                      dir="ltr"
                    />
                  </td>
                  <td className="py-2 px-3 border-l dark:border-gray-700">
                    <input
                      value={l.memo}
                      onChange={(e) => setManualLines((prev) => prev.map((p, i) => i === idx ? ({ ...p, memo: e.target.value }) : p))}
                      className="w-64 px-2 py-1 rounded border dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                  </td>
                  <td className="py-2 px-3 border-l dark:border-gray-700">
                    <select
                      value={l.costCenterId || ''}
                      onChange={(e) => setManualLines((prev) => prev.map((p, i) => i === idx ? ({ ...p, costCenterId: e.target.value }) : p))}
                      className="w-40 px-2 py-1 rounded border dark:border-gray-700 bg-white dark:bg-gray-900"
                    >
                      <option value="">(بدون)</option>
                      {costCenters.map((cc) => (
                        <option key={cc.id} value={cc.id}>{cc.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-3 border-l dark:border-gray-700">
                    <button
                      type="button"
                      onClick={() => setManualLines((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-red-600 dark:text-red-400 font-semibold"
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={6} className="py-3">
                  <button
                    type="button"
                    onClick={() => setManualLines((prev) => [...prev, { accountCode: '', debit: '', credit: '', memo: '', costCenterId: '' }])}
                    className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold"
                  >
                    إضافة سطر
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            الإجمالي مدين: <span className="font-bold dark:text-white" dir="ltr">{formatMoney(totals.debit)}</span>
            {' '}| الإجمالي دائن: <span className="font-bold dark:text-white" dir="ltr">{formatMoney(totals.credit)}</span>
          </div>
          <div className={`text-sm font-semibold ${Math.abs(totals.diff) <= 1e-6 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            الفرق: <span dir="ltr">{formatMoney(totals.diff)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FinancialReports;
