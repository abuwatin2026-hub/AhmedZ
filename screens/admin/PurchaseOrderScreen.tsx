import React, { useMemo, useState } from 'react';
import { usePurchases } from '../../contexts/PurchasesContext';
import { useMenu } from '../../contexts/MenuContext';
import { useStock } from '../../contexts/StockContext';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useToast } from '../../contexts/ToastContext';
import * as Icons from '../../components/icons';
import { MenuItem } from '../../types';
import { PurchaseOrder } from '../../types';

interface OrderItemRow {
    itemId: string;
    quantity: number;
    unitCost: number;
    productionDate?: string;
    expiryDate?: string;
}

interface ReceiveRow {
    itemId: string;
    itemName: string;
    ordered: number;
    received: number;
    remaining: number;
    receiveNow: number;
    productionDate?: string;
    expiryDate?: string;
    previousReturned?: number;
    available?: number;
}

const PurchaseOrderScreen: React.FC = () => {
    const { purchaseOrders, suppliers, createPurchaseOrder, deletePurchaseOrder, cancelPurchaseOrder, recordPurchaseOrderPayment, receivePurchaseOrderPartial, createPurchaseReturn, getPurchaseReturnSummary, loading, error: purchasesError, fetchPurchaseOrders } = usePurchases();
    const { menuItems } = useMenu();
    const { stockItems } = useStock();
    const { user } = useAuth();
    const { settings } = useSettings();
    const { showNotification } = useToast();
    const canDelete = user?.role === 'owner';
    const canCancel = user?.role === 'owner' || user?.role === 'manager';

    const getLocalDateInputValue = (d: Date = new Date()) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const getLocalDateTimeInputValue = (d: Date = new Date()) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    const getErrorMessage = (error: unknown, fallback: string) => {
        if (error instanceof Error && error.message) return error.message;
        return fallback;
    };

    const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test((s || '').trim());
    const normalizeDateInput = (value: string) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (isIsoDate(raw)) return raw;
        const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return raw;
        const a = Number(m[1]);
        const b = Number(m[2]);
        const y = Number(m[3]);
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(y)) return raw;
        if (y < 1900 || y > 2200) return raw;
        let month = a;
        let day = b;
        if (a > 12 && b <= 12) {
            month = b;
            day = a;
        }
        const mm = String(month).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        return `${y}-${mm}-${dd}`;
    };

    const formatPurchaseDate = (value: unknown) => {
        if (typeof value !== 'string') return '-';
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
        if (dateOnly.test(value)) {
            return new Date(`${value}T00:00:00`).toLocaleDateString('ar-EG-u-nu-latn');
        }
        const d = new Date(value);
        if (isNaN(d.getTime())) return value;
        return d.toLocaleDateString('ar-EG-u-nu-latn');
    };

    const activeMenuItems = useMemo(() => {
        return (menuItems || []).filter(i => i && i.status === 'active');
    }, [menuItems]);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
    const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
    const [supplierId, setSupplierId] = useState('');
    const [purchaseDate, setPurchaseDate] = useState(getLocalDateInputValue());
    const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState<string>('');
    const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
    const [receiveOnCreate, setReceiveOnCreate] = useState(true);
    const [quickAddCode, setQuickAddCode] = useState<string>('');
    const [quickAddQuantity, setQuickAddQuantity] = useState<number>(1);
    const [quickAddUnitCost, setQuickAddUnitCost] = useState<number>(0);
    const [bulkLinesText, setBulkLinesText] = useState<string>('');
    const [paymentOrder, setPaymentOrder] = useState<PurchaseOrder | null>(null);
    const [paymentAmount, setPaymentAmount] = useState<number>(0);
    const [paymentMethod, setPaymentMethod] = useState<string>('cash');
    const [paymentOccurredAt, setPaymentOccurredAt] = useState<string>(getLocalDateTimeInputValue());
    const [paymentReferenceNumber, setPaymentReferenceNumber] = useState<string>('');
    const [paymentSenderName, setPaymentSenderName] = useState<string>('');
    const [paymentSenderPhone, setPaymentSenderPhone] = useState<string>('');
    const [paymentDeclaredAmount, setPaymentDeclaredAmount] = useState<number>(0);
    const [paymentAmountConfirmed, setPaymentAmountConfirmed] = useState<boolean>(false);
    const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState<string>('');
    const [receiveOrder, setReceiveOrder] = useState<PurchaseOrder | null>(null);
    const [receiveRows, setReceiveRows] = useState<ReceiveRow[]>([]);
    const [receiveOccurredAt, setReceiveOccurredAt] = useState<string>(getLocalDateTimeInputValue());
    const [isReceivingPartial, setIsReceivingPartial] = useState<boolean>(false);
    const [returnOrder, setReturnOrder] = useState<PurchaseOrder | null>(null);
    const [returnRows, setReturnRows] = useState<ReceiveRow[]>([]);
    const [returnOccurredAt, setReturnOccurredAt] = useState<string>(getLocalDateTimeInputValue());
    const [returnReason, setReturnReason] = useState<string>('');
    const [formErrors, setFormErrors] = useState<string[]>([]);

    // Helper to add a new row
    const addRow = () => {
        setOrderItems([...orderItems, { itemId: '', quantity: 1, unitCost: 0, productionDate: '', expiryDate: '' }]);
    };

    // Helper to update a row
    const updateRow = (index: number, field: keyof OrderItemRow, value: any) => {
        const newRows = [...orderItems];
        newRows[index] = { ...newRows[index], [field]: value };
        setOrderItems(newRows);
    };

    // Helper to remove a row
    const removeRow = (index: number) => {
        const newRows = orderItems.filter((_, i) => i !== index);
        setOrderItems(newRows);
    };

    const calculateTotal = () => {
        return orderItems.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
    };

    const getItemById = (id: string) => activeMenuItems.find(i => i.id === id);
    const getQuantityStep = (itemId: string) => {
        const unit = getItemById(itemId)?.unitType;
        return unit === 'kg' || unit === 'gram' ? 0.5 : 1;
    };

    const normalizeCode = (value: unknown) => String(value || '').trim();

    const findItemByCode = (codeRaw: string) => {
        const code = normalizeCode(codeRaw);
        if (!code) return null;
        const codeLower = code.toLowerCase();
        return (activeMenuItems || []).find((m) => {
            const id = String(m.id || '').trim();
            const barcode = String((m as any).barcode || '').trim();
            return id.toLowerCase() === codeLower || barcode.toLowerCase() === codeLower;
        }) || null;
    };

    const appendOrderItem = (itemId: string, quantity: number, unitCost: number) => {
        const step = getQuantityStep(itemId);
        const q = Math.max(step, Number(quantity) || 0);
        const c = Math.max(0, Number(unitCost) || 0);
        setOrderItems((prev) => {
            const idx = prev.findIndex((r) => r.itemId === itemId && Number(r.unitCost || 0) === c);
            if (idx === -1) {
                return [...prev, { itemId, quantity: q, unitCost: c, productionDate: '', expiryDate: '' }];
            }
            const next = [...prev];
            const row = next[idx];
            next[idx] = { ...row, quantity: Number(row.quantity || 0) + q };
            return next;
        });
    };

    const handleQuickAdd = () => {
        const item = findItemByCode(quickAddCode);
        if (!item) {
            showNotification('لم يتم العثور على صنف بهذا الباركود/الكود.', 'error');
            return;
        }
        appendOrderItem(item.id, quickAddQuantity, quickAddUnitCost);
        setQuickAddCode('');
    };

    const parseBulkNumber = (value: string) => {
        const v = String(value || '').trim().replace(/,/g, '.');
        const n = Number(v);
        return Number.isFinite(n) ? n : NaN;
    };

    const handleBulkAdd = () => {
        const raw = String(bulkLinesText || '').trim();
        if (!raw) return;
        const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        let added = 0;
        const missing: string[] = [];
        let invalidCount = 0;

        for (const line of lines) {
            const parts = line.split(/[\t,;|]+/g).map(p => p.trim()).filter(Boolean);
            if (parts.length < 2) {
                invalidCount += 1;
                continue;
            }
            const code = parts[0];
            const quantity = parseBulkNumber(parts[1]);
            const unitCost = parts.length >= 3 ? parseBulkNumber(parts[2]) : 0;
            if (!Number.isFinite(quantity) || quantity <= 0) {
                invalidCount += 1;
                continue;
            }
            if (parts.length >= 3 && (!Number.isFinite(unitCost) || unitCost < 0)) {
                invalidCount += 1;
                continue;
            }
            const item = findItemByCode(code);
            if (!item) {
                missing.push(code);
                continue;
            }
            appendOrderItem(item.id, quantity, Number.isFinite(unitCost) ? unitCost : 0);
            added += 1;
        }

        if (added > 0) showNotification(`تمت إضافة ${added} سطر من الإدخال السريع.`, 'success');
        if (missing.length > 0) {
            const sample = missing.slice(0, 6).join('، ');
            showNotification(`تعذر العثور على ${missing.length} كود: ${sample}${missing.length > 6 ? '…' : ''}`, 'info');
        }
        if (invalidCount > 0) showNotification(`تم تجاهل ${invalidCount} سطر غير صالح.`, 'info');
    };

    const lowStockSuggestions = useMemo(() => {
        try {
            return stockItems
                .filter(s => (s.availableQuantity - (s as any).reservedQuantity) <= ((s as any).lowStockThreshold ?? 5))
                .map(s => {
                    const item = getItemById(s.itemId);
                    const available = s.availableQuantity - (s as any).reservedQuantity;
                    const threshold = (s as any).lowStockThreshold ?? 5;
                    let recommended = Math.max(0, threshold - available);
                    const step = (item?.unitType === 'kg' || item?.unitType === 'gram') ? 0.5 : 1;
                    if (step === 0.5) {
                        recommended = Math.max(step, Math.round(recommended / step) * step);
                    } else {
                        recommended = Math.max(step, Math.ceil(recommended));
                    }
                    return { item, available, threshold, recommended, step };
                })
                .filter(s => s.item)
                .slice(0, 8);
        } catch {
            return [];
        }
    }, [stockItems, menuItems]);

    const addRowForItem = (itemId: string, qty: number) => {
        const step = getQuantityStep(itemId);
        const quantity = Math.max(step, qty || step);
        setOrderItems(prev => [...prev, { itemId, quantity, unitCost: 0, productionDate: '', expiryDate: '' }]);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const invoiceRef = typeof supplierInvoiceNumber === 'string' ? supplierInvoiceNumber.trim() : '';
            const errors: string[] = [];
            if (!supplierId) errors.push('المورد مطلوب');
            if (!purchaseDate) errors.push('تاريخ الشراء مطلوب');
            if (!invoiceRef) errors.push('رقم فاتورة المورد مطلوب');
            if (orderItems.length === 0) errors.push('أضف صنف واحد على الأقل');
            const normalizedItems = orderItems.map((row) => ({
                ...row,
                productionDate: normalizeDateInput(row.productionDate || ''),
                expiryDate: normalizeDateInput(row.expiryDate || ''),
            }));
            normalizedItems.forEach((row, idx) => {
                const rowNo = idx + 1;
                if (!row.itemId) errors.push(`سطر ${rowNo}: الصنف مطلوب`);
                if (!Number.isFinite(row.quantity) || Number(row.quantity) <= 0) errors.push(`سطر ${rowNo}: الكمية مطلوبة`);
                if (!Number.isFinite(row.unitCost) || Number(row.unitCost) < 0) errors.push(`سطر ${rowNo}: سعر الشراء مطلوب`);
                const item = row.itemId ? getItemById(row.itemId) : null;
                const exp = typeof row.expiryDate === 'string' ? row.expiryDate.trim() : '';
                const hv = typeof row.productionDate === 'string' ? row.productionDate.trim() : '';
                if (receiveOnCreate && item && item.category === 'food') {
                    if (!exp) errors.push(`سطر ${rowNo}: تاريخ الانتهاء مطلوب للصنف الغذائي (${item.name.ar})`);
                    else if (!isIsoDate(exp)) errors.push(`سطر ${rowNo}: صيغة تاريخ الانتهاء غير صحيحة (YYYY-MM-DD) للصنف (${item.name.ar})`);
                }
                if (hv && !isIsoDate(hv)) {
                    const nm = item ? item.name.ar : (row.itemId || `سطر ${rowNo}`);
                    errors.push(`سطر ${rowNo}: صيغة تاريخ الإنتاج غير صحيحة (YYYY-MM-DD) للصنف (${nm})`);
                }
            });
            if (errors.length > 0) {
                setFormErrors(errors);
                return;
            }
            const validItems = normalizedItems.filter(i => i.itemId && i.quantity > 0);
            await createPurchaseOrder(supplierId, purchaseDate, validItems, receiveOnCreate, invoiceRef);
            setIsModalOpen(false);
            // Reset form
            setSupplierId('');
            setSupplierInvoiceNumber('');
            setOrderItems([]);
            setFormErrors([]);
        } catch (error) {
            console.error(error);
            const message = error instanceof Error ? error.message : 'فشل إنشاء أمر الشراء.';
            try {
                const raw = String(message || '').toLowerCase();
                if (/(missing|required|الحقول المطلوبة ناقصة)/i.test(raw)) {
                    const hints: string[] = [
                        `تفاصيل الخطأ: ${message}`,
                        'تحقق من اختيار المورد',
                        'تحقق من إدخال تاريخ الشراء',
                        'تحقق من إدخال رقم فاتورة المورد',
                        'تحقق من أن لكل سطر: الصنف والكمية وسعر الشراء',
                    ];
                    if (receiveOnCreate) {
                        hints.push('للأصناف الغذائية عند الاستلام الآن: تاريخ الانتهاء بصيغة YYYY-MM-DD');
                    }
                    setFormErrors(hints);
                    return;
                }
            } catch {
            }
            alert(message);
        }
    };

    const openReceiveModal = (order: PurchaseOrder) => {
        const rows: ReceiveRow[] = (order.items || []).map((it: any) => {
            const ordered = Number(it.quantity || 0);
            const received = Number(it.receivedQuantity || 0);
            const remaining = Math.max(0, ordered - received);
            const base = getItemById(it.itemId);
            return {
                itemId: it.itemId,
                itemName: it.itemName || it.itemId,
                ordered,
                received,
                remaining,
                receiveNow: remaining,
                productionDate: (base?.productionDate || (base as any)?.harvestDate || ''),
                expiryDate: base?.expiryDate || ''
            };
        });
        setReceiveOrder(order);
        setReceiveRows(rows);
        setReceiveOccurredAt(getLocalDateTimeInputValue());
        setIsReceiveModalOpen(true);
    };

    const updateReceiveRow = (index: number, value: number) => {
        const next = [...receiveRows];
        const row = next[index];
        const v = Number(value || 0);
        next[index] = { ...row, receiveNow: Math.max(0, Math.min(row.remaining, v)) };
        setReceiveRows(next);
    };
    const updateReceiveProduction = (index: number, value: string) => {
        const next = [...receiveRows];
        next[index] = { ...next[index], productionDate: value || '' };
        setReceiveRows(next);
    };
    const updateReceiveExpiry = (index: number, value: string) => {
        const next = [...receiveRows];
        next[index] = { ...next[index], expiryDate: value || '' };
        setReceiveRows(next);
    };

    const handleReceivePartial = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!receiveOrder) return;
        if (isReceivingPartial) return;
        setIsReceivingPartial(true);
        try {
            const normalizedRows = receiveRows.map((r) => ({
                ...r,
                productionDate: normalizeDateInput(r.productionDate || ''),
                expiryDate: normalizeDateInput(r.expiryDate || ''),
            }));
            for (const r of normalizedRows) {
                if (Number(r.receiveNow) <= 0) continue;
                const item = getItemById(r.itemId);
                if (item && item.category === 'food') {
                    const exp = typeof r.expiryDate === 'string' ? r.expiryDate.trim() : '';
                    if (!exp) {
                        alert(`يرجى إدخال تاريخ الانتهاء للصنف الغذائي: ${item.name.ar}`);
                        return;
                    }
                    if (!isIsoDate(exp)) {
                        alert(`صيغة تاريخ الانتهاء غير صحيحة (YYYY-MM-DD) للصنف: ${item.name.ar}`);
                        return;
                    }
                }
                const hv = typeof r.productionDate === 'string' ? r.productionDate.trim() : '';
                if (hv && !isIsoDate(hv)) {
                    const nm = item ? item.name.ar : r.itemName || r.itemId;
                    alert(`صيغة تاريخ الإنتاج غير صحيحة (YYYY-MM-DD) للصنف: ${nm}`);
                    return;
                }
            }
            const items = normalizedRows
                .filter(r => Number(r.receiveNow) > 0)
                .map(r => ({
                    itemId: r.itemId,
                    quantity: Number(r.receiveNow),
                    productionDate: r.productionDate || undefined,
                    expiryDate: r.expiryDate || undefined,
                }));
            if (items.length === 0) {
                alert('الرجاء إدخال كمية للاستلام.');
                return;
            }
            await receivePurchaseOrderPartial(receiveOrder.id, items, receiveOccurredAt);
            setIsReceiveModalOpen(false);
            setReceiveOrder(null);
            setReceiveRows([]);
        } catch (error) {
            console.error(error);
            alert(getErrorMessage(error, 'فشل استلام المخزون.'));
        } finally {
            setIsReceivingPartial(false);
        }
    };

    const openReturnModal = async (order: PurchaseOrder) => {
        const summary = await getPurchaseReturnSummary(order.id);
        const rows: ReceiveRow[] = (order.items || []).map((it: any) => {
            const ordered = Number(it.quantity || 0);
            const received = Number(it.receivedQuantity || 0);
            const prev = Number(summary[it.itemId] || 0);
            const remaining = Math.max(0, received - prev);
            const stock = stockItems.find(s => s.itemId === it.itemId);
            const available = stock ? Math.max(0, (stock as any).availableQuantity - (stock as any).reservedQuantity) : 0;
            return {
                itemId: it.itemId,
                itemName: it.itemName || it.itemId,
                ordered,
                received,
                previousReturned: prev,
                remaining,
                receiveNow: remaining > 0 ? 0 : 0,
                available
            };
        });
        setReturnOrder(order);
        setReturnRows(rows);
        setReturnOccurredAt(getLocalDateTimeInputValue());
        setReturnReason('');
        setIsReturnModalOpen(true);
    };

    const updateReturnRow = (index: number, value: number) => {
        const next = [...returnRows];
        const row = next[index];
        const v = Number(value || 0);
        next[index] = { ...row, receiveNow: Math.max(0, Math.min(row.remaining, v)) };
        setReturnRows(next);
    };

    const handleCreateReturn = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!returnOrder) return;
        try {
            const items = returnRows
                .filter(r => Number(r.receiveNow) > 0)
                .map(r => ({ itemId: r.itemId, quantity: Number(r.receiveNow) }));
            if (items.length === 0) {
                alert('الرجاء إدخال كمية للمرتجع.');
                return;
            }
            await createPurchaseReturn(returnOrder.id, items, returnReason, returnOccurredAt);
            showNotification('تم تسجيل المرتجع بنجاح.', 'success', 3500);
            setIsReturnModalOpen(false);
            setReturnOrder(null);
            setReturnRows([]);
        } catch (error) {
            console.error(error);
            let message = getErrorMessage(error, 'فشل تسجيل المرتجع.');
            const lower = typeof message === 'string' ? message.toLowerCase() : '';
            if (lower.includes('return exceeds received')) {
                message = 'الكمية المرتجعة تتجاوز المستلمة لأحد الأصناف.';
            } else if (lower.includes('insufficient stock for return')) {
                message = 'المخزون الحالي لا يكفي لإتمام المرتجع لأحد الأصناف.';
            }
            alert(message);
        }
    };

    const availablePaymentMethods = useMemo(() => {
        const enabled = Object.entries(settings.paymentMethods || {})
            .filter(([, isEnabled]) => Boolean(isEnabled))
            .map(([key]) => key);
        return enabled;
    }, [settings.paymentMethods]);

    const getPaymentMethodLabel = (method: string) => {
        if (method === 'cash') return 'نقدًا';
        if (method === 'kuraimi') return 'حسابات بنكية';
        if (method === 'network') return 'حوالات';
        return method;
    };

    const openPaymentModal = (order: PurchaseOrder) => {
        const remaining = Math.max(0, Number(order.totalAmount || 0) - Number(order.paidAmount || 0));
        setPaymentOrder(order);
        setPaymentAmount(remaining);
        const nextMethod = availablePaymentMethods.length > 0 ? availablePaymentMethods[0] : '';
        setPaymentMethod(nextMethod);
        setPaymentOccurredAt(getLocalDateTimeInputValue());
        setPaymentReferenceNumber('');
        setPaymentSenderName('');
        setPaymentSenderPhone('');
        setPaymentDeclaredAmount(remaining);
        setPaymentAmountConfirmed(false);
        setPaymentIdempotencyKey(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
        setIsPaymentModalOpen(true);
    };

    const handleRecordPayment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!paymentOrder) return;
        try {
            const total = Number(paymentOrder.totalAmount || 0);
            const paid = Number(paymentOrder.paidAmount || 0);
            const remaining = Math.max(0, total - paid);
            const amount = Number(paymentAmount || 0);
            const needsReference = paymentMethod === 'kuraimi' || paymentMethod === 'network';

            if (amount <= 0) {
                alert('الرجاء إدخال مبلغ صحيح.');
                return;
            }
            if (amount > remaining + 1e-9) {
                alert('المبلغ أكبر من المتبقي على أمر الشراء.');
                return;
            }
            if (!paymentMethod || (availablePaymentMethods.length > 0 && !availablePaymentMethods.includes(paymentMethod))) {
                alert('الرجاء اختيار طريقة دفع صحيحة.');
                return;
            }
            if (needsReference) {
                if (!paymentReferenceNumber.trim()) {
                    alert(paymentMethod === 'kuraimi' ? 'يرجى إدخال رقم الإيداع.' : 'يرجى إدخال رقم الحوالة.');
                    return;
                }
                if (!paymentSenderName.trim()) {
                    alert(paymentMethod === 'kuraimi' ? 'يرجى إدخال اسم المودِع.' : 'يرجى إدخال اسم المرسل.');
                    return;
                }
                const declared = Number(paymentDeclaredAmount) || 0;
                if (declared <= 0) {
                    alert('يرجى إدخال مبلغ العملية.');
                    return;
                }
                if (Math.abs(declared - amount) > 0.0001) {
                    alert('المبلغ المُدخل لا يطابق مبلغ الدفعة.');
                    return;
                }
                if (!paymentAmountConfirmed) {
                    alert('يرجى تأكيد مطابقة المبلغ قبل تسجيل الدفعة.');
                    return;
                }
            }

            await recordPurchaseOrderPayment(
                paymentOrder.id,
                amount,
                paymentMethod,
                paymentOccurredAt,
                needsReference
                    ? {
                        idempotencyKey: paymentIdempotencyKey,
                        paymentProofType: 'ref_number',
                        paymentProof: paymentReferenceNumber.trim(),
                        paymentReferenceNumber: paymentReferenceNumber.trim(),
                        paymentSenderName: paymentSenderName.trim(),
                        paymentSenderPhone: paymentSenderPhone.trim() || null,
                        paymentDeclaredAmount: Number(paymentDeclaredAmount) || 0,
                        paymentAmountConfirmed: Boolean(paymentAmountConfirmed),
                      }
                    : { idempotencyKey: paymentIdempotencyKey }
            );

            setIsPaymentModalOpen(false);
            setPaymentOrder(null);
        } catch (error) {
            console.error(error);
            alert(getErrorMessage(error, 'فشل تسجيل الدفعة.'));
        }
    };

    if (loading) return <div className="p-8 text-center">Loading...</div>;

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
                <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-l from-primary-600 to-gold-500">
                    أوامر الشراء (المخزون)
                </h1>
                <button
                    onClick={() => {
                        setIsModalOpen(true);
                        setSupplierInvoiceNumber('');
                        setQuickAddCode('');
                        setQuickAddQuantity(1);
                        setQuickAddUnitCost(0);
                        setBulkLinesText('');
                        setOrderItems([]);
                        addRow();
                    }}
                    className="bg-primary-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-primary-600 shadow-lg self-end sm:self-auto"
                >
                    <Icons.PlusIcon className="w-5 h-5" />
                    <span>أمر شراء جديد</span>
                </button>
            </div>

            {purchasesError ? (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-right text-sm text-red-700 flex items-center justify-between gap-3">
                    <div className="flex-1">{purchasesError}</div>
                    <button
                        type="button"
                        onClick={() => fetchPurchaseOrders().catch((e) => alert(getErrorMessage(e, 'فشل تحديث القائمة.')))}
                        className="px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700"
                    >
                        تحديث
                    </button>
                </div>
            ) : null}

            {/* List of Orders */}
            <div className="md:hidden space-y-3">
                {purchaseOrders.length === 0 ? (
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-6 text-center text-gray-500">
                        لا توجد أوامر شراء سابقة.
                    </div>
                ) : (
                    purchaseOrders.map((order) => {
                        const total = Number(order.totalAmount || 0);
                        const paid = Number(order.paidAmount || 0);
                        const remainingRaw = total - paid;
                        const remaining = Math.max(0, remainingRaw);
                        const credit = Math.max(0, -remainingRaw);
                        const totalQty = (order.items || []).reduce((sum: number, it: any) => sum + Number(it?.quantity || 0), 0);
                        const linesCount = Number(order.itemsCount ?? (order.items || []).length ?? 0);
                        const canPay = order.status !== 'cancelled' && remainingRaw > 0;
                        const hasReceived = (order.items || []).some((it: any) => Number(it?.receivedQuantity || 0) > 0);
                        const canPurge = canDelete && order.status === 'draft' && paid <= 0 && !hasReceived;
                        const canCancelOrder = canCancel && order.status === 'draft' && paid <= 0 && !hasReceived;
                        const statusClass = order.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : order.status === 'partial'
                                ? 'bg-yellow-100 text-yellow-700'
                                : order.status === 'cancelled'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-gray-100 text-gray-700';
                        const statusLabel = order.status === 'completed'
                            ? 'مستلم بالكامل'
                            : order.status === 'partial'
                                ? 'مستلم جزئيًا'
                                : order.status === 'draft'
                                    ? 'مسودة'
                                    : 'ملغي';

                        return (
                            <div key={order.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-sm text-gray-500 dark:text-gray-400">رقم المرجع (فاتورة المورد)</div>
                                        <div className="font-mono text-sm dark:text-gray-200 break-all">{order.referenceNumber || '-'}</div>
                                    </div>
                                    <span className={['px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap', statusClass].join(' ')}>
                                        {statusLabel}
                                    </span>
                                    {order.hasReturns ? (
                                        <span className="px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap bg-blue-100 text-blue-700">
                                            {total <= 1e-9 ? 'مرتجع كلي' : 'مرتجع جزئي'}
                                        </span>
                                    ) : null}
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">المورد</div>
                                        <div className="font-medium dark:text-white break-words">{order.supplierName || '-'}</div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">التاريخ</div>
                                        <div className="dark:text-gray-200">{formatPurchaseDate(order.purchaseDate)}</div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">الإجمالي</div>
                                        <div className="font-bold text-primary-600 dark:text-primary-400">{total.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">المتبقي</div>
                                        <div className="font-mono dark:text-gray-200">{remaining.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">عدد الأصناف (سطور)</div>
                                        <div className="font-mono dark:text-gray-200">{linesCount}</div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500 dark:text-gray-400">إجمالي الكميات</div>
                                        <div className="font-mono dark:text-gray-200">{totalQty}</div>
                                    </div>
                                    {credit > 0 ? (
                                        <div className="col-span-2">
                                            <div className="text-gray-500 dark:text-gray-400">رصيد لك لدى المورد</div>
                                            <div className="font-mono font-semibold text-blue-700 dark:text-blue-300">{credit.toFixed(2)}</div>
                                        </div>
                                    ) : null}
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2 justify-end">
                                    <button
                                        type="button"
                                        onClick={() => openReceiveModal(order)}
                                        disabled={order.status === 'cancelled' || order.status === 'completed'}
                                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        استلام
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => openReturnModal(order)}
                                        disabled={order.status === 'cancelled'}
                                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        مرتجع
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => openPaymentModal(order)}
                                        disabled={!canPay}
                                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {order.hasReturns ? 'تسجيل دفعة (بعد المرتجع)' : 'تسجيل دفعة'}
                                    </button>
                                    {canCancelOrder ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const ref = order.referenceNumber || order.id;
                                                const reason = window.prompt(`سبب الإلغاء (اختياري): ${ref}`) ?? '';
                                                const ok = window.confirm(`سيتم إلغاء أمر الشراء: ${ref}\nهل أنت متأكد؟`);
                                                if (!ok) return;
                                                cancelPurchaseOrder(order.id, reason)
                                                    .catch((e) => alert(getErrorMessage(e, 'فشل إلغاء أمر الشراء.')));
                                            }}
                                            className="px-3 py-2 rounded-lg text-sm font-semibold bg-orange-600 text-white hover:bg-orange-700"
                                        >
                                            إلغاء
                                        </button>
                                    ) : null}
                                    {canPurge ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const ref = order.referenceNumber || order.id;
                                                const ok = window.confirm(`سيتم حذف أمر الشراء نهائياً: ${ref}\nهل أنت متأكد؟`);
                                                if (!ok) return;
                                                deletePurchaseOrder(order.id)
                                                    .catch((e) => alert(getErrorMessage(e, 'فشل حذف أمر الشراء.')));
                                            }}
                                            className="px-3 py-2 rounded-lg text-sm font-semibold bg-gray-900 text-white hover:bg-black"
                                        >
                                            حذف
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-x-auto">
                <table className="min-w-[1100px] w-full text-right">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                        <tr>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">رقم المرجع (فاتورة المورد)</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">المورد</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">التاريخ</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">عدد الأصناف (سطور/كمية)</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">الإجمالي</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">المدفوع</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">المتبقي</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">الحالة</th>
                            <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">إجراء</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {purchaseOrders.length === 0 ? (
                            <tr><td colSpan={9} className="p-8 text-center text-gray-500">لا توجد أوامر شراء سابقة.</td></tr>
                        ) : (
                            purchaseOrders.map((order) => (
                                (() => {
                                    const total = Number(order.totalAmount || 0);
                                    const paid = Number(order.paidAmount || 0);
                                    const remainingRaw = total - paid;
                                    const remaining = Math.max(0, remainingRaw);
                                    const credit = Math.max(0, -remainingRaw);
                                    const totalQty = (order.items || []).reduce((sum: number, it: any) => sum + Number(it?.quantity || 0), 0);
                                    const canPay = order.status !== 'cancelled' && remainingRaw > 0;
                                    const hasReceived = (order.items || []).some((it: any) => Number(it?.receivedQuantity || 0) > 0);
                                    const canPurge = canDelete && order.status === 'draft' && paid <= 0 && !hasReceived;
                                    const canCancelOrder = canCancel && order.status === 'draft' && paid <= 0 && !hasReceived;
                                    return (
                                <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                    <td className="p-4 font-mono text-sm dark:text-gray-300">{order.referenceNumber || '-'}</td>
                                    <td className="p-4 font-medium dark:text-white">{order.supplierName}</td>
                                    <td className="p-4 text-sm dark:text-gray-300">{formatPurchaseDate(order.purchaseDate)}</td>
                                    <td className="p-4 text-sm dark:text-gray-300 font-mono">{Number(order.itemsCount ?? 0)} / {totalQty}</td>
                                    <td className="p-4 font-bold text-primary-600 dark:text-primary-400">{order.totalAmount.toFixed(2)}</td>
                                    <td className="p-4 font-mono text-sm dark:text-gray-300">{paid.toFixed(2)}</td>
                                    <td className="p-4 font-mono text-sm dark:text-gray-300">{remaining.toFixed(2)}</td>
                                    <td className="p-4">
                                        <span className={[
                                            'px-2 py-1 rounded-full text-xs font-bold',
                                            order.status === 'completed' ? 'bg-green-100 text-green-700'
                                                : order.status === 'partial' ? 'bg-yellow-100 text-yellow-700'
                                                    : order.status === 'cancelled' ? 'bg-red-100 text-red-700'
                                                        : 'bg-gray-100 text-gray-700'
                                        ].join(' ')}>
                                            {order.status === 'completed'
                                                ? 'مستلم بالكامل'
                                                : order.status === 'partial'
                                                    ? 'مستلم جزئيًا'
                                                    : order.status === 'draft'
                                                        ? 'مسودة'
                                                        : 'ملغي'}
                                        </span>
                                        {order.hasReturns ? (
                                            <span className="ml-2 px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
                                                {total <= 1e-9 ? 'مرتجع كلي' : 'مرتجع جزئي'}
                                            </span>
                                        ) : null}
                                        {credit > 0 ? (
                                            <span className="ml-2 px-2 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700">
                                                رصيد لك: {credit.toFixed(2)}
                                            </span>
                                        ) : null}
                                    </td>
                                    <td className="p-4">
                                        <div className="flex flex-wrap gap-2 justify-end">
                                            <button
                                                type="button"
                                                onClick={() => openReceiveModal(order)}
                                                disabled={order.status === 'cancelled' || order.status === 'completed'}
                                                className="px-3 py-2 rounded-lg text-sm font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                استلام
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => openReturnModal(order)}
                                                disabled={order.status === 'cancelled'}
                                                className="px-3 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                مرتجع
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => openPaymentModal(order)}
                                                disabled={!canPay}
                                                className="px-3 py-2 rounded-lg text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {order.hasReturns ? 'تسجيل دفعة (بعد المرتجع)' : 'تسجيل دفعة'}
                                            </button>
                                            {canCancelOrder ? (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const ref = order.referenceNumber || order.id;
                                                        const reason = window.prompt(`سبب الإلغاء (اختياري): ${ref}`) ?? '';
                                                        const ok = window.confirm(`سيتم إلغاء أمر الشراء: ${ref}\nهل أنت متأكد؟`);
                                                        if (!ok) return;
                                                        cancelPurchaseOrder(order.id, reason)
                                                            .catch((e) => alert(getErrorMessage(e, 'فشل إلغاء أمر الشراء.')));
                                                    }}
                                                    className="px-3 py-2 rounded-lg text-sm font-semibold bg-orange-600 text-white hover:bg-orange-700"
                                                >
                                                    إلغاء
                                                </button>
                                            ) : null}
                                            {canPurge ? (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const ref = order.referenceNumber || order.id;
                                                        const ok = window.confirm(`سيتم حذف أمر الشراء نهائياً: ${ref}\nهل أنت متأكد؟`);
                                                        if (!ok) return;
                                                        deletePurchaseOrder(order.id)
                                                            .catch((e) => alert(getErrorMessage(e, 'فشل حذف أمر الشراء.')));
                                                    }}
                                                    className="px-3 py-2 rounded-lg text-sm font-semibold bg-gray-900 text-white hover:bg-black"
                                                >
                                                    حذف
                                                </button>
                                            ) : null}
                                        </div>
                                    </td>
                                </tr>
                                    );
                                })()
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Create Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[min(90dvh,calc(100dvh-2rem))] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 flex justify-between items-center flex-shrink-0">
                            <h2 className="text-xl font-bold dark:text-white">إضافة أمر شراء / استلام مخزون</h2>
                            <button onClick={() => setIsModalOpen(false)} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"><Icons.XIcon className="w-6 h-6" /></button>
                        </div>

                        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
                            <div className="p-6 overflow-y-auto flex-1 space-y-6">
                                {formErrors.length > 0 && (
                                    <div className="sticky top-0 z-10 mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-right text-sm text-red-700">
                                        <div className="font-semibold mb-1">يرجى تصحيح العناصر التالية:</div>
                                        <ul className="space-y-1 list-disc pr-5">
                                            {formErrors.slice(0, 12).map((msg, i) => (
                                                <li key={i}>{msg}</li>
                                            ))}
                                        </ul>
                                        {formErrors.length > 12 ? (
                                            <div className="mt-1">+ {formErrors.length - 12} أخرى</div>
                                        ) : null}
                                    </div>
                                )}
                                {/* Header Info */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">المورد</label>
                                        <select
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            value={supplierId}
                                            required
                                            onChange={(e) => setSupplierId(e.target.value)}
                                        >
                                            <option value="">اختر المورد...</option>
                                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">تاريخ الشراء</label>
                                        <input
                                            type="date"
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            value={purchaseDate}
                                            required
                                            onChange={(e) => setPurchaseDate(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">رقم المرجع (فاتورة المورد)</label>
                                        <input
                                            type="text"
                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            value={supplierInvoiceNumber}
                                            required
                                            placeholder="أدخل رقم فاتورة المورد"
                                            onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        id="receiveOnCreate"
                                        type="checkbox"
                                        checked={receiveOnCreate}
                                        onChange={(e) => setReceiveOnCreate(e.target.checked)}
                                    />
                                    <label htmlFor="receiveOnCreate" className="text-sm font-medium dark:text-gray-300">
                                        استلام المخزون الآن
                                    </label>
                                </div>

                                <div className="bg-gray-50 dark:bg-gray-700/30 border dark:border-gray-700 rounded-xl p-4 space-y-3">
                                    <div className="font-bold dark:text-gray-100">إدخال سريع</div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">باركود/كود الصنف</label>
                                            <input
                                                type="text"
                                                value={quickAddCode}
                                                onChange={(e) => setQuickAddCode(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleQuickAdd();
                                                    }
                                                }}
                                                className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white font-mono"
                                                placeholder="امسح الباركود ثم Enter"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">الكمية</label>
                                            <input
                                                type="number"
                                                value={quickAddQuantity}
                                                min={0}
                                                step="0.01"
                                                onChange={(e) => setQuickAddQuantity(Number(e.target.value) || 0)}
                                                className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white font-mono"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">سعر الشراء (للوحدة)</label>
                                            <input
                                                type="number"
                                                value={quickAddUnitCost}
                                                min={0}
                                                step="0.01"
                                                onChange={(e) => setQuickAddUnitCost(Number(e.target.value) || 0)}
                                                className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white font-mono"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={handleQuickAdd}
                                            className="px-4 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700"
                                        >
                                            إضافة
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        <label className="block text-sm font-medium dark:text-gray-300">لصق من إكسل/CSV (كود, كمية, سعر)</label>
                                        <textarea
                                            value={bulkLinesText}
                                            onChange={(e) => setBulkLinesText(e.target.value)}
                                            className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600 dark:text-white font-mono text-sm min-h-[100px]"
                                            placeholder={"مثال:\n1234567890123\t10\t120\nITEM-001,5,80"}
                                        />
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={handleBulkAdd}
                                                className="px-4 py-2 rounded-lg bg-gray-900 text-white font-semibold hover:bg-black"
                                            >
                                                إضافة من النص
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Items Table */}
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <h3 className="font-bold dark:text-gray-200">الأصناف</h3>
                                        <button type="button" onClick={addRow} className="text-sm text-primary-600 hover:text-primary-700 font-semibold">+ إضافة صنف</button>
                                    </div>
                                    <div className="border rounded-lg overflow-hidden dark:border-gray-700">
                                        <div className="overflow-x-auto">
                                        <table className="min-w-[720px] w-full text-right text-sm">
                                            <thead className="bg-gray-50 dark:bg-gray-700">
                                                <tr>
                                                    <th className="p-2 sm:p-3 w-1/2">الصنف</th>
                                                    <th className="p-2 sm:p-3 w-24">الكمية</th>
                                                    <th className="p-2 sm:p-3 w-32">سعر الشراء (للوحدة)</th>
                                                    <th className="p-2 sm:p-3 w-32">الإجمالي</th>
                                                    {receiveOnCreate ? (
                                                        <>
                                                            <th className="p-2 sm:p-3 w-40">تاريخ الإنتاج</th>
                                                            <th className="p-2 sm:p-3 w-40">تاريخ الانتهاء</th>
                                                        </>
                                                    ) : null}
                                                    <th className="p-2 sm:p-3 w-10"></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                                {orderItems.map((row, index) => (
                                                    <tr key={index}>
                                                        <td className="p-2 sm:p-2">
                                                            <select
                                                                className="w-full p-1 border rounded"
                                                                value={row.itemId}
                                                                required
                                                                onChange={(e) => updateRow(index, 'itemId', e.target.value)}
                                                            >
                                                                <option value="">اختر صنف...</option>
                                                                {activeMenuItems.map((item: MenuItem) => (
                                                                    <option key={item.id} value={item.id}>{item.name.ar} (الحالي: {item.availableStock})</option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td className="p-2 sm:p-2">
                                                            <input
                                                                type="number"
                                                                min={getQuantityStep(row.itemId)}
                                                                step={getQuantityStep(row.itemId)}
                                                                required
                                                                className="w-full p-1 border rounded text-center font-mono"
                                                                value={row.quantity}
                                                                onChange={(e) => updateRow(index, 'quantity', parseFloat(e.target.value))}
                                                            />
                                                        </td>
                                                        <td className="p-2 sm:p-2">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                step="0.01"
                                                                required
                                                                className="w-full p-1 border rounded text-center font-mono"
                                                                value={row.unitCost}
                                                                onChange={(e) => updateRow(index, 'unitCost', parseFloat(e.target.value))}
                                                            />
                                                        </td>
                                                        <td className="p-2 sm:p-2 font-mono font-bold text-gray-700">
                                                            {(row.quantity * row.unitCost).toFixed(2)}
                                                        </td>
                                                        {receiveOnCreate ? (
                                                            <>
                                                                <td className="p-2 sm:p-2">
                                                                    <input
                                                                        type="date"
                                                                        value={row.productionDate || ''}
                                                                        onChange={(e) => updateRow(index, 'productionDate', e.target.value)}
                                                                        className="w-full p-1 border rounded"
                                                                    />
                                                                </td>
                                                                <td className="p-2 sm:p-2">
                                                                    <input
                                                                        type="date"
                                                                        value={row.expiryDate || ''}
                                                                        onChange={(e) => updateRow(index, 'expiryDate', e.target.value)}
                                                                        className="w-full p-1 border rounded"
                                                                    />
                                                                </td>
                                                            </>
                                                        ) : null}
                                                        <td className="p-2 sm:p-2 text-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => removeRow(index)}
                                                                className="text-red-500 hover:text-red-700"
                                                            >
                                                                <Icons.TrashIcon className="w-4 h-4" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-t dark:border-gray-700 flex justify-between items-center flex-shrink-0">
                                <div className="text-xl font-bold dark:text-white">
                                    الإجمالي الكلي: <span className="text-primary-600">{calculateTotal().toFixed(2)}</span>
                                </div>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="bg-green-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-green-700 shadow-lg"
                                >
                                    {loading ? 'جاري الحفظ...' : (receiveOnCreate ? 'حفظ واستلام المخزون' : 'حفظ فقط')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            
            {/* Reorder Suggestions */}
            {isModalOpen && (
                <div className="fixed inset-x-0 top-[5rem] z-40 mx-auto max-w-4xl px-4">
                    {lowStockSuggestions.length > 0 && (
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-xl p-4 shadow">
                            <div className="font-bold mb-2 dark:text-yellow-100">توصيات إعادة الطلب (مخزون منخفض)</div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {lowStockSuggestions.map(s => (
                                    <div key={s.item!.id} className="flex items-center justify-between gap-3 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-3">
                                        <div className="flex-1">
                                            <div className="font-semibold dark:text-gray-100">{s.item!.name.ar}</div>
                                            <div className="text-xs text-gray-600 dark:text-gray-400">
                                                المتاح: {s.available} — الحد الأدنى: {s.threshold}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="text-xs dark:text-gray-300">المقترح: {s.recommended}</div>
                                            <button
                                                type="button"
                                                onClick={() => addRowForItem(s.item!.id, s.recommended)}
                                                className="px-3 py-1 bg-primary-600 text-white rounded hover:bg-primary-700 text-sm"
                                            >
                                                إضافة
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {isPaymentModalOpen && paymentOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 flex justify-between items-center">
                            <h2 className="text-xl font-bold dark:text-white">تسجيل دفعة للمورد</h2>
                            <button
                                type="button"
                                onClick={() => { setIsPaymentModalOpen(false); setPaymentOrder(null); }}
                                className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                                <Icons.XIcon className="w-6 h-6" />
                            </button>
                        </div>
                        <form onSubmit={handleRecordPayment} className="p-6 space-y-4">
                            <div className="text-sm dark:text-gray-300">
                                {paymentOrder.supplierName} — {paymentOrder.referenceNumber || paymentOrder.id}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">المبلغ</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        required
                                        value={paymentAmount}
                                        onChange={(e) => setPaymentAmount(parseFloat(e.target.value))}
                                        className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-center font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">طريقة الدفع</label>
                                    <select
                                        value={paymentMethod}
                                        onChange={(e) => {
                                            const next = e.target.value;
                                            setPaymentMethod(next);
                                            if (next === 'cash') {
                                                setPaymentReferenceNumber('');
                                                setPaymentSenderName('');
                                                setPaymentSenderPhone('');
                                                setPaymentDeclaredAmount(0);
                                                setPaymentAmountConfirmed(false);
                                            } else {
                                                setPaymentReferenceNumber('');
                                                setPaymentSenderName('');
                                                setPaymentSenderPhone('');
                                                setPaymentDeclaredAmount(Number(paymentAmount) || 0);
                                                setPaymentAmountConfirmed(false);
                                            }
                                        }}
                                        className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    >
                                        {availablePaymentMethods.length === 0 ? (
                                            <option value="">لا توجد طرق دفع مفعّلة</option>
                                        ) : (
                                            availablePaymentMethods.map((method) => (
                                                <option key={method} value={method}>{getPaymentMethodLabel(method)}</option>
                                            ))
                                        )}
                                    </select>
                                </div>
                            </div>
                            {(paymentMethod === 'kuraimi' || paymentMethod === 'network') && (
                                <div className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-600 p-3">
                                    <div className="text-sm font-semibold dark:text-gray-200">
                                        {paymentMethod === 'kuraimi' ? 'بيانات الإيداع البنكي' : 'بيانات الحوالة'}
                                    </div>
                                    <div className="grid grid-cols-1 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                                                {paymentMethod === 'kuraimi' ? 'رقم الإيداع' : 'رقم الحوالة'}
                                            </label>
                                            <input
                                                type="text"
                                                value={paymentReferenceNumber}
                                                onChange={(e) => setPaymentReferenceNumber(e.target.value)}
                                                placeholder={paymentMethod === 'kuraimi' ? 'مثال: DEP-12345' : 'مثال: TRX-12345'}
                                                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                required
                                            />
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                                                    {paymentMethod === 'kuraimi' ? 'اسم المودِع' : 'اسم المرسل'}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={paymentSenderName}
                                                    onChange={(e) => setPaymentSenderName(e.target.value)}
                                                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                    required
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                                                    {paymentMethod === 'kuraimi' ? 'رقم هاتف المودِع (اختياري)' : 'رقم هاتف المرسل (اختياري)'}
                                                </label>
                                                <input
                                                    type="tel"
                                                    value={paymentSenderPhone}
                                                    onChange={(e) => setPaymentSenderPhone(e.target.value)}
                                                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">مبلغ العملية</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={paymentDeclaredAmount}
                                                    onChange={(e) => setPaymentDeclaredAmount(parseFloat(e.target.value))}
                                                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-center font-mono"
                                                    required
                                                />
                                            </div>
                                            <div className="flex items-end">
                                                <label className="flex items-center gap-2 text-sm font-medium dark:text-gray-300">
                                                    <input
                                                        type="checkbox"
                                                        checked={paymentAmountConfirmed}
                                                        onChange={(e) => setPaymentAmountConfirmed(e.target.checked)}
                                                    />
                                                    تأكيد مطابقة المبلغ
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">وقت الدفع</label>
                                <input
                                    type="datetime-local"
                                    value={paymentOccurredAt}
                                    onChange={(e) => setPaymentOccurredAt(e.target.value)}
                                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => { setIsPaymentModalOpen(false); setPaymentOrder(null); }}
                                    className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700"
                                >
                                    تسجيل الدفع
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isReceiveModalOpen && receiveOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 flex justify-between items-center">
                            <h2 className="text-xl font-bold dark:text-white">استلام مخزون (جزئي)</h2>
                            <button
                                type="button"
                                onClick={() => {
                                    if (isReceivingPartial) return;
                                    setIsReceiveModalOpen(false);
                                    setReceiveOrder(null);
                                    setReceiveRows([]);
                                }}
                                disabled={isReceivingPartial}
                                className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                                <Icons.XIcon className="w-6 h-6" />
                            </button>
                        </div>
                        <form onSubmit={handleReceivePartial} className="p-6 space-y-4">
                            <div className="text-sm dark:text-gray-300">
                                {receiveOrder.supplierName} — {receiveOrder.referenceNumber || receiveOrder.id}
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">وقت الاستلام</label>
                                <input
                                    type="datetime-local"
                                    value={receiveOccurredAt}
                                    onChange={(e) => setReceiveOccurredAt(e.target.value)}
                                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                />
                            </div>
                            <div className="border rounded-lg overflow-hidden dark:border-gray-700">
                                <div className="overflow-x-auto">
                                <table className="min-w-[720px] w-full text-right text-sm">
                                    <thead className="bg-gray-50 dark:bg-gray-700">
                                        <tr>
                                            <th className="p-2 sm:p-3">الصنف</th>
                                            <th className="p-2 sm:p-3 w-24">المطلوب</th>
                                                    <th className="p-2 sm:p-3 w-24">المستلم</th>
                                                    <th className="p-2 sm:p-3 w-24">المتبقي</th>
                                                    <th className="p-2 sm:p-3 w-32">استلام الآن</th>
                                                    <th className="p-2 sm:p-3 w-40">تاريخ الإنتاج</th>
                                                    <th className="p-2 sm:p-3 w-40">تاريخ الانتهاء</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                                {receiveRows.map((r, idx) => (
                                                    <tr key={r.itemId}>
                                                        <td className="p-2 sm:p-2 dark:text-gray-200">{r.itemName}</td>
                                                        <td className="p-2 sm:p-2 text-center font-mono">{r.ordered}</td>
                                                        <td className="p-2 sm:p-2 text-center font-mono">{r.received}</td>
                                                        <td className="p-2 sm:p-2 text-center font-mono">{r.remaining}</td>
                                                        <td className="p-2 sm:p-2">
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                step={getQuantityStep(r.itemId)}
                                                                value={r.receiveNow}
                                                                onChange={(e) => updateReceiveRow(idx, parseFloat(e.target.value))}
                                                                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-center font-mono"
                                                            />
                                                        </td>
                                                        <td className="p-2 sm:p-2">
                                                            <input
                                                                type="date"
                                                                value={r.productionDate || ''}
                                                                onChange={(e) => updateReceiveProduction(idx, e.target.value)}
                                                                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                            />
                                                        </td>
                                                        <td className="p-2 sm:p-2">
                                                            <input
                                                                type="date"
                                                                value={r.expiryDate || ''}
                                                                onChange={(e) => updateReceiveExpiry(idx, e.target.value)}
                                                                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                            />
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                </table>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (isReceivingPartial) return;
                                        setIsReceiveModalOpen(false);
                                        setReceiveOrder(null);
                                        setReceiveRows([]);
                                    }}
                                    disabled={isReceivingPartial}
                                    className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    disabled={isReceivingPartial}
                                    className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                                >
                                    {isReceivingPartial ? 'جاري الاستلام...' : 'تأكيد الاستلام'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isReturnModalOpen && returnOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 flex justify-between items-center">
                            <h2 className="text-xl font-bold dark:text-white">مرتجع إلى المورد</h2>
                            <button
                                type="button"
                                onClick={() => { setIsReturnModalOpen(false); setReturnOrder(null); setReturnRows([]); }}
                                className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                                <Icons.XIcon className="w-6 h-6" />
                            </button>
                        </div>
                        <form onSubmit={handleCreateReturn} className="p-6 space-y-4">
                            <div className="text-sm dark:text-gray-300">
                                {returnOrder.supplierName} — {returnOrder.referenceNumber || returnOrder.id.slice(-6)}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">وقت المرتجع</label>
                                    <input
                                        type="datetime-local"
                                        value={returnOccurredAt}
                                        onChange={(e) => setReturnOccurredAt(e.target.value)}
                                        className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">سبب المرتجع</label>
                                    <input
                                        type="text"
                                        value={returnReason}
                                        onChange={(e) => setReturnReason(e.target.value)}
                                        className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    />
                                </div>
                            </div>
                            <div className="border rounded-lg overflow-hidden dark:border-gray-700">
                                <div className="overflow-x-auto">
                                <table className="min-w-[720px] w-full text-right text-sm">
                                    <thead className="bg-gray-50 dark:bg-gray-700">
                                        <tr>
                                            <th className="p-2 sm:p-3">الصنف</th>
                                            <th className="p-2 sm:p-3 w-24">المستلم</th>
                                            <th className="p-2 sm:p-3 w-24">مرتجع سابق</th>
                                            <th className="p-2 sm:p-3 w-24">المتبقي</th>
                                            <th className="p-2 sm:p-3 w-24">المتاح حالياً</th>
                                            <th className="p-2 sm:p-3 w-24">مرتجع الآن</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                        {returnRows.map((r, idx) => (
                                            <tr key={r.itemId}>
                                                <td className="p-2 sm:p-2 dark:text-gray-200">{r.itemName}</td>
                                                <td className="p-2 sm:p-2 text-center font-mono">{r.received}</td>
                                                <td className="p-2 sm:p-2 text-center font-mono">{r.previousReturned || 0}</td>
                                                <td className="p-2 sm:p-2 text-center font-mono">{r.remaining}</td>
                                                <td className="p-2 sm:p-2 text-center font-mono">{Number(r.available || 0)}</td>
                                                    <td className="p-2 sm:p-2">
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            step={getQuantityStep(r.itemId)}
                                                            value={r.receiveNow}
                                                            onChange={(e) => updateReturnRow(idx, parseFloat(e.target.value))}
                                                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-center font-mono"
                                                        />
                                                    </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => { setIsReturnModalOpen(false); setReturnOrder(null); setReturnRows([]); }}
                                    className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                                >
                                    تسجيل المرتجع
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PurchaseOrderScreen;
