import React, { useMemo, useState } from 'react';
import { useOrders } from '../../../contexts/OrderContext';
import { useUserAuth } from '../../../contexts/UserAuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { exportToXlsx, sharePdf } from '../../../utils/export';
import { buildPdfBrandOptions, buildXlsxBrandOptions } from '../../../utils/branding';
import HorizontalBarChart from '../../../components/admin/charts/HorizontalBarChart';
import { getInvoiceOrderView } from '../../../utils/orderUtils';
import { useSettings } from '../../../contexts/SettingsContext';
import { endOfDayFromYmd, startOfDayFromYmd, toYmdLocal } from '../../../utils/dateUtils';

const CustomerReports: React.FC = () => {
    const { orders } = useOrders();
    const { customers } = useUserAuth();
    const { showNotification } = useToast();
    const { settings } = useSettings();
    const [isSharing, setIsSharing] = useState(false);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [rangePreset, setRangePreset] = useState<'today' | 'week' | 'month' | 'year' | 'all'>('all');

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

    const range = useMemo(() => {
        if (!startDate || !endDate) return undefined;
        const start = startOfDayFromYmd(startDate);
        const end = endOfDayFromYmd(endDate);
        if (!start || !end) return undefined;
        return { start, end };
    }, [startDate, endDate]);

    const getEffectiveDate = (order: ReturnType<typeof getInvoiceOrderView>) => {
        const iso = order.invoiceIssuedAt || order.paidAt || order.deliveredAt || order.cancelledAt || order.createdAt;
        return new Date(iso);
    };

    const salesOrders = useMemo(() => {
        const base = orders.map(getInvoiceOrderView).filter(o => o.status === 'delivered' && Boolean(o.paidAt) && Boolean(o.userId));
        if (!range) return base;
        return base.filter(o => {
            const d = getEffectiveDate(o);
            return d >= range.start && d <= range.end;
        });
    }, [orders, range]);

    const customerReportData = useMemo(() => {
        const byId = new Map<string, { id: string; name: string; phone: string; loyaltyTier: string; loyaltyPoints: number; totalOrders: number; totalSpent: number }>();
        for (const customer of customers) {
            byId.set(customer.id, {
                id: customer.id,
                name: customer.fullName || 'N/A',
                phone: customer.phoneNumber || customer.email || 'N/A',
                loyaltyTier: customer.loyaltyTier || 'regular',
                loyaltyPoints: customer.loyaltyPoints || 0,
                totalOrders: 0,
                totalSpent: 0,
            });
        }

        for (const order of salesOrders) {
            if (!order.userId) continue;
            const stat = byId.get(order.userId);
            if (!stat) continue;
            stat.totalOrders += 1;
            stat.totalSpent += Number((order as any).baseTotal ?? 0) || 0;
        }

        return Array.from(byId.values()).sort((a, b) => b.totalSpent - a.totalSpent);
    }, [customers, salesOrders]);

    const summary = useMemo(() => {
        const active = customerReportData.filter(c => c.totalOrders > 0);
        const totalSpent = active.reduce((s, c) => s + c.totalSpent, 0);
        const totalOrders = active.reduce((s, c) => s + c.totalOrders, 0);
        return {
            customersCount: customers.length,
            activeCustomers: active.length,
            totalSpent,
            totalOrders,
            avgSpentPerCustomer: active.length ? totalSpent / active.length : 0,
            avgOrdersPerCustomer: active.length ? totalOrders / active.length : 0,
        };
    }, [customerReportData, customers.length]);


    const topCustomersChart = useMemo(() => {
        return customerReportData
            .filter(c => c.totalSpent > 0)
            .slice(0, 10)
            .map(c => ({ label: c.name, value: Number(c.totalSpent.toFixed(2)) }));
    }, [customerReportData]);

    const handleExport = async () => {
        const headers = [
            'اسم العميل',
            'رقم الهاتف',
            'المستوى',
            'نقاط الولاء',
            'إجمالي الطلبات',
            'إجمالي الإنفاق',
            'متوسط الفاتورة',
        ];
        const rows = customerReportData.map(c => [
            c.name,
            c.phone,
            c.loyaltyTier,
            c.loyaltyPoints,
            c.totalOrders,
            c.totalSpent.toFixed(2),
            (c.totalOrders ? (c.totalSpent / c.totalOrders) : 0).toFixed(2),
        ]);
        const success = await exportToXlsx(
            headers,
            rows,
            `customer_report_${toYmdLocal(new Date())}.xlsx`,
            { sheetName: 'Customers', currencyColumns: [5, 6], currencyFormat: '#,##0.00', ...buildXlsxBrandOptions(settings, 'العملاء', headers.length, { periodText: `الفترة: ${startDate || '—'} → ${endDate || '—'}` }) }
        );
        if (success) {
            showNotification(`تم حفظ التقرير في مجلد المستندات`, 'success');
        } else {
            showNotification('فشل تصدير الملف. تأكد من منح التطبيق صلاحيات الوصول للملفات.', 'error');
        }
    };

    const handleSharePdf = async () => {
        setIsSharing(true);
        const success = await sharePdf(
            'print-area',
            'تقرير العملاء',
            `customer_report_${toYmdLocal(new Date())}.pdf`,
            buildPdfBrandOptions(settings, 'تقرير العملاء', { pageNumbers: true })
        );
        if (success) {
            showNotification('تم حفظ التقرير في مجلد المستندات', 'success');
        } else {
            showNotification('فشل مشاركة الملف. تأكد من منح التطبيق الصلاحيات اللازمة.', 'error');
        }
        setIsSharing(false);
    };

    const currency = String((settings as any)?.baseCurrency || '').toUpperCase() || '—';

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-center">
                <h1 className="text-3xl font-bold dark:text-white">تقرير العملاء</h1>
                <div className="flex gap-2 flex-wrap justify-center">
                    <button onClick={handleSharePdf} disabled={isSharing} className="bg-red-600 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-red-700 transition disabled:bg-gray-400">
                        {isSharing ? 'جاري التحميل...' : 'مشاركة PDF'}
                    </button>
                    <button onClick={handleExport} className="bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-green-700 transition">تصدير إلى Excel</button>
                </div>
            </div>

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
                <div className="text-sm text-gray-500 dark:text-gray-400">
                    يعتمد التقرير على الطلبات المسلّمة والمدفوعة فقط.
                </div>
            </div>

            <div id="print-area">
                <div className="print-only mb-4">
                    <div className="flex items-center gap-3 mb-2">
                        {settings.logoUrl ? <img src={settings.logoUrl} alt="" className="h-10 w-auto" /> : null}
                        <div className="leading-tight">
                            <div className="font-bold text-black">{settings.cafeteriaName?.ar || settings.cafeteriaName?.en || ''}</div>
                            <div className="text-xs text-black">{[settings.address || '', settings.contactNumber || ''].filter(Boolean).join(' • ')}</div>
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-black">تقرير العملاء</h2>
                    <p className="text-base text-black mt-1">التاريخ: {new Date().toLocaleDateString('ar-SA-u-nu-latn')}</p>
                    <p className="text-xs text-black mt-1">تم الإنشاء: {new Date().toLocaleString('ar-SA-u-nu-latn')}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md text-center">
                        <h3 className="text-gray-500 dark:text-gray-400">عدد العملاء</h3>
                        <p className="text-2xl font-bold dark:text-white">{summary.customersCount}</p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md text-center">
                        <h3 className="text-gray-500 dark:text-gray-400">عملاء نشطون</h3>
                        <p className="text-2xl font-bold text-indigo-500">{summary.activeCustomers}</p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md text-center">
                        <h3 className="text-gray-500 dark:text-gray-400">إجمالي إنفاق</h3>
                        <p className="text-2xl font-bold text-orange-500">{summary.totalSpent.toFixed(2)} {currency}</p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md text-center">
                        <h3 className="text-gray-500 dark:text-gray-400">متوسط إنفاق/عميل</h3>
                        <p className="text-2xl font-bold text-emerald-600">{summary.avgSpentPerCustomer.toFixed(2)} {currency}</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md mb-6">
                    <HorizontalBarChart data={topCustomersChart} title="أفضل العملاء حسب الإنفاق" unit={currency} />
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">اسم العميل</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">رقم الهاتف</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">المستوى</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">نقاط الولاء</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">إجمالي الطلبات</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">إجمالي الإنفاق</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">متوسط الفاتورة</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {customerReportData.map(customer => (
                                    <tr key={customer.id}>
                                        <td className="px-6 py-4 whitespace-nowrap font-medium border-r dark:border-gray-700">{customer.name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700" dir="ltr">{customer.phone}</td>
                                        <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">{customer.loyaltyTier}</td>
                                        <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">{Number(customer.loyaltyPoints || 0).toLocaleString('en-US')}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-lg font-bold border-r dark:border-gray-700">{Number(customer.totalOrders || 0).toLocaleString('en-US')}</td>
                                        <td className="px-6 py-4 whitespace-nowrap font-semibold text-orange-500 border-r dark:border-gray-700">{Number(customer.totalSpent || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">{Number(customer.totalOrders ? (customer.totalSpent / customer.totalOrders) : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</td>
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

export default CustomerReports;
