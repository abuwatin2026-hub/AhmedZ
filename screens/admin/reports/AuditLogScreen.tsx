import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../../supabase';
import { useToast } from '../../../contexts/ToastContext';

type AuditLogRow = {
    id: string;
    action: string;
    module: string;
    details: string;
    performed_by: string | null;
    performed_at: string;
    metadata: any;
    risk_level?: 'LOW' | 'MEDIUM' | 'HIGH';
    reason_code?: string;
};

const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ar-EG-u-nu-latn', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

const getActionBadgeColor = (action: string): string => {
    const colors: Record<string, string> = {
        create: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
        update: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
        delete: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
        price_change: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
        cost_change: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
        status_change: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
        role_change: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300',
        permission_change: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
        activate: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
        deactivate: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
        soft_delete: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    };
    return colors[action] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200';
};

const getModuleBadgeColor = (module: string): string => {
    const colors: Record<string, string> = {
        purchases: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
        menu_items: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
        customers: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
        settings: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
        admin_users: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
        inventory: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
        chart_of_accounts: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
    };
    return colors[module] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200';
};

const AuditLogScreen: React.FC = () => {
    const supabase = useMemo(() => getSupabaseClient(), []);
    const { showNotification } = useToast();

    const moduleLabels: Record<string, string> = {
        purchases: 'المشتريات',
        menu_items: 'الأصناف',
        customers: 'العملاء',
        settings: 'الإعدادات',
        admin_users: 'إدارة المستخدمين',
        inventory: 'المخزون',
        chart_of_accounts: 'دليل الحسابات',
        orders: 'الطلبات',
        banks: 'الحسابات البنكية',
        transfer_recipients: 'مستلمو الحوالات',
        sales_returns: 'مرتجعات',
        cash_shifts: 'الورديات',
        warehouses: 'المستودعات',
        reviews: 'التقييمات',
        addons: 'الإضافات',
        delivery_zones: 'مناطق التوصيل',
    };
    const actionLabels: Record<string, string> = {
        create: 'إنشاء',
        update: 'تحديث',
        delete: 'حذف',
        price_change: 'تغيير سعر',
        cost_change: 'تغيير تكلفة',
        status_change: 'تغيير حالة',
        role_change: 'تغيير دور',
        'role change': 'تغيير دور',
        permission_change: 'تغيير صلاحيات',
        'permission change': 'تغيير صلاحيات',
        login: 'تسجيل دخول',
        logout: 'تسجيل خروج',
        user_logged_in: 'تسجيل دخول',
        user_logged_out: 'تسجيل خروج',
    };
    const formatReason = (code?: string) => {
        const v = String(code || '').trim().toUpperCase();
        if (!v) return '—';
        if (v === 'MISSING_REASON') return 'غير مذكور';
        if (v === 'POLICY_OVERRIDE') return 'استثناء سياسة';
        if (v === 'USER_REQUEST') return 'طلب المستخدم';
        if (v === 'SYSTEM') return 'النظام';
        if (v === 'SECURITY') return 'أمني';
        return code || '—';
    };


    const [logs, setLogs] = useState<AuditLogRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [moduleFilter, setModuleFilter] = useState('');
    const [actionFilter, setActionFilter] = useState('');
    const [riskFilter, setRiskFilter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedRow, setExpandedRow] = useState<string | null>(null);

    const loadLogs = useCallback(async () => {
        if (!supabase) return;
        setLoading(true);
        try {
            let query = supabase
                .from('system_audit_logs')
                .select('id, action, module, details, performed_by, performed_at, metadata, risk_level, reason_code')
                .order('performed_at', { ascending: false })
                .limit(200);

            if (startDate) {
                query = query.gte('performed_at', new Date(startDate + 'T00:00:00').toISOString());
            }
            if (endDate) {
                query = query.lte('performed_at', new Date(endDate + 'T23:59:59').toISOString());
            }
            if (moduleFilter) {
                query = query.eq('module', moduleFilter);
            }
            if (actionFilter) {
                query = query.eq('action', actionFilter);
            }

            const { data, error } = await query;
            if (error) throw error;

            let filteredData = (data || []).map((r) => ({
                id: r.id,
                action: r.action,
                module: r.module,
                details: r.details,
                performed_by: r.performed_by,
                performed_at: r.performed_at,
                metadata: r.metadata,
                risk_level: r.risk_level,
                reason_code: r.reason_code,
            }));

            // Client-side search filter
            if (searchQuery.trim()) {
                const query = searchQuery.toLowerCase();
                filteredData = filteredData.filter(
                    (log) =>
                        log.details.toLowerCase().includes(query) ||
                        log.action.toLowerCase().includes(query) ||
                        log.module.toLowerCase().includes(query)
                );
            }
            if (riskFilter.trim()) {
                const rf = riskFilter.trim().toUpperCase();
                filteredData = filteredData.filter(
                    (log) => (log.risk_level || '').toUpperCase() === rf
                );
            }

            setLogs(filteredData);
        } catch (err: any) {
            showNotification(err?.message || 'تعذر تحميل سجل التدقيق', 'error');
            setLogs([]);
        } finally {
            setLoading(false);
        }
    }, [supabase, startDate, endDate, moduleFilter, actionFilter, riskFilter, searchQuery, showNotification]);

    useEffect(() => {
        void loadLogs();
    }, [loadLogs]);

    const toggleExpand = (id: string) => {
        setExpandedRow(expandedRow === id ? null : id);
    };

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold dark:text-white">سجل التدقيق</h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        سجل كامل لجميع العمليات الحساسة في النظام
                    </p>
                </div>
                <button
                    onClick={() => void loadLogs()}
                    disabled={loading}
                    className="px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold disabled:opacity-60 hover:bg-primary-600 transition-colors"
                >
                    {loading ? 'جاري التحميل...' : 'تحديث'}
                </button>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
                            من
                        </label>
                        <input
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            type="date"
                            className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
                            إلى
                        </label>
                        <input
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            type="date"
                            className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
                            الوحدة
                        </label>
                        <select
                            value={moduleFilter}
                            onChange={(e) => setModuleFilter(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        >
                            <option value="">الكل</option>
                            <option value="purchases">المشتريات</option>
                            <option value="menu_items">الأصناف</option>
                            <option value="customers">العملاء</option>
                            <option value="settings">الإعدادات</option>
                            <option value="admin_users">المستخدمين</option>
                            <option value="inventory">المخزون</option>
                            <option value="chart_of_accounts">دليل الحسابات</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
                            العملية
                        </label>
                        <select
                            value={actionFilter}
                            onChange={(e) => setActionFilter(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        >
                            <option value="">الكل</option>
                            <option value="create">إنشاء</option>
                            <option value="update">تحديث</option>
                            <option value="delete">حذف</option>
                            <option value="price_change">تغيير سعر</option>
                            <option value="cost_change">تغيير تكلفة</option>
                            <option value="status_change">تغيير حالة</option>
                            <option value="role_change">تغيير دور</option>
                            <option value="permission_change">تغيير صلاحيات</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
                            مستوى المخاطر
                        </label>
                        <select
                            value={riskFilter}
                            onChange={(e) => setRiskFilter(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        >
                            <option value="">الكل</option>
                            <option value="HIGH">عالية</option>
                            <option value="MEDIUM">متوسطة</option>
                            <option value="LOW">منخفضة</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
                            بحث
                        </label>
                        <input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            type="text"
                            placeholder="ابحث في التفاصيل..."
                            className="w-full px-3 py-2 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                    <span>إجمالي السجلات: {logs.length}</span>
                    {(startDate || endDate || moduleFilter || actionFilter || searchQuery) && (
                        <button
                            onClick={() => {
                                setStartDate('');
                                setEndDate('');
                                setModuleFilter('');
                                setActionFilter('');
                                setRiskFilter('');
                                setSearchQuery('');
                            }}
                            className="text-primary-500 hover:text-primary-600 font-semibold"
                        >
                            إعادة تعيين الفلاتر
                        </button>
                    )}
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400">
                            <tr>
                                <th className="py-3 px-4 text-right font-semibold border-r dark:border-gray-700">التاريخ</th>
                                <th className="py-3 px-4 text-right font-semibold border-r dark:border-gray-700">الوحدة</th>
                                <th className="py-3 px-4 text-right font-semibold border-r dark:border-gray-700">العملية</th>
                                <th className="py-3 px-4 text-right font-semibold border-r dark:border-gray-700">المخاطر</th>
                                <th className="py-3 px-4 text-right font-semibold border-r dark:border-gray-700">السبب</th>
                                <th className="py-3 px-4 text-right font-semibold border-r dark:border-gray-700">التفاصيل</th>
                                <th className="py-3 px-4 text-right font-semibold border-r dark:border-gray-700">المستخدم</th>
                                <th className="py-3 px-4 text-center font-semibold">البيانات</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map((log) => (
                                <React.Fragment key={log.id}>
                                    <tr className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
                                        <td className="py-3 px-4 dark:text-white whitespace-nowrap border-r dark:border-gray-700" dir="ltr">
                                            {formatDate(log.performed_at)}
                                        </td>
                                        <td className="py-3 px-4 border-r dark:border-gray-700">
                                            <span
                                                className={`px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap ${getModuleBadgeColor(
                                                    log.module
                                                )}`}
                                            >
                                                {moduleLabels[log.module] || log.module}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 border-r dark:border-gray-700">
                                            <span
                                                className={`px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap ${getActionBadgeColor(
                                                    log.action
                                                )}`}
                                            >
                                                {actionLabels[log.action] || log.action}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 border-r dark:border-gray-700">
                                            <span
                                                className={`px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap ${
                                                    (log.risk_level || '').toUpperCase() === 'HIGH'
                                                        ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                                        : (log.risk_level || '').toUpperCase() === 'MEDIUM'
                                                        ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                                                        : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                                }`}
                                            >
                                                {((log.risk_level || '').toUpperCase() === 'HIGH' && 'عالية') ||
                                                    ((log.risk_level || '').toUpperCase() === 'MEDIUM' && 'متوسطة') ||
                                                    ((log.risk_level || '').toUpperCase() === 'LOW' && 'منخفضة') ||
                                                    (log.risk_level || '—')}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 dark:text-white border-r dark:border-gray-700">
                                            {formatReason(log.reason_code)}
                                        </td>
                                        <td className="py-3 px-4 dark:text-white border-r dark:border-gray-700">{log.details}</td>
                                        <td className="py-3 px-4 dark:text-white text-xs border-r dark:border-gray-700" dir="ltr">
                                            {log.performed_by ? log.performed_by.substring(0, 8) + '...' : 'النظام'}
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                            {log.metadata && Object.keys(log.metadata).length > 0 && (
                                                <button
                                                    onClick={() => toggleExpand(log.id)}
                                                    className="text-primary-500 hover:text-primary-600 font-semibold text-xs"
                                                >
                                                    {expandedRow === log.id ? 'إخفاء' : 'عرض'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                    {expandedRow === log.id && log.metadata && (
                                        <tr className="bg-gray-50 dark:bg-gray-900/50 border-b dark:border-gray-700">
                                            <td colSpan={8} className="py-3 px-4">
                                                <div className="text-xs">
                                                    <div className="font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                        البيانات الإضافية:
                                                    </div>
                                                    <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg overflow-x-auto text-gray-800 dark:text-gray-200" dir="ltr">
                                                        {JSON.stringify(log.metadata, null, 2)}
                                                    </pre>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                            {logs.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="py-12 text-center text-gray-500 dark:text-gray-400">
                                        {loading ? (
                                            <div className="flex items-center justify-center gap-2">
                                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-500"></div>
                                                <span>جاري التحميل...</span>
                                            </div>
                                        ) : (
                                            'لا توجد سجلات'
                                        )}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AuditLogScreen;
