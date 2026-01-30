import React, { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { useWarehouses } from '../../../contexts/WarehouseContext';
import { getSupabaseClient } from '../../../supabase';
import { localizeSupabaseError } from '../../../utils/errorUtils';
import { endOfDayFromYmd, startOfDayFromYmd, toYmdLocal } from '../../../utils/dateUtils';

type ReservationRow = {
    orderId: string;
    orderStatus: string;
    orderCreatedAt: string;
    orderSource: string;
    customerName: string;
    deliveryZoneName: string;
    itemId: string;
    itemName: any;
    reservedQuantity: number;
    warehouseId: string;
    warehouseName: string;
    reservationUpdatedAt: string;
};

const statusLabel = (status: string) => {
    const labels: Record<string, string> = {
        pending: 'قيد الانتظار',
        preparing: 'جاري التحضير',
        out_for_delivery: 'في الطريق',
        delivered: 'تم التسليم',
        scheduled: 'مجدول',
        cancelled: 'ملغي',
    };
    return labels[status] || status || '-';
};

const ReservationsReports: React.FC = () => {
    const { showNotification } = useToast();
    const { warehouses } = useWarehouses();

    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [rangePreset, setRangePreset] = useState<'today' | 'week' | 'month' | 'year' | 'all'>('week');
    const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
    const [search, setSearch] = useState('');
    const [showAllRows, setShowAllRows] = useState(false);

    const [rows, setRows] = useState<ReservationRow[]>([]);
    const [loading, setLoading] = useState(false);

    const range = useMemo(() => {
        if (!startDate || !endDate) return undefined;
        const start = startOfDayFromYmd(startDate);
        const end = endOfDayFromYmd(endDate);
        if (!start || !end) return undefined;
        return { start, end };
    }, [startDate, endDate]);

    const effectiveRange = useMemo(() => {
        if (range) return range;
        if (rangePreset === 'all') return { start: new Date(0), end: new Date() };
        return undefined;
    }, [range, rangePreset]);

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
        setStartDate(toYmdLocal(start));
        setEndDate(toYmdLocal(end));
    };

    useEffect(() => {
        if (!startDate && !endDate && rangePreset !== 'all') {
            applyPreset(rangePreset);
        }
    }, []);

    useEffect(() => {
        let active = true;
        const load = async () => {
            const supabase = getSupabaseClient();
            if (!supabase || !effectiveRange) {
                setRows([]);
                return;
            }
            setLoading(true);
            try {
                const whArg = (selectedWarehouseId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedWarehouseId))
                    ? selectedWarehouseId
                    : null;
                const payload: any = {
                    p_start_date: effectiveRange.start.toISOString(),
                    p_end_date: effectiveRange.end.toISOString(),
                    p_warehouse_id: whArg,
                    p_search: search || null,
                    p_limit: showAllRows ? 20000 : 800,
                    p_offset: 0,
                };
                const { data, error } = await supabase.rpc('get_open_reservations_report', payload);
                if (!active) return;
                if (error || !Array.isArray(data)) {
                    showNotification(localizeSupabaseError(error || ''), 'error');
                    setRows([]);
                    return;
                }
                setRows((data as any[]).map((r: any) => ({
                    orderId: String(r.order_id),
                    orderStatus: String(r.order_status || ''),
                    orderCreatedAt: String(r.order_created_at || ''),
                    orderSource: String(r.order_source || ''),
                    customerName: String(r.customer_name || ''),
                    deliveryZoneName: String(r.delivery_zone_name || ''),
                    itemId: String(r.item_id || ''),
                    itemName: r.item_name,
                    reservedQuantity: Number(r.reserved_quantity) || 0,
                    warehouseId: String(r.warehouse_id || ''),
                    warehouseName: String(r.warehouse_name || ''),
                    reservationUpdatedAt: String(r.reservation_updated_at || ''),
                })));
            } finally {
                if (active) setLoading(false);
            }
        };
        void load();
        return () => { active = false; };
    }, [effectiveRange, selectedWarehouseId, search, showAllRows]);

    const summary = useMemo(() => {
        const uniqueOrders = new Set(rows.map(r => r.orderId)).size;
        const totalReserved = rows.reduce((sum, r) => sum + (Number(r.reservedQuantity) || 0), 0);
        return { uniqueOrders, totalReserved };
    }, [rows]);

    const getItemName = (name: any) => {
        if (!name) return '-';
        if (typeof name === 'string') return name;
        const ar = name?.ar;
        const en = name?.en;
        return String(ar || en || '-');
    };

    return (
        <div className="animate-fade-in space-y-6">
            <div>
                <h1 className="text-3xl font-bold dark:text-white">تقرير الحجوزات</h1>
                <p className="mt-2 text-lg text-gray-500 dark:text-gray-400">الحجوزات المفتوحة حسب الطلب والمخزن</p>
            </div>

            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow">
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
                    <div className="md:col-span-2">
                        <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">بحث</label>
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="عميل / صنف / مخزن / رقم طلب"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900"
                        />
                    </div>

                    <div>
                        <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">من</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => { setStartDate(e.target.value); setRangePreset('all'); }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900"
                        />
                    </div>

                    <div>
                        <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">إلى</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => { setEndDate(e.target.value); setRangePreset('all'); }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900"
                        />
                    </div>

                    <div>
                        <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">المخزن</label>
                        <select
                            value={selectedWarehouseId}
                            onChange={(e) => setSelectedWarehouseId(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900"
                        >
                            <option value="">كل المخازن</option>
                            {warehouses.map(w => (
                                <option key={w.id} value={w.id}>{w.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => applyPreset('today')}
                            className={`px-3 py-2 rounded-lg text-sm border ${rangePreset === 'today' ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-300 dark:border-gray-600'}`}
                        >
                            اليوم
                        </button>
                        <button
                            onClick={() => applyPreset('week')}
                            className={`px-3 py-2 rounded-lg text-sm border ${rangePreset === 'week' ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-300 dark:border-gray-600'}`}
                        >
                            الأسبوع
                        </button>
                        <button
                            onClick={() => applyPreset('month')}
                            className={`px-3 py-2 rounded-lg text-sm border ${rangePreset === 'month' ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-300 dark:border-gray-600'}`}
                        >
                            الشهر
                        </button>
                        <button
                            onClick={() => applyPreset('year')}
                            className={`px-3 py-2 rounded-lg text-sm border ${rangePreset === 'year' ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-300 dark:border-gray-600'}`}
                        >
                            السنة
                        </button>
                    </div>
                </div>

                <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="flex gap-4 text-sm text-gray-700 dark:text-gray-300">
                        <div>عدد الطلبات: <span className="font-semibold">{summary.uniqueOrders.toLocaleString('ar-EG-u-nu-latn')}</span></div>
                        <div>إجمالي المحجوز: <span className="font-semibold">{summary.totalReserved.toLocaleString('ar-EG-u-nu-latn')}</span></div>
                        <div>عدد السجلات: <span className="font-semibold">{rows.length.toLocaleString('ar-EG-u-nu-latn')}</span></div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <input
                            type="checkbox"
                            checked={showAllRows}
                            onChange={(e) => setShowAllRows(e.target.checked)}
                        />
                        عرض حتى 20000 سجل
                    </label>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
                {loading ? (
                    <div className="p-6 text-center text-gray-600 dark:text-gray-300">جاري التحميل...</div>
                ) : rows.length === 0 ? (
                    <div className="p-6 text-center text-gray-600 dark:text-gray-300">لا توجد حجوزات ضمن الفترة</div>
                ) : (
                    <div className="overflow-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-700 dark:text-gray-200">
                                <tr>
                                    <th className="px-4 py-3 text-right font-semibold">الطلب</th>
                                    <th className="px-4 py-3 text-right font-semibold">الحالة</th>
                                    <th className="px-4 py-3 text-right font-semibold">التاريخ</th>
                                    <th className="px-4 py-3 text-right font-semibold">العميل</th>
                                    <th className="px-4 py-3 text-right font-semibold">المنطقة</th>
                                    <th className="px-4 py-3 text-right font-semibold">المخزن</th>
                                    <th className="px-4 py-3 text-right font-semibold">الصنف</th>
                                    <th className="px-4 py-3 text-right font-semibold">الكمية</th>
                                    <th className="px-4 py-3 text-right font-semibold">المصدر</th>
                                    <th className="px-4 py-3 text-right font-semibold">آخر تحديث</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {rows.map((r) => (
                                    <tr key={`${r.orderId}-${r.itemId}-${r.warehouseId}`} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                                        <td className="px-4 py-3 font-mono">{r.orderId.slice(-6).toUpperCase()}</td>
                                        <td className="px-4 py-3">{statusLabel(r.orderStatus)}</td>
                                        <td className="px-4 py-3">{r.orderCreatedAt ? new Date(r.orderCreatedAt).toLocaleString('ar-EG-u-nu-latn') : '-'}</td>
                                        <td className="px-4 py-3">{r.customerName || '-'}</td>
                                        <td className="px-4 py-3">{r.deliveryZoneName || '-'}</td>
                                        <td className="px-4 py-3">{r.warehouseName || '-'}</td>
                                        <td className="px-4 py-3">{getItemName(r.itemName)}</td>
                                        <td className="px-4 py-3 font-semibold">{Number(r.reservedQuantity || 0).toLocaleString('ar-EG-u-nu-latn')}</td>
                                        <td className="px-4 py-3">{r.orderSource || '-'}</td>
                                        <td className="px-4 py-3">{r.reservationUpdatedAt ? new Date(r.reservationUpdatedAt).toLocaleString('ar-EG-u-nu-latn') : '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReservationsReports;
