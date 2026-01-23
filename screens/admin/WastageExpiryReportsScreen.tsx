import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import type { AccountingLightEntry } from '../../types';
import { useToast } from '../../contexts/ToastContext';

const WastageExpiryReportsScreen: React.FC = () => {
  const supabase = getSupabaseClient();
  const [entries, setEntries] = useState<AccountingLightEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'wastage' | 'expiry'>('all');
  const { showNotification } = useToast();

  const load = async () => {
    if (!supabase) return;
    try {
      setLoading(true);
      let query = supabase.from('accounting_light_entries').select('*').order('occurred_at', { ascending: false }).limit(200);
      if (filterType !== 'all') {
        query = query.eq('entry_type', filterType);
      }
      const { data, error } = await query;
      if (error) throw error;
      const list: AccountingLightEntry[] = (data || []).map((row: any) => ({
        id: String(row.id),
        entryType: (String(row.entry_type) === 'wastage' ? 'wastage' : 'expiry'),
        itemId: String(row.item_id),
        warehouseId: row.warehouse_id ? String(row.warehouse_id) : undefined,
        batchId: row.batch_id ? String(row.batch_id) : undefined,
        quantity: Number(row.quantity || 0),
        unit: row.unit ? String(row.unit) : undefined,
        unitCost: Number(row.unit_cost || 0),
        totalCost: Number(row.total_cost || 0),
        occurredAt: String(row.occurred_at),
        debitAccount: String(row.debit_account || ''),
        creditAccount: String(row.credit_account || ''),
        createdBy: row.created_by ? String(row.created_by) : undefined,
        createdAt: String(row.created_at),
        notes: row.notes ? String(row.notes) : undefined,
        sourceRef: row.source_ref ? String(row.source_ref) : undefined,
      }));
      setEntries(list);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [filterType]);

  const exportCsv = () => {
    const headers = [
      'التاريخ',
      'النوع',
      'الصنف',
      'المخزن',
      'الدفعة',
      'الكمية',
      'التكلفة/وحدة',
      'الإجمالي',
      'مدين',
      'دائن',
      'ملاحظة',
    ];
    const rows = entries.map(e => [
      new Date(e.occurredAt).toISOString(),
      e.entryType,
      e.itemId,
      e.warehouseId || '',
      e.batchId || '',
      String(e.quantity),
      String(e.unitCost),
      String(e.totalCost),
      e.debitAccount,
      e.creditAccount,
      (e.notes || '').replace(/\r?\n/g, ' '),
    ]);
    const escape = (v: string) => {
      const needsQuote = /[",\n]/.test(v);
      const s = v.replace(/"/g, '""');
      return needsQuote ? `"${s}"` : s;
    };
    const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date();
      const name = `wastage-expiry-report-${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}.csv`;
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showNotification('تم تصدير التقرير إلى CSV', 'success');
    } catch {
      showNotification('فشل تصدير CSV', 'error');
    }
  };

  return (
    <div className="max-w-5xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
      <h1 className="text-2xl font-bold mb-4 dark:text-white">تقارير الهدر والانتهاء (قيود خفيفة)</h1>
      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">النوع</label>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as any)}
          className="p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
        >
          <option value="all">الكل</option>
          <option value="wastage">هدر</option>
          <option value="expiry">انتهاء</option>
        </select>
        {loading && <span className="text-xs text-gray-500 dark:text-gray-400">جاري التحميل...</span>}
        <div className="flex-1" />
        <button
          type="button"
          onClick={exportCsv}
          className="px-4 py-2 rounded-lg bg-green-600 text-white font-bold"
          disabled={entries.length === 0}
        >
          تصدير CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-700">
              <th className="p-2">التاريخ</th>
              <th className="p-2">النوع</th>
              <th className="p-2">الصنف</th>
              <th className="p-2">المخزن</th>
              <th className="p-2">الدفعة</th>
              <th className="p-2">الكمية</th>
              <th className="p-2">التكلفة/وحدة</th>
              <th className="p-2">الإجمالي</th>
              <th className="p-2">مدين</th>
              <th className="p-2">دائن</th>
              <th className="p-2">ملاحظة</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} className="border-b dark:border-gray-700">
                <td className="p-2">{new Date(e.occurredAt).toLocaleString('ar-SA')}</td>
                <td className="p-2">{e.entryType === 'wastage' ? 'هدر' : 'انتهاء'}</td>
                <td className="p-2">{e.itemId.slice(-6).toUpperCase()}</td>
                <td className="p-2">{e.warehouseId ? e.warehouseId.slice(-6).toUpperCase() : '-'}</td>
                <td className="p-2">{e.batchId ? e.batchId.slice(0,8) : '-'}</td>
                <td className="p-2">{e.quantity}</td>
                <td className="p-2">{e.unitCost.toFixed(2)}</td>
                <td className="p-2 font-semibold">{e.totalCost.toFixed(2)}</td>
                <td className="p-2">{e.debitAccount}</td>
                <td className="p-2">{e.creditAccount}</td>
                <td className="p-2">{e.notes || ''}</td>
              </tr>
            ))}
            {entries.length === 0 && !loading && (
              <tr>
                <td className="p-3 text-center text-gray-600 dark:text-gray-300" colSpan={11}>لا توجد بيانات</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default WastageExpiryReportsScreen;
