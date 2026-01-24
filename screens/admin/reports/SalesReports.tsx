import React, { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { useDeliveryZones } from '../../../contexts/DeliveryZoneContext';
import { exportToXlsx, sharePdf } from '../../../utils/export';
import BarChart from '../../../components/admin/charts/BarChart';
import HorizontalBarChart from '../../../components/admin/charts/HorizontalBarChart';
import LineChart from '../../../components/admin/charts/LineChart';
import { getSupabaseClient } from '../../../supabase';
import { useSettings } from '../../../contexts/SettingsContext';
import { localizeSupabaseError } from '../../../utils/errorUtils';

const SalesReports: React.FC = () => {
    const { showNotification } = useToast();
    const { deliveryZones } = useDeliveryZones();
    
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [rangePreset, setRangePreset] = useState<'today' | 'week' | 'month' | 'year' | 'all'>('all');
    const [selectedZoneId, setSelectedZoneId] = useState<string>('');
    const [invoiceOnly, setInvoiceOnly] = useState(false);
    const [orderSearch, setOrderSearch] = useState('');
    const [showAllOrders, setShowAllOrders] = useState(false);

    // --- New State for Server-Side Data ---
    const [driverStats, setDriverStats] = useState<{name: string, count: number, avgTime: number}[]>([]);
    const [serverOrders, setServerOrders] = useState<any[]>([]);
    const [ordersLoading, setOrdersLoading] = useState(false);

    const getEffectiveDate = (order: any) => new Date(order.dateBy || order.invoiceIssuedAt || order.paidAt || order.deliveredAt || order.createdAt || new Date().toISOString());

    const range = useMemo(() => {
        if (!startDate || !endDate) return undefined;
        
        const getStartOfDay = (dateStr: string) => {
            const parts = dateStr.split('-');
            if (parts.length !== 3) return new Date(dateStr);
            return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
        };

        const getEndOfDay = (dateStr: string) => {
            const parts = dateStr.split('-');
            if (parts.length !== 3) return new Date(dateStr);
            return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 23, 59, 59, 999);
        };

        const start = getStartOfDay(startDate);
        const end = getEndOfDay(endDate);
        return { start, end };
    }, [startDate, endDate]);

    const effectiveRange = useMemo(() => {
        if (range) return range;
        if (rangePreset === 'all') return { start: new Date(0), end: new Date() };
        return undefined;
    }, [range, rangePreset]);

    const language = 'ar';
    const [isSharing, setIsSharing] = useState(false);
    const { settings } = useSettings();
    // Removed zoneOrders state (unused)
    const [serverSummary, setServerSummary] = useState<any | null>(null);
    const methodLabel = (method: string) => {
        const m = (method || '').toLowerCase();
        if (m === 'cash') return 'نقد';
        if (m === 'network') return 'شبكة';
        if (m === 'kuraimi') return 'حوالة/كريمي';
        if (m === 'bank') return 'حوالة/كريمي';
        if (m === 'card') return 'شبكة';
        if (m === 'ar') return 'آجل';
        if (m === 'store_credit') return 'رصيد عميل';
        return method || '-';
    };

    const applyPreset = (preset: typeof rangePreset) => {
        setRangePreset(preset);
        if (preset === 'all') {
            setStartDate('');
            setEndDate('');
            return;
        }
        const now = new Date();
        const start = new Date(now);
        const end = new Date(now);
        if (preset === 'today') {
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
        } else if (preset === 'week') {
            const day = now.getDay();
            const diff = (day + 6) % 7;
            start.setDate(now.getDate() - diff);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
        } else if (preset === 'month') {
            start.setDate(1);
            start.setHours(0, 0, 0, 0);
            end.setMonth(now.getMonth() + 1, 0);
            end.setHours(23, 59, 59, 999);
        } else if (preset === 'year') {
            start.setMonth(0, 1);
            start.setHours(0, 0, 0, 0);
            end.setMonth(11, 31);
            end.setHours(23, 59, 59, 999);
        }
        const toLocalYMD = (date: Date) => {
            const offset = date.getTimezoneOffset();
            const local = new Date(date.getTime() - (offset * 60 * 1000));
            return local.toISOString().slice(0, 10);
        };
        setStartDate(toLocalYMD(start));
        setEndDate(toLocalYMD(end));
    };


    useEffect(() => {
        let active = true;
        const loadOrders = async () => {
            const supabase = getSupabaseClient();
            if (!supabase || !effectiveRange) { setServerOrders([]); return; }
            setOrdersLoading(true);
            try {
                const zoneArg = (selectedZoneId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedZoneId)) ? selectedZoneId : null;
                const payload: any = {
                    p_start_date: effectiveRange.start.toISOString(),
                    p_end_date: effectiveRange.end.toISOString(),
                    p_zone_id: zoneArg,
                    p_invoice_only: invoiceOnly,
                    p_search: orderSearch || null,
                    p_limit: showAllOrders ? 20000 : 500,
                    p_offset: 0,
                };
                const { data, error } = await supabase.rpc('get_sales_report_orders', payload);
                if (!active) return;
                if (error || !Array.isArray(data)) {
                    showNotification(localizeSupabaseError(error || ''));
                    setServerOrders([]);
                    return;
                }
                setServerOrders((data as any[]).map((r: any) => ({
                    id: String(r.id),
                    status: String(r.status || ''),
                    dateBy: r.date_by,
                    total: Number(r.total) || 0,
                    paymentMethod: String(r.payment_method || ''),
                    orderSource: String(r.order_source || ''),
                    customerName: String(r.customer_name || ''),
                    invoiceNumber: String(r.invoice_number || ''),
                    invoiceIssuedAt: r.invoice_issued_at,
                    deliveryZoneId: r.delivery_zone_id ? String(r.delivery_zone_id) : '',
                    deliveryZoneName: String(r.delivery_zone_name || ''),
                })));
            } finally {
                if (active) setOrdersLoading(false);
            }
        };
        void loadOrders();
        return () => { active = false; };
    }, [effectiveRange, selectedZoneId, invoiceOnly, orderSearch, showAllOrders]);

    const [dailySalesData, setDailySalesData] = useState<Array<{ label: string; value: number }>>([]);
    useEffect(() => {
        let active = true;
        const loadDaily = async () => {
            const supabase = getSupabaseClient();
            if (!supabase || !effectiveRange) { setDailySalesData([]); return; }
            const zoneArg = (selectedZoneId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedZoneId)) ? selectedZoneId : null;
            const payload: any = {
                p_start_date: effectiveRange.start.toISOString(),
                p_end_date: effectiveRange.end.toISOString(),
                p_zone_id: zoneArg,
                p_invoice_only: invoiceOnly,
            };
            const { data, error } = await supabase.rpc('get_daily_sales_stats', payload);
            if (!active) return;
            if (error || !Array.isArray(data)) { showNotification(localizeSupabaseError(error || '')); setDailySalesData([]); return; }
            const rows = ((data as any[]) || [])
                .map((r: any) => ({
                    date: new Date(String(r.day_date)),
                    label: new Date(String(r.day_date)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    value: Number(r.total_sales) || 0,
                }))
                .sort((a: any, b: any) => a.date.getTime() - b.date.getTime())
                .map((r: any) => ({ label: r.label, value: r.value }));
            setDailySalesData(rows);
        };
        void loadDaily();
        return () => { active = false; };
    }, [effectiveRange, selectedZoneId, invoiceOnly]);

    const [categorySalesData, setCategorySalesData] = useState<Array<{ label: string; value: number }>>([]);
    useEffect(() => {
        let active = true;
        const loadCategory = async () => {
            const supabase = getSupabaseClient();
            if (!supabase || !effectiveRange) { setCategorySalesData([]); return; }
            const zoneArg = (selectedZoneId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedZoneId)) ? selectedZoneId : null;
            const payload: any = {
                p_start_date: effectiveRange.start.toISOString(),
                p_end_date: effectiveRange.end.toISOString(),
                p_zone_id: zoneArg,
                p_invoice_only: invoiceOnly,
            };
            const { data, error } = await supabase.rpc('get_sales_by_category', payload);
            if (!active) return;
            if (error || !Array.isArray(data)) { showNotification(localizeSupabaseError(error || '')); setCategorySalesData([]); return; }
            setCategorySalesData(
                (data as any[]).map((r: any) => ({
                    label: String(r.category_name || 'غير مصنف'),
                    value: Number(r.total_sales) || 0,
                })).sort((a, b) => b.value - a.value)
            );
        };
        void loadCategory();
        return () => { active = false; };
    }, [effectiveRange, selectedZoneId, invoiceOnly]);

    const [hourlySalesData, setHourlySalesData] = useState<Array<{ label: string; value: number }>>([]);
    useEffect(() => {
        let active = true;
        const loadHourly = async () => {
            const supabase = getSupabaseClient();
            if (!supabase || !effectiveRange) { setHourlySalesData([]); return; }
            const zoneArg = (selectedZoneId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedZoneId)) ? selectedZoneId : null;
            const payload: any = {
                p_start_date: effectiveRange.start.toISOString(),
                p_end_date: effectiveRange.end.toISOString(),
                p_zone_id: zoneArg,
                p_invoice_only: invoiceOnly,
            };
            const { data, error } = await supabase.rpc('get_hourly_sales_stats', payload);
            if (!active) return;
            if (error || !Array.isArray(data)) { showNotification(localizeSupabaseError(error || '')); setHourlySalesData([]); return; }
            const rows = ((data as any[]) || [])
                .sort((a: any, b: any) => Number(a.hour_of_day) - Number(b.hour_of_day))
                .map((r: any) => ({
                    label: `${Number(r.hour_of_day) || 0}:00`,
                    value: Number(r.total_sales) || 0,
                }));
            setHourlySalesData(rows);
        };
        void loadHourly();
        return () => { active = false; };
    }, [effectiveRange, selectedZoneId, invoiceOnly]);

    const [paymentMethodData, setPaymentMethodData] = useState<Array<{ label: string; value: number }>>([]);
    useEffect(() => {
        let active = true;
        const loadPayment = async () => {
            const supabase = getSupabaseClient();
            if (!supabase || !effectiveRange) { setPaymentMethodData([]); return; }
            const zoneArg = (selectedZoneId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedZoneId)) ? selectedZoneId : null;
            const payload: any = {
                p_start_date: effectiveRange.start.toISOString(),
                p_end_date: effectiveRange.end.toISOString(),
                p_zone_id: zoneArg,
                p_invoice_only: invoiceOnly,
            };
            const { data, error } = await supabase.rpc('get_payment_method_stats', payload);
            if (!active) return;
            if (error || !Array.isArray(data)) { showNotification(localizeSupabaseError(error || '')); setPaymentMethodData([]); return; }
            setPaymentMethodData(
                (data as any[]).map((r: any) => ({
                    label: methodLabel(String(r.method)),
                    value: Number(r.total_sales) || 0,
                })).sort((a, b) => b.value - a.value)
            );
        };
        void loadPayment();
        return () => { active = false; };
    }, [effectiveRange, selectedZoneId, invoiceOnly]);

    // Load Summary RPC
    useEffect(() => {
        const loadSummary = async () => {
            const supabase = getSupabaseClient();
            if (!supabase || !effectiveRange) {
                setServerSummary(null);
                return;
            }
            const zoneArg = (selectedZoneId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedZoneId)) ? selectedZoneId : null;
            const payload: any = {
                p_start_date: effectiveRange.start.toISOString(),
                p_end_date: effectiveRange.end.toISOString(),
                p_zone_id: zoneArg,
                p_invoice_only: invoiceOnly,
            };
            const { data, error } = await supabase.rpc('get_sales_report_summary', payload);
            if (error) {
                showNotification(localizeSupabaseError(error));
                setServerSummary(null);
                return;
            }
            setServerSummary(data);
        };
        void loadSummary();
    }, [effectiveRange, selectedZoneId, invoiceOnly]);

    useEffect(() => {
        let active = true;
        const loadDrivers = async () => {
            const supabase = getSupabaseClient();
            if (!supabase || !effectiveRange) {
                if (active) setDriverStats([]);
                return;
            }
            const params = {
                p_start_date: effectiveRange.start.toISOString(),
                p_end_date: effectiveRange.end.toISOString(),
            };
            const { data, error } = await supabase.rpc('get_driver_performance_stats', params);
            if (!active) return;
            if (error || !data) {
                setDriverStats([]);
                return;
            }
            setDriverStats(
                (data as any[]).map((r: any) => ({
                    name: r.driver_name,
                    count: Number(r.delivered_count),
                    avgTime: Number(r.avg_delivery_minutes),
                }))
            );
        };
        void loadDrivers();
        return () => {
            active = false;
        };
    }, [effectiveRange]);


    const reportData = useMemo(() => {
        const totalSalesCollected = Number(serverSummary?.total_collected || 0);
        const returns = Number(serverSummary?.returns || 0);
        const deliveryFees = Number(serverSummary?.delivery_fees || 0);
        const discounts = Number(serverSummary?.discounts || 0);
        const grossSubtotal = Number(serverSummary?.gross_subtotal || 0);
        const totalOrders = Number(serverSummary?.total_orders || 0);
        const netCollected = totalSalesCollected - returns;
        const netRevenue = netCollected;
        const averageOrderValue = totalOrders > 0 ? netCollected / totalOrders : 0;
        const cancelledCount = Number(serverSummary?.cancelled_orders || 0);
        const deliveredCount = Number(serverSummary?.delivered_orders || 0);
        const outForDeliveryCount = Number(serverSummary?.out_for_delivery_count || 0);
        const inStoreCount = Number(serverSummary?.in_store_count || 0);
        const onlineCount = Number(serverSummary?.online_count || 0);
        const cogs = Number(serverSummary?.cogs || 0);
        const wastageLoss = Number(serverSummary?.wastage || 0);
        const totalExpenses = Number(serverSummary?.expenses || 0);
        const deliveryCost = Number(serverSummary?.delivery_cost || 0);
        const grossProfit = (grossSubtotal - discounts - returns) - cogs;
        const netProfit = grossProfit - wastageLoss - totalExpenses - deliveryCost;
        return {
            netRevenue,
            grossSubtotal,
            returns,
            totalCollected: totalSalesCollected,
            netCollected,
            deliveryFees,
            discounts,
            totalOrders,
            averageOrderValue,
            cancelledCount,
            deliveredCount,
            outForDeliveryCount,
            inStoreCount,
            onlineCount,
            cogs,
            wastageLoss,
            totalExpenses,
            deliveryCost,
            grossProfit,
            netProfit,
        };
    }, [serverSummary]);

    const displayTotalOrders = useMemo(() => {
        const s = Number(serverSummary?.total_orders || 0);
        if (!ordersLoading && showAllOrders && !orderSearch.trim() && serverOrders.length > 0) {
            return serverOrders.length;
        }
        return s;
    }, [serverSummary, ordersLoading, orderSearch, serverOrders, showAllOrders]);

    // Calculate profit margins
    const profitMargins = useMemo(() => {
        const grossMargin = reportData.netRevenue > 0
            ? (reportData.grossProfit / reportData.netRevenue) * 100
            : 0;
        const netMargin = reportData.netRevenue > 0
            ? (reportData.netProfit / reportData.netRevenue) * 100
            : 0;
        return { grossMargin, netMargin };
    }, [reportData]);

    // Order Source Revenue (Server Side)
    const [orderSourceRevenue, setOrderSourceRevenue] = useState<Array<{ label: string; value: number }>>([]);
    useEffect(() => {
        let active = true;
        const loadOrderSourceRevenue = async () => {
            const supabase = getSupabaseClient();
            if (!supabase || !effectiveRange) {
                setOrderSourceRevenue([]);
                return;
            }
            const zoneArg = (selectedZoneId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedZoneId)) ? selectedZoneId : null;
            const payload: any = {
                p_start_date: effectiveRange.start.toISOString(),
                p_end_date: effectiveRange.end.toISOString(),
                p_zone_id: zoneArg,
                p_invoice_only: invoiceOnly,
            };
            const { data, error } = await supabase.rpc('get_order_source_revenue', payload);
            if (!active) return;
            if (error || !Array.isArray(data)) { setOrderSourceRevenue([]); return; }
            const label = (key: string) => {
                if (key === 'in_store') return language === 'ar' ? 'حضوري' : 'In-store';
                return language === 'ar' ? 'أونلاين' : 'Online';
            };
            setOrderSourceRevenue(
                (data as any[]).map((r: any) => ({
                    label: label(String(r.source || 'online')),
                    value: Number(r.total_sales) || 0,
                })).sort((a, b) => b.value - a.value)
            );
        };
        void loadOrderSourceRevenue();
        return () => { active = false; };
    }, [effectiveRange, selectedZoneId, invoiceOnly, language]);

    const visibleOrders = useMemo(() => {
        const sorted = [...serverOrders].sort((a: any, b: any) => {
            const da = getEffectiveDate(a).getTime();
            const db = getEffectiveDate(b).getTime();
            return db - da;
        });
        return sorted;
    }, [serverOrders]);

    const handleExport = async () => {
        const headers = [
            'رقم الطلب',
            'التاريخ',
            'اسم العميل',
            'الإجمالي',
            'الحالة',
            'رقم الفاتورة',
            'وقت إصدار الفاتورة',
            'طريقة الدفع',
            'مصدر الطلب',
            'منطقة التوصيل',
        ];
        const supabase = getSupabaseClient();
        if (!supabase || !effectiveRange) {
            showNotification('لا يمكن التصدير بدون اتصال بالخادم/تحديد الفترة', 'error');
            return;
        }
        const zoneArg = (selectedZoneId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedZoneId)) ? selectedZoneId : null;
        const payload: any = {
            p_start_date: effectiveRange.start.toISOString(),
            p_end_date: effectiveRange.end.toISOString(),
            p_zone_id: zoneArg,
            p_invoice_only: invoiceOnly,
            p_search: orderSearch || null,
            p_limit: 20000,
            p_offset: 0,
        };
        const { data, error } = await supabase.rpc('get_sales_report_orders', payload);
        if (error || !Array.isArray(data)) {
            showNotification('فشل تحميل بيانات التصدير من الخادم', 'error');
            return;
        }
        const rows = (data as any[]).map((r: any) => [
            String(r.id).slice(-6).toUpperCase(),
            new Date(String(r.date_by)).toLocaleString('ar-SA'),
            String(r.customer_name || ''),
            Number(r.total || 0).toFixed(2),
            String(r.status || ''),
            String(r.invoice_number || ''),
            r.invoice_issued_at ? String(r.invoice_issued_at) : '',
            methodLabel(String(r.payment_method || '')),
            String(r.order_source || '') === 'in_store' ? 'حضوري' : 'أونلاين',
            String(r.delivery_zone_name || '') || 'غير محدد',
        ]);
        const success = await exportToXlsx(
            headers,
            rows,
            `sales_report_${startDate || 'all'}_to_${endDate || 'all'}.xlsx`,
            { sheetName: 'Sales', currencyColumns: [3], currencyFormat: '#,##0.00' }
        );
        if (success) {
            showNotification(`تم حفظ التقرير في مجلد المستندات`, 'success');
        } else {
            showNotification('فشل تصدير الملف.', 'error');
        }
    };

    const handleSharePdf = async () => {
        setIsSharing(true);
        const success = await sharePdf(
            'print-area',
            'تقرير المبيعات',
            `sales_report_${startDate || 'all'}_to_${endDate || 'all'}.pdf`,
            {
                headerTitle: settings.cafeteriaName?.ar || 'تقارير',
                headerSubtitle: 'تقرير المبيعات',
                logoUrl: settings.logoUrl || '',
                footerText: `${settings.address || ''} • ${settings.contactNumber || ''}`,
            }
        );
        if (success) {
            showNotification('تم حفظ التقرير في مجلد المستندات', 'success');
        } else {
            showNotification('فشل مشاركة الملف.', 'error');
        }
        setIsSharing(false);
    };

    const currency = 'ر.ي';

    return (
        <div className="animate-fade-in space-y-6">
            <h1 className="text-3xl font-bold dark:text-white">تقرير المبيعات</h1>

            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md flex flex-col md:flex-row gap-4 items-center">
                <div className="flex items-center gap-2">
                    <label htmlFor="startDate" title="فلتر التاريخ يعتمد على: تاريخ إصدار الفاتورة إن وُجد، وإلا paid_at ثم delivered_at ثم created_at.">من:</label>
                    <input
                        type="date"
                        id="startDate"
                        value={startDate}
                        onChange={e => {
                            setRangePreset('all');
                            setStartDate(e.target.value);
                        }}
                        className="p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <label htmlFor="endDate" title="فلتر التاريخ يعتمد على: تاريخ إصدار الفاتورة إن وُجد، وإلا paid_at ثم delivered_at ثم created_at.">إلى:</label>
                    <input
                        type="date"
                        id="endDate"
                        value={endDate}
                        onChange={e => {
                            setRangePreset('all');
                            setEndDate(e.target.value);
                        }}
                        className="p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <label htmlFor="zone">منطقة:</label>
                    <select
                        id="zone"
                        value={selectedZoneId}
                        onChange={e => setSelectedZoneId(e.target.value)}
                        className="p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                    >
                        <option value="">الكل</option>
                        {deliveryZones.map(z => (
                            <option key={z.id} value={z.id}>{z.name.ar || z.name.en || z.id}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <label htmlFor="invoiceOnly" title="عند التفعيل: يعتمد التقرير فقط على invoiceSnapshot (الفواتير المصدرة) بدل بيانات الطلب قبل الإصدار.">فواتير فقط</label>
                    <input
                        id="invoiceOnly"
                        type="checkbox"
                        checked={invoiceOnly}
                        onChange={(e) => setInvoiceOnly(e.target.checked)}
                        className="h-4 w-4"
                    />
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 md:ml-auto">
                    تاريخ التقرير: invoice_date → paid_at → delivered_at → created_at
                </div>
                <div className="flex gap-2 flex-wrap justify-center">
                    <button type="button" onClick={() => applyPreset('today')} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${rangePreset === 'today' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>اليوم</button>
                    <button type="button" onClick={() => applyPreset('week')} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${rangePreset === 'week' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>هذا الأسبوع</button>
                    <button type="button" onClick={() => applyPreset('month')} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${rangePreset === 'month' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>هذا الشهر</button>
                    <button type="button" onClick={() => applyPreset('year')} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${rangePreset === 'year' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>هذه السنة</button>
                    <button type="button" onClick={() => applyPreset('all')} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${rangePreset === 'all' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>الكل</button>
                </div>
                <div className="flex-grow"></div>
                <div className="flex gap-2 flex-wrap justify-center">
                    <button onClick={handleSharePdf} disabled={isSharing} className="bg-red-600 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-red-700 transition disabled:bg-gray-400">
                        {isSharing ? 'جاري التحميل...' : 'مشاركة PDF'}
                    </button>
                    <button onClick={handleExport} className="bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-green-700 transition">تصدير Excel</button>
                </div>
            </div>

            <div id="print-area">
                <div className="print-only mb-6">
                    <div className="flex items-center gap-3 mb-2">
                        {settings.logoUrl ? <img src={settings.logoUrl} alt="" className="h-10 w-auto" /> : null}
                        <div className="leading-tight">
                            <div className="font-bold text-black">{settings.cafeteriaName?.ar || settings.cafeteriaName?.en || ''}</div>
                            <div className="text-xs text-black">{[settings.address || '', settings.contactNumber || ''].filter(Boolean).join(' • ')}</div>
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-black">تقرير المبيعات</h2>
                {startDate && endDate && (
                    <p className="text-base text-black mt-1">التقرير للفترة من {startDate} إلى {endDate}</p>
                )}
                <div className="flex gap-4 mt-2 text-sm border-t pt-2">
                    <span>الإيراد: {reportData.netRevenue.toFixed(2)}</span>
                    <span>|</span>
                    <span>التكلفة: {reportData.cogs.toFixed(2)}</span>
                    <span>|</span>
                    <span>صافي الربح: {reportData.netProfit.toFixed(2)}</span>
                </div>
            </div>

            {/* Key Metrics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md text-center">
                    <h3 className="text-gray-500 dark:text-gray-400">إجمالي الإيرادات</h3>
                    <p className="text-2xl font-bold text-green-500">{reportData.netRevenue.toFixed(2)} {currency}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md text-center">
                    <h3 className="text-gray-500 dark:text-gray-400">عدد الطلبات</h3>
                    <p className="text-2xl font-bold dark:text-white">{displayTotalOrders}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md text-center">
                    <h3 className="text-gray-500 dark:text-gray-400">متوسط قيمة الطلب</h3>
                    <p className="text-2xl font-bold text-blue-500">{reportData.averageOrderValue.toFixed(2)} {currency}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md text-center">
                    <h3 className="text-gray-500 dark:text-gray-400">المردودات</h3>
                    <p className="text-2xl font-bold text-red-600">{reportData.returns.toFixed(2)} {currency}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md text-center">
                    <h3 className="text-gray-500 dark:text-gray-400">صافي التحصيل</h3>
                    <p className="text-2xl font-bold text-green-600">{reportData.netCollected.toFixed(2)} {currency}</p>
                </div>
            </div>

                {/* Profitability Section */}
                <h3 className="text-xl font-bold dark:text-gray-200 mb-4 px-1">الملخص المالي والربحية</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg shadow-md text-center border border-red-200 dark:border-red-800">
                        <h3 className="text-gray-600 dark:text-gray-400 font-semibold">تكلفة البضاعة المباعة</h3>
                        <p className="text-2xl font-bold text-red-600 dark:text-red-400">{reportData.cogs.toFixed(2)} {currency}</p>
                    </div>
                    <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg shadow-md text-center border border-orange-200 dark:border-orange-800">
                        <h3 className="text-gray-600 dark:text-gray-400 font-semibold">خسائر التالف</h3>
                        <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{reportData.wastageLoss.toFixed(2)} {currency}</p>
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg shadow-md text-center border border-blue-200 dark:border-blue-800">
                        <h3 className="text-gray-600 dark:text-gray-400 font-semibold">مجمل الربح (من المبيعات)</h3>
                        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{reportData.grossProfit.toFixed(2)} {currency}</p>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg shadow-md text-center border border-green-200 dark:border-green-800">
                        <h3 className="text-gray-600 dark:text-gray-400 font-semibold">صافي الربح التقديري</h3>
                        <p className="text-2xl font-bold text-green-600 dark:text-green-400">{reportData.netProfit.toFixed(2)} {currency}</p>
                    </div>
                </div>

                {/* Profit Margins */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md text-center">
                        <h3 className="text-gray-500 dark:text-gray-400">هامش الربح الإجمالي</h3>
                        <p className="text-3xl font-bold text-blue-500">{profitMargins.grossMargin.toFixed(1)}%</p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md text-center">
                        <h3 className="text-gray-500 dark:text-gray-400">هامش الربح الصافي</h3>
                        <p className="text-3xl font-bold text-purple-500">{profitMargins.netMargin.toFixed(1)}%</p>
                    </div>
                </div>

                {/* Charts Section */}
                <>
                    {/* Daily Sales Trend */}
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md mb-6">
                        <LineChart data={dailySalesData} title="اتجاه الإيرادات اليومية" unit={currency} color="#f97316" showArea={true} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                        {/* Category Sales */}
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
                            <HorizontalBarChart data={categorySalesData.slice(0, 10)} title="أفضل الأقسام مبيعاً" unit={currency} />
                        </div>
                        {/* Hourly Sales */}
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
                            <BarChart data={hourlySalesData} title="أوقات الذروة (بالساعة)" currency={currency} />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                        {/* Payment Methods */}
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
                            <BarChart data={paymentMethodData} title="المبيعات حسب طريقة الدفع" currency={currency} />
                        </div>
                        {/* Order Source */}
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
                            <BarChart data={orderSourceRevenue} title="المبيعات حسب مصدر الطلب" currency={currency} />
                        </div>
                    </div>
                </>
                
                {/* Integration Consistency Check (Debug Toggle) */}
                {serverSummary && showAllOrders && !orderSearch.trim() && !ordersLoading && serverOrders.length > 0 && (
                    <div className="mb-6">
                        {(() => {
                            const sc = Number(serverSummary.total_collected || 0);
                            const cc = serverOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
                            const delivered = Number(serverSummary.delivered_orders || 0);
                            const listCount = serverOrders.length;
                            const ratio = (a: number, b: number) => {
                                const denom = Math.max(1e-9, Math.abs(a));
                                return Math.abs(a - b) / denom;
                            };
                            const rc = ratio(sc, cc);
                            const rcount = delivered > 0
                                ? (Math.abs(delivered - listCount) / Math.max(1, delivered))
                                : 0;
                            const maxDiff = Math.max(rc, rcount);
                            const ok = maxDiff <= 0.02;
                            const warn = !ok && maxDiff <= 0.05;
                            return (
                                <div className={`${ok ? 'bg-green-50 border-green-200' : warn ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'} border rounded-lg p-4`}>
                                    <div className="font-semibold text-gray-800 dark:text-gray-200">
                                        {ok ? 'التطابق ممتاز (≤2%)' : warn ? 'فروقات طفيفة (≤5%)' : 'فروقات ملحوظة'}
                                    </div>
                                    <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                                        <div>أقصى فرق نسبي: {(maxDiff * 100).toFixed(1)}%</div>
                                    </div>
                                    <details className="mt-3">
                                        <summary className="cursor-pointer text-sm font-semibold">تفاصيل المقارنة</summary>
                                        <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                                            <div>إجمالي التحصيل (خادم/قائمة): {sc.toFixed(2)} / {cc.toFixed(2)} • فرق {(rc * 100).toFixed(1)}%</div>
                                            <div>عدد الطلبات المسلّمة (خادم/قائمة): {delivered.toLocaleString('en-US')} / {listCount.toLocaleString('en-US')} • فرق {(rcount * 100).toFixed(1)}%</div>
                                        </div>
                                    </details>
                                </div>
                            );
                        })()}
                    </div>
                )}

                {/* Driver Performance Table (Server Side) */}
                {driverStats.length > 0 && (
                    <div className="mb-6">
                        <h3 className="text-xl font-bold dark:text-gray-200 mb-4 px-1">أداء المندوبين</h3>
                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead className="bg-gray-50 dark:bg-gray-700">
                                    <tr>
                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">المندوب</th>
                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">عدد الطلبات</th>
                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">متوسط زمن التوصيل</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                    {driverStats.map((stat, idx) => (
                                        <tr key={idx}>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white border-r dark:border-gray-700">{stat.name}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300 border-r dark:border-gray-700">{stat.count.toLocaleString('en-US')}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                                {stat.avgTime > 0 ? `${stat.avgTime.toFixed(0)} دقيقة` : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Recent Orders Table (Legacy - kept for detail view) */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden mt-6">
                     <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-bold text-gray-800 dark:text-white">تفاصيل الطلبات ({visibleOrders.length} طلب{ordersLoading ? ' • جاري التحميل' : ''})</h3>
                        <div className="mt-3 flex flex-col md:flex-row gap-3 md:items-center">
                            <input
                                value={orderSearch}
                                onChange={(e) => setOrderSearch(e.target.value)}
                                placeholder="بحث: رقم الطلب، رقم الفاتورة، العميل، طريقة الدفع، المنطقة"
                                className="w-full md:max-w-lg p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                            />
                            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                                <input
                                    type="checkbox"
                                    checked={showAllOrders}
                                    onChange={(e) => setShowAllOrders(e.target.checked)}
                                    className="h-4 w-4"
                                />
                                عرض كل النتائج
                            </label>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">رقم الطلب</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">التاريخ</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">اسم العميل</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">الإجمالي</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">الحالة</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">رقم الفاتورة</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">وقت إصدار الفاتورة</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">طريقة الدفع</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">منطقة</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">مصدر</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {(showAllOrders ? visibleOrders : visibleOrders.slice(0, 100)).map(order => (
                                    <tr key={order.id}>
                                        <td className="px-6 py-4 whitespace-nowrap font-mono border-r dark:border-gray-700">#{order.id.slice(-6).toUpperCase()}</td>
                                        <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700" dir="ltr">{getEffectiveDate(order).toLocaleDateString('en-US')}</td>
                                        <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">{order.customerName}</td>
                                        <td className="px-6 py-4 whitespace-nowrap font-semibold text-orange-500 border-r dark:border-gray-700">
                                            {Number(order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">{order.status}</td>
                                        <td className="px-6 py-4 whitespace-nowrap font-mono border-r dark:border-gray-700">{order.invoiceNumber || '-'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700" dir="ltr">
                                            {order.invoiceIssuedAt ? new Date(order.invoiceIssuedAt).toLocaleString('en-US') : '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">{order.paymentMethod || '-'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                            {order.deliveryZoneName || 'غير محدد'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {order.orderSource === 'in_store' ? 'حضوري' : 'أونلاين'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SalesReports;
