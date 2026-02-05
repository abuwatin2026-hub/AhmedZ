import React, { useEffect, useMemo, useState } from 'react';
import { useItemMeta } from '../../../contexts/ItemMetaContext';
import { useWarehouses } from '../../../contexts/WarehouseContext';
import { useSessionScope } from '../../../contexts/SessionScopeContext';
import { usePurchases } from '../../../contexts/PurchasesContext';
import { useSettings } from '../../../contexts/SettingsContext';
import { useToast } from '../../../contexts/ToastContext';
import { exportToXlsx, printPdfFromElement, sharePdf } from '../../../utils/export';
import { buildPdfBrandOptions, buildXlsxBrandOptions } from '../../../utils/branding';
import { toYmdLocal } from '../../../utils/dateUtils';
import { getSupabaseClient } from '../../../supabase';

type SupplierStockRow = {
  itemId: string;
  name: string;
  category: string;
  group: string;
  unit: string;
  currentStock: number;
  reservedStock: number;
  availableStock: number;
  avgDailySales: number;
  daysCover?: number;
  reorderPoint: number;
  targetCoverDays: number;
  leadTimeDays: number;
  packSize: number;
  suggestedQty: number;
};

const parseNumber = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const SupplierStockReportScreen: React.FC = () => {
  const { categories: categoryDefs, groups: groupDefs, getCategoryLabel, getGroupLabel, getUnitLabel } = useItemMeta();
  const { warehouses } = useWarehouses();
  const { scope } = useSessionScope();
  const { suppliers } = usePurchases();
  const { settings } = useSettings();
  const { showNotification } = useToast();

  const [warehouseId, setWarehouseId] = useState<string>('');
  const [selectedSupplier, setSelectedSupplier] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'low' | 'out'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [salesDays, setSalesDays] = useState<number>(7);
  const [isSharing, setIsSharing] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [rowsRaw, setRowsRaw] = useState<SupplierStockRow[]>([]);

  useEffect(() => {
    if (warehouseId) return;
    const fromScope = String(scope?.warehouseId || '');
    if (fromScope) {
      setWarehouseId(fromScope);
      return;
    }
    const first = warehouses?.[0]?.id ? String(warehouses[0].id) : '';
    if (first) setWarehouseId(first);
  }, [scope?.warehouseId, warehouseId, warehouses]);

  useEffect(() => {
    if (selectedSupplier) return;
    const first = suppliers?.[0]?.id ? String(suppliers[0].id) : '';
    if (first) setSelectedSupplier(first);
  }, [selectedSupplier, suppliers]);

  const supplierOptions = useMemo(() => {
    const list = [...(suppliers || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return [{ id: '', name: 'اختر المورد' }, ...list.map(s => ({ id: String(s.id), name: String(s.name || s.id) }))];
  }, [suppliers]);

  const categoryOptions = useMemo(() => {
    const activeKeys = categoryDefs.filter(c => c.isActive).map(c => String(c.key));
    const usedKeys = [...new Set((rowsRaw || []).map(r => String(r.category || '')).filter((v) => v.length > 0))];
    const merged = Array.from(new Set([...activeKeys, ...usedKeys])).sort((a, b) => a.localeCompare(b));
    return ['all', ...merged];
  }, [categoryDefs, rowsRaw]);

  const groupOptions = useMemo(() => {
    const activeKeys = groupDefs.filter(g => g.isActive).map(g => String(g.key));
    const usedKeys = [...new Set((rowsRaw || []).map(r => String(r.group || '')).filter(Boolean))];
    const merged = Array.from(new Set([...activeKeys, ...usedKeys])).sort((a, b) => a.localeCompare(b));
    return ['all', ...merged];
  }, [groupDefs, rowsRaw]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!selectedSupplier) {
        if (active) setRowsRaw([]);
        return;
      }
      if (!warehouseId) return;
      const supabase = getSupabaseClient();
      if (!supabase) return;
      setLoading(true);
      try {
        setError('');
        const { data, error: qErr } = await supabase.rpc('get_supplier_stock_report', {
          p_supplier_id: selectedSupplier,
          p_warehouse_id: warehouseId || null,
          p_days: Math.max(1, Number(salesDays) || 7),
        } as any);
        if (qErr) throw qErr;
        const mapped: SupplierStockRow[] = (Array.isArray(data) ? data : []).map((r: any) => {
          const itemId = String(r?.item_id || '');
          const nameJson = r?.item_name && typeof r.item_name === 'object' ? r.item_name : {};
          const name = String(nameJson?.ar || nameJson?.en || itemId);
          const currentStock = parseNumber(r?.current_stock);
          const reservedStock = parseNumber(r?.reserved_stock);
          const availableStock = parseNumber(r?.available_stock);
          const daysCoverRaw = r?.days_cover;
          const daysCover = daysCoverRaw === null || daysCoverRaw === undefined ? undefined : parseNumber(daysCoverRaw);
          return {
            itemId,
            name,
            category: String(r?.category || ''),
            group: String(r?.item_group || ''),
            unit: String(r?.unit || 'piece'),
            currentStock,
            reservedStock,
            availableStock,
            avgDailySales: parseNumber(r?.avg_daily_sales),
            daysCover,
            reorderPoint: parseNumber(r?.reorder_point),
            targetCoverDays: Math.max(0, Math.floor(parseNumber(r?.target_cover_days) || 0)),
            leadTimeDays: Math.max(0, Math.floor(parseNumber(r?.lead_time_days) || 0)),
            packSize: Math.max(0, parseNumber(r?.pack_size) || 1),
            suggestedQty: Math.max(0, parseNumber(r?.suggested_qty)),
          };
        }).filter((r: SupplierStockRow) => Boolean(r.itemId));
        if (active) setRowsRaw(mapped);
      } catch (e: any) {
        const msg = String(e?.message || '');
        if (active) {
          setRowsRaw([]);
          setError(msg || 'فشل تحميل تقرير المورد.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => { active = false; };
  }, [salesDays, selectedSupplier, warehouseId]);

  const rows = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return (rowsRaw || [])
      .filter((r) => {
        if (selectedCategory !== 'all' && r.category !== selectedCategory) return false;
        if (selectedGroup !== 'all' && r.group !== selectedGroup) return false;
        if (needle && !r.name.toLowerCase().includes(needle) && !r.itemId.toLowerCase().includes(needle)) return false;
        if (stockFilter === 'out') return r.availableStock <= 0;
        if (stockFilter === 'low') return r.availableStock > 0 && (r.suggestedQty > 0 || r.availableStock <= r.reorderPoint);
        if (stockFilter === 'in') return r.availableStock > 0 && r.suggestedQty <= 0 && r.availableStock > r.reorderPoint;
        return true;
      })
      .sort((a, b) => (b.suggestedQty - a.suggestedQty) || (a.availableStock - b.availableStock));
  }, [rowsRaw, searchTerm, selectedCategory, selectedGroup, stockFilter]);

  const selectedWarehouse = useMemo(() => warehouses.find(w => String(w.id) === String(warehouseId)), [warehouses, warehouseId]);
  const selectedSupplierName = useMemo(() => {
    if (!selectedSupplier) return '—';
    return suppliers.find(s => String(s.id) === String(selectedSupplier))?.name || selectedSupplier;
  }, [selectedSupplier, suppliers]);

  const filtersText = useMemo(() => {
    const parts: string[] = [];
    parts.push(`المورد: ${selectedSupplierName}`);
    parts.push(`الفترة: ${Math.max(1, Number(salesDays) || 7)} يوم`);
    parts.push(`المخزن: ${selectedWarehouse?.code || ''}${selectedWarehouse?.name ? ` — ${selectedWarehouse?.name}` : ''}`);
    parts.push(`الفئة: ${selectedCategory === 'all' ? 'الكل' : getCategoryLabel(selectedCategory, 'ar')}`);
    parts.push(`المجموعة: ${selectedGroup === 'all' ? 'الكل' : getGroupLabel(selectedGroup, selectedCategory !== 'all' ? selectedCategory : undefined, 'ar')}`);
    parts.push(`الحالة: ${stockFilter === 'all' ? 'الكل' : stockFilter === 'in' ? 'متوفر' : stockFilter === 'low' ? 'منخفض' : 'منعدم'}`);
    if (searchTerm.trim()) parts.push(`بحث: ${searchTerm.trim()}`);
    return parts.join(' • ');
  }, [getCategoryLabel, getGroupLabel, salesDays, searchTerm, selectedCategory, selectedGroup, selectedSupplierName, selectedWarehouse?.code, selectedWarehouse?.name, stockFilter]);

  const summary = useMemo(() => {
    let inCount = 0;
    let lowCount = 0;
    let outCount = 0;
    for (const r of rows) {
      if (r.availableStock <= 0) outCount += 1;
      else if (r.suggestedQty > 0 || r.availableStock <= r.reorderPoint) lowCount += 1;
      else inCount += 1;
    }
    return { inCount, lowCount, outCount };
  }, [rows]);

  const handleExport = async () => {
    const headers = [
      'المورد',
      'الصنف',
      'الفئة',
      'المجموعة',
      'الوحدة',
      'المخزون الحالي',
      'محجوز',
      'متاح',
      'متوسط البيع اليومي',
      'تغطية بالأيام',
      'نقطة إعادة الطلب',
      'هدف تغطية (يوم)',
      'مدة توريد (يوم)',
      'حجم العبوة',
      'كمية مقترحة للتوريد',
    ];
    const exportRows = rows.slice(0, 5000).map((r) => {
      return [
        selectedSupplierName,
        r.name,
        r.category ? getCategoryLabel(r.category, 'ar') : 'غير مصنف',
        r.group ? getGroupLabel(r.group, r.category || undefined, 'ar') : '—',
        getUnitLabel(r.unit as any, 'ar'),
        Number(r.currentStock.toFixed(2)),
        Number(r.reservedStock.toFixed(2)),
        Number(r.availableStock.toFixed(2)),
        Number(r.avgDailySales.toFixed(4)),
        r.daysCover === undefined ? '' : Number(r.daysCover.toFixed(2)),
        Number((r.reorderPoint || 0).toFixed(2)),
        r.targetCoverDays || 0,
        r.leadTimeDays || 0,
        Number((r.packSize || 1).toFixed(2)),
        Number((r.suggestedQty || 0).toFixed(2)),
      ];
    });
    const filename = `supplier_stock_${selectedSupplier || 'supplier'}_${toYmdLocal(new Date())}.xlsx`;
    const ok = await exportToXlsx(
      headers,
      exportRows,
      filename,
      { sheetName: 'Supplier Stock', ...buildXlsxBrandOptions(settings, 'مخزون المورد', headers.length, { periodText: filtersText }) }
    );
    showNotification(ok ? 'تم حفظ التقرير في مجلد المستندات' : 'فشل تصدير الملف.', ok ? 'success' : 'error');
  };

  const handleSharePdf = async () => {
    setIsSharing(true);
    const ok = await sharePdf(
      'supplier-stock-print-area',
      'تقرير مخزون المورد',
      `supplier_stock_${selectedSupplier || 'supplier'}_${toYmdLocal(new Date())}.pdf`,
      buildPdfBrandOptions(settings, `تقرير مخزون المورد • ${filtersText}`, { pageNumbers: true })
    );
    showNotification(ok ? 'تم حفظ التقرير في مجلد المستندات' : 'فشل مشاركة الملف.', ok ? 'success' : 'error');
    setIsSharing(false);
  };

  const handlePrintPdf = async () => {
    const ok = await printPdfFromElement(
      'supplier-stock-print-area',
      'تقرير مخزون المورد',
      buildPdfBrandOptions(settings, `تقرير مخزون المورد • ${filtersText}`, { pageNumbers: true })
    );
    if (!ok) {
      showNotification('تعذر الطباعة على هذا الجهاز. استخدم PDF للمشاركة.', 'error');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-l from-primary-600 to-gold-500">تقرير مخزون الموردين</h1>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            <span className="font-semibold">المخزن:</span> <span className="font-mono">{selectedWarehouse?.code || ''}</span> {selectedWarehouse?.name ? `— ${selectedWarehouse?.name}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60"
            disabled={loading || rows.length === 0 || !selectedSupplier}
          >
            تصدير Excel
          </button>
          <button
            type="button"
            onClick={() => void handleSharePdf()}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60"
            disabled={loading || isSharing || rows.length === 0 || !selectedSupplier}
          >
            PDF
          </button>
          <button
            type="button"
            onClick={() => void handlePrintPdf()}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60"
            disabled={loading || rows.length === 0 || !selectedSupplier}
          >
            طباعة
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">عدد الأصناف</div>
          <div className="text-2xl font-bold dark:text-white font-mono" dir="ltr">{rows.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">متوفر</div>
          <div className="text-2xl font-bold text-green-600 font-mono" dir="ltr">{summary.inCount}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">منخفض</div>
          <div className="text-2xl font-bold text-orange-600 font-mono" dir="ltr">{summary.lowCount}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">منعدم</div>
          <div className="text-2xl font-bold text-red-600 font-mono" dir="ltr">{summary.outCount}</div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">المخزن</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>{`${w.code} — ${w.name}`}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">المورد</label>
            <select
              value={selectedSupplier}
              onChange={(e) => setSelectedSupplier(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {supplierOptions.map(s => (
                <option key={s.id} value={s.id} disabled={s.id === ''}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نافذة المبيعات (يوم)</label>
            <select
              value={String(salesDays)}
              onChange={(e) => setSalesDays(Math.max(1, Number(e.target.value) || 7))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="7">7</option>
              <option value="14">14</option>
              <option value="30">30</option>
              <option value="60">60</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الفئة</label>
            <select
              value={selectedCategory}
              onChange={(e) => { setSelectedCategory(e.target.value); setSelectedGroup('all'); }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {categoryOptions.map(c => (
                <option key={c} value={c}>{c === 'all' ? 'الكل' : getCategoryLabel(c, 'ar')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">المجموعة</label>
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {groupOptions.map(g => (
                <option key={g} value={g}>
                  {g === 'all' ? 'الكل' : getGroupLabel(g, selectedCategory !== 'all' ? selectedCategory : undefined, 'ar')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">حالة المخزون</label>
            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">الكل</option>
              <option value="in">متوفر</option>
              <option value="low">منخفض</option>
              <option value="out">منعدم</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">بحث</label>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="اسم الصنف أو الكود..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
        </div>
        {error && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            {error}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الصنف</th>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الفئة</th>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">المجموعة</th>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الوحدة</th>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">المخزون الحالي</th>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">محجوز</th>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">متاح</th>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">تغطية (يوم)</th>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">إعادة الطلب</th>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300">توريد مقترح</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {(loading ? [] : rows).map((r) => {
                const statusColor = r.availableStock <= 0 ? 'text-red-600' : (r.suggestedQty > 0 || r.availableStock <= r.reorderPoint) ? 'text-orange-600' : 'text-green-600';
                const supplyText = r.suggestedQty > 0 ? `مطلوب +${r.suggestedQty.toFixed(2)}` : '—';
                return (
                  <tr key={r.itemId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="p-3 border-r dark:border-gray-700">
                      <div className="font-semibold dark:text-white">{r.name}</div>
                      <div className="text-xs text-gray-500 font-mono">{r.itemId}</div>
                    </td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">{r.category ? getCategoryLabel(r.category, 'ar') : 'غير مصنف'}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">
                      {r.group ? getGroupLabel(r.group, r.category || undefined, 'ar') : '—'}
                    </td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">{getUnitLabel(r.unit as any, 'ar')}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">{r.currentStock.toFixed(2)}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">{r.reservedStock.toFixed(2)}</td>
                    <td className={`p-3 border-r dark:border-gray-700 font-mono ${statusColor}`} dir="ltr">{r.availableStock.toFixed(2)}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">{r.daysCover === undefined ? '—' : r.daysCover.toFixed(1)}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">{(r.reorderPoint || 0).toFixed(2)}</td>
                    <td className={`p-3 font-semibold ${r.suggestedQty > 0 ? 'text-orange-700 dark:text-orange-400' : 'text-gray-500 dark:text-gray-400'}`} dir="ltr">{supplyText}</td>
                  </tr>
                );
              })}
              {loading && (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-gray-500 dark:text-gray-400">جاري التحميل...</td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-gray-500 dark:text-gray-400">{selectedSupplier ? 'لا توجد نتائج.' : 'اختر موردًا لعرض التقرير.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="fixed left-[-10000px] top-0 w-[900px] bg-white text-black p-6" id="supplier-stock-print-area">
        <div className="mb-4 space-y-1">
          <div className="text-xl font-bold">{settings.cafeteriaName?.ar || 'تقارير'}</div>
          <div className="text-sm text-gray-700">تقرير مخزون المورد</div>
          <div className="text-xs text-gray-600">{filtersText}</div>
          <div className="text-xs text-gray-600" dir="ltr">{new Date().toLocaleString('ar-EG-u-nu-latn')}</div>
        </div>
        <table className="w-full text-right">
          <thead>
            <tr>
              <th className="p-2 border">الصنف</th>
              <th className="p-2 border">الفئة</th>
              <th className="p-2 border">المجموعة</th>
              <th className="p-2 border">الوحدة</th>
              <th className="p-2 border">الحالي</th>
              <th className="p-2 border">محجوز</th>
              <th className="p-2 border">متاح</th>
              <th className="p-2 border">تغطية</th>
              <th className="p-2 border">إعادة الطلب</th>
              <th className="p-2 border">توريد</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((r) => (
              <tr key={r.itemId}>
                <td className="p-2 border">{r.name}</td>
                <td className="p-2 border">{r.category ? getCategoryLabel(r.category, 'ar') : 'غير مصنف'}</td>
                <td className="p-2 border">{r.group ? getGroupLabel(r.group, r.category || undefined, 'ar') : '—'}</td>
                <td className="p-2 border">{getUnitLabel(r.unit as any, 'ar')}</td>
                <td className="p-2 border" dir="ltr">{r.currentStock.toFixed(2)}</td>
                <td className="p-2 border" dir="ltr">{r.reservedStock.toFixed(2)}</td>
                <td className="p-2 border" dir="ltr">{r.availableStock.toFixed(2)}</td>
                <td className="p-2 border" dir="ltr">{r.daysCover === undefined ? '—' : r.daysCover.toFixed(1)}</td>
                <td className="p-2 border" dir="ltr">{(r.reorderPoint || 0).toFixed(2)}</td>
                <td className="p-2 border" dir="ltr">{r.suggestedQty > 0 ? `+${r.suggestedQty.toFixed(2)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SupplierStockReportScreen;
