import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { renderToString } from 'react-dom/server';
import { useOrders } from '../../contexts/OrderContext';
import { localizeSupabaseError } from '../../utils/errorUtils';
import { useSalesReturn } from '../../contexts/SalesReturnContext';
import { useToast } from '../../contexts/ToastContext';
import type { AdminUser, OrderStatus, CartItem, OrderAuditEvent, Order } from '../../types';
import { useSettings } from '../../contexts/SettingsContext';
import { adminStatusColors } from '../../utils/orderUtils';
import Spinner from '../../components/Spinner';
import ConfirmationModal from '../../components/admin/ConfirmationModal';
import PrintableOrder from '../../components/admin/PrintableOrder';
import { useDeliveryZones } from '../../contexts/DeliveryZoneContext';
import { useAuth } from '../../contexts/AuthContext';
import { useCashShift } from '../../contexts/CashShiftContext';
import { useSessionScope } from '../../contexts/SessionScopeContext';
import { useWarehouses } from '../../contexts/WarehouseContext';
import OsmMapEmbed from '../../components/OsmMapEmbed';
import NumberInput from '../../components/NumberInput';
import { useMenu } from '../../contexts/MenuContext';
import { getSupabaseClient } from '../../supabase';
import { printContent } from '../../utils/printUtils';
import { toDateTimeLocalInputValue } from '../../utils/dateUtils';

const statusTranslations: Record<OrderStatus, string> = {
    pending: 'قيد الانتظار',
    preparing: 'جاري التحضير',
    out_for_delivery: 'في الطريق',
    delivered: 'تم التوصيل',
    scheduled: 'مجدول',
    cancelled: 'ملغي',
};

const paymentTranslations: Record<string, string> = {
    cash: 'نقدًا',
    network: 'حوالات',
    kuraimi: 'حسابات بنكية',
    card: 'حوالات',
    bank: 'حسابات بنكية',
    bank_transfer: 'حسابات بنكية',
    mixed: 'متعدد',
    unknown: 'غير محدد'
};

const unitTranslations: Record<string, string> = {
    piece: 'قطعة',
    kg: 'كجم',
    gram: 'جرام',
    liter: 'لتر'
};

const ManageOrdersScreen: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { orders, updateOrderStatus, assignOrderToDelivery, acceptDeliveryAssignment, createInStoreSale, loading, markOrderPaid, recordOrderPaymentPartial, issueInvoiceNow } = useOrders();
    const { createReturn, processReturn, getReturnsByOrder } = useSalesReturn();
    const { showNotification } = useToast();
    const language = 'ar';
    const { settings } = useSettings();
    
    // Return Logic State
    const [returnOrderId, setReturnOrderId] = useState<string | null>(null);
    const [returnItems, setReturnItems] = useState<Record<string, number>>({});
    const [isCreatingReturn, setIsCreatingReturn] = useState(false);
    const [returnReason, setReturnReason] = useState('');
    const [refundMethod, setRefundMethod] = useState<'cash' | 'network' | 'kuraimi'>('cash');
    const [returnsOrderId, setReturnsOrderId] = useState<string | null>(null);
    const [returnsByOrderId, setReturnsByOrderId] = useState<Record<string, any[]>>({});
    const [returnsLoading, setReturnsLoading] = useState(false);
    // const { t, language } = useSettings();
    const { getDeliveryZoneById } = useDeliveryZones();
    const { hasPermission, listAdminUsers, user: adminUser } = useAuth();
    const { currentShift } = useCashShift();
    const sessionScope = useSessionScope();
    const { getWarehouseById } = useWarehouses();
    const { menuItems: allMenuItems } = useMenu();
    const [filterStatus, setFilterStatus] = useState<OrderStatus | 'all'>('all');
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
    const [customerUserIdFilter, setCustomerUserIdFilter] = useState<string>('');
    const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
    const [isCancelling, setIsCancelling] = useState(false);
    const [expandedAuditOrderId, setExpandedAuditOrderId] = useState<string | null>(null);
    const [auditLoadingOrderId, setAuditLoadingOrderId] = useState<string | null>(null);
    const [auditByOrderId, setAuditByOrderId] = useState<Record<string, OrderAuditEvent[]>>({});
    const [deliveryUsers, setDeliveryUsers] = useState<AdminUser[]>([]);
    const [deliverPinOrderId, setDeliverPinOrderId] = useState<string | null>(null);
    const [deliveryPinInput, setDeliveryPinInput] = useState('');
    const [isDeliverConfirming, setIsDeliverConfirming] = useState(false);
    const [isInStoreSaleOpen, setIsInStoreSaleOpen] = useState(false);
    const [isInStoreCreating, setIsInStoreCreating] = useState(false);
    const menuItems = useMemo(() => {
        const items = allMenuItems.filter(i => i.status !== 'archived');
        items.sort((a, b) => {
            const an = a.name?.['ar'] || a.name?.en || '';
            const bn = b.name?.['ar'] || b.name?.en || '';
            return an.localeCompare(bn);
        });
        return items;
    }, [allMenuItems]);
    const [inStoreCustomerName, setInStoreCustomerName] = useState('');
    const [inStorePhoneNumber, setInStorePhoneNumber] = useState('');
    const [inStoreNotes, setInStoreNotes] = useState('');
    const [inStorePaymentMethod, setInStorePaymentMethod] = useState('cash');
    const [inStorePaymentReferenceNumber, setInStorePaymentReferenceNumber] = useState('');
    const [inStorePaymentSenderName, setInStorePaymentSenderName] = useState('');
    const [inStorePaymentSenderPhone, setInStorePaymentSenderPhone] = useState('');
    const [inStorePaymentDeclaredAmount, setInStorePaymentDeclaredAmount] = useState<number>(0);
    const [inStorePaymentAmountConfirmed, setInStorePaymentAmountConfirmed] = useState(false);
    const [inStoreCashReceived, setInStoreCashReceived] = useState<number>(0);
    const [inStoreDiscountType, setInStoreDiscountType] = useState<'amount' | 'percent'>('amount');
    const [inStoreDiscountValue, setInStoreDiscountValue] = useState<number>(0);
    const [inStoreAutoOpenInvoice, setInStoreAutoOpenInvoice] = useState(true);
    const [inStoreMultiPaymentEnabled, setInStoreMultiPaymentEnabled] = useState(false);
    const [inStorePaymentLines, setInStorePaymentLines] = useState<Array<{
        method: string;
        amount: number;
        referenceNumber?: string;
        senderName?: string;
        senderPhone?: string;
        declaredAmount?: number;
        amountConfirmed?: boolean;
        cashReceived?: number;
    }>>([]);
    const [inStoreSelectedItemId, setInStoreSelectedItemId] = useState<string>('');
    const [inStoreItemSearch, setInStoreItemSearch] = useState('');
    const [inStoreSelectedAddons, setInStoreSelectedAddons] = useState<Record<string, number>>({});
    const [inStoreLines, setInStoreLines] = useState<Array<{ menuItemId: string; quantity?: number; weight?: number; selectedAddons?: Record<string, number> }>>([]);
    const [mapModal, setMapModal] = useState<{ title: string; coords: { lat: number; lng: number } } | null>(null);
    const [paidSumByOrderId, setPaidSumByOrderId] = useState<Record<string, number>>({});
    const [partialPaymentOrderId, setPartialPaymentOrderId] = useState<string | null>(null);
    const [partialPaymentAmount, setPartialPaymentAmount] = useState<number>(0);
    const [partialPaymentMethod, setPartialPaymentMethod] = useState<string>('cash');
    const [partialPaymentOccurredAt, setPartialPaymentOccurredAt] = useState<string>('');
    const [isRecordingPartialPayment, setIsRecordingPartialPayment] = useState(false);
    const [driverCashByDriverId, setDriverCashByDriverId] = useState<Record<string, number>>({});
    const [codAuditOrderId, setCodAuditOrderId] = useState<string | null>(null);
    const [codAuditLoading, setCodAuditLoading] = useState(false);
    const [codAuditData, setCodAuditData] = useState<any>(null);

    const searchParams = new URLSearchParams(location.search);
    const highlightedOrderId = (searchParams.get('orderId') || '') || (typeof (location.state as any)?.orderId === 'string' ? (location.state as any).orderId : '');

    const canViewAccounting = hasPermission('accounting.view') || hasPermission('accounting.manage');

    const inStoreAvailablePaymentMethods = useMemo(() => {
        const enabled = Object.entries(settings.paymentMethods || {})
            .filter(([, isEnabled]) => Boolean(isEnabled))
            .map(([key]) => key);
        return enabled;
    }, [settings.paymentMethods]);

    useEffect(() => {
        const fetchDriverBalances = async () => {
            if (!canViewAccounting) return;
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const { data, error } = await supabase
                .from('v_driver_ledger_balances')
                .select('driver_id,balance_after')
                .limit(5000);
            if (error) return;
            const next: Record<string, number> = {};
            for (const row of (data as any[]) || []) {
                const id = String((row as any)?.driver_id || '');
                const bal = Number((row as any)?.balance_after || 0);
                if (id) next[id] = bal;
            }
            setDriverCashByDriverId(next);
        };
        fetchDriverBalances();
    }, [canViewAccounting]);

    const openCodAudit = async (orderId: string) => {
        if (!canViewAccounting) return;
        const supabase = getSupabaseClient();
        if (!supabase) return;
        setCodAuditOrderId(orderId);
        setCodAuditLoading(true);
        setCodAuditData(null);
        try {
            const { data, error } = await supabase.rpc('get_cod_audit', { p_order_id: orderId });
            if (error) throw error;
            setCodAuditData(data);
        } catch (err: any) {
            showNotification('تعذر تحميل سجل COD', 'error');
            setCodAuditData(null);
        } finally {
            setCodAuditLoading(false);
        }
    };

    const canCancel = hasPermission('orders.cancel');
    const canMarkPaid = hasPermission('orders.markPaid');
    const canCreateInStoreSale = hasPermission('orders.createInStore') || hasPermission('orders.updateStatus.all');
    const canUpdateAllStatuses = hasPermission('orders.updateStatus.all');
    const canUpdateDeliveryStatuses = hasPermission('orders.updateStatus.delivery');
    const canAssignDelivery = hasPermission('orders.updateStatus.all');
    const isDeliveryOnly = adminUser?.role === 'delivery' && canUpdateDeliveryStatuses && !canUpdateAllStatuses;
    const canViewInvoice = canMarkPaid || canUpdateAllStatuses;

    const parseRefundMethod = useCallback((value: string): 'cash' | 'network' | 'kuraimi' => {
        if (value === 'cash' || value === 'network' || value === 'kuraimi') return value;
        return 'cash';
    }, []);

    const openReturnsModal = useCallback(async (orderId: string) => {
        setReturnsOrderId(orderId);
        if (returnsByOrderId[orderId]) return;
        try {
            setReturnsLoading(true);
            const list = await getReturnsByOrder(orderId);
            setReturnsByOrderId(prev => ({ ...prev, [orderId]: list as any[] }));
        } catch (error) {
            showNotification(localizeSupabaseError(error), 'error');
            setReturnsByOrderId(prev => ({ ...prev, [orderId]: [] }));
        } finally {
            setReturnsLoading(false);
        }
    }, [getReturnsByOrder, returnsByOrderId, showNotification]);

    useEffect(() => {
        const state = location.state as any;
        const customerId = typeof state?.customerId === 'string' ? state.customerId.trim() : '';
        if (!customerId) return;
        setCustomerUserIdFilter(customerId);
    }, [location.key]);

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            try {
                const list = await listAdminUsers();
                const activeDelivery = list.filter(u => u.isActive && u.role === 'delivery');
                if (isMounted) setDeliveryUsers(activeDelivery);
            } catch {
                if (isMounted) setDeliveryUsers([]);
            }
        };
        load();
        return () => {
            isMounted = false;
        };
    }, [listAdminUsers]);

    useEffect(() => {
        if (!highlightedOrderId) return;
        const exists = orders.some(o => o.id === highlightedOrderId);
        if (!exists) return;
        setExpandedAuditOrderId(highlightedOrderId);
        const el = document.querySelector(`[data-order-id="${highlightedOrderId}"]`);
        if (el) {
            try { (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
        }
    }, [highlightedOrderId, orders]);

    // Reset addons when item changes
    useEffect(() => {
        setInStoreSelectedAddons({});
    }, [inStoreSelectedItemId]);

    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        if (inStoreAvailablePaymentMethods.length === 0) {
            setInStorePaymentMethod('');
            return;
        }
        if (!inStorePaymentMethod || !inStoreAvailablePaymentMethods.includes(inStorePaymentMethod)) {
            setInStorePaymentMethod(inStoreAvailablePaymentMethods[0]);
        }
    }, [inStoreAvailablePaymentMethods, inStorePaymentMethod, isInStoreSaleOpen]);

    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        if (inStorePaymentMethod === 'cash') {
            setInStorePaymentReferenceNumber('');
            setInStorePaymentSenderName('');
            setInStorePaymentSenderPhone('');
            setInStorePaymentDeclaredAmount(0);
            setInStorePaymentAmountConfirmed(false);
            setInStoreCashReceived(0);
        }
    }, [inStorePaymentMethod, isInStoreSaleOpen]);

    const handleStatusChange = async (orderId: string, newStatus: OrderStatus) => {
        if (!canUpdateAllStatuses) {
            if (!canUpdateDeliveryStatuses) {
                showNotification('لا تملك صلاحية تغيير حالة الطلب.', 'error');
                return;
            }
            if (newStatus !== 'out_for_delivery' && newStatus !== 'delivered') {
                showNotification('لا تملك صلاحية تغيير الحالة لهذه القيمة.', 'error');
                return;
            }
        }
        if (isDeliveryOnly && newStatus === 'delivered') {
            setDeliverPinOrderId(orderId);
            setDeliveryPinInput('');
            return;
        }
        try {
            await updateOrderStatus(orderId, newStatus);
            showNotification(`تم تحديث الطلب #${orderId.slice(-6).toUpperCase()} إلى "${statusTranslations[newStatus] || newStatus}"`, 'success');
        } catch (error) {
            showNotification(localizeSupabaseError(error), 'error');
        }
    };

    const handleAssignDelivery = async (orderId: string, nextDeliveryUserId: string) => {
        if (!canAssignDelivery) return;
        try {
            await assignOrderToDelivery(orderId, nextDeliveryUserId === 'none' ? null : nextDeliveryUserId);
            showNotification('تم تحديث تعيين المندوب.', 'success');
        } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            const message = raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل تعيين المندوب.';
            showNotification(message, 'error');
        }
    };

    const handlePrintDeliveryNote = (order: Order) => {
        const fallback = {
            name: (settings.cafeteriaName?.[language] || settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '').trim(),
            address: (settings.address || '').trim(),
            contactNumber: (settings.contactNumber || '').trim(),
            logoUrl: (settings.logoUrl || '').trim(),
        };
        const warehouseId = (order as any)?.warehouseId || sessionScope.scope?.warehouseId || '';
        const wh = warehouseId ? getWarehouseById(String(warehouseId)) : undefined;
        const key = warehouseId ? String(warehouseId) : '';
        const override = key ? settings.branchBranding?.[key] : undefined;
        const brand = {
            name: (override?.name || wh?.name || fallback.name || '').trim(),
            address: (override?.address || wh?.address || wh?.location || fallback.address || '').trim(),
            contactNumber: (override?.contactNumber || wh?.phone || fallback.contactNumber || '').trim(),
            logoUrl: (override?.logoUrl || fallback.logoUrl || '').trim(),
        };
        const content = renderToString(
            <PrintableOrder
                order={order}
                language="ar"
                cafeteriaName={brand.name}
                cafeteriaAddress={brand.address}
                cafeteriaPhone={brand.contactNumber}
                logoUrl={brand.logoUrl}
            />
        );
        printContent(content, `سند تسليم #${order.id.slice(-6).toUpperCase()}`);
    };

    const confirmDeliveredWithPin = async () => {
        if (!deliverPinOrderId) return;
        setIsDeliverConfirming(true);
        try {
            const deliveredLocation = await new Promise<{ lat: number; lng: number; accuracy?: number } | undefined>((resolve) => {
                if (!('geolocation' in navigator) || !navigator.geolocation) {
                    resolve(undefined);
                    return;
                }
                navigator.geolocation.getCurrentPosition(
                    (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
                    () => resolve(undefined),
                    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 }
                );
            });

            await updateOrderStatus(deliverPinOrderId, 'delivered', { deliveryPin: deliveryPinInput, deliveredLocation });
            showNotification('تم تأكيد التسليم.', 'success');
            setDeliverPinOrderId(null);
            setDeliveryPinInput('');
        } catch (error) {
            showNotification(localizeSupabaseError(error), 'error');
        } finally {
            setIsDeliverConfirming(false);
        }
    };

    const handleAcceptDelivery = async (orderId: string) => {
        try {
            await acceptDeliveryAssignment(orderId);
            showNotification('تم قبول مهمة التوصيل.', 'success');
        } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            // Always show the raw error if available to help debugging
            const message = raw ? `فشل قبول مهمة التوصيل: ${raw}` : 'فشل قبول مهمة التوصيل.';
            showNotification(message, 'error');
        }
    };

    const handleMarkPaid = async (orderId: string) => {
        if (!canMarkPaid) {
            showNotification('لا تملك صلاحية تأكيد الدفع.', 'error');
            return;
        }
        const order = filteredAndSortedOrders.find(o => o.id === orderId) || orders.find(o => o.id === orderId);
        if (order && (order.paymentMethod || 'cash') === 'cash' && !currentShift) {
            showNotification('يجب فتح وردية نقدية قبل تأكيد التحصيل النقدي.', 'error');
            return;
        }
        try {
            await markOrderPaid(orderId);
            await loadPaidSums(filteredAndSortedOrders.map(o => o.id));
            showNotification(`تم تأكيد التحصيل للطلب #${orderId.slice(-6).toUpperCase()}`, 'success');
        } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            const localized = localizeSupabaseError(error);
            const message = localized || raw || 'فشل تأكيد الدفع.';
            showNotification(message, 'error');
        }
    };

    const addInStoreLine = () => {
        const id = inStoreSelectedItemId;
        if (!id) return;
        const menuItem = menuItems.find(m => m.id === id);
        if (!menuItem) return;
        const isWeightBased = menuItem.unitType === 'kg' || menuItem.unitType === 'gram';

        // Filter out 0 quantity addons
        const addonsToAdd: Record<string, number> = {};
        Object.entries(inStoreSelectedAddons).forEach(([aid, qty]) => {
            if (qty > 0) addonsToAdd[aid] = qty;
        });

        setInStoreLines(prev => {
            return [
                ...prev,
                isWeightBased
                    ? { menuItemId: id, weight: menuItem.minWeight || 1, selectedAddons: addonsToAdd }
                    : { menuItemId: id, quantity: 1, selectedAddons: addonsToAdd },
            ];
        });
        setInStoreSelectedItemId('');
        setInStoreSelectedAddons({});
    };

    const filteredInStoreMenuItems = useMemo(() => {
        const needle = inStoreItemSearch.trim().toLowerCase();
        if (!needle) return menuItems;
        return menuItems.filter(mi => {
            const name = (mi.name?.[language] || mi.name?.ar || mi.name?.en || '').toLowerCase();
            return name.includes(needle);
        });
    }, [inStoreItemSearch, language, menuItems]);

    const updateInStoreLine = (index: number, patch: { quantity?: number; weight?: number }) => {
        setInStoreLines(prev => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    };

    const removeInStoreLine = (index: number) => {
        setInStoreLines(prev => prev.filter((_, i) => i !== index));
    };

    const inStoreTotals = useMemo(() => {
        const subtotal = inStoreLines.reduce((sum, line) => {
            const menuItem = menuItems.find(m => m.id === line.menuItemId);
            if (!menuItem) return sum;
            const unitType = menuItem.unitType;
            const isWeightBased = unitType === 'kg' || unitType === 'gram';
            const quantity = !isWeightBased ? (line.quantity || 0) : 1;
            const weight = isWeightBased ? (line.weight || 0) : 0;
            const unitPrice = unitType === 'gram' && menuItem.pricePerUnit ? menuItem.pricePerUnit / 1000 : menuItem.price;

            // Addons cost
            let addonsCost = 0;
            if (line.selectedAddons && menuItem.addons) {
                Object.entries(line.selectedAddons).forEach(([aid, qty]) => {
                    const addon = menuItem.addons?.find(a => a.id === aid);
                    if (addon) {
                        addonsCost += addon.price * qty;
                    }
                });
            }

            const lineTotal = isWeightBased
                ? (unitPrice * weight) + (addonsCost * 1)
                : (unitPrice + addonsCost) * quantity;

            return sum + lineTotal;
        }, 0);
        const discountValue = Number(inStoreDiscountValue) || 0;
        const discountAmount = inStoreDiscountType === 'percent'
            ? Math.max(0, Math.min(100, discountValue)) * subtotal / 100
            : Math.max(0, Math.min(subtotal, discountValue));
        const total = Math.max(0, subtotal - discountAmount);
        return { subtotal, discountAmount, total };
    }, [inStoreDiscountType, inStoreDiscountValue, inStoreLines, menuItems]);

    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        if (!inStoreMultiPaymentEnabled) return;
        if (inStorePaymentLines.length !== 1) return;
        const total = Number(inStoreTotals.total) || 0;
        setInStorePaymentLines(prev => {
            if (prev.length !== 1) return prev;
            const current = prev[0];
            const nextAmount = Number(total.toFixed(2));
            if (Math.abs((Number(current.amount) || 0) - nextAmount) < 0.0001) return prev;
            return [{ ...current, amount: nextAmount }];
        });
    }, [inStoreMultiPaymentEnabled, inStorePaymentLines.length, inStoreTotals.total, isInStoreSaleOpen]);

    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        const total = Number(inStoreTotals.total) || 0;
        if (inStorePaymentMethod !== 'kuraimi' && inStorePaymentMethod !== 'network') return;
        if ((Number(inStorePaymentDeclaredAmount) || 0) > 0) return;
        if (!(total > 0)) return;
        setInStorePaymentDeclaredAmount(Number(total.toFixed(2)));
    }, [inStorePaymentDeclaredAmount, inStorePaymentMethod, inStoreTotals.total, isInStoreSaleOpen]);

    const confirmInStoreSale = async () => {
        const total = Number(inStoreTotals.total) || 0;
        if (!(total > 0)) {
            showNotification('الإجمالي يجب أن يكون أكبر من صفر.', 'error');
            return;
        }

        const normalizedPaymentLines = inStoreMultiPaymentEnabled
            ? inStorePaymentLines
                .map((p) => ({
                    method: (p.method || '').trim(),
                    amount: Number(p.amount) || 0,
                    referenceNumber: (p.referenceNumber || '').trim() || undefined,
                    senderName: (p.senderName || '').trim() || undefined,
                    senderPhone: (p.senderPhone || '').trim() || undefined,
                    declaredAmount: Number(p.declaredAmount) || 0,
                    amountConfirmed: Boolean(p.amountConfirmed),
                    cashReceived: Number(p.cashReceived) || 0,
                }))
                .filter(p => Boolean(p.method) && p.amount > 0)
            : [{
                method: (inStorePaymentMethod || '').trim(),
                amount: total,
                referenceNumber: (inStorePaymentReferenceNumber || '').trim() || undefined,
                senderName: (inStorePaymentSenderName || '').trim() || undefined,
                senderPhone: (inStorePaymentSenderPhone || '').trim() || undefined,
                declaredAmount: Number(inStorePaymentDeclaredAmount) || 0,
                amountConfirmed: Boolean(inStorePaymentAmountConfirmed) || inStorePaymentMethod === 'cash',
                cashReceived: Number(inStoreCashReceived) || 0,
            }];

        if (!normalizedPaymentLines.length) {
            showNotification('يرجى إدخال بيانات الدفع.', 'error');
            return;
        }

        const sum = normalizedPaymentLines.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        if (Math.abs(sum - total) > 0.01) {
            showNotification('مجموع الدفعات لا يطابق إجمالي البيع.', 'error');
            return;
        }

        const cashAmount = normalizedPaymentLines
            .filter(p => p.method === 'cash')
            .reduce((s, p) => s + (Number(p.amount) || 0), 0);
        if (cashAmount > 0 && !currentShift) {
            showNotification('يجب فتح وردية نقدية قبل تسجيل أي مبلغ نقدي.', 'error');
            return;
        }

        for (const p of normalizedPaymentLines) {
            const needsReference = p.method === 'kuraimi' || p.method === 'network';
            if (!p.method) {
                showNotification('يرجى اختيار طريقة الدفع.', 'error');
                return;
            }
            if (needsReference) {
                if (!p.referenceNumber) {
                    showNotification(p.method === 'kuraimi' ? 'يرجى إدخال رقم الإيداع.' : 'يرجى إدخال رقم الحوالة.', 'error');
                    return;
                }
                if (!p.senderName) {
                    showNotification(p.method === 'kuraimi' ? 'يرجى إدخال اسم المودِع.' : 'يرجى إدخال اسم المرسل.', 'error');
                    return;
                }
                if (!(p.declaredAmount > 0)) {
                    showNotification('يرجى إدخال مبلغ العملية.', 'error');
                    return;
                }
                if (Math.abs((Number(p.declaredAmount) || 0) - (Number(p.amount) || 0)) > 0.0001) {
                    showNotification('مبلغ العملية لا يطابق مبلغ طريقة الدفع.', 'error');
                    return;
                }
                if (!p.amountConfirmed) {
                    showNotification('يرجى تأكيد مطابقة المبلغ قبل تسجيل البيع.', 'error');
                    return;
                }
            }
            if (p.method === 'cash') {
                if (p.cashReceived > 0 && p.cashReceived + 1e-9 < p.amount) {
                    showNotification('المبلغ المستلم نقداً أقل من المطلوب.', 'error');
                    return;
                }
            }
        }

        const primaryPaymentMethod = (normalizedPaymentLines[0]?.method || '').trim();
        if (!primaryPaymentMethod) {
            showNotification('يرجى اختيار طريقة الدفع.', 'error');
            return;
        }
        setIsInStoreCreating(true);
        try {
            const order = await createInStoreSale({
                lines: inStoreLines,
                paymentMethod: primaryPaymentMethod,
                customerName: inStoreCustomerName,
                phoneNumber: inStorePhoneNumber,
                notes: inStoreNotes,
                discountType: inStoreDiscountType,
                discountValue: Number(inStoreDiscountValue) || 0,
                paymentReferenceNumber: inStorePaymentMethod === 'kuraimi' || inStorePaymentMethod === 'network' ? inStorePaymentReferenceNumber.trim() : undefined,
                paymentSenderName: inStorePaymentMethod === 'kuraimi' || inStorePaymentMethod === 'network' ? inStorePaymentSenderName.trim() : undefined,
                paymentSenderPhone: inStorePaymentMethod === 'kuraimi' || inStorePaymentMethod === 'network' ? inStorePaymentSenderPhone.trim() : undefined,
                paymentDeclaredAmount: inStorePaymentMethod === 'kuraimi' || inStorePaymentMethod === 'network' ? (Number(inStorePaymentDeclaredAmount) || 0) : undefined,
                paymentAmountConfirmed: inStorePaymentMethod === 'kuraimi' || inStorePaymentMethod === 'network' ? Boolean(inStorePaymentAmountConfirmed) : undefined,
                paymentBreakdown: normalizedPaymentLines.map((p) => ({
                    method: p.method,
                    amount: p.amount,
                    referenceNumber: p.referenceNumber,
                    senderName: p.senderName,
                    senderPhone: p.senderPhone,
                    declaredAmount: p.declaredAmount,
                    amountConfirmed: p.amountConfirmed,
                    cashReceived: p.method === 'cash' ? (p.cashReceived > 0 ? p.cashReceived : undefined) : undefined,
                })),
            });
            const isQueued = Boolean((order as any).offlineState) || order.status !== 'delivered';
            showNotification(
                language === 'ar'
                    ? (isQueued ? `تم إرسال البيع للمزامنة #${order.id.slice(-6).toUpperCase()}` : `تم تسجيل البيع الحضوري #${order.id.slice(-6).toUpperCase()}`)
                    : (isQueued ? `Sale queued for sync #${order.id.slice(-6).toUpperCase()}` : `In-store sale created #${order.id.slice(-6).toUpperCase()}`),
                isQueued ? 'info' : 'success'
            );
            if (inStoreAutoOpenInvoice && !isQueued) {
                navigate(`/admin/invoice/${order.id}`);
            }
            setIsInStoreSaleOpen(false);
            setInStoreCustomerName('');
            setInStorePhoneNumber('');
            setInStorePaymentMethod('cash');
            setInStoreNotes('');
            setInStorePaymentReferenceNumber('');
            setInStorePaymentSenderName('');
            setInStorePaymentSenderPhone('');
            setInStorePaymentDeclaredAmount(0);
            setInStorePaymentAmountConfirmed(false);
            setInStoreCashReceived(0);
            setInStoreDiscountType('amount');
            setInStoreDiscountValue(0);
            setInStoreMultiPaymentEnabled(false);
            setInStorePaymentLines([]);
            setInStoreLines([]);
        } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            const message = language === 'ar'
                ? (raw ? `فشل تسجيل البيع الحضوري: ${raw}` : 'فشل تسجيل البيع الحضوري.')
                : (raw ? `Failed to create in-store sale: ${raw}` : 'Failed to create in-store sale.');
            showNotification(message, 'error');
        } finally {
            setIsInStoreCreating(false);
        }
    };

    const filteredAndSortedOrders = useMemo(() => {
        let processedOrders = [...orders];

        if (customerUserIdFilter.trim()) {
            processedOrders = processedOrders.filter(order => order.userId === customerUserIdFilter.trim());
        }

        if (filterStatus !== 'all') {
            processedOrders = processedOrders.filter(order => order.status === filterStatus);
        }

        if (isDeliveryOnly && adminUser?.id) {
            processedOrders = processedOrders.filter(order => order.assignedDeliveryUserId === adminUser.id);
        }

        const getSortTime = (order: Order) => {
            const candidates = [
                order.createdAt,
                order.invoiceIssuedAt,
                order.paidAt,
                order.deliveredAt,
                order.scheduledAt,
            ].filter(Boolean) as string[];
            for (const iso of candidates) {
                const ts = Date.parse(iso);
                if (Number.isFinite(ts)) return ts;
            }
            return 0;
        };

        processedOrders.sort((a, b) => {
            const ta = getSortTime(a);
            const tb = getSortTime(b);
            return sortOrder === 'newest' ? (tb - ta) : (ta - tb);
        });

        return processedOrders;
    }, [adminUser?.id, customerUserIdFilter, filterStatus, isDeliveryOnly, orders, sortOrder]);

    const loadPaidSums = useCallback(async (orderIds: string[]) => {
        const uniqueIds = Array.from(new Set(orderIds.filter(Boolean)));
        if (uniqueIds.length === 0) {
            setPaidSumByOrderId({});
            return;
        }
        try {
            const supabase = getSupabaseClient();
            if (!supabase) {
                setPaidSumByOrderId({});
                return;
            }
            const { data: rows, error } = await supabase
                .from('payments')
                .select('reference_id, amount')
                .eq('reference_table', 'orders')
                .eq('direction', 'in')
                .in('reference_id', uniqueIds);
            if (error) throw error;
            const sums: Record<string, number> = {};
            uniqueIds.forEach(id => {
                sums[id] = 0;
            });
            (rows || []).forEach((r: any) => {
                const rid = typeof r.reference_id === 'string' ? r.reference_id : '';
                if (!rid) return;
                sums[rid] = (sums[rid] || 0) + (Number(r.amount) || 0);
            });
            setPaidSumByOrderId(sums);
        } catch (error) {
            if (import.meta.env.DEV) {
                console.warn('Failed to load paid sums', error);
            }
            setPaidSumByOrderId({});
        }
    }, []);

    useEffect(() => {
        void loadPaidSums(filteredAndSortedOrders.map(o => o.id));
    }, [filteredAndSortedOrders, loadPaidSums]);

    const openPartialPaymentModal = (orderId: string) => {
        const order = filteredAndSortedOrders.find(o => o.id === orderId) || orders.find(o => o.id === orderId);
        if (!order) return;
        const paid = Number(paidSumByOrderId[orderId]) || 0;
        const remaining = Math.max(0, (Number(order.total) || 0) - paid);
        setPartialPaymentOrderId(orderId);
        setPartialPaymentAmount(remaining > 0 ? Number(remaining.toFixed(2)) : 0);
        setPartialPaymentMethod(order.orderSource === 'in_store' ? 'cash' : ((order.paymentMethod || 'cash').trim() || 'cash'));
        setPartialPaymentOccurredAt(toDateTimeLocalInputValue());
    };

    const confirmPartialPayment = async () => {
        if (!partialPaymentOrderId) return;
        if (!canMarkPaid) {
            showNotification('لا تملك صلاحية تسجيل دفعة.', 'error');
            return;
        }
        const order = filteredAndSortedOrders.find(o => o.id === partialPaymentOrderId) || orders.find(o => o.id === partialPaymentOrderId);
        if (!order) return;
        const paid = Number(paidSumByOrderId[partialPaymentOrderId]) || 0;
        const remaining = Math.max(0, (Number(order.total) || 0) - paid);
        const amount = Number(partialPaymentAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            showNotification('أدخل مبلغًا صحيحًا.', 'error');
            return;
        }
        if (remaining > 0 && amount > remaining + 1e-9) {
            showNotification('المبلغ أكبر من المتبقي على الطلب.', 'error');
            return;
        }
        setIsRecordingPartialPayment(true);
        try {
            if (partialPaymentMethod === 'cash' && !currentShift) {
                throw new Error('يجب فتح وردية نقدية قبل تسجيل دفعة نقدية.');
            }
            const occurredAtIso = partialPaymentOccurredAt ? new Date(partialPaymentOccurredAt).toISOString() : undefined;
            await recordOrderPaymentPartial(partialPaymentOrderId, amount, partialPaymentMethod, occurredAtIso);
            await loadPaidSums(filteredAndSortedOrders.map(o => o.id));
            showNotification('تم تسجيل الدفعة بنجاح.', 'success');
            setPartialPaymentOrderId(null);
        } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            const message = raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل تسجيل الدفعة.';
            showNotification(message, 'error');
        } finally {
            setIsRecordingPartialPayment(false);
        }
    };

    const filterStatusOptions: OrderStatus[] = ['pending', 'preparing', 'out_for_delivery', 'delivered', 'scheduled', 'cancelled'];
    const editableStatusOptions: OrderStatus[] = canUpdateAllStatuses
        ? ['pending', 'preparing', 'out_for_delivery', 'delivered', 'scheduled']
        : canUpdateDeliveryStatuses
            ? ['out_for_delivery', 'delivered']
            : [];

    const handleConfirmCancel = async () => {
        if (!cancelOrderId) return;
        setIsCancelling(true);
        try {
            await updateOrderStatus(cancelOrderId, 'cancelled');
            showNotification(
                language === 'ar'
                    ? `تم إلغاء الطلب #${cancelOrderId.slice(-6).toUpperCase()}`
                    : `Order #${cancelOrderId.slice(-6).toUpperCase()} cancelled`,
                'success'
            );
        } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            const message = language === 'ar'
                ? (raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل إلغاء الطلب.')
                : (raw || 'Failed to cancel order.');
            showNotification(message, 'error');
        } finally {
            setIsCancelling(false);
            setCancelOrderId(null);
        }
    };

    const toggleAudit = async (orderId: string) => {
        if (expandedAuditOrderId === orderId) {
            setExpandedAuditOrderId(null);
            return;
        }

        setExpandedAuditOrderId(orderId);

        if (auditByOrderId[orderId]) return;

        setAuditLoadingOrderId(orderId);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) {
                throw new Error('Supabase غير مهيأ.');
            }
            const { data: rows, error } = await supabase
                .from('order_events')
                .select('id,order_id,action,actor_type,actor_id,from_status,to_status,payload,created_at')
                .eq('order_id', orderId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            const events: OrderAuditEvent[] = (rows || []).map((r: any) => ({
                id: String(r.id),
                orderId: String(r.order_id),
                action: r.action,
                actorType: r.actor_type,
                actorId: typeof r.actor_id === 'string' ? r.actor_id : undefined,
                fromStatus: typeof r.from_status === 'string' ? r.from_status : undefined,
                toStatus: typeof r.to_status === 'string' ? r.to_status : undefined,
                createdAt: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
                payload: (r.payload && typeof r.payload === 'object') ? r.payload : undefined,
            }));
            setAuditByOrderId(prev => ({ ...prev, [orderId]: events }));
        } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            const message = language === 'ar'
                ? (raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل تحميل سجل الأحداث.')
                : (raw || 'Failed to load audit log.');
            showNotification(message, 'error');
        } finally {
            setAuditLoadingOrderId(null);
        }
    };

    const handleConfirmReturn = async () => {
        if (!returnOrderId) return;
        const order = orders.find(o => o.id === returnOrderId);
        if (!order) return;

        const grossSubtotal = Number(order.subtotal) || 0;
        const discountAmount = Number((order as any).discountAmount) || 0;
        const netSubtotal = Math.max(0, grossSubtotal - discountAmount);
        const discountFactor = grossSubtotal > 0 ? (netSubtotal / grossSubtotal) : 1;

        const itemsToReturn = Object.entries(returnItems)
            .filter(([_, qty]) => qty > 0)
            .map(([cartItemId, qty]) => {
                const orderItem = order.items.find(i => i.cartItemId === cartItemId);
                if (!orderItem) return null;
                const menuItemId = orderItem.id || (orderItem as any).menuItemId;

                const unitType = (orderItem as any).unitType;
                const isWeightBased = unitType === 'kg' || unitType === 'gram';
                const totalQty = isWeightBased ? (Number((orderItem as any).weight) || 0) : (Number(orderItem.quantity) || 0);
                if (!(totalQty > 0)) return null;

                const unitPrice = unitType === 'gram' && (orderItem as any).pricePerUnit ? (Number((orderItem as any).pricePerUnit) || 0) / 1000 : (Number(orderItem.price) || 0);
                const addonsCost = Object.values((orderItem as any).selectedAddons || {}).reduce((sum: number, entry: any) => {
                    const addonPrice = Number(entry?.addon?.price) || 0;
                    const addonQty = Number(entry?.quantity) || 0;
                    return sum + (addonPrice * addonQty);
                }, 0);

                const lineGross = isWeightBased ? (unitPrice * totalQty) + addonsCost : (unitPrice + addonsCost) * totalQty;
                const proportion = Math.max(0, Math.min(1, (Number(qty) || 0) / totalQty));
                const returnedGross = lineGross * proportion;
                const returnedNet = returnedGross * discountFactor;

                return {
                    itemId: menuItemId,
                    itemName: orderItem.name?.ar || orderItem.name?.en || 'Unknown',
                    quantity: qty,
                    unitPrice: Number((returnedNet / (Number(qty) || 1)).toFixed(4)),
                    total: Number(returnedNet.toFixed(2)),
                    reason: returnReason
                };
            })
            .filter(Boolean) as any[];

        if (itemsToReturn.length === 0) {
            showNotification('اختر صنفاً واحداً على الأقل للاسترجاع', 'error');
            return;
        }

        try {
            setIsCreatingReturn(true);
            if (refundMethod === 'cash' && !currentShift) {
                throw new Error('يجب فتح وردية نقدية قبل رد أي مبلغ نقداً.');
            }
            const created = await createReturn(order, itemsToReturn, returnReason, refundMethod);
            await processReturn(created.id);
            showNotification('تم الاسترجاع وردّ المبلغ بنجاح.', 'success');
            setReturnOrderId(null);
            setReturnItems({});
            setReturnReason('');
            setRefundMethod('cash');
        } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            const message = raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل تنفيذ الاسترجاع.';
            showNotification(message, 'error');
        } finally {
            setIsCreatingReturn(false);
        }
    };

    const isDeliveredLocation = (value: unknown): value is { lat: number; lng: number; accuracy?: number } => {
        if (!value || typeof value !== 'object') return false;
        const rec = value as Record<string, unknown>;
        return typeof rec.lat === 'number' && typeof rec.lng === 'number';
    };

    const renderMobileCard = (order: Order) => {
        const paid = Number(paidSumByOrderId[order.id]) || 0;
        const remaining = Math.max(0, (Number(order.total) || 0) - paid);
        const canReturn = order.status === 'delivered' && paid > 0.01;
        
        return (
            <div key={order.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 border border-gray-100 dark:border-gray-700">
                {/* Header: ID, Date, Status */}
                <div className="flex justify-between items-start mb-3">
                    <div>
                        <div className="text-sm font-bold text-gray-900 dark:text-white">#{order.id.slice(-6).toUpperCase()}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{new Date(order.createdAt).toLocaleDateString('ar-EG-u-nu-latn')}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${adminStatusColors[order.status] || 'bg-gray-100 text-gray-800'}`}>
                            {statusTranslations[order.status] || order.status}
                        </span>
                        {order.isScheduled && order.scheduledAt && (
                            <div className="text-[10px] text-purple-600 dark:text-purple-400 font-bold" dir="ltr">
                                🕒 {new Date(order.scheduledAt).toLocaleTimeString('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}
                            </div>
                        )}
                        {(() => {
                            const isCod = order.paymentMethod === 'cash' && order.orderSource !== 'in_store' && Boolean(order.deliveryZoneId);
                            if (!isCod) return null;
                            const driverId = String(order.deliveredBy || order.assignedDeliveryUserId || '');
                            const bal = driverId ? (Number(driverCashByDriverId[driverId]) || 0) : 0;
                            if (bal <= 0.01) return null;
                            return (
                                <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                                    نقد لدى المندوب: <span className="font-mono ms-1" dir="ltr">{bal.toFixed(2)}</span>
                                </span>
                            );
                        })()}
                    </div>
                </div>

                {/* Customer Info */}
                <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-md space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{order.customerName}</span>
                        {order.phoneNumber && (
                            <a href={`tel:${order.phoneNumber}`} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 transition flex items-center gap-1">
                                📞 اتصل
                            </a>
                        )}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                        {order.address}
                    </div>
                    {order.location && (
                        <button
                            type="button"
                            onClick={() => setMapModal({ title: language === 'ar' ? 'موقع العميل' : 'Customer location', coords: order.location! })}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                        >
                            📍 عرض الموقع على الخريطة
                        </button>
                    )}
                    {order.deliveryZoneId && (
                        <div className="text-[10px] text-gray-500">
                            المنطقة: {getDeliveryZoneById(order.deliveryZoneId)?.name['ar'] || 'غير محدد'}
                        </div>
                    )}
                </div>

                {/* Items Summary */}
                <div className="mb-3">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">الأصناف ({order.items.length})</div>
                    <ul className="text-sm text-gray-800 dark:text-gray-200 space-y-1 pl-2 border-l-2 border-gray-200 dark:border-gray-600">
                        {order.items.slice(0, 3).map((item: any, idx: number) => (
                            <li key={item.cartItemId || item.id || `${item.menuItemId || 'item'}-${idx}`} className="truncate">
                                {item.quantity}x {item.name?.ar || item.name?.en || 'Item'}
                            </li>
                        ))}
                        {order.items.length > 3 && <li key="more-items" className="text-xs text-gray-500">+ {order.items.length - 3} المزيد...</li>}
                    </ul>
                </div>

                {/* Payment & Totals */}
                <div className="flex justify-between items-center mb-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                    <div>
                        <div className="text-xs text-gray-500">الإجمالي</div>
                        <div className="text-lg font-bold text-orange-600">{order.total.toFixed(2)} <span className="text-xs">ر.ي</span></div>
                    </div>
                    <div className="text-right">
                        <div className="text-xs text-gray-500">طريقة الدفع</div>
                        <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{paymentTranslations[order.paymentMethod] || order.paymentMethod}</div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/30">
                        <div className="text-xs text-gray-500">مدفوع</div>
                        <div className="font-mono text-sm text-gray-900 dark:text-white">{paid.toFixed(2)} <span className="text-xs">ر.ي</span></div>
                    </div>
                    <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/30 text-right">
                        <div className="text-xs text-gray-500">متبقي</div>
                        <div className="font-mono text-sm text-gray-900 dark:text-white">{remaining.toFixed(2)} <span className="text-xs">ر.ي</span></div>
                    </div>
                </div>

                {/* Actions Grid */}
                <div className="grid grid-cols-2 gap-2">
                    {/* Status Changer */}
                    <div className="col-span-2">
                         <select
                            value={order.status}
                            onChange={(e) => handleStatusChange(order.id, e.target.value as OrderStatus)}
                            disabled={
                                order.status === 'delivered' ||
                                order.status === 'cancelled' ||
                                editableStatusOptions.length === 0 ||
                                (isDeliveryOnly && order.assignedDeliveryUserId === adminUser?.id && !order.deliveryAcceptedAt)
                            }
                            className={`w-full p-2 border-none rounded-md text-sm font-semibold text-center focus:ring-2 focus:ring-orange-500 transition ${adminStatusColors[order.status]}`}
                        >
                             {order.status === 'cancelled' ? (
                                <option value="cancelled">ملغي</option>
                            ) : editableStatusOptions.length > 0 && !editableStatusOptions.includes(order.status) ? (
                                <>
                                    <option key={`current-${order.status}`} value={order.status}>{statusTranslations[order.status] || order.status}</option>
                                    {editableStatusOptions.map(status => (
                                        <option key={status} value={status}>{statusTranslations[status] || status}</option>
                                    ))}
                                </>
                            ) : (
                                (editableStatusOptions.length > 0 ? editableStatusOptions : [order.status]).map(status => (
                                    <option key={status} value={status}>{statusTranslations[status] || status}</option>
                                ))
                            )}
                        </select>
                    </div>

                    {/* Delivery Accept Button */}
                    {isDeliveryOnly && order.assignedDeliveryUserId === adminUser?.id && !order.deliveryAcceptedAt && order.status !== 'delivered' && order.status !== 'cancelled' && (
                        <button
                            type="button"
                            onClick={() => handleAcceptDelivery(order.id)}
                            className="col-span-2 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition text-sm font-bold shadow-sm"
                        >
                            {language === 'ar' ? '✅ قبول المهمة' : 'Accept Job'}
                        </button>
                    )}

                    {/* Delivery Assignment (Admin only) */}
                    {canAssignDelivery && (
                        <div className="col-span-2">
                            <select
                                value={order.assignedDeliveryUserId || 'none'}
                                onChange={(e) => handleAssignDelivery(order.id, e.target.value)}
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-white focus:ring-orange-500 focus:border-orange-500 transition"
                            >
                                <option value="none">{language === 'ar' ? 'بدون مندوب' : 'Unassigned'}</option>
                                {deliveryUsers.map(u => (
                                    <option key={u.id} value={u.id}>{u.fullName || u.username}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {order.status === 'delivered' && remaining > 1e-9 && (
                        <div className="col-span-2 flex gap-2">
                            <button
                                onClick={() => openPartialPaymentModal(order.id)}
                                disabled={!canMarkPaid}
                                className="flex-1 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition text-sm font-semibold disabled:opacity-60"
                            >
                                تحصيل جزئي
                            </button>
                            <button
                                onClick={() => handleMarkPaid(order.id)}
                                disabled={!canMarkPaid}
                                className="flex-1 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 transition text-sm font-semibold disabled:opacity-60"
                            >
                                {order.paymentMethod === 'cash' ? 'تأكيد التحصيل' : 'تأكيد الدفع'}
                            </button>
                        </div>
                    )}
                    
                    {/* Invoice View */}
                    {order.invoiceIssuedAt && canViewInvoice && (
                        <button
                            onClick={() => navigate(`/admin/invoice/${order.id}`)}
                            className="col-span-2 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm font-semibold"
                        >
                            📄 عرض الفاتورة
                        </button>
                    )}

                    {canViewAccounting && order.paymentMethod === 'cash' && order.orderSource !== 'in_store' && Boolean(order.deliveryZoneId) && (
                        <button
                            onClick={() => openCodAudit(order.id)}
                            className="col-span-2 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm font-semibold"
                        >
                            🧾 عرض سجل COD
                        </button>
                    )}

                    {canReturn && (
                        <div className="col-span-2 flex gap-2">
                            <button
                                type="button"
                                onClick={() => openReturnsModal(order.id)}
                                className="flex-1 py-2 bg-gray-700 text-white rounded hover:bg-gray-800 transition text-sm font-semibold"
                            >
                                📚 سجل المرتجعات
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setReturnOrderId(order.id);
                                    setReturnItems({});
                                    setReturnReason('');
                                    setRefundMethod('cash');
                                }}
                                className="flex-1 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition text-sm font-semibold"
                            >
                                ↩️ استرجاع
                            </button>
                        </div>
                    )}

                    {/* Cancel Order */}
                    {canCancel && order.status !== 'delivered' && order.status !== 'cancelled' && (
                        <button
                            type="button"
                            onClick={() => setCancelOrderId(order.id)}
                            className="py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 transition text-xs font-semibold"
                        >
                            إلغاء
                        </button>
                    )}
                    
                    {/* Audit Log */}
                    <button
                        type="button"
                        onClick={() => toggleAudit(order.id)}
                        className="py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition text-xs font-semibold"
                    >
                        سجل الإجراءات
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="animate-fade-in">
            <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                <h1 className="text-3xl font-bold dark:text-white">إدارة الطلبات</h1>
                <div className="flex items-center gap-4 flex-wrap">
                    {canCreateInStoreSale && (
                        <button
                            type="button"
                            onClick={() => setIsInStoreSaleOpen(true)}
                            className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition text-sm font-semibold"
                        >
                            {language === 'ar' ? 'إضافة بيع حضوري' : 'New in-store sale'}
                        </button>
                    )}
                    <div className="flex items-center gap-2">
                        <label htmlFor="customerFilter" className="text-sm font-medium dark:text-gray-300 mx-2">فلترة حسب العميل:</label>
                        <input
                            id="customerFilter"
                            value={customerUserIdFilter}
                            onChange={(e) => setCustomerUserIdFilter(e.target.value)}
                            placeholder={language === 'ar' ? 'UserId' : 'UserId'}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition text-sm font-mono w-56"
                        />
                        {customerUserIdFilter.trim() && (
                            <button
                                type="button"
                                onClick={() => setCustomerUserIdFilter('')}
                                className="px-3 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-sm font-semibold"
                            >
                                مسح
                            </button>
                        )}
                    </div>
                    <div>
                        <label htmlFor="statusFilter" className="text-sm font-medium dark:text-gray-300 mx-2">فلترة حسب الحالة:</label>
                        <select
                            id="statusFilter"
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value as OrderStatus | 'all')}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition"
                        >
                            <option value="all">الكل</option>
                            {filterStatusOptions.map(status => (
                                <option key={status} value={status}>{statusTranslations[status] || status}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="sortOrder" className="text-sm font-medium dark:text-gray-300 mx-2">ترتيب حسب:</label>
                        <select
                            id="sortOrder"
                            value={sortOrder}
                            onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition"
                        >
                            <option value="newest">الأحدث أولاً</option>
                            <option value="oldest">الأقدم أولاً</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="hidden md:block bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r dark:border-gray-700">رقم الطلب</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r dark:border-gray-700">بيانات الزبون</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r dark:border-gray-700">الأصناف</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r dark:border-gray-700">المبلغ</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r dark:border-gray-700">الدفع</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r dark:border-gray-700">الفاتورة</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الحالة</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="text-center py-10 text-gray-500 dark:text-gray-400">
                                        <div className="flex justify-center items-center space-x-2 rtl:space-x-reverse">
                                            <Spinner />
                                            <span>جاري تحميل الطلبات...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredAndSortedOrders.length > 0 ? (
                                filteredAndSortedOrders.map(order => (
                                    <tr key={order.id} data-order-id={order.id} className={order.id === highlightedOrderId ? 'bg-yellow-50 dark:bg-yellow-900/20' : undefined}>
                                        <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                            <div className="text-sm font-bold text-gray-900 dark:text-white">#{order.id.slice(-6).toUpperCase()}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{new Date(order.createdAt).toLocaleDateString('ar-EG-u-nu-latn')}</div>
                                            {order.isScheduled && order.scheduledAt && (
                                                <div className="text-xs text-purple-600 dark:text-purple-400 mt-1 font-semibold" title={new Date(order.scheduledAt).toLocaleString('ar-EG-u-nu-latn')}>
                                                    مجدول لـ: <span dir="ltr">{new Date(order.scheduledAt).toLocaleTimeString('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                            <div className="text-sm font-medium text-gray-900 dark:text-white">{order.customerName}</div>
                                            <div className="text-sm text-gray-500 dark:text-gray-400" dir="ltr">{order.phoneNumber}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 max-w-xs truncate" title={order.address}>{order.address}</div>
                                            {order.deliveryZoneId && (
                                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-xs truncate" title={getDeliveryZoneById(order.deliveryZoneId)?.name['ar'] || order.deliveryZoneId}>
                                                    منطقة التوصيل: {getDeliveryZoneById(order.deliveryZoneId)?.name['ar'] || order.deliveryZoneId.slice(-6).toUpperCase()}
                                                </div>
                                            )}
                                            {(() => {
                                                const isCod = order.paymentMethod === 'cash' && order.orderSource !== 'in_store' && Boolean(order.deliveryZoneId);
                                                if (!isCod) return null;
                                                const driverId = String(order.deliveredBy || order.assignedDeliveryUserId || '');
                                                const bal = driverId ? (Number(driverCashByDriverId[driverId]) || 0) : 0;
                                                if (bal <= 0.01) return null;
                                                return (
                                                    <div className="mt-1">
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                                                            نقد لدى المندوب: <span className="font-mono ms-1" dir="ltr">{bal.toFixed(2)}</span>
                                                        </span>
                                                    </div>
                                                );
                                            })()}
                                            {order.location && (
                                                <div className="mt-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => setMapModal({ title: language === 'ar' ? 'موقع العميل' : 'Customer location', coords: order.location! })}
                                                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                                    >
                                                        {language === 'ar' ? 'عرض الخريطة' : 'Show map'}
                                                    </button>
                                                </div>
                                            )}
                                            {order.notes && (
                                                <div className="text-xs text-blue-500 dark:text-blue-400 mt-1 pt-1 border-t border-gray-200 dark:border-gray-700 max-w-xs truncate" title={order.notes}>
                                                    ملاحظة: {order.notes}
                                                </div>
                                            )}
                                            {order.deliveryInstructions && (
                                                <div className="text-xs text-orange-600 dark:text-orange-400 mt-1 pt-1 border-t border-gray-200 dark:border-gray-700 max-w-xs truncate" title={order.deliveryInstructions}>
                                                    تعليمات التوصيل: {order.deliveryInstructions}
                                                </div>
                                            )}
                                            {(order.paymentProof || order.appliedCouponCode || (order.pointsRedeemedValue && order.pointsRedeemedValue > 0)) && (
                                                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-1">
                                                    {order.paymentProof && (
                                                        <div>
                                                            <span className="text-xs font-semibold dark:text-gray-300">إثبات الدفع: </span>
                                                            {order.paymentProofType === 'image' ? (
                                                                <a href={order.paymentProof} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">عرض الصورة</a>
                                                            ) : (
                                                                <span className="text-xs text-gray-700 dark:text-gray-400 font-mono">{order.paymentProof}</span>
                                                            )}
                                                        </div>
                                                    )}
                                                    {order.appliedCouponCode && (
                                                        <div className="text-xs"><span className="font-semibold dark:text-gray-300">الكوبون:</span> <span className="font-mono text-green-600 dark:text-green-400">{order.appliedCouponCode}</span></div>
                                                    )}
                                                    {order.pointsRedeemedValue && order.pointsRedeemedValue > 0 && (
                                                        <div className="text-xs"><span className="font-semibold dark:text-gray-300">نقاط مستبدلة:</span> <span className="font-mono text-yellow-600 dark:text-yellow-400">{order.pointsRedeemedValue.toFixed(0)}</span></div>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300 align-top border-r dark:border-gray-700">
                                            <ul className="space-y-1">
                                                {order.items.map((item: CartItem, idx: number) => {
                                                    const addonsArray = Object.values(item.selectedAddons);
                                                    const itemName = item.name?.[language] || item.name?.ar || item.name?.en || '';
                                                    const key =
                                                        item.cartItemId ||
                                                        (item as any).id ||
                                                        `${(item as any).menuItemId || 'item'}-${idx}`;
                                                    return (
                                                        <li key={key}>
                                                            <span className="font-semibold">{itemName} x{item.quantity}</span>
                                                            {addonsArray.length > 0 && (
                                                                <div className="text-xs text-gray-500 dark:text-gray-400 pl-2 rtl:pr-2">
                                                                    {addonsArray
                                                                        .map(({ addon }) => {
                                                                            const addonName = addon.name?.[language] || addon.name?.ar || addon.name?.en || '';
                                                                            return `+ ${addonName}`;
                                                                        })
                                                                        .join(', ')}
                                                                </div>
                                                            )}
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                            <div className="text-sm font-semibold text-orange-500" dir="ltr">{Number(order.total || 0).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.ي</div>
                                            {order.discountAmount && order.discountAmount > 0 && <div className="text-xs text-green-600 dark:text-green-400 line-through" dir="ltr">{Number(order.subtotal + order.deliveryFee).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
                                            {(() => {
                                                const paid = Number(paidSumByOrderId[order.id]) || 0;
                                                const remaining = Math.max(0, (Number(order.total) || 0) - paid);
                                                return (
                                                    <div className="mt-1 space-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                                                        <div>مدفوع: <span className="font-mono" dir="ltr">{Number(paid || 0).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                                                        <div>متبقي: <span className="font-mono" dir="ltr">{Number(remaining || 0).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300 border-r dark:border-gray-700">{paymentTranslations[order.paymentMethod] || order.paymentMethod}</td>
                                        <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                            {(() => {
                                                const paid = Number(paidSumByOrderId[order.id]) || 0;
                                                const remaining = Math.max(0, (Number(order.total) || 0) - paid);
                                                const showPaymentActions = order.status === 'delivered' && remaining > 1e-9;

                                                const paymentActions = showPaymentActions ? (
                                                    <div className="flex flex-col gap-2">
                                                        <button
                                                            onClick={() => openPartialPaymentModal(order.id)}
                                                            disabled={!canMarkPaid}
                                                            className="px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition text-sm disabled:opacity-60"
                                                        >
                                                            تحصيل جزئي
                                                        </button>
                                                        <button
                                                            onClick={() => handleMarkPaid(order.id)}
                                                            disabled={!canMarkPaid}
                                                            className="px-3 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 transition text-sm disabled:opacity-60"
                                                        >
                                                            {order.paymentMethod === 'cash' ? 'تأكيد التحصيل' : 'تأكيد الدفع'}
                                                        </button>
                                                    </div>
                                                ) : null;

                                                if (order.invoiceIssuedAt) {
                                                    return (
                                                        <div className="flex flex-col gap-2">
                                                            {canViewInvoice ? (
                                                                <div className="flex items-center gap-2">
                                                                    <div className="text-xs">
                                                                        <div className="font-mono text-gray-800 dark:text-gray-200">{order.invoiceNumber}</div>
                                                                        <div className="text-gray-500 dark:text-gray-400">طباعة: {order.invoicePrintCount || 0}</div>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => navigate(`/admin/invoice/${order.id}`)}
                                                                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-xs font-semibold"
                                                                    >
                                                                        عرض/طباعة
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <div className="text-xs text-gray-400">غير متاحة</div>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => handlePrintDeliveryNote(order)}
                                                                className="px-3 py-1 bg-gray-800 text-white rounded hover:bg-gray-900 transition text-xs font-semibold"
                                                            >
                                                                طباعة سند تسليم
                                                            </button>
                                                            {paymentActions}
                                                        </div>
                                                    );
                                                }

                                                if (order.status === 'delivered') {
                                                    return (
                                                        <div className="flex flex-col gap-2">
                                                            {order.paidAt && (
                                                                <div className="flex items-center gap-2">
                                                                    <div className="text-xs text-gray-500 dark:text-gray-400">جاري إصدار الفاتورة...</div>
                                                                    <button
                                                                        onClick={() => issueInvoiceNow(order.id)}
                                                                        className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-xs"
                                                                    >
                                                                        إصدار الآن
                                                                    </button>
                                                                </div>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => handlePrintDeliveryNote(order)}
                                                                className="px-3 py-1 bg-gray-800 text-white rounded hover:bg-gray-900 transition text-xs font-semibold"
                                                            >
                                                                طباعة سند تسليم
                                                            </button>
                                                            {paymentActions}
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div className="flex flex-col gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => handlePrintDeliveryNote(order)}
                                                            className="px-3 py-1 bg-gray-800 text-white rounded hover:bg-gray-900 transition text-xs font-semibold"
                                                        >
                                                            طباعة سند تسليم
                                                        </button>
                                                        <div className="text-xs text-gray-400">غير متاحة</div>
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <select
                                                value={order.status}
                                                onChange={(e) => handleStatusChange(order.id, e.target.value as OrderStatus)}
                                                disabled={
                                                    order.status === 'delivered' ||
                                                    order.status === 'cancelled' ||
                                                    editableStatusOptions.length === 0 ||
                                                    (isDeliveryOnly && order.assignedDeliveryUserId === adminUser?.id && !order.deliveryAcceptedAt)
                                                }
                                                className={`w-full p-2 border-none rounded-md text-sm focus:ring-2 focus:ring-orange-500 transition ${adminStatusColors[order.status]}`}
                                            >
                                                {order.status === 'cancelled' ? (
                                                    <option value="cancelled">ملغي</option>
                                                ) : editableStatusOptions.length > 0 && !editableStatusOptions.includes(order.status) ? (
                                                    <>
                                                        <option key={`current-${order.status}`} value={order.status}>{statusTranslations[order.status] || order.status}</option>
                                                        {editableStatusOptions.map(status => (
                                                            <option key={status} value={status}>{statusTranslations[status] || status}</option>
                                                        ))}
                                                    </>
                                                ) : (
                                                    (editableStatusOptions.length > 0 ? editableStatusOptions : [order.status]).map(status => (
                                                        <option key={status} value={status}>{statusTranslations[status] || status}</option>
                                                    ))
                                                )}
                                            </select>
                                            {canCancel && order.status !== 'delivered' && order.status !== 'cancelled' && (
                                                <button
                                                    type="button"
                                                    onClick={() => setCancelOrderId(order.id)}
                                                    className="mt-2 w-full px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition text-sm font-semibold"
                                                >
                                                    {language === 'ar' ? 'إلغاء الطلب' : 'Cancel order'}
                                                </button>
                                            )}
                                            {(() => {
                                                const paid = Number(paidSumByOrderId[order.id]) || 0;
                                                const canReturn = order.status === 'delivered' && paid > 0.01;
                                                if (!canReturn) return null;
                                                return (
                                                    <div className="mt-2 flex flex-col gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => openReturnsModal(order.id)}
                                                            className="w-full px-3 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-800 transition text-sm font-semibold"
                                                        >
                                                            📚 سجل المرتجعات
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setReturnOrderId(order.id);
                                                                setReturnItems({});
                                                                setReturnReason('');
                                                                setRefundMethod('cash');
                                                            }}
                                                            className="w-full px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition text-sm font-semibold"
                                                        >
                                                            ↩️ استرجاع (مرتجع)
                                                        </button>
                                                    </div>
                                                );
                                            })()}
                                            {isDeliveryOnly && order.assignedDeliveryUserId === adminUser?.id && !order.deliveryAcceptedAt && order.status !== 'delivered' && order.status !== 'cancelled' && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleAcceptDelivery(order.id)}
                                                    className="mt-2 w-full px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition text-sm font-semibold"
                                                >
                                                    {language === 'ar' ? 'قبول مهمة التوصيل' : 'Accept delivery'}
                                                </button>
                                            )}
                                            {canAssignDelivery && (
                                                <div className="mt-2">
                                                    <select
                                                        value={order.assignedDeliveryUserId || 'none'}
                                                        onChange={(e) => handleAssignDelivery(order.id, e.target.value)}
                                                        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-white focus:ring-orange-500 focus:border-orange-500 transition"
                                                    >
                                                        <option value="none">{language === 'ar' ? 'بدون مندوب' : 'Unassigned'}</option>
                                                        {deliveryUsers.map(u => (
                                                            <option key={u.id} value={u.id}>{u.fullName || u.username}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => toggleAudit(order.id)}
                                                className="mt-2 w-full px-3 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition text-sm font-semibold dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                                            >
                                                {expandedAuditOrderId === order.id
                                                    ? (language === 'ar' ? 'إخفاء السجل' : 'Hide log')
                                                    : (language === 'ar' ? 'سجل الإجراءات' : 'Audit log')}
                                            </button>
                                            {canViewAccounting && order.paymentMethod === 'cash' && order.orderSource !== 'in_store' && Boolean(order.deliveryZoneId) && (
                                                <button
                                                    type="button"
                                                    onClick={() => openCodAudit(order.id)}
                                                    className="mt-2 w-full px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition text-sm font-semibold"
                                                >
                                                    عرض سجل COD
                                                </button>
                                            )}
                                            {expandedAuditOrderId === order.id && (
                                                <div className="mt-2 p-3 rounded-md bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                                                    {auditLoadingOrderId === order.id ? (
                                                        <div className="text-xs text-gray-500 dark:text-gray-400">{language === 'ar' ? 'جاري تحميل السجل...' : 'Loading log...'}</div>
                                                    ) : (auditByOrderId[order.id]?.length || 0) > 0 ? (
                                                        <ul className="space-y-2 text-xs">
                                                            {auditByOrderId[order.id]!.map(ev => {
                                                                const actor = ev.actorType === 'admin'
                                                                    ? (language === 'ar' ? 'إداري' : 'Admin')
                                                                    : ev.actorType === 'customer'
                                                                        ? (language === 'ar' ? 'زبون' : 'Customer')
                                                                        : (language === 'ar' ? 'نظام' : 'System');

                                                                const statusPart = ev.fromStatus || ev.toStatus
                                                                    ? `${ev.fromStatus ? (statusTranslations[ev.fromStatus as OrderStatus] || ev.fromStatus) : ''}${ev.fromStatus && ev.toStatus ? ' → ' : ''}${ev.toStatus ? (statusTranslations[ev.toStatus as OrderStatus] || ev.toStatus) : ''}`.trim()
                                                                    : '';

                                                                const payload = ev.payload;
                                                                const deliveredLocationCandidate =
                                                                    payload && typeof payload === 'object' && 'deliveredLocation' in payload
                                                                        ? (payload as Record<string, unknown>).deliveredLocation
                                                                        : undefined;
                                                                const deliveredLocation = isDeliveredLocation(deliveredLocationCandidate)
                                                                    ? deliveredLocationCandidate
                                                                    : undefined;

                                                                const deliveryPinVerified =
                                                                    payload && typeof payload === 'object' && 'deliveryPinVerified' in payload
                                                                        ? Boolean((payload as Record<string, unknown>).deliveryPinVerified)
                                                                        : false;

                                                                return (
                                                                    <li key={ev.id} className="text-gray-700 dark:text-gray-200">
                                                                        <div className="flex items-start justify-between gap-2">
                                                                            <div className="min-w-0">
                                                                                <div className="font-semibold">{ev.action}</div>
                                                                                <div className="text-gray-500 dark:text-gray-400">
                                                                                    {actor}{ev.actorId ? ` • ${ev.actorId}` : ''}{statusPart ? ` • ${statusPart}` : ''}
                                                                                </div>
                                                                                {(deliveryPinVerified || deliveredLocation) && (
                                                                                    <div className="mt-1 text-gray-500 dark:text-gray-400">
                                                                                        {deliveryPinVerified && (
                                                                                            <span>{language === 'ar' ? 'تم التحقق من الرمز' : 'PIN verified'}</span>
                                                                                        )}
                                                                                        {deliveryPinVerified && deliveredLocation && <span>{' • '}</span>}
                                                                                        {deliveredLocation && (
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => setMapModal({ title: language === 'ar' ? 'موقع التسليم' : 'Delivery location', coords: { lat: deliveredLocation.lat, lng: deliveredLocation.lng } })}
                                                                                                className="text-blue-600 dark:text-blue-400 hover:underline"
                                                                                            >
                                                                                                {language === 'ar' ? 'موقع التسليم' : 'Delivery location'}
                                                                                                {typeof deliveredLocation.accuracy === 'number'
                                                                                                    ? ` (${deliveredLocation.accuracy.toFixed(0)}m)`
                                                                                                    : ''}
                                                                                            </button>
                                                                                        )}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            <div className="shrink-0 text-gray-500 dark:text-gray-400" dir="ltr">
                                                                                {new Date(ev.createdAt).toLocaleString('ar-EG-u-nu-latn')}
                                                                            </div>
                                                                        </div>
                                                                    </li>
                                                                );
                                                            })}
                                                        </ul>
                                                    ) : (
                                                        <div className="text-xs text-gray-500 dark:text-gray-400">{language === 'ar' ? 'لا يوجد سجل لهذا الطلب.' : 'No audit events for this order.'}</div>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={7} className="text-center py-10 text-gray-500 dark:text-gray-400">
                                        لا توجد طلبات تطابق الفلاتر الحالية.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="md:hidden space-y-4">
                {loading ? (
                     <div className="flex justify-center items-center py-10">
                        <Spinner />
                     </div>
                ) : filteredAndSortedOrders.length > 0 ? (
                    filteredAndSortedOrders.map(renderMobileCard)
                ) : (
                    <div className="text-center py-10 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                        لا توجد طلبات.
                    </div>
                )}
            </div>
            <ConfirmationModal
                isOpen={isInStoreSaleOpen}
                onClose={() => {
                    if (isInStoreCreating) return;
                    setIsInStoreSaleOpen(false);
                }}
                onConfirm={confirmInStoreSale}
                title={language === 'ar' ? 'بيع حضوري (داخل المحل)' : 'In-store sale'}
                message=""
                isConfirming={isInStoreCreating}
                confirmText={language === 'ar' ? 'تسجيل البيع' : 'Create sale'}
                confirmingText={language === 'ar' ? 'جاري التسجيل...' : 'Creating...'}
                cancelText={language === 'ar' ? 'رجوع' : 'Back'}
                confirmButtonClassName="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400"
                hideConfirmButton={inStoreLines.length === 0 || inStoreAvailablePaymentMethods.length === 0 || !inStorePaymentMethod}
            >
                    <div className="space-y-4">
                    <div className="flex items-center justify-between text-xs">
                        <div className="text-gray-600 dark:text-gray-300">الأصناف: <span className="font-mono">{inStoreLines.length}</span></div>
                        <div className="text-gray-600 dark:text-gray-300">الإجمالي: <span className="font-mono text-orange-600 dark:text-orange-400">{inStoreTotals.total.toFixed(2)} ر.ي</span></div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600">
                            <div className="text-gray-500 dark:text-gray-300">المجموع الفرعي</div>
                            <div className="font-mono text-gray-900 dark:text-white">{inStoreTotals.subtotal.toFixed(2)}</div>
                        </div>
                        <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600">
                            <div className="text-gray-500 dark:text-gray-300">الخصم</div>
                            <div className="font-mono text-gray-900 dark:text-white">{inStoreTotals.discountAmount.toFixed(2)}</div>
                        </div>
                        <div className="p-2 rounded bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                            <div className="text-orange-700 dark:text-orange-300">الإجمالي</div>
                            <div className="font-mono font-semibold text-orange-700 dark:text-orange-200">{inStoreTotals.total.toFixed(2)}</div>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{language === 'ar' ? 'اسم الزبون (اختياري)' : 'Customer name (optional)'}</label>
                            <input
                                type="text"
                                value={inStoreCustomerName}
                                onChange={(e) => setInStoreCustomerName(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{language === 'ar' ? 'رقم الهاتف (اختياري)' : 'Phone (optional)'}</label>
                            <input
                                type="text"
                                value={inStorePhoneNumber}
                                onChange={(e) => setInStorePhoneNumber(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{language === 'ar' ? 'ملاحظات (اختياري)' : 'Notes (optional)'}</label>
                        <textarea
                            rows={3}
                            value={inStoreNotes}
                            onChange={(e) => setInStoreNotes(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">نوع الخصم</label>
                            <select
                                value={inStoreDiscountType}
                                onChange={(e) => setInStoreDiscountType(e.target.value === 'percent' ? 'percent' : 'amount')}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            >
                                <option value="amount">مبلغ</option>
                                <option value="percent">نسبة</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{inStoreDiscountType === 'percent' ? 'قيمة الخصم (%)' : 'قيمة الخصم'}</label>
                            <NumberInput
                                id="inStoreDiscountValue"
                                name="inStoreDiscountValue"
                                value={inStoreDiscountValue}
                                onChange={(e) => setInStoreDiscountValue(parseFloat(e.target.value) || 0)}
                                min={0}
                                step={inStoreDiscountType === 'percent' ? 1 : 1}
                            />
                        </div>
                        <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 md:pt-6">
                            <input
                                type="checkbox"
                                checked={inStoreAutoOpenInvoice}
                                onChange={(e) => setInStoreAutoOpenInvoice(e.target.checked)}
                                className="form-checkbox h-5 w-5 text-orange-500 rounded focus:ring-orange-500"
                            />
                            فتح الفاتورة بعد التسجيل
                        </label>
                    </div>

                    <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{language === 'ar' ? 'طريقة الدفع' : 'Payment method'}</label>
                        <div className="flex items-center justify-between gap-3 mb-2">
                            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                <input
                                    type="checkbox"
                                    checked={inStoreMultiPaymentEnabled}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setInStoreMultiPaymentEnabled(checked);
                                        if (checked) {
                                            const total = Number(inStoreTotals.total) || 0;
                                            const initialMethod = inStorePaymentMethod && inStoreAvailablePaymentMethods.includes(inStorePaymentMethod)
                                                ? inStorePaymentMethod
                                                : (inStoreAvailablePaymentMethods[0] || 'cash');
                                            setInStorePaymentLines([{
                                                method: initialMethod,
                                                amount: Number(total.toFixed(2)),
                                                declaredAmount: 0,
                                                amountConfirmed: initialMethod === 'cash',
                                                cashReceived: 0,
                                            }]);
                                        } else {
                                            setInStorePaymentLines([]);
                                        }
                                    }}
                                    className="form-checkbox h-5 w-5 text-orange-500 rounded focus:ring-orange-500"
                                />
                                تعدد طرق الدفع
                            </label>
                            {inStoreMultiPaymentEnabled && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const method = inStoreAvailablePaymentMethods[0] || 'cash';
                                        setInStorePaymentLines(prev => [...prev, { method, amount: 0, declaredAmount: 0, amountConfirmed: method === 'cash', cashReceived: 0 }]);
                                    }}
                                    className="px-3 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 text-xs font-semibold"
                                >
                                    إضافة دفعة
                                </button>
                            )}
                        </div>
                        {inStoreMultiPaymentEnabled ? (
                            <div className="space-y-2">
                                {inStorePaymentLines.map((p, idx) => {
                                    const needsReference = p.method === 'kuraimi' || p.method === 'network';
                                    const cashReceived = Number(p.cashReceived) || 0;
                                    const amount = Number(p.amount) || 0;
                                    const change = p.method === 'cash' && cashReceived > 0 ? Math.max(0, cashReceived - amount) : 0;
                                    return (
                                        <div key={`${idx}-${p.method}`} className="p-3 border border-gray-200 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700/30 space-y-2">
                                            <div className="flex gap-2 items-end">
                                                <div className="flex-1">
                                                    <label className="block text-[11px] text-gray-600 dark:text-gray-300 mb-1">الطريقة</label>
                                                    <select
                                                        value={p.method}
                                                        onChange={(e) => {
                                                            const nextMethod = e.target.value;
                                                            setInStorePaymentLines(prev => prev.map((row, i) => i === idx ? {
                                                                ...row,
                                                                method: nextMethod,
                                                                referenceNumber: '',
                                                                senderName: '',
                                                                senderPhone: '',
                                                                declaredAmount: 0,
                                                                amountConfirmed: nextMethod === 'cash',
                                                                cashReceived: 0,
                                                            } : row));
                                                        }}
                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                    >
                                                        {inStoreAvailablePaymentMethods.map((m) => (
                                                            <option key={m} value={m}>{paymentTranslations[m] || m}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="w-44">
                                                    <label className="block text-[11px] text-gray-600 dark:text-gray-300 mb-1">المبلغ</label>
                                                    <NumberInput
                                                        id={`inStorePayAmount-${idx}`}
                                                        name={`inStorePayAmount-${idx}`}
                                                        value={p.amount}
                                                        onChange={(e) => setInStorePaymentLines(prev => prev.map((row, i) => i === idx ? { ...row, amount: parseFloat(e.target.value) || 0 } : row))}
                                                        min={0}
                                                        step={1}
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setInStorePaymentLines(prev => prev.filter((_, i) => i !== idx))}
                                                    disabled={inStorePaymentLines.length <= 1}
                                                    className="px-3 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 transition text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed dark:bg-red-900/30 dark:text-red-300"
                                                >
                                                    حذف
                                                </button>
                                            </div>

                                            {p.method === 'cash' && (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                                                    <div>
                                                        <label className="block text-[11px] text-gray-600 dark:text-gray-300 mb-1">المبلغ المستلم (اختياري)</label>
                                                        <NumberInput
                                                            id={`inStoreCashReceived-${idx}`}
                                                            name={`inStoreCashReceived-${idx}`}
                                                            value={p.cashReceived || 0}
                                                            onChange={(e) => setInStorePaymentLines(prev => prev.map((row, i) => i === idx ? { ...row, cashReceived: parseFloat(e.target.value) || 0 } : row))}
                                                            min={0}
                                                            step={1}
                                                        />
                                                    </div>
                                                    <div className="text-xs text-gray-600 dark:text-gray-300">
                                                        الباقي: <span className="font-mono">{(change || 0).toFixed(2)}</span> ر.ي
                                                    </div>
                                                </div>
                                            )}

                                            {needsReference && (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="block text-[11px] text-gray-600 dark:text-gray-300 mb-1">{p.method === 'kuraimi' ? 'رقم الإيداع' : 'رقم الحوالة'}</label>
                                                        <input
                                                            type="text"
                                                            value={p.referenceNumber || ''}
                                                            onChange={(e) => setInStorePaymentLines(prev => prev.map((row, i) => i === idx ? { ...row, referenceNumber: e.target.value } : row))}
                                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-[11px] text-gray-600 dark:text-gray-300 mb-1">{p.method === 'kuraimi' ? 'اسم المودِع' : 'اسم المرسل'}</label>
                                                        <input
                                                            type="text"
                                                            value={p.senderName || ''}
                                                            onChange={(e) => setInStorePaymentLines(prev => prev.map((row, i) => i === idx ? { ...row, senderName: e.target.value } : row))}
                                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-[11px] text-gray-600 dark:text-gray-300 mb-1">{p.method === 'kuraimi' ? 'رقم هاتف المودِع (اختياري)' : 'رقم هاتف المرسل (اختياري)'}</label>
                                                        <input
                                                            type="text"
                                                            value={p.senderPhone || ''}
                                                            onChange={(e) => setInStorePaymentLines(prev => prev.map((row, i) => i === idx ? { ...row, senderPhone: e.target.value } : row))}
                                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-[11px] text-gray-600 dark:text-gray-300 mb-1">مبلغ العملية (يجب أن يطابق مبلغ هذه الدفعة)</label>
                                                        <NumberInput
                                                            id={`inStoreDeclared-${idx}`}
                                                            name={`inStoreDeclared-${idx}`}
                                                            value={p.declaredAmount || 0}
                                                            onChange={(e) => setInStorePaymentLines(prev => prev.map((row, i) => i === idx ? { ...row, declaredAmount: parseFloat(e.target.value) || 0 } : row))}
                                                            min={0}
                                                            step={1}
                                                            className={(Math.abs((Number(p.declaredAmount) || 0) - (Number(p.amount) || 0)) > 0.0001) ? 'border-red-500' : ''}
                                                        />
                                                    </div>
                                                    <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                                        <input
                                                            type="checkbox"
                                                            checked={Boolean(p.amountConfirmed)}
                                                            onChange={(e) => setInStorePaymentLines(prev => prev.map((row, i) => i === idx ? { ...row, amountConfirmed: e.target.checked } : row))}
                                                            className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500"
                                                        />
                                                        أؤكد مطابقة المبلغ وتم التحقق منه
                                                    </label>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                <div className="text-xs text-gray-600 dark:text-gray-300">
                                    مجموع الدفعات: <span className="font-mono">{inStorePaymentLines.reduce((s, p) => s + (Number(p.amount) || 0), 0).toFixed(2)}</span> ر.ي
                                </div>
                            </div>
                        ) : (
                        <select
                            value={inStorePaymentMethod}
                            onChange={(e) => setInStorePaymentMethod(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                            {inStoreAvailablePaymentMethods.length === 0 ? (
                                <option value="">لا توجد طرق دفع مفعلة في الإعدادات</option>
                            ) : (
                                inStoreAvailablePaymentMethods.map((method) => (
                                    <option key={method} value={method}>
                                        {method === 'cash'
                                            ? 'نقدًا'
                                            : method === 'kuraimi'
                                                ? 'حسابات بنكية'
                                                : method === 'network'
                                                    ? 'حوالات'
                                                    : (paymentTranslations[method] || method)}
                                    </option>
                                ))
                            )}
                        </select>
                        )}
                    </div>

                    {!inStoreMultiPaymentEnabled && inStorePaymentMethod === 'cash' && (
                        <div className="p-3 border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30 rounded-md space-y-2">
                            <label className="block text-xs text-gray-700 dark:text-gray-300">
                                المبلغ المستلم (اختياري)
                            </label>
                            <NumberInput
                                id="inStoreCashReceived"
                                name="inStoreCashReceived"
                                value={inStoreCashReceived}
                                onChange={(e) => setInStoreCashReceived(parseFloat(e.target.value) || 0)}
                                min={0}
                                step={1}
                            />
                            <div className="text-xs text-gray-600 dark:text-gray-300">
                                الباقي: <span className="font-mono">{(inStoreCashReceived > 0 ? Math.max(0, inStoreCashReceived - (Number(inStoreTotals.total) || 0)) : 0).toFixed(2)}</span> ر.ي
                            </div>
                        </div>
                    )}

                    {!inStoreMultiPaymentEnabled && (inStorePaymentMethod === 'kuraimi' || inStorePaymentMethod === 'network') && (
                        <div className="p-3 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-md space-y-3">
                            <div className="text-xs font-semibold text-blue-800 dark:text-blue-300">
                                {inStorePaymentMethod === 'kuraimi' ? 'بيانات الإيداع البنكي' : 'بيانات الحوالة'}
                            </div>
                            <div>
                                <label className="block text-xs text-gray-700 dark:text-gray-300 mb-1">
                                    {inStorePaymentMethod === 'kuraimi' ? 'رقم الإيداع' : 'رقم الحوالة'}
                                </label>
                                <input
                                    type="text"
                                    value={inStorePaymentReferenceNumber}
                                    onChange={(e) => setInStorePaymentReferenceNumber(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                    placeholder={inStorePaymentMethod === 'kuraimi' ? 'مثال: DEP-12345' : 'مثال: TRX-12345'}
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-gray-700 dark:text-gray-300 mb-1">
                                        {inStorePaymentMethod === 'kuraimi' ? 'اسم المودِع' : 'اسم المرسل'}
                                    </label>
                                    <input
                                        type="text"
                                        value={inStorePaymentSenderName}
                                        onChange={(e) => setInStorePaymentSenderName(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-700 dark:text-gray-300 mb-1">
                                        {inStorePaymentMethod === 'kuraimi' ? 'رقم هاتف المودِع (اختياري)' : 'رقم هاتف المرسل (اختياري)'}
                                    </label>
                                    <input
                                        type="text"
                                        value={inStorePaymentSenderPhone}
                                        onChange={(e) => setInStorePaymentSenderPhone(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                        placeholder="مثال: 771234567"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                                <div>
                                    <label className="block text-xs text-gray-700 dark:text-gray-300 mb-1">
                                        مبلغ العملية (يجب أن يطابق الإجمالي)
                                    </label>
                                    <NumberInput
                                        id="inStorePaymentDeclaredAmount"
                                        name="inStorePaymentDeclaredAmount"
                                        value={inStorePaymentDeclaredAmount}
                                        onChange={(e) => setInStorePaymentDeclaredAmount(parseFloat(e.target.value) || 0)}
                                        min={0}
                                        step={1}
                                        className={(Math.abs((Number(inStorePaymentDeclaredAmount) || 0) - (Number(inStoreTotals.total) || 0)) > 0.0001) ? 'border-red-500' : ''}
                                    />
                                    <div className="mt-1 text-[10px] text-gray-600 dark:text-gray-400">
                                        الإجمالي الحالي: <span className="font-mono">{inStoreTotals.total.toFixed(2)}</span> ر.ي
                                    </div>
                                </div>
                                <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={inStorePaymentAmountConfirmed}
                                        onChange={(e) => setInStorePaymentAmountConfirmed(e.target.checked)}
                                        className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500"
                                    />
                                    أؤكد مطابقة المبلغ للإجمالي وتم التحقق منه
                                </label>
                            </div>
                        </div>
                    )}

                    {/* Addons Selection UI */}
                    {inStoreSelectedItemId && (() => {
                        const mi = menuItems.find(m => m.id === inStoreSelectedItemId);
                        if (mi && mi.addons && mi.addons.length > 0) {
                            return (
                                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md border border-gray-200 dark:border-gray-600">
                                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        {language === 'ar' ? 'الإضافات:' : 'Addons:'}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {mi.addons.map(addon => {
                                            const isSelected = Boolean(inStoreSelectedAddons[addon.id]);
                                            const addonName = addon.name?.[language] || addon.name?.ar || addon.name?.en || addon.id;
                                            return (
                                                <label key={addon.id} className="flex items-center space-x-2 rtl:space-x-reverse cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={(e) => {
                                                            setInStoreSelectedAddons(prev => ({
                                                                ...prev,
                                                                [addon.id]: e.target.checked ? 1 : 0
                                                            }));
                                                        }}
                                                        className="rounded text-orange-500 focus:ring-orange-500 dark:bg-gray-600 dark:border-gray-500"
                                                    />
                                                    <span className="text-xs text-gray-600 dark:text-gray-300">
                                                        {addonName} (+{addon.price})
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        }
                        return null;
                    })()}


                    <div className="flex flex-col gap-2">
                        {/* Item Search Filter */}
                        <input
                            type="text"
                            placeholder={language === 'ar' ? 'بحث عن صنف...' : 'Search item...'}
                            value={inStoreItemSearch}
                            onChange={(e) => setInStoreItemSearch(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key !== 'Enter') return;
                                if (inStoreSelectedItemId) {
                                    addInStoreLine();
                                    return;
                                }
                                const first = filteredInStoreMenuItems[0];
                                if (first?.id) {
                                    setInStoreSelectedItemId(first.id);
                                }
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        />

                        <div className="flex gap-2">
                            <select
                                value={inStoreSelectedItemId}
                                onChange={(e) => setInStoreSelectedItemId(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key !== 'Enter') return;
                                    addInStoreLine();
                                }}
                                onDoubleClick={() => addInStoreLine()}
                                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                size={5} // Show multiple items to make it act like a list box
                            >
                                <option value="">{language === 'ar' ? 'اختر صنف لإضافته' : 'Select item to add'}</option>
                                {filteredInStoreMenuItems.map(mi => {
                                    const name = mi.name?.[language] || mi.name?.ar || mi.name?.en || mi.id;
                                    const stock = typeof mi.availableStock === 'number' ? `(${mi.availableStock})` : '';
                                    return (
                                        <option key={mi.id} value={mi.id}>
                                            {name} {stock}
                                        </option>
                                    );
                                })}
                            </select>
                            <button
                                type="button"
                                onClick={addInStoreLine}
                                disabled={!inStoreSelectedItemId}
                                className="px-3 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition text-sm font-semibold dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 h-auto self-start disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {language === 'ar' ? 'إضافة' : 'Add'}
                            </button>
                        </div>
                    </div>

                    {
                        inStoreLines.length > 0 ? (
                            <div className="space-y-2">
                                {inStoreLines.map((line, index) => {
                                    const mi = menuItems.find(m => m.id === line.menuItemId);
                                    if (!mi) return null;
                                    const name = mi.name?.[language] || mi.name?.ar || mi.name?.en || mi.id;
                                    const isWeightBased = mi.unitType === 'kg' || mi.unitType === 'gram';
                                    const unitPrice = mi.unitType === 'gram' && mi.pricePerUnit ? mi.pricePerUnit / 1000 : mi.price;
                                    const available = typeof mi.availableStock === 'number' ? mi.availableStock : undefined;
                                    let addonsCost = 0;
                                    if (line.selectedAddons && mi.addons) {
                                        Object.entries(line.selectedAddons).forEach(([aid, qty]) => {
                                            const addon = mi.addons?.find(ad => ad.id === aid);
                                            if (addon) {
                                                addonsCost += addon.price * qty;
                                            }
                                        });
                                    }
                                    const lineTotal = isWeightBased
                                        ? (unitPrice * (line.weight ?? 0)) + (addonsCost * 1)
                                        : (unitPrice + addonsCost) * (line.quantity ?? 0);
                                    const currentValue = isWeightBased ? (line.weight ?? 0) : (line.quantity ?? 0);
                                    const exceeded = typeof available === 'number' ? currentValue > available : false;

                                    const addonNames = line.selectedAddons && mi.addons
                                        ? Object.keys(line.selectedAddons).map(aid => {
                                            const a = mi.addons?.find(ad => ad.id === aid);
                                            return a ? (a.name?.[language] || a.name?.ar || a.id) : '';
                                        }).filter(Boolean).join(', ')
                                        : '';

                                    return (
                                        <div key={`${line.menuItemId}-${index}`} className="flex flex-col gap-1 p-2 border border-gray-100 dark:border-gray-700 rounded bg-gray-50/50 dark:bg-gray-800/50">
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{name}</div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">{unitTranslations[mi.unitType || 'piece'] || (mi.unitType === 'piece' ? 'قطعة' : mi.unitType)}</div>
                                                    {addonNames && <div className="text-xs text-orange-600 dark:text-orange-400">+{addonNames}</div>}
                                                </div>
                                                <div className="text-sm font-mono text-orange-600 dark:text-orange-400 whitespace-nowrap">
                                                    {lineTotal.toFixed(2)} ر.ي
                                                </div>
                                                <div className="w-32">
                                                    <NumberInput
                                                        id={`qty-${index}`}
                                                        name={`qty-${index}`}
                                                        value={isWeightBased ? (line.weight ?? 0) : (line.quantity ?? 0)}
                                                        onChange={(e) => {
                                                            const val = parseFloat(e.target.value) || 0;
                                                            updateInStoreLine(index, isWeightBased ? { weight: val } : { quantity: val });
                                                        }}
                                                        min={0}
                                                        max={available}
                                                        step={isWeightBased ? (mi.unitType === 'gram' ? 1 : 0.01) : 1}
                                                        className={exceeded ? 'border-red-500' : ''}
                                                    />
                                                    {exceeded && (
                                                        <div className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                                                            يتجاوز المتاح: {available?.toFixed ? available.toFixed(2) : available}
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeInStoreLine(index)}
                                                    className="px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200 transition text-xs font-semibold dark:bg-red-900/30 dark:text-red-400"
                                                >
                                                    {language === 'ar' ? 'حذف' : 'Remove'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}

                                <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-sm">
                                    <span className="text-gray-600 dark:text-gray-300">{language === 'ar' ? 'الإجمالي' : 'Total'}</span>
                                    <span className="font-semibold text-orange-600 dark:text-orange-400">
                                        {inStoreTotals.total.toFixed(2)} ر.ي
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setInStoreLines([]);
                                            setInStoreSelectedItemId('');
                                            setInStoreSelectedAddons({});
                                        }}
                                        className="px-2 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 text-xs"
                                    >
                                        {language === 'ar' ? 'تصفير الكل' : 'Reset all'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {language === 'ar' ? 'أضف أصنافًا لتسجيل البيع.' : 'Add items to create the sale.'}
                            </div>
                        )
                    }
                </div >
            </ConfirmationModal >
            <ConfirmationModal
                isOpen={Boolean(cancelOrderId)}
                onClose={() => {
                    if (isCancelling) return;
                    setCancelOrderId(null);
                }}
                onConfirm={handleConfirmCancel}
                title={language === 'ar' ? 'تأكيد إلغاء الطلب' : 'Confirm order cancellation'}
                message={language === 'ar' ? 'هل أنت متأكد من إلغاء هذا الطلب؟ سيتم تحرير حجز المخزون.' : 'Cancel this order? Reserved stock will be released.'}
                isConfirming={isCancelling}
                confirmText={language === 'ar' ? 'تأكيد الإلغاء' : 'Confirm'}
                confirmingText={language === 'ar' ? 'جاري الإلغاء...' : 'Cancelling...'}
                cancelText={language === 'ar' ? 'رجوع' : 'Back'}
                confirmButtonClassName="bg-red-600 hover:bg-red-700 disabled:bg-red-400"
            />
            <ConfirmationModal
                isOpen={Boolean(deliverPinOrderId)}
                onClose={() => {
                    if (isDeliverConfirming) return;
                    setDeliverPinOrderId(null);
                    setDeliveryPinInput('');
                }}
                onConfirm={confirmDeliveredWithPin}
                title={language === 'ar' ? 'تأكيد التسليم' : 'Confirm delivery'}
                message=""
                isConfirming={isDeliverConfirming}
                confirmText={language === 'ar' ? 'تأكيد' : 'Confirm'}
                confirmingText={language === 'ar' ? 'جاري التأكيد...' : 'Confirming...'}
                cancelText={language === 'ar' ? 'رجوع' : 'Back'}
                confirmButtonClassName="bg-green-600 hover:bg-green-700 disabled:bg-green-400"
            >
                <div className="space-y-3">
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        {language === 'ar' ? 'أدخل رمز التسليم الذي لدى الزبون لتأكيد التسليم.' : 'Enter the customer delivery PIN to confirm delivery.'}
                    </p>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={deliveryPinInput}
                        onChange={(e) => setDeliveryPinInput(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder={language === 'ar' ? 'رمز التسليم' : 'Delivery PIN'}
                    />
                </div>
            </ConfirmationModal>

            <ConfirmationModal
                isOpen={Boolean(mapModal)}
                onClose={() => setMapModal(null)}
                onConfirm={() => { }}
                title={mapModal?.title || ''}
                message=""
                cancelText={language === 'ar' ? 'إغلاق' : 'Close'}
                hideConfirmButton
                maxWidthClassName="max-w-3xl"
            >
                {mapModal && (
                    <div className="space-y-3">
                        <OsmMapEmbed center={mapModal.coords} delta={0.01} title={mapModal.title} heightClassName="h-80" showLink={false} />
                        <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">
                            {mapModal.coords.lat.toFixed(6)}, {mapModal.coords.lng.toFixed(6)}
                        </div>
                    </div>
                )}
            </ConfirmationModal>

            <ConfirmationModal
                isOpen={Boolean(codAuditOrderId)}
                onClose={() => {
                    if (codAuditLoading) return;
                    setCodAuditOrderId(null);
                    setCodAuditData(null);
                }}
                onConfirm={() => { }}
                title={codAuditOrderId ? `سجل COD للطلب #${codAuditOrderId.slice(-6).toUpperCase()}` : 'سجل COD'}
                message=""
                cancelText="إغلاق"
                hideConfirmButton
                maxWidthClassName="max-w-3xl"
            >
                <div className="space-y-3">
                    {codAuditLoading ? (
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                            <Spinner />
                            <span>جاري التحميل...</span>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-xs text-gray-600 dark:text-gray-300">
                                    هذا السجل للعرض فقط.
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        try {
                                            navigator.clipboard.writeText(JSON.stringify(codAuditData ?? {}, null, 2));
                                            showNotification('تم النسخ', 'success');
                                        } catch {
                                            showNotification('تعذر النسخ', 'error');
                                        }
                                    }}
                                    className="px-3 py-1 bg-gray-900 text-white rounded hover:bg-gray-800 transition text-xs"
                                >
                                    نسخ JSON
                                </button>
                            </div>
                            <pre className="text-xs bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-md p-3 overflow-auto max-h-[60dvh]">
                                {JSON.stringify(codAuditData ?? {}, null, 2)}
                            </pre>
                        </>
                    )}
                </div>
            </ConfirmationModal>

            <ConfirmationModal
                isOpen={Boolean(partialPaymentOrderId)}
                onClose={() => {
                    if (isRecordingPartialPayment) return;
                    setPartialPaymentOrderId(null);
                }}
                onConfirm={confirmPartialPayment}
                title={partialPaymentOrderId ? `تحصيل جزئي للطلب #${partialPaymentOrderId.slice(-6).toUpperCase()}` : 'تحصيل جزئي'}
                message=""
                isConfirming={isRecordingPartialPayment}
                confirmText="تسجيل الدفعة"
                confirmingText="جاري التسجيل..."
                cancelText="رجوع"
                confirmButtonClassName="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400"
                maxWidthClassName="max-w-lg"
            >
                {partialPaymentOrderId && (() => {
                const order = filteredAndSortedOrders.find(o => o.id === partialPaymentOrderId) || orders.find(o => o.id === partialPaymentOrderId);
                if (!order) return null;
                const paid = Number(paidSumByOrderId[partialPaymentOrderId]) || 0;
                const remaining = Math.max(0, (Number(order.total) || 0) - paid);
                return (
                        <div className="space-y-4">
                            <div className="grid grid-cols-3 gap-3 text-xs">
                                <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                                    <div className="text-gray-500 dark:text-gray-300">الإجمالي</div>
                                    <div className="font-mono text-gray-900 dark:text-white">{(Number(order.total) || 0).toFixed(2)}</div>
                                </div>
                                <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                                    <div className="text-gray-500 dark:text-gray-300">مدفوع</div>
                                    <div className="font-mono text-gray-900 dark:text-white">{paid.toFixed(2)}</div>
                                </div>
                                <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                                    <div className="text-gray-500 dark:text-gray-300">متبقي</div>
                                    <div className="font-mono text-gray-900 dark:text-white">{remaining.toFixed(2)}</div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">طريقة الدفع</label>
                                <select
                                    value={partialPaymentMethod}
                                    onChange={(e) => setPartialPaymentMethod(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                >
                                    {(order.orderSource === 'in_store' ? ['cash'] : Object.keys(paymentTranslations)).map((key) => (
                                        <option key={key} value={key}>{paymentTranslations[key] || key}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">المبلغ</label>
                                <NumberInput
                                    id="partial-payment-amount"
                                    name="partial-payment-amount"
                                    value={partialPaymentAmount}
                                    onChange={(e) => setPartialPaymentAmount(parseFloat(e.target.value) || 0)}
                                    min={0}
                                    step={0.01}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">وقت الدفعة</label>
                                <input
                                    type="datetime-local"
                                    value={partialPaymentOccurredAt}
                                    onChange={(e) => setPartialPaymentOccurredAt(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                                <div className="mt-1 text-[10px] text-gray-600 dark:text-gray-400">
                                    لضمان ربط الدفعة بالوردية الصحيحة، اختر وقتًا داخل فترة الوردية.
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </ConfirmationModal>

            <ConfirmationModal
                isOpen={Boolean(returnOrderId)}
                onClose={() => {
                    if (isCreatingReturn) return;
                    setReturnOrderId(null);
                    setReturnItems({});
                    setReturnReason('');
                }}
                onConfirm={handleConfirmReturn}
                title="استرجاع أصناف (Sales Return)"
                message=""
                isConfirming={isCreatingReturn}
                confirmText="تأكيد الاسترجاع"
                confirmingText="جاري الاسترجاع..."
                cancelText="إلغاء"
                confirmButtonClassName="bg-red-600 hover:bg-red-700 disabled:bg-red-400"
                maxWidthClassName="max-w-2xl"
                hideConfirmButton={Object.values(returnItems).reduce((a, b) => a + b, 0) === 0}
            >
                {returnOrderId && (() => {
                    const order = orders.find(o => o.id === returnOrderId);
                    if (!order) return null;
                    return (
                        <div className="space-y-4">
                            <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-md text-sm text-red-800 dark:text-red-200">
                                سيتم إنشاء إشعار دائن (Credit Note) وإرجاع الأصناف للمخزون.
                            </div>
                            
                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                {order.items.map((item: any) => {
                                    const itemId = item.cartItemId || item.id;
                                    const unitType = (item as any).unitType;
                                    const isWeightBased = unitType === 'kg' || unitType === 'gram';
                                    const maxQty = isWeightBased ? (Number((item as any).weight) || 0) : item.quantity;
                                    const currentReturnQty = returnItems[itemId] || 0;
                                    const itemName = item.name?.ar || item.name?.en || 'Item';
                                    
                                    return (
                                        <div key={itemId} className="flex items-center justify-between p-2 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800">
                                            <div className="flex-1">
                                                <div className="font-semibold text-sm">{itemName}</div>
                                                <div className="text-xs text-gray-500">
                                                    {isWeightBased ? 'الوزن في الطلب: ' : 'الكمية في الطلب: '}
                                                    {maxQty}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <label className="text-xs text-gray-600 dark:text-gray-400">للاسترجاع:</label>
                                                <NumberInput
                                                    id={`return-qty-${itemId}`}
                                                    name={`return-qty-${itemId}`}
                                                    value={currentReturnQty}
                                                    onChange={(e) => {
                                                        const val = parseFloat(e.target.value) || 0;
                                                        setReturnItems(prev => ({ ...prev, [itemId]: Math.min(val, maxQty) }));
                                                    }}
                                                    min={0}
                                                    max={maxQty}
                                                    className="w-20"
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div>
                                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">سبب الاسترجاع</label>
                                <textarea
                                    value={returnReason}
                                    onChange={(e) => setReturnReason(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                    rows={2}
                                    placeholder="مثال: تالف، طلب خاطئ..."
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">طريقة رد المبلغ</label>
                                <select
                                    value={refundMethod}
                                    onChange={(e) => setRefundMethod(parseRefundMethod(e.target.value))}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                >
                                    <option value="cash">نقدي</option>
                                    <option value="network">حوالات</option>
                                    <option value="kuraimi">حسابات بنكية</option>
                                </select>
                            </div>

                            <div className="flex justify-between items-center pt-2 border-t dark:border-gray-700">
                                <span className="font-semibold text-sm">إجمالي الاسترجاع المتوقع:</span>
                                <span className="font-bold text-red-600">
                                    {(() => {
                                        const grossSubtotal = Number(order.subtotal) || 0;
                                        const discountAmount = Number((order as any).discountAmount) || 0;
                                        const netSubtotal = Math.max(0, grossSubtotal - discountAmount);
                                        const discountFactor = grossSubtotal > 0 ? (netSubtotal / grossSubtotal) : 1;

                                        const total = Object.entries(returnItems).reduce((sum, [cartItemId, qty]) => {
                                            if (!(qty > 0)) return sum;
                                            const item = order.items.find(i => i.cartItemId === cartItemId);
                                            if (!item) return sum;
                                            const unitType = (item as any).unitType;
                                            const isWeightBased = unitType === 'kg' || unitType === 'gram';
                                            const totalQty = isWeightBased ? (Number((item as any).weight) || 0) : (Number(item.quantity) || 0);
                                            if (!(totalQty > 0)) return sum;
                                            const unitPrice = unitType === 'gram' && (item as any).pricePerUnit ? (Number((item as any).pricePerUnit) || 0) / 1000 : (Number(item.price) || 0);
                                            const addonsCost = Object.values((item as any).selectedAddons || {}).reduce((s: number, entry: any) => {
                                                const addonPrice = Number(entry?.addon?.price) || 0;
                                                const addonQty = Number(entry?.quantity) || 0;
                                                return s + (addonPrice * addonQty);
                                            }, 0);
                                            const lineGross = isWeightBased ? (unitPrice * totalQty) + addonsCost : (unitPrice + addonsCost) * totalQty;
                                            const proportion = Math.max(0, Math.min(1, (Number(qty) || 0) / totalQty));
                                            return sum + (lineGross * proportion * discountFactor);
                                        }, 0);

                                        return total.toFixed(2);
                                    })()} ر.ي
                                </span>
                            </div>
                        </div>
                    );
                })()}
            </ConfirmationModal>

            <ConfirmationModal
                isOpen={Boolean(returnsOrderId)}
                onClose={() => setReturnsOrderId(null)}
                onConfirm={() => setReturnsOrderId(null)}
                title="سجل المرتجعات"
                message=""
                cancelText="إغلاق"
                hideConfirmButton={true}
                maxWidthClassName="max-w-2xl"
            >
                {returnsOrderId && (
                    <div className="space-y-3">
                        <div className="text-xs text-gray-600 dark:text-gray-300">
                            الطلب: #{returnsOrderId.slice(-6).toUpperCase()}
                        </div>
                        {returnsLoading && !returnsByOrderId[returnsOrderId] ? (
                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                <Spinner />
                                <span>جاري تحميل المرتجعات...</span>
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                {(returnsByOrderId[returnsOrderId] || []).length === 0 ? (
                                    <div className="text-sm text-gray-600 dark:text-gray-300">
                                        لا توجد مرتجعات لهذا الطلب.
                                    </div>
                                ) : (
                                    (returnsByOrderId[returnsOrderId] || []).map((r: any) => (
                                        <div key={String(r.id)} className="border border-gray-200 dark:border-gray-700 rounded-md p-3 bg-white dark:bg-gray-800">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="font-semibold text-sm">
                                                    مرتجع #{String(r.id).slice(-6).toUpperCase()}
                                                </div>
                                                <div className="text-xs text-gray-600 dark:text-gray-300">
                                                    {r.status === 'completed' ? 'مكتمل' : (r.status === 'draft' ? 'مسودة' : 'ملغي')}
                                                </div>
                                            </div>
                                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                                التاريخ: {String(r.returnDate || r.return_date || '').slice(0, 19).replace('T', ' ')}
                                            </div>
                                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                                طريقة الرد: {paymentTranslations[String(r.refundMethod || r.refund_method || 'unknown')] || String(r.refundMethod || r.refund_method || 'غير محدد')}
                                            </div>
                                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                                المبلغ: {Number(r.totalRefundAmount ?? r.total_refund_amount ?? 0).toFixed(2)} ر.ي
                                            </div>
                                            {Array.isArray(r.items) && r.items.length > 0 && (
                                                <div className="mt-2 text-xs text-gray-700 dark:text-gray-200">
                                                    <div className="font-semibold mb-1">الأصناف:</div>
                                                    <div className="space-y-1">
                                                        {r.items.map((it: any, idx: number) => (
                                                            <div key={`${String(r.id)}-${idx}`} className="flex justify-between gap-2">
                                                                <span className="truncate">{it.itemName || it.name || it.itemId}</span>
                                                                <span className="shrink-0">× {Number(it.quantity || 0)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                )}
            </ConfirmationModal>
        </div >
    );
};

export default ManageOrdersScreen;
