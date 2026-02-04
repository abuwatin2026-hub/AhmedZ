import React, { useState, useMemo, useEffect } from 'react';
import { useMenu } from '../../contexts/MenuContext';
import { useStock } from '../../contexts/StockContext';
// import { useSettings } from '../../contexts/SettingsContext';
import type { MenuItem, StockHistory, UnitType, StockManagement, ItemBatch } from '../../types';
import { useItemMeta } from '../../contexts/ItemMetaContext';
import { MinusIcon, PlusIcon } from '../../components/icons';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { getBaseCurrencyCode, getSupabaseClient } from '../../supabase';
import { useSessionScope } from '../../contexts/SessionScopeContext';
import { useWarehouses } from '../../contexts/WarehouseContext';

import RecordWastageModal from '../../components/admin/RecordWastageModal';

type StockRowProps = {
    item: MenuItem;
    stock: StockManagement | undefined;
    warehouseId: string;
    baseCode: string;
    getCategoryLabel: (categoryKey: string, language: 'ar' | 'en') => string;
    getUnitLabel: (unitKey: UnitType | undefined, language: 'ar' | 'en') => string;
    handleUpdateStock: (itemId: string, newQuantity: number, unit: string, batchId?: string) => Promise<void>;
    toggleHistory: (itemId: string) => Promise<void>;
    expandedHistoryItemId: string | null;
    historyLoadingItemId: string | null;
    historyByItemId: Record<string, StockHistory[]>;
    setIsWastageModalOpen: (open: boolean) => void;
    setWastageItem: (item: MenuItem | null) => void;
};

const StockRow = ({ item, stock, warehouseId, baseCode, getCategoryLabel, getUnitLabel, handleUpdateStock, toggleHistory, expandedHistoryItemId, historyLoadingItemId, historyByItemId, setIsWastageModalOpen, setWastageItem }: StockRowProps) => {
    const { hasPermission } = useAuth();
    const { showNotification } = useToast();
    const currentStock = Number(stock?.availableQuantity ?? 0);
    const qcHold = Number(stock?.qcHoldQuantity ?? 0);
    const reserved = Number(stock?.reservedQuantity ?? 0);
    const available = currentStock - reserved;
    const unit = String(stock?.unit ?? item.unitType ?? 'piece');
    const threshold = Number(stock?.lowStockThreshold ?? 5);
    const isLowStock = available <= threshold;
    const itemName = item.name?.['ar'] || item.name?.en || '';
    
    const [localStock, setLocalStock] = useState<string>(String(currentStock));
    const [batches, setBatches] = useState<ItemBatch[]>([]);
    const [selectedBatchId, setSelectedBatchId] = useState<string>('');
    const [showBatches, setShowBatches] = useState<boolean>(false);
    const [qcBusyBatchId, setQcBusyBatchId] = useState<string | null>(null);

    useEffect(() => {
        setLocalStock(String(currentStock));
    }, [currentStock]);

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
                    qcStatus: String(r.qc_status || ''),
                    lastQcResult: (r.last_qc_result === 'pass' || r.last_qc_result === 'fail') ? r.last_qc_result : undefined,
                    lastQcAt: r.last_qc_at ? String(r.last_qc_at) : undefined,
                })) as ItemBatch[];
                setBatches(mapped);
            } catch (_) {
            }
        };
        loadBatches();
    }, [item.id, warehouseId]);

    const qcStatusLabel = (s: string) => {
        const v = String(s || '').trim();
        if (v === 'released') return 'مُفرج';
        if (v === 'inspected') return 'مفحوص';
        if (v === 'pending' || v === 'quarantined') return 'معلّق';
        return v || 'غير محدد';
    };

    const runQcInspect = async (batchId: string, result: 'pass' | 'fail') => {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        setQcBusyBatchId(batchId);
        try {
            const { error } = await supabase.rpc('qc_inspect_batch', { p_batch_id: batchId, p_result: result, p_notes: null } as any);
            if (error) throw error;
            showNotification(result === 'pass' ? 'تم تسجيل فحص QC (نجح).' : 'تم تسجيل فحص QC (فشل).', 'success');
        } catch (e) {
            const msg = e instanceof Error ? e.message : '';
            showNotification(msg && /[\u0600-\u06FF]/.test(msg) ? msg : 'فشل تنفيذ فحص QC.', 'error');
        } finally {
            setQcBusyBatchId(null);
            try {
                const { data, error } = await supabase.rpc('get_item_batches', { p_item_id: item.id, p_warehouse_id: warehouseId || null } as any);
                if (!error) {
                    const rows = (data || []) as any[];
                    const mapped = rows.map(r => ({
                        batchId: r.batch_id,
                        occurredAt: r.occurred_at,
                        unitCost: Number(r.unit_cost) || 0,
                        receivedQuantity: Number(r.received_quantity) || 0,
                        consumedQuantity: Number(r.consumed_quantity) || 0,
                        remainingQuantity: Number(r.remaining_quantity) || 0,
                        qcStatus: String(r.qc_status || ''),
                        lastQcResult: (r.last_qc_result === 'pass' || r.last_qc_result === 'fail') ? r.last_qc_result : undefined,
                        lastQcAt: r.last_qc_at ? String(r.last_qc_at) : undefined,
                    })) as ItemBatch[];
                    setBatches(mapped);
                }
            } catch {
            }
        }
    };

    const runQcRelease = async (batchId: string) => {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        setQcBusyBatchId(batchId);
        try {
            const { error } = await supabase.rpc('qc_release_batch', { p_batch_id: batchId } as any);
            if (error) throw error;
            showNotification('تم إفراج الدُفعة بنجاح.', 'success');
        } catch (e) {
            const msg = e instanceof Error ? e.message : '';
            showNotification(msg && /[\u0600-\u06FF]/.test(msg) ? msg : 'فشل إفراج الدُفعة.', 'error');
        } finally {
            setQcBusyBatchId(null);
            try {
                const { data, error } = await supabase.rpc('get_item_batches', { p_item_id: item.id, p_warehouse_id: warehouseId || null } as any);
                if (!error) {
                    const rows = (data || []) as any[];
                    const mapped = rows.map(r => ({
                        batchId: r.batch_id,
                        occurredAt: r.occurred_at,
                        unitCost: Number(r.unit_cost) || 0,
                        receivedQuantity: Number(r.received_quantity) || 0,
                        consumedQuantity: Number(r.consumed_quantity) || 0,
                        remainingQuantity: Number(r.remaining_quantity) || 0,
                        qcStatus: String(r.qc_status || ''),
                        lastQcResult: (r.last_qc_result === 'pass' || r.last_qc_result === 'fail') ? r.last_qc_result : undefined,
                        lastQcAt: r.last_qc_at ? String(r.last_qc_at) : undefined,
                    })) as ItemBatch[];
                    setBatches(mapped);
                }
            } catch {
            }
        }
    };

    const onStockChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalStock(e.target.value);
    };

    const onStockBlur = () => {
        const val = parseFloat(localStock);
        if (!Number.isNaN(val) && val !== currentStock) {
            handleUpdateStock(item.id, val, unit, selectedBatchId || undefined);
        } else {
            setLocalStock(String(currentStock));
        }
    };

    const onStockKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        }
    };

    return (
        <tr className={isLowStock ? 'bg-red-50 dark:bg-red-900/10' : ''}>
            <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                <div className="flex items-center">
                    <img src={item.imageUrl || undefined} alt={itemName} className="w-10 h-10 rounded-md object-cover" />
                    <div className="mr-4 rtl:mr-0 rtl:ml-4">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {itemName}
                        </div>
                    </div>
                </div>
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 border-r dark:border-gray-700">
                {getCategoryLabel(item.category, 'ar')}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 border-r dark:border-gray-700">
                {getUnitLabel(unit as any, 'ar')}
            </td>
            <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700" dir="ltr">
                <span className={`text-sm font-semibold ${isLowStock ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                    {Number(currentStock || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-purple-700 dark:text-purple-300 border-r dark:border-gray-700" dir="ltr">
                {Number(qcHold || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-orange-600 dark:text-orange-400 border-r dark:border-gray-700" dir="ltr">
                {Number(reserved || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </td>
            <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700" dir="ltr">
                <span className={`text-sm font-semibold ${isLowStock ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {Number(available || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => handleUpdateStock(item.id, currentStock - 1, unit, selectedBatchId || undefined)}
                        className="p-1 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    >
                        <MinusIcon />
                    </button>
                    <input
                        type="number"
                        value={localStock}
                        onChange={onStockChange}
                        onBlur={onStockBlur}
                        onKeyDown={onStockKeyDown}
                        className="w-20 px-2 py-1 text-center border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        min="0"
                        step={unit === 'kg' || unit === 'gram' ? '0.5' : '1'}
                    />
                    <button
                        onClick={() => handleUpdateStock(item.id, currentStock + 1, unit, selectedBatchId || undefined)}
                        className="p-1 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    >
                        <PlusIcon />
                    </button>
                </div>
                <div className="mt-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        اختيار الدُفعة
                    </label>
                    <select
                        value={selectedBatchId}
                        onChange={(e) => setSelectedBatchId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                        <option value="">الدفعة الأخيرة</option>
                        {batches.map((b) => (
                            <option key={b.batchId} value={b.batchId}>
                                {String(b.batchId).slice(0, 8)} • {qcStatusLabel(String((b as any).qcStatus || ''))} • متبقٍ {Number(b.remainingQuantity || 0).toLocaleString('en-US')}
                            </option>
                        ))}
                    </select>
                </div>
                <button
                    type="button"
                    onClick={() => setShowBatches(prev => !prev)}
                    className="mt-2 w-full px-3 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition text-sm font-semibold dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                >
                    {showBatches ? 'إخفاء الدُفعات' : 'دفعات المخزون'}
                </button>
                {showBatches && (
                    <div className="mt-2 p-3 rounded-md bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                        {(batches || []).length > 0 ? (
                            <ul className="space-y-2 text-xs">
                                {batches.slice(0, 5).map((b) => (
                                    <li key={b.batchId} className="text-gray-700 dark:text-gray-200">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="font-semibold">
                                                    {String(b.batchId).slice(0, 8)} • كلفة {Number(b.unitCost || 0).toLocaleString('en-US')} {baseCode || '—'}
                                                </div>
                                                <div className="text-gray-500 dark:text-gray-400">
                                                    وارد {Number(b.receivedQuantity || 0).toLocaleString('en-US')} • مستهلك {Number(b.consumedQuantity || 0).toLocaleString('en-US')} • متبقٍ {Number(b.remainingQuantity || 0).toLocaleString('en-US')}
                                                </div>
                                                <div className="text-gray-500 dark:text-gray-400 mt-1">
                                                    QC: {qcStatusLabel(String((b as any).qcStatus || ''))}
                                                    {(b as any).lastQcResult ? ` • آخر نتيجة: ${(b as any).lastQcResult === 'pass' ? 'نجح' : 'فشل'}` : ''}
                                                </div>
                                                <div className="flex items-center gap-2 mt-2">
                                                    {(String((b as any).qcStatus || '') === 'pending' || String((b as any).qcStatus || '') === 'quarantined') && hasPermission('qc.inspect') && (
                                                        <>
                                                            <button
                                                                type="button"
                                                                onClick={() => runQcInspect(String(b.batchId), 'pass')}
                                                                disabled={qcBusyBatchId === String(b.batchId)}
                                                                className="px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                                                            >
                                                                فحص (نجح)
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => runQcInspect(String(b.batchId), 'fail')}
                                                                disabled={qcBusyBatchId === String(b.batchId)}
                                                                className="px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                                                            >
                                                                فحص (فشل)
                                                            </button>
                                                        </>
                                                    )}
                                                    {String((b as any).qcStatus || '') === 'inspected' && (b as any).lastQcResult === 'pass' && hasPermission('qc.release') && (
                                                        <button
                                                            type="button"
                                                            onClick={() => runQcRelease(String(b.batchId))}
                                                            disabled={qcBusyBatchId === String(b.batchId)}
                                                            className="px-2 py-1 rounded bg-purple-700 text-white hover:bg-purple-800 disabled:opacity-50"
                                                        >
                                                            إفراج
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="shrink-0 text-gray-500 dark:text-gray-400" dir="ltr">
                                                {new Date(b.occurredAt).toLocaleString('ar-EG-u-nu-latn')}
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="text-xs text-gray-500 dark:text-gray-400">لا توجد دفعات لهذا المنتج.</div>
                        )}
                    </div>
                )}
                <button
                    type="button"
                    onClick={() => {
                        setWastageItem(item);
                        setIsWastageModalOpen(true);
                    }}
                    className="mt-2 w-full px-3 py-2 bg-red-100 text-red-800 rounded-md hover:bg-red-200 transition text-sm font-semibold dark:bg-red-900/30 dark:text-red-200 dark:hover:bg-red-900/50"
                >
                    تسجيل تالف
                </button>
                <button
                    type="button"
                    onClick={() => toggleHistory(item.id)}
                    className="mt-2 w-full px-3 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition text-sm font-semibold dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                >
                    {expandedHistoryItemId === item.id
                        ? 'إخفاء السجل'
                        : 'سجل التعديلات'}
                </button>
                {expandedHistoryItemId === item.id && (
                    <div className="mt-2 p-3 rounded-md bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                        {historyLoadingItemId === item.id ? (
                            <div className="text-xs text-gray-500 dark:text-gray-400">جاري تحميل السجل...</div>
                        ) : (historyByItemId[item.id]?.length || 0) > 0 ? (
                            <ul className="space-y-2 text-xs">
                                {historyByItemId[item.id]!.slice(0, 10).map((h: any) => (
                                    <li key={h.id} className="text-gray-700 dark:text-gray-200">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="font-semibold">
                                                    {h.quantity} {String(h.unit)}
                                                </div>
                                                <div className="text-gray-500 dark:text-gray-400">
                                                    {h.reason}{h.changedBy ? ` • ${h.changedBy}` : ''}
                                                </div>
                                            </div>
                                            <div className="shrink-0 text-gray-500 dark:text-gray-400" dir="ltr">
                                                {new Date(h.date).toLocaleString('ar-EG-u-nu-latn')}
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="text-xs text-gray-500 dark:text-gray-400">لا يوجد سجل لهذا المنتج.</div>
                        )}
                    </div>
                )}
            </td>
        </tr>
    );
};

const ManageStockScreen: React.FC = () => {
    const { menuItems } = useMenu();
    const { updateStock, getStockByItemId } = useStock();
    // const { language } = useSettings();
    const { categories: categoryDefs, getCategoryLabel, getGroupLabel, getUnitLabel } = useItemMeta();
    const { showNotification } = useToast();
    const { userId, hasPermission } = useAuth();
    const sessionScope = useSessionScope();
    const { warehouses } = useWarehouses();
    const warehouseId = sessionScope.scope?.warehouseId || '';
    const [pendingWarehouseId, setPendingWarehouseId] = useState('');
    const [baseCode, setBaseCode] = useState('—');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [reason, setReason] = useState('');
    const [expandedHistoryItemId, setExpandedHistoryItemId] = useState<string | null>(null);
    const [historyLoadingItemId, setHistoryLoadingItemId] = useState<string | null>(null);
    const [historyByItemId, setHistoryByItemId] = useState<Record<string, StockHistory[]>>({});

    const [isWastageModalOpen, setIsWastageModalOpen] = useState(false);
    const [wastageItem, setWastageItem] = useState<MenuItem | null>(null);

    useEffect(() => {
        void getBaseCurrencyCode().then((c) => {
            if (!c) return;
            setBaseCode(c);
        });
    }, []);

    useEffect(() => {
        setPendingWarehouseId(warehouseId);
    }, [warehouseId]);

    const canSwitchWarehouse = hasPermission('stock.manage') || hasPermission('inventory.view');
    const activeWarehouses = useMemo(() => {
        return (warehouses || []).filter((w: any) => Boolean((w as any)?.isActive ?? (w as any)?.is_active ?? true));
    }, [warehouses]);

    const currentWarehouseName = useMemo(() => {
        if (!warehouseId) return '—';
        return String((activeWarehouses.find((w: any) => String(w.id) === String(warehouseId)) as any)?.name || '—');
    }, [activeWarehouses, warehouseId]);

    const saveActiveWarehouse = async () => {
        try {
            const supabase = getSupabaseClient();
            if (!supabase || !userId) return;
            const wid = String(pendingWarehouseId || '').trim();
            if (!wid) {
                showNotification('اختر مستودعًا أولاً.', 'error');
                return;
            }
            const exists = activeWarehouses.some((w: any) => String(w.id) === wid);
            if (!exists) {
                showNotification('المستودع المحدد غير نشط.', 'error');
                return;
            }
            const { error } = await supabase
                .from('admin_users')
                .update({ warehouse_id: wid })
                .eq('auth_user_id', userId);
            if (error) throw error;
            await sessionScope.refreshScope();
            showNotification('تم تغيير المستودع النشط للجلسة.', 'success');
        } catch (e: any) {
            showNotification(String(e?.message || 'تعذر تحديث المستودع النشط'), 'error');
        }
    };

    // Get unique categories
    const categories = useMemo(() => {
        const activeKeys = categoryDefs.filter(c => c.isActive).map(c => c.key);
        const usedKeys = [...new Set(menuItems.map((item: MenuItem) => item.category))].filter(Boolean);
        const merged = Array.from(new Set([...activeKeys, ...usedKeys])).sort((a, b) => a.localeCompare(b));
        return ['all', ...merged];
    }, [categoryDefs, menuItems]);

    // Filter items
    const [selectedGroup, setSelectedGroup] = useState('all');
    const filteredItems = useMemo(() => {
        return menuItems.filter((item: MenuItem) => {
            const itemName = item.name?.['ar'] || item.name?.en || '';
            const matchesSearch = itemName.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
            const matchesGroup = selectedGroup === 'all' || String((item as any).group || '') === selectedGroup;
            return matchesSearch && matchesCategory && matchesGroup && item.status === 'active';
        });
    }, [menuItems, searchTerm, selectedCategory, selectedGroup]);

    const handleUpdateStock = async (itemId: string, newQuantity: number, unit: string, batchId?: string) => {
        if (newQuantity < 0) return;
        if (!reason.trim()) {
            showNotification('سبب تعديل المخزون مطلوب.', 'error');
            return;
        }
        try {
            await updateStock(itemId, newQuantity, unit, reason, batchId);
        } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            const message = raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل تحديث المخزون';
            showNotification(message, 'error');
        }
    };

    const toggleHistory = async (itemId: string) => {
        if (expandedHistoryItemId === itemId) {
            setExpandedHistoryItemId(null);
            return;
        }

        setExpandedHistoryItemId(itemId);
        if (historyByItemId[itemId]) return;

        setHistoryLoadingItemId(itemId);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) {
                throw new Error('Supabase غير مهيأ.');
            }
            const { data: rows, error } = await supabase
                .from('stock_history')
                .select('id,item_id,date,quantity,unit,reason,data,created_at')
                .eq('item_id', itemId)
                .order('date', { ascending: false })
                .limit(60);
            if (error) throw error;
            const history = (rows || []).map((r: any) => {
                const d = (r?.data && typeof r.data === 'object') ? r.data : {};
                return {
                    id: r.id,
                    itemId: r.item_id,
                    quantity: Number(r.quantity ?? d.quantity ?? 0),
                    unit: String(r.unit ?? d.unit ?? 'piece'),
                    date: String(r.date ?? d.date ?? new Date().toISOString()),
                    reason: String(r.reason ?? d.reason ?? ''),
                    changedBy: d.changedBy ? String(d.changedBy) : undefined
                } as StockHistory;
            }).filter(Boolean);
            setHistoryByItemId(prev => ({ ...prev, [itemId]: history }));
        } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            const message = raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل تحميل سجل المخزون.';
            showNotification(message, 'error');
        } finally {
            setHistoryLoadingItemId(null);
        }
    };

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="mb-8">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                            إدارة المخزون
                        </h1>
                        <p className="text-gray-600 dark:text-gray-400">
                            تحديث وإدارة كميات المخزون المتوفرة
                        </p>
                    </div>
                    {canSwitchWarehouse && (
                        <div className="flex items-center gap-2">
                            <select
                                value={pendingWarehouseId || ''}
                                onChange={(e) => setPendingWarehouseId(e.target.value)}
                                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            >
                                <option value="" disabled>اختر المستودع</option>
                                {activeWarehouses.map((w: any) => (
                                    <option key={String(w.id)} value={String(w.id)}>
                                        {String((w as any).name || '')}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={saveActiveWarehouse}
                                className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-60"
                                disabled={!pendingWarehouseId || pendingWarehouseId === warehouseId}
                            >
                                تعيين للجلسة
                            </button>
                        </div>
                    )}
                </div>
                <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    المستودع الحالي: {currentWarehouseName}
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            البحث
                        </label>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="ابحث عن منتج..."
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-gold-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            الفئة
                        </label>
                        <select
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-gold-500"
                        >
                            <option value="all">الكل</option>
                            {categories.filter(c => c !== 'all').map((cat: string) => (
                                <option key={cat} value={cat}>{getCategoryLabel(cat, 'ar')}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            المجموعة
                        </label>
                        <select
                            value={selectedGroup}
                            onChange={(e) => setSelectedGroup(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-gold-500"
                        >
                            <option value="all">الكل</option>
                            {[...new Set(menuItems
                                .filter((it: any) => selectedCategory === 'all' || String(it?.category || '') === selectedCategory)
                                .map((it: any) => String(it?.group || ''))
                                .filter(Boolean))]
                                .map((g: string) => (
                                    <option key={g} value={g}>{getGroupLabel(g, selectedCategory !== 'all' ? selectedCategory : undefined, 'ar')}</option>
                                ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            سبب التعديل
                        </label>
                        <input
                            type="text"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="مثال: جرد يومي / تلف / توريد جديد"
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-gold-500"
                        />
                    </div>
                </div>
            </div>

            {/* Stock Table */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-900">
                            <tr>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    المنتج
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    الفئة
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    الوحدة
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    المخزون الحالي
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    قيد الفحص
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    محجوز
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    متاح
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    تحديث
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredItems.map((item: MenuItem) => {
                                const stock = getStockByItemId(item.id);
                                return (
                                    <StockRow
                                        key={item.id}
                                        item={item}
                                        stock={stock}
                                        warehouseId={warehouseId}
                                        baseCode={baseCode}
                                        getCategoryLabel={getCategoryLabel}
                                        getUnitLabel={getUnitLabel}
                                        handleUpdateStock={handleUpdateStock}
                                        toggleHistory={toggleHistory}
                                        expandedHistoryItemId={expandedHistoryItemId}
                                        historyLoadingItemId={historyLoadingItemId}
                                        historyByItemId={historyByItemId}
                                        setIsWastageModalOpen={setIsWastageModalOpen}
                                        setWastageItem={setWastageItem}
                                    />
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {filteredItems.length === 0 && (
                    <div className="text-center py-12">
                        <p className="text-gray-500 dark:text-gray-400">
                            لا توجد منتجات
                        </p>
                    </div>
                )}
            </div>

            {/* Summary */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border-2 border-green-500">
                    <h3 className="text-sm font-medium text-green-800 dark:text-green-400 mb-1">
                        منتجات متوفرة
                    </h3>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {filteredItems.filter(item => {
                            const stock = getStockByItemId(item.id);
                            const available = Number(stock?.availableQuantity ?? 0) - Number(stock?.reservedQuantity ?? 0);
                            return available > 5;
                        }).length}
                    </p>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 border-2 border-orange-500">
                    <h3 className="text-sm font-medium text-orange-800 dark:text-orange-400 mb-1">
                        مخزون منخفض
                    </h3>
                    <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                        {filteredItems.filter(item => {
                            const stock = getStockByItemId(item.id);
                            const available = Number(stock?.availableQuantity ?? 0) - Number(stock?.reservedQuantity ?? 0);
                            return available > 0 && available <= 5;
                        }).length}
                    </p>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border-2 border-red-500">
                    <h3 className="text-sm font-medium text-red-800 dark:text-red-400 mb-1">
                        نفذت الكمية
                    </h3>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                        {filteredItems.filter(item => {
                            const stock = getStockByItemId(item.id);
                            const available = Number(stock?.availableQuantity ?? 0) - Number(stock?.reservedQuantity ?? 0);
                            return available <= 0;
                        }).length}
                    </p>
                </div>
            </div>

            {wastageItem && (
                <RecordWastageModal
                    isOpen={isWastageModalOpen}
                    onClose={() => {
                        setIsWastageModalOpen(false);
                        setWastageItem(null);
                    }}
                    item={wastageItem}
                />
            )}
        </div>
    );
};

export default ManageStockScreen;
