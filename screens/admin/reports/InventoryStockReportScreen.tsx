import React, { useEffect, useMemo, useState } from 'react';
import { useItemMeta } from '../../../contexts/ItemMetaContext';
import { useWarehouses } from '../../../contexts/WarehouseContext';
import { useSessionScope } from '../../../contexts/SessionScopeContext';
import { usePurchases } from '../../../contexts/PurchasesContext';
import { useSettings } from '../../../contexts/SettingsContext';
import { useToast } from '../../../contexts/ToastContext';
import { getSupabaseClient } from '../../../supabase';
import { exportToXlsx, printPdfFromElement, sharePdf } from '../../../utils/export';
import { buildPdfBrandOptions, buildXlsxBrandOptions } from '../../../utils/branding';
import { toYmdLocal } from '../../../utils/dateUtils';

type StockRow = {
  itemId: string;
  name: string;
  category: string;
  group: string;
  unit: string;
  currentStock: number;
  reservedStock: number;
  availableStock: number;
  lowStockThreshold: number;
  supplierIds: string[];
};

type AggregatedRow = {
  key: string;
  label: string;
  itemsCount: number;
  currentStock: number;
  reservedStock: number;
  availableStock: number;
};

type CostSummary = {
  layersCount: number;
  distinctCosts: number;
  minUnitCost: number;
  maxUnitCost: number;
  weightedAvgUnitCost: number;
  totalRemaining: number;
};

type CostLayerRow = {
  batchId: string;
  batchCode: string;
  expiryDate: string | null;
  remainingQty: number;
  unitCost: number;
  purchaseOrderRef?: string;
  importShipmentRef?: string;
};

const parseNumber = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const InventoryStockReportScreen: React.FC = () => {
  const { categories: categoryDefs, groups: groupDefs, getCategoryLabel, getGroupLabel, getUnitLabel } = useItemMeta();
  const { warehouses } = useWarehouses();
  const { scope } = useSessionScope();
  const { suppliers } = usePurchases();
  const { settings } = useSettings();
  const { showNotification } = useToast();

  const [warehouseId, setWarehouseId] = useState<string>('');
  const [groupBy, setGroupBy] = useState<'item' | 'category' | 'group' | 'supplier'>('item');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedSupplier, setSelectedSupplier] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'low' | 'out'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(200);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isSharing, setIsSharing] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [rowsRaw, setRowsRaw] = useState<StockRow[]>([]);
  const [costSummaryByItemId, setCostSummaryByItemId] = useState<Record<string, CostSummary>>({});
  const [costModalOpen, setCostModalOpen] = useState(false);
  const [costModalTitle, setCostModalTitle] = useState('');
  const [costModalRows, setCostModalRows] = useState<CostLayerRow[]>([]);
  const [costModalBusy, setCostModalBusy] = useState(false);

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
    let active = true;
    const run = async () => {
      if (!warehouseId) return;
      const supabase = getSupabaseClient();
      if (!supabase) return;
      setLoading(true);
      try {
        setError('');
        const isPaged = groupBy === 'item';
        const limit = isPaged ? pageSize : 20000;
        const offset = isPaged ? Math.max(0, (Math.max(1, page) - 1) * pageSize) : 0;
        const { data, error: qErr } = await supabase.rpc('get_inventory_stock_report', {
          p_warehouse_id: warehouseId,
          p_category: selectedCategory === 'all' ? null : selectedCategory,
          p_group: selectedGroup === 'all' ? null : selectedGroup,
          p_supplier_id: selectedSupplier === 'all' ? null : selectedSupplier,
          p_stock_filter: stockFilter,
          p_search: searchTerm.trim() ? searchTerm.trim() : null,
          p_limit: limit,
          p_offset: offset,
        } as any);
        if (qErr) throw qErr;
        const rows = (Array.isArray(data) ? data : []).map((r: any) => {
          const itemId = String(r?.item_id || '');
          const nameJson = r?.item_name && typeof r.item_name === 'object' ? r.item_name : {};
          const name = String(nameJson?.ar || nameJson?.en || itemId);
          const supplierIds = Array.isArray(r?.supplier_ids) ? (r.supplier_ids as any[]).map(v => String(v)) : [];
          return {
            itemId,
            name,
            category: String(r?.category || ''),
            group: String(r?.item_group || ''),
            unit: String(r?.unit || 'piece'),
            currentStock: parseNumber(r?.current_stock),
            reservedStock: parseNumber(r?.reserved_stock),
            availableStock: parseNumber(r?.available_stock),
            lowStockThreshold: Math.max(0, parseNumber(r?.low_stock_threshold) || 5),
            supplierIds,
          } as StockRow;
        }).filter((r: StockRow) => Boolean(r.itemId));
        const total = rows.length > 0 ? Math.max(0, Number((data as any[])[0]?.total_count || 0)) : 0;
        if (active) {
          setRowsRaw(rows);
          setTotalCount(total);
        }
      } catch (e: any) {
        const msg = String(e?.message || '');
        if (active) {
          setRowsRaw([]);
          setTotalCount(0);
          setError(msg || 'فشل تحميل بيانات المخزون.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [groupBy, page, pageSize, searchTerm, selectedCategory, selectedGroup, selectedSupplier, stockFilter, warehouseId]);

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

  const supplierOptions = useMemo(() => {
    const list = [...(suppliers || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return [{ id: 'all', name: 'الكل' }, ...list.map(s => ({ id: s.id, name: s.name }))];
  }, [suppliers]);

  useEffect(() => {
    setPage(1);
  }, [groupBy, searchTerm, selectedCategory, selectedGroup, selectedSupplier, stockFilter, warehouseId]);

  const filteredRows = useMemo<StockRow[]>(() => rowsRaw, [rowsRaw]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (groupBy !== 'item') {
        if (active) setCostSummaryByItemId({});
        return;
      }
      if (!warehouseId) return;
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const ids = filteredRows.map((r) => String(r.itemId || '').trim()).filter(Boolean);
      if (ids.length === 0) {
        if (active) setCostSummaryByItemId({});
        return;
      }
      try {
        const { data, error: qErr } = await supabase.rpc('get_item_cost_layers_summaries', {
          p_warehouse_id: warehouseId,
          p_item_ids: ids,
        } as any);
        if (qErr) throw qErr;
        const map: Record<string, CostSummary> = {};
        for (const row of (Array.isArray(data) ? data : [])) {
          const itemId = String((row as any)?.item_id || '').trim();
          if (!itemId) continue;
          map[itemId] = {
            layersCount: Number((row as any)?.layers_count || 0) || 0,
            distinctCosts: Number((row as any)?.distinct_costs || 0) || 0,
            totalRemaining: parseNumber((row as any)?.total_remaining),
            minUnitCost: parseNumber((row as any)?.min_unit_cost),
            maxUnitCost: parseNumber((row as any)?.max_unit_cost),
            weightedAvgUnitCost: parseNumber((row as any)?.weighted_avg_unit_cost),
          };
        }
        if (active) setCostSummaryByItemId(map);
      } catch (e: any) {
        if (active) setCostSummaryByItemId({});
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [filteredRows, groupBy, warehouseId]);

  const openCostModal = async (row: StockRow) => {
    if (!warehouseId) return;
    const itemId = String(row.itemId || '').trim();
    if (!itemId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setCostModalTitle(`طبقات التكلفة: ${row.name}`);
    setCostModalOpen(true);
    setCostModalBusy(true);
    try {
      const { data, error: qErr } = await supabase.rpc('list_item_cost_layers', {
        p_item_id: itemId,
        p_warehouse_id: warehouseId,
        p_limit: 30,
      } as any);
      if (qErr) throw qErr;
      const rows = (Array.isArray(data) ? data : []).map((r: any) => ({
        batchId: String(r?.batch_id || ''),
        batchCode: String(r?.batch_code || ''),
        expiryDate: r?.expiry_date ? String(r.expiry_date) : null,
        remainingQty: parseNumber(r?.remaining_qty),
        unitCost: parseNumber(r?.unit_cost),
        purchaseOrderRef: r?.purchase_order_ref ? String(r.purchase_order_ref) : undefined,
        importShipmentRef: r?.import_shipment_ref ? String(r.import_shipment_ref) : undefined,
      } satisfies CostLayerRow)).filter((x: any) => Boolean(x.batchId));
      setCostModalRows(rows);
    } catch (e: any) {
      setCostModalRows([]);
      showNotification(String(e?.message || '') || 'فشل تحميل طبقات التكلفة.', 'error');
    } finally {
      setCostModalBusy(false);
    }
  };

  const aggregated = useMemo<AggregatedRow[]>(() => {
    if (groupBy === 'item') return [];
    const byKey = new Map<string, AggregatedRow>();
    for (const row of filteredRows) {
      let key = '';
      let label = '';
      if (groupBy === 'category') {
        key = row.category || '—';
        label = key === '—' ? 'غير مصنف' : getCategoryLabel(key, 'ar');
      } else if (groupBy === 'group') {
        key = row.group || '—';
        label = key === '—' ? 'بدون مجموعة' : getGroupLabel(key, selectedCategory !== 'all' ? selectedCategory : undefined, 'ar');
      } else {
        const sid = row.supplierIds?.[0] || '—';
        key = sid;
        label = sid === '—' ? 'بدون مورد' : (suppliers.find(s => s.id === sid)?.name || sid);
      }
      const prev = byKey.get(key) || { key, label, itemsCount: 0, currentStock: 0, reservedStock: 0, availableStock: 0 };
      byKey.set(key, {
        ...prev,
        itemsCount: prev.itemsCount + 1,
        currentStock: prev.currentStock + row.currentStock,
        reservedStock: prev.reservedStock + row.reservedStock,
        availableStock: prev.availableStock + row.availableStock,
      });
    }
    return Array.from(byKey.values()).sort((a, b) => b.availableStock - a.availableStock);
  }, [filteredRows, getCategoryLabel, getGroupLabel, groupBy, selectedCategory, suppliers]);

  const selectedWarehouse = useMemo(() => warehouses.find(w => String(w.id) === String(warehouseId)), [warehouses, warehouseId]);
  const selectedSupplierName = useMemo(() => {
    if (selectedSupplier === 'all') return 'الكل';
    return suppliers.find(s => String(s.id) === String(selectedSupplier))?.name || selectedSupplier;
  }, [selectedSupplier, suppliers]);

  const filtersText = useMemo(() => {
    const parts: string[] = [];
    parts.push(`المخزن: ${selectedWarehouse?.code || ''}${selectedWarehouse?.name ? ` — ${selectedWarehouse?.name}` : ''}`);
    parts.push(`التجميع: ${groupBy === 'item' ? 'الصنف' : groupBy === 'category' ? 'الفئة' : groupBy === 'group' ? 'المجموعة' : 'المورد'}`);
    parts.push(`الفئة: ${selectedCategory === 'all' ? 'الكل' : getCategoryLabel(selectedCategory, 'ar')}`);
    parts.push(`المجموعة: ${selectedGroup === 'all' ? 'الكل' : getGroupLabel(selectedGroup, selectedCategory !== 'all' ? selectedCategory : undefined, 'ar')}`);
    parts.push(`المورد: ${selectedSupplierName}`);
    parts.push(`الحالة: ${stockFilter === 'all' ? 'الكل' : stockFilter === 'in' ? 'متوفر' : stockFilter === 'low' ? 'منخفض' : 'منعدم'}`);
    if (searchTerm.trim()) parts.push(`بحث: ${searchTerm.trim()}`);
    return parts.join(' • ');
  }, [getCategoryLabel, getGroupLabel, groupBy, searchTerm, selectedCategory, selectedGroup, selectedSupplierName, selectedWarehouse?.code, selectedWarehouse?.name, stockFilter]);

  const loadRowsForExport = async (): Promise<StockRow[]> => {
    const supabase = getSupabaseClient();
    if (!supabase || !warehouseId) return [];
    const { data, error: qErr } = await supabase.rpc('get_inventory_stock_report', {
      p_warehouse_id: warehouseId,
      p_category: selectedCategory === 'all' ? null : selectedCategory,
      p_group: selectedGroup === 'all' ? null : selectedGroup,
      p_supplier_id: selectedSupplier === 'all' ? null : selectedSupplier,
      p_stock_filter: stockFilter,
      p_search: searchTerm.trim() ? searchTerm.trim() : null,
      p_limit: 20000,
      p_offset: 0,
    } as any);
    if (qErr) throw qErr;
    return (Array.isArray(data) ? data : []).map((r: any) => {
      const itemId = String(r?.item_id || '');
      const nameJson = r?.item_name && typeof r.item_name === 'object' ? r.item_name : {};
      const name = String(nameJson?.ar || nameJson?.en || itemId);
      const supplierIds = Array.isArray(r?.supplier_ids) ? (r.supplier_ids as any[]).map(v => String(v)) : [];
      return {
        itemId,
        name,
        category: String(r?.category || ''),
        group: String(r?.item_group || ''),
        unit: String(r?.unit || 'piece'),
        currentStock: parseNumber(r?.current_stock),
        reservedStock: parseNumber(r?.reserved_stock),
        availableStock: parseNumber(r?.available_stock),
        lowStockThreshold: Math.max(0, parseNumber(r?.low_stock_threshold) || 5),
        supplierIds,
      } as StockRow;
    }).filter((r: StockRow) => Boolean(r.itemId));
  };

  const handleExportXlsx = async () => {
    try {
      const filename = `inventory_stock_${toYmdLocal(new Date())}.xlsx`;
      const periodText = filtersText;
      if (groupBy === 'item') {
        const headers = ['الصنف', 'الكود', 'الفئة', 'المجموعة', 'الوحدة', 'المخزون الحالي', 'محجوز', 'متاح'];
        const exportItems = await loadRowsForExport();
        const rows = exportItems.slice(0, 5000).map(r => ([
          r.name,
          r.itemId,
          r.category ? getCategoryLabel(r.category, 'ar') : 'غير مصنف',
          r.group ? getGroupLabel(r.group, r.category || undefined, 'ar') : '—',
          getUnitLabel(r.unit as any, 'ar'),
          Number(r.currentStock.toFixed(2)),
          Number(r.reservedStock.toFixed(2)),
          Number(r.availableStock.toFixed(2)),
        ]));
        const ok = await exportToXlsx(
          headers,
          rows,
          filename,
          { sheetName: 'Inventory', ...buildXlsxBrandOptions(settings, 'تقرير المخزون', headers.length, { periodText }) }
        );
        showNotification(ok ? 'تم حفظ التقرير في مجلد المستندات' : 'فشل تصدير الملف.', ok ? 'success' : 'error');
        return;
      }

      const headers = ['البند', 'عدد الأصناف', 'المخزون الحالي', 'محجوز', 'متاح'];
      const rows = aggregated.slice(0, 5000).map(r => ([
        r.label,
        r.itemsCount,
        Number(r.currentStock.toFixed(2)),
        Number(r.reservedStock.toFixed(2)),
        Number(r.availableStock.toFixed(2)),
      ]));
      const ok = await exportToXlsx(
        headers,
        rows,
        filename,
        { sheetName: 'Inventory', ...buildXlsxBrandOptions(settings, 'تقرير المخزون', headers.length, { periodText }) }
      );
      showNotification(ok ? 'تم حفظ التقرير في مجلد المستندات' : 'فشل تصدير الملف.', ok ? 'success' : 'error');
    } catch (e: any) {
      showNotification(String(e?.message || 'فشل تصدير الملف.'), 'error');
    }
  };

  const handleSharePdf = async () => {
    setIsSharing(true);
    const ok = await sharePdf(
      'inventory-stock-print-area',
      'تقرير المخزون',
      `inventory_stock_${toYmdLocal(new Date())}.pdf`,
      buildPdfBrandOptions(settings, `تقرير المخزون • ${filtersText}`, { pageNumbers: true })
    );
    showNotification(ok ? 'تم حفظ التقرير في مجلد المستندات' : 'فشل مشاركة الملف.', ok ? 'success' : 'error');
    setIsSharing(false);
  };

  const handlePrintPdf = async () => {
    const ok = await printPdfFromElement(
      'inventory-stock-print-area',
      'تقرير المخزون',
      buildPdfBrandOptions(settings, `تقرير المخزون • ${filtersText}`, { pageNumbers: true })
    );
    if (!ok) {
      showNotification('تعذر الطباعة على هذا الجهاز. استخدم PDF للمشاركة.', 'error');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-l from-primary-600 to-gold-500">تقرير المخزون</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExportXlsx()}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60"
            disabled={loading || (groupBy === 'item' ? filteredRows.length === 0 : aggregated.length === 0)}
          >
            تصدير Excel
          </button>
          <button
            type="button"
            onClick={() => void handleSharePdf()}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60"
            disabled={loading || isSharing || (groupBy === 'item' ? filteredRows.length === 0 : aggregated.length === 0)}
          >
            PDF
          </button>
          <button
            type="button"
            onClick={() => void handlePrintPdf()}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60"
            disabled={loading || (groupBy === 'item' ? filteredRows.length === 0 : aggregated.length === 0)}
          >
            طباعة
          </button>
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-300">
          <span className="font-semibold">المخزن:</span> <span className="font-mono">{selectedWarehouse?.code || ''}</span> {selectedWarehouse?.name ? `— ${selectedWarehouse?.name}` : ''}
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تجميع حسب</label>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="item">الصنف</option>
              <option value="category">الفئة</option>
              <option value="group">المجموعة</option>
              <option value="supplier">المورد</option>
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">المورد</label>
            <select
              value={selectedSupplier}
              onChange={(e) => setSelectedSupplier(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {supplierOptions.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
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
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">بحث</label>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="اسم الصنف أو الكود..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex items-end justify-end">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              <span className="font-semibold">عدد السطور:</span>{' '}
              <span className="font-mono">
                {groupBy === 'item' ? `${filteredRows.length} / ${totalCount || filteredRows.length}` : aggregated.length}
              </span>
            </div>
          </div>
        </div>
        {groupBy === 'item' && (totalCount || 0) > pageSize && (
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">
              Page {page} / {Math.max(1, Math.ceil((totalCount || 1) / pageSize))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
                disabled={loading || page <= 1}
              >
                السابق
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
                disabled={loading || page >= Math.max(1, Math.ceil((totalCount || 1) / pageSize))}
              >
                التالي
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            {error}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          {groupBy === 'item' ? (
            <table className="w-full text-right">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الصنف</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الفئة</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">المجموعة</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الوحدة</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">طبقات التكلفة</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">المخزون الحالي</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">محجوز</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300">متاح</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {(loading ? [] : filteredRows).map((row) => (
                  <tr key={row.itemId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="p-3 border-r dark:border-gray-700">
                      <div className="font-semibold dark:text-white">{row.name}</div>
                      <div className="text-xs text-gray-500 font-mono">{row.itemId}</div>
                    </td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">{row.category ? getCategoryLabel(row.category, 'ar') : 'غير مصنف'}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">
                      {row.group ? getGroupLabel(row.group, row.category || undefined, 'ar') : '—'}
                    </td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">{getUnitLabel(row.unit as any, 'ar')}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">
                      {(() => {
                        const s = costSummaryByItemId[row.itemId];
                        if (!s) return <span className="text-gray-400">—</span>;
                        const multi = (s.distinctCosts || 0) > 1;
                        const label = `${s.distinctCosts || 0} سعر • ${s.layersCount || 0} دفعة`;
                        return (
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold border ${multi ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-900' : 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/20 dark:text-gray-200 dark:border-gray-800'}`}>
                              {label}
                            </span>
                            <button
                              type="button"
                              onClick={() => { void openCostModal(row); }}
                              className="px-3 py-1 rounded-lg text-xs font-semibold bg-white border border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700"
                            >
                              عرض
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">{row.currentStock.toFixed(2)}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">{row.reservedStock.toFixed(2)}</td>
                    <td className={`p-3 font-mono ${row.availableStock <= 0 ? 'text-red-600' : row.availableStock <= row.lowStockThreshold ? 'text-orange-600' : 'text-green-600'}`} dir="ltr">
                      {row.availableStock.toFixed(2)}
                    </td>
                  </tr>
                ))}
                {loading && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-gray-500 dark:text-gray-400">جاري التحميل...</td>
                  </tr>
                )}
                {!loading && filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-gray-500 dark:text-gray-400">لا توجد نتائج.</td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-right">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">البند</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">عدد الأصناف</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">المخزون الحالي</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">محجوز</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300">متاح</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {(loading ? [] : aggregated).map((row) => (
                  <tr key={row.key} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="p-3 border-r dark:border-gray-700 font-semibold dark:text-white">{row.label}</td>
                    <td className="p-3 border-r dark:border-gray-700 text-gray-700 dark:text-gray-200 font-mono" dir="ltr">{row.itemsCount}</td>
                    <td className="p-3 border-r dark:border-gray-700 text-gray-700 dark:text-gray-200 font-mono" dir="ltr">{row.currentStock.toFixed(2)}</td>
                    <td className="p-3 border-r dark:border-gray-700 text-gray-700 dark:text-gray-200 font-mono" dir="ltr">{row.reservedStock.toFixed(2)}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 font-mono" dir="ltr">{row.availableStock.toFixed(2)}</td>
                  </tr>
                ))}
                {loading && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-gray-500 dark:text-gray-400">جاري التحميل...</td>
                  </tr>
                )}
                {!loading && aggregated.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-gray-500 dark:text-gray-400">لا توجد نتائج.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="fixed left-[-10000px] top-0 w-[900px] bg-white text-black p-6" id="inventory-stock-print-area">
        <div className="mb-4 space-y-1">
          <div className="text-xl font-bold">{settings.cafeteriaName?.ar || 'تقارير'}</div>
          <div className="text-sm text-gray-700">تقرير المخزون</div>
          <div className="text-xs text-gray-600">{filtersText}</div>
          <div className="text-xs text-gray-600" dir="ltr">{new Date().toLocaleString('ar-EG-u-nu-latn')}</div>
        </div>
        {groupBy === 'item' ? (
          <table className="w-full text-right">
            <thead>
              <tr>
                <th className="p-2 border">الصنف</th>
                <th className="p-2 border">الفئة</th>
                <th className="p-2 border">المجموعة</th>
                <th className="p-2 border">الوحدة</th>
                <th className="p-2 border">المخزون الحالي</th>
                <th className="p-2 border">محجوز</th>
                <th className="p-2 border">متاح</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.slice(0, 200).map((row) => (
                <tr key={row.itemId}>
                  <td className="p-2 border">{row.name}</td>
                  <td className="p-2 border">{row.category ? getCategoryLabel(row.category, 'ar') : 'غير مصنف'}</td>
                  <td className="p-2 border">{row.group ? getGroupLabel(row.group, row.category || undefined, 'ar') : '—'}</td>
                  <td className="p-2 border">{getUnitLabel(row.unit as any, 'ar')}</td>
                  <td className="p-2 border" dir="ltr">{row.currentStock.toFixed(2)}</td>
                  <td className="p-2 border" dir="ltr">{row.reservedStock.toFixed(2)}</td>
                  <td className="p-2 border" dir="ltr">{row.availableStock.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-right">
            <thead>
              <tr>
                <th className="p-2 border">البند</th>
                <th className="p-2 border">عدد الأصناف</th>
                <th className="p-2 border">المخزون الحالي</th>
                <th className="p-2 border">محجوز</th>
                <th className="p-2 border">متاح</th>
              </tr>
            </thead>
            <tbody>
              {aggregated.slice(0, 200).map((row) => (
                <tr key={row.key}>
                  <td className="p-2 border">{row.label}</td>
                  <td className="p-2 border" dir="ltr">{row.itemsCount}</td>
                  <td className="p-2 border" dir="ltr">{row.currentStock.toFixed(2)}</td>
                  <td className="p-2 border" dir="ltr">{row.reservedStock.toFixed(2)}</td>
                  <td className="p-2 border" dir="ltr">{row.availableStock.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {costModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <div className="font-bold dark:text-white">{costModalTitle}</div>
              <button
                type="button"
                onClick={() => { setCostModalOpen(false); setCostModalRows([]); }}
                className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold"
              >
                إغلاق
              </button>
            </div>
            <div className="p-4">
              {costModalBusy ? (
                <div className="text-center text-gray-500 dark:text-gray-400 py-10">جاري التحميل...</div>
              ) : costModalRows.length === 0 ? (
                <div className="text-center text-gray-500 dark:text-gray-400 py-10">لا توجد دفعات متاحة.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>
                        <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الدفعة</th>
                        <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">انتهاء</th>
                        <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">متبقي</th>
                        <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">تكلفة/وحدة</th>
                        <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">أمر شراء</th>
                        <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">شحنة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {costModalRows.map((r) => (
                        <tr key={r.batchId}>
                          <td className="p-2 border-r dark:border-gray-700 font-mono">{r.batchCode || r.batchId.slice(-6).toUpperCase()}</td>
                          <td className="p-2 border-r dark:border-gray-700 font-mono" dir="ltr">{r.expiryDate || '—'}</td>
                          <td className="p-2 border-r dark:border-gray-700 font-mono" dir="ltr">{Number(r.remainingQty || 0).toFixed(2)}</td>
                          <td className="p-2 border-r dark:border-gray-700 font-mono" dir="ltr">{Number(r.unitCost || 0).toFixed(4)}</td>
                          <td className="p-2 border-r dark:border-gray-700 font-mono">{r.purchaseOrderRef || '—'}</td>
                          <td className="p-2 font-mono">{r.importShipmentRef || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryStockReportScreen;
