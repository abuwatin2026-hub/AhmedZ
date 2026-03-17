import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getBaseCurrencyCode, getSupabaseClient } from '../../supabase';
import { useAuth } from '../../contexts/AuthContext';
import * as Icons from '../../components/icons';
import { exportToXlsx } from '../../utils/export';
import { buildXlsxBrandOptions } from '../../utils/branding';
import { useSettings } from '../../contexts/SettingsContext';
import { useNavigate } from 'react-router-dom';
import { methodLabel } from '../../utils/shiftUtils';

/* ─── Types ─── */
type Period = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
type Tab = 'cash' | 'sales' | 'purchases' | 'parties' | 'gl';

interface ReconcSummary {
    shifts_total: number; shifts_open: number; shifts_closed: number;
    shifts_approved: number; shifts_pending: number; shifts_rejected: number;
    total_start_amount: number; total_expected: number; total_counted: number; total_difference: number;
    by_cashier: Array<{
        cashier_id: string; cashier_name: string; shift_count: number; closed_count: number;
        approved_count: number; pending_count: number;
        total_start: number; total_expected: number; total_counted: number; total_difference: number;
    }>;
    by_currency: Record<string, { total_difference: number }>;
    by_method: Record<string, { in: number; out: number }>;
}

interface DashboardSummary {
    sales: {
        total_orders: number; delivered_orders: number; cancelled_orders: number;
        pending_orders: number; returned_orders: number;
        total_sales: number; total_tax: number; total_discount: number;
        by_payment_method: Record<string, { count: number; total: number }>;
        by_source: Record<string, { count: number; total: number }>;
    };
    purchases: {
        total_pos: number; completed_pos: number; draft_pos: number; cancelled_pos: number;
        total_amount: number; total_paid: number; total_unpaid: number;
        by_supplier: Array<{ supplier_id: string; supplier_name: string; count: number; total: number; paid: number }>;
    };
    parties: {
        total_customers: number; total_suppliers: number; total_employees: number;
        ar_balance: number; ap_balance: number;
        top_debtors: Array<{ name: string; party_type: string; balance: number }>;
        top_creditors: Array<{ name: string; party_type: string; balance: number }>;
    };
    trial_balance: Array<{
        code: string; name: string; account_type: string;
        total_debit: number; total_credit: number; balance: number;
    }>;
}

interface ShiftRow {
    id: string; cashier_id: string; opened_at: string; closed_at: string | null;
    start_amount: number; end_amount: number | null; expected_amount: number | null;
    difference: number | null; status: string; review_status: string | null;
    reviewed_by: string | null; reviewed_at: string | null; notes: string | null;
    shift_number: number | null;
}

/* ─── Constants ─── */
const periodLabel: Record<Period, string> = {
    today: 'اليوم', yesterday: 'أمس', week: 'هذا الأسبوع', month: 'هذا الشهر', custom: 'مخصص',
};
const tabLabels: Record<Tab, string> = {
    cash: 'الصندوق', sales: 'المبيعات', purchases: 'المشتريات', parties: 'الذمم', gl: 'ميزان المراجعة',
};
const reviewStatusLabel: Record<string, string> = {
    approved: 'معتمد', rejected: 'مرفوض', pending: 'بانتظار المراجعة',
};
const reviewStatusColor: Record<string, string> = {
    approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
};
// methodLabel imported from shiftUtils
const acctTypeLabel: Record<string, string> = {
    asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', income: 'إيرادات', expense: 'مصروفات',
};
const partyTypeLabel: Record<string, string> = {
    customer: 'عميل', supplier: 'مورد', employee: 'موظف',
};
const SHIFT_PAGE_SIZE = 50;

function parseLocalDateInput(value?: string) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
}

function getDateRange(period: Period, cs?: string, ce?: string) {
    const now = new Date();
    const sod = (d: Date) => { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; };
    const eod = (d: Date) => { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; };
    switch (period) {
        case 'today': return { start: sod(now), end: eod(now) };
        case 'yesterday': { const y = new Date(now); y.setDate(y.getDate() - 1); return { start: sod(y), end: eod(y) }; }
        case 'week': { const w = new Date(now); w.setDate(w.getDate() - w.getDay()); return { start: sod(w), end: eod(now) }; }
        case 'month': return { start: sod(new Date(now.getFullYear(), now.getMonth(), 1)), end: eod(now) };
        case 'custom': {
            const startDate = parseLocalDateInput(cs) || now;
            const endDate = parseLocalDateInput(ce) || now;
            return { start: sod(startDate), end: eod(endDate) };
        }
    }
}

const fmt = (n: number | null | undefined) => {
    if (n === null || n === undefined) return '-';
    return Number(n).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/* ─── Card Component ─── */
const StatCard: React.FC<{ label: string; value: string | number; color?: string; sub?: string }> = ({ label, value, color, sub }) => (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
        <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
        <div className={`text-xl font-bold font-mono mt-1 ${color || 'dark:text-white'}`}>{value}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
);

/* ════════════════════════════════════════ MAIN SCREEN ════════════════════════════════════════ */
const ShiftReconciliationScreen: React.FC = () => {
    const { hasPermission } = useAuth();
    const { settings } = useSettings();
    const supabase = getSupabaseClient();
    const navigate = useNavigate();

    const [tab, setTab] = useState<Tab>('cash');
    const [period, setPeriod] = useState<Period>('today');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [selectedCashier, setSelectedCashier] = useState('');

    const [summary, setSummary] = useState<ReconcSummary | null>(null);
    const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
    const [shifts, setShifts] = useState<ShiftRow[]>([]);
    const [cashierMap, setCashierMap] = useState<Record<string, string>>({});
    const [reviewerMap, setReviewerMap] = useState<Record<string, string>>({});
    const [cashierOptions, setCashierOptions] = useState<{ id: string; label: string }[]>([]);
    const [shiftPage, setShiftPage] = useState(1);
    const [shiftTotal, setShiftTotal] = useState(0);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [reviewingId, setReviewingId] = useState<string | null>(null);
    const [reviewNotes, setReviewNotes] = useState('');
    const [reviewBusy, setReviewBusy] = useState(false);
    const [baseCurrency, setBaseCurrency] = useState('—');

    const canReviewShifts = hasPermission('cashShifts.manage') || hasPermission('accounting.approve');
    const dateRange = useMemo(() => getDateRange(period, customStart, customEnd), [period, customStart, customEnd]);
    const shiftTotalPages = useMemo(() => Math.max(1, Math.ceil(shiftTotal / SHIFT_PAGE_SIZE)), [shiftTotal]);

    useEffect(() => { void getBaseCurrencyCode().then(c => { if (c) setBaseCurrency(c); }); }, []);

    useEffect(() => {
        if (!supabase) return;
        void (async () => {
            const { data } = await supabase.from('admin_users').select('auth_user_id, full_name, username, email').eq('is_active', true).order('full_name');
            if (data) setCashierOptions(data.map((c: any) => ({ id: String(c.auth_user_id), label: String(c.full_name || c.username || c.email || '').trim() })).filter(o => o.id && o.label));
        })();
    }, [supabase]);

    useEffect(() => {
        if (tab === 'cash') setShiftPage(1);
    }, [tab, period, customStart, customEnd, selectedCashier]);

    /* ── Load data ─────────────────────────────────────────── */
    const loadData = useCallback(async () => {
        if (!supabase) return;
        setLoading(true); setError('');
        try {
            const startIso = dateRange.start.toISOString();
            const endIso = dateRange.end.toISOString();

            if (tab === 'cash') {
                const rpcArgs: any = { p_start_date: startIso, p_end_date: endIso };
                if (selectedCashier) rpcArgs.p_cashier_id = selectedCashier;
                const { data: sData, error: sErr } = await supabase.rpc('get_shift_reconciliation_summary', rpcArgs);
                if (sErr) throw sErr;
                if (sData) setSummary(sData as ReconcSummary);

                let q = supabase.from('cash_shifts')
                    .select('id, cashier_id, opened_at, closed_at, start_amount, end_amount, expected_amount, difference, status, review_status, reviewed_by, reviewed_at, notes, shift_number', { count: 'exact' })
                    .gte('opened_at', startIso).lte('opened_at', endIso)
                    .order('opened_at', { ascending: false });
                if (selectedCashier) q = q.eq('cashier_id', selectedCashier);
                const from = (shiftPage - 1) * SHIFT_PAGE_SIZE;
                const to = from + SHIFT_PAGE_SIZE - 1;
                const { data: shiftData, count } = await q.range(from, to);
                setShifts((shiftData || []) as ShiftRow[]);
                setShiftTotal(count || 0);

                const allIds = new Set<string>();
                ((shiftData || []) as ShiftRow[]).forEach(s => { if (s.cashier_id) allIds.add(s.cashier_id); if (s.reviewed_by) allIds.add(s.reviewed_by); });
                if (allIds.size > 0) {
                    const { data: uData } = await supabase.from('admin_users').select('auth_user_id, full_name, username, email').in('auth_user_id', Array.from(allIds));
                    const cMap: Record<string, string> = {}; const rMap: Record<string, string> = {};
                    (uData || []).forEach((u: any) => { const lbl = String(u.full_name || u.username || u.email || '').trim(); if (u.auth_user_id && lbl) { cMap[String(u.auth_user_id)] = lbl; rMap[String(u.auth_user_id)] = lbl; } });
                    setCashierMap(cMap); setReviewerMap(rMap);
                } else {
                    setCashierMap({});
                    setReviewerMap({});
                }
            } else {
                const dArgs: any = { p_start_date: startIso, p_end_date: endIso };
                const { data: dData, error: dErr } = await supabase.rpc('get_accountant_dashboard_summary', dArgs);
                if (dErr) throw dErr;
                if (dData) setDashboard(dData as DashboardSummary);
            }
        } catch (err: any) { setError(err?.message || 'تعذر تحميل البيانات.'); } finally { setLoading(false); }
    }, [supabase, dateRange, selectedCashier, tab, shiftPage]);

    useEffect(() => { void loadData(); }, [loadData]);

    const handleReview = async (shiftId: string, status: 'approved' | 'rejected') => {
        if (!supabase) return; setReviewBusy(true);
        try {
            const { error: err } = await supabase.rpc('review_cash_shift', { p_shift_id: shiftId, p_status: status, p_notes: reviewNotes.trim() || null });
            if (err) throw err; setReviewingId(null); setReviewNotes(''); await loadData();
        } catch { setError('تعذر مراجعة الوردية.'); } finally { setReviewBusy(false); }
    };

    const canExport = (tab === 'cash' && shifts.length > 0)
        || (tab === 'sales' && (dashboard?.sales?.total_orders ?? 0) > 0)
        || (tab === 'purchases' && (dashboard?.purchases?.total_pos ?? 0) > 0)
        || (tab === 'parties' && !!dashboard?.parties)
        || (tab === 'gl' && (dashboard?.trial_balance?.length ?? 0) > 0);

    const handleExport = () => {
        if (tab === 'cash' && shifts.length) {
            const headers = ['رقم الوردية', 'الكاشير', 'الفتح', 'الإغلاق', 'عهدة', 'المتوقع', 'الفعلي', 'الفرق', 'الحالة', 'المراجعة'];
            const rows: (string | number)[][] = shifts.map(s => [
                s.shift_number || '-', cashierMap[s.cashier_id] || '-',
                s.opened_at ? new Date(s.opened_at).toLocaleString('ar-EG-u-nu-latn') : '-',
                s.closed_at ? new Date(s.closed_at).toLocaleString('ar-EG-u-nu-latn') : '-',
                s.start_amount || 0, s.expected_amount || 0, s.end_amount ?? '-', s.difference ?? '-',
                s.status === 'open' ? 'مفتوحة' : 'مغلقة', reviewStatusLabel[s.review_status || 'pending'] || '-',
            ]);
            exportToXlsx(headers, rows, `مطابقة-صندوق-${period}`, buildXlsxBrandOptions(settings, 'مطابقة الصندوق', headers.length));
        } else if (tab === 'sales' && dashboard?.sales) {
            const s = dashboard.sales;
            const headers = ['طريقة الدفع', 'عدد الطلبات', 'الإجمالي'];
            const rows: (string | number)[][] = Object.entries(s.by_payment_method).map(([m, d]) => [methodLabel(m), d.count, d.total]);
            rows.push(['', '', '']);
            rows.push(['إجمالي المبيعات', s.total_orders, s.total_sales]);
            rows.push(['الضريبة', '', s.total_tax]);
            rows.push(['الخصومات', '', s.total_discount]);
            rows.push(['مكتملة/مسلمة', s.delivered_orders, '']);
            rows.push(['ملغاة', s.cancelled_orders, '']);
            rows.push(['معلقة', s.pending_orders, '']);
            rows.push(['مرتجعة', s.returned_orders, '']);
            exportToXlsx(headers, rows, `مبيعات-${period}`, buildXlsxBrandOptions(settings, 'ملخص المبيعات', headers.length));
        } else if (tab === 'purchases' && dashboard?.purchases) {
            const p = dashboard.purchases;
            const headers = ['المورد', 'الأوامر', 'الإجمالي', 'المدفوع', 'المتبقي'];
            const rows: (string | number)[][] = p.by_supplier.map(s => [s.supplier_name, s.count, s.total, s.paid, s.total - s.paid]);
            rows.push(['', '', '', '', '']);
            rows.push(['الإجمالي', p.total_pos, p.total_amount, p.total_paid, p.total_unpaid]);
            exportToXlsx(headers, rows, `مشتريات-${period}`, buildXlsxBrandOptions(settings, 'ملخص المشتريات', headers.length));
        } else if (tab === 'parties' && dashboard?.parties) {
            const pt = dashboard.parties;
            const headers = ['الاسم', 'النوع', 'الرصيد'];
            const rows: (string | number)[][] = [];
            rows.push(['--- أكبر المدينين ---', '', '']);
            pt.top_debtors.forEach(d => rows.push([d.name, partyTypeLabel[d.party_type] || d.party_type, d.balance]));
            rows.push(['', '', '']);
            rows.push(['--- أكبر الدائنين ---', '', '']);
            pt.top_creditors.forEach(c => rows.push([c.name, partyTypeLabel[c.party_type] || c.party_type, c.balance]));
            rows.push(['', '', '']);
            rows.push(['الذمم المدينة (AR)', '', pt.ar_balance]);
            rows.push(['الذمم الدائنة (AP)', '', pt.ap_balance]);
            exportToXlsx(headers, rows, `ذمم-${period}`, buildXlsxBrandOptions(settings, 'ملخص الذمم', headers.length));
        } else if (tab === 'gl' && dashboard?.trial_balance?.length) {
            const headers = ['الكود', 'الحساب', 'النوع', 'مدين', 'دائن', 'الرصيد'];
            const rows: (string | number)[][] = dashboard.trial_balance.map(a => [a.code, a.name, acctTypeLabel[a.account_type] || a.account_type, a.total_debit, a.total_credit, a.balance]);
            exportToXlsx(headers, rows, `ميزان-مراجعة-${period}`, buildXlsxBrandOptions(settings, 'ميزان المراجعة', headers.length));
        }
    };

    /* ════════════════════ RENDER ════════════════════ */
    return (
        <div className="p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold dark:text-white flex items-center gap-2">
                        <Icons.ReportIcon className="w-7 h-7 text-blue-600" />
                        لوحة المحاسب
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">مطابقة شاملة — الصندوق • المبيعات • المشتريات • الذمم • الحسابات</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => navigate('/admin/reports/financial')} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm">
                        القوائم المالية
                    </button>
                    <button onClick={() => navigate('/admin/reports/party-aging')} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm">
                        تقادم الذمم
                    </button>
                    <button onClick={() => navigate('/admin/bank-reconciliation')} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm">
                        التسويات البنكية
                    </button>
                    <button onClick={loadData} disabled={loading} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm">
                        {loading ? '...' : 'تحديث'}
                    </button>
                    <button onClick={handleExport} disabled={!canExport} className="px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 text-sm disabled:opacity-50">
                        تصدير Excel
                    </button>
                </div>
            </div>

            {/* ── Filters ── */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
                <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">الفترة</label>
                    <select value={period} onChange={e => setPeriod(e.target.value as Period)} className="rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm">
                        {Object.entries(periodLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                </div>
                {period === 'custom' && (
                    <>
                        <div><label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">من</label><input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm" /></div>
                        <div><label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">إلى</label><input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm" /></div>
                    </>
                )}
                {tab === 'cash' && (
                    <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">الكاشير</label>
                        <select value={selectedCashier} onChange={e => { setSelectedCashier(e.target.value); setShiftPage(1); }} className="rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm">
                            <option value="">الكل</option>
                            {cashierOptions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                    </div>
                )}
            </div>

            {/* ── Tabs ── */}
            <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
                {(Object.keys(tabLabels) as Tab[]).map(t => (
                    <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${tab === t ? 'bg-blue-600 text-white shadow-md' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                        {tabLabels[t]}
                    </button>
                ))}
            </div>

            {error && <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{error}</div>}
            {loading && <div className="text-center py-12 text-gray-500 dark:text-gray-400">جاري التحميل...</div>}

            {/* ════════════ TAB: CASH (الصندوق) ════════════ */}
            {!loading && tab === 'cash' && summary && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                        <StatCard label="إجمالي الورديات" value={summary.shifts_total} />
                        <StatCard label="مغلقة" value={summary.shifts_closed} color="text-blue-600" />
                        <StatCard label="مفتوحة" value={summary.shifts_open} color={summary.shifts_open > 0 ? 'text-amber-600' : 'text-gray-600'} />
                        <StatCard label="معتمدة" value={summary.shifts_approved} color="text-green-600" />
                        <StatCard label="بانتظار" value={summary.shifts_pending} color={summary.shifts_pending > 0 ? 'text-amber-600' : 'text-gray-600'} />
                        <StatCard label="مرفوضة" value={summary.shifts_rejected} color={summary.shifts_rejected > 0 ? 'text-red-600' : 'text-gray-600'} />
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                        <StatCard label="عهدة البداية" value={`${fmt(summary.total_start_amount)} ${baseCurrency}`} />
                        <StatCard label="المتوقع" value={`${fmt(summary.total_expected)} ${baseCurrency}`} />
                        <StatCard label="المعدود" value={`${fmt(summary.total_counted)} ${baseCurrency}`} />
                        <StatCard label="الفرق" value={`${summary.total_difference > 0 ? '+' : ''}${fmt(summary.total_difference)} ${baseCurrency}`} color={Math.abs(summary.total_difference) > 0.01 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'} />
                    </div>

                    {/* Per-Cashier */}
                    {summary.by_cashier.length > 0 && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-6">
                            <h2 className="font-bold text-lg dark:text-white mb-3">ملخص حسب الكاشير</h2>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 dark:bg-gray-700"><tr>
                                        <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">الكاشير</th>
                                        <th className="p-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300">الورديات</th>
                                        <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">المتوقع</th>
                                        <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">المعدود</th>
                                        <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">الفرق</th>
                                        <th className="p-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300">معتمد</th>
                                        <th className="p-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300">بانتظار</th>
                                    </tr></thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                        {summary.by_cashier.map((c, i) => (
                                            <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                                <td className="p-3 dark:text-gray-200 font-medium">{c.cashier_name}</td>
                                                <td className="p-3 text-center dark:text-gray-300">{c.shift_count}</td>
                                                <td className="p-3 text-right font-mono dark:text-gray-200">{fmt(c.total_expected)}</td>
                                                <td className="p-3 text-right font-mono dark:text-gray-200">{fmt(c.total_counted)}</td>
                                                <td className={`p-3 text-right font-mono font-bold ${Math.abs(c.total_difference) > 0.01 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{c.total_difference > 0 ? '+' : ''}{fmt(c.total_difference)}</td>
                                                <td className="p-3 text-center"><span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">{c.approved_count}</span></td>
                                                <td className="p-3 text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${c.pending_count > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>{c.pending_count}</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Per-Method */}
                    {Object.keys(summary.by_method).length > 0 && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-6">
                            <h2 className="font-bold text-lg dark:text-white mb-3">حركة حسب طريقة الدفع</h2>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                                {Object.entries(summary.by_method).map(([method, totals]) => (
                                    <div key={method} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                                        <div className="text-sm font-medium dark:text-gray-200">{methodLabel(method)}</div>
                                        <div className="mt-2 space-y-1">
                                            <div className="flex justify-between text-xs"><span className="text-gray-500 dark:text-gray-400">داخل</span><span className="font-mono text-green-600 dark:text-green-400">+{fmt(totals.in)}</span></div>
                                            <div className="flex justify-between text-xs"><span className="text-gray-500 dark:text-gray-400">خارج</span><span className="font-mono text-red-600 dark:text-red-400">-{fmt(totals.out)}</span></div>
                                            <div className="border-t dark:border-gray-600 pt-1 flex justify-between text-xs font-bold"><span className="text-gray-500 dark:text-gray-400">الصافي</span><span className="font-mono dark:text-white">{fmt(totals.in - totals.out)}</span></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {Object.keys(summary.by_currency).length > 0 && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-6">
                            <h2 className="font-bold text-lg dark:text-white mb-3">فروقات الجرد حسب العملة</h2>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                                {Object.entries(summary.by_currency).map(([currency, data]) => (
                                    <div key={currency} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                                        <div className="text-sm font-medium dark:text-gray-200">{currency}</div>
                                        <div className={`text-xl font-bold font-mono mt-1 ${Math.abs(data.total_difference) > 0.01 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                            {data.total_difference > 0 ? '+' : ''}{fmt(data.total_difference)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Individual Shifts */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
                        <h2 className="font-bold text-lg dark:text-white mb-3">تفاصيل الورديات</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 dark:bg-gray-700"><tr>
                                    <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">#</th>
                                    <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">الكاشير</th>
                                    <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">الفتح</th>
                                    <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">الإغلاق</th>
                                    <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">عهدة</th>
                                    <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">المتوقع</th>
                                    <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">الفعلي</th>
                                    <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">الفرق</th>
                                    <th className="p-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300">المراجعة</th>
                                    {canReviewShifts && <th className="p-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300">إجراء</th>}
                                </tr></thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                    {shifts.map(s => {
                                        const rs = s.review_status || (s.status === 'closed' ? 'pending' : null);
                                        return (
                                            <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                                <td className="p-3 dark:text-gray-300 font-mono text-xs">{s.shift_number || s.id.slice(-6).toUpperCase()}</td>
                                                <td className="p-3 dark:text-gray-200">{cashierMap[s.cashier_id] || s.cashier_id?.slice(0, 8) || '-'}</td>
                                                <td className="p-3 dark:text-gray-300 text-xs">{new Date(s.opened_at).toLocaleString('ar-EG-u-nu-latn', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                                                <td className="p-3 dark:text-gray-300 text-xs">{s.closed_at ? new Date(s.closed_at).toLocaleString('ar-EG-u-nu-latn', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : <span className="text-amber-500">مفتوحة</span>}</td>
                                                <td className="p-3 font-mono dark:text-gray-200">{fmt(s.start_amount)}</td>
                                                <td className="p-3 font-mono dark:text-gray-200">{fmt(s.expected_amount)}</td>
                                                <td className="p-3 font-mono dark:text-gray-200">{s.end_amount !== null ? fmt(s.end_amount) : '-'}</td>
                                                <td className={`p-3 font-mono font-bold ${s.difference !== null && Math.abs(s.difference) > 0.01 ? 'text-red-600 dark:text-red-400' : 'dark:text-gray-200'}`}>{s.difference !== null ? `${s.difference > 0 ? '+' : ''}${fmt(s.difference)}` : '-'}</td>
                                                <td className="p-3 text-center">{rs ? <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${reviewStatusColor[rs] || ''}`}>{rs === 'approved' && <Icons.CheckIcon className="w-3 h-3" />}{rs === 'rejected' && <Icons.XIcon className="w-3 h-3" />}{rs === 'pending' && <Icons.ClockIcon className="w-3 h-3" />}{reviewStatusLabel[rs] || rs}</span> : <span className="text-gray-400 text-xs">-</span>}</td>
                                                {canReviewShifts && (
                                                    <td className="p-3 text-center">
                                                        {s.status === 'closed' && rs !== 'approved' ? (
                                                            reviewingId === s.id ? (
                                                                <div className="flex flex-col items-center gap-1">
                                                                    <input type="text" value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} placeholder="ملاحظات..." className="w-full text-xs px-2 py-1 rounded border dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
                                                                    <div className="flex gap-1">
                                                                        <button onClick={() => handleReview(s.id, 'approved')} disabled={reviewBusy} className="px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">✓ اعتماد</button>
                                                                        <button onClick={() => handleReview(s.id, 'rejected')} disabled={reviewBusy} className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">✗ رفض</button>
                                                                        <button onClick={() => { setReviewingId(null); setReviewNotes(''); }} className="px-2 py-1 text-xs rounded border dark:border-gray-600 dark:text-gray-300">إلغاء</button>
                                                                    </div>
                                                                </div>
                                                            ) : <button onClick={() => { setReviewingId(s.id); setReviewNotes(''); }} className="px-2 py-1 text-xs rounded border border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20">مراجعة</button>
                                                        ) : rs === 'approved' ? <span className="text-xs text-gray-400">{s.reviewed_at ? new Date(s.reviewed_at).toLocaleString('ar-EG-u-nu-latn', { month: 'short', day: 'numeric' }) : ''}{s.reviewed_by && reviewerMap[s.reviewed_by] ? ` — ${reviewerMap[s.reviewed_by]}` : ''}</span> : <span className="text-xs text-gray-400">-</span>}
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                    {shifts.length === 0 && <tr><td colSpan={canReviewShifts ? 10 : 9} className="p-8 text-center text-gray-400 dark:text-gray-500">لا توجد ورديات</td></tr>}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex items-center justify-between mt-4">
                            <div className="text-xs text-gray-500 dark:text-gray-400">صفحة {shiftPage} من {shiftTotalPages} — إجمالي {shiftTotal} وردية</div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShiftPage(p => Math.max(1, p - 1))}
                                    disabled={shiftPage <= 1 || loading}
                                    className="px-3 py-1.5 rounded border border-gray-200 dark:border-gray-600 text-sm dark:text-gray-200 disabled:opacity-50"
                                >
                                    السابق
                                </button>
                                <button
                                    onClick={() => setShiftPage(p => Math.min(shiftTotalPages, p + 1))}
                                    disabled={shiftPage >= shiftTotalPages || loading}
                                    className="px-3 py-1.5 rounded border border-gray-200 dark:border-gray-600 text-sm dark:text-gray-200 disabled:opacity-50"
                                >
                                    التالي
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* ════════════ TAB: SALES (المبيعات) ════════════ */}
            {!loading && tab === 'sales' && dashboard?.sales && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
                        <StatCard label="إجمالي الطلبات" value={dashboard.sales.total_orders} />
                        <StatCard label="مكتملة/مسلمة" value={dashboard.sales.delivered_orders} color="text-green-600" />
                        <StatCard label="ملغاة" value={dashboard.sales.cancelled_orders} color={dashboard.sales.cancelled_orders > 0 ? 'text-red-600' : 'text-gray-600'} />
                        <StatCard label="معلقة" value={dashboard.sales.pending_orders} color={dashboard.sales.pending_orders > 0 ? 'text-amber-600' : 'text-gray-600'} />
                        <StatCard label="مرتجعة" value={dashboard.sales.returned_orders} color={dashboard.sales.returned_orders > 0 ? 'text-red-600' : 'text-gray-600'} />
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                        <StatCard label="إجمالي المبيعات" value={`${fmt(dashboard.sales.total_sales)} ${baseCurrency}`} color="text-green-600 dark:text-green-400" />
                        <StatCard label="الضريبة" value={`${fmt(dashboard.sales.total_tax)} ${baseCurrency}`} />
                        <StatCard label="الخصومات" value={`${fmt(dashboard.sales.total_discount)} ${baseCurrency}`} color="text-red-600 dark:text-red-400" />
                    </div>

                    {/* By payment method */}
                    {Object.keys(dashboard.sales.by_payment_method).length > 0 && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-6">
                            <h2 className="font-bold text-lg dark:text-white mb-3">المبيعات حسب طريقة الدفع</h2>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                                {Object.entries(dashboard.sales.by_payment_method).map(([method, data]) => (
                                    <div key={method} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                                        <div className="text-sm font-medium dark:text-gray-200">{methodLabel(method)}</div>
                                        <div className="text-2xl font-bold font-mono mt-1 text-green-600 dark:text-green-400">{fmt(data.total)}</div>
                                        <div className="text-xs text-gray-400 mt-1">{data.count} طلب</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* By Source */}
                    {Object.keys(dashboard.sales.by_source).length > 0 && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
                            <h2 className="font-bold text-lg dark:text-white mb-3">المبيعات حسب المصدر</h2>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                                {Object.entries(dashboard.sales.by_source).map(([src, data]) => (
                                    <div key={src} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                                        <div className="text-sm font-medium dark:text-gray-200">{src === 'in_store' ? 'فرع' : src === 'online' ? 'أونلاين' : src}</div>
                                        <div className="text-xl font-bold font-mono mt-1 dark:text-white">{fmt(data.total)}</div>
                                        <div className="text-xs text-gray-400 mt-1">{data.count} طلب</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ════════════ TAB: PURCHASES (المشتريات) ════════════ */}
            {!loading && tab === 'purchases' && dashboard?.purchases && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
                        <StatCard label="إجمالي أوامر الشراء" value={dashboard.purchases.total_pos} />
                        <StatCard label="مكتملة" value={dashboard.purchases.completed_pos} color="text-green-600" />
                        <StatCard label="مسودة" value={dashboard.purchases.draft_pos} color="text-amber-600" />
                        <StatCard label="ملغاة" value={dashboard.purchases.cancelled_pos} color="text-red-600" />
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                        <StatCard label="إجمالي المشتريات" value={`${fmt(dashboard.purchases.total_amount)} ${baseCurrency}`} color="text-red-600 dark:text-red-400" />
                        <StatCard label="المدفوع" value={`${fmt(dashboard.purchases.total_paid)} ${baseCurrency}`} color="text-green-600 dark:text-green-400" />
                        <StatCard label="غير المدفوع" value={`${fmt(dashboard.purchases.total_unpaid)} ${baseCurrency}`} color={dashboard.purchases.total_unpaid > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600'} />
                    </div>

                    {dashboard.purchases.by_supplier.length > 0 && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
                            <h2 className="font-bold text-lg dark:text-white mb-3">المشتريات حسب المورد</h2>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 dark:bg-gray-700"><tr>
                                        <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">المورد</th>
                                        <th className="p-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300">الأوامر</th>
                                        <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">الإجمالي</th>
                                        <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">المدفوع</th>
                                        <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">المتبقي</th>
                                    </tr></thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                        {dashboard.purchases.by_supplier.map((s, i) => (
                                            <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                                <td className="p-3 dark:text-gray-200 font-medium">{s.supplier_name}</td>
                                                <td className="p-3 text-center dark:text-gray-300">{s.count}</td>
                                                <td className="p-3 text-right font-mono dark:text-gray-200">{fmt(s.total)}</td>
                                                <td className="p-3 text-right font-mono text-green-600 dark:text-green-400">{fmt(s.paid)}</td>
                                                <td className={`p-3 text-right font-mono font-bold ${(s.total - s.paid) > 0.01 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{fmt(s.total - s.paid)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ════════════ TAB: PARTIES (الذمم) ════════════ */}
            {!loading && tab === 'parties' && dashboard?.parties && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
                        <StatCard label="العملاء" value={dashboard.parties.total_customers} />
                        <StatCard label="الموردين" value={dashboard.parties.total_suppliers} />
                        <StatCard label="الموظفين" value={dashboard.parties.total_employees} />
                        <StatCard label="الذمم المدينة (AR)" value={`${fmt(dashboard.parties.ar_balance)} ${baseCurrency}`} color={dashboard.parties.ar_balance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600'} sub="المستحق على العملاء" />
                        <StatCard label="الذمم الدائنة (AP)" value={`${fmt(dashboard.parties.ap_balance)} ${baseCurrency}`} color={dashboard.parties.ap_balance > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600'} sub="المستحق للموردين" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Top Debtors */}
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
                            <h2 className="font-bold text-lg dark:text-white mb-3 text-amber-600">أكبر المدينين (عليهم ديون)</h2>
                            {dashboard.parties.top_debtors.length > 0 ? (
                                <div className="space-y-2">
                                    {dashboard.parties.top_debtors.map((d, i) => (
                                        <div key={i} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                            <div>
                                                <div className="font-medium dark:text-gray-200">{d.name}</div>
                                                <div className="text-xs text-gray-400">{partyTypeLabel[d.party_type] || d.party_type}</div>
                                            </div>
                                            <div className="font-mono font-bold text-amber-600 dark:text-amber-400">{fmt(d.balance)}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : <p className="text-sm text-gray-400">لا توجد ديون مستحقة</p>}
                        </div>

                        {/* Top Creditors */}
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
                            <h2 className="font-bold text-lg dark:text-white mb-3 text-red-600">أكبر الدائنين (لهم مستحقات)</h2>
                            {dashboard.parties.top_creditors.length > 0 ? (
                                <div className="space-y-2">
                                    {dashboard.parties.top_creditors.map((c, i) => (
                                        <div key={i} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                            <div>
                                                <div className="font-medium dark:text-gray-200">{c.name}</div>
                                                <div className="text-xs text-gray-400">{partyTypeLabel[c.party_type] || c.party_type}</div>
                                            </div>
                                            <div className="font-mono font-bold text-red-600 dark:text-red-400">{fmt(c.balance)}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : <p className="text-sm text-gray-400">لا توجد مستحقات</p>}
                        </div>
                    </div>
                </>
            )}

            {/* ════════════ TAB: GL (ميزان المراجعة) ════════════ */}
            {!loading && tab === 'gl' && dashboard?.trial_balance && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
                    <h2 className="font-bold text-lg dark:text-white mb-3">ميزان المراجعة</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-700"><tr>
                                <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">الكود</th>
                                <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">الحساب</th>
                                <th className="p-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300">النوع</th>
                                <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">مدين</th>
                                <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">دائن</th>
                                <th className="p-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300">الرصيد</th>
                            </tr></thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {dashboard.trial_balance.map((a, i) => (
                                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                        <td className="p-3 font-mono text-xs dark:text-gray-300">{a.code}</td>
                                        <td className="p-3 dark:text-gray-200 font-medium">{a.name}</td>
                                        <td className="p-3 text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${a.account_type === 'asset' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : a.account_type === 'liability' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : a.account_type === 'income' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : a.account_type === 'expense' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'}`}>{acctTypeLabel[a.account_type] || a.account_type}</span></td>
                                        <td className="p-3 text-right font-mono dark:text-gray-200">{a.total_debit > 0 ? fmt(a.total_debit) : '-'}</td>
                                        <td className="p-3 text-right font-mono dark:text-gray-200">{a.total_credit > 0 ? fmt(a.total_credit) : '-'}</td>
                                        <td className={`p-3 text-right font-mono font-bold ${a.balance !== 0 ? 'dark:text-white' : 'text-gray-400'}`}>{fmt(a.balance)}</td>
                                    </tr>
                                ))}
                                {/* Totals row */}
                                <tr className="bg-gray-100 dark:bg-gray-700 font-bold">
                                    <td colSpan={3} className="p-3 dark:text-white">الإجمالي</td>
                                    <td className="p-3 text-right font-mono dark:text-white">{fmt(dashboard.trial_balance.reduce((s, a) => s + a.total_debit, 0))}</td>
                                    <td className="p-3 text-right font-mono dark:text-white">{fmt(dashboard.trial_balance.reduce((s, a) => s + a.total_credit, 0))}</td>
                                    <td className="p-3 text-right font-mono dark:text-white">{fmt(dashboard.trial_balance.reduce((s, a) => s + a.balance, 0))}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ShiftReconciliationScreen;
