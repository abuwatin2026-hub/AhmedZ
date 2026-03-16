import React, { useEffect, useState, useMemo } from 'react';
import { getSupabaseClient, getBaseCurrencyCode } from '../../supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useOrders } from '../../contexts/OrderContext';
import { useSessionScope } from '../../contexts/SessionScopeContext';
import { useWarehouses } from '../../contexts/WarehouseContext';
import * as Icons from '../icons';

// ─── Helpers ───────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString('en-US');
const pct = (n: number) => `${n.toFixed(1)}%`;

const getToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
};

const getYesterday = () => {
    const d = getToday();
    d.setDate(d.getDate() - 1);
    return d;
};

const getMonthStart = () => {
    const d = getToday();
    d.setDate(1);
    return d;
};

const getEndOfDay = (d: Date) => {
    const e = new Date(d);
    e.setHours(23, 59, 59, 999);
    return e;
};

// Skeleton card
const SkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`h-28 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse ${className}`} />
);

// ─── Widget Card Shell ─────────────────────────────────────────────────
const WidgetCard: React.FC<{
    title: string;
    icon?: React.FC<any>;
    iconColor?: string;
    iconBg?: string;
    children: React.ReactNode;
    className?: string;
}> = ({ title, icon: IconComp, iconColor, iconBg, children, className = '' }) => (
    <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
            {IconComp && (
                <div className={`p-1.5 rounded-lg ${iconBg || 'bg-gray-100 dark:bg-gray-700'}`}>
                    <IconComp className={`w-4 h-4 ${iconColor || 'text-gray-600 dark:text-gray-300'}`} />
                </div>
            )}
            <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300">{title}</h3>
        </div>
        {children}
    </div>
);

// Stat inside a widget
const StatItem: React.FC<{
    label: string;
    value: string;
    valueColor?: string;
    sub?: string;
}> = ({ label, value, valueColor = 'text-gray-900 dark:text-white', sub }) => (
    <div className="text-center">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
        <div className={`text-lg font-bold font-mono ${valueColor}`} dir="ltr">{value}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
);

// ─── 1. TODAY'S SALES WIDGET ───────────────────────────────────────────
export const TodaySalesWidget: React.FC = () => {
    const { hasPermission } = useAuth();
    const [todayData, setTodayData] = useState<any>(null);
    const [yesterdayData, setYesterdayData] = useState<any>(null);
    const [currency, setCurrency] = useState('');
    const [loading, setLoading] = useState(true);

    const canView = hasPermission('accounting.view');

    useEffect(() => {
        if (!canView) { setLoading(false); return; }
        const load = async () => {
            setLoading(true);
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;
                const c = await getBaseCurrencyCode();
                if (c) setCurrency(c);

                const today = getToday();
                const endToday = getEndOfDay(new Date());
                const yesterday = getYesterday();
                const endYesterday = getEndOfDay(yesterday);

                const [{ data: td }, { data: yd }] = await Promise.all([
                    supabase.rpc('get_sales_report_summary', {
                        p_start_date: today.toISOString(),
                        p_end_date: endToday.toISOString(),
                        p_zone_id: null,
                        p_invoice_only: false,
                    }),
                    supabase.rpc('get_sales_report_summary', {
                        p_start_date: yesterday.toISOString(),
                        p_end_date: endYesterday.toISOString(),
                        p_zone_id: null,
                        p_invoice_only: false,
                    }),
                ]);
                setTodayData(td);
                setYesterdayData(yd);
            } catch (err) {
                console.error('TodaySalesWidget error:', err);
            } finally {
                setLoading(false);
            }
        };
        void load();
    }, [canView]);

    if (!canView) return null;
    if (loading) return <SkeletonCard />;

    const revenueGross = Number(todayData?.total_sales_accrual || todayData?.total_collected || 0);
    const revenueReturns = Number((todayData?.returns_total ?? todayData?.returns) || 0);
    const revenue = revenueGross - revenueReturns;
    const orders = Number(todayData?.total_orders_accrual || todayData?.total_orders || 0);
    const avg = orders > 0 ? revenue / orders : 0;
    const yesterdayRevenueGross = Number(yesterdayData?.total_sales_accrual || yesterdayData?.total_collected || 0);
    const yesterdayRevenueReturns = Number((yesterdayData?.returns_total ?? yesterdayData?.returns) || 0);
    const yesterdayRevenue = yesterdayRevenueGross - yesterdayRevenueReturns;
    const diff = yesterdayRevenue > 0 ? ((revenue - yesterdayRevenue) / yesterdayRevenue) * 100 : 0;

    return (
        <WidgetCard title="مبيعات اليوم" icon={Icons.CartIcon} iconColor="text-orange-500" iconBg="bg-orange-50 dark:bg-orange-900/20">
            <div className="grid grid-cols-3 gap-3">
                <StatItem label="الإيراد" value={fmt(revenue)} valueColor="text-green-600 dark:text-green-400" sub={currency} />
                <StatItem label="الطلبات" value={fmtInt(orders)} />
                <StatItem label="متوسط الطلب" value={fmt(avg)} sub={currency} />
            </div>
            {yesterdayRevenue > 0 && (
                <div className={`mt-3 text-center text-xs font-medium ${diff >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {diff >= 0 ? '▲' : '▼'} {Math.abs(diff).toFixed(1)}% مقارنة بالأمس
                </div>
            )}
        </WidgetCard>
    );
};

// ─── 2. PROFITABILITY WIDGET ───────────────────────────────────────────
export const ProfitabilityWidget: React.FC = () => {
    const { hasPermission } = useAuth();
    const [data, setData] = useState<any>(null);
    const [currency, setCurrency] = useState('');
    const [loading, setLoading] = useState(true);

    const canView = hasPermission('accounting.view');

    useEffect(() => {
        if (!canView) { setLoading(false); return; }
        const load = async () => {
            setLoading(true);
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;
                const c = await getBaseCurrencyCode();
                if (c) setCurrency(c);

                const start = getMonthStart();
                const end = getEndOfDay(new Date());

                const { data: d } = await supabase.rpc('get_sales_report_summary', {
                    p_start_date: start.toISOString(),
                    p_end_date: end.toISOString(),
                    p_zone_id: null,
                    p_invoice_only: false,
                });
                setData(d);
            } catch (err) {
                console.error('ProfitabilityWidget error:', err);
            } finally {
                setLoading(false);
            }
        };
        void load();
    }, [canView]);

    if (!canView) return null;
    if (loading) return <SkeletonCard />;
    if (!data) return null;

    const revenueGross = Number(data.total_sales_accrual || data.total_collected || 0);
    const returns = Number((data.returns_total ?? data.returns) || 0);
    const revenue = revenueGross - returns;
    const cogs = Number(data.cogs || 0);
    const expenses = Number(data.expenses || 0);
    const wastage = Number(data.wastage || 0);
    const deliveryCost = Number(data.delivery_cost || 0);
    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - wastage - expenses - deliveryCost;
    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

    return (
        <WidgetCard title="ربحية الشهر الحالي" icon={Icons.ReportIcon} iconColor="text-purple-500" iconBg="bg-purple-50 dark:bg-purple-900/20">
            <div className="grid grid-cols-2 gap-3 mb-3">
                <StatItem label="مجمل الربح" value={fmt(grossProfit)} valueColor="text-blue-600 dark:text-blue-400" sub={currency} />
                <StatItem label="صافي الربح" value={fmt(netProfit)} valueColor={netProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} sub={currency} />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <StatItem label="هامش إجمالي" value={pct(grossMargin)} valueColor="text-blue-500" />
                <StatItem label="هامش صافي" value={pct(netMargin)} valueColor={netMargin >= 0 ? 'text-green-500' : 'text-red-500'} />
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                <div>تكلفة البضاعة: <span className="font-mono text-red-500" dir="ltr">{fmt(cogs)}</span></div>
                <div>المصاريف: <span className="font-mono text-red-500" dir="ltr">{fmt(expenses + wastage + deliveryCost)}</span></div>
            </div>
        </WidgetCard>
    );
};

// ─── 3. ORDER STATUS WIDGET ───────────────────────────────────────────
export const OrderStatusWidget: React.FC = () => {
    const { orders } = useOrders();

    const counts = useMemo(() => {
        const pending = orders.filter(o => o.status === 'pending').length;
        const preparing = orders.filter(o => o.status === 'preparing').length;
        const outForDelivery = orders.filter(o => o.status === 'out_for_delivery').length;
        const deliveredToday = orders.filter(o => {
            if (o.status !== 'delivered') return false;
            const d = new Date(o.createdAt as any);
            const today = getToday();
            return d >= today;
        }).length;
        return { pending, preparing, outForDelivery, deliveredToday };
    }, [orders]);

    const statusCards = [
        { label: 'قيد الانتظار', count: counts.pending, color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-900/20', ring: 'ring-yellow-200' },
        { label: 'جاري التحضير', count: counts.preparing, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', ring: 'ring-blue-200' },
        { label: 'خرج للتوصيل', count: counts.outForDelivery, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', ring: 'ring-purple-200' },
        { label: 'تم التسليم اليوم', count: counts.deliveredToday, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', ring: 'ring-green-200' },
    ];

    return (
        <WidgetCard title="حالة الطلبات" icon={Icons.OrdersIcon} iconColor="text-indigo-500" iconBg="bg-indigo-50 dark:bg-indigo-900/20">
            <div className="grid grid-cols-4 gap-2">
                {statusCards.map(s => (
                    <div key={s.label} className={`${s.bg} rounded-lg p-3 text-center`}>
                        <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.count}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{s.label}</div>
                    </div>
                ))}
            </div>
        </WidgetCard>
    );
};

// ─── 4. INVENTORY ALERTS WIDGET ────────────────────────────────────────
export const InventoryAlertsWidget: React.FC = () => {
    const { hasPermission } = useAuth();
    const { warehouses } = useWarehouses();
    const { scope } = useSessionScope();
    const [lowCount, setLowCount] = useState(0);
    const [outCount, setOutCount] = useState(0);
    const [outItems, setOutItems] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    const canView = hasPermission('inventory.view') || hasPermission('accounting.view');
    const warehouseId = scope?.warehouseId || warehouses?.[0]?.id || '';

    useEffect(() => {
        if (!canView || !warehouseId) { setLoading(false); return; }
        const load = async () => {
            setLoading(true);
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;

                // Get low stock count
                const [{ data: lowData }, { data: outData }] = await Promise.all([
                    supabase.rpc('get_inventory_stock_report', {
                        p_warehouse_id: warehouseId,
                        p_category: null, p_group: null, p_supplier_id: null,
                        p_stock_filter: 'low',
                        p_search: null, p_limit: 1, p_offset: 0,
                    } as any),
                    supabase.rpc('get_inventory_stock_report', {
                        p_warehouse_id: warehouseId,
                        p_category: null, p_group: null, p_supplier_id: null,
                        p_stock_filter: 'out',
                        p_search: null, p_limit: 5, p_offset: 0,
                    } as any),
                ]);

                const lowRows = Array.isArray(lowData) ? lowData : [];
                const outRows = Array.isArray(outData) ? outData : [];
                setLowCount(lowRows.length > 0 ? Number((lowRows[0] as any)?.total_count || lowRows.length) : 0);
                setOutCount(outRows.length > 0 ? Number((outRows[0] as any)?.total_count || outRows.length) : 0);
                setOutItems(outRows.slice(0, 5).map((r: any) => {
                    const n = r?.item_name;
                    return String(n?.ar || n?.en || r?.item_id || '—');
                }));
            } catch (err) {
                console.error('InventoryAlertsWidget error:', err);
            } finally {
                setLoading(false);
            }
        };
        void load();
    }, [canView, warehouseId]);

    if (!canView) return null;
    if (loading) return <SkeletonCard />;

    const hasAlerts = lowCount > 0 || outCount > 0;

    return (
        <WidgetCard title="تنبيهات المخزون" icon={Icons.Package} iconColor="text-amber-600" iconBg="bg-amber-50 dark:bg-amber-900/20">
            {!hasAlerts ? (
                <div className="text-center text-sm text-green-600 dark:text-green-400 py-4">
                    ✅ لا توجد تنبيهات — المخزون جيد
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-center">
                            <div className="text-2xl font-bold font-mono text-amber-600">{lowCount}</div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">مخزون منخفض</div>
                        </div>
                        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
                            <div className="text-2xl font-bold font-mono text-red-600">{outCount}</div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">نفد من المخزون</div>
                        </div>
                    </div>
                    {outItems.length > 0 && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-semibold text-red-500">نفدت:</span>{' '}
                            {outItems.join('، ')}
                        </div>
                    )}
                </>
            )}
        </WidgetCard>
    );
};

// ─── 5. TOP DEBTORS WIDGET ─────────────────────────────────────────────
export const TopDebtorsWidget: React.FC = () => {
    const { hasPermission } = useAuth();
    const [debtors, setDebtors] = useState<{ name: string; amount: number; overdueDays: number }[]>([]);
    const [currency, setCurrency] = useState('');
    const [loading, setLoading] = useState(true);

    const canView = hasPermission('accounting.view');

    useEffect(() => {
        if (!canView) { setLoading(false); return; }
        const load = async () => {
            setLoading(true);
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;
                const c = await getBaseCurrencyCode();
                if (c) setCurrency(c);

                // Get top AR records
                const { data: arData } = await supabase
                    .from('party_ar_aging_summary')
                    .select('party_id,total_outstanding,days_91_plus,days_61_90,days_31_60,days_1_30')
                    .order('total_outstanding', { ascending: false })
                    .limit(5);

                const arRows = Array.isArray(arData) ? arData : [];
                if (arRows.length === 0) { setDebtors([]); setLoading(false); return; }

                // Get party names
                const ids = arRows.map((r: any) => r.party_id);
                const { data: pData } = await supabase
                    .from('financial_parties')
                    .select('id,name')
                    .in('id', ids);

                const nameMap: Record<string, string> = {};
                (Array.isArray(pData) ? pData : []).forEach((r: any) => {
                    nameMap[String(r.id)] = String(r.name || '—');
                });

                setDebtors(arRows.map((r: any) => {
                    // Estimate max overdue bucket
                    let overdueDays = 0;
                    if (Number(r.days_91_plus || 0) > 0) overdueDays = 91;
                    else if (Number(r.days_61_90 || 0) > 0) overdueDays = 61;
                    else if (Number(r.days_31_60 || 0) > 0) overdueDays = 31;
                    else if (Number(r.days_1_30 || 0) > 0) overdueDays = 1;

                    return {
                        name: nameMap[String(r.party_id)] || String(r.party_id).slice(-6),
                        amount: Number(r.total_outstanding || 0),
                        overdueDays,
                    };
                }));
            } catch (err) {
                console.error('TopDebtorsWidget error:', err);
            } finally {
                setLoading(false);
            }
        };
        void load();
    }, [canView]);

    if (!canView) return null;
    if (loading) return <SkeletonCard />;
    if (debtors.length === 0) return null;

    const overdueColor = (days: number) => {
        if (days >= 91) return 'text-red-600';
        if (days >= 31) return 'text-orange-500';
        if (days >= 1) return 'text-yellow-600';
        return 'text-green-600';
    };

    const overdueLabel = (days: number) => {
        if (days >= 91) return 'متأخر جداً';
        if (days >= 61) return '61-90 يوم';
        if (days >= 31) return '31-60 يوم';
        if (days >= 1) return '1-30 يوم';
        return 'حالي';
    };

    return (
        <WidgetCard title="أكبر المدينين (لي عند الناس)" icon={Icons.CustomersIcon} iconColor="text-blue-600" iconBg="bg-blue-50 dark:bg-blue-900/20">
            <div className="space-y-2">
                {debtors.map((d, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-gray-700 last:border-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-gray-400 w-4">{i + 1}</span>
                            <span className="text-sm font-medium dark:text-white truncate max-w-[140px]">{d.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className={`text-xs font-medium ${overdueColor(d.overdueDays)}`}>{overdueLabel(d.overdueDays)}</span>
                            <span className="text-sm font-bold font-mono text-blue-600 dark:text-blue-400" dir="ltr">
                                {fmt(d.amount)} <span className="text-xs font-normal text-gray-400">{currency}</span>
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </WidgetCard>
    );
};
