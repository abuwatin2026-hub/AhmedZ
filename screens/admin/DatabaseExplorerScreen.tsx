import React, { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { localizeSupabaseError } from '../../utils/errorUtils';
import Spinner from '../../components/Spinner';

type TableDef = { key: string; label: string };

const TABLES: TableDef[] = [
  { key: 'menu_items', label: 'الأصناف' },
  { key: 'orders', label: 'الطلبات' },
  { key: 'order_events', label: 'أحداث الطلبات' },
  { key: 'customers', label: 'العملاء' },
  { key: 'reviews', label: 'التقييمات' },
  { key: 'coupons', label: 'الكوبونات' },
  { key: 'addons', label: 'الإضافات' },
  { key: 'ads', label: 'الإعلانات' },
  { key: 'delivery_zones', label: 'مناطق التوصيل' },
  { key: 'app_settings', label: 'إعدادات التطبيق' },
  { key: 'admin_users', label: 'مستخدمي لوحة التحكم' },
  { key: 'item_categories', label: 'فئات الأصناف' },
  { key: 'item_groups', label: 'مجموعات الأصناف' },
  { key: 'unit_types', label: 'أنواع الوحدات' },
  { key: 'freshness_levels', label: 'درجات الطزاجة' },
  { key: 'banks', label: 'البنوك' },
  { key: 'transfer_recipients', label: 'مستلمو الشبكات' },
  { key: 'stock_management', label: 'إدارة المخزون' },
  { key: 'stock_history', label: 'سجل المخزون' },
  { key: 'price_history', label: 'سجل الأسعار' },
  { key: 'currencies', label: 'العملات' },
  { key: 'fx_rates', label: 'أسعار الصرف' },
  { key: 'inventory_movements', label: 'حركات المخزون' },
  { key: 'order_item_cogs', label: 'تكلفة أصناف الطلب' },
  { key: 'payments', label: 'المدفوعات' },
  { key: 'cash_shifts', label: 'وردية النقد' },
  { key: 'suppliers', label: 'الموردون' },
  { key: 'purchase_orders', label: 'أوامر الشراء' },
  { key: 'purchase_items', label: 'أصناف الشراء' },
  { key: 'purchase_receipts', label: 'إيصالات الشراء' },
  { key: 'purchase_receipt_items', label: 'أصناف إيصالات الشراء' },
  { key: 'purchase_returns', label: 'مرتجعات الشراء' },
  { key: 'purchase_return_items', label: 'أصناف مرتجعات الشراء' },
  { key: 'stock_wastage', label: 'تالف المخزون' },
  { key: 'system_audit_logs', label: 'سجل النظام' },
  { key: 'cost_centers', label: 'مراكز التكلفة' },
  { key: 'chart_of_accounts', label: 'دليل الحسابات' },
  { key: 'journal_entries', label: 'قيود اليومية' },
  { key: 'journal_lines', label: 'تفاصيل القيود' },
  { key: 'accounting_periods', label: 'الفترات المحاسبية' },
  { key: 'sales_returns', label: 'مرتجعات المبيعات' },
  { key: 'production_orders', label: 'أوامر الإنتاج' },
  { key: 'production_order_inputs', label: 'مدخلات الإنتاج' },
  { key: 'production_order_outputs', label: 'مخرجات الإنتاج' },
  { key: 'notifications', label: 'الإشعارات' },
];

const PAGE_SIZE = 50;

const DatabaseExplorerScreen: React.FC = () => {
  const [selectedTable, setSelectedTable] = useState<string>(TABLES[0]?.key || '');
  const [rows, setRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [page, setPage] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const { showNotification } = useToast();
  const { hasPermission } = useAuth();

  useEffect(() => {
    if (!hasPermission('settings.manage')) {
      showNotification('هذه الصفحة تتطلب صلاحية الإعدادات.', 'error');
    }
  }, [hasPermission, showNotification]);

  const supabase = getSupabaseClient();

  const fetchData = async (table: string, currentPage: number) => {
    if (!supabase) return;
    setLoading(true);
    try {
      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const sel = supabase.from(table).select('*', { count: 'exact' }).range(from, to);
      const { data, count, error } = await sel;
      if (error) throw error;
      const arr = Array.isArray(data) ? data : [];
      setRows(arr);
      setTotalCount(typeof count === 'number' ? count : arr.length);
      const keys = new Set<string>();
      arr.forEach((r: any) => {
        Object.keys(r || {}).forEach(k => keys.add(k));
      });
      setColumns(Array.from(keys));
    } catch (err: any) {
      showNotification(localizeSupabaseError(err) || 'فشل تحميل البيانات', 'error');
      setRows([]);
      setColumns([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    void fetchData(selectedTable, 1);
  }, [selectedTable]);

  useEffect(() => {
    void fetchData(selectedTable, page);
  }, [page]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      columns.some(col => {
        const v = r?.[col];
        if (v == null) return false;
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return s.toLowerCase().includes(q);
      })
    );
  }, [rows, columns, query]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">الجدول</label>
          <select
            value={selectedTable}
            onChange={e => setSelectedTable(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            {TABLES.map(t => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">بحث</label>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="ابحث داخل النتائج المعروضة..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>
        <div className="md:col-span-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">الصفحات</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-2 bg-gray-200 rounded-md dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
              disabled={page <= 1}
            >
              السابق
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300" dir="ltr">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="px-3 py-2 bg-gray-200 rounded-md dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
              disabled={page >= totalPages}
            >
              التالي
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                {columns.length === 0 ? (
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">لا توجد أعمدة</th>
                ) : (
                  columns.map(col => (
                    <th key={col} className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">{col}</th>
                  ))
                )}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-center text-sm text-gray-500 dark:text-gray-400" colSpan={Math.max(1, columns.length)}>
                    لا توجد بيانات لعرضها
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => (
                  <tr key={idx}>
                    {columns.map(col => {
                      const v = row?.[col];
                      const s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
                      const isNumeric = typeof v === 'number';
                      return (
                        <td key={col} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300" dir={isNumeric ? 'ltr' : undefined}>
                          {s.length > 200 ? s.slice(0, 200) + '…' : s}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        إجمالي السجلات: <span dir="ltr">{totalCount}</span>
      </div>
    </div>
  );
};

export default DatabaseExplorerScreen;
