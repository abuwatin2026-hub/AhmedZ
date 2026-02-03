import React, { useEffect, useMemo, useState } from 'react';
import { getBaseCurrencyCode, getSupabaseClient } from '../../supabase';
import { useMenu } from '../../contexts/MenuContext';
import { useWarehouses } from '../../contexts/WarehouseContext';
import { useToast } from '../../contexts/ToastContext';
import type { MenuItem } from '../../types';

const WastageScreen: React.FC = () => {
  const supabase = getSupabaseClient();
  const { menuItems } = useMenu();
  const { warehouses } = useWarehouses();
  const { showNotification } = useToast();
  const [baseCode, setBaseCode] = useState('—');
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [batches, setBatches] = useState<Array<{ batchId: string; unitCost: number; expiryDate?: string }>>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(0);
  const [unit, setUnit] = useState<string>('piece');
  const [reason, setReason] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    void getBaseCurrencyCode().then((c) => {
      if (!c) return;
      setBaseCode(c);
    });
  }, []);

  const itemsSorted = useMemo(() => {
    return [...(menuItems || [])].sort((a: MenuItem, b: MenuItem) => {
      const an = (a.name?.ar || a.name?.en || a.id || '').toString();
      const bn = (b.name?.ar || b.name?.en || b.id || '').toString();
      return an.localeCompare(bn, 'ar');
    });
  }, [menuItems]);

  const loadBatches = async () => {
    if (!supabase || !selectedItemId) {
      setBatches([]);
      return;
    }
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('inventory_movements')
        .select('batch_id, unit_cost, data, occurred_at')
        .eq('item_id', selectedItemId)
        .eq('movement_type', 'purchase_in')
        .order('occurred_at', { ascending: true });
      if (error) throw error;
      const list = (data || [])
        .map((row: any) => ({
          batchId: row.batch_id,
          unitCost: Number(row.unit_cost) || 0,
          expiryDate: typeof row?.data?.expiryDate === 'string' ? row.data.expiryDate : undefined,
        }))
        .filter(r => typeof r.batchId === 'string' && r.batchId.length > 0);
      setBatches(list);
    } catch {
      setBatches([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedBatchId('');
    void loadBatches();
  }, [selectedItemId]);

  const submitWastage = async () => {
    if (!supabase) return;
    if (!selectedItemId || !selectedWarehouseId || !(quantity > 0) || !reason.trim()) {
      showNotification('الرجاء إدخال جميع البيانات المطلوبة', 'error');
      return;
    }
    try {
      setLoading(true);
      const { error } = await supabase.rpc('record_wastage_light', {
        p_item_id: selectedItemId,
        p_warehouse_id: selectedWarehouseId,
        p_batch_id: selectedBatchId || null,
        p_quantity: quantity,
        p_unit: unit,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      showNotification('تم تسجيل الهدر بنجاح', 'success');
      setQuantity(0);
      setReason('');
    } catch {
      showNotification('فشل تسجيل الهدر', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
      <h1 className="text-2xl font-bold mb-4 dark:text-white">تسجيل هدر</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">الصنف</label>
          <select
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
            className="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="">اختر صنفًا</option>
            {itemsSorted.map(item => (
              <option key={item.id} value={item.id}>{item.name?.ar || item.name?.en || item.id}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">المخزن</label>
          <select
            value={selectedWarehouseId}
            onChange={(e) => setSelectedWarehouseId(e.target.value)}
            className="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="">اختر مخزنًا</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">الدفعة (اختياري)</label>
          <select
            value={selectedBatchId}
            onChange={(e) => setSelectedBatchId(e.target.value)}
            className="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            disabled={!selectedItemId || loading}
          >
            <option value="">بدون</option>
            {batches.map(b => (
              <option key={b.batchId} value={b.batchId}>
                {b.batchId.slice(0,8)} • تكلفة {b.unitCost.toFixed(2)} {baseCode || '—'} • {b.expiryDate ? `انتهاء ${b.expiryDate}` : 'بدون انتهاء'}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">الكمية</label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value) || 0)}
              className="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">الوحدة</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="piece">قطعة</option>
              <option value="kg">كغ</option>
              <option value="gram">غ</option>
              <option value="bundle">ربطة</option>
            </select>
          </div>
        </div>
      </div>
      <div className="mt-4">
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">السبب</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          placeholder="مثال: انتهاء صلاحية، تلف أثناء التخزين..."
        />
      </div>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={submitWastage}
          disabled={loading || !selectedItemId || !selectedWarehouseId || !(quantity > 0) || !reason.trim()}
          className="px-5 py-3 rounded-lg bg-red-600 text-white font-bold disabled:opacity-50"
        >
          تسجيل هدر
        </button>
        <span className="text-xs text-gray-500 dark:text-gray-400">{loading ? 'جاري التنفيذ...' : ''}</span>
      </div>
    </div>
  );
};

export default WastageScreen;
