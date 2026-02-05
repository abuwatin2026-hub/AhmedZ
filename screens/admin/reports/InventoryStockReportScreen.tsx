import React, { useEffect, useMemo, useState } from 'react';
import { useMenu } from '../../../contexts/MenuContext';
import { useItemMeta } from '../../../contexts/ItemMetaContext';
import { useWarehouses } from '../../../contexts/WarehouseContext';
import { useSessionScope } from '../../../contexts/SessionScopeContext';
import { usePurchases } from '../../../contexts/PurchasesContext';
import { getSupabaseClient } from '../../../supabase';
import type { MenuItem } from '../../../types';

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

const parseNumber = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const InventoryStockReportScreen: React.FC = () => {
  const { menuItems } = useMenu();
  const { categories: categoryDefs, groups: groupDefs, getCategoryLabel, getGroupLabel, getUnitLabel } = useItemMeta();
  const { warehouses } = useWarehouses();
  const { scope } = useSessionScope();
  const { suppliers } = usePurchases();

  const [warehouseId, setWarehouseId] = useState<string>('');
  const [groupBy, setGroupBy] = useState<'item' | 'category' | 'group' | 'supplier'>('item');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedSupplier, setSelectedSupplier] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'low' | 'out'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [stockByItemId, setStockByItemId] = useState<Record<string, { currentStock: number; reservedStock: number; unit: string; lowStockThreshold: number }>>({});
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
          .select('item_id,available_quantity,reserved_quantity,unit,low_stock_threshold')
          .eq('warehouse_id', warehouseId)
          .limit(10000);
        if (qErr) throw qErr;
        const map: Record<string, { currentStock: number; reservedStock: number; unit: string; lowStockThreshold: number }> = {};
        for (const r of Array.isArray(data) ? data : []) {
          const itemId = String((r as any)?.item_id || '');
          if (!itemId) continue;
          map[itemId] = {
            currentStock: parseNumber((r as any)?.available_quantity),
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

  const supplierOptions = useMemo(() => {
    const list = [...(suppliers || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return [{ id: 'all', name: 'الكل' }, ...list.map(s => ({ id: s.id, name: s.name }))];
  }, [suppliers]);

  const filteredRows = useMemo<StockRow[]>(() => {
    const needle = searchTerm.trim().toLowerCase();
    return (menuItems || [])
      .filter((it: MenuItem) => String(it?.status || 'active') === 'active')
      .map((it: any) => {
        const itemId = String(it?.id || '');
        if (!itemId) return null;
        const name = String(it?.name?.ar || it?.name?.en || itemId);
        const category = String(it?.category || '');
        const group = String(it?.group || '');
        const stock = stockByItemId[itemId];
        const currentStock = parseNumber(stock?.currentStock);
        const reservedStock = parseNumber(stock?.reservedStock);
        const availableStock = currentStock - reservedStock;
        const supplierIds = supplierIdsByItemId[itemId] || [];
        return {
          itemId,
          name,
          category,
          group,
          unit: String(stock?.unit || it?.unitType || 'piece'),
          currentStock,
          reservedStock,
          availableStock,
          lowStockThreshold: Math.max(0, parseNumber(stock?.lowStockThreshold) || 5),
          supplierIds,
        } as StockRow;
      })
      .filter((row): row is StockRow => Boolean(row))
      .filter((row: StockRow) => {
        if (selectedCategory !== 'all' && row.category !== selectedCategory) return false;
        if (selectedGroup !== 'all' && row.group !== selectedGroup) return false;
        if (selectedSupplier !== 'all' && !row.supplierIds.includes(selectedSupplier)) return false;
        if (needle && !row.name.toLowerCase().includes(needle) && !row.itemId.toLowerCase().includes(needle)) return false;
        if (stockFilter === 'in') return row.availableStock > row.lowStockThreshold;
        if (stockFilter === 'low') return row.availableStock > 0 && row.availableStock <= row.lowStockThreshold;
        if (stockFilter === 'out') return row.availableStock <= 0;
        return true;
      }) as StockRow[];
  }, [menuItems, searchTerm, selectedCategory, selectedGroup, selectedSupplier, stockFilter, stockByItemId, supplierIdsByItemId]);

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

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-l from-primary-600 to-gold-500">تقرير المخزون</h1>
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
              <span className="font-mono">{groupBy === 'item' ? filteredRows.length : aggregated.length}</span>
            </div>
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
          {groupBy === 'item' ? (
            <table className="w-full text-right">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الصنف</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الفئة</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">المجموعة</th>
                  <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الوحدة</th>
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
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">{row.currentStock.toFixed(2)}</td>
                    <td className="p-3 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">{row.reservedStock.toFixed(2)}</td>
                    <td className={`p-3 font-mono ${row.availableStock <= 0 ? 'text-red-600' : row.availableStock <= row.lowStockThreshold ? 'text-orange-600' : 'text-green-600'}`} dir="ltr">
                      {row.availableStock.toFixed(2)}
                    </td>
                  </tr>
                ))}
                {loading && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-500 dark:text-gray-400">جاري التحميل...</td>
                  </tr>
                )}
                {!loading && filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-500 dark:text-gray-400">لا توجد نتائج.</td>
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
    </div>
  );
};

export default InventoryStockReportScreen;
