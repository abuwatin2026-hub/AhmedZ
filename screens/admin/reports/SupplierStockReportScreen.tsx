import React, { useEffect, useMemo, useState } from 'react';
import { useMenu } from '../../../contexts/MenuContext';
import { useItemMeta } from '../../../contexts/ItemMetaContext';
import { useWarehouses } from '../../../contexts/WarehouseContext';
import { useSessionScope } from '../../../contexts/SessionScopeContext';
import { usePurchases } from '../../../contexts/PurchasesContext';
import { useSettings } from '../../../contexts/SettingsContext';
import { useToast } from '../../../contexts/ToastContext';
import { exportToXlsx } from '../../../utils/export';
import { buildXlsxBrandOptions } from '../../../utils/branding';
import { toYmdLocal } from '../../../utils/dateUtils';
import { getSupabaseClient } from '../../../supabase';
import type { MenuItem } from '../../../types';

type SupplierStockRow = {
  itemId: string;
  name: string;
  category: string;
  group: string;
  unit: string;
  currentStock: number;
  qcHold: number;
  reservedStock: number;
  availableToSell: number;
  lowStockThreshold: number;
  supplierIds: string[];
};

const parseNumber = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const SupplierStockReportScreen: React.FC = () => {
  const { menuItems } = useMenu();
  const { categories: categoryDefs, groups: groupDefs, getCategoryLabel, getGroupLabel, getUnitLabel } = useItemMeta();
  const { warehouses } = useWarehouses();
  const { scope } = useSessionScope();
  const { suppliers } = usePurchases();
  const { settings } = useSettings();
  const { showNotification } = useToast();

  const [warehouseId, setWarehouseId] = useState<string>('');
  const [selectedSupplier, setSelectedSupplier] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'low' | 'out'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [stockByItemId, setStockByItemId] = useState<Record<string, { currentStock: number; qcHold: number; reservedStock: number; unit: string; lowStockThreshold: number }>>({});
  const [supplierIdsByItemId, setSupplierIdsByItemId] = useState<Record<string, string[]>>({});

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
        const { data, error: qErr } = await supabase
          .from('stock_management')
          .select('item_id,available_quantity,qc_hold_quantity,reserved_quantity,unit,low_stock_threshold')
          .eq('warehouse_id', warehouseId)
          .limit(10000);
        if (qErr) throw qErr;
        const map: Record<string, { currentStock: number; qcHold: number; reservedStock: number; unit: string; lowStockThreshold: number }> = {};
        for (const r of Array.isArray(data) ? data : []) {
          const itemId = String((r as any)?.item_id || '');
          if (!itemId) continue;
          map[itemId] = {
            currentStock: parseNumber((r as any)?.available_quantity),
            qcHold: parseNumber((r as any)?.qc_hold_quantity),
            reservedStock: parseNumber((r as any)?.reserved_quantity),
            unit: String((r as any)?.unit || 'piece'),
            lowStockThreshold: Math.max(0, parseNumber((r as any)?.low_stock_threshold) || 5),
          };
        }
        if (active) setStockByItemId(map);
      } catch (e: any) {
        const msg = String(e?.message || '');
        if (active) setError(msg || 'فشل تحميل بيانات المخزون.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [warehouseId]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      try {
        const { data, error: qErr } = await supabase
          .from('supplier_items')
          .select('supplier_id,item_id,is_active')
          .eq('is_active', true)
          .limit(20000);
        if (qErr) throw qErr;
        const map: Record<string, string[]> = {};
        for (const r of Array.isArray(data) ? data : []) {
          const itemId = String((r as any)?.item_id || '');
          const supplierId = String((r as any)?.supplier_id || '');
          if (!itemId || !supplierId) continue;
          map[itemId] = map[itemId] ? Array.from(new Set([...map[itemId], supplierId])) : [supplierId];
        }
        if (active) setSupplierIdsByItemId(map);
      } catch {
        if (active) setSupplierIdsByItemId({});
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, []);

  const supplierOptions = useMemo(() => {
    const list = [...(suppliers || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return [{ id: 'all', name: 'الكل' }, ...list.map(s => ({ id: s.id, name: s.name }))];
  }, [suppliers]);

  const categoryOptions = useMemo(() => {
    const activeKeys = categoryDefs.filter(c => c.isActive).map(c => String(c.key));
    const usedKeys = [...new Set(menuItems.map(it => String((it as any)?.category || '')).filter((v) => v.length > 0))];
    const merged = Array.from(new Set([...activeKeys, ...usedKeys])).sort((a, b) => a.localeCompare(b));
    return ['all', ...merged];
  }, [categoryDefs, menuItems]);

  const groupOptions = useMemo(() => {
    const activeKeys = groupDefs.filter(g => g.isActive).map(g => String(g.key));
    const usedKeys = [...new Set(menuItems.map((it: any) => String(it?.group || '')).filter(Boolean))];
    const merged = Array.from(new Set([...activeKeys, ...usedKeys])).sort((a, b) => a.localeCompare(b));
    return ['all', ...merged];
  }, [groupDefs, menuItems]);

  const rows = useMemo<SupplierStockRow[]>(() => {
    const needle = searchTerm.trim().toLowerCase();
    return (menuItems || [])
      .filter((it: MenuItem) => String(it?.status || 'active') === 'active')
      .map((it: any) => {
        const itemId = String(it?.id || '');
        if (!itemId) return null;
        const supplierIds = supplierIdsByItemId[itemId] || [];
        if (selectedSupplier !== 'all' && !supplierIds.includes(selectedSupplier)) return null;
        const name = String(it?.name?.ar || it?.name?.en || itemId);
        const category = String(it?.category || '');
        const group = String(it?.group || '');
        const stock = stockByItemId[itemId];
        const currentStock = parseNumber(stock?.currentStock);
        const qcHold = parseNumber(stock?.qcHold);
        const reservedStock = parseNumber(stock?.reservedStock);
        const availableToSell = currentStock - reservedStock;
        const lowStockThreshold = Math.max(0, parseNumber(stock?.lowStockThreshold) || 5);
        const unit = String(stock?.unit || it?.unitType || 'piece');
        const normalized: SupplierStockRow = {
          itemId,
          name,
          category,
          group,
          unit,
          currentStock,
          qcHold,
          reservedStock,
          availableToSell,
          lowStockThreshold,
          supplierIds,
        };
        if (selectedCategory !== 'all' && normalized.category !== selectedCategory) return null;
        if (selectedGroup !== 'all' && normalized.group !== selectedGroup) return null;
        if (needle && !normalized.name.toLowerCase().includes(needle) && !normalized.itemId.toLowerCase().includes(needle)) return null;
        if (stockFilter === 'in') return normalized.availableToSell > normalized.lowStockThreshold ? normalized : null;
        if (stockFilter === 'low') return normalized.availableToSell > 0 && normalized.availableToSell <= normalized.lowStockThreshold ? normalized : null;
        if (stockFilter === 'out') return normalized.availableToSell <= 0 ? normalized : null;
        return normalized;
      })
      .filter(Boolean) as SupplierStockRow[];
  }, [menuItems, searchTerm, selectedSupplier, selectedCategory, selectedGroup, stockFilter, stockByItemId, supplierIdsByItemId]);

  const selectedWarehouse = useMemo(() => warehouses.find(w => String(w.id) === String(warehouseId)), [warehouses, warehouseId]);
  const selectedSupplierName = useMemo(() => {
    if (selectedSupplier === 'all') return 'الكل';
    return suppliers.find(s => String(s.id) === String(selectedSupplier))?.name || selectedSupplier;
  }, [selectedSupplier, suppliers]);

  const summary = useMemo(() => {
    let inCount = 0;
    let lowCount = 0;
    let outCount = 0;
    let currentTotal = 0;
    let qcTotal = 0;
    let reservedTotal = 0;
    let availableTotal = 0;
    for (const r of rows) {
      currentTotal += r.currentStock;
      qcTotal += r.qcHold;
      reservedTotal += r.reservedStock;
      availableTotal += r.availableToSell;
      if (r.availableToSell <= 0) outCount += 1;
      else if (r.availableToSell <= r.lowStockThreshold) lowCount += 1;
      else inCount += 1;
    }
    return { inCount, lowCount, outCount, currentTotal, qcTotal, reservedTotal, availableTotal };
  }, [rows]);

  const handleExport = async () => {
    const headers = [
      'المورد',
      'الصنف',
      'الفئة',
      'المجموعة',
      'الوحدة',
      'المخزون الحالي',
      'تحت QC',
      'محجوز',
      'متاح للبيع',
      'حد التنبيه',
      'كمية مقترحة للتوريد',
    ];
    const nameBySupplierId = new Map<string, string>((suppliers || []).map(s => [String(s.id), String(s.name || s.id)]));
    const exportRows = rows.slice(0, 5000).map((r) => {
      const supplierLabel = selectedSupplier !== 'all'
        ? selectedSupplierName
        : (r.supplierIds || []).map(id => nameBySupplierId.get(String(id)) || String(id)).filter(Boolean).join('، ') || '—';
      const suggested = Math.max(0, (r.lowStockThreshold || 0) - r.availableToSell);
      return [
        supplierLabel,
        r.name,
        r.category ? getCategoryLabel(r.category, 'ar') : 'غير مصنف',
        r.group ? getGroupLabel(r.group, r.category || undefined, 'ar') : '—',
        getUnitLabel(r.unit as any, 'ar'),
        Number(r.currentStock.toFixed(2)),
        Number(r.qcHold.toFixed(2)),
        Number(r.reservedStock.toFixed(2)),
        Number(r.availableToSell.toFixed(2)),
        Number((r.lowStockThreshold || 0).toFixed(2)),
        Number(suggested.toFixed(2)),
      ];
    });
    const filename = `supplier_stock_${selectedSupplier === 'all' ? 'all' : selectedSupplier}_${toYmdLocal(new Date())}.xlsx`;
    const ok = await exportToXlsx(
      headers,
      exportRows,
      filename,
      { sheetName: 'Supplier Stock', ...buildXlsxBrandOptions(settings, 'مخزون الموردين', headers.length, { periodText: `المورد: ${selectedSupplierName} • المخزن: ${selectedWarehouse?.code || ''} ${selectedWarehouse?.name || ''}` }) }
    );
    showNotification(ok ? 'تم حفظ التقرير في مجلد المستندات' : 'فشل تصدير الملف.', ok ? 'success' : 'error');
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
            disabled={loading || rows.length === 0}
          >
            تصدير Excel
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
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
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
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">تحت QC</th>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">محجوز</th>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">متاح للبيع</th>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">حد التنبيه</th>
                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300">التوريد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {(loading ? [] : rows).map((r) => {
                const statusColor = r.availableToSell <= 0 ? 'text-red-600' : r.availableToSell <= r.lowStockThreshold ? 'text-orange-600' : 'text-green-600';
                const suggested = Math.max(0, (r.lowStockThreshold || 0) - r.availableToSell);
                const supplyText = suggested > 0 ? `مطلوب +${suggested.toFixed(2)}` : '—';
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
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">{r.qcHold.toFixed(2)}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">{r.reservedStock.toFixed(2)}</td>
                    <td className={`p-3 border-r dark:border-gray-700 font-mono ${statusColor}`} dir="ltr">{r.availableToSell.toFixed(2)}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">{(r.lowStockThreshold || 0).toFixed(2)}</td>
                    <td className={`p-3 font-semibold ${suggested > 0 ? 'text-orange-700 dark:text-orange-400' : 'text-gray-500 dark:text-gray-400'}`} dir="ltr">{supplyText}</td>
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
                  <td colSpan={10} className="p-8 text-center text-gray-500 dark:text-gray-400">لا توجد نتائج.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SupplierStockReportScreen;
