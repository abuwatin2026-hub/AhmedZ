import React, { useEffect, useMemo, useState } from 'react';
import { useSystemAudit } from '../../contexts/SystemAuditContext';
import Spinner from '../../components/Spinner';
import { getSupabaseClient } from '../../supabase';

const SystemAuditScreen: React.FC = () => {
    const { logs, fetchLogs, loading } = useSystemAudit();
    const [moduleFilter, setModuleFilter] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [actorNames, setActorNames] = useState<Record<string, string>>({});
    const [riskFilter, setRiskFilter] = useState('');

    useEffect(() => {
        fetchLogs({
            module: moduleFilter || undefined,
            dateFrom: dateFrom || undefined
        });
    }, [moduleFilter, dateFrom]);

    const moduleLabels: Record<string, string> = useMemo(() => ({
        auth: 'المصادقة',
        system: 'النظام',
        orders: 'الطلبات',
        inventory: 'المخزون',
        accounting: 'المحاسبة',
        settings: 'الإعدادات',
        shifts: 'الورديات',
        purchases: 'المشتريات',
        marketing: 'التسويق',
        customers: 'العملاء',
        reviews: 'التقييمات',
    }), []);

    const actionLabels: Record<string, string> = useMemo(() => ({
        login: 'تسجيل دخول',
        logout: 'تسجيل خروج',
        order_delivered: 'تم التسليم',
        order_status_changed: 'تغيير حالة الطلب',
        order_updated: 'تحديث طلب',
        cash_shift_opened: 'فتح وردية',
        cash_shift_closed: 'إغلاق وردية',
        insert: 'إضافة',
        update: 'تحديث',
        delete: 'حذف',
        created: 'تم إنشاء',
        updated: 'تم تحديث',
        deleted: 'تم حذف',
    }), []);

    const safeString = (value: unknown) => (typeof value === 'string' ? value : String(value ?? ''));

    const tableLabels: Record<string, string> = useMemo(() => ({
        admin_users: 'مستخدمو الإدارة',
        customers: 'العملاء',
        menu_items: 'المنتجات',
        addons: 'الإضافات',
        delivery_zones: 'مناطق التوصيل',
        coupons: 'الكوبونات',
        ads: 'الإعلانات',
        challenges: 'التحديات',
        app_settings: 'إعدادات التطبيق',
        item_categories: 'تصنيفات المنتجات',
        unit_types: 'وحدات القياس',
        freshness_levels: 'درجات الجودة',
        banks: 'الحسابات البنكية',
        transfer_recipients: 'مستلمو التحويل',
        reviews: 'التقييمات',
        orders: 'الطلبات',
    }), []);

    const columnLabels: Record<string, string> = useMemo(() => ({
        full_name: 'الاسم الكامل',
        username: 'اسم المستخدم',
        phone: 'رقم الجوال',
        role: 'الدور',
        permissions: 'الصلاحيات',
        is_active: 'نشط',
        name: 'الاسم',
        title: 'العنوان',
        description: 'الوصف',
        price: 'السعر',
        stock: 'المخزون',
        image_url: 'الصورة',
        is_available: 'متاح',
        min_order: 'الحد الأدنى للطلب',
        max_order: 'الحد الأعلى للطلب',
        delivery_fee: 'رسوم التوصيل',
        start_at: 'تاريخ البداية',
        end_at: 'تاريخ النهاية',
        discount_percent: 'نسبة الخصم',
        discount_amount: 'قيمة الخصم',
        code: 'الكود',
    }), []);

    const formatModule = (value: string) => {
        const key = safeString(value);
        return moduleLabels[key] || key;
    };

    const humanizeAction = (value: string) => {
        const raw = safeString(value);
        if (!raw) return '-';
        const direct = actionLabels[raw];
        if (direct) return direct;
        const normalized = raw.replace(/\./g, '_').toLowerCase();
        const direct2 = actionLabels[normalized];
        if (direct2) return direct2;
        const tableOpMatch = raw.match(/^([a-z0-9_]+)\.([a-z0-9_]+)$/i);
        if (tableOpMatch) {
            const tableKey = tableOpMatch[1].toLowerCase();
            const opKey = tableOpMatch[2].toLowerCase();
            const opLabel = actionLabels[opKey] || opKey;
            const tableLabel = tableLabels[tableKey] || tableKey;
            return `${opLabel} ${tableLabel}`;
        }
        const cleaned = raw.replace(/[._\-]+/g, ' ').trim();
        return cleaned || raw;
    };

    const formatDetails = (value: string) => {
        const raw = safeString(value).trim();
        if (!raw) return '—';
        if (raw.startsWith('{') || raw.startsWith('[')) {
            try {
                const parsed = JSON.parse(raw) as any;
                const recordId = safeString(parsed?.recordId).trim();
                const changedColumnsRaw = Array.isArray(parsed?.changedColumns) ? parsed.changedColumns : undefined;
                if (recordId || (changedColumnsRaw && changedColumnsRaw.length > 0)) {
                    const parts: string[] = [];
                    if (recordId) parts.push(`المعرف: ${recordId}`);
                    if (changedColumnsRaw && changedColumnsRaw.length > 0) {
                        const labels = changedColumnsRaw
                            .map((c: unknown) => safeString(c).trim())
                            .filter(Boolean)
                            .map((c: string) => columnLabels[c] || c);
                        if (labels.length > 0) parts.push(`الحقول: ${labels.join('، ')}`);
                    }
                    const out = parts.join(' | ');
                    return out.length > 300 ? `${out.slice(0, 300)}…` : out;
                }

                const compact = JSON.stringify(parsed);
                return compact.length > 300 ? `${compact.slice(0, 300)}…` : compact;
            } catch {
            }
        }

        if (/^User logged in$/i.test(raw)) return 'تم تسجيل الدخول';
        const delivered = raw.match(/^Order\s+#?([A-Za-z0-9_-]+)\s+delivered$/i);
        if (delivered?.[1]) return `تم تسليم الطلب #${delivered[1]}`;

        return raw;
    };

    const riskLabel = (risk?: string) => {
        const v = (risk || '').toUpperCase();
        if (v === 'HIGH') return 'عالية';
        if (v === 'MEDIUM') return 'متوسطة';
        if (v === 'LOW') return 'منخفضة';
        return v || '—';
    };

    const getRiskBadgeColor = (risk?: string) => {
        const v = (risk || '').toUpperCase();
        if (v === 'HIGH') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
        if (v === 'MEDIUM') return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300';
        return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
    };

    const actorIds = useMemo(() => {
        const set = new Set<string>();
        for (const log of logs) {
            const id = safeString((log as any).performedBy);
            if (id && id !== 'System') set.add(id);
        }
        return Array.from(set);
    }, [logs]);

    const filteredLogs = useMemo(() => {
        const rf = riskFilter.trim().toUpperCase();
        if (!rf) return logs;
        return logs.filter(l => (l.riskLevel || '').toUpperCase() === rf);
    }, [logs, riskFilter]);

    useEffect(() => {
        if (actorIds.length === 0) return;
        const supabase = getSupabaseClient();
        if (!supabase) return;
        let cancelled = false;
        const run = async () => {
            try {
                const { data } = await supabase
                    .from('admin_users')
                    .select('auth_user_id, full_name, username')
                    .in('auth_user_id', actorIds);
                if (cancelled || !data) return;
                setActorNames(prev => {
                    const next = { ...prev };
                    for (const row of data as any[]) {
                        const id = safeString(row?.auth_user_id);
                        const name = safeString(row?.full_name || row?.username).trim();
                        if (id && name) next[id] = name;
                    }
                    return next;
                });
            } catch {
            }
        };
        void run();
        return () => {
            cancelled = true;
        };
    }, [actorIds]);

    const formatTime = (iso: string) => {
        if (!iso) return '-';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString('en-US');
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold dark:text-white">سجل النظام (Audit Logs)</h1>
                <div className="flex gap-2">
                    <select
                        value={moduleFilter}
                        onChange={(e) => setModuleFilter(e.target.value)}
                        className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    >
                        <option value="">كل الوحدات</option>
                        <option value="auth">المصادقة</option>
                        <option value="settings">الإعدادات</option>
                        <option value="orders">الطلبات</option>
                        <option value="inventory">المخزون</option>
                        <option value="accounting">المحاسبة</option>
                        <option value="shifts">الورديات</option>
                    </select>
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    />
                    <select
                        value={riskFilter}
                        onChange={(e) => setRiskFilter(e.target.value)}
                        className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    >
                        <option value="">كل المخاطر</option>
                        <option value="HIGH">عالية</option>
                        <option value="MEDIUM">متوسطة</option>
                        <option value="LOW">منخفضة</option>
                    </select>
                    <button 
                        onClick={() => fetchLogs()} 
                        className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                        تحديث
                    </button>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">الوقت</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">الوحدة</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">الإجراء</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">المخاطر</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">السبب</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase border-r dark:border-gray-700">التفاصيل</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">بواسطة</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="py-10 text-center">
                                        <div className="flex justify-center"><Spinner /></div>
                                    </td>
                                </tr>
                            ) : filteredLogs.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="py-10 text-center text-gray-500">لا توجد سجلات.</td>
                                </tr>
                            ) : (
                                filteredLogs.map(log => (
                                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 border-r dark:border-gray-700" dir="ltr">
                                            {formatTime(log.performedAt)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white border-r dark:border-gray-700">
                                            <span className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-xs" title={log.module}>
                                                {formatModule(log.module)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white border-r dark:border-gray-700">
                                            <span title={log.action}>
                                                {humanizeAction(log.action)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm border-r dark:border-gray-700">
                                            <span className={`px-2 py-1 rounded-full text-xs ${getRiskBadgeColor(log.riskLevel)}`}>
                                                {riskLabel(log.riskLevel)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white border-r dark:border-gray-700">
                                            {safeString(log.reasonCode || '').trim() || '—'}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-md break-words whitespace-pre-wrap line-clamp-2 border-r dark:border-gray-700" title={log.details}>
                                            {formatDetails(log.details)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                            {actorNames[log.performedBy] || log.performedBy || 'System'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default SystemAuditScreen;
