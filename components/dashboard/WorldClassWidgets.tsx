import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import { disableRealtime, getSupabaseClient, getBaseCurrencyCode, isRealtimeEnabled, rpcHasFunction } from '../../supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useSessionScope } from '../../contexts/SessionScopeContext';
import * as Icons from '../icons';
import { getCurrencyDecimalsByCode } from '../../utils/currencyDecimals';
import { exportToXlsx } from '../../utils/export';
import { localizeSupabaseError } from '../../utils/errorUtils';

// ─── CONTEXT ───────────────────────────────────────────────────────────────

type DateRange = { start: Date; end: Date; label: string };

type DashboardContextType = {
    dateRange: DateRange;
    setDateRange: (range: DateRange) => void;
    currency: string;
    warehouseId: string | null;
    branchId: string | null;
    companyId: string | null;
    refreshKey: number;
    triggerRefresh: () => void;
    kpiData: any;
    setKpiData: (data: any) => void;
};

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export const useDashboard = () => {
    const context = useContext(DashboardContext);
    if (!context) throw new Error('useDashboard must be used within a DashboardProvider');
    return context;
};

export const DashboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const { scope } = useSessionScope();
    const defaultEnd = new Date();
    defaultEnd.setHours(23, 59, 59, 999);
    const defaultStart = new Date('2000-01-01T00:00:00Z'); // all-time default

    const [dateRange, setDateRange] = useState<DateRange>({ start: defaultStart, end: defaultEnd, label: 'الكل' });
    const [currency, setCurrency] = useState('ر.ي');
    const [refreshKey, setRefreshKey] = useState(0);
    const [kpiData, setKpiData] = useState<any>(null);

    useEffect(() => { getBaseCurrencyCode().then(c => { if (c) setCurrency(c); }); }, []);
    const triggerRefresh = () => setRefreshKey(p => p + 1);

    const refreshTimerRef = useRef<number | null>(null);
    const scheduleRefresh = () => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        if (refreshTimerRef.current != null) {
            window.clearTimeout(refreshTimerRef.current);
        }
        refreshTimerRef.current = window.setTimeout(() => {
            refreshTimerRef.current = null;
            triggerRefresh();
        }, 650);
    };

    useEffect(() => {
        scheduleRefresh();
    }, [scope?.warehouseId, scope?.branchId, scope?.companyId]);

    useEffect(() => {
        const supabase = getSupabaseClient();
        if (!supabase || !user?.id) return;
        if (!isRealtimeEnabled()) return;

        const channel = supabase
            .channel('public:dashboard')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, scheduleRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_returns' }, scheduleRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders' }, scheduleRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_items' }, scheduleRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_receipts' }, scheduleRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_returns' }, scheduleRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_return_items' }, scheduleRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements' }, scheduleRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'journal_entries' }, scheduleRefresh)
            .subscribe((status: any) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    disableRealtime();
                    supabase.removeChannel(channel);
                }
            });

        return () => {
            if (refreshTimerRef.current != null) {
                window.clearTimeout(refreshTimerRef.current);
                refreshTimerRef.current = null;
            }
            supabase.removeChannel(channel);
        };
    }, [user?.id, scope?.warehouseId]);

    return (
        <DashboardContext.Provider value={{
            dateRange,
            setDateRange,
            currency,
            warehouseId: scope?.warehouseId || null,
            branchId: scope?.branchId || null,
            companyId: scope?.companyId || null,
            refreshKey,
            triggerRefresh,
            kpiData,
            setKpiData
        }}>
            {children}
        </DashboardContext.Provider>
    );
};

// ─── UTILS ─────────────────────────────────────────────────────────────────

// getCurrencyDecimalsByCode imported from utils/currencyDecimals
const fmt = (n: number, dp = 2) => n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtInt = (n: number) => n.toLocaleString('en-US');
const fmtCompact = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toFixed(0);
};

const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`bg-gray-200 dark:bg-gray-700 animate-pulse rounded-lg ${className}`} />
);

const ErrorBanner: React.FC<{ message?: string }> = ({ message }) => (
    <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl border border-red-100 dark:border-red-800 text-sm">
        <Icons.InfoIcon className="w-4 h-4 flex-shrink-0" />
        <span>{message || 'تعذر تحميل البيانات.'}</span>
    </div>
);

const normalizeErrText = (err: unknown) => {
    const anyErr = err as any;
    const msg = typeof anyErr?.message === 'string' ? anyErr.message : '';
    const details = typeof anyErr?.details === 'string' ? anyErr.details : '';
    const hint = typeof anyErr?.hint === 'string' ? anyErr.hint : '';
    const code = typeof anyErr?.code === 'string' ? anyErr.code : '';
    return `${msg}\n${details}\n${hint}\n${code}`.trim();
};

const formatDashboardLoadError = (err: unknown) => {
    const t = normalizeErrText(err).toLowerCase();
    if (!t) return '';
    if (t.includes('column') && t.includes('does not exist')) {
        return 'قاعدة البيانات غير محدثة (عمود/بنية ناقصة). طبّق تحديثات قاعدة البيانات (migrations) ثم حدّث الصفحة.';
    }
    if (t.includes('schema cache') || t.includes('could not find the function') || t.includes('pgrst202')) {
        return 'قاعدة البيانات تحتاج إعادة تحميل مخطط PostgREST بعد تطبيق migrations. طبّق migrations ثم أعد المحاولة.';
    }
    if (t.includes('not allowed') || t.includes('permission') || t.includes('forbidden') || t.includes('rls')) {
        return 'ليس لديك صلاحية عرض لوحة التحكم بهذه البيانات.';
    }
    return '';
};

/** Animated number counter */
const AnimatedCounter: React.FC<{ value: number; format?: 'currency' | 'int' | 'percent'; duration?: number; currencyCode?: string }> = ({ value, format = 'currency', duration = 800, currencyCode }) => {
    const [display, setDisplay] = useState(0);
    const ref = useRef<number>(0);
    const rafRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        const startVal = ref.current;
        const startTime = performance.now();
        const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
            const current = startVal + (value - startVal) * eased;
            setDisplay(current);
            if (progress < 1) {
                rafRef.current = requestAnimationFrame(animate);
            } else {
                ref.current = value;
            }
        };
        rafRef.current = requestAnimationFrame(animate);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [value, duration]);

    let text: string;
    if (format === 'percent') text = display.toFixed(1) + '%';
    else if (format === 'int') text = fmtInt(Math.round(display));
    else text = fmt(display, getCurrencyDecimalsByCode(currencyCode || ''));

    return <span className="animate-count-up">{text}</span>;
};

/** Change indicator with arrow */
const ChangeIndicator: React.FC<{ current: number; previous: number; invertColor?: boolean }> = ({ current, previous, invertColor }) => {
    if (previous === 0 && current === 0) return <span className="text-[10px] text-gray-400">—</span>;
    const pct = previous > 0 ? ((current - previous) / previous) * 100 : (current > 0 ? 100 : 0);
    const isPositive = pct > 0;
    const isNeutral = Math.abs(pct) < 0.5;
    const color = isNeutral ? 'text-gray-400' : (isPositive !== !!invertColor ? 'text-emerald-500' : 'text-red-500');
    const arrow = isNeutral ? '—' : isPositive ? '↑' : '↓';

    return (
        <span className={`text-[10px] font-bold flex items-center gap-0.5 ${color}`} title="مقارنة بالفترة السابقة">
            {arrow} {Math.abs(pct).toFixed(1)}%
        </span>
    );
};

/** Get previous period range (same duration, shifted back) */
const getPreviousPeriod = (dateRange: DateRange) => {
    const duration = dateRange.end.getTime() - dateRange.start.getTime();
    const prevEnd = new Date(dateRange.start.getTime() - 1);
    prevEnd.setHours(23, 59, 59, 999);
    const prevStart = new Date(prevEnd.getTime() - duration);
    prevStart.setHours(0, 0, 0, 0);
    return { start: prevStart, end: prevEnd };
};

// ─── COMPONENTS ────────────────────────────────────────────────────────────

// 1. DASHBOARD HEADER
export const DashboardHeader: React.FC<{ title: string }> = ({ title }) => {
    const { dateRange, setDateRange, triggerRefresh, kpiData, currency } = useDashboard();
    const [isOpen, setIsOpen] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen]);

    const presets = [
        { label: 'الكل', mode: 'all' as const },
        { label: 'اليوم', days: 0 },
        { label: 'أمس', days: 1, offset: 1 },
        { label: 'آخر 7 أيام', days: 7 },
        { label: 'هذا الشهر', mode: 'month' as const },
        { label: 'آخر 30 يوم', days: 30 },
        { label: 'آخر 90 يوم', days: 90 },
    ];

    const handleSelect = (p: any) => {
        const end = new Date(); end.setHours(23, 59, 59, 999);
        const start = new Date(); start.setHours(0, 0, 0, 0);
        if (p.mode === 'all') {
            const allStart = new Date('2000-01-01T00:00:00Z');
            setDateRange({ start: allStart, end, label: 'الكل' });
            setIsOpen(false);
            triggerRefresh();
            return;
        }
        if (p.mode === 'month') { start.setDate(1); }
        else if (p.offset) { start.setDate(start.getDate() - p.offset); end.setDate(end.getDate() - p.offset); }
        else { start.setDate(start.getDate() - (p.days || 0)); }
        setDateRange({ start, end, label: p.label });
        setIsOpen(false);
        triggerRefresh();
    };

    const handleRefresh = () => {
        setRefreshing(true);
        triggerRefresh();
        setTimeout(() => setRefreshing(false), 1000);
    };

    const handleExport = async () => {
        if (!kpiData) return;
        setExporting(true);
        try {
            const headers = ['Metric', 'Value', 'Unit'];
            const rows = [
                ['Sales', kpiData.sales || 0, currency],
                ['Orders', kpiData.orders || 0, 'Orders'],
                ['Margin', kpiData.margin || 0, '%'],
                ['Net Profit', kpiData.netProfit || 0, currency],
                ['Inventory Value', kpiData.inventoryValue || 0, currency],
                ['POs In Transit', kpiData.transit || 0, 'Orders'],
                ['Export Date', new Date().toLocaleString(), '']
            ];
            await exportToXlsx(headers, rows, `dashboard_report_${new Date().toISOString().split('T')[0]}`);
        } finally { setExporting(false); }
    };

    return (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg">
                        <Icons.AdminIcon className="w-6 h-6 text-white" />
                    </div>
                    {title}
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mr-12">
                    نظرة عامة على أداء مشروعك ومتابعة العمليات اليومية
                </p>
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={handleRefresh}
                    className={`p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm ${refreshing ? 'animate-spin' : ''}`}
                    title="تحديث"
                >
                    <Icons.RotateCwIcon className="w-4 h-4 text-gray-500" />
                </button>

                <button
                    onClick={handleExport}
                    disabled={exporting || !kpiData}
                    className="flex items-center gap-2 bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 border border-gray-200 dark:border-gray-700 px-4 py-2.5 rounded-xl shadow-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all disabled:opacity-40"
                >
                    <Icons.DownloadIcon className="w-4 h-4" />
                    <span className="hidden sm:inline text-sm font-medium">تصدير</span>
                </button>

                <div className="relative" ref={dropdownRef}>
                    <button
                        onClick={() => setIsOpen(!isOpen)}
                        className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-4 py-2.5 rounded-xl shadow-lg hover:shadow-xl transition-all lg:min-w-[180px] justify-between"
                    >
                        <div className="flex items-center gap-2">
                            <Icons.Calendar className="w-4 h-4" />
                            <span className="text-sm font-medium">{dateRange.label}</span>
                        </div>
                        <Icons.ArrowRight className={`w-3 h-3 transform transition ${isOpen ? '-rotate-90' : 'rotate-90'}`} />
                    </button>

                    {isOpen && (
                        <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden animate-scale-in origin-top">
                            {presets.map((p) => (
                                <button
                                    key={p.label}
                                    onClick={() => handleSelect(p)}
                                    className={`w-full text-right px-4 py-3 text-sm hover:bg-indigo-50 dark:hover:bg-gray-700 transition border-b border-gray-50 dark:border-gray-700/50 last:border-0 ${dateRange.label === p.label ? 'text-indigo-600 font-bold bg-indigo-50 dark:bg-indigo-900/20' : 'text-gray-700 dark:text-gray-300'}`}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};


// 2. KPI BAR — Period-over-Period with Animated Counters
export const KPIBar: React.FC = () => {
    const { dateRange, currency, refreshKey, setKpiData, warehouseId } = useDashboard();
    const [stats, setStats] = useState<any>(null);
    const [prevStats, setPrevStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoading(true);
            setError(false);
            setErrorMessage('');
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;

                const prev = getPreviousPeriod(dateRange);
                const kpiRpc = (await rpcHasFunction('public.get_dashboard_kpi_v4'))
                    ? 'get_dashboard_kpi_v4'
                    : ((await rpcHasFunction('public.get_dashboard_kpi_v3')) ? 'get_dashboard_kpi_v3' : 'get_dashboard_kpi_v2');
                const payload = {
                    p_start_date: dateRange.start.toISOString(),
                    p_end_date: dateRange.end.toISOString(),
                    p_zone_id: null,
                    p_invoice_only: false,
                    p_warehouse_id: null, // all warehouses — not filtered by session
                };
                const { data: kpi, error: kpiErr }: any = await supabase.rpc(kpiRpc, payload as any);
                if (kpiErr) throw kpiErr;

                const { data: prevKpi, error: prevErr }: any = await supabase.rpc(kpiRpc, {
                    ...payload,
                    p_start_date: prev.start.toISOString(),
                    p_end_date: prev.end.toISOString(),
                } as any);
                if (prevErr) throw prevErr;

                let unifiedSales = 0;
                let unifiedOrders = 0;
                let prevUnifiedSales = 0;
                let prevUnifiedOrders = 0;
                let unifiedCogs = 0;
                let prevUnifiedCogs = 0;
                const hasSalesSummary = await rpcHasFunction('public.get_sales_report_summary');
                if (hasSalesSummary) {
                    const summaryPayload = {
                        p_start_date: dateRange.start.toISOString(),
                        p_end_date: dateRange.end.toISOString(),
                        p_zone_id: null,
                        p_invoice_only: false,
                    };
                    const { data: summaryData, error: summaryErr }: any = await supabase.rpc('get_sales_report_summary', summaryPayload as any);
                    if (summaryErr) throw summaryErr;
                    const summary = summaryData && typeof summaryData === 'object' ? summaryData : {};
                    const summaryGross = Number(summary?.total_sales_accrual) || 0;
                    const summaryReturns = Number(summary?.returns_total) || 0;
                    unifiedSales = summaryGross - summaryReturns;
                    // Use total_orders_accrual (all delivered orders) not total_orders (only paid/non-cash)
                    unifiedOrders = Number(summary?.total_orders_accrual ?? summary?.total_orders) || 0;
                    unifiedCogs = Math.max(0, Number(summary?.cogs) || 0);

                    const { data: prevSummaryData, error: prevSummaryErr }: any = await supabase.rpc('get_sales_report_summary', {
                        ...summaryPayload,
                        p_start_date: prev.start.toISOString(),
                        p_end_date: prev.end.toISOString(),
                    } as any);
                    if (prevSummaryErr) throw prevSummaryErr;
                    const prevSummary = prevSummaryData && typeof prevSummaryData === 'object' ? prevSummaryData : {};
                    const prevSummaryGross = Number(prevSummary?.total_sales_accrual) || 0;
                    const prevSummaryReturns = Number(prevSummary?.returns_total) || 0;
                    prevUnifiedSales = prevSummaryGross - prevSummaryReturns;
                    prevUnifiedOrders = Number(prevSummary?.total_orders_accrual ?? prevSummary?.total_orders) || 0;
                    prevUnifiedCogs = Math.max(0, Number(prevSummary?.cogs) || 0);
                }

                const salesData = (kpi && typeof kpi === 'object') ? (kpi.sales || {}) : {};
                const prevSalesData = (prevKpi && typeof prevKpi === 'object') ? (prevKpi.sales || {}) : {};

                if (active) {
                    const grossSales = Number(salesData?.total_sales_accrual) || 0;
                    const returnsAmount = Number((salesData as any)?.returns_total ?? salesData?.returns) || 0;
                    const netSales = grossSales - returnsAmount;
                    const cogs = hasSalesSummary ? unifiedCogs : (Number(salesData?.cogs) || 0);
                    const adjustedCogs = Math.max(0, cogs);
                    const expenses = Number(salesData?.expenses) || 0;
                    const wastage = Number(salesData?.wastage) || 0;
                    const deliveryCost = Number(salesData?.delivery_cost) || 0;
                    const grossProfit = netSales - adjustedCogs;
                    const netProfit = grossProfit - expenses - wastage - deliveryCost;

                    const prevGrossSales = Number(prevSalesData?.total_sales_accrual) || 0;
                    const prevReturnsAmount = Number((prevSalesData as any)?.returns_total ?? prevSalesData?.returns) || 0;
                    const prevNetSales = prevGrossSales - prevReturnsAmount;
                    const prevCogs = hasSalesSummary ? prevUnifiedCogs : Math.max(0, Number(prevSalesData?.cogs) || 0);
                    const prevGrossProfit = prevNetSales - prevCogs;
                    const prevNetProfit = prevGrossProfit - (Number(prevSalesData?.expenses) || 0) - (Number(prevSalesData?.wastage) || 0) - (Number(prevSalesData?.delivery_cost) || 0);

                    const newStats = {
                        sales: hasSalesSummary ? unifiedSales : netSales,
                        grossSales,
                        returns: returnsAmount,
                        taxRefunds: Number((salesData as any)?.tax_refunds) || 0,
                        orders: hasSalesSummary ? unifiedOrders : (Number(salesData?.total_orders_accrual) || 0),
                        margin: netSales > 0 ? (grossProfit / netSales * 100) : 0,
                        grossProfit,
                        netProfit,
                        cogs: adjustedCogs,
                        collected: Number(salesData?.total_collected) || 0, // Added Collected
                        ar: Number((kpi as any)?.arTotal) || 0,
                        ap: Number((kpi as any)?.apTotal) || 0,
                        statusCounts: Object.entries(((kpi as any)?.orderStatusCounts || {}) as Record<string, number>).map(([status, cnt]) => ({ status, cnt })),
                        avgOrderValue: (hasSalesSummary ? unifiedOrders : (Number(salesData?.total_orders_accrual) || 0)) > 0
                            ? (hasSalesSummary ? unifiedSales : netSales) / ((hasSalesSummary ? unifiedOrders : (Number(salesData?.total_orders_accrual) || 1)) || 1)
                            : 0,
                        transit: Number((kpi as any)?.poInTransit) || 0,
                        poStatusCounts: (kpi as any)?.poStatusCounts || {},
                        inventoryValue: Number((kpi as any)?.inventoryValue) || 0,
                        // Channel breakdown
                        inStoreCount: Number(salesData?.in_store_count) || 0,
                        onlineCount: Number(salesData?.online_count) || 0,
                        deliveryCount: Number(salesData?.out_for_delivery_count) || 0,
                    };
                    setStats(newStats);
                    setKpiData(newStats);

                    setPrevStats({
                        sales: hasSalesSummary ? prevUnifiedSales : prevNetSales,
                        grossSales: prevGrossSales,
                        returns: prevReturnsAmount,
                        taxRefunds: Number((prevSalesData as any)?.tax_refunds) || 0,
                        orders: hasSalesSummary ? prevUnifiedOrders : (Number(prevSalesData?.total_orders_accrual) || 0),
                        margin: prevNetSales > 0 ? (prevGrossProfit / prevNetSales * 100) : 0,
                        grossProfit: prevGrossProfit,
                        netProfit: prevNetProfit,
                        cogs: prevCogs,
                        collected: Number(prevSalesData?.total_collected) || 0,
                        avgOrderValue: (hasSalesSummary ? prevUnifiedOrders : (Number(prevSalesData?.total_orders_accrual) || 0)) > 0
                            ? (hasSalesSummary ? prevUnifiedSales : prevNetSales) / ((hasSalesSummary ? prevUnifiedOrders : (Number(prevSalesData?.total_orders_accrual) || 1)) || 1)
                            : 0,
                    });
                }
            } catch (err) {
                console.error(err);
                if (active) {
                    setError(true);
                    const msg = formatDashboardLoadError(err) || localizeSupabaseError(err) || 'تعذر تحميل مؤشرات الأداء.';
                    setErrorMessage(msg);
                }
            } finally {
                if (active) setLoading(false);
            }
        };
        load();
        return () => { active = false; };
    }, [dateRange, refreshKey, warehouseId]);

    if (error) return <ErrorBanner message={errorMessage || 'تعذر تحميل مؤشرات الأداء.'} />;

    const cards = [
        {
            title: 'صافي المبيعات',
            value: stats?.sales ?? 0,
            prevValue: prevStats?.sales ?? 0,
            format: 'currency' as const,
            sub: currency,
            icon: Icons.CartIcon,
            gradient: 'from-emerald-500 to-teal-600',
            light: 'bg-emerald-50 dark:bg-emerald-900/20',
        },
        {
            title: 'عدد الطلبات',
            value: stats?.orders ?? 0,
            prevValue: prevStats?.orders ?? 0,
            format: 'int' as const,
            sub: 'طلب',
            icon: Icons.ShoppingBag,
            gradient: 'from-cyan-500 to-blue-600',
            light: 'bg-cyan-50 dark:bg-cyan-900/20',
        },
        {
            title: 'مجمل الربح', // Gross Profit
            value: stats?.grossProfit ?? 0,
            prevValue: prevStats?.grossProfit ?? 0,
            format: 'currency' as const,
            sub: currency,
            icon: Icons.TrendingUpIcon,
            gradient: 'from-violet-500 to-purple-600',
            light: 'bg-violet-50 dark:bg-violet-900/20',
        },
        {
            title: 'تكلفة المبيعات',
            value: stats?.cogs ?? 0,
            prevValue: prevStats?.cogs ?? 0,
            format: 'currency' as const,
            sub: currency,
            icon: Icons.ReceiptIcon,
            gradient: 'from-stone-500 to-neutral-600',
            light: 'bg-stone-50 dark:bg-stone-900/20',
        },
        {
            title: 'صافي الربح',
            value: stats?.netProfit ?? 0,
            prevValue: prevStats?.netProfit ?? 0,
            format: 'currency' as const,
            sub: currency,
            icon: Icons.DollarSign,
            gradient: 'from-amber-500 to-orange-600',
            light: 'bg-amber-50 dark:bg-amber-900/20',
        },
        {
            title: 'هامش الربح',
            value: stats?.margin ?? 0,
            prevValue: prevStats?.margin ?? 0,
            format: 'percent' as const,
            sub: 'نسبة',
            icon: Icons.PercentIcon || Icons.TrendingUpIcon,
            gradient: 'from-rose-500 to-pink-600',
            light: 'bg-rose-50 dark:bg-rose-900/20',
        },
    ];

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {cards.map((c, i) => (
                <div key={i} className={`glass-card rounded-2xl p-4 hover:shadow-lg transition-all duration-300 group opacity-0 animate-slide-in-up stagger-${i + 1}`}>
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider">{c.title}</p>
                        <div className={`p-2 bg-gradient-to-br ${c.gradient} rounded-lg shadow-md group-hover:scale-110 group-hover:shadow-lg transition-all duration-300`}>
                            <c.icon className="w-4 h-4 text-white" />
                        </div>
                    </div>
                    {loading ? (
                        <Skeleton className="h-8 w-24 mb-2" />
                    ) : (
                        <>
                            <div className="flex items-baseline gap-1.5 mb-1">
                                <h3 className="text-xl font-bold font-mono tracking-tight text-gray-900 dark:text-white">
                                    <AnimatedCounter value={c.value} format={c.format} currencyCode={c.format === 'currency' ? currency : undefined} />
                                </h3>
                                <span className="text-[10px] text-gray-400 font-medium">{c.sub}</span>
                            </div>
                            <ChangeIndicator current={c.value} previous={c.prevValue} />
                        </>
                    )}
                </div>
            ))}
        </div>
    );
};


// 3. REVENUE BY CHANNEL (Donut Chart)
export const RevenueByChannelChart: React.FC = () => {
    const { kpiData } = useDashboard();
    if (!kpiData) return null;

    const { inStoreCount, onlineCount, deliveryCount } = kpiData;
    const total = (inStoreCount || 0) + (onlineCount || 0) + (deliveryCount || 0);
    if (total === 0) return null;

    const segments = [
        { label: 'بيع محلي', count: inStoreCount || 0, color: '#6366f1' },
        { label: 'أونلاين', count: onlineCount || 0, color: '#06b6d4' },
        { label: 'توصيل', count: deliveryCount || 0, color: '#f59e0b' },
    ].filter(s => s.count > 0);

    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    let cumulativeOffset = 0;

    return (
        <div className="glass-card rounded-2xl p-5 animate-slide-in-up">
            <h3 className="font-bold text-gray-800 dark:text-gray-200 text-sm mb-4 flex items-center gap-2">
                <Icons.ReportIcon className="w-4 h-4 text-indigo-500" />
                توزيع الطلبات حسب القناة
            </h3>
            <div className="flex items-center gap-6">
                {/* Donut */}
                <div className="relative w-28 h-28 flex-shrink-0">
                    <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                        {segments.map((seg, i) => {
                            const pct = seg.count / total;
                            const dashLength = pct * circumference;
                            const offset = cumulativeOffset;
                            cumulativeOffset += dashLength;
                            return (
                                <circle
                                    key={i}
                                    cx="50" cy="50" r={radius}
                                    fill="none"
                                    stroke={seg.color}
                                    strokeWidth="12"
                                    strokeDasharray={`${dashLength} ${circumference - dashLength}`}
                                    strokeDashoffset={-offset}
                                    strokeLinecap="round"
                                    className="transition-all duration-1000"
                                />
                            );
                        })}
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center">
                            <span className="text-lg font-bold text-gray-800 dark:text-white">{fmtInt(total)}</span>
                            <br />
                            <span className="text-[9px] text-gray-400">طلب مسلّم</span>
                        </div>
                    </div>
                </div>
                {/* Legend */}
                <div className="flex flex-col gap-2 flex-1">
                    {segments.map((seg, i) => (
                        <div key={i} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
                                <span className="text-xs text-gray-600 dark:text-gray-400">{seg.label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold font-mono text-gray-800 dark:text-gray-200">{fmtInt(seg.count)}</span>
                                <span className="text-[10px] text-gray-400">({((seg.count / total) * 100).toFixed(0)}%)</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};


// 4. INVENTORY SECTION (Top Products + Low Stock Alerts)
export const InventorySection: React.FC = () => {
    const { dateRange, refreshKey, warehouseId } = useDashboard();
    const [topProducts, setTopProducts] = useState<any[]>([]);
    const [alerts, setAlerts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoading(true);
            setError(false);
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;

                const { data: products }: any = await supabase.rpc('get_product_sales_report_v9', {
                    p_start_date: dateRange.start.toISOString(),
                    p_end_date: dateRange.end.toISOString(),
                    p_zone_id: null
                });

                const { data: stock }: any = await supabase.rpc('get_inventory_stock_report', {
                    p_warehouse_id: warehouseId, p_search: null, p_limit: 1000
                });

                if (active) {
                    setTopProducts((products || []).sort((a: any, b: any) => (Number(b.total_sales) || 0) - (Number(a.total_sales) || 0)).slice(0, 5));
                    setAlerts((stock || []).filter((item: any) => {
                        const cur = Number(item.current_stock) || 0;
                        const threshold = Number(item.low_stock_threshold ?? item.min_stock ?? 5) || 5;
                        return cur > 0 && cur <= threshold;
                    }).slice(0, 5));
                }
            } catch (err) {
                console.error(err);
                if (active) setError(true);
            } finally {
                if (active) setLoading(false);
            }
        };
        load();
        return () => { active = false; };
    }, [dateRange, refreshKey, warehouseId]);

    if (error) return <ErrorBanner message="تعذر تحميل بيانات المخزون." />;

    return (
        <div className="glass-card rounded-2xl p-5 h-full flex flex-col gap-5 animate-slide-in-up stagger-2">
            {/* Top Products */}
            <div>
                <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2 text-sm">
                    <Icons.Star className="w-4 h-4 text-amber-500" />
                    الأكثر مبيعاً
                </h3>
                {loading ? <Skeleton className="h-36 w-full" /> : (
                    <div className="space-y-3">
                        {topProducts.length === 0 ? <p className="text-xs text-gray-400 text-center py-4">لا توجد بيانات</p> :
                            topProducts.map((p, i) => {
                                const pctWidth = Math.min(((Number(p.total_sales) || 0) / (Number(topProducts[0]?.total_sales) || 1)) * 100, 100);
                                return (
                                    <div key={i}>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-gray-700 dark:text-gray-300 truncate w-2/3 font-medium">{(p.item_name as any)?.ar || (p.item_name as any)?.en || 'منتج'}</span>
                                            <span className="text-gray-900 dark:text-white font-mono font-bold">{fmtCompact(Number(p.total_sales) || 0)}</span>
                                        </div>
                                        <div className="h-1.5 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                            <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all duration-1000" style={{ width: `${pctWidth}%` }} />
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                )}
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700/50" />

            {/* Low Stock */}
            <div>
                <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2 text-sm">
                    <Icons.InfoIcon className="w-4 h-4 text-red-500" />
                    مخزون منخفض
                </h3>
                {loading ? <Skeleton className="h-20 w-full" /> : (
                    <div className="space-y-2">
                        {alerts.length === 0 ? (
                            <div className="text-center py-3">
                                <span className="text-emerald-500 text-lg">✓</span>
                                <p className="text-xs text-gray-400 mt-1">المخزون في حالة جيدة</p>
                            </div>
                        ) : alerts.map((item, i) => (
                            <div key={i} className="flex justify-between items-center text-xs p-2 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/20">
                                <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{(item.item_name as any)?.ar || item.item_name}</span>
                                <span className="font-bold text-red-600 bg-white dark:bg-gray-800 px-2 py-0.5 rounded text-[11px] shadow-sm">
                                    {item.current_stock} {item.unit_type || 'قطعة'}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};


// 5. SALES CHART (Premium SVG with smooth curve)
export const SalesSection: React.FC = () => {
    const { dateRange, refreshKey, currency, warehouseId } = useDashboard();
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const [viewMode, setViewMode] = useState<'all' | 'wholesale'>('all');

    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoading(true); setError(false);
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;
                const rpcName = (await rpcHasFunction('public.get_daily_sales_stats_v2')) ? 'get_daily_sales_stats_v2' : 'get_daily_sales_stats';
                const payload: any = {
                    p_start_date: dateRange.start.toISOString(),
                    p_end_date: dateRange.end.toISOString(),
                    p_zone_id: null,
                    p_invoice_only: viewMode === 'wholesale'
                };
                if (rpcName === 'get_daily_sales_stats_v2') payload.p_warehouse_id = warehouseId;
                const { data: stats }: any = await supabase.rpc(rpcName, payload);
                if (active) setData(stats || []);
            } catch (err) { console.error(err); if (active) setError(true); }
            finally { if (active) setLoading(false); }
        };
        load();
        return () => { active = false; };
    }, [dateRange, refreshKey, viewMode, warehouseId]);

    const maxSales = useMemo(() => Math.max(...data.map(d => Number(d.total_sales)), 100), [data]);

    // Smooth cubic bezier path
    const linePath = useMemo(() => {
        if (data.length < 2) return '';
        const pts = data.map((d, i) => ({
            x: (i / (data.length - 1)) * 100,
            y: 100 - (Number(d.total_sales) / maxSales) * 100
        }));
        let path = `M ${pts[0].x},${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) {
            const prev = pts[i - 1];
            const curr = pts[i];
            const cpx = (prev.x + curr.x) / 2;
            path += ` C ${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
        }
        return path;
    }, [data, maxSales]);

    const areaPath = useMemo(() => {
        if (!linePath) return '';
        const lastPt = data.length > 0 ? (data.length - 1) / (data.length - 1) * 100 : 100;
        return `${linePath} L ${lastPt},100 L 0,100 Z`;
    }, [linePath, data.length]);

    const totalSales = useMemo(() => data.reduce((sum, d) => sum + Number(d.total_sales), 0), [data]);
    const totalOrders = useMemo(() => data.reduce((sum, d) => sum + Number(d.order_count), 0), [data]);

    const dateLabels = useMemo(() => {
        if (data.length < 3) return [];
        const step = Math.max(1, Math.floor(data.length / 5));
        const labels: { index: number; label: string }[] = [];
        for (let i = 0; i < data.length; i += step) {
            labels.push({ index: i, label: new Date(data[i].day_date).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' }) });
        }
        if (labels.length > 0 && labels[labels.length - 1].index !== data.length - 1) {
            labels.push({ index: data.length - 1, label: new Date(data[data.length - 1].day_date).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' }) });
        }
        return labels;
    }, [data]);

    if (error) return <ErrorBanner message="تعذر تحميل بيانات المبيعات." />;

    return (
        <div className="glass-card rounded-2xl p-5 h-full min-h-[420px] flex flex-col animate-slide-in-up stagger-1">
            {/* Header */}
            <div className="flex flex-wrap justify-between items-center mb-4 gap-3">
                <div className="flex items-center gap-3">
                    <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                        <Icons.TrendingUpIcon className="w-5 h-5 text-indigo-500" />
                        اتجاه المبيعات
                    </h3>
                    <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                        {(['all', 'wholesale'] as const).map(m => (
                            <button key={m} onClick={() => setViewMode(m)}
                                className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all ${viewMode === m ? 'bg-white dark:bg-gray-600 shadow text-indigo-600 dark:text-indigo-400' : 'text-gray-500'}`}>
                                {m === 'all' ? 'الكل' : 'جملة'}
                            </button>
                        ))}
                    </div>
                </div>
                {/* Quick Stats */}
                {!loading && data.length > 0 && (
                    <div className="flex items-center gap-4 text-xs">
                        <div className="text-center">
                            <div className="font-bold font-mono text-gray-800 dark:text-white">{fmtCompact(totalSales)}</div>
                            <div className="text-gray-400">{currency} إجمالي</div>
                        </div>
                        <div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />
                        <div className="text-center">
                            <div className="font-bold font-mono text-gray-800 dark:text-white">{fmtInt(totalOrders)}</div>
                            <div className="text-gray-400">طلب</div>
                        </div>
                    </div>
                )}
            </div>

            {/* Chart */}
            <div className="bg-gradient-to-b from-gray-50 to-gray-50/50 dark:from-gray-900 dark:to-gray-900/50 rounded-xl p-4 flex-1 relative overflow-hidden">
                {loading ? (
                    <div className="absolute inset-0 flex items-center justify-center"><Skeleton className="w-full h-full opacity-30 rounded-xl" /></div>
                ) : data.length < 2 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-2">
                        <Icons.ReportIcon className="w-8 h-8 opacity-30" />
                        <span className="text-sm">لا توجد بيانات كافية</span>
                    </div>
                ) : (
                    <div className="relative w-full h-full min-h-[250px]">
                        {/* Tooltip */}
                        {hoverIndex !== null && data[hoverIndex] && (
                            <div className="absolute bg-white dark:bg-gray-800 shadow-2xl rounded-xl p-3 text-xs border border-gray-100 dark:border-gray-600 z-10 pointer-events-none transform -translate-x-1/2 -translate-y-full"
                                style={{
                                    left: `${(hoverIndex / (data.length - 1)) * 100}%`,
                                    top: `${Math.max(10, 100 - (Number(data[hoverIndex].total_sales) / maxSales) * 100 - 5)}%`
                                }}>
                                <div className="font-bold text-indigo-600 font-mono text-sm">{fmt(data[hoverIndex].total_sales)} {currency}</div>
                                <div className="text-gray-500 mt-1">{new Date(data[hoverIndex].day_date).toLocaleDateString('ar-EG', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                                <div className="text-gray-400 mt-0.5">{data[hoverIndex].order_count} طلب</div>
                            </div>
                        )}

                        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible"
                            onMouseLeave={() => setHoverIndex(null)}
                            onMouseMove={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const x = e.clientX - rect.left;
                                const index = Math.round((x / rect.width) * (data.length - 1));
                                setHoverIndex(Math.max(0, Math.min(index, data.length - 1)));
                            }}>
                            <defs>
                                <linearGradient id="chartGrad" x1="0" x2="0" y1="0" y2="1">
                                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.25" />
                                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
                                </linearGradient>
                            </defs>

                            {/* Grid */}
                            {[25, 50, 75].map(y => (
                                <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="currentColor" strokeOpacity="0.04" vectorEffect="non-scaling-stroke" />
                            ))}

                            {/* Area */}
                            <path d={areaPath} fill="url(#chartGrad)" />

                            {/* Line */}
                            <path d={linePath} fill="none" stroke="#6366f1" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" className="animate-draw-line" />

                            {/* Hover */}
                            {hoverIndex !== null && (
                                <>
                                    <line
                                        x1={(hoverIndex / (data.length - 1)) * 100} y1="0"
                                        x2={(hoverIndex / (data.length - 1)) * 100} y2="100"
                                        stroke="#6366f1" strokeDasharray="2 3" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.4" />
                                    <circle
                                        cx={(hoverIndex / (data.length - 1)) * 100}
                                        cy={100 - (Number(data[hoverIndex].total_sales) / maxSales) * 100}
                                        r="5" fill="#6366f1" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                                </>
                            )}
                        </svg>
                    </div>
                )}
            </div>

            {/* Date Labels */}
            <div className="mt-2 flex justify-between text-[9px] text-gray-400 px-1">
                {dateLabels.map((dl, i) => <span key={i}>{dl.label}</span>)}
            </div>
        </div>
    );
};


// 6. PURCHASING SECTION
export const PurchasingSection: React.FC = () => {
    const { refreshKey } = useDashboard();
    const { kpiData } = useDashboard();
    const { currency } = useDashboard();
    const { warehouseId } = useDashboard();
    const purchasesTotal = Number((kpiData as any)?.purchasesTotal ?? 0) || 0;
    const purchaseReturnsTotal = Number((kpiData as any)?.purchaseReturnsTotal ?? 0) || 0;
    const netPurchases = Number((kpiData as any)?.netPurchases ?? 0) || 0;
    const [poStats, setPoStats] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoading(true); setError(false);
            try {
                const fromKpi = (kpiData && typeof kpiData === 'object') ? ((kpiData as any).poStatusCounts || null) : null;
                if (fromKpi && typeof fromKpi === 'object') {
                    const counts: Record<string, number> = {};
                    Object.entries(fromKpi as Record<string, any>).forEach(([k, v]) => {
                        const n = Number(v) || 0;
                        if (k) counts[k] = n;
                    });
                    if (active) {
                        setPoStats(counts);
                        setLoading(false);
                    }
                    return;
                }
                const supabase = getSupabaseClient();
                if (!supabase) return;
                let q: any = supabase.from('purchase_orders').select('status,warehouse_id');
                if (warehouseId) q = q.eq('warehouse_id', warehouseId);
                const { data }: any = await q;
                if (active && data) {
                    const counts: Record<string, number> = {};
                    data.forEach((po: any) => { counts[po.status] = (counts[po.status] || 0) + 1; });
                    setPoStats(counts);
                }
            } catch (err) { console.error(err); if (active) setError(true); }
            finally { if (active) setLoading(false); }
        };
        load();
        return () => { active = false; };
    }, [kpiData, refreshKey]);

    const statuses = [
        { key: 'draft', label: 'مسودة', color: '#eab308' },
        { key: 'partial', label: 'استلام جزئي', color: '#8b5cf6' },
        { key: 'completed', label: 'مكتمل', color: '#22c55e' },
        { key: 'cancelled', label: 'ملغي', color: '#9ca3af' },
    ];

    const total = Object.values(poStats).reduce((a, b) => a + b, 0);

    if (error) return <ErrorBanner message="تعذر تحميل بيانات المشتريات." />;

    return (
        <div className="glass-card rounded-2xl p-5 h-full flex flex-col animate-slide-in-up stagger-3">
            <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2 text-sm">
                <Icons.TruckIcon className="w-4 h-4 text-indigo-500" />
                المشتريات
                {total > 0 && <span className="text-xs font-mono text-gray-400 mr-1">({total})</span>}
            </h3>

            {loading ? <Skeleton className="h-48 w-full" /> : (
                <div className="flex-1 flex flex-col justify-center gap-3">
                    {/* Stacked Bar */}
                    <div className="h-3 w-full flex rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
                        {statuses.map(s => {
                            const count = poStats[s.key] || 0;
                            if (count === 0 || total === 0) return null;
                            return <div key={s.key} className="h-full transition-all duration-700" style={{ width: `${(count / total) * 100}%`, backgroundColor: s.color }} title={`${s.label}: ${count}`} />;
                        })}
                    </div>

                    {/* Legend */}
                    <div className="space-y-2 mt-2">
                        {statuses.map(s => {
                            const count = poStats[s.key] || 0;
                            return (
                                <div key={s.key} className={`flex justify-between items-center text-xs ${count === 0 ? 'opacity-30' : ''}`}>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                                        <span className="text-gray-600 dark:text-gray-400">{s.label}</span>
                                    </div>
                                    <span className="font-bold font-mono text-gray-900 dark:text-gray-200">{count}</span>
                                </div>
                            );
                        })}
                    </div>
                    {(purchasesTotal > 0 || purchaseReturnsTotal > 0) && (
                        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/50 space-y-1 text-[11px]">
                            <div className="flex items-center justify-between">
                                <span className="text-gray-500 dark:text-gray-400">مشتريات الفترة</span>
                                <span className="font-mono font-bold text-gray-900 dark:text-gray-200">{fmtCompact(purchasesTotal)} <span className="text-[10px] font-normal text-gray-400">{currency}</span></span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-gray-500 dark:text-gray-400">مرتجعات مشتريات</span>
                                <span className="font-mono font-bold text-gray-900 dark:text-gray-200">{fmtCompact(purchaseReturnsTotal)} <span className="text-[10px] font-normal text-gray-400">{currency}</span></span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-gray-500 dark:text-gray-400">صافي المشتريات</span>
                                <span className="font-mono font-bold text-gray-900 dark:text-gray-200">{fmtCompact(netPurchases)} <span className="text-[10px] font-normal text-gray-400">{currency}</span></span>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};


// 7. FINANCIAL POSITION CARD (Cash, AR, AP, Net)
export const FinancialPositionCard: React.FC = () => {
    const { kpiData, currency } = useDashboard();
    if (!kpiData) return null;

    const { collected, ar, ap } = kpiData;
    const net = (collected || 0) + (ar || 0) - (ap || 0);
    const dp = getCurrencyDecimalsByCode(currency);

    const items = [
        { label: 'تحصيل الفترة', value: collected, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
        { label: 'لي (مدينون)', value: ar, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
        { label: 'علي (دائنون)', value: ap, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20' },
        { label: 'الصافي التقريبي', value: net, color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20', bold: true },
    ];

    return (
        <div className="glass-card rounded-2xl p-5 animate-slide-in-up">
            <h3 className="font-bold text-gray-800 dark:text-gray-200 text-sm mb-4 flex items-center gap-2">
                <Icons.BankIcon className="w-4 h-4 text-emerald-500" />
                الوضع المالي
            </h3>
            <div className="grid grid-cols-2 gap-3">
                {items.map((item, i) => (
                    <div key={i} className={`p-3 rounded-xl ${item.bg}`}>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">{item.label}</div>
                        <div className={`text-sm font-mono ${item.bold ? 'font-bold' : 'font-medium'} ${item.color}`}>
                            {fmt(item.value, dp)} <span className="text-[9px] text-gray-400">{currency}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// 8. SALES ORDER STATUS ROW
export const SalesStatusRow: React.FC = () => {
    const { kpiData } = useDashboard();
    if (!kpiData?.statusCounts) return null;

    const counts = kpiData.statusCounts.reduce((acc: any, curr: any) => {
        acc[curr.status] = (acc[curr.status] || 0) + (Number(curr.cnt) || 0);
        return acc;
    }, {});

    const statuses = [
        { key: 'pending', label: 'انتظار', color: 'bg-yellow-100 text-yellow-700', icon: Icons.ClockIcon },
        { key: 'preparing', label: 'تحضير', color: 'bg-blue-100 text-blue-700', icon: Icons.RotateCwIcon },
        { key: 'out_for_delivery', label: 'توصيل', color: 'bg-orange-100 text-orange-700', icon: Icons.TruckIcon },
        { key: 'scheduled', label: 'مجدول', color: 'bg-purple-100 text-purple-700', icon: Icons.Calendar },
    ];

    return (
        <div className="mt-6 mb-2 grid grid-cols-2 md:grid-cols-4 gap-3">
            {statuses.map((s) => (
                <div key={s.key} className="glass-card p-3 rounded-xl flex items-center justify-between shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${s.color} bg-opacity-50`}>
                            <s.icon className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{s.label}</span>
                    </div>
                    <span className="text-lg font-mono font-bold text-gray-900 dark:text-white">
                        {counts[s.key] || 0}
                    </span>
                </div>
            ))}
        </div>
    );
};


// 9. TOP DEBTORS
export const TopDebtorsSection: React.FC = () => {
    const { hasPermission } = useAuth();
    const { currency, refreshKey, dateRange } = useDashboard();
    const [debtors, setDebtors] = useState<{ name: string; amount: number; overdueDays: number }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const canView = hasPermission('accounting.view');

    useEffect(() => {
        if (!canView) { setLoading(false); return; }
        let active = true;
        const load = async () => {
            setLoading(true); setError(false);
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;
                const { data: arData } = await supabase
                    .from('party_ar_aging_summary')
                    .select('party_id,total_outstanding,days_91_plus,days_61_90,days_31_60,days_1_30')
                    .gt('total_outstanding', 0)
                    .order('total_outstanding', { ascending: false })
                    .limit(5);

                const arRows = Array.isArray(arData) ? arData : [];
                if (arRows.length === 0) { if (active) { setDebtors([]); setLoading(false); } return; }

                const ids = arRows.map((r: any) => r.party_id);
                const { data: pData } = await supabase.from('financial_parties').select('id,name').in('id', ids);
                const nameMap: Record<string, string> = {};
                (Array.isArray(pData) ? pData : []).forEach((r: any) => { nameMap[String(r.id)] = String(r.name || '—'); });

                if (active) {
                    setDebtors(arRows.map((r: any) => {
                        let overdueDays = 0;
                        if (Number(r.days_91_plus || 0) > 0) overdueDays = 91;
                        else if (Number(r.days_61_90 || 0) > 0) overdueDays = 61;
                        else if (Number(r.days_31_60 || 0) > 0) overdueDays = 31;
                        else if (Number(r.days_1_30 || 0) > 0) overdueDays = 1;
                        return { name: nameMap[String(r.party_id)] || String(r.party_id).slice(-6), amount: Number(r.total_outstanding || 0), overdueDays };
                    }));
                }
            } catch (err) { console.error(err); if (active) setError(true); }
            finally { if (active) setLoading(false); }
        };
        void load();
        return () => { active = false; };
    }, [canView, refreshKey, dateRange]);

    if (!canView) return null;
    if (!loading && debtors.length === 0 && !error) return null;
    if (error) return <ErrorBanner message="تعذر تحميل بيانات المدينين." />;

    const overdueColor = (d: number) => d >= 91 ? 'text-red-500' : d >= 31 ? 'text-orange-500' : d >= 1 ? 'text-yellow-600' : 'text-emerald-500';
    const overdueBg = (d: number) => d >= 91 ? 'bg-red-50 dark:bg-red-900/20' : d >= 31 ? 'bg-orange-50 dark:bg-orange-900/20' : d >= 1 ? 'bg-yellow-50 dark:bg-yellow-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20';
    const overdueLabel = (d: number) => d >= 91 ? 'متأخر جداً' : d >= 61 ? '61-90 يوم' : d >= 31 ? '31-60 يوم' : d >= 1 ? '1-30 يوم' : 'حالي';

    return (
        <div className="glass-card rounded-2xl p-5 animate-slide-in-up">
            <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2 text-sm">
                <Icons.CustomersIcon className="w-4 h-4 text-blue-500" />
                أكبر المدينين
                <span className="text-[10px] text-gray-400 font-normal">(لي عند الناس)</span>
            </h3>
            {loading ? <Skeleton className="h-32 w-full" /> : (
                <div className="space-y-1.5">
                    {debtors.map((d, i) => (
                        <div key={i} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/30 transition group">
                            <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                                <span className="text-sm font-medium dark:text-white truncate max-w-[180px]">{d.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${overdueColor(d.overdueDays)} ${overdueBg(d.overdueDays)}`}>
                                    {overdueLabel(d.overdueDays)}
                                </span>
                                <span className="text-sm font-bold font-mono text-blue-600 dark:text-blue-400" dir="ltr">
                                    {fmtCompact(d.amount)} <span className="text-[10px] font-normal text-gray-400">{currency}</span>
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};


// 8. PROFIT WATERFALL (Quick Breakdown)
export const ProfitSummaryCard: React.FC = () => {
    const { kpiData, currency } = useDashboard();
    if (!kpiData || !kpiData.sales) return null;

    const items = [
        { label: 'المبيعات', value: kpiData.sales, color: 'bg-emerald-500', isTotal: true },
        { label: 'صافي الربح', value: kpiData.netProfit, color: kpiData.netProfit >= 0 ? 'bg-emerald-500' : 'bg-red-500', isTotal: true },
    ];

    const profitPct = kpiData.sales > 0 ? ((kpiData.netProfit / kpiData.sales) * 100).toFixed(1) : '0.0';

    return (
        <div className="glass-card rounded-2xl p-5 animate-slide-in-up stagger-4">
            <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2 text-sm">
                <Icons.DollarSign className="w-4 h-4 text-amber-500" />
                ملخص الربحية
            </h3>
            <div className="flex items-end gap-4 mb-3">
                <div>
                    <span className="text-3xl font-bold font-mono text-gray-900 dark:text-white">{profitPct}%</span>
                    <span className="text-xs text-gray-400 mr-1">هامش صافي</span>
                </div>
            </div>
            <div className="space-y-2">
                {items.map((item, i) => (
                    <div key={i} className="flex justify-between items-center text-xs">
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${item.color}`} />
                            <span className={`text-gray-600 dark:text-gray-400 ${item.isTotal ? 'font-bold' : ''}`}>{item.label}</span>
                        </div>
                        <span className={`font-mono ${item.isTotal ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`} dir="ltr">
                            {fmt(Math.abs(item.value))} {currency}
                        </span>
                    </div>
                ))}
            </div>
            {/* Mini Profit Bar */}
            <div className="mt-3 h-2 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-1000 ${kpiData.netProfit >= 0 ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' : 'bg-gradient-to-r from-red-400 to-red-600'}`}
                    style={{ width: `${Math.min(Math.max(Number(profitPct), 0), 100)}%` }}
                />
            </div>
        </div>
    );
};
