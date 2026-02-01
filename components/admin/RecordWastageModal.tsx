import React, { useEffect, useState } from 'react';
import { MenuItem, ItemBatch } from '../../types';
import { useStock } from '../../contexts/StockContext';
import { useToast } from '../../contexts/ToastContext';
import { getSupabaseClient } from '../../supabase';
import { useItemMeta } from '../../contexts/ItemMetaContext';
import { useAuth } from '../../contexts/AuthContext';
import { useSessionScope } from '../../contexts/SessionScopeContext';

interface RecordWastageModalProps {
    isOpen: boolean;
    onClose: () => void;
    item: MenuItem;
}

const RecordWastageModal: React.FC<RecordWastageModalProps> = ({ isOpen, onClose, item }) => {
    const { recordWastage } = useStock();
    const { showNotification } = useToast();
    const { getUnitLabel } = useItemMeta();
    const { user } = useAuth();
    const sessionScope = useSessionScope();
    const warehouseId = sessionScope.scope?.warehouseId || '';

    const [quantity, setQuantity] = useState<number>(0);
    const [reason, setReason] = useState<string>('expired');
    const [notes, setNotes] = useState<string>('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [batches, setBatches] = useState<ItemBatch[]>([]);
    const [selectedBatchId, setSelectedBatchId] = useState<string>('');

    if (!isOpen) return null;

    useEffect(() => {
        const loadBatches = async () => {
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;
                const { data, error } = await supabase.rpc('get_item_batches', { p_item_id: item.id, p_warehouse_id: warehouseId || null } as any);
                if (error) return;
                const rows = (data || []) as any[];
                const mapped = rows.map(r => ({
                    batchId: r.batch_id,
                    occurredAt: r.occurred_at,
                    unitCost: Number(r.unit_cost) || 0,
                    receivedQuantity: Number(r.received_quantity) || 0,
                    consumedQuantity: Number(r.consumed_quantity) || 0,
                    remainingQuantity: Number(r.remaining_quantity) || 0,
                })) as ItemBatch[];
                setBatches(mapped);
            } catch (_) {
            }
        };
        if (isOpen && item?.id) {
            loadBatches();
        }
    }, [isOpen, item?.id, warehouseId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (quantity <= 0) {
            showNotification('الكمية يجب أن تكون أكبر من صفر.', 'error');
            return;
        }

        setIsProcessing(true);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error('Supabase not initialized');

            // 1. Record Wastage
            const { error: wastageError } = await supabase.from('stock_wastage').insert({
                item_id: item.id,
                quantity: quantity,
                unit_type: item.unitType || 'piece',
                cost_at_time: item.costPrice || 0,
                reason: reason,
                notes: notes,
                reported_by: user?.id
            });

            if (wastageError) throw wastageError;

            const stockDeductionReason = `إتلاف (تالف): ${reason}`;
            const batchId = selectedBatchId || undefined;
            await recordWastage(item.id, quantity, item.unitType || 'piece', stockDeductionReason, batchId);

            showNotification('تم تسجيل التالف وخصم المخزون بنجاح.', 'success');
            onClose();
        } catch (error: any) {
            showNotification(error.message || 'فشل تسجيل التالف', 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md animate-fade-in-up max-h-[min(90dvh,calc(100dvh-2rem))] overflow-y-auto">
                <div className="p-4 border-b dark:border-gray-700">
                    <h2 className="text-xl font-bold dark:text-white">تسجيل تالف / إتلاف مخزون</h2>
                    <p className="text-sm text-gray-500">{item.name?.ar || item.name?.en}</p>
                </div>
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">الكمية التالفة ({getUnitLabel(item.unitType as any, 'ar')})</label>
                        <input
                            type="number"
                            value={quantity}
                            onChange={e => setQuantity(parseFloat(e.target.value))}
                            className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                            min="0.1"
                            step="0.1"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">سبب الإتلاف</label>
                        <select
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                        >
                            <option value="expired">منتهي الصلاحية</option>
                            <option value="damaged">تالف / مكسور</option>
                            <option value="lost">مفقود</option>
                            <option value="other">أخرى</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">اختيار الدُفعة</label>
                        <select
                            value={selectedBatchId}
                            onChange={e => setSelectedBatchId(e.target.value)}
                            className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                        >
                            <option value="">الدفعة الأخيرة</option>
                            {batches.map(b => (
                                <option key={b.batchId} value={b.batchId}>
                                    {String(b.batchId).slice(0, 8)} • متبقٍ {Number(b.remainingQuantity || 0).toLocaleString('en-US')}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">ملاحظات</label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                            rows={3}
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 rounded-md text-gray-800 hover:bg-gray-300">إلغاء</button>
                        <button type="submit" disabled={isProcessing} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50">
                            {isProcessing ? 'جاري التنفيذ...' : 'تسجيل وإتلاف'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default RecordWastageModal;
