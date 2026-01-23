import React, { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useWarehouses } from '../../contexts/WarehouseContext';
import { useToast } from '../../contexts/ToastContext';

const ExpiryBatchesScreen: React.FC = () => {
  const supabase = getSupabaseClient();
  const { warehouses } = useWarehouses();
  const { showNotification } = useToast();
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [expired, setExpired] = useState<Array<{ itemId: string; batchId: string; expiryDate: string }>>([]);
  const [processing, setProcessing] = useState(false);

  const whSorted = useMemo(() => {
    return [...warehouses].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [warehouses]);

  const loadExpired = async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from('inventory_movements')
        .select('item_id, batch_id, data, occurred_at')
        .eq('movement_type', 'purchase_in')
        .not('data->>expiryDate', 'is', null);
      if (error) throw error;
      const today = new Date();
      const list = (data || [])
        .map((row: any) => ({
          itemId: String(row.item_id),
          batchId: String(row.batch_id || ''),
          expiryDate: String(row?.data?.expiryDate || ''),
        }))
        .filter(r => r.batchId && r.expiryDate)
        .filter(r => {
          const d = new Date(r.expiryDate);
          return !Number.isNaN(d.getTime()) && d <= today;
        });
      setExpired(list);
    } catch {
      setExpired([]);
    }
  };

  useEffect(() => {
    void loadExpired();
  }, []);

  const processAll = async () => {
    if (!supabase || !selectedWarehouseId) {
      showNotification('اختر المخزن أولاً', 'error');
      return;
    }
    try {
      setProcessing(true);
      const { data, error } = await supabase.rpc('process_expiry_light', {
        p_warehouse_id: selectedWarehouseId,
      });
      if (error) throw error;
      const count = Number(data || 0);
      showNotification(`تم تفريغ ${count} دفعات منتهية كهدر`, 'success');
      await loadExpired();
    } catch {
      showNotification('فشل معالجة الانتهاء', 'error');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
      <h1 className="text-2xl font-bold mb-4 dark:text-white">تفريغ الدُفعات المنتهية</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">المخزن</label>
          <select
            value={selectedWarehouseId}
            onChange={(e) => setSelectedWarehouseId(e.target.value)}
            className="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="">اختر مخزنًا</option>
            {whSorted.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mb-4">
        <button
          type="button"
          onClick={processAll}
          disabled={processing || !selectedWarehouseId}
          className="px-5 py-3 rounded-lg bg-amber-600 text-white font-bold disabled:opacity-50"
        >
          تفريغ جميع الدُفعات المنتهية كهدر
        </button>
      </div>
      <div className="mt-6">
        <div className="text-sm font-semibold mb-2 dark:text-white">دفعات منتهية (إجمالي: {expired.length})</div>
        <div className="grid grid-cols-1 gap-2">
          {expired.map((b, idx) => (
            <div key={`${b.batchId}-${idx}`} className="p-3 rounded-lg border dark:border-gray-700">
              <div className="text-sm dark:text-white">الصنف: {b.itemId.slice(-6).toUpperCase()}</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">الدفعة: {b.batchId}</div>
              <div className="text-xs text-red-600 dark:text-red-400">انتهاء: {b.expiryDate}</div>
            </div>
          ))}
          {expired.length === 0 && (
            <div className="text-sm text-gray-600 dark:text-gray-300">لا توجد دفعات منتهية حالياً</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExpiryBatchesScreen;
