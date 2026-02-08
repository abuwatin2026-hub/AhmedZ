import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useImport } from '../../contexts/ImportContext';
import { useMenu } from '../../contexts/MenuContext';
import { usePriceHistory } from '../../contexts/PriceContext';
import { useToast } from '../../contexts/ToastContext';
import { useWarehouses } from '../../contexts/WarehouseContext';
import { useSessionScope } from '../../contexts/SessionScopeContext';
import { ImportShipment, ImportShipmentItem, ImportExpense } from '../../types';
import { Plus, X, DollarSign, ArrowLeft } from '../../components/icons';
import { getBaseCurrencyCode, getSupabaseClient } from '../../supabase';
import { localizeSupabaseError } from '../../utils/errorUtils';

const ImportShipmentDetailsScreen: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { getShipmentDetails, addShipment, updateShipment, addShipmentItem, deleteShipmentItem, addExpense, deleteExpense, calculateLandedCost } = useImport();
    const { menuItems } = useMenu();
    const { updatePrice } = usePriceHistory();
    const { showNotification } = useToast();
    const { warehouses } = useWarehouses();
    const { scope } = useSessionScope();
    const [baseCode, setBaseCode] = useState('');
    const [currencyOptions, setCurrencyOptions] = useState<string[]>([]);

    const [shipment, setShipment] = useState<ImportShipment | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'items' | 'expenses' | 'receipts' | 'pricing'>('items');
    const isCreateMode = id === 'new' || !id;
    const [draftReferenceNumber, setDraftReferenceNumber] = useState('');
    const [draftStatus, setDraftStatus] = useState<ImportShipment['status']>('draft');
    const [draftDestinationWarehouseId, setDraftDestinationWarehouseId] = useState<string>('');
    const [receiptRows, setReceiptRows] = useState<Array<any>>([]);
    const [receiptSelection, setReceiptSelection] = useState<Record<string, boolean>>({});
    const [receiptsLoading, setReceiptsLoading] = useState(false);
    const [receiptsSyncing, setReceiptsSyncing] = useState(false);
    const [pricingLoading, setPricingLoading] = useState(false);

    const isUuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? '').trim());
    const [pricingRows, setPricingRows] = useState<Array<any>>([]);
    const [pricingTierType, setPricingTierType] = useState<'retail' | 'wholesale' | 'distributor' | 'vip'>('wholesale');

    // Form states for adding items
    const [showItemForm, setShowItemForm] = useState(false);
    const [newItem, setNewItem] = useState({
        itemId: '',
        quantity: 0,
        unitPriceFob: 0,
        currency: '',
        expiryDate: '',
        notes: ''
    });

    // Form states for adding expenses
    const [showExpenseForm, setShowExpenseForm] = useState(false);
    const [isExpenseFxManual, setIsExpenseFxManual] = useState(false);
    const [expenseFxSource, setExpenseFxSource] = useState<'system' | 'manual' | 'base' | 'unknown'>('unknown');
    const [newExpense, setNewExpense] = useState({
        expenseType: 'shipping' as ImportExpense['expenseType'],
        amount: 0,
        currency: '',
        exchangeRate: 0,
        description: '',
        invoiceNumber: '',
        paidAt: ''
    });

    useEffect(() => {
        if (isCreateMode) {
            setShipment(null);
            setLoading(false);
            return;
        }
        loadShipment();
    }, [id]);

    useEffect(() => {
        void getBaseCurrencyCode().then((c) => {
            if (!c) return;
            setBaseCode(c);
        });
    }, []);

    useEffect(() => {
        let active = true;
        const loadCurrencies = async () => {
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;
                const { data, error } = await supabase
                    .from('currencies')
                    .select('code')
                    .order('code', { ascending: true });
                if (error) throw error;
                const codes = (Array.isArray(data) ? data : [])
                    .map((r: any) => String(r.code || '').toUpperCase())
                    .filter(Boolean);
                if (active) setCurrencyOptions(codes);
            } catch {
                if (active) setCurrencyOptions([]);
            }
        };
        void loadCurrencies();
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!baseCode) return;
        const curr = String(newExpense.currency || '').trim().toUpperCase();
        if (!curr || curr === baseCode) {
            setNewExpense((prev) => ({ ...prev, currency: baseCode, exchangeRate: 1 }));
            setExpenseFxSource('base');
        }
    }, [baseCode, newExpense.currency]);

    useEffect(() => {
        if (!isCreateMode) return;
        if (draftDestinationWarehouseId) return;
        const wid = String(scope?.warehouseId || warehouses.find(w => w.isActive)?.id || '');
        if (wid) setDraftDestinationWarehouseId(wid);
    }, [isCreateMode, scope?.warehouseId, warehouses, draftDestinationWarehouseId]);

    const loadShipment = async () => {
        if (!id) return;
        setLoading(true);
        const data = await getShipmentDetails(id);
        setShipment(data);
        setLoading(false);
    };

    const fetchSystemFxRate = async (currency: string) => {
        const code = String(currency || '').trim().toUpperCase();
        if (!code) return null;
        if (baseCode && code === baseCode) return 1;
        const supabase = getSupabaseClient();
        if (!supabase) return null;
        try {
            const d = new Date().toISOString().slice(0, 10);
            const { data, error } = await supabase.rpc('get_fx_rate', {
                p_currency: code,
                p_date: d,
                p_rate_type: 'operational',
            });
            if (error) return null;
            const n = Number(data);
            return Number.isFinite(n) && n > 0 ? n : null;
        } catch {
            return null;
        }
    };

    const applySystemExpenseFxRate = async (currency: string) => {
        const code = String(currency || '').trim().toUpperCase();
        if (!code) return;
        if (baseCode && code === baseCode) {
            setNewExpense((prev) => ({ ...prev, currency: code, exchangeRate: 1 }));
            setExpenseFxSource('base');
            return;
        }
        setNewExpense((prev) => ({ ...prev, currency: code, exchangeRate: 0 }));
        setExpenseFxSource('unknown');
        const rate = await fetchSystemFxRate(code);
        if (!rate) {
            setExpenseFxSource('unknown');
            setNewExpense((prev) => ({ ...prev, currency: code, exchangeRate: 0 }));
            showNotification('لا يوجد سعر صرف تشغيلي لهذه العملة اليوم. أضف السعر من شاشة أسعار الصرف.', 'error');
            return;
        }
        setNewExpense((prev) => ({ ...prev, currency: code, exchangeRate: rate }));
        setExpenseFxSource('system');
    };

    const moneyRound = (v: number) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        return Math.round(n * 100) / 100;
    };

    const loadPricing = async () => {
        const shipmentId = String(shipment?.id || '').trim();
        if (!shipmentId) return;
        if (!isUuid(shipmentId)) {
            showNotification('تعذر تحميل بيانات الشحنة بسبب معرف غير صالح (UUID). حدّث قاعدة البيانات في الإنتاج ثم أعد المحاولة.', 'error');
            return;
        }
        if (!shipment?.destinationWarehouseId) return;
        const supabase = getSupabaseClient();
        if (!supabase) return;
        setPricingLoading(true);
        try {
            const { data: receiptIdsRows, error: receiptIdsError } = await supabase
                .from('purchase_receipts')
                .select('id')
                .eq('import_shipment_id', shipmentId)
                .eq('warehouse_id', shipment.destinationWarehouseId);
            if (receiptIdsError) throw receiptIdsError;
            const receiptIds = (receiptIdsRows || []).map((r: any) => String(r?.id || '')).filter(Boolean);
            if (receiptIds.length === 0) {
                setPricingRows([]);
                return;
            }

            const { data: batchRows, error: batchError } = await supabase
                .from('batches')
                .select('id,item_id,unit_cost,cost_per_unit,min_margin_pct,min_selling_price,expiry_date,quantity_received,quantity_consumed,receipt_id')
                .in('receipt_id', receiptIds);
            if (batchError) throw batchError;

            const batches = Array.isArray(batchRows) ? batchRows : [];
            const grouped: Record<string, any[]> = {};
            for (const b of batches) {
                const itemId = String((b as any)?.item_id || '');
                if (!itemId) continue;
                grouped[itemId] = grouped[itemId] || [];
                grouped[itemId].push(b);
            }

            const itemIds = Object.keys(grouped);
            const landedCostByItemId: Record<string, number> = {};
            try {
                const items = Array.isArray(shipment?.items) ? shipment.items : [];
                for (const it of items as any[]) {
                    const itemId = String(it?.itemId || it?.item_id || '').trim();
                    if (!itemId) continue;
                    const v = Number(it?.landingCostPerUnit ?? it?.landing_cost_per_unit);
                    if (Number.isFinite(v) && v > 0) landedCostByItemId[itemId] = v;
                }
            } catch {
            }
            const marginByItem: Record<string, number> = {};
            await Promise.all(itemIds.map(async (itemId) => {
                try {
                    const { data, error } = await supabase.rpc('_resolve_default_min_margin_pct', {
                        p_item_id: itemId,
                        p_warehouse_id: shipment.destinationWarehouseId,
                    });
                    if (error) throw error;
                    const pct = Number(data);
                    marginByItem[itemId] = Number.isFinite(pct) ? pct : 0;
                } catch {
                    marginByItem[itemId] = 0;
                }
            }));

            const rows = itemIds.map((itemId) => {
                const item = menuItems.find((m: any) => m.id === itemId);
                const name = item?.name?.ar || item?.name?.en || itemId;
                const unitType = item?.unitType || 'piece';
                const currentPrice = Number(item?.price || 0);
                const list = grouped[itemId] || [];
                let qtySum = 0;
                let costWeighted = 0;
                const normalizedBatches = list.map((b: any) => {
                    const qty = Number(b?.quantity_received || 0);
                    const consumed = Number(b?.quantity_consumed || 0);
                    const remaining = Math.max(0, qty - consumed);
                    const unitCost = Number(b?.unit_cost ?? b?.cost_per_unit ?? 0);
                    qtySum += qty;
                    costWeighted += qty * unitCost;
                    return {
                        id: String(b?.id || ''),
                        expiryDate: b?.expiry_date || null,
                        quantityReceived: qty,
                        quantityConsumed: consumed,
                        remaining,
                        unitCost: unitCost,
                        minMarginPct: Number(b?.min_margin_pct || 0),
                        minSellingPrice: Number(b?.min_selling_price || 0),
                    };
                });
                const avgCost = (Number.isFinite(landedCostByItemId[itemId]) && (landedCostByItemId[itemId] > 0))
                    ? landedCostByItemId[itemId]
                    : (qtySum > 0 ? (costWeighted / qtySum) : 0);
                const marginPct = Number.isFinite(Number(marginByItem[itemId])) ? Number(marginByItem[itemId]) : 0;
                const suggestedPrice = moneyRound(avgCost * (1 + (marginPct / 100)));
                return {
                    itemId,
                    name,
                    unitType,
                    currentPrice,
                    avgCost: moneyRound(avgCost),
                    marginPct: moneyRound(marginPct),
                    suggestedPrice,
                    batches: normalizedBatches,
                };
            });
            rows.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
            setPricingRows(rows);
        } catch (err: any) {
            const raw = err instanceof Error ? err.message : '';
            const msg = raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل تحميل بيانات التسعير';
            showNotification(msg, 'error');
        } finally {
            setPricingLoading(false);
        }
    };

    const loadReceipts = async (opts?: { silent?: boolean }) => {
        const shipmentId = String(shipment?.id || '').trim();
        if (!shipmentId) return;
        if (!isUuid(shipmentId)) return;
        if (!shipment?.destinationWarehouseId) return;
        const supabase = getSupabaseClient();
        if (!supabase) return;
        if (!opts?.silent) setReceiptsLoading(true);
        try {
            const { data, error } = await supabase
                .from('purchase_receipts')
                .select('id, received_at, purchase_order_id, import_shipment_id, purchase_order:purchase_orders(reference_number, supplier:suppliers(name))')
                .eq('warehouse_id', shipment.destinationWarehouseId)
                .or(`import_shipment_id.is.null,import_shipment_id.eq.${shipmentId}`)
                .order('received_at', { ascending: false })
                .limit(100);
            if (error) throw error;
            const rows = Array.isArray(data) ? data : [];
            setReceiptRows(rows);
            const nextSel: Record<string, boolean> = {};
            for (const r of rows) {
                const rid = String((r as any)?.id || '');
                if (!rid) continue;
                const linked = String((r as any)?.import_shipment_id || '') === shipmentId;
                nextSel[rid] = linked;
            }
            setReceiptSelection(nextSel);
        } catch {
        } finally {
            if (!opts?.silent) setReceiptsLoading(false);
        }
    };

    useEffect(() => {
        if (!shipment?.id || isCreateMode) return;
        loadReceipts({ silent: true });
    }, [shipment?.id, shipment?.destinationWarehouseId, isCreateMode]);

    const applyReceiptLinking = async (mode: 'link' | 'unlink') => {
        const shipmentId = String(shipment?.id || '').trim();
        if (!shipmentId || !shipment?.destinationWarehouseId) return;
        if (!isUuid(shipmentId)) {
            showNotification('تعذر ربط الاستلامات بهذه الشحنة بسبب معرف غير صالح (UUID). حدّث قاعدة البيانات في الإنتاج ثم أعد المحاولة.', 'error');
            return;
        }
        if (shipment.status === 'closed') return;
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const selectedIds = Object.entries(receiptSelection).filter(([, v]) => Boolean(v)).map(([k]) => k);
        const linkedIds = receiptRows
            .filter((r: any) => String(r?.import_shipment_id || '') === shipmentId)
            .map((r: any) => String(r?.id || ''))
            .filter(Boolean);

        const targetIds = mode === 'link' ? selectedIds : linkedIds;
        if (targetIds.length === 0) return;
        setReceiptsLoading(true);
        try {
            const { error } = await supabase
                .from('purchase_receipts')
                .update({ import_shipment_id: mode === 'link' ? shipmentId : null })
                .in('id', targetIds);
            if (error) throw error;
            await loadReceipts({ silent: true });
        } catch {
        } finally {
            setReceiptsLoading(false);
        }
    };

    const syncItemsFromLinkedReceipts = async () => {
        const shipmentId = String(shipment?.id || '').trim();
        if (!shipmentId) return;
        if (!isUuid(shipmentId)) {
            showNotification('معرف الشحنة غير صالح (UUID).', 'error');
            return;
        }
        if (shipment?.status === 'closed') return;
        const supabase = getSupabaseClient();
        if (!supabase) return;
        setReceiptsSyncing(true);
        try {
            const { data, error } = await supabase.rpc('sync_import_shipment_items_from_receipts', { p_shipment_id: shipmentId, p_replace: true } as any);
            if (error) throw error;
            const upserted = Number((data as any)?.upserted ?? 0);
            const deleted = Number((data as any)?.deleted ?? 0);
            if ((data as any)?.status === 'skipped') {
                showNotification('لا توجد استلامات مرتبطة بهذه الشحنة بعد.', 'info');
            } else {
                showNotification(`تم تحديث أصناف الشحنة من الاستلامات (إضافة/تحديث: ${upserted}، حذف: ${deleted}).`, 'success');
            }
            loadShipment();
        } catch (e: any) {
            showNotification(localizeSupabaseError(e) || 'فشل مزامنة الأصناف من الاستلامات', 'error');
        } finally {
            setReceiptsSyncing(false);
        }
    };

    const handleCreateShipment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!draftReferenceNumber.trim()) return;
        if (!draftDestinationWarehouseId) {
            showNotification('اختر مستودع الوصول أولاً.', 'error');
            return;
        }
        setLoading(true);
        const created = await addShipment({
            referenceNumber: draftReferenceNumber.trim(),
            status: draftStatus,
            destinationWarehouseId: draftDestinationWarehouseId,
            totalWeightKg: 0,
            notes: '',
            items: [],
            expenses: [],
        } as any);
        setLoading(false);
        if (created?.id) {
            navigate(`/admin/import-shipments/${created.id}`);
        }
    };

    const handleAddItem = async () => {
        if (!shipment?.id || !newItem.itemId || newItem.quantity <= 0) return;
        const currency = String(newItem.currency || '').trim().toUpperCase();
        if (!currency) {
            showNotification('اختر عملة للصنف.', 'error');
            return;
        }
        if (currencyOptions.length > 0 && !currencyOptions.includes(currency)) {
            showNotification('عملة الصنف غير معرفة.', 'error');
            return;
        }

        await addShipmentItem({
            shipmentId: shipment.id,
            itemId: newItem.itemId,
            quantity: newItem.quantity,
            unitPriceFob: newItem.unitPriceFob,
            currency,
            expiryDate: newItem.expiryDate || undefined,
            notes: newItem.notes || undefined
        });

        setShowItemForm(false);
        setNewItem({ itemId: '', quantity: 0, unitPriceFob: 0, currency: '', expiryDate: '', notes: '' });
        loadShipment();
    };

    const handleDeleteItem = async (itemId: string) => {
        if (window.confirm('هل أنت متأكد من حذف هذا الصنف؟')) {
            await deleteShipmentItem(itemId);
            loadShipment();
        }
    };

    const handleAddExpense = async () => {
        if (!shipment?.id || newExpense.amount <= 0) return;
        const currency = String(newExpense.currency || '').trim().toUpperCase();
        if (!currency) {
            showNotification('اختر عملة للمصروف.', 'error');
            return;
        }
        if (currencyOptions.length > 0 && !currencyOptions.includes(currency)) {
            showNotification('عملة المصروف غير معرفة.', 'error');
            return;
        }
        const isBase = Boolean(baseCode && currency === baseCode);
        if (!isBase && !isExpenseFxManual && expenseFxSource !== 'system') {
            showNotification('سعر الصرف يجب أن يكون من النظام أو فعّل "تعديل يدوي".', 'error');
            return;
        }
        const rate = Number(newExpense.exchangeRate);
        if (!Number.isFinite(rate) || rate <= 0) {
            showNotification('سعر الصرف غير صالح.', 'error');
            return;
        }

        await addExpense({
            shipmentId: shipment.id,
            expenseType: newExpense.expenseType,
            amount: newExpense.amount,
            currency,
            exchangeRate: isBase ? 1 : rate,
            description: newExpense.description || undefined,
            invoiceNumber: newExpense.invoiceNumber || undefined,
            paidAt: newExpense.paidAt || undefined
        });

        setShowExpenseForm(false);
        setIsExpenseFxManual(false);
        setExpenseFxSource('unknown');
        setNewExpense({
            expenseType: 'shipping',
            amount: 0,
            currency: baseCode || '',
            exchangeRate: baseCode ? 1 : 0,
            description: '',
            invoiceNumber: '',
            paidAt: ''
        });
        loadShipment();
    };

    const handleDeleteExpense = async (expenseId: string) => {
        if (window.confirm('هل أنت متأكد من حذف هذا المصروف؟')) {
            await deleteExpense(expenseId);
            loadShipment();
        }
    };

    const handleCalculateCost = async () => {
        if (!shipment?.id) return;
        await calculateLandedCost(shipment.id);
        loadShipment();
    };

    const handleUpdateStatus = async (status: ImportShipment['status']) => {
        if (!shipment?.id) return;
        await updateShipment(shipment.id, { status });
        loadShipment();
    };

    const getExpenseTypeLabel = (type: ImportExpense['expenseType']) => {
        const labels: Record<ImportExpense['expenseType'], string> = {
            shipping: 'شحن',
            customs: 'جمارك',
            insurance: 'تأمين',
            clearance: 'تخليص',
            transport: 'نقل',
            other: 'أخرى'
        };
        return labels[type];
    };

    const calculateTotals = () => {
        const summarize = (pairs: Array<{ currency?: string; amount: number }>) => {
            const by: Record<string, number> = {};
            for (const p of pairs) {
                const c = String(p.currency || '').toUpperCase() || '—';
                const v = Number(p.amount);
                if (!Number.isFinite(v)) continue;
                by[c] = (by[c] || 0) + v;
            }
            return Object.entries(by)
                .map(([currency, total]) => ({ currency, total: moneyRound(total) }))
                .sort((a, b) => String(a.currency).localeCompare(String(b.currency)));
        };

        const items = Array.isArray(shipment?.items) ? shipment?.items : [];
        const expenses = Array.isArray(shipment?.expenses) ? shipment?.expenses : [];

        const itemsByCurrency = summarize(items.map((i) => ({
            currency: (i as any)?.currency,
            amount: Number(i.quantity) * Number(i.unitPriceFob),
        })));

        const expensesByCurrency = summarize(expenses.map((e) => ({
            currency: (e as any)?.currency,
            amount: Number((e as any)?.amount),
        })));

        const expensesBaseTotalRaw = expenses.reduce((sum, e: any) => {
            const v = Number(e?.baseAmount);
            return Number.isFinite(v) ? (sum + v) : sum;
        }, 0);
        const expensesBaseTotal = Number.isFinite(expensesBaseTotalRaw) ? moneyRound(expensesBaseTotalRaw) : undefined;

        return { itemsByCurrency, expensesByCurrency, expensesBaseTotal };
    };

    if (loading) {
        return <div className="flex items-center justify-center min-h-screen">جاري التحميل...</div>;
    }

    if (isCreateMode) {
        return (
            <div className="p-6 max-w-3xl mx-auto">
                <button
                    onClick={() => navigate('/admin/import-shipments')}
                    className="flex items-center gap-2 text-blue-600 hover:underline mb-6"
                >
                    <ArrowLeft className="w-4 h-4" />
                    العودة للشحنات
                </button>

                <h1 className="text-3xl font-bold mb-6">إنشاء شحنة</h1>

                <form onSubmit={handleCreateShipment} className="bg-white border rounded-lg p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">رقم الشحنة</label>
                        <input
                            value={draftReferenceNumber}
                            onChange={(e) => setDraftReferenceNumber(e.target.value)}
                            className="w-full px-4 py-2 border rounded-lg"
                            placeholder="مثال: BL-2026-001"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">مستودع الوصول</label>
                        <select
                            value={draftDestinationWarehouseId}
                            onChange={(e) => setDraftDestinationWarehouseId(e.target.value)}
                            className="w-full px-4 py-2 border rounded-lg"
                            required
                        >
                            <option value="">اختر المستودع...</option>
                            {warehouses.filter(w => w.isActive).map(w => (
                                <option key={w.id} value={w.id}>{w.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">الحالة</label>
                        <select
                            value={draftStatus}
                            onChange={(e) => setDraftStatus(e.target.value as ImportShipment['status'])}
                            className="w-full px-4 py-2 border rounded-lg"
                        >
                            <option value="draft">مسودة</option>
                            <option value="ordered">تم الطلب</option>
                            <option value="shipped">قيد الشحن</option>
                            <option value="at_customs">في الجمارك</option>
                            <option value="cleared">تم التخليص</option>
                            <option value="delivered">تم التسليم</option>
                            <option value="cancelled">ملغي</option>
                        </select>
                    </div>

                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => navigate('/admin/import-shipments')}
                            className="px-4 py-2 rounded-lg border"
                        >
                            إلغاء
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                        >
                            إنشاء
                        </button>
                    </div>
                </form>
            </div>
        );
    }

    if (!shipment) {
        return <div className="p-6">الشحنة غير موجودة</div>;
    }

    const totals = calculateTotals();

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <button
                    onClick={() => navigate('/admin/import-shipments')}
                    className="flex items-center gap-2 text-blue-600 hover:underline mb-4"
                >
                    <ArrowLeft className="w-4 h-4" />
                    العودة للشحنات
                </button>

                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-3xl font-bold mb-2">{shipment.referenceNumber}</h1>
                        <p className="text-gray-600">
                            {shipment.originCountry && `من: ${shipment.originCountry}`}
                        </p>
                    </div>

                    <div className="flex gap-2">
                        <select
                            value={shipment.destinationWarehouseId || ''}
                            onChange={async (e) => {
                                const wid = e.target.value;
                                if (shipment.status === 'closed') {
                                    showNotification('لا يمكن تغيير المستودع بعد إغلاق الشحنة.', 'error');
                                    return;
                                }
                                if (!shipment.id) return;
                                await updateShipment(shipment.id, { destinationWarehouseId: wid || undefined });
                                setShipment((prev) => (prev ? { ...prev, destinationWarehouseId: wid || undefined } : prev));
                                setReceiptRows([]);
                                setReceiptSelection({});
                            }}
                            disabled={shipment.status === 'closed'}
                            className="px-4 py-2 border rounded-lg"
                        >
                            <option value="">مستودع الوصول...</option>
                            {warehouses.filter(w => w.isActive).map(w => (
                                <option key={w.id} value={w.id}>{w.name}</option>
                            ))}
                        </select>
                        <select
                            value={shipment.status}
                            onChange={(e) => handleUpdateStatus(e.target.value as ImportShipment['status'])}
                            className="px-4 py-2 border rounded-lg"
                        >
                            <option value="draft">مسودة</option>
                            <option value="ordered">تم الطلب</option>
                            <option value="shipped">قيد الشحن</option>
                            <option value="at_customs">في الجمارك</option>
                            <option value="cleared">تم التخليص</option>
                            <option value="delivered">تم التسليم</option>
                            <option value="closed">مغلقة</option>
                            <option value="cancelled">ملغي</option>
                        </select>

                        <button
                            onClick={handleCalculateCost}
                            className="bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-green-700"
                        >
                            <DollarSign className="w-5 h-5" />
                            احتساب التكلفة
                        </button>
                        {shipment.status !== 'closed' && (
                            <button
                                onClick={() => handleUpdateStatus('closed')}
                                className="bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-orange-700"
                            >
                                إغلاق الشحنة
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="text-sm text-gray-600">قيمة البضائع (FOB)</div>
                    <div className="mt-2 space-y-1">
                        {totals.itemsByCurrency.length === 0 ? (
                            <div className="text-2xl font-bold">—</div>
                        ) : (
                            totals.itemsByCurrency.map((r: any) => (
                                <div key={r.currency} className="text-2xl font-bold" dir="ltr">
                                    {Number(r.total || 0).toFixed(2)} <span className="text-base">{r.currency}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg">
                    <div className="text-sm text-gray-600">المصاريف (عملة المصروف)</div>
                    <div className="mt-2 space-y-1">
                        {totals.expensesByCurrency.length === 0 ? (
                            <div className="text-2xl font-bold">—</div>
                        ) : (
                            totals.expensesByCurrency.map((r: any) => (
                                <div key={r.currency} className="text-2xl font-bold" dir="ltr">
                                    {Number(r.total || 0).toFixed(2)} <span className="text-base">{r.currency}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                    <div className="text-sm text-gray-600">إجمالي المصاريف (بالأساسية)</div>
                    <div className="text-2xl font-bold mt-2" dir="ltr">
                        {Number.isFinite(Number(totals.expensesBaseTotal)) ? Number(totals.expensesBaseTotal).toFixed(2) : '—'}{' '}
                        <span className="text-base">{baseCode || '—'}</span>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b mb-6">
                <div className="flex gap-4">
                    <button
                        onClick={() => setActiveTab('items')}
                        className={`pb-2 px-4 ${activeTab === 'items' ? 'border-b-2 border-blue-600 text-blue-600 font-semibold' : 'text-gray-600'}`}
                    >
                        الأصناف ({shipment.items?.length || 0})
                    </button>
                    <button
                        onClick={() => setActiveTab('expenses')}
                        className={`pb-2 px-4 ${activeTab === 'expenses' ? 'border-b-2 border-blue-600 text-blue-600 font-semibold' : 'text-gray-600'}`}
                    >
                        المصاريف ({shipment.expenses?.length || 0})
                    </button>
                    <button
                        onClick={() => { setActiveTab('receipts'); loadReceipts(); }}
                        className={`pb-2 px-4 ${activeTab === 'receipts' ? 'border-b-2 border-blue-600 text-blue-600 font-semibold' : 'text-gray-600'}`}
                    >
                        الاستلامات
                    </button>
                    <button
                        onClick={() => { setActiveTab('pricing'); loadPricing(); }}
                        className={`pb-2 px-4 ${activeTab === 'pricing' ? 'border-b-2 border-blue-600 text-blue-600 font-semibold' : 'text-gray-600'}`}
                    >
                        التسعير
                    </button>
                </div>
            </div>

            {/* Items Tab */}
            {activeTab === 'items' && (
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold">أصناف الشحنة</h2>
                        <button
                            onClick={() => setShowItemForm(!showItemForm)}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700"
                        >
                            <Plus className="w-5 h-5" />
                            إضافة صنف
                        </button>
                    </div>

                    {showItemForm && (
                        <div className="bg-gray-50 p-4 rounded-lg mb-4">
                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">الصنف</label>
                                    <select
                                        value={newItem.itemId}
                                        onChange={(e) => setNewItem({ ...newItem, itemId: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    >
                                        <option value="">اختر صنف</option>
                                        {menuItems.map((item: any) => (
                                            <option key={item.id} value={item.id}>{item.name.ar}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">الكمية</label>
                                    <input
                                        type="number"
                                        value={newItem.quantity}
                                        onChange={(e) => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">سعر الوحدة (FOB)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={newItem.unitPriceFob}
                                        onChange={(e) => setNewItem({ ...newItem, unitPriceFob: Number(e.target.value) })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">العملة</label>
                                    <select
                                        value={newItem.currency}
                                        onChange={(e) => setNewItem({ ...newItem, currency: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    >
                                        <option value="">اختر عملة</option>
                                        {currencyOptions.map((c) => (
                                            <option key={c} value={c}>{c}{baseCode && c === baseCode ? ' (أساسية)' : ''}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleAddItem}
                                    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
                                >
                                    حفظ
                                </button>
                                <button
                                    onClick={() => setShowItemForm(false)}
                                    className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400"
                                >
                                    إلغاء
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        {shipment.items?.map((item: ImportShipmentItem) => {
                            const menuItem = menuItems.find((m: any) => m.id === item.itemId);
                            return (
                                <div key={item.id} className="bg-white border rounded-lg p-4 flex justify-between items-center">
                                    <div className="flex-1">
                                        <div className="font-semibold">{menuItem?.name.ar || item.itemId}</div>
                                        <div className="text-sm text-gray-600">
                                            الكمية: {item.quantity} | السعر: {item.unitPriceFob} {String(item.currency || '—').toUpperCase()}
                                            {item.landingCostPerUnit && ` | التكلفة النهائية: ${item.landingCostPerUnit.toFixed(2)} ${baseCode || '—'}`}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteItem(item.id)}
                                        className="text-red-600 hover:text-red-800"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            );
                        })}
                        {(!shipment.items || shipment.items.length === 0) && (
                            <div className="text-center py-8 text-gray-500">لا توجد أصناف</div>
                        )}
                    </div>
                </div>
            )}

            {/* Expenses Tab */}
            {activeTab === 'expenses' && (
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold">مصاريف الشحنة</h2>
                        <button
                            onClick={() => setShowExpenseForm(!showExpenseForm)}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700"
                        >
                            <Plus className="w-5 h-5" />
                            إضافة مصروف
                        </button>
                    </div>

                    {showExpenseForm && (
                        <div className="bg-gray-50 p-4 rounded-lg mb-4">
                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">نوع المصروف</label>
                                    <select
                                        value={newExpense.expenseType}
                                        onChange={(e) => setNewExpense({ ...newExpense, expenseType: e.target.value as ImportExpense['expenseType'] })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    >
                                        <option value="shipping">شحن</option>
                                        <option value="customs">جمارك</option>
                                        <option value="insurance">تأمين</option>
                                        <option value="clearance">تخليص</option>
                                        <option value="transport">نقل</option>
                                        <option value="other">أخرى</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">المبلغ</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={newExpense.amount}
                                        onChange={(e) => setNewExpense({ ...newExpense, amount: Number(e.target.value) })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">العملة</label>
                                    <select
                                        value={newExpense.currency}
                                        onChange={(e) => {
                                            const code = String(e.target.value || '').toUpperCase();
                                            if (baseCode && code === baseCode) {
                                                setNewExpense((prev) => ({ ...prev, currency: code, exchangeRate: 1 }));
                                                setExpenseFxSource('base');
                                                return;
                                            }
                                            setNewExpense((prev) => ({ ...prev, currency: code, exchangeRate: 0 }));
                                            setExpenseFxSource(isExpenseFxManual ? 'manual' : 'unknown');
                                            if (!isExpenseFxManual) {
                                                void applySystemExpenseFxRate(code);
                                            }
                                        }}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    >
                                        <option value="">اختر عملة</option>
                                        {currencyOptions.map((c) => (
                                            <option key={c} value={c}>{c}{baseCode && c === baseCode ? ' (أساسية)' : ''}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium">سعر الصرف</label>
                                        <label className="flex items-center gap-2 text-xs text-gray-600">
                                            <input
                                                type="checkbox"
                                                checked={isExpenseFxManual}
                                                onChange={(e) => {
                                                    const v = Boolean(e.target.checked);
                                                    setIsExpenseFxManual(v);
                                                    setExpenseFxSource(v ? 'manual' : 'unknown');
                                                    if (!v) {
                                                        void applySystemExpenseFxRate(newExpense.currency || baseCode || '');
                                                    }
                                                }}
                                            />
                                            تعديل يدوي
                                        </label>
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            step="0.000001"
                                            value={newExpense.exchangeRate}
                                            onChange={(e) => {
                                                setNewExpense({ ...newExpense, exchangeRate: Number(e.target.value) });
                                                setExpenseFxSource('manual');
                                            }}
                                            disabled={!isExpenseFxManual || (Boolean(baseCode) && String(newExpense.currency || '').toUpperCase() === baseCode)}
                                            className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setExpenseFxSource('unknown');
                                                void applySystemExpenseFxRate(newExpense.currency || '');
                                            }}
                                            disabled={!newExpense.currency || (Boolean(baseCode) && String(newExpense.currency || '').toUpperCase() === baseCode)}
                                            className="px-3 py-2 rounded-lg bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            من النظام
                                        </button>
                                    </div>
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium mb-1">الوصف</label>
                                    <input
                                        type="text"
                                        value={newExpense.description}
                                        onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleAddExpense}
                                    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
                                >
                                    حفظ
                                </button>
                                <button
                                    onClick={() => {
                                        setShowExpenseForm(false);
                                        setIsExpenseFxManual(false);
                                        setExpenseFxSource('unknown');
                                    }}
                                    className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400"
                                >
                                    إلغاء
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        {shipment.expenses?.map((expense: ImportExpense) => (
                            <div key={expense.id} className="bg-white border rounded-lg p-4 flex justify-between items-center">
                                <div className="flex-1">
                                    <div className="font-semibold">{getExpenseTypeLabel(expense.expenseType)}</div>
                                    <div className="text-sm text-gray-600">
                                        <span dir="ltr">
                                            {Number(expense.amount || 0).toFixed(2)} {String(expense.currency || '—').toUpperCase()}
                                        </span>{' '}
                                        <span dir="ltr">
                                            • FX={Number(expense.exchangeRate || 0).toFixed(6)}
                                        </span>{' '}
                                        <span dir="ltr">
                                            • ≈ {Number.isFinite(Number((expense as any).baseAmount)) ? Number((expense as any).baseAmount).toFixed(2) : '—'} {baseCode || '—'}
                                        </span>
                                        {expense.description && ` | ${expense.description}`}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDeleteExpense(expense.id)}
                                    className="text-red-600 hover:text-red-800"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        ))}
                        {(!shipment.expenses || shipment.expenses.length === 0) && (
                            <div className="text-center py-8 text-gray-500">لا توجد مصاريف</div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'receipts' && (
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-semibold">استلامات مرتبطة بالشحنة</h2>
                        <div className="flex gap-2">
                            <button
                                onClick={() => loadReceipts()}
                                className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300"
                                disabled={receiptsLoading}
                            >
                                تحديث
                            </button>
                            <button
                                onClick={() => syncItemsFromLinkedReceipts()}
                                className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700"
                                disabled={receiptsLoading || receiptsSyncing || shipment.status === 'closed'}
                            >
                                توليد الأصناف
                            </button>
                            <button
                                onClick={() => applyReceiptLinking('link')}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                                disabled={receiptsLoading || shipment.status === 'closed'}
                            >
                                ربط المحدد
                            </button>
                            <button
                                onClick={() => applyReceiptLinking('unlink')}
                                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
                                disabled={receiptsLoading || shipment.status === 'closed'}
                            >
                                فصل الربط
                            </button>
                        </div>
                    </div>

                    {shipment.status === 'closed' && (
                        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded-lg mb-4">
                            الشحنة مغلقة. لا يمكن تعديل ربط الاستلامات.
                        </div>
                    )}

                    <div className="space-y-2">
                        {receiptRows.map((r: any) => {
                            const rid = String(r?.id || '');
                            const receivedAt = r?.received_at ? new Date(String(r.received_at)).toLocaleString('ar-EG-u-nu-latn') : '-';
                            const ref = r?.purchase_order?.reference_number || r?.purchase_order_id || '-';
                            const supplierName = r?.purchase_order?.supplier?.name || '-';
                            const isLinked = String(r?.import_shipment_id || '') === id;
                            return (
                                <div key={rid} className="bg-white border rounded-lg p-4 flex items-center justify-between gap-4">
                                    <label className="flex items-center gap-3 flex-1 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(receiptSelection[rid])}
                                            onChange={(e) => setReceiptSelection(prev => ({ ...prev, [rid]: e.target.checked }))}
                                            disabled={shipment.status === 'closed'}
                                        />
                                        <div className="flex-1">
                                            <div className="font-semibold">{supplierName}</div>
                                            <div className="text-sm text-gray-600">
                                                {receivedAt} {` | `} {ref}
                                            </div>
                                        </div>
                                    </label>
                                    <div className={`px-2 py-1 rounded-full text-xs font-semibold ${isLinked ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                                        {isLinked ? 'مرتبط' : 'غير مرتبط'}
                                    </div>
                                </div>
                            );
                        })}
                        {receiptRows.length === 0 && (
                            <div className="text-center py-8 text-gray-500">لا توجد استلامات</div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'pricing' && (
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-semibold">التكلفة الكاملة والسعر المقترح</h2>
                        <div className="flex gap-2">
                            <select
                                value={pricingTierType}
                                onChange={(e) => setPricingTierType(e.target.value as any)}
                                className="px-4 py-2 border rounded-lg bg-white"
                                disabled={pricingLoading}
                            >
                                <option value="retail">تجزئة</option>
                                <option value="wholesale">جملة</option>
                                <option value="distributor">موزع</option>
                                <option value="vip">VIP</option>
                            </select>
                            <button
                                onClick={() => loadPricing()}
                                className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300"
                                disabled={pricingLoading}
                            >
                                تحديث
                            </button>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {pricingRows.map((row: any) => (
                            <div key={row.itemId} className="bg-white border rounded-lg p-4">
                                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                    <div>
                                        <div className="font-semibold">{row.name}</div>
                                        <div className="text-sm text-gray-600">
                                            {row.unitType} {` | `}
                                            التكلفة/وحدة: {row.avgCost} {` | `}
                                            السعر الحالي: {row.currentPrice}
                                        </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-gray-700">نسبة ربح فوق التكلفة %</span>
                                            <input
                                                type="number"
                                                min={0}
                                                step="0.01"
                                                value={row.marginPct}
                                                onChange={(e) => {
                                                    const val = moneyRound(parseFloat(e.target.value));
                                                    setPricingRows((prev) => prev.map((p: any) => {
                                                        if (p.itemId !== row.itemId) return p;
                                                        const suggested = moneyRound(Number(p.avgCost || 0) * (1 + ((Number.isFinite(val) ? val : 0) / 100)));
                                                        return { ...p, marginPct: Number.isFinite(val) ? val : 0, suggestedPrice: suggested };
                                                    }));
                                                }}
                                                className="w-28 p-2 border rounded-lg text-center font-mono"
                                            />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-gray-700">السعر المقترح</span>
                                            <span className="px-3 py-2 bg-green-50 border border-green-200 rounded-lg font-mono">
                                                {row.suggestedPrice}
                                            </span>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const suggested = Number(row.suggestedPrice || 0);
                                                    if (!(suggested > 0)) return;
                                                    const reason = `اعتماد سعر مقترح من تكلفة الشحنة ${shipment.referenceNumber || shipment.id}`;
                                                    await updatePrice(row.itemId, suggested, reason);
                                                    showNotification('تم اعتماد السعر للصنف', 'success');
                                                    await loadPricing();
                                                } catch (err: any) {
                                                    const raw = err instanceof Error ? err.message : '';
                                                    const msg = raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل اعتماد السعر';
                                                    showNotification(msg, 'error');
                                                }
                                            }}
                                            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                                            disabled={pricingLoading}
                                        >
                                            اعتماد للصنف
                                        </button>
                                        <button
                                            onClick={async () => {
                                                const supabase = getSupabaseClient();
                                                if (!supabase) return;
                                                try {
                                                    const suggested = Number(row.suggestedPrice || 0);
                                                    if (!(suggested > 0)) return;
                                                    setPricingLoading(true);
                                                    const tierMinQty = (row.unitType === 'kg' || row.unitType === 'gram') ? 0 : 1;
                                                    const payload: any = {
                                                        item_id: row.itemId,
                                                        customer_type: pricingTierType,
                                                        min_quantity: tierMinQty,
                                                        max_quantity: null,
                                                        price: suggested,
                                                        discount_percentage: null,
                                                        is_active: true,
                                                        valid_from: null,
                                                        valid_to: null,
                                                        notes: `اعتماد سعر مقترح من الشحنة ${shipment.referenceNumber || shipment.id}`,
                                                        updated_at: new Date().toISOString(),
                                                    };
                                                    const { error } = await supabase
                                                        .from('price_tiers')
                                                        .upsert(payload, { onConflict: 'item_id,customer_type,min_quantity' });
                                                    if (error) throw error;
                                                    showNotification('تم اعتماد السعر على الشريحة', 'success');
                                                } catch (err: any) {
                                                    const raw = err instanceof Error ? err.message : '';
                                                    const msg = raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل اعتماد السعر على الشريحة';
                                                    showNotification(msg, 'error');
                                                } finally {
                                                    setPricingLoading(false);
                                                }
                                            }}
                                            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
                                            disabled={pricingLoading}
                                        >
                                            اعتماد للشريحة
                                        </button>
                                        <button
                                            onClick={async () => {
                                                const supabase = getSupabaseClient();
                                                if (!supabase) return;
                                                const pct = Number(row.marginPct || 0);
                                                const ids = (row.batches || []).map((b: any) => String(b?.id || '')).filter(Boolean);
                                                if (ids.length === 0) return;
                                                try {
                                                    setPricingLoading(true);
                                                    const { error } = await supabase
                                                        .from('batches')
                                                        .update({ min_margin_pct: pct })
                                                        .in('id', ids);
                                                    if (error) throw error;
                                                    showNotification('تم تطبيق الحد الأدنى للدفعات', 'success');
                                                    await loadPricing();
                                                } catch (err: any) {
                                                    const raw = err instanceof Error ? err.message : '';
                                                    const msg = raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل تطبيق الحد الأدنى للدفعات';
                                                    showNotification(msg, 'error');
                                                } finally {
                                                    setPricingLoading(false);
                                                }
                                            }}
                                            className="bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-black"
                                            disabled={pricingLoading}
                                        >
                                            حد أدنى للدفعات
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-4 overflow-x-auto">
                                    <table className="min-w-[900px] w-full text-right text-sm">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="p-2">الدفعة</th>
                                                <th className="p-2">انتهاء</th>
                                                <th className="p-2">مستلم</th>
                                                <th className="p-2">مستهلك</th>
                                                <th className="p-2">متبقي</th>
                                                <th className="p-2">تكلفة/وحدة</th>
                                                <th className="p-2">حد أدنى</th>
                                                <th className="p-2">إجراء</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {(row.batches || []).map((b: any) => (
                                                <tr key={b.id}>
                                                    <td className="p-2 font-mono">{String(b.id).slice(0, 8)}</td>
                                                    <td className="p-2">{b.expiryDate || '-'}</td>
                                                    <td className="p-2 font-mono">{b.quantityReceived}</td>
                                                    <td className="p-2 font-mono">{b.quantityConsumed}</td>
                                                    <td className="p-2 font-mono">{b.remaining}</td>
                                                    <td className="p-2 font-mono">{moneyRound(b.unitCost)}</td>
                                                    <td className="p-2 font-mono">{moneyRound(b.minSellingPrice)}</td>
                                                    <td className="p-2">
                                                        <button
                                                            onClick={async () => {
                                                                const supabase = getSupabaseClient();
                                                                if (!supabase) return;
                                                                const pct = Number(row.marginPct || 0);
                                                                try {
                                                                    setPricingLoading(true);
                                                                    const { error } = await supabase
                                                                        .from('batches')
                                                                        .update({ min_margin_pct: pct })
                                                                        .eq('id', b.id);
                                                                    if (error) throw error;
                                                                    showNotification('تم تحديث حد الدفعة', 'success');
                                                                    await loadPricing();
                                                                } catch (err: any) {
                                                                    const raw = err instanceof Error ? err.message : '';
                                                                    const msg = raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل تحديث حد الدفعة';
                                                                    showNotification(msg, 'error');
                                                                } finally {
                                                                    setPricingLoading(false);
                                                                }
                                                            }}
                                                            className="bg-gray-200 text-gray-800 px-3 py-1 rounded hover:bg-gray-300"
                                                            disabled={pricingLoading}
                                                        >
                                                            تطبيق
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {(row.batches || []).length === 0 && (
                                                <tr>
                                                    <td className="p-4 text-center text-gray-500" colSpan={8}>لا توجد دفعات مرتبطة</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}

                        {pricingRows.length === 0 && (
                            <div className="text-center py-10 text-gray-500">
                                اربط الاستلامات بالشحنة أولاً ثم افتح تبويب التسعير.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImportShipmentDetailsScreen;
