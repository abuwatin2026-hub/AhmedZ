import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Spinner from '../../../components/Spinner';
import { useToast } from '../../../contexts/ToastContext';
import { useSettings } from '../../../contexts/SettingsContext';
import { exportToXlsx, sharePdf } from '../../../utils/export';
import { buildPdfBrandOptions, buildXlsxBrandOptions } from '../../../utils/branding';
import { getSupabaseClient } from '../../../supabase';
import { localizeSupabaseError } from '../../../utils/errorUtils';
import { endOfDayFromYmd, startOfDayFromYmd, toYmdLocal } from '../../../utils/dateUtils';
import { useSessionScope } from '../../../contexts/SessionScopeContext';

type FoodSaleMovementRow = {
  order_id: string;
  sold_at: string;
  warehouse_id: string | null;
  item_id: string;
  item_name: any;
  batch_id: string;
  expiry_date: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
};

type BatchRecallRow = {
  order_id: string;
  sold_at: string;
  warehouse_id: string | null;
  item_id: string;
  item_name: any;
  batch_id: string;
  expiry_date: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  quantity: number;
};

const shortId = (id: string | null | undefined) => {
  const s = String(id || '');
  return s ? s.slice(0, 8).toUpperCase() : '';
};

const getItemName = (name: any) => {
  const ar = name?.ar;
  const en = name?.en;
  return String(ar || en || '');
};

const FoodTraceReports: React.FC = () => {
  const { settings } = useSettings();
  const { showNotification } = useToast();
  const { scope } = useSessionScope();
  const scopeWarehouseId = scope?.warehouseId || '';
  const scopeBranchId = scope?.branchId || '';
  const [tab, setTab] = useState<'sales' | 'recall'>('sales');
  const [isSharing, setIsSharing] = useState(false);

  const [dateFrom, setDateFrom] = useState<string>(toYmdLocal(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [dateTo, setDateTo] = useState<string>(toYmdLocal(new Date()));
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');
  const effectiveWarehouseId = useMemo(() => (warehouseId || scopeWarehouseId || ''), [warehouseId, scopeWarehouseId]);
  const effectiveBranchId = useMemo(() => (branchId || scopeBranchId || ''), [branchId, scopeBranchId]);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<FoodSaleMovementRow[]>([]);

  const [batchId, setBatchId] = useState<string>('');
  const [recallLoading, setRecallLoading] = useState(false);
  const [recallRows, setRecallRows] = useState<BatchRecallRow[]>([]);

  const loadSales = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_food_sales_movements_report', {
        p_start_date: startOfDayFromYmd(dateFrom),
        p_end_date: endOfDayFromYmd(dateTo),
        p_warehouse_id: effectiveWarehouseId || null,
        p_branch_id: effectiveBranchId || null,
      } as any);
      if (error) throw error;
      setRows(((data || []) as any[]).map((r) => ({
        order_id: String(r.order_id),
        sold_at: String(r.sold_at),
        warehouse_id: r.warehouse_id ? String(r.warehouse_id) : null,
        item_id: String(r.item_id),
        item_name: r.item_name,
        batch_id: String(r.batch_id),
        expiry_date: r.expiry_date ? String(r.expiry_date) : null,
        supplier_id: r.supplier_id ? String(r.supplier_id) : null,
        supplier_name: r.supplier_name ? String(r.supplier_name) : null,
        quantity: Number(r.quantity) || 0,
        unit_cost: Number(r.unit_cost) || 0,
        total_cost: Number(r.total_cost) || 0,
      })));
    } catch (e) {
      setRows([]);
      const msg = localizeSupabaseError(e) || 'تعذر تحميل تقرير تتبع الدفعات.';
      showNotification(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, effectiveWarehouseId, effectiveBranchId, showNotification]);

  const loadRecall = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const b = batchId.trim();
    if (!b) {
      showNotification('أدخل رقم الدفعة (Batch ID) أولاً.', 'info');
      return;
    }
    setRecallLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_batch_recall_orders', {
        p_batch_id: b,
        p_warehouse_id: effectiveWarehouseId || null,
        p_branch_id: effectiveBranchId || null,
      } as any);
      if (error) throw error;
      setRecallRows(((data || []) as any[]).map((r) => ({
        order_id: String(r.order_id),
        sold_at: String(r.sold_at),
        warehouse_id: r.warehouse_id ? String(r.warehouse_id) : null,
        item_id: String(r.item_id),
        item_name: r.item_name,
        batch_id: String(r.batch_id),
        expiry_date: r.expiry_date ? String(r.expiry_date) : null,
        supplier_id: r.supplier_id ? String(r.supplier_id) : null,
        supplier_name: r.supplier_name ? String(r.supplier_name) : null,
        quantity: Number(r.quantity) || 0,
      })));
    } catch (e) {
      setRecallRows([]);
      const msg = localizeSupabaseError(e) || 'تعذر تنفيذ الاستدعاء (Recall).';
      showNotification(msg, 'error');
    } finally {
      setRecallLoading(false);
    }
  }, [batchId, effectiveWarehouseId, effectiveBranchId, showNotification]);

  const rowsToXlsx = (data: FoodSaleMovementRow[]) => data.map((r) => [
    new Date(r.sold_at).toLocaleString('ar-EG-u-nu-latn'),
    shortId(r.order_id),
    getItemName(r.item_name) || shortId(r.item_id),
    shortId(r.batch_id),
    r.expiry_date || '',
    r.supplier_name || '',
    Number(r.quantity || 0),
    Number(r.unit_cost || 0),
    Number(r.total_cost || 0),
  ]);

  const recallRowsToXlsx = (data: BatchRecallRow[]) => data.map((r) => [
    new Date(r.sold_at).toLocaleString('ar-EG-u-nu-latn'),
    shortId(r.order_id),
    getItemName(r.item_name) || shortId(r.item_id),
    shortId(r.batch_id),
    r.expiry_date || '',
    r.supplier_name || '',
    Number(r.quantity || 0),
  ]);

  const handleExportSalesXlsx = async () => {
    const headers = ['وقت البيع', 'رقم الطلب', 'الصنف', 'الدفعة', 'انتهاء', 'المورد', 'الكمية', 'التكلفة', 'الإجمالي'];
    const xlsxRows = rowsToXlsx(rows);
    const ok = await exportToXlsx(
      headers,
      xlsxRows,
      `food_trace_sales_${dateFrom || 'all'}_to_${dateTo || 'all'}.xlsx`,
      { sheetName: 'FoodTrace', currencyColumns: [7, 8], currencyFormat: '#,##0.00', ...buildXlsxBrandOptions(settings, 'تتبع دفعات الغذاء', headers.length, { periodText: `الفترة: ${dateFrom || '—'} → ${dateTo || '—'}` }) }
    );
    showNotification(ok ? 'تم حفظ التقرير في مجلد المستندات' : 'فشل تصدير الملف.', ok ? 'success' : 'error');
  };

  const handleShareSalesPdf = async () => {
    setIsSharing(true);
    const ok = await sharePdf(
      'trace-print-area',
      'تتبع دفعات الغذاء',
      `food_trace_sales_${dateFrom || 'all'}_to_${dateTo || 'all'}.pdf`,
      buildPdfBrandOptions(settings, `تتبع دفعات الغذاء • الفترة: ${dateFrom || '—'} → ${dateTo || '—'}`, { pageNumbers: true })
    );
    showNotification(ok ? 'تم حفظ التقرير في مجلد المستندات' : 'فشل مشاركة الملف.', ok ? 'success' : 'error');
    setIsSharing(false);
  };

  const handleExportRecallXlsx = async () => {
    const headers = ['وقت البيع', 'رقم الطلب', 'الصنف', 'الدفعة', 'انتهاء', 'المورد', 'الكمية'];
    const xlsxRows = recallRowsToXlsx(recallRows);
    const ok = await exportToXlsx(
      headers,
      xlsxRows,
      `recall_${batchId.trim() || 'batch'}.xlsx`,
      { sheetName: 'Recall', ...buildXlsxBrandOptions(settings, 'Recall', headers.length, { periodText: `Batch: ${batchId.trim() || '—'}` }) }
    );
    showNotification(ok ? 'تم حفظ التقرير في مجلد المستندات' : 'فشل تصدير الملف.', ok ? 'success' : 'error');
  };

  const handleShareRecallPdf = async () => {
    setIsSharing(true);
    const ok = await sharePdf(
      'recall-print-area',
      'Recall',
      `recall_${batchId.trim() || 'batch'}.pdf`,
      buildPdfBrandOptions(settings, `Recall • Batch: ${batchId.trim() || '—'}`, { pageNumbers: true })
    );
    showNotification(ok ? 'تم حفظ التقرير في مجلد المستندات' : 'فشل مشاركة الملف.', ok ? 'success' : 'error');
    setIsSharing(false);
  };

  useEffect(() => {
    if (tab !== 'sales') return;
    void loadSales();
  }, [tab, loadSales]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">تتبع دفعات الغذاء</h1>
          <div className="text-sm text-gray-600 dark:text-gray-300">تقارير مبنية من حركات المخزون المرتبطة بالدفعات.</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('sales')}
            className={tab === 'sales' ? 'px-3 py-2 rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'px-3 py-2 rounded-lg bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'}
          >
            مبيعات الغذاء
          </button>
          <button
            onClick={() => setTab('recall')}
            className={tab === 'recall' ? 'px-3 py-2 rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'px-3 py-2 rounded-lg bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'}
          >
            Recall
          </button>
        </div>
      </div>

      {tab === 'sales' ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm mb-1 dark:text-gray-200">من</label>
              <input value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} type="date" className="w-full border rounded-lg p-2 dark:bg-gray-900 dark:border-gray-700 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm mb-1 dark:text-gray-200">إلى</label>
              <input value={dateTo} onChange={(e) => setDateTo(e.target.value)} type="date" className="w-full border rounded-lg p-2 dark:bg-gray-900 dark:border-gray-700 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm mb-1 dark:text-gray-200">Warehouse ID (اختياري)</label>
              <input value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} placeholder={scopeWarehouseId || ''} className="w-full border rounded-lg p-2 dark:bg-gray-900 dark:border-gray-700 dark:text-white font-mono" />
            </div>
            <div className="flex items-end">
              <button onClick={() => void loadSales()} className="w-full px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700">
                تحديث
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-3">
              <label className="block text-sm mb-1 dark:text-gray-200">Branch ID (اختياري)</label>
              <input value={branchId} onChange={(e) => setBranchId(e.target.value)} placeholder={scopeBranchId || ''} className="w-full border rounded-lg p-2 dark:bg-gray-900 dark:border-gray-700 dark:text-white font-mono" />
            </div>
            <div className="flex items-end gap-2">
              <button onClick={handleExportSalesXlsx} disabled={loading} className="flex-1 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60">
                Excel
              </button>
              <button onClick={handleShareSalesPdf} disabled={isSharing || loading} className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
                PDF
              </button>
            </div>
          </div>

          {loading ? (
            <div className="py-10 flex justify-center"><Spinner /></div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-gray-600 dark:text-gray-300 py-6 text-center">لا توجد بيانات للفترة المحددة.</div>
          ) : (
            <div id="trace-print-area" className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/40">
                  <tr>
                    <th className="p-2 text-right">الوقت</th>
                    <th className="p-2 text-right">الطلب</th>
                    <th className="p-2 text-right">الصنف</th>
                    <th className="p-2 text-right">الدفعة</th>
                    <th className="p-2 text-right">الانتهاء</th>
                    <th className="p-2 text-right">المورد</th>
                    <th className="p-2 text-right">الكمية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {rows.map((r) => (
                    <tr key={`${r.order_id}:${r.item_id}:${r.batch_id}:${r.sold_at}`}>
                      <td className="p-2 whitespace-nowrap">{new Date(r.sold_at).toLocaleString('ar-EG-u-nu-latn')}</td>
                      <td className="p-2 font-mono">{shortId(r.order_id)}</td>
                      <td className="p-2">{getItemName(r.item_name) || shortId(r.item_id)}</td>
                      <td className="p-2 font-mono">{shortId(r.batch_id)}</td>
                      <td className="p-2 whitespace-nowrap">{r.expiry_date || '-'}</td>
                      <td className="p-2">{r.supplier_name || '-'}</td>
                      <td className="p-2 font-mono">{Number(r.quantity || 0).toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="md:col-span-3">
              <label className="block text-sm mb-1 dark:text-gray-200">Batch ID</label>
              <input value={batchId} onChange={(e) => setBatchId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="w-full border rounded-lg p-2 dark:bg-gray-900 dark:border-gray-700 dark:text-white font-mono" />
            </div>
            <div>
              <button onClick={() => void loadRecall()} className="w-full px-4 py-2 rounded-lg bg-orange-600 text-white hover:bg-orange-700">
                تنفيذ Recall
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm mb-1 dark:text-gray-200">Warehouse ID (اختياري)</label>
              <input value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} placeholder={scopeWarehouseId || ''} className="w-full border rounded-lg p-2 dark:bg-gray-900 dark:border-gray-700 dark:text-white font-mono" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm mb-1 dark:text-gray-200">Branch ID (اختياري)</label>
              <input value={branchId} onChange={(e) => setBranchId(e.target.value)} placeholder={scopeBranchId || ''} className="w-full border rounded-lg p-2 dark:bg-gray-900 dark:border-gray-700 dark:text-white font-mono" />
            </div>
            <div className="flex items-end gap-2">
              <button onClick={handleExportRecallXlsx} disabled={recallLoading} className="flex-1 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60">
                Excel
              </button>
              <button onClick={handleShareRecallPdf} disabled={isSharing || recallLoading} className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
                PDF
              </button>
            </div>
          </div>

          {recallLoading ? (
            <div className="py-10 flex justify-center"><Spinner /></div>
          ) : recallRows.length === 0 ? (
            <div className="text-sm text-gray-600 dark:text-gray-300 py-6 text-center">لا توجد طلبات مرتبطة بهذه الدفعة.</div>
          ) : (
            <div id="recall-print-area" className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/40">
                  <tr>
                    <th className="p-2 text-right">الوقت</th>
                    <th className="p-2 text-right">الطلب</th>
                    <th className="p-2 text-right">الصنف</th>
                    <th className="p-2 text-right">الانتهاء</th>
                    <th className="p-2 text-right">المورد</th>
                    <th className="p-2 text-right">الكمية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {recallRows.map((r) => (
                    <tr key={`${r.order_id}:${r.item_id}:${r.sold_at}`}>
                      <td className="p-2 whitespace-nowrap">{new Date(r.sold_at).toLocaleString('ar-EG-u-nu-latn')}</td>
                      <td className="p-2 font-mono">{shortId(r.order_id)}</td>
                      <td className="p-2">{getItemName(r.item_name) || shortId(r.item_id)}</td>
                      <td className="p-2 whitespace-nowrap">{r.expiry_date || '-'}</td>
                      <td className="p-2">{r.supplier_name || '-'}</td>
                      <td className="p-2 font-mono">{Number(r.quantity || 0).toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FoodTraceReports;
