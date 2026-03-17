import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import PrintableQuotation from '../../components/admin/documents/PrintableQuotation';
import StandaloneQuotationPrint from '../../components/admin/PrintableQuotation';
import type { QuotationPrintData } from '../../components/admin/PrintableQuotation';
import { useDeliveryZones } from '../../contexts/DeliveryZoneContext';
import { useAuth } from '../../contexts/AuthContext';
import { useCashShift } from '../../contexts/CashShiftContext';
import { useSessionScope } from '../../contexts/SessionScopeContext';
import { useWarehouses } from '../../contexts/WarehouseContext';
import OsmMapEmbed from '../../components/OsmMapEmbed';
import NumberInput from '../../components/NumberInput';
import { useMenu } from '../../contexts/MenuContext';
import { useItemMeta } from '../../contexts/ItemMetaContext';
import { useGovernance } from '../../contexts/GovernanceContext';
import { useStock } from '../../contexts/StockContext';
import { getBaseCurrencyCode, getSupabaseClient } from '../../supabase';
import { printContent } from '../../utils/printUtils';
import { printJournalVoucherByEntryId, printPaymentVoucherByPaymentId, printReceiptVoucherByPaymentId } from '../../utils/vouchers';
import { printSalesReturnById } from '../../utils/returnsPrint';
import CurrencyDualAmount from '../../components/common/CurrencyDualAmount';
import { toDateTimeLocalInputValue } from '../../utils/dateUtils';
import { localizeUomCodeAr } from '../../utils/displayLabels';
import { getCurrencyDecimalsByCode as sharedGetCurrencyDecimals, initCurrencyDecimals } from '../../utils/currencyDecimals';
import { inferDestinationParentCode, matchesDestinationCurrency } from '../../utils/accountDestinationUtils';
import { Trash } from '../../components/icons';

const statusTranslations: Record<OrderStatus, string> = {
    pending: 'قيد الانتظار',
    preparing: 'قيد التجهيز',
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
    ar: 'آجل',
    mixed: 'متعدد',
    unknown: 'غير محدد'
};

type OrderPurgeRequestLite = {
    id: string;
    order_id: string;
    requested_by: string;
    requested_at: string;
    reason: string;
    reason_category: string;
    status: string;
};

type PurgeDashboardRow = {
    id: string;
    order_id: string;
    requested_by: string;
    requested_at: string;
    reason: string;
    reason_category: string;
    status: string;
};
type InStoreSaleUxMetric = {
    opId: string;
    elapsedMs: number;
    slowPath: boolean;
    detached: boolean;
    createdAt: string;
};

const ManageOrdersScreen: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { orders, updateOrderStatus, assignOrderToDelivery, acceptDeliveryAssignment, createInStoreSale, resumeInStorePendingOrder, cancelInStorePendingOrder, loading, markOrderPaid, recordOrderPaymentPartial, issueInvoiceNow, fetchOrders, fetchRemoteOrderById } = useOrders();
    const { createReturn, processReturn, getReturnsByOrder } = useSalesReturn();
    const { showNotification } = useToast();
    const language = 'ar';
    const { settings } = useSettings();
    const [baseCode, setBaseCode] = useState('—');
    useEffect(() => { void initCurrencyDecimals(); }, []);
    const IN_STORE_DELIVERY_ZONE_ID = '11111111-1111-4111-8111-111111111111';
    const isInStoreOrder = (order: Order) => {
        if (!order) return false;
        const src = String((order as any).orderSource || '').trim();
        if (src === 'in_store') return true;
        const zone = String((order as any).deliveryZoneId || '').trim();
        if (zone && zone === IN_STORE_DELIVERY_ZONE_ID) return true;
        const addr = String((order as any).address || '').trim();
        return addr === 'داخل المحل';
    };
    const getOrderTraceId = (order: Order) => {
        const direct = String((order as any)?.clientTraceId || (order as any)?.traceId || '').trim();
        if (direct) return direct;
        const nested = String((order as any)?.data?.clientTraceId || (order as any)?.data?.traceId || (order as any)?.data?.opId || '').trim();
        return nested;
    };
    const getOrderFailureReason = (order: Order) => String((order as any)?.inStoreFailureReason || (order as any)?.data?.inStoreFailureReason || '').trim();
    const copyTraceId = useCallback(async (traceId: string) => {
        const value = String(traceId || '').trim();
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            showNotification('تم نسخ رقم التتبع', 'success');
        } catch {
            showNotification('تعذر نسخ رقم التتبع', 'error');
        }
    }, [showNotification]);

    useEffect(() => {
        void getBaseCurrencyCode().then((c) => {
            if (!c) return;
            setBaseCode(c);
        });
    }, []);

    // Return Logic State
    const [returnOrderId, setReturnOrderId] = useState<string | null>(null);
    const [returnItems, setReturnItems] = useState<Record<string, number>>({});
    const [returnUnits, setReturnUnits] = useState<Record<string, string>>({});
    const [isCreatingReturn, setIsCreatingReturn] = useState(false);
    const [returnReason, setReturnReason] = useState('');
    const [refundMethod, setRefundMethod] = useState<'cash' | 'network' | 'kuraimi' | 'ar' | 'store_credit'>('cash');
    const [voidOrderId, setVoidOrderId] = useState<string | null>(null);
    const [voidReason, setVoidReason] = useState('');
    const [isVoidingOrder, setIsVoidingOrder] = useState(false);
    const inStoreCreationLock = useRef(false);
    const [returnsOrderId, setReturnsOrderId] = useState<string | null>(null);
    const [returnsByOrderId, setReturnsByOrderId] = useState<Record<string, any[]>>({});
    const [returnsLoading, setReturnsLoading] = useState(false);
    const [returnsActionBusy, setReturnsActionBusy] = useState<{ id: string; action: 'process' | 'cancel' | '' }>({ id: '', action: '' });
    const [returnsDocsRepairing, setReturnsDocsRepairing] = useState(false);
    const returnsOrder = useMemo(() => {
        if (!returnsOrderId) return null;
        return orders.find(o => o.id === returnsOrderId) || null;
    }, [orders, returnsOrderId]);
    // const { t, language } = useSettings();
    const { getDeliveryZoneById } = useDeliveryZones();
    const { hasPermission, listAdminUsers, user: adminUser } = useAuth();
    const { currentShift } = useCashShift();
    const sessionScope = useSessionScope();
    const { warehouses, getWarehouseById } = useWarehouses();
    const { menuItems: allMenuItems } = useMenu();
    const { getStockByItemId, fetchStock, getGlobalSellableByItemId, getGlobalLastUpdatedByItemId } = useStock();
    const { isWeightBasedUnit, getUnitLabel } = useItemMeta();
    const { guardPosting } = useGovernance();
    const [filterStatus, setFilterStatus] = useState<OrderStatus | 'all' | 'delivered_no_returns'>('all');
    const [filterPaymentMethod, setFilterPaymentMethod] = useState<string>('all');
    const [filterCurrency, setFilterCurrency] = useState<string>('all');
    const [filterDateFrom, setFilterDateFrom] = useState('');
    const [filterDateTo, setFilterDateTo] = useState('');
    const [filterWarehouseView, setFilterWarehouseView] = useState<string>('');
    const [returnsOnly, setReturnsOnly] = useState(false);
    const [autoCandidatesOnly, setAutoCandidatesOnly] = useState(false);
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
    const [customerUserIdFilter, setCustomerUserIdFilter] = useState<string>('');
    const [customerNameFilter, setCustomerNameFilter] = useState('');
    const [filterShiftId, setFilterShiftId] = useState<string>('all');
    const [recentShifts, setRecentShifts] = useState<any[]>([]);
    const [adminUserMap, setAdminUserMap] = useState<Record<string, string>>({});
    const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
    const [isCancelling, setIsCancelling] = useState(false);
    const [purgePaymentOrderId, setPurgePaymentOrderId] = useState<string | null>(null);
    const [isPurgingPayment, setIsPurgingPayment] = useState(false);
    const [purgePaymentReason, setPurgePaymentReason] = useState('');
    const [purgePaymentReasonCategory, setPurgePaymentReasonCategory] = useState('misapplied_payment');
    const [purgeApprovalNote, setPurgeApprovalNote] = useState('');
    const [pendingPurgeByOrderId, setPendingPurgeByOrderId] = useState<Record<string, OrderPurgeRequestLite>>({});
    const [approvePurgeRequestId, setApprovePurgeRequestId] = useState<string | null>(null);
    const [isApprovingPurge, setIsApprovingPurge] = useState(false);
    const [purgeDashboardRows, setPurgeDashboardRows] = useState<PurgeDashboardRow[]>([]);
    const [purgeDashboardLoading, setPurgeDashboardLoading] = useState(false);
    const [bulkApproveNote, setBulkApproveNote] = useState('مراجعة ثنائية عاجلة وتمت مطابقة العملية');
    const [bulkOrderIdsInput, setBulkOrderIdsInput] = useState('');
    const [bulkRequestReason, setBulkRequestReason] = useState('تصحيح جماعي لدفعات مسجلة بالخطأ بعد مطابقة السجلات المحاسبية');
    const [bulkRequestCategory, setBulkRequestCategory] = useState('misapplied_payment');
    const [isBulkPurgeBusy, setIsBulkPurgeBusy] = useState(false);
    const [autoCandidateScanBusy, setAutoCandidateScanBusy] = useState(false);
    const [expandedAuditOrderId, setExpandedAuditOrderId] = useState<string | null>(null);
    const [auditLoadingOrderId, setAuditLoadingOrderId] = useState<string | null>(null);
    const [auditByOrderId, setAuditByOrderId] = useState<Record<string, OrderAuditEvent[]>>({});
    const [deliveryUsers, setDeliveryUsers] = useState<AdminUser[]>([]);
    const [deliverPinOrderId, setDeliverPinOrderId] = useState<string | null>(null);
    const [deliveryPinInput, setDeliveryPinInput] = useState('');
    const [isDeliverConfirming, setIsDeliverConfirming] = useState(false);
    const scopeWarehouseId = String(sessionScope.scope?.warehouseId || '').trim();
    const effectiveWarehouseView = String(filterWarehouseView || scopeWarehouseId || '').trim();
    const isReadOnlyOrdersView = Boolean(
        effectiveWarehouseView === 'all' ||
        (effectiveWarehouseView && scopeWarehouseId && effectiveWarehouseView !== scopeWarehouseId)
    );
    const scopeWarehouseName = useMemo(() => {
        if (!scopeWarehouseId) return '—';
        const w = warehouses.find((x: any) => String((x as any)?.id || '') === scopeWarehouseId);
        return String((w as any)?.name || (w as any)?.code || '—');
    }, [scopeWarehouseId, warehouses]);
    const effectiveWarehouseViewName = useMemo(() => {
        if (!effectiveWarehouseView) return scopeWarehouseName;
        if (effectiveWarehouseView === 'all') return 'كل المستودعات';
        const w = warehouses.find((x: any) => String((x as any)?.id || '') === effectiveWarehouseView);
        return String((w as any)?.name || (w as any)?.code || '—');
    }, [effectiveWarehouseView, scopeWarehouseName, warehouses]);
    const assertMutableOrdersView = useCallback(() => {
        if (!isReadOnlyOrdersView) return true;
        showNotification('وضع العرض الحالي للقراءة فقط. اختر "المستودع النشط للجلسة" لتفعيل العمليات.', 'error');
        return false;
    }, [isReadOnlyOrdersView, showNotification]);
    const getOrderWarehouseId = useCallback((order: Order) => {
        const direct = String((order as any)?.warehouseId || '').trim();
        if (direct) return direct;
        const nested = String((order as any)?.data?.warehouseId || (order as any)?.data?.warehouse_id || '').trim();
        return nested;
    }, []);
    const [totalOrderCount, setTotalOrderCount] = useState<number | null>(null);

    // Lightweight total order count from database
    useEffect(() => {
        let active = true;
        const fetchCount = async () => {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            try {
                const { count, error } = await supabase
                    .from('orders')
                    .select('id', { count: 'exact', head: true });
                if (!error && active && typeof count === 'number') setTotalOrderCount(count);
            } catch { }
        };
        fetchCount();
        return () => { active = false; };
    }, [orders.length]);

    useEffect(() => {
        let active = true;
        const fetchShifts = async () => {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            try {
                const { data } = await supabase.from('cash_shifts').select('id, cashier_id, opened_at, closed_at').order('opened_at', { ascending: false }).limit(30);
                if (active && Array.isArray(data)) setRecentShifts(data);
            } catch { }
        };
        fetchShifts();
        return () => { active = false; };
    }, []);

    useEffect(() => {
        let active = true;
        listAdminUsers().then(users => {
            if (!active) return;
            const m: Record<string, string> = {};
            users.forEach(u => m[u.id] = (u as any).fullName || u.email || u.id);
            setAdminUserMap(m);
        }).catch(() => { });
        return () => { active = false; };
    }, [listAdminUsers]);

    const [isInStoreSaleOpen, setIsInStoreSaleOpen] = useState(false);
    const [isInStoreCreating, setIsInStoreCreating] = useState(false);
    const [inStoreCreatingSlow, setInStoreCreatingSlow] = useState(false);
    const inStoreCreatingSlowTimerRef = useRef<number | null>(null);
    const [inStoreCreateOpId, setInStoreCreateOpId] = useState('');
    const inStoreCreateOpIdRef = useRef('');
    const [inStoreCreateStartedAt, setInStoreCreateStartedAt] = useState<number>(0);
    const inStoreCreateDetachedRef = useRef(false);
    const inStorePendingOrderIdRef = useRef('');
    const inStoreBackgroundProbeTimerRef = useRef<number | null>(null);
    const inStoreBackgroundProbeBusyRef = useRef(false);
    const [inStoreUxMetrics, setInStoreUxMetrics] = useState<InStoreSaleUxMetric[]>([]);
    const inStoreUxPersistBusyRef = useRef(false);
    const inStoreUxPersistQueueRef = useRef<InStoreSaleUxMetric[]>([]);
    const [inStoreIsCredit, setInStoreIsCredit] = useState(false); // NEW: Credit Sale State
    const [inStoreCreditDays, setInStoreCreditDays] = useState<number>(30);
    const [inStoreCreditDueDate, setInStoreCreditDueDate] = useState<string>('');
    const [inStoreCreditSummary, setInStoreCreditSummary] = useState<any | null>(null);
    const [inStoreCreditSummaryLoading, setInStoreCreditSummaryLoading] = useState(false);
    const [inStoreCreditOverrideModalOpen, setInStoreCreditOverrideModalOpen] = useState(false);
    const [inStoreCreditOverrideReason, setInStoreCreditOverrideReason] = useState('');
    const [inStoreCreditOverridePending, setInStoreCreditOverridePending] = useState<any | null>(null);
    const [inStoreBelowCostModalOpen, setInStoreBelowCostModalOpen] = useState(false);
    const [inStoreBelowCostReason, setInStoreBelowCostReason] = useState('');
    const [inStoreBelowCostPending, setInStoreBelowCostPending] = useState<{ payload: any; creditOverrideReason?: string; pendingOrderId?: string } | null>(null);
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
    const [inStoreInvoiceStatement, setInStoreInvoiceStatement] = useState('');
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
        destinationAccountId?: string;
    }>>([]);
    const [destinationAccounts, setDestinationAccounts] = useState<{id: string, name: string, code: string, parentCode: string}[]>([]);
    const [inStorePaymentDestinationAccountId, setInStorePaymentDestinationAccountId] = useState<string>('');
    const [partialPaymentDestinationAccountId, setPartialPaymentDestinationAccountId] = useState<string>('');

    const closeInStoreAndContinueInBackground = useCallback(() => {
        if (!isInStoreCreating) {
            setIsInStoreSaleOpen(false);
            return;
        }
        inStoreCreateDetachedRef.current = true;
        setIsInStoreSaleOpen(false);
        const opId = inStoreCreateOpIdRef.current || inStoreCreateOpId || 'N/A';
        showNotification(`تم إغلاق النافذة ومتابعة تسجيل البيع بالخلفية. رقم التتبع: ${opId}`, 'info');
    }, [inStoreCreateOpId, isInStoreCreating, showNotification]);
    const flushInStoreUxMetricQueue = useCallback(async () => {
        if (inStoreUxPersistBusyRef.current) return;
        const supabase = getSupabaseClient();
        if (!supabase || !adminUser?.id) return;
        inStoreUxPersistBusyRef.current = true;
        try {
            while (inStoreUxPersistQueueRef.current.length > 0) {
                const batch = inStoreUxPersistQueueRef.current.splice(0, 10);
                const rows = batch.map((m) => ({
                    action: 'in_store_sale_ux_metric',
                    module: 'orders_ux',
                    details: `op:${m.opId} elapsed:${m.elapsedMs}ms slow:${m.slowPath ? 1 : 0} detached:${m.detached ? 1 : 0}`,
                    performed_by: adminUser.id,
                    performed_at: m.createdAt,
                    metadata: {
                        opId: m.opId,
                        elapsedMs: m.elapsedMs,
                        slowPath: m.slowPath,
                        detached: m.detached,
                    },
                    risk_level: m.slowPath ? 'MEDIUM' : 'LOW',
                    reason_code: m.slowPath ? 'UX_SLOW_PATH' : 'UX_OK',
                }));
                try {
                    await supabase.from('system_audit_logs').insert(rows as any);
                } catch {}
            }
        } finally {
            inStoreUxPersistBusyRef.current = false;
        }
    }, [adminUser?.id]);
    const withTimeout = useCallback(async <T,>(promise: Promise<T>, timeoutMs: number, code: string) => {
        let timer: number | null = null;
        try {
            return await Promise.race([
                promise,
                new Promise<T>((_, reject) => {
                    timer = window.setTimeout(() => {
                        const err: any = new Error(code);
                        err.code = code;
                        reject(err);
                    }, timeoutMs);
                }),
            ]);
        } finally {
            if (timer != null) window.clearTimeout(timer);
        }
    }, []);
    const stopInStoreBackgroundProbe = useCallback(() => {
        if (inStoreBackgroundProbeTimerRef.current != null) {
            window.clearInterval(inStoreBackgroundProbeTimerRef.current);
            inStoreBackgroundProbeTimerRef.current = null;
        }
        inStoreBackgroundProbeBusyRef.current = false;
    }, []);
    const startInStoreBackgroundProbe = useCallback((orderId: string, opId: string) => {
        stopInStoreBackgroundProbe();
        let ticks = 0;
        inStoreBackgroundProbeTimerRef.current = window.setInterval(async () => {
            if (inStoreBackgroundProbeBusyRef.current) return;
            inStoreBackgroundProbeBusyRef.current = true;
            try {
                ticks += 1;
                const order = await fetchRemoteOrderById(orderId);
                if (order) {
                    stopInStoreBackgroundProbe();
                    const shortId = String(order.id || '').slice(-6).toUpperCase();
                    const statusKey = (String(order.status || '').trim() as OrderStatus) || 'pending';
                    const statusLabel = statusTranslations[statusKey] || String(order.status || 'pending');
                    showNotification(`اكتمل التحقق من عملية الخلفية #${shortId} (الحالة: ${statusLabel}) | تتبع ${opId}`, order.status === 'delivered' ? 'success' : 'info');
                    inStorePendingOrderIdRef.current = '';
                    void fetchOrders();
                    return;
                }
                if (ticks >= 40) {
                    stopInStoreBackgroundProbe();
                    showNotification(`تعذر تأكيد نتيجة العملية تلقائيًا. تتبع: ${opId} | رقم الطلب: ${orderId.slice(-6).toUpperCase()}`, 'error');
                }
            } catch {
                if (ticks >= 40) {
                    stopInStoreBackgroundProbe();
                }
            } finally {
                inStoreBackgroundProbeBusyRef.current = false;
            }
        }, 15000);
    }, [fetchOrders, fetchRemoteOrderById, showNotification, stopInStoreBackgroundProbe]);
    useEffect(() => {
        return () => {
            stopInStoreBackgroundProbe();
        };
    }, [stopInStoreBackgroundProbe]);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<any>)?.detail || {};
            const opId = String(detail?.opId || '').trim();
            const elapsedMsRaw = Number(detail?.elapsedMs);
            const elapsedMs = Number.isFinite(elapsedMsRaw) ? Math.max(0, Math.round(elapsedMsRaw)) : 0;
            const metric: InStoreSaleUxMetric = {
                opId: opId || `unknown-${Date.now()}`,
                elapsedMs,
                slowPath: Boolean(detail?.slowPath) || elapsedMs >= 15000,
                detached: Boolean(detail?.detached),
                createdAt: new Date().toISOString(),
            };
            setInStoreUxMetrics((prev) => [metric, ...prev].slice(0, 80));
            inStoreUxPersistQueueRef.current.push(metric);
            void flushInStoreUxMetricQueue();
        };
        window.addEventListener('in_store_sale_ux_metric', handler as EventListener);
        return () => {
            window.removeEventListener('in_store_sale_ux_metric', handler as EventListener);
        };
    }, [flushInStoreUxMetricQueue]);
    const inStoreUxStats = useMemo(() => {
        if (!inStoreUxMetrics.length) {
            return { total: 0, slowCount: 0, detachedCount: 0, p95Ms: 0, lastMs: 0 };
        }
        const durations = inStoreUxMetrics.map((m) => Number(m.elapsedMs) || 0).sort((a, b) => a - b);
        const idx = Math.max(0, Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1));
        const p95Ms = durations[idx] || 0;
        const slowCount = inStoreUxMetrics.filter((m) => m.slowPath).length;
        const detachedCount = inStoreUxMetrics.filter((m) => m.detached).length;
        const lastMs = Number(inStoreUxMetrics[0]?.elapsedMs || 0);
        return { total: inStoreUxMetrics.length, slowCount, detachedCount, p95Ms, lastMs };
    }, [inStoreUxMetrics]);

    // ── Keyboard shortcut: Ctrl+Enter to submit in-store sale ──
    const confirmInStoreSaleRef = useRef<(() => void) | null>(null);
    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                confirmInStoreSaleRef.current?.();
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [isInStoreSaleOpen]);

    useEffect(() => {
        const fetchAccounts = async () => {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const { data } = await supabase
                .from('chart_of_accounts')
                .select(`id, code, name`)
                .eq('is_active', true);
            if (data) {
                const matching = (data || [])
                    .map((a: any) => {
                        const parentCode = inferDestinationParentCode(String(a?.code || ''), '');
                        return {
                            id: String(a?.id || ''),
                            name: String(a?.name || ''),
                            code: String(a?.code || '').toUpperCase(),
                            parentCode: parentCode || '',
                        };
                    })
                    .filter((a: any) => Boolean(a.id) && (a.parentCode === '1020' || a.parentCode === '1030'));
                setDestinationAccounts(matching);
            }
        };
        fetchAccounts();
    }, []);
    const [editOrderId, setEditOrderId] = useState<string | null>(null);
    const [editChangesByCartItemId, setEditChangesByCartItemId] = useState<Record<string, { quantity?: number; uomCode?: string; uomQtyInBase?: number }>>({});
    const [editReservationResult, setEditReservationResult] = useState<Array<{ itemId: string; released: number; reserved: number; name?: string }>>([]);
    const [inStoreSelectedItemId, setInStoreSelectedItemId] = useState<string>('');
    const [inStoreSelectedItemIndex, setInStoreSelectedItemIndex] = useState<number>(-1);
    const [inStoreItemSearch, setInStoreItemSearch] = useState('');
    const [inStoreSelectedAddons, setInStoreSelectedAddons] = useState<Record<string, number>>({});
    const [inStoreLines, setInStoreLines] = useState<Array<{ menuItemId: string; quantity?: number; weight?: number; selectedAddons?: Record<string, number>; uomCode?: string; uomQtyInBase?: number; warehouseId?: string }>>([]);
    const [sourceQuotation, setSourceQuotation] = useState<{ id: string; number: string } | null>(null);
    const [inStoreCustomerMode, setInStoreCustomerMode] = useState<'walk_in' | 'existing' | 'party'>('walk_in');
    const [inStoreCustomerPhoneSearch, setInStoreCustomerPhoneSearch] = useState('');
    const [inStoreCustomerMatches, setInStoreCustomerMatches] = useState<Array<{ id: string; fullName?: string; phoneNumber?: string }>>([]);
    const [inStoreCustomerSearching, setInStoreCustomerSearching] = useState(false);
    const [inStoreCustomerDropdownOpen, setInStoreCustomerDropdownOpen] = useState(false);
    const [inStoreCustomerSearchResult, setInStoreCustomerSearchResult] = useState<{ id: string; fullName?: string; phoneNumber?: string } | null>(null);
    const [inStoreSelectedCustomerId, setInStoreSelectedCustomerId] = useState<string>('');
    const [inStoreSelectedPartyId, setInStoreSelectedPartyId] = useState<string>('');
    const [inStorePartyOptions, setInStorePartyOptions] = useState<Array<{ id: string; name: string; type?: string }>>([]);
    const [inStorePartyLoading, setInStorePartyLoading] = useState(false);
    const [inStorePricingBusy, setInStorePricingBusy] = useState(false);
    const [inStorePricingMap, setInStorePricingMap] = useState<Record<string, { unitPrice: number; unitPricePerKg?: number; isTxnPrice?: boolean }>>({});
    const [currencyOptions, setCurrencyOptions] = useState<string[]>([]);
    const [itemUomRowsByItemId, setItemUomRowsByItemId] = useState<Record<string, Array<{ code: string; name?: string; qtyInBase: number }>>>({});
    const itemUomLoadingRef = useRef<Set<string>>(new Set());
    const inStoreAlertsDebounceTimerRef = useRef<number | null>(null);
    const inStoreAlertsSignatureRef = useRef<Record<number, string>>({});
    const inStoreAlertsRequestRef = useRef<Record<number, string>>({});
    const inStorePricingDebounceTimerRef = useRef<number | null>(null);
    const inStorePricingRunIdRef = useRef(0);

    // ── Warehouse FEFO alerts for In-Store Sale ──
    type WarehouseAlert = { type: string; severity: 'error' | 'warning' | 'info' | 'success'; message: string; other_warehouse_id?: string; other_warehouse?: string;[k: string]: any };
    const [inStoreAlertsByIndex, setInStoreAlertsByIndex] = useState<Record<number, WarehouseAlert[]>>({});
    const [inStoreAlertsLoadingByIndex, setInStoreAlertsLoadingByIndex] = useState<Record<number, boolean>>({});



    const runTasksWithConcurrency = useCallback(async <R,>(tasks: Array<() => Promise<R>>, limit = 4): Promise<R[]> => {
        const safeLimit = Math.max(1, Number(limit) || 1);
        const results: R[] = new Array(tasks.length);
        let cursor = 0;
        const workers = Array.from({ length: Math.min(safeLimit, tasks.length) }, async () => {
            while (true) {
                const idx = cursor;
                cursor += 1;
                if (idx >= tasks.length) return;
                results[idx] = await tasks[idx]();
            }
        });
        await Promise.all(workers);
        return results;
    }, []);
    const fetchInStoreAlerts = useCallback(async (index: number, itemId: string, whId: string, qty: number, requestKey: string) => {
        const supabase = getSupabaseClient();
        if (!supabase || !itemId || !whId) return;
        inStoreAlertsRequestRef.current[index] = requestKey;
        setInStoreAlertsLoadingByIndex(prev => ({ ...prev, [index]: true }));
        try {
            const { data, error } = await supabase.rpc('get_warehouse_item_alerts', {
                p_item_id: itemId, p_warehouse_id: whId, p_requested_qty: qty,
            } as any);
            if (error) throw error;
            if (inStoreAlertsRequestRef.current[index] !== requestKey) return;
            setInStoreAlertsByIndex(prev => ({ ...prev, [index]: Array.isArray(data) ? data : [] }));
        } catch {
            if (inStoreAlertsRequestRef.current[index] !== requestKey) return;
            setInStoreAlertsByIndex(prev => ({ ...prev, [index]: [] }));
        } finally {
            if (inStoreAlertsRequestRef.current[index] !== requestKey) return;
            setInStoreAlertsLoadingByIndex(prev => ({ ...prev, [index]: false }));
        }
    }, [getSupabaseClient]);

    useEffect(() => {
        if (inStoreAlertsDebounceTimerRef.current != null) {
            window.clearTimeout(inStoreAlertsDebounceTimerRef.current);
            inStoreAlertsDebounceTimerRef.current = null;
        }
        if (!isInStoreSaleOpen) {
            inStoreAlertsSignatureRef.current = {};
            inStoreAlertsRequestRef.current = {};
            return;
        }
        const nextSignatures: Record<number, string> = {};
        const tasks: Array<() => Promise<void>> = [];
        inStoreLines.forEach((line, index) => {
            const iid = String(line.menuItemId || '').trim();
            const wh = String(line.warehouseId || sessionScope.scope?.warehouseId || '').trim();
            if (!iid || !wh) return;
            const mi = allMenuItems.find(m => m.id === iid);
            if (!mi) return;
            const isWeight = mi.unitType === 'kg' || mi.unitType === 'gram';
            const rawQty = isWeight ? Number(line.weight || 0) : Number(line.quantity || 0);
            const factor = Number(line.uomQtyInBase || 1) || 1;
            const qty = rawQty * factor;
            const signature = `${iid}|${wh}|${qty}`;
            nextSignatures[index] = signature;
            if (inStoreAlertsSignatureRef.current[index] === signature) return;
            const requestKey = `${signature}|${Date.now()}|${Math.random()}`;
            tasks.push(async () => {
                await fetchInStoreAlerts(index, iid, wh, qty, requestKey);
            });
        });
        const currentIndexes = new Set(Object.keys(nextSignatures).map((k) => Number(k)));
        setInStoreAlertsByIndex(prev => {
            const cleaned: Record<number, WarehouseAlert[]> = {};
            Object.entries(prev).forEach(([k, v]) => {
                const idx = Number(k);
                if (currentIndexes.has(idx)) cleaned[idx] = v;
            });
            return cleaned;
        });
        setInStoreAlertsLoadingByIndex(prev => {
            const cleaned: Record<number, boolean> = {};
            Object.entries(prev).forEach(([k, v]) => {
                const idx = Number(k);
                if (currentIndexes.has(idx)) cleaned[idx] = v;
            });
            return cleaned;
        });
        inStoreAlertsSignatureRef.current = nextSignatures;
        if (!tasks.length) return;
        inStoreAlertsDebounceTimerRef.current = window.setTimeout(() => {
            void runTasksWithConcurrency(tasks, 3);
        }, 180);
        return () => {
            if (inStoreAlertsDebounceTimerRef.current != null) {
                window.clearTimeout(inStoreAlertsDebounceTimerRef.current);
                inStoreAlertsDebounceTimerRef.current = null;
            }
        };
    }, [inStoreLines, sessionScope.scope?.warehouseId, isInStoreSaleOpen, fetchInStoreAlerts, allMenuItems, runTasksWithConcurrency]);

    useEffect(() => {
        let active = true;
        const run = async () => {
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;
                const { data, error } = await supabase
                    .from('currencies')
                    .select('code')
                    .order('code', { ascending: true });
                if (error) throw error;
                const codes = (Array.isArray(data) ? data : [])
                    .map((r: any) => String(r?.code || '').trim().toUpperCase())
                    .filter(Boolean);
                if (active) setCurrencyOptions(Array.from(new Set(codes)));
            } catch {
                if (active) setCurrencyOptions([]);
            }
        };
        void run();
        return () => {
            active = false;
        };
    }, []);
    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const ids = Array.from(new Set(inStoreLines.map((r) => String(r.menuItemId || '').trim()).filter(Boolean)));
        if (!ids.length) return;
        for (const id of ids) {
            if (itemUomRowsByItemId[id]) continue;
            if (itemUomLoadingRef.current.has(id)) continue;
            itemUomLoadingRef.current.add(id);
            (async () => {
                try {
                    const { data, error } = await supabase.rpc('list_item_uom_units', { p_item_id: id } as any);
                    if (error) throw error;
                    const rows = Array.isArray(data) ? data : [];
                    const normalized: Array<{ code: string; name?: string; qtyInBase: number }> = rows
                        .filter((r: any) => Boolean(r?.is_active))
                        .map((r: any) => ({
                            code: String(r?.uom_code || '').trim(),
                            name: String(r?.uom_name || '').trim() || undefined,
                            qtyInBase: Number(r?.qty_in_base || 0) || 0,
                        }))
                        .filter((r) => r.code && r.qtyInBase > 0);
                    setItemUomRowsByItemId((prev) => ({ ...prev, [id]: normalized }));
                } catch {
                    setItemUomRowsByItemId((prev) => ({ ...prev, [id]: [] }));
                } finally {
                    itemUomLoadingRef.current.delete(id);
                }
            })();
        }
    }, [getSupabaseClient, inStoreLines, isInStoreSaleOpen]);
    useEffect(() => {
        if (!returnOrderId) return;
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const order = orders.find(o => o.id === returnOrderId);
        if (!order) return;
        const ids = Array.from(new Set((order.items || []).map((r: any) => String(r.id || r.menuItemId || '').trim()).filter(Boolean)));
        if (!ids.length) return;
        for (const id of ids) {
            if (itemUomRowsByItemId[id]) continue;
            if (itemUomLoadingRef.current.has(id)) continue;
            itemUomLoadingRef.current.add(id);
            (async () => {
                try {
                    const { data, error } = await supabase.rpc('list_item_uom_units', { p_item_id: id } as any);
                    if (error) throw error;
                    const rows = Array.isArray(data) ? data : [];
                    const normalized: Array<{ code: string; name?: string; qtyInBase: number }> = rows
                        .filter((r: any) => Boolean(r?.is_active))
                        .map((r: any) => ({
                            code: String(r?.uom_code || '').trim(),
                            name: String(r?.uom_name || '').trim() || undefined,
                            qtyInBase: Number(r?.qty_in_base || 0) || 0,
                        }))
                        .filter((r) => r.code && r.qtyInBase > 0);
                    setItemUomRowsByItemId((prev) => ({ ...prev, [id]: normalized }));
                } catch {
                    setItemUomRowsByItemId((prev) => ({ ...prev, [id]: [] }));
                } finally {
                    itemUomLoadingRef.current.delete(id);
                }
            })();
        }
    }, [getSupabaseClient, orders, returnOrderId, itemUomRowsByItemId]);

    const getReturnUomOptions = (orderItem: any, itemId: string) => {
        const unitType = String(orderItem?.unitType || orderItem?.unit || 'piece').trim();
        const baseCode = unitType.toLowerCase();
        const baseOption = { code: baseCode, name: unitType, qtyInBase: 1 };
        const fromMap = itemUomRowsByItemId[itemId] || [];
        const fromItem = Array.isArray(orderItem?.uomUnits)
            ? (orderItem.uomUnits as Array<{ code?: string; name?: string; qtyInBase?: number }>)
            : [];
        const orderUomCode = String(orderItem?.uomCode || '').trim().toLowerCase();
        const orderUomQty = Number(orderItem?.uomQtyInBase || 0) || 0;
        const merged = [
            baseOption,
            ...fromMap.map(r => ({ code: String(r.code || '').trim().toLowerCase(), name: r.name, qtyInBase: Number(r.qtyInBase || 0) || 0 })),
            ...fromItem.map(r => ({ code: String(r.code || '').trim().toLowerCase(), name: r.name, qtyInBase: Number(r.qtyInBase || 0) || 0 })),
        ].filter(r => r.code && r.qtyInBase > 0);
        if (orderUomCode && orderUomQty > 0) {
            merged.push({ code: orderUomCode, name: orderUomCode, qtyInBase: orderUomQty });
        }
        const uniq = new Map<string, { code: string; name?: string; qtyInBase: number }>();
        for (const opt of merged) {
            if (!uniq.has(opt.code)) uniq.set(opt.code, opt);
        }
        return Array.from(uniq.values()).sort((a, b) => a.qtyInBase - b.qtyInBase);
    };
    const operationalCurrencies = useMemo(() => {
        const fromSettings = Array.isArray(settings.operationalCurrencies) && settings.operationalCurrencies.length
            ? settings.operationalCurrencies
            : [];
        const list = fromSettings.length > 0
            ? fromSettings
            : (currencyOptions.length > 0 ? currencyOptions : []);
        const normalized = list.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean);
        const unique = Array.from(new Set(normalized));
        if (unique.length > 0) return unique;
        const fallback = String(baseCode || '').trim().toUpperCase();
        return fallback ? [fallback] : [];
    }, [baseCode, currencyOptions, settings.operationalCurrencies]);
    const [inStoreTransactionCurrency, setInStoreTransactionCurrency] = useState<string>(() => operationalCurrencies[0] || '');
    const [inStoreTransactionFxRate, setInStoreTransactionFxRate] = useState<number>(1);
    const inStoreFxRateRef = useRef<number>(1);
    const inStorePrevFxRateRef = useRef<number>(1);

    useEffect(() => {
        const current = String(inStoreTransactionCurrency || '').trim().toUpperCase();
        if (current && operationalCurrencies.includes(current)) return;
        const next = operationalCurrencies[0] || '';
        if (next) setInStoreTransactionCurrency(next);
    }, [inStoreTransactionCurrency, operationalCurrencies]);

    const getCurrencyDecimalsByCode = (code: string) => {
        return sharedGetCurrencyDecimals(code);
    };
    const formatMoneyByCode = (v: number, code: string) => {
        const n = Number(v);
        const dp = getCurrencyDecimalsByCode(code);
        if (!Number.isFinite(n)) {
            try {
                return (0).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: dp, maximumFractionDigits: dp });
            } catch {
                return (0).toFixed(dp);
            }
        }
        try {
            return n.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: dp, maximumFractionDigits: dp });
        } catch {
            return n.toFixed(dp);
        }
    };
    const roundMoneyByCode = (v: number, code: string) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        const dp = getCurrencyDecimalsByCode(code);
        const pow = Math.pow(10, dp);
        return Math.round(n * pow) / pow;
    };
    const getCurrencyDecimals = (code: string) => getCurrencyDecimalsByCode(code);
    const roundMoney = (v: number) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        const dp = getCurrencyDecimals(inStoreTransactionCurrency);
        const pow = Math.pow(10, dp);
        return Math.round(n * pow) / pow;
    };

    const fetchInStoreCustomerMatches = useCallback(async (query: string, opts?: { silent?: boolean }) => {
        const supabase = getSupabaseClient();
        if (!supabase) return [];
        const raw = String(query || '').trim();
        if (!raw) return [];
        const q = raw.replace(/[%_]/g, '');
        const digits = raw.replace(/\D/g, '');
        const parts: string[] = [];
        if (q.length >= 2) parts.push(`full_name.ilike.%${q}%`);
        if (digits.length >= 3) {
            parts.push(`phone_number.ilike.%${digits}%`);
        } else if (q.length >= 2) {
            parts.push(`phone_number.ilike.%${q}%`);
        }
        if (parts.length === 0) return [];
        try {
            const { data, error } = await supabase
                .from('customers_business')
                .select('auth_user_id, full_name, phone_number')
                .or(parts.join(','))
                .limit(8);
            if (error) throw error;
            return (Array.isArray(data) ? data : [])
                .map((r: any) => ({
                    id: String(r?.auth_user_id || ''),
                    fullName: typeof r?.full_name === 'string' ? r.full_name : undefined,
                    phoneNumber: typeof r?.phone_number === 'string' ? r.phone_number : undefined,
                }))
                .filter((c) => Boolean(c.id));
        } catch (e) {
            if (!opts?.silent) {
                showNotification('تعذر البحث عن العميل.', 'error');
            }
            return [];
        }
    }, [showNotification]);

    const selectInStoreCustomer = useCallback((c: { id: string; fullName?: string; phoneNumber?: string }) => {
        setInStoreCustomerSearchResult(c);
        setInStoreSelectedCustomerId(c.id);
        setInStoreCustomerDropdownOpen(false);
        setInStoreCustomerMatches([]);
        if (c.fullName) setInStoreCustomerName(c.fullName);
        if (c.phoneNumber) setInStorePhoneNumber(c.phoneNumber);
    }, []);

    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        if (inStoreCustomerMode !== 'existing') return;
        const q = inStoreCustomerPhoneSearch.trim();
        if (!q) {
            setInStoreCustomerSearching(false);
            setInStoreCustomerMatches([]);
            return;
        }
        let cancelled = false;
        const t = window.setTimeout(() => {
            setInStoreCustomerSearching(true);
            fetchInStoreCustomerMatches(q, { silent: true }).then((list) => {
                if (cancelled) return;
                setInStoreCustomerMatches(list);
            }).finally(() => {
                if (cancelled) return;
                setInStoreCustomerSearching(false);
            });
        }, 250);
        return () => {
            cancelled = true;
            window.clearTimeout(t);
        };
    }, [fetchInStoreCustomerMatches, inStoreCustomerMode, inStoreCustomerPhoneSearch, isInStoreSaleOpen]);

    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        if (inStoreCustomerMode !== 'party') return;
        let active = true;
        (async () => {
            try {
                setInStorePartyLoading(true);
                const supabase = getSupabaseClient();
                if (!supabase) return;
                const { data, error } = await supabase
                    .from('financial_parties')
                    .select('id, name, party_type')
                    .eq('is_active', true)
                    .in('party_type', ['customer', 'partner', 'generic', 'supplier', 'employee'])
                    .order('name', { ascending: true })
                    .limit(500);
                if (error) throw error;
                const list = (Array.isArray(data) ? data : [])
                    .map((r: any) => ({
                        id: String(r?.id || ''),
                        name: String(r?.name || '').trim(),
                        type: String(r?.party_type || '').trim(),
                    }))
                    .filter((r) => r.id && r.name);
                if (active) setInStorePartyOptions(list);
            } catch {
                if (active) setInStorePartyOptions([]);
            } finally {
                if (active) setInStorePartyLoading(false);
            }
        })();
        return () => { active = false; };
    }, [inStoreCustomerMode, isInStoreSaleOpen]);

    const convertBaseToInStoreTxn = (baseAmount: number, rate: number) => {
        const r = Number(rate) || 0;
        if (!(r > 0)) return roundMoney(baseAmount);
        return roundMoney((Number(baseAmount) || 0) / r);
    };

    const convertInStoreTxnToBase = (txnAmount: number, rate: number) => {
        const r = Number(rate) || 0;
        if (!(r > 0)) return roundMoney(txnAmount);
        return roundMoney((Number(txnAmount) || 0) * r);
    };

    const fetchOperationalFxRate = async (currencyCode: string): Promise<number | null> => {
        const code = String(currencyCode || '').trim().toUpperCase();
        if (!code) return null;
        const base = String(baseCode || '').trim().toUpperCase();
        if (base && code === base) return 1;
        const supabase = getSupabaseClient();
        if (!supabase) return null;
        try {
            const { data, error } = await supabase.rpc('get_fx_rate_rpc', {
                p_currency_code: code,
            } as any);
            if (error) return null;
            const n = Number(data);
            return Number.isFinite(n) && n > 0 ? n : null;
        } catch {
            return null;
        }
    };

    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        const nextCode = String(inStoreTransactionCurrency || '').trim().toUpperCase();
        const base = String(baseCode || '').trim().toUpperCase();
        if (!nextCode) return;
        let cancelled = false;
        const run = async () => {
            inStorePrevFxRateRef.current = inStoreFxRateRef.current;
            if (base && nextCode === base) {
                if (!cancelled) {
                    inStoreFxRateRef.current = 1;
                    setInStoreTransactionFxRate(1);
                }
                return;
            }
            const rate = await fetchOperationalFxRate(nextCode);
            if (cancelled) return;
            if (!rate) {
                showNotification('لا يوجد سعر صرف تشغيلي لهذه العملة اليوم. أضف السعر من شاشة أسعار الصرف.', 'error');
                const fallback = base || operationalCurrencies[0] || '';
                if (fallback) setInStoreTransactionCurrency(fallback);
                return;
            }
            inStoreFxRateRef.current = rate;
            setInStoreTransactionFxRate(rate);
        };
        void run();
        return () => {
            cancelled = true;
        };
    }, [baseCode, inStoreTransactionCurrency, isInStoreSaleOpen, operationalCurrencies, showNotification]);

    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        const newRate = Number(inStoreTransactionFxRate) || 1;
        if (!(newRate > 0)) return;
        const oldRate = Number(inStorePrevFxRateRef.current) || 1;
        if (inStoreDiscountType === 'amount' && (Number(inStoreDiscountValue) || 0) > 0 && oldRate > 0) {
            const baseAmt = (Number(inStoreDiscountValue) || 0) * oldRate;
            const nextDiscount = roundMoney(baseAmt / newRate);
            if (Math.abs(nextDiscount - (Number(inStoreDiscountValue) || 0)) > 0.0001) {
                setInStoreDiscountValue(nextDiscount);
            }
        }
    }, [inStoreDiscountType, inStoreDiscountValue, inStoreTransactionFxRate, isInStoreSaleOpen]);

    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        const newRate = Number(inStoreTransactionFxRate) || 1;
        if (!(newRate > 0)) return;
        const oldRate = Number(inStorePrevFxRateRef.current) || 1;
        if (!(oldRate > 0)) return;
        if (Math.abs(newRate - oldRate) < 1e-12) return;

        const convert = (amount: number) => {
            const base = convertInStoreTxnToBase(amount, oldRate);
            return convertBaseToInStoreTxn(base, newRate);
        };

        setInStorePaymentDeclaredAmount((prev) => {
            const v = Number(prev) || 0;
            if (!(v > 0)) return prev;
            return convert(v);
        });
        setInStoreCashReceived((prev) => {
            const v = Number(prev) || 0;
            if (!(v > 0)) return prev;
            return convert(v);
        });
        setInStorePaymentLines((prev) => {
            if (!Array.isArray(prev) || prev.length === 0) return prev;
            const next = prev.map((p) => {
                const amount = Number(p.amount) || 0;
                const declaredAmount = Number(p.declaredAmount) || 0;
                const cashReceived = Number(p.cashReceived) || 0;
                return {
                    ...p,
                    amount: amount > 0 ? convert(amount) : amount,
                    declaredAmount: declaredAmount > 0 ? convert(declaredAmount) : declaredAmount,
                    cashReceived: cashReceived > 0 ? convert(cashReceived) : cashReceived,
                };
            });
            return next;
        });

        inStorePrevFxRateRef.current = newRate;
    }, [inStoreTransactionFxRate, isInStoreSaleOpen]);
    const [mapModal, setMapModal] = useState<{ title: string; coords: { lat: number; lng: number } } | null>(null);
    const [paidSumByOrderId, setPaidSumByOrderId] = useState<Record<string, number>>({});
    const [partialPaymentOrderId, setPartialPaymentOrderId] = useState<string | null>(null);
    const [partialPaymentAmount, setPartialPaymentAmount] = useState<number>(0);
    const [partialPaymentMethod, setPartialPaymentMethod] = useState<string>('cash');
    const [partialPaymentOccurredAt, setPartialPaymentOccurredAt] = useState<string>('');
    const [isRecordingPartialPayment, setIsRecordingPartialPayment] = useState(false);
    const [partialPaymentReferenceNumber, setPartialPaymentReferenceNumber] = useState<string>('');
    const [partialPaymentSenderName, setPartialPaymentSenderName] = useState<string>('');
    const [partialPaymentSenderPhone, setPartialPaymentSenderPhone] = useState<string>('');
    const [partialPaymentDeclaredAmount, setPartialPaymentDeclaredAmount] = useState<number>(0);
    const [partialPaymentAmountConfirmed, setPartialPaymentAmountConfirmed] = useState(false);
    const [partialPaymentAdvancedAccounting, setPartialPaymentAdvancedAccounting] = useState(false);
    const [partialPaymentOverrideAccountId, setPartialPaymentOverrideAccountId] = useState<string>('');
    const [accounts, setAccounts] = useState<Array<{ id: string; code: string; name: string }>>([]);
    const [accountsError, setAccountsError] = useState<string>('');
    const [driverCashByDriverId, setDriverCashByDriverId] = useState<Record<string, number>>({});
    const [codAuditOrderId, setCodAuditOrderId] = useState<string | null>(null);
    const [codAuditLoading, setCodAuditLoading] = useState(false);
    const [codAuditData, setCodAuditData] = useState<any>(null);
    const [resumePendingBusyId, setResumePendingBusyId] = useState<string>('');
    const [resumePendingBelowCostOrderId, setResumePendingBelowCostOrderId] = useState<string | null>(null);
    const [resumePendingBelowCostReason, setResumePendingBelowCostReason] = useState('');

    const searchParams = new URLSearchParams(location.search);
    const highlightedOrderId = (searchParams.get('orderId') || '') || (typeof (location.state as any)?.orderId === 'string' ? (location.state as any).orderId : '');

    const canViewAccounting = hasPermission('accounting.view') || hasPermission('accounting.manage');
    const canManageAccounting = hasPermission('accounting.manage');
    const isOwner = adminUser?.role === 'owner';
    const isManager = adminUser?.role === 'manager';
    const canRequestPurge = isOwner || isManager || canManageAccounting;
    const currentAdminAuthId = String((adminUser as any)?.id || '');
    const canVoidDelivered = hasPermission('accounting.void');

    const canUseCash = hasPermission('orders.markPaid') && hasPermission('cashShifts.open');
    const canOverrideBelowCost = useMemo(() => {
        if (adminUser?.role === 'owner' || adminUser?.role === 'manager') return true;
        return Boolean((settings as any)?.ALLOW_BELOW_COST_SALES) && hasPermission('sales.allowBelowCost' as any);
    }, [adminUser?.role, hasPermission, settings]);

    const attemptResumeInStorePending = useCallback(async (order: Order, belowCostOverrideReason?: string) => {
        if (!order || order.status !== 'pending' || !isInStoreOrder(order)) return;
        const canMarkPaidNow = hasPermission('orders.markPaid');
        if (!canMarkPaidNow) {
            showNotification('لا تملك صلاحية إتمام البيع المعلّق.', 'error');
            return;
        }
        if (resumePendingBusyId) return;

        const pbRaw = (order as any)?.paymentBreakdown ?? (order as any)?.data?.paymentBreakdown;
        const paymentBreakdown = Array.isArray(pbRaw) ? pbRaw : [];
        const paymentMethod = String((order as any)?.paymentMethod ?? (order as any)?.data?.paymentMethod ?? 'cash').trim() || 'cash';
        const occurredAt = new Date().toISOString();
        const cashAmount = paymentBreakdown
            .filter((p: any) => String(p?.method || '').trim() === 'cash')
            .reduce((s: number, p: any) => s + (Number(p?.amount) || 0), 0);
        const hasCash = cashAmount > 0.000000001 || (paymentBreakdown.length === 0 && paymentMethod === 'cash');
        if (hasCash && !currentShift) {
            showNotification('يجب فتح وردية نقدية قبل إتمام أي مبلغ نقدي.', 'error');
            return;
        }

        setResumePendingBusyId(order.id);
        try {
            await resumeInStorePendingOrder(order.id, {
                paymentMethod,
                paymentBreakdown: paymentBreakdown.length ? paymentBreakdown : undefined,
                occurredAt,
                belowCostOverrideReason: belowCostOverrideReason ? String(belowCostOverrideReason).trim() : undefined,
            });
            showNotification(`تم إتمام البيع المعلّق #${order.id.slice(-6).toUpperCase()}`, 'success');
            try { await fetchOrders(); } catch { }
        } catch (error: any) {
            const raw = String(error?.message || '');
            const isBelowCostReason = /يلزم إدخال سبب/i.test(raw) || /تحت التكلفة/i.test(raw) || /below_cost/i.test(raw);
            if (canOverrideBelowCost && isBelowCostReason) {
                setResumePendingBelowCostOrderId(order.id);
                setResumePendingBelowCostReason('');
                return;
            }
            showNotification(raw || 'فشل إتمام البيع المعلّق.', 'error');
        } finally {
            setResumePendingBusyId('');
        }
    }, [canOverrideBelowCost, currentShift, fetchOrders, hasPermission, isInStoreOrder, resumeInStorePendingOrder, resumePendingBusyId, showNotification]);
    const inStoreAvailablePaymentMethods = useMemo(() => {
        const enabled = Object.entries(settings.paymentMethods || {})
            .filter(([, isEnabled]) => Boolean(isEnabled))
            .map(([key]) => key);
        return enabled;
    }, [settings.paymentMethods]);
    const inStoreVisiblePaymentMethods = useMemo(() => {
        const enabled = inStoreAvailablePaymentMethods;
        return canUseCash ? enabled : enabled.filter(m => m !== 'cash');
    }, [inStoreAvailablePaymentMethods, canUseCash]);

    const isUuidText = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '').trim());

    useEffect(() => {
        if (!canViewAccounting) return;
        if (!partialPaymentOrderId) return;
        if (accounts.length > 0) return;
        const run = async () => {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            setAccountsError('');
            try {
                const rpc = await supabase.rpc('list_active_accounts');
                if (!rpc.error && Array.isArray(rpc.data)) {
                    setAccounts((rpc.data as any[]).map((r: any) => ({
                        id: String(r?.id || ''),
                        code: String(r?.code || ''),
                        name: String(r?.name || ''),
                    })).filter((r: any) => Boolean(r.id)));
                    return;
                }
                const { data, error } = await supabase
                    .from('chart_of_accounts')
                    .select('id,code,name,account_type,is_active')
                    .eq('is_active', true)
                    .order('code', { ascending: true });
                if (error) throw error;
                const list = Array.isArray(data) ? data : [];
                setAccounts(list.map((r: any) => ({
                    id: String(r?.id || ''),
                    code: String(r?.code || ''),
                    name: String(r?.name || ''),
                })).filter((r: any) => Boolean(r.id)));
            } catch (e) {
                setAccounts([]);
                setAccountsError(localizeSupabaseError(e));
            }
        };
        void run();
    }, [accounts.length, canViewAccounting, partialPaymentOrderId]);

    const inStorePricingSignature = useMemo(() => {
        if (!isInStoreSaleOpen) return '';
        if (!inStoreLines.length) return '';
        const base = inStoreLines.map((l) => {
            const mi = menuItems.find(m => m.id === l.menuItemId);
            const unitType = mi?.unitType || 'piece';
            const uomQty = Number(l.uomQtyInBase || 1) || 1;
            const qty = (unitType === 'kg' || unitType === 'gram')
                ? (Number(l.weight) || Number(l.quantity) || 0)
                : ((Number(l.quantity) || 0) * uomQty);
            const priceSig = mi ? `${Number(mi.price) || 0}:${Number((mi as any).pricePerUnit) || 0}` : '0:0';
            return `${l.menuItemId}:${unitType}:${qty}:u${uomQty}:p${priceSig}`;
        }).sort().join('|');
        const wh = sessionScope.scope?.warehouseId || '';
        return `${base}|cust:${inStoreSelectedCustomerId || ''}|wh:${wh}|cur:${inStoreTransactionCurrency}`;
    }, [inStoreLines, inStoreSelectedCustomerId, isInStoreSaleOpen, menuItems, sessionScope.scope?.warehouseId, inStoreTransactionCurrency]);

    useEffect(() => {
        if (inStorePricingDebounceTimerRef.current != null) {
            window.clearTimeout(inStorePricingDebounceTimerRef.current);
            inStorePricingDebounceTimerRef.current = null;
        }
        if (!isInStoreSaleOpen || !inStoreLines.length) {
            inStorePricingRunIdRef.current += 1;
            setInStorePricingBusy(false);
            setInStorePricingMap({});
            return;
        }

        const isOnline = typeof navigator !== 'undefined' && navigator.onLine !== false;
        const supabase = isOnline ? getSupabaseClient() : null;
        if (!supabase) {
            inStorePricingRunIdRef.current += 1;
            setInStorePricingBusy(false);
            setInStorePricingMap({});
            return;
        }

        const warehouseId = sessionScope.scope?.warehouseId || '';
        const runId = inStorePricingRunIdRef.current + 1;
        inStorePricingRunIdRef.current = runId;
        let disposed = false;
        setInStorePricingBusy(true);

        const run = async () => {
            const withRpcTimeout = async <T,>(promiseLike: PromiseLike<T>, timeoutMs = 12000): Promise<T> => {
                let timer: number | null = null;
                try {
                    return await Promise.race([
                        Promise.resolve(promiseLike),
                        new Promise<T>((_, reject) => {
                            timer = window.setTimeout(() => {
                                reject(new Error('IN_STORE_PRICING_TIMEOUT'));
                            }, timeoutMs);
                        }),
                    ]);
                } finally {
                    if (timer != null) window.clearTimeout(timer);
                }
            };
            try {
                const requests = inStoreLines.map((l) => {
                    const mi = menuItems.find(m => m.id === l.menuItemId);
                    const unitType = mi?.unitType || 'piece';
                    const uomQty = Number(l.uomQtyInBase || 1) || 1;
                    const pricingQty = (unitType === 'kg' || unitType === 'gram')
                        ? (Number(l.weight) || Number(l.quantity) || 0)
                        : ((Number(l.quantity) || 0) * uomQty);
                    const key = `${l.menuItemId}:${unitType}:${pricingQty}:${inStoreSelectedCustomerId || ''}`;
                    return { key, itemId: l.menuItemId, unitType, pricingQty };
                }).filter(r => r.pricingQty > 0);

                const uniq = new Map<string, { key: string; itemId: string; unitType: string; pricingQty: number }>();
                for (const r of requests) {
                    const compact = `${r.itemId}:${r.unitType}:${r.pricingQty}:${inStoreSelectedCustomerId || ''}`;
                    if (!uniq.has(compact)) uniq.set(compact, r);
                }

                const tasks = Array.from(uniq.values()).map((r) => async () => {
                        const fallback = async () => {
                        const mi = menuItems.find(m => m.id === r.itemId);
                        if (!mi) return { key: r.key, unitPrice: 0, unitType: r.unitType };
                        const baseUnitPrice = mi.unitType === 'gram' && Number(mi.pricePerUnit || 0) > 0
                            ? (Number(mi.pricePerUnit) || 0) / 1000
                            : (Number(mi.price) || 0);
                        const unitPrice = Number(baseUnitPrice) || 0;
                        const unitPricePerKg = r.unitType === 'gram' ? unitPrice * 1000 : undefined;
                            return { key: r.key, unitPrice, unitPricePerKg, unitType: r.unitType, isTxnPrice: false };
                    };

                    // Use FEFO batch pricing from server when warehouse is available
                    if (warehouseId && supabase) {
                        try {
                            const customerId = inStoreSelectedCustomerId || undefined;
                            const rpcReq = supabase.rpc('get_fefo_pricing', {
                                p_item_id: r.itemId,
                                p_warehouse_id: warehouseId,
                                p_quantity: r.pricingQty,
                                p_customer_id: customerId || null,
                                p_currency_code: inStoreTransactionCurrency || null,
                            } as any);
                            const rpcRes = await withRpcTimeout<{ data: any; error: any }>(rpcReq as any);
                            const fefo = rpcRes?.data;
                            const fefoErr = rpcRes?.error;
                            if (fefoErr || !fefo || (Array.isArray(fefo) && fefo.length === 0)) {
                                return await fallback();
                            }
                            const row = Array.isArray(fefo) ? fefo[0] : fefo;
                            const suggestedPrice = Number(row?.suggested_price) || 0;
                            if (suggestedPrice <= 0) return await fallback();
                            const unitPricePerKg = r.unitType === 'gram' ? suggestedPrice * 1000 : undefined;
                            return { key: r.key, unitPrice: suggestedPrice, unitPricePerKg, unitType: r.unitType, isTxnPrice: true };
                        } catch {
                            return await fallback();
                        }
                    }

                    return await fallback();
                });
                const results = await runTasksWithConcurrency(tasks, 4);

                if (disposed || runId !== inStorePricingRunIdRef.current) return;
                const next: Record<string, { unitPrice: number; unitPricePerKg?: number; isTxnPrice?: boolean }> = {};
                for (const row of results) {
                    if (!row?.key) continue;
                    next[String(row.key)] = {
                        unitPrice: Number(row.unitPrice) || 0,
                        unitPricePerKg: row.unitPricePerKg != null ? (Number(row.unitPricePerKg) || 0) : undefined,
                        isTxnPrice: Boolean((row as any).isTxnPrice),
                    };
                }
                setInStorePricingMap(next);
            } catch (err) {
                if (disposed || runId !== inStorePricingRunIdRef.current) return;
                const msg = localizeSupabaseError(err) || 'تعذر تسعير الأصناف من الخادم.';
                showNotification(msg, 'error');
                setInStorePricingMap({});
            } finally {
                if (!disposed && runId === inStorePricingRunIdRef.current) setInStorePricingBusy(false);
            }
        };

        inStorePricingDebounceTimerRef.current = window.setTimeout(() => {
            void run();
        }, 220);
        return () => {
            disposed = true;
            if (inStorePricingDebounceTimerRef.current != null) {
                window.clearTimeout(inStorePricingDebounceTimerRef.current);
                inStorePricingDebounceTimerRef.current = null;
            }
        };
    }, [inStorePricingSignature, runTasksWithConcurrency]);

    const inStoreMissingServerPricing = useMemo(() => {
        if (!isInStoreSaleOpen || !inStoreLines.length) return false;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
        for (const l of inStoreLines) {
            const mi = menuItems.find(m => m.id === l.menuItemId);
            if (!mi) return true;
            const unitType = mi.unitType || 'piece';
            const uomQty = Number(l.uomQtyInBase || 1) || 1;
            const pricingQty = (unitType === 'kg' || unitType === 'gram')
                ? (Number(l.weight) || Number(l.quantity) || 0)
                : ((Number(l.quantity) || 0) * uomQty);
            if (!(pricingQty > 0)) continue;
            const key = `${l.menuItemId}:${unitType}:${pricingQty}:${inStoreSelectedCustomerId || ''}`;
            const priced = inStorePricingMap[key];
            if (!priced) return true;
        }
        return false;
    }, [inStoreLines, inStorePricingMap, inStoreSelectedCustomerId, isInStoreSaleOpen, menuItems]);

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

    useEffect(() => {
        const loadCreditSummary = async () => {
            if (!isInStoreSaleOpen) return;
            if (!inStoreIsCredit) return;
            const supabase = getSupabaseClient();
            if (!supabase) return;
            setInStoreCreditSummaryLoading(true);
            try {
                if (inStoreCustomerMode === 'existing') {
                    const customerId = String(inStoreSelectedCustomerId || '').trim();
                    if (!customerId) {
                        setInStoreCreditSummary(null);
                        return;
                    }
                    const { data, error } = await supabase.rpc('get_customer_credit_summary', { p_customer_id: customerId });
                    if (error) throw error;
                    setInStoreCreditSummary(data || null);
                    return;
                }

                if (inStoreCustomerMode === 'party') {
                    const partyId = String(inStoreSelectedPartyId || '').trim();
                    if (!partyId) {
                        setInStoreCreditSummary(null);
                        return;
                    }
                    const { data, error } = await supabase.rpc('get_party_credit_summary', { p_party_id: partyId });
                    if (error) throw error;
                    setInStoreCreditSummary(data || null);
                    return;
                }

                setInStoreCreditSummary(null);
            } catch {
                setInStoreCreditSummary(null);
            } finally {
                setInStoreCreditSummaryLoading(false);
            }
        };
        loadCreditSummary();
    }, [inStoreIsCredit, inStoreCustomerMode, inStoreSelectedCustomerId, inStoreSelectedPartyId, isInStoreSaleOpen]);

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

    const toYmd = (d: Date) => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };

    const addDaysToYmd = (ymd: string, days: number) => {
        const base = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : toYmd(new Date());
        const dt = new Date(`${base}T00:00:00`);
        dt.setDate(dt.getDate() + Math.max(0, Number(days) || 0));
        return toYmd(dt);
    };

    const parseRefundMethod = useCallback((value: string): 'cash' | 'network' | 'kuraimi' | 'ar' | 'store_credit' => {
        if (value === 'cash' || value === 'network' || value === 'kuraimi' || value === 'ar' || value === 'store_credit') return value;
        return 'cash';
    }, []);

    const detectRefundMethod = useCallback((order: Order): 'cash' | 'network' | 'kuraimi' | 'ar' | 'store_credit' => {
        const pm = String((order as any)?.paymentMethod || (order as any)?.payment_method || (order as any)?.data?.paymentMethod || '').toLowerCase().trim();
        const hasArPayment = Array.isArray((order as any).payments) && (order as any).payments.some((p: any) => String(p?.method || '').toLowerCase() === 'ar');
        if (pm === 'ar' || hasArPayment) return 'ar';
        if (pm === 'store_credit') return 'store_credit';
        if (pm === 'network' || pm === 'card' || pm === 'online') return 'network';
        if (pm === 'kuraimi' || pm === 'bank' || pm === 'bank_transfer') return 'kuraimi';
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

    const refreshReturnsForOrder = useCallback(async (orderId: string) => {
        try {
            setReturnsLoading(true);
            const list = await getReturnsByOrder(orderId);
            setReturnsByOrderId(prev => ({ ...prev, [orderId]: list as any[] }));
        } catch (error) {
            showNotification(localizeSupabaseError(error), 'error');
        } finally {
            setReturnsLoading(false);
        }
    }, [getReturnsByOrder, showNotification]);

    const retryProcessDraftReturn = useCallback(async (orderId: string, returnId: string) => {
        if (!orderId || !returnId) return;
        if (returnsActionBusy.id) return;
        setReturnsActionBusy({ id: returnId, action: 'process' });
        try {
            await processReturn(returnId);
            showNotification('تم إكمال المرتجع بنجاح.', 'success');
            await refreshReturnsForOrder(orderId);
        } catch (error) {
            const msg = error instanceof Error ? error.message : '';
            showNotification(msg || 'فشل إكمال المرتجع.', 'error');
        } finally {
            setReturnsActionBusy({ id: '', action: '' });
        }
    }, [processReturn, refreshReturnsForOrder, returnsActionBusy.id, showNotification]);

    const cancelDraftReturn = useCallback(async (orderId: string, returnId: string) => {
        if (!orderId || !returnId) return;
        if (returnsActionBusy.id) return;
        const supabase = getSupabaseClient();
        if (!supabase) return;
        setReturnsActionBusy({ id: returnId, action: 'cancel' });
        try {
            const { error } = await supabase
                .from('sales_returns')
                .update({ status: 'cancelled', updated_at: new Date().toISOString() } as any)
                .eq('id', returnId)
                .eq('status', 'draft');
            if (error) throw error;
            showNotification('تم إلغاء مسودة المرتجع.', 'success');
            await refreshReturnsForOrder(orderId);
        } catch (error) {
            showNotification(localizeSupabaseError(error) || 'فشل إلغاء المسودة.', 'error');
        } finally {
            setReturnsActionBusy({ id: '', action: '' });
        }
    }, [refreshReturnsForOrder, returnsActionBusy.id, showNotification]);

    useEffect(() => {
        const state = location.state as any;
        const customerId = typeof state?.customerId === 'string' ? state.customerId.trim() : '';
        if (!customerId) return;
        setCustomerUserIdFilter(customerId);
    }, [location.key]);

    useEffect(() => {
        const state = location.state as any;
        const q = state?.fromQuotation;
        const quotationId = typeof q?.quotationId === 'string' ? q.quotationId.trim() : '';
        if (!quotationId) return;
        const quotationNumber = typeof q?.quotationNumber === 'string' ? q.quotationNumber.trim() : '';
        const customerName = typeof q?.customerName === 'string' ? q.customerName : '';
        const customerPhone = typeof q?.customerPhone === 'string' ? q.customerPhone : '';
        const discountType = String(q?.discountType || '').toLowerCase();
        const discountValue = Number(q?.discountValue || 0) || 0;
        const notes = typeof q?.notes === 'string' ? q.notes : '';
        const currency = String(q?.currency || '').trim().toUpperCase();
        const items = Array.isArray(q?.items) ? q.items : [];
        const lines = items
            .map((it: any) => ({
                menuItemId: String(it?.itemId || '').trim(),
                quantity: Number(it?.quantity || 0) || 0,
                warehouseId: sessionScope.scope?.warehouseId || '',
            }))
            .filter((x: any) => x.menuItemId && x.quantity > 0);
        if (!lines.length) {
            showNotification('لا يمكن تحويل العرض لأن بنوده لا تحتوي أصنافًا قابلة للبيع.', 'error');
            navigate(location.pathname + location.search, { replace: true, state: {} });
            return;
        }
        setInStoreLines(lines);
        setInStoreCustomerName(customerName);
        setInStorePhoneNumber(customerPhone);
        setInStoreDiscountType(discountType === 'percentage' ? 'percent' : 'amount');
        setInStoreDiscountValue(discountType === 'none' ? 0 : discountValue);
        setInStoreNotes(`محول من عرض السعر ${quotationNumber || quotationId}\n${notes}`.trim());
        if (currency && operationalCurrencies.includes(currency)) {
            setInStoreTransactionCurrency(currency);
        }
        setSourceQuotation({ id: quotationId, number: quotationNumber || quotationId });
        setIsInStoreSaleOpen(true);
        navigate(location.pathname + location.search, { replace: true, state: {} });
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
            try { (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { }
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
        if (!inStorePaymentMethod || !inStoreVisiblePaymentMethods.includes(inStorePaymentMethod)) {
            setInStorePaymentMethod(inStoreVisiblePaymentMethods[0]);
        }
    }, [inStoreVisiblePaymentMethods, inStorePaymentMethod, isInStoreSaleOpen]);

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
        if (!assertMutableOrdersView()) return;
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
            const localized = localizeSupabaseError(error);
            const raw = error instanceof Error ? error.message : '';
            const message = localized || raw || 'تعذر تنفيذ العملية. أعد المحاولة.';
            showNotification(message, 'error');
        }
    };

    const handleAssignDelivery = async (orderId: string, nextDeliveryUserId: string) => {
        if (!assertMutableOrdersView()) return;
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

    const handlePrintDeliveryNote = async (order: Order) => {
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
            name: (override?.name || fallback.name || wh?.name || '').trim(),
            address: (override?.address || wh?.address || wh?.location || fallback.address || '').trim(),
            contactNumber: (override?.contactNumber || wh?.phone || fallback.contactNumber || '').trim(),
            logoUrl: (override?.logoUrl || fallback.logoUrl || '').trim(),
        };
        let printNumber = 1;
        try {
            const supabase = getSupabaseClient();
            if (supabase) {
                const { data: pn } = await supabase.rpc('track_document_print', { p_source_table: 'orders', p_source_id: order.id, p_template: 'PrintableOrder' });
                printNumber = Number(pn) || 1;
            }
        } catch { /* fallback */ }
        const content = renderToString(
            <PrintableOrder
                order={order}
                language="ar"
                companyName={brand.name}
                companyAddress={brand.address}
                companyPhone={brand.contactNumber}
                logoUrl={brand.logoUrl}
                printNumber={printNumber}
            />
        );
        printContent(content, `سند تسليم #${order.id.slice(-6).toUpperCase()}`);
    };

    const handlePrintReceiptVoucher = async (order: Order) => {
        const supabase = getSupabaseClient();
        if (!supabase) {
            showNotification('Supabase غير مهيأ.', 'error');
            return;
        }
        try {
            const { data: p, error } = await supabase
                .from('payments')
                .select('id,occurred_at')
                .eq('reference_table', 'orders')
                .eq('reference_id', order.id)
                .eq('direction', 'in')
                .order('occurred_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (error) throw error;
            const paymentId = String((p as any)?.id || '');
            if (!paymentId) {
                showNotification('لا توجد دفعات مسجلة لهذا الطلب.', 'error');
                return;
            }
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
            const brand: any = {
                name: (override?.name || fallback.name || wh?.name || '').trim(),
                address: (override?.address || wh?.address || wh?.location || fallback.address || '').trim(),
                contactNumber: (override?.contactNumber || wh?.phone || fallback.contactNumber || '').trim(),
                logoUrl: (override?.logoUrl || fallback.logoUrl || '').trim(),
                branchName: (wh?.name || '').trim(),
                branchCode: '',
            };
            try {
                const bid = String(sessionScope.scope?.branchId || '').trim();
                if (bid) {
                    const { data: b } = await supabase.from('branches').select('name,code').eq('id', bid).maybeSingle();
                    brand.branchName = String((b as any)?.name || '');
                    brand.branchCode = String((b as any)?.code || '');
                }
            } catch {
            }
            await printReceiptVoucherByPaymentId(paymentId, brand);
        } catch (e: any) {
            showNotification(String(e?.message || 'تعذر طباعة سند القبض'), 'error');
        }
    };

    const handlePrintSalesReturn = async (returnId: string, order: Order) => {
        const supabase = getSupabaseClient();
        if (!supabase) {
            showNotification('Supabase غير مهيأ.', 'error');
            return;
        }
        try {
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
            const brand: any = {
                name: (override?.name || fallback.name || wh?.name || '').trim(),
                address: (override?.address || wh?.address || wh?.location || fallback.address || '').trim(),
                contactNumber: (override?.contactNumber || wh?.phone || fallback.contactNumber || '').trim(),
                logoUrl: (override?.logoUrl || fallback.logoUrl || '').trim(),
                branchName: (wh?.name || '').trim(),
                branchCode: '',
            };
            try {
                const bid = String(sessionScope.scope?.branchId || '').trim();
                if (bid) {
                    const { data: b } = await supabase.from('branches').select('name,code').eq('id', bid).maybeSingle();
                    brand.branchName = String((b as any)?.name || '');
                    brand.branchCode = String((b as any)?.code || '');
                }
            } catch {
            }
            await printSalesReturnById(returnId, brand);
        } catch (e: any) {
            showNotification(String(e?.message || 'تعذر طباعة المرتجع'), 'error');
        }
    };

    const handlePrintSalesReturnPaymentVoucher = async (returnId: string, order: Order) => {
        const supabase = getSupabaseClient();
        if (!supabase) {
            showNotification('Supabase غير مهيأ.', 'error');
            return;
        }
        try {
            const { data: p, error } = await supabase
                .from('payments')
                .select('id,occurred_at')
                .eq('reference_table', 'sales_returns')
                .eq('reference_id', String(returnId))
                .eq('direction', 'out')
                .order('occurred_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (error) throw error;
            const paymentId = String((p as any)?.id || '');
            if (!paymentId) {
                showNotification('لا يوجد سند صرف لهذا المرتجع.', 'error');
                return;
            }
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
            const brand: any = {
                name: (override?.name || fallback.name || wh?.name || '').trim(),
                address: (override?.address || wh?.address || wh?.location || fallback.address || '').trim(),
                contactNumber: (override?.contactNumber || wh?.phone || fallback.contactNumber || '').trim(),
                logoUrl: (override?.logoUrl || fallback.logoUrl || '').trim(),
                branchName: (wh?.name || '').trim(),
                branchCode: '',
            };
            try {
                const bid = String(sessionScope.scope?.branchId || '').trim();
                if (bid) {
                    const { data: b } = await supabase.from('branches').select('name,code').eq('id', bid).maybeSingle();
                    brand.branchName = String((b as any)?.name || '');
                    brand.branchCode = String((b as any)?.code || '');
                }
            } catch {
            }
            await printPaymentVoucherByPaymentId(paymentId, brand);
        } catch (e: any) {
            showNotification(String(e?.message || 'تعذر طباعة سند الصرف'), 'error');
        }
    };

    const handlePrintSalesReturnJournalVoucher = async (returnId: string, order: Order) => {
        const supabase = getSupabaseClient();
        if (!supabase) {
            showNotification('Supabase غير مهيأ.', 'error');
            return;
        }
        try {
            const { data: je, error } = await supabase
                .from('journal_entries')
                .select('id,entry_date')
                .eq('source_table', 'sales_returns')
                .eq('source_id', String(returnId))
                .order('entry_date', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (error) throw error;
            const entryId = String((je as any)?.id || '');
            if (!entryId) {
                showNotification('لا يوجد قيد محاسبي مرتبط بهذا المرتجع.', 'error');
                return;
            }
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
            const brand: any = {
                name: (override?.name || fallback.name || wh?.name || '').trim(),
                address: (override?.address || wh?.address || wh?.location || fallback.address || '').trim(),
                contactNumber: (override?.contactNumber || wh?.phone || fallback.contactNumber || '').trim(),
                logoUrl: (override?.logoUrl || fallback.logoUrl || '').trim(),
                branchName: (wh?.name || '').trim(),
                branchCode: '',
            };
            try {
                const bid = String(sessionScope.scope?.branchId || '').trim();
                if (bid) {
                    const { data: b } = await supabase.from('branches').select('name,code').eq('id', bid).maybeSingle();
                    brand.branchName = String((b as any)?.name || '');
                    brand.branchCode = String((b as any)?.code || '');
                }
            } catch {
            }
            await printJournalVoucherByEntryId(entryId, brand);
        } catch (e: any) {
            showNotification(String(e?.message || 'تعذر طباعة القيد'), 'error');
        }
    };

    const handleRepairLegacySalesReturnDocuments = async () => {
        const supabase = getSupabaseClient();
        if (!supabase) {
            showNotification('Supabase غير مهيأ.', 'error');
            return;
        }
        if (returnsDocsRepairing) return;
        setReturnsDocsRepairing(true);
        try {
            const { data, error } = await supabase.rpc('repair_sales_returns_payments_batch', { p_limit: 500, p_dry_run: false });
            if (error) throw error;
            const created = Number((data as any)?.created ?? 0) || 0;
            const skipped = Number((data as any)?.skipped ?? 0) || 0;
            showNotification(`تم إنشاء سندات صرف لمرتجعات قديمة: ${created} (تجاوز ${skipped}).`, 'success');
        } catch (e: any) {
            showNotification(String(e?.message || 'تعذر إصلاح مستندات المرتجعات'), 'error');
        } finally {
            setReturnsDocsRepairing(false);
        }
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
            const localized = localizeSupabaseError(error);
            const raw = error instanceof Error ? error.message : '';
            const message = localized || raw || 'تعذر تنفيذ العملية. أعد المحاولة.';
            showNotification(message, 'error');
        } finally {
            setIsDeliverConfirming(false);
        }
    };

    const handleAcceptDelivery = async (orderId: string) => {
        if (!assertMutableOrdersView()) return;
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
        if (!assertMutableOrdersView()) return;
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

    const handlePurgePayment = (orderId: string) => {
        if (!assertMutableOrdersView()) return;
        setPurgePaymentOrderId(orderId);
        setPurgePaymentReason('');
        setPurgePaymentReasonCategory('misapplied_payment');
    };

    const executePurgePayment = async () => {
        if (!purgePaymentOrderId || isPurgingPayment) return;
        if (!canRequestPurge) {
            showNotification('لا تملك صلاحية تنفيذ تنظيف الدفعة الطارئ.', 'error');
            return;
        }
        const reason = purgePaymentReason.trim();
        if (reason.length < 20) {
            showNotification('سبب التنفيذ إلزامي وبحد أدنى 20 حرفًا.', 'error');
            return;
        }
        setIsPurgingPayment(true);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error('Supabase غير مهيأ.');
            const { data: result, error } = await supabase.rpc('purge_order_payment', {
                p_order_id: purgePaymentOrderId,
                p_reason: reason,
            });
            if (error) throw error;
            const deletedPayments = Number((result as any)?.deletedPayments || 0);
            showNotification(`تم تنظيف الدفعة الطارئ بنجاح وحذف ${deletedPayments} عملية دفع.`, 'success');
            setPurgePaymentOrderId(null);
            setPurgePaymentReason('');
            setPurgePaymentReasonCategory('misapplied_payment');
            try {
                await fetchOrders();
            } catch { }
            await Promise.all([
                loadPaidSums(filteredAndSortedOrders.map(o => o.id)),
                loadPendingPurgeRequests(filteredAndSortedOrders.map(o => o.id)),
                loadPurgeDashboard(),
            ]);
        } catch (error) {
            const anyErr = error as any;
            const rawMsg = [
                `code=${anyErr?.code || '?'}`,
                `msg=${anyErr?.message || '?'}`,
                `details=${anyErr?.details || '?'}`,
                `hint=${anyErr?.hint || '?'}`,
            ].join(' | ');
            console.error('purge_order_payment error', error);
            showNotification(`خطأ تنظيف الدفعة الطارئ: ${rawMsg}`, 'error');
        } finally {
            setIsPurgingPayment(false);
        }
    };

    const executeApprovePurge = async () => {
        if (!approvePurgeRequestId || isApprovingPurge) return;
        if (!canRequestPurge) {
            showNotification('لا تملك صلاحية اعتماد طلبات العكس.', 'error');
            return;
        }
        const note = purgeApprovalNote.trim();
        if (note.length < 10) {
            showNotification('ملاحظة الاعتماد إلزامية وبحد أدنى 10 أحرف.', 'error');
            return;
        }
        setIsApprovingPurge(true);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error('Supabase غير مهيأ.');
            const { data: result, error } = await supabase.rpc('approve_order_payment_purge', {
                p_request_id: approvePurgeRequestId,
                p_approval_note: note,
            });
            if (error) throw error;
            const reversed = Number((result as any)?.reversedJournals || 0);
            showNotification(`تم اعتماد الطلب وتنفيذ عكس محاسبي بعدد ${reversed} قيود.`, 'success');
            setApprovePurgeRequestId(null);
            setPurgeApprovalNote('');
            try {
                await fetchOrders();
            } catch { }
            await Promise.all([
                loadPaidSums(filteredAndSortedOrders.map(o => o.id)),
                loadPendingPurgeRequests(filteredAndSortedOrders.map(o => o.id)),
                loadPurgeDashboard(),
            ]);
        } catch (error) {
            const anyErr = error as any;
            const rawMsg = [
                `code=${anyErr?.code || '?'}`,
                `msg=${anyErr?.message || '?'}`,
                `details=${anyErr?.details || '?'}`,
                `hint=${anyErr?.hint || '?'}`,
            ].join(' | ');
            showNotification(`خطأ اعتماد طلب العكس: ${rawMsg}`, 'error');
        } finally {
            setIsApprovingPurge(false);
        }
    };

    const executeBulkApprovePurge = async () => {
        if (isBulkPurgeBusy) return;
        if (!canRequestPurge) {
            showNotification('لا تملك صلاحية اعتماد دفعات العكس.', 'error');
            return;
        }
        const note = bulkApproveNote.trim();
        if (note.length < 10) {
            showNotification('ملاحظة الاعتماد الجماعي يجب ألا تقل عن 10 أحرف.', 'error');
            return;
        }
        const eligibleIds = purgeDashboardRows
            .filter(r => r.status === 'requested')
            .filter(r => !currentAdminAuthId || r.requested_by !== currentAdminAuthId)
            .map(r => r.id);
        if (eligibleIds.length === 0) {
            showNotification('لا توجد طلبات قابلة للاعتماد الجماعي حالياً.', 'error');
            return;
        }
        setIsBulkPurgeBusy(true);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error('Supabase غير مهيأ.');
            const { data, error } = await supabase.rpc('bulk_approve_order_payment_purge', {
                p_request_ids: eligibleIds,
                p_approval_note: note,
            });
            if (error) throw error;
            const approved = Number((data as any)?.approved || 0);
            const failed = Number((data as any)?.failed || 0);
            const reversedTotal = Number((data as any)?.reversedJournalsTotal || 0);
            showNotification(`تم اعتماد ${approved} طلب، فشل ${failed}، وإجمالي القيود المعكوسة ${reversedTotal}.`, failed > 0 ? 'error' : 'success');
            try {
                await fetchOrders();
            } catch { }
            await Promise.all([
                loadPaidSums(filteredAndSortedOrders.map(o => o.id)),
                loadPendingPurgeRequests(filteredAndSortedOrders.map(o => o.id)),
                loadPurgeDashboard(),
            ]);
        } catch (e: any) {
            showNotification(e?.message || 'فشل الاعتماد الجماعي.', 'error');
        } finally {
            setIsBulkPurgeBusy(false);
        }
    };

    const executeBulkRequestPurge = async () => {
        if (isBulkPurgeBusy) return;
        if (!canRequestPurge) {
            showNotification('لا تملك صلاحية إنشاء طلبات عكس جماعية.', 'error');
            return;
        }
        const rawTokens = bulkOrderIdsInput
            .split(/[\s,;\n\r\t]+/)
            .map(x => x.trim().replace(/^#/, '').toUpperCase())
            .filter(Boolean);
        if (rawTokens.length === 0) {
            showNotification('أدخل أرقام الطلبات أولاً.', 'error');
            return;
        }
        // Resolve short order IDs (e.g. A1B2C3) to full UUIDs
        const allOrders = [...orders];
        const ids: string[] = [];
        const notFound: string[] = [];
        for (const token of rawTokens) {
            // Already a full UUID?
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
                ids.push(token.toLowerCase());
            } else {
                // Match last 6 chars of order.id
                const match = allOrders.find(o => o.id.slice(-6).toUpperCase() === token.toUpperCase());
                if (match) {
                    ids.push(match.id);
                } else {
                    notFound.push(token);
                }
            }
        }
        if (notFound.length > 0) {
            showNotification(`لم يتم العثور على الطلبات: ${notFound.join(', ')}. تأكد أن الطلبات ظاهرة في الجدول الحالي.`, 'error');
            return;
        }
        if (ids.length === 0) {
            showNotification('لم يتم التعرف على أي طلب.', 'error');
            return;
        }
        const reason = bulkRequestReason.trim();
        if (reason.length < 20) {
            showNotification('سبب الطلب الجماعي يجب ألا يقل عن 20 حرفًا.', 'error');
            return;
        }
        setIsBulkPurgeBusy(true);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error('Supabase غير مهيأ.');
            const { data, error } = await supabase.rpc('bulk_request_order_payment_purge', {
                p_order_ids: ids,
                p_reason: reason,
                p_reason_category: bulkRequestCategory,
            });
            if (error) throw error;
            const requested = Number((data as any)?.requested || 0);
            const failed = Number((data as any)?.failed || 0);
            showNotification(`تم إنشاء ${requested} طلب عكس جماعي، وفشل ${failed}.`, failed > 0 ? 'error' : 'success');
            setBulkOrderIdsInput('');
            await Promise.all([
                loadPendingPurgeRequests(filteredAndSortedOrders.map(o => o.id)),
                loadPurgeDashboard(),
            ]);
        } catch (e: any) {
            showNotification(e?.message || 'فشل إنشاء الطلبات الجماعية.', 'error');
        } finally {
            setIsBulkPurgeBusy(false);
        }
    };

    const fillAutoPurgeCandidates = () => {
        if (autoCandidateScanBusy) return;
        setAutoCandidateScanBusy(true);
        try {
            const ids: string[] = [];
            let overpaidCount = 0;
            let stalePaidAtCount = 0;
            let creditWithPaidCount = 0;

            filteredAndSortedOrders.forEach((order) => {
                if (String(order.status || '').toLowerCase() !== 'delivered') return;
                const isVoided = Boolean((order as any)?.voidedAt || (order as any)?.data?.voidedAt);
                if (isVoided) return;
                if (pendingPurgeByOrderId[order.id]) return;

                const hasPaidAt = Boolean((order as any)?.paidAt || (order as any)?.data?.paidAt);
                const { paid, total, tol, isCreditSale } = getOrderPaymentSnapshot(order);

                const isOverpaid = paid > (total + tol);
                const isStalePaidAt = hasPaidAt && paid <= tol;
                const isCreditWithPaid = isCreditSale && paid > tol;

                if (isOverpaid || isStalePaidAt || isCreditWithPaid) {
                    ids.push(order.id);
                    if (isOverpaid) overpaidCount += 1;
                    if (isStalePaidAt) stalePaidAtCount += 1;
                    if (isCreditWithPaid) creditWithPaidCount += 1;
                }
            });

            const unique = Array.from(new Set(ids));
            if (unique.length === 0) {
                showNotification('لا توجد طلبات مرشحة تلقائياً ضمن الفلاتر الحالية.', 'error');
                return;
            }

            // Show short readable IDs in the textarea (the handler resolves them back)
            setBulkOrderIdsInput(unique.map(id => id.slice(-6).toUpperCase()).join('\n'));
            showNotification(
                `تم تجهيز ${unique.length} طلب مرشح (زيادة تحصيل: ${overpaidCount}، paidAt غير متطابق: ${stalePaidAtCount}، آجل مع تحصيل: ${creditWithPaidCount}).`,
                'success'
            );
        } finally {
            setAutoCandidateScanBusy(false);
        }
    };

    const addInStoreLine = () => {
        const id = inStoreSelectedItemId;
        if (!id) return;
        const menuItem = menuItems.find(m => m.id === id);
        if (!menuItem) return;
        const isWeightBased = isWeightBasedUnit(menuItem.unitType as any);

        // Filter out 0 quantity addons
        const addonsToAdd: Record<string, number> = {};
        Object.entries(inStoreSelectedAddons).forEach(([aid, qty]) => {
            if (qty > 0) addonsToAdd[aid] = qty;
        });

        setInStoreLines(prev => {
            return [
                ...prev,
                isWeightBased
                    ? { menuItemId: id, weight: menuItem.minWeight || 1, selectedAddons: addonsToAdd, warehouseId: sessionScope.scope?.warehouseId }
                    : { menuItemId: id, quantity: 1, selectedAddons: addonsToAdd, uomCode: String(menuItem.unitType || 'piece'), uomQtyInBase: 1, warehouseId: sessionScope.scope?.warehouseId },
            ];
        });
        setInStoreSelectedItemId('');
        setInStoreSelectedItemIndex(-1);
        setInStoreSelectedAddons({});
    };

    const filteredInStoreMenuItems = useMemo(() => {
        const needle = inStoreItemSearch.trim().toLowerCase();
        const source = menuItems;
        if (!needle) {
            return [...source]
                .sort((a, b) => (Number((b as any).availableStock || 0) - Number((a as any).availableStock || 0)))
                .slice(0, 200);
        }
        return source.filter(mi => {
            const name = (mi.name?.[language] || mi.name?.ar || mi.name?.en || '').toLowerCase();
            const barcode = String((mi as any)?.barcode || (mi as any)?.data?.barcode || '').toLowerCase();
            const sku = String((mi as any)?.sku || (mi as any)?.data?.sku || '').toLowerCase();
            return name.includes(needle) || barcode.includes(needle) || sku.includes(needle);
        })
            .sort((a, b) => (Number((b as any).availableStock || 0) - Number((a as any).availableStock || 0)))
            .slice(0, 200);
    }, [inStoreItemSearch, language, menuItems]);

    useEffect(() => {
        if (filteredInStoreMenuItems.length === 0) {
            if (inStoreSelectedItemId) setInStoreSelectedItemId('');
            if (inStoreSelectedItemIndex !== -1) setInStoreSelectedItemIndex(-1);
            return;
        }
        const selectedIndex = filteredInStoreMenuItems.findIndex(mi => String(mi.id) === String(inStoreSelectedItemId || ''));
        if (selectedIndex >= 0) {
            if (selectedIndex !== inStoreSelectedItemIndex) setInStoreSelectedItemIndex(selectedIndex);
            return;
        }
        setInStoreSelectedItemId(filteredInStoreMenuItems[0].id);
        setInStoreSelectedItemIndex(0);
    }, [filteredInStoreMenuItems, inStoreSelectedItemId, inStoreSelectedItemIndex]);

    const selectedInStoreMenuItem = useMemo(
        () => filteredInStoreMenuItems.find(mi => String(mi.id) === String(inStoreSelectedItemId || '')) || null,
        [filteredInStoreMenuItems, inStoreSelectedItemId]
    );

    const selectedInStoreAvailability = useMemo(() => {
        if (!selectedInStoreMenuItem) return null;
        const stockRow = getStockByItemId(String(selectedInStoreMenuItem.id || ''));
        const itemId = String(selectedInStoreMenuItem.id || '');
        const globalAvailable = getGlobalSellableByItemId(itemId);
        const sessionAvailable = stockRow
            ? Math.max(0, Number(stockRow.availableQuantity || 0) - Number(stockRow.reservedQuantity || 0))
            : globalAvailable;
        const sessionReserved = stockRow ? Math.max(0, Number(stockRow.reservedQuantity || 0)) : 0;
        const globalLastUpdated = getGlobalLastUpdatedByItemId(itemId);
        const status = sessionAvailable > 0
            ? 'ok'
            : (globalAvailable > 0 ? 'switch' : 'none');
        return { globalAvailable, sessionAvailable, sessionReserved, status, globalLastUpdated };
    }, [selectedInStoreMenuItem, getStockByItemId, getGlobalSellableByItemId, getGlobalLastUpdatedByItemId]);

    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        void fetchStock();
    }, [isInStoreSaleOpen, fetchStock]);
    const updateInStoreLine = (index: number, patch: { quantity?: number; weight?: number; uomCode?: string; uomQtyInBase?: number; warehouseId?: string }) => {
        setInStoreLines(prev => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    };

    const removeInStoreLine = (index: number) => {
        setInStoreLines(prev => prev.filter((_, i) => i !== index));
    };

    const inStoreTotals = useMemo(() => {
        const fx = Number(inStoreTransactionFxRate) || 1;
        const toTxn = (amount: number) => {
            if (!(fx > 0)) return amount;
            return (amount / fx);
        };

        const txnSubtotal = inStoreLines.reduce((sum, line) => {
            const menuItem = menuItems.find(m => m.id === line.menuItemId);
            if (!menuItem) return sum;
            const unitType = menuItem.unitType;
            const isWeightBased = isWeightBasedUnit(unitType as any);
            const quantity = !isWeightBased ? (line.quantity || 0) : 1;
            const weight = isWeightBased ? (line.weight || 0) : 0;
            const pricingQty = isWeightBased
                ? (Number(weight) || Number(quantity) || 0)
                : ((Number(quantity) || 0) * (Number(line.uomQtyInBase || 1) || 1));
            const pricingKey = `${line.menuItemId}:${unitType || 'piece'}:${pricingQty}:${inStoreSelectedCustomerId || ''}`;
            const priced = inStorePricingMap[pricingKey];
            
            const fallbackUnitPrice = unitType === 'gram' && menuItem.pricePerUnit ? menuItem.pricePerUnit / 1000 : menuItem.price;
            const fallbackTxnUnit = toTxn(Number(fallbackUnitPrice) || 0);

            let pricedUnitPrice = unitType === 'gram'
                ? (priced?.unitPricePerKg ? (priced.unitPricePerKg / 1000) : (Number(priced?.unitPrice) || fallbackUnitPrice))
                : (Number(priced?.unitPrice) || fallbackUnitPrice);

            let unitPrice = pricedUnitPrice;
            if (priced) {
                unitPrice = priced.isTxnPrice ? pricedUnitPrice : toTxn(pricedUnitPrice);
            } else {
                unitPrice = fallbackTxnUnit;
            }

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
            const addonsTxnCost = toTxn(addonsCost);

            const lineTotal = isWeightBased
                ? (unitPrice * weight) + (addonsTxnCost * 1)
                : (unitPrice + addonsTxnCost) * quantity * (Number(line.uomQtyInBase || 1) || 1);

            return sum + lineTotal;
        }, 0);
        
        const discountValue = Number(inStoreDiscountValue) || 0;
        const discountAmount = inStoreDiscountType === 'percent'
            ? Math.max(0, Math.min(100, discountValue)) * txnSubtotal / 100
            : Math.max(0, Math.min(txnSubtotal, discountValue));
        
        const subtotal = txnSubtotal;
        const total = Math.max(0, subtotal - discountAmount);
        
        const baseSubtotal = convertInStoreTxnToBase(txnSubtotal, fx);
        const baseDiscountValue = inStoreDiscountType === 'amount' ? convertInStoreTxnToBase(discountValue, fx) : discountValue;
        const baseDiscountAmount = inStoreDiscountType === 'percent'
            ? Math.max(0, Math.min(100, Number(discountValue) || 0)) * baseSubtotal / 100
            : Math.max(0, Math.min(baseSubtotal, baseDiscountValue));
        const baseTotal = Math.max(0, baseSubtotal - baseDiscountAmount);
        return { subtotal, discountAmount, total, baseSubtotal, baseDiscountAmount, baseTotal, fxRate: fx };
    }, [inStoreDiscountType, inStoreDiscountValue, inStoreLines, inStorePricingMap, inStoreSelectedCustomerId, inStoreTransactionFxRate, isWeightBasedUnit, menuItems]);

    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        if (inStoreIsCredit) return;
        if (!inStoreMultiPaymentEnabled) return;
        if (inStorePaymentLines.length !== 1) return;
        const total = Number(inStoreTotals.total) || 0;
        setInStorePaymentLines(prev => {
            if (prev.length !== 1) return prev;
            const current = prev[0];
            const dp = getCurrencyDecimals(inStoreTransactionCurrency);
            const nextAmount = Number(total.toFixed(dp));
            if (Math.abs((Number(current.amount) || 0) - nextAmount) < 0.0001) return prev;
            return [{ ...current, amount: nextAmount }];
        });
    }, [inStoreIsCredit, inStoreMultiPaymentEnabled, inStorePaymentLines.length, inStoreTotals.total, isInStoreSaleOpen]);

    useEffect(() => {
        if (!isInStoreSaleOpen) return;
        if (inStoreIsCredit) return;
        const total = Number(inStoreTotals.total) || 0;
        if (inStorePaymentMethod !== 'kuraimi' && inStorePaymentMethod !== 'network') return;
        if ((Number(inStorePaymentDeclaredAmount) || 0) > 0) return;
        if (!(total > 0)) return;
        const dp = getCurrencyDecimals(inStoreTransactionCurrency);
        setInStorePaymentDeclaredAmount(Number(total.toFixed(dp)));
    }, [inStoreIsCredit, inStorePaymentDeclaredAmount, inStorePaymentMethod, inStoreTotals.total, isInStoreSaleOpen]);

    const runCreateInStoreSale = async (payload: any, creditOverrideReason?: string) => {
        if (inStoreCreationLock.current) return;
        inStoreCreationLock.current = true;
        const opId = `POS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const existingOrderId = String((payload as any)?.existingOrderId || inStorePendingOrderIdRef.current || crypto.randomUUID()).trim();
        inStorePendingOrderIdRef.current = existingOrderId;
        const startedAt = Date.now();
        inStoreCreateOpIdRef.current = opId;
        setInStoreCreateOpId(opId);
        setInStoreCreateStartedAt(startedAt);
        inStoreCreateDetachedRef.current = false;
        setIsInStoreCreating(true);
        setInStoreCreatingSlow(false);
        if (inStoreCreatingSlowTimerRef.current != null) {
            window.clearTimeout(inStoreCreatingSlowTimerRef.current);
            inStoreCreatingSlowTimerRef.current = null;
        }
        inStoreCreatingSlowTimerRef.current = window.setTimeout(() => {
            setInStoreCreatingSlow(true);
            showNotification(`عملية البيع تستغرق وقتًا أطول من المعتاد. رقم التتبع: ${opId}`, 'info');
        }, 15000);
        try {
            const belowCostOverrideReason = String((payload as any)?.belowCostOverrideReason || '').trim();
            const order = await withTimeout(createInStoreSale({
                ...payload,
                existingOrderId,
                clientTraceId: opId,
                creditOverrideReason: creditOverrideReason ? String(creditOverrideReason).trim() : undefined,
                belowCostOverrideReason: belowCostOverrideReason || undefined,
            }), 120000, 'IN_STORE_CREATE_TIMEOUT');
            const awaitingPayment = order.status === 'pending';
            const isQueued = Boolean((order as any).offlineState) || order.status !== 'delivered';
            if (awaitingPayment) {
                showNotification('تم إنشاء الطلب وبانتظار التحصيل من الكاشير', 'info');
            } else {
                showNotification(
                    language === 'ar'
                        ? (isQueued ? `تم إرسال البيع للمزامنة #${order.id.slice(-6).toUpperCase()} | تتبع ${opId}` : `تم تسجيل البيع الحضوري #${order.id.slice(-6).toUpperCase()} | تتبع ${opId}`)
                        : (isQueued ? `Sale queued for sync #${order.id.slice(-6).toUpperCase()} | Trace ${opId}` : `In-store sale created #${order.id.slice(-6).toUpperCase()} | Trace ${opId}`),
                    isQueued ? 'info' : 'success'
                );
            }
            if (inStoreAutoOpenInvoice && !isQueued) {
                navigate(`/admin/invoice/${order.id}`);
            }
            const sourceQuotationId = String((payload as any)?.sourceQuotationId || sourceQuotation?.id || '').trim();
            if (sourceQuotationId) {
                const supabase = getSupabaseClient();
                if (supabase) {
                    try {
                        const { error } = await supabase
                            .from('price_quotations')
                            .update({
                                status: 'accepted',
                                converted_to_order_id: String(order.id),
                                converted_at: new Date().toISOString(),
                            } as any)
                            .eq('id', sourceQuotationId);
                        if (error) throw error;
                    } catch {
                        try {
                            await supabase
                                .from('price_quotations')
                                .update({ status: 'accepted' } as any)
                                .eq('id', sourceQuotationId);
                        } catch {}
                    }
                }
            }
            inStorePendingOrderIdRef.current = '';
            setIsInStoreSaleOpen(false);
            setInStoreCustomerName('');
            setInStorePhoneNumber('');
            setInStorePaymentMethod('cash');
            setInStoreNotes('');
            setInStoreInvoiceStatement('');
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
            setInStoreIsCredit(false);
            setInStoreCustomerMode('walk_in');
            setInStoreSelectedCustomerId('');
            setInStoreCustomerSearchResult(null);
            setInStoreCustomerPhoneSearch('');
            setInStoreSelectedPartyId('');
            setSourceQuotation(null);
        } catch (error) {
            const code = String((error as any)?.code || '').trim().toUpperCase();
            const isCreateTimeout = code === 'IN_STORE_CREATE_TIMEOUT';
            if (isCreateTimeout) {
                inStoreCreateDetachedRef.current = true;
                setIsInStoreSaleOpen(false);
                showNotification(`تجاوزت العملية الحد الآمن للانتظار، وتم تحويلها للمتابعة بالخلفية. تتبع: ${opId}`, 'info');
                startInStoreBackgroundProbe(existingOrderId, opId);
                return;
            }
            const raw = error instanceof Error ? error.message : '';
            const upper = raw.trim().toUpperCase();
            const isBelowCostReason = upper === 'BELOW_COST_REASON_REQUIRED' || /BELOW_COST_REASON_REQUIRED/i.test(raw);
            const isBelowCostNotAllowed = upper === 'SELLING_BELOW_COST_NOT_ALLOWED' || /SELLING_BELOW_COST_NOT_ALLOWED/i.test(raw);
            if (canOverrideBelowCost && (isBelowCostReason || isBelowCostNotAllowed)) {
                const pendingOrderId = String((error as any)?.pendingOrderId || '').trim();
                setInStoreBelowCostPending({ payload, creditOverrideReason, pendingOrderId: pendingOrderId || undefined });
                setInStoreBelowCostReason('');
                setInStoreBelowCostModalOpen(true);
                return;
            }
            const localized = localizeSupabaseError(error);
            const message = language === 'ar'
                ? (localized ? `فشل تسجيل البيع الحضوري: ${localized} | تتبع ${opId}` : (raw ? `فشل تسجيل البيع الحضوري: ${raw} | تتبع ${opId}` : `فشل تسجيل البيع الحضوري. | تتبع ${opId}`))
                : (localized ? `Failed to create in-store sale: ${localized} | Trace ${opId}` : (raw ? `Failed to create in-store sale: ${raw} | Trace ${opId}` : `Failed to create in-store sale. | Trace ${opId}`));
            showNotification(message, 'error');
            inStorePendingOrderIdRef.current = '';
        } finally {
            const elapsedMs = Math.max(0, Date.now() - startedAt);
            try {
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('in_store_sale_ux_metric', {
                        detail: {
                            opId,
                            elapsedMs,
                            slowPath: elapsedMs >= 15000,
                            detached: inStoreCreateDetachedRef.current,
                        }
                    }));
                }
            } catch {}
            if (inStoreCreatingSlowTimerRef.current != null) {
                window.clearTimeout(inStoreCreatingSlowTimerRef.current);
                inStoreCreatingSlowTimerRef.current = null;
            }
            setInStoreCreatingSlow(false);
            inStoreCreateOpIdRef.current = '';
            setInStoreCreateOpId('');
            setInStoreCreateStartedAt(0);
            inStoreCreateDetachedRef.current = false;
            inStoreCreationLock.current = false;
            setIsInStoreCreating(false);
        }
    };

    const confirmInStoreSale = async () => {
        if (inStorePricingBusy) {
            showNotification('جاري تحديث السعر من الخادم، انتظر لحظة ثم أعد المحاولة.', 'error');
            return;
        }
        if (inStoreMissingServerPricing) {
            showNotification('تعذر اعتماد التسعير من الخادم لبعض الأصناف. أعد اختيار الصنف أو تحقق من الاتصال.', 'error');
            return;
        }
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
                    destinationAccountId: p.destinationAccountId?.trim() || undefined,
                }))
                .filter(p => Boolean(p.method) && p.amount > 0)
            : [{
                method: (inStorePaymentMethod || '').trim(),
                amount: inStoreIsCredit ? 0 : total,
                referenceNumber: (inStorePaymentReferenceNumber || '').trim() || undefined,
                senderName: (inStorePaymentSenderName || '').trim() || undefined,
                senderPhone: (inStorePaymentSenderPhone || '').trim() || undefined,
                declaredAmount: Number(inStorePaymentDeclaredAmount) || 0,
                amountConfirmed: Boolean(inStorePaymentAmountConfirmed) || inStorePaymentMethod === 'cash',
                cashReceived: Number(inStoreCashReceived) || 0,
                destinationAccountId: inStorePaymentDestinationAccountId.trim() || undefined,
            }];

        if (!normalizedPaymentLines.length && !inStoreIsCredit) {
            showNotification('يرجى إدخال بيانات الدفع.', 'error');
            return;
        }

        const sum = normalizedPaymentLines.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const dp = getCurrencyDecimals(inStoreTransactionCurrency);
        const tol = Math.pow(10, -dp);
        if (!inStoreIsCredit && Math.abs(sum - total) > tol) {
            showNotification('مجموع الدفعات لا يطابق إجمالي البيع.', 'error');
            return;
        }
        if (inStoreIsCredit && sum - total > tol) {
            showNotification('مجموع الدفعات أكبر من إجمالي البيع.', 'error');
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
                if (availableInStoreDestinations.length > 0 && !p.destinationAccountId) {
                    showNotification('يرجى اختيار الحساب البنكي / شركة الصرافة.', 'error');
                    return;
                }
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

        // Prevent duplicate cash payment lines
        const cashCount = normalizedPaymentLines.filter(p => p.method === 'cash').length;
        if (cashCount > 1) {
            showNotification('لا يمكن تكرار الدفع النقدي أكثر من مرة.', 'error');
            return;
        }

        const primaryPaymentMethod = inStoreIsCredit
            ? ((inStorePaymentMethod || 'cash').trim())
            : ((normalizedPaymentLines[0]?.method || '').trim());
        if (!inStoreIsCredit && !primaryPaymentMethod) {
            showNotification('يرجى اختيار طريقة الدفع.', 'error');
            return;
        }

        const linesWithPricing = inStoreLines.map((l) => {
            const mi = menuItems.find(m => m.id === l.menuItemId);
            const unitType = mi?.unitType || 'piece';
            const uomQty = Number(l.uomQtyInBase || 1) || 1;
            const pricingQty = (unitType === 'kg' || unitType === 'gram')
                ? (Number(l.weight) || Number(l.quantity) || 0)
                : ((Number(l.quantity) || 0) * uomQty);
            const key = `${l.menuItemId}:${unitType}:${pricingQty}:${inStoreSelectedCustomerId || ''}`;
            const pricing = inStorePricingMap[key];
            
            if (pricing?.isTxnPrice) {
                return {
                    ...l,
                    _pricedByRpc: true,
                    price: unitType === 'gram' ? pricing.unitPricePerKg : pricing.unitPrice,
                    pricePerUnit: pricing.unitPricePerKg
                };
            }
            return l;
        });

        const payload: any = {
            lines: linesWithPricing,
            sourceQuotationId: sourceQuotation?.id || undefined,
            currency: inStoreTransactionCurrency,
            paymentMethod: primaryPaymentMethod,
            customerId: inStoreCustomerMode === 'existing' && inStoreSelectedCustomerId ? inStoreSelectedCustomerId : undefined,
            partyId: inStoreCustomerMode === 'party' && inStoreSelectedPartyId ? inStoreSelectedPartyId : undefined,
            customerName: inStoreCustomerName,
            phoneNumber: inStorePhoneNumber,
            notes: inStoreNotes,
            invoiceStatement: inStoreInvoiceStatement,
            discountType: inStoreDiscountType,
            discountValue: Number(inStoreDiscountValue) || 0,
            paymentReferenceNumber: inStorePaymentMethod === 'kuraimi' || inStorePaymentMethod === 'network' ? inStorePaymentReferenceNumber.trim() : undefined,
            paymentSenderName: inStorePaymentMethod === 'kuraimi' || inStorePaymentMethod === 'network' ? inStorePaymentSenderName.trim() : undefined,
            paymentSenderPhone: inStorePaymentMethod === 'kuraimi' || inStorePaymentMethod === 'network' ? inStorePaymentSenderPhone.trim() : undefined,
            paymentDeclaredAmount: inStorePaymentMethod === 'kuraimi' || inStorePaymentMethod === 'network' ? (Number(inStorePaymentDeclaredAmount) || 0) : undefined,
            paymentAmountConfirmed: inStorePaymentMethod === 'kuraimi' || inStorePaymentMethod === 'network' ? Boolean(inStorePaymentAmountConfirmed) : undefined,
            isCredit: inStoreIsCredit,
            creditDays: inStoreIsCredit ? Math.max(0, Number(inStoreCreditDays) || 0) : 0,
            dueDate: inStoreIsCredit ? (inStoreCreditDueDate || undefined) : undefined,
            paymentBreakdown: normalizedPaymentLines.map((p) => ({
                method: p.method,
                amount: p.amount,
                referenceNumber: p.referenceNumber,
                senderName: p.senderName,
                senderPhone: p.senderPhone,
                declaredAmount: p.declaredAmount,
                amountConfirmed: p.amountConfirmed,
                cashReceived: p.method === 'cash' ? (p.cashReceived > 0 ? p.cashReceived : undefined) : undefined,
                destinationAccountId: p.destinationAccountId,
            })),
        };

        if (inStoreIsCredit && inStoreCustomerMode === 'party' && inStoreSelectedPartyId) {
            const fx = Number(inStoreTotals.fxRate) || 1;
            const paidForeign = normalizedPaymentLines.reduce((s, p) => s + (Number(p.amount) || 0), 0);
            const txnCurrency = String(inStoreTransactionCurrency || '').trim().toUpperCase();
            const total = Number(inStoreTotals.total) || 0;
            const netArForeign = Math.max(0, total - paidForeign);
            // Look up per-currency credit info from the currencies array
            const currenciesArr = Array.isArray(inStoreCreditSummary?.currencies) ? inStoreCreditSummary.currencies : [];
            const currencyEntry = currenciesArr.find((c: any) => String(c?.currency_code || '').toUpperCase() === txnCurrency);
            // Use per-currency values if available, otherwise fallback to base
            const netAr = currencyEntry ? netArForeign : Math.max(0, (Number(inStoreTotals.baseTotal) || 0) - roundMoney(paidForeign * fx));
            const available = Number(currencyEntry?.available_credit ?? inStoreCreditSummary?.available_credit ?? 0);
            const hold = Boolean(currencyEntry?.credit_hold ?? inStoreCreditSummary?.credit_hold);
            if (netAr > 0 && (hold || (netAr - available > 0.0001))) {
                if (!canManageAccounting) {
                    showNotification('هذا البيع يتجاوز سقف ائتمان الطرف أو عليه إيقاف ائتمان ويتطلب موافقة.', 'error');
                    return;
                }
                setInStoreCreditOverridePending(payload);
                setInStoreCreditOverrideReason('');
                setInStoreCreditOverrideModalOpen(true);
                return;
            }
        }

        if (!canMarkPaid) {
            showNotification('سيتم إنشاء الطلب بحالة انتظار التحصيل حتى يقوم مخوّل بالتحصيل/التسليم بإكماله.', 'info');
        }
        await runCreateInStoreSale(payload);
    };
    // Keep the ref in sync for keyboard shortcut
    confirmInStoreSaleRef.current = confirmInStoreSale;
    const saveInStoreDraftQuotation = async () => {
        if (inStoreLines.length === 0) {
            showNotification('أضف أصنافًا أولاً.', 'error');
            return;
        }
        if (inStoreCreationLock.current) return;
        inStoreCreationLock.current = true;
        setIsInStoreCreating(true);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error('Supabase غير مهيأ.');

            // Build items for price_quotation_items
            const roundMoney = (v: number) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
            const qtItems = inStoreLines.map((line: any, idx: number) => {
                const qty = Number(line.quantity || 1);
                const price = Number(line.price || line.unitPrice || 0);
                const name = line.menuItem?.name?.[language] || line.menuItem?.name?.ar || line.menuItem?.name?.en || line.menuItemName || line.name || 'صنف';
                return {
                    item_id: line.menuItemId || line.itemId || null,
                    item_name: name,
                    unit: 'piece',
                    quantity: qty,
                    unit_price: roundMoney(price),
                    total: roundMoney(qty * price),
                    notes: '',
                    sort_order: idx,
                };
            });
            const subtotal = roundMoney(qtItems.reduce((s: number, i: any) => s + i.total, 0));
            const discType = inStoreDiscountType === 'percent' ? 'percentage' : (Number(inStoreDiscountValue) > 0 ? 'fixed' : 'none');
            const discVal = Number(inStoreDiscountValue) || 0;
            const discAmt = discType === 'percentage' ? roundMoney(subtotal * discVal / 100) : (discType === 'fixed' ? roundMoney(Math.min(discVal, subtotal)) : 0);
            const total = roundMoney(subtotal - discAmt);

            // Insert quotation header
            const { data: qtRow, error: qtErr } = await supabase
                .from('price_quotations')
                .insert({
                    customer_name: inStoreCustomerName || 'عميل حضوري',
                    customer_phone: inStorePhoneNumber || '',
                    currency: (settings as any).currency || 'YER',
                    discount_type: discType,
                    discount_value: discVal,
                    subtotal,
                    discount_amount: discAmt,
                    total,
                    notes: inStoreNotes || '',
                })
                .select('id, quotation_number')
                .single();
            if (qtErr) throw qtErr;
            const quotationId = (qtRow as any).id;
            const quotationNumber = (qtRow as any).quotation_number;

            // Insert items
            const { error: itemsErr } = await supabase
                .from('price_quotation_items')
                .insert(qtItems.map(it => ({ ...it, quotation_id: quotationId })));
            if (itemsErr) throw itemsErr;

            // Print using A5 luxury template
            let printNumber = 1;
            try {
                const { data: pn } = await supabase.rpc('track_document_print', { p_source_table: 'price_quotations', p_source_id: quotationId, p_template: 'PrintableQuotation' });
                printNumber = Number(pn) || 1;
            } catch { /* fallback */ }

            const fallbackBrand = {
                name: (settings.cafeteriaName?.[language] || settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '').trim(),
                address: (settings.address || '').trim(),
                contactNumber: (settings.contactNumber || '').trim(),
                logoUrl: (settings.logoUrl || '').trim(),
                vatNumber: ((settings as any).vatNumber || '').trim(),
            };
            const printData: QuotationPrintData = {
                quotationNumber,
                createdAt: new Date().toISOString(),
                validUntil: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
                customerName: inStoreCustomerName || 'عميل حضوري',
                customerPhone: inStorePhoneNumber || '',
                currency: (settings as any).currency || 'YER',
                items: qtItems.map(it => ({ itemName: it.item_name, unit: it.unit, quantity: it.quantity, unitPrice: it.unit_price, total: it.total })),
                subtotal,
                discountType: discType,
                discountValue: discVal,
                discountAmount: discAmt,
                taxRate: 0,
                taxAmount: 0,
                total,
                notes: inStoreNotes || '',
            };
            const printHtml = renderToString(
                <StandaloneQuotationPrint
                    data={printData}
                    language={language as 'ar' | 'en'}
                    companyName={fallbackBrand.name}
                    companyAddress={fallbackBrand.address}
                    companyPhone={fallbackBrand.contactNumber}
                    logoUrl={fallbackBrand.logoUrl}
                    vatNumber={fallbackBrand.vatNumber}
                    printNumber={printNumber}
                />
            );
            printContent(printHtml, `عرض سعر #${quotationNumber}`);

            showNotification(`تم حفظ عرض السعر #${quotationNumber}`, 'success');
            setIsInStoreSaleOpen(false);
            setInStoreCustomerName('');
            setInStorePhoneNumber('');
            setInStoreNotes('');
            setInStoreInvoiceStatement('');
            setInStoreDiscountType('amount');
            setInStoreDiscountValue(0);
            setInStoreLines([]);
            setInStoreSelectedItemId('');
            setInStoreSelectedItemIndex(-1);
            setInStoreSelectedAddons({});
            setInStoreCustomerMode('walk_in');
            setInStoreSelectedCustomerId('');
            setInStoreCustomerSearchResult(null);
            setInStoreCustomerPhoneSearch('');
            setInStoreSelectedPartyId('');
        } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            showNotification(raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل حفظ عرض السعر.', 'error');
        } finally {
            inStoreCreationLock.current = false;
            setIsInStoreCreating(false);
        }
    };

    const filteredAndSortedOrders = useMemo(() => {
        let processedOrders = [...orders];
        if (effectiveWarehouseView && effectiveWarehouseView !== 'all') {
            processedOrders = processedOrders.filter(order => getOrderWarehouseId(order) === effectiveWarehouseView);
        }

        if (customerUserIdFilter.trim()) {
            processedOrders = processedOrders.filter(order => order.userId === customerUserIdFilter.trim());
        }

        if (customerNameFilter.trim()) {
            const term = customerNameFilter.trim().toLowerCase();
            const cleanTerm = term.replace(/^#/, '');
            processedOrders = processedOrders.filter(order => {
                const nameMatch = (order.customerName || '').toLowerCase().includes(term);
                const phoneMatch = (order.phoneNumber || '').toLowerCase().includes(term);
                const idMatch = (order.id || '').toLowerCase().includes(cleanTerm);
                const traceMatch = getOrderTraceId(order).toLowerCase().includes(cleanTerm);
                return nameMatch || phoneMatch || idMatch || traceMatch;
            });
        }

        if (filterStatus !== 'all') {
            if (filterStatus === 'delivered_no_returns') {
                processedOrders = processedOrders.filter(order => {
                    const raw = String((order as any).returnStatus ?? (order as any)?.data?.returnStatus ?? '').toLowerCase();
                    const isReturned = raw === 'full' || raw === 'partial';
                    const isVoided = Boolean((order as any)?.voidedAt || (order as any)?.data?.voidedAt);
                    return order.status === 'delivered' && !isReturned && !isVoided;
                });
            } else {
                processedOrders = processedOrders.filter(order => order.status === filterStatus);
            }
        }

        if (filterPaymentMethod !== 'all') {
            processedOrders = processedOrders.filter(order => {
                const method = String(order.paymentMethod || '').toLowerCase();
                if (filterPaymentMethod === 'ar') return method === 'ar';
                if (filterPaymentMethod === 'cash') return method === 'cash';
                if (filterPaymentMethod === 'network') return method === 'network' || method === 'bank' || method === 'kuraimi';
                return method === filterPaymentMethod;
            });
        }

        if (filterCurrency !== 'all') {
            processedOrders = processedOrders.filter(order => {
                const currency = String((order as any).currency || baseCode).toUpperCase();
                return currency === filterCurrency.toUpperCase();
            });
        }

        if (filterDateFrom) {
            const start = new Date(filterDateFrom);
            start.setHours(0, 0, 0, 0);
            processedOrders = processedOrders.filter(order => new Date(order.createdAt) >= start);
        }

        if (filterDateTo) {
            const end = new Date(filterDateTo);
            end.setHours(23, 59, 59, 999);
            processedOrders = processedOrders.filter(order => new Date(order.createdAt) <= end);
        }

        if (returnsOnly) {
            processedOrders = processedOrders.filter((order) => {
                const raw = String((order as any).returnStatus ?? (order as any)?.data?.returnStatus ?? '').toLowerCase();
                return raw === 'full' || raw === 'partial';
            });
        }

        if (autoCandidatesOnly) {
            processedOrders = processedOrders.filter((order) => {
                if (pendingPurgeByOrderId[order.id]) return false;
                if (String(order.status || '').toLowerCase() !== 'delivered') return false;
                const isVoided = Boolean((order as any)?.voidedAt || (order as any)?.data?.voidedAt);
                if (isVoided) return false;

                const currency = String((order as any).currency || '').toUpperCase() || baseCode;
                const total = roundMoneyByCode(Number(order.total) || 0, currency);
                const tol = Math.pow(10, -getCurrencyDecimalsByCode(currency));
                const rawPaid = roundMoneyByCode(Number(paidSumByOrderId[order.id]) || 0, currency);
                const paymentMethod = String((order as any)?.paymentMethod || (order as any)?.payment_method || (order as any)?.data?.paymentMethod || '').toLowerCase().trim();
                const invoiceTerms = String((order as any)?.invoiceTerms || (order as any)?.data?.invoiceTerms || '').toLowerCase().trim();
                const hasArPayment = Array.isArray((order as any).payments) && (order as any).payments.some((p: any) => String(p?.method || '').toLowerCase() === 'ar');
                const isCreditSale = paymentMethod === 'ar' || hasArPayment || invoiceTerms === 'credit';
                const isDelivered = String(order.status || '').toLowerCase() === 'delivered';
                const isCashLike = paymentMethod === 'cash' || invoiceTerms === 'cash';
                const hasPaidAt = Boolean((order as any)?.paidAt || (order as any)?.data?.paidAt);
                const isInStoreCashSettlement = isInStoreOrder(order) && isDelivered && isCashLike && !isCreditSale;
                const isMarkedCashSettlement = hasPaidAt && isDelivered && isCashLike && !isCreditSale;
                const paid = (rawPaid <= tol && (isInStoreCashSettlement || isMarkedCashSettlement)) ? total : rawPaid;

                const isOverpaid = paid > (total + tol);
                const isStalePaidAt = hasPaidAt && paid <= tol;
                const isCreditWithPaid = isCreditSale && paid > tol;
                return isOverpaid || isStalePaidAt || isCreditWithPaid;
            });
        }

        if (isDeliveryOnly && adminUser?.id) {
            processedOrders = processedOrders.filter(order => order.assignedDeliveryUserId === adminUser.id);
        }

        if (filterShiftId && filterShiftId !== 'all') {
            const shift = recentShifts.find(s => s.id === filterShiftId);
            if (shift) {
                const openTime = new Date(shift.opened_at).getTime();
                const closeTime = shift.closed_at ? new Date(shift.closed_at).getTime() : Date.now();
                processedOrders = processedOrders.filter(order => {
                    const orderTime = new Date(order.createdAt).getTime();
                    const isWithinTimeRange = orderTime >= openTime && orderTime <= closeTime;
                    const isSameCashier = order._createdBy === shift.cashier_id || order.paymentVerifiedBy === shift.cashier_id;
                    return isWithinTimeRange && isSameCashier;
                });
            }
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
    }, [adminUser?.id, customerUserIdFilter, customerNameFilter, filterStatus, filterPaymentMethod, filterCurrency, filterDateFrom, filterDateTo, filterShiftId, isDeliveryOnly, orders, returnsOnly, autoCandidatesOnly, sortOrder, baseCode, recentShifts, paidSumByOrderId, pendingPurgeByOrderId, effectiveWarehouseView, getOrderWarehouseId]);

    const availableInStoreDestinations = useMemo(() => {
        const currency = String(inStoreTransactionCurrency || '').toUpperCase();
        return destinationAccounts.filter(a => matchesDestinationCurrency(String(a.code || ''), String((a as any).name || ''), currency));
    }, [destinationAccounts, inStoreTransactionCurrency]);

    const availablePartialDestinations = useMemo(() => {
        const order = partialPaymentOrderId ? (filteredAndSortedOrders.find(o => o.id === partialPaymentOrderId) || orders.find(o => o.id === partialPaymentOrderId)) : null;
        const currency = order ? String((order as any).currency || '').toUpperCase() || baseCode : baseCode;
        return destinationAccounts.filter(a => matchesDestinationCurrency(String(a.code || ''), String((a as any).name || ''), currency));
    }, [destinationAccounts, partialPaymentOrderId, filteredAndSortedOrders, orders, baseCode]);

    const totalsByCurrency = useMemo(() => {
        const sums: Record<string, number> = {};
        for (const order of filteredAndSortedOrders) {
            const code = String((order as any).currency || baseCode).toUpperCase() || '—';
            sums[code] = (sums[code] || 0) + (Number(order.total) || 0);
        }
        return sums;
    }, [filteredAndSortedOrders, baseCode]);

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

    const loadPendingPurgeRequests = useCallback(async (orderIds: string[]) => {
        const uniqueIds = Array.from(new Set(orderIds.filter(Boolean)));
        if (uniqueIds.length === 0) {
            setPendingPurgeByOrderId({});
            return;
        }
        try {
            const supabase = getSupabaseClient();
            if (!supabase) {
                setPendingPurgeByOrderId({});
                return;
            }
            const { data, error } = await supabase
                .from('order_payment_purge_requests')
                .select('id,order_id,requested_by,requested_at,reason,reason_category,status')
                .eq('status', 'requested')
                .in('order_id', uniqueIds)
                .order('requested_at', { ascending: false });
            if (error) throw error;
            const map: Record<string, OrderPurgeRequestLite> = {};
            ((data as any[]) || []).forEach((r) => {
                const oid = String((r as any)?.order_id || '');
                if (!oid) return;
                if (!map[oid]) map[oid] = r as OrderPurgeRequestLite;
            });
            setPendingPurgeByOrderId(map);
        } catch {
            setPendingPurgeByOrderId({});
        }
    }, []);

    const loadPurgeDashboard = useCallback(async () => {
        setPurgeDashboardLoading(true);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) {
                setPurgeDashboardRows([]);
                return;
            }
            const { data, error } = await supabase
                .from('order_payment_purge_requests')
                .select('id,order_id,requested_by,requested_at,reason,reason_category,status')
                .eq('status', 'requested')
                .order('requested_at', { ascending: false })
                .limit(50);
            if (error) throw error;
            setPurgeDashboardRows(Array.isArray(data) ? data as PurgeDashboardRow[] : []);
        } catch {
            setPurgeDashboardRows([]);
        } finally {
            setPurgeDashboardLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadPaidSums(filteredAndSortedOrders.map(o => o.id));
    }, [filteredAndSortedOrders, loadPaidSums]);

    useEffect(() => {
        void loadPendingPurgeRequests(filteredAndSortedOrders.map(o => o.id));
    }, [filteredAndSortedOrders, loadPendingPurgeRequests]);

    useEffect(() => {
        void loadPurgeDashboard();
    }, [loadPurgeDashboard]);

    const getOrderPaymentSnapshot = useCallback((order: Order) => {
        const currency = String((order as any).currency || '').toUpperCase() || baseCode;
        const total = roundMoneyByCode(Number(order.total) || 0, currency);
        const tol = Math.pow(10, -getCurrencyDecimalsByCode(currency));
        const rawPaid = roundMoneyByCode(Number(paidSumByOrderId[order.id]) || 0, currency);
        const paymentMethod = String((order as any)?.paymentMethod || (order as any)?.payment_method || (order as any)?.data?.paymentMethod || '').toLowerCase().trim();
        const invoiceTerms = String((order as any)?.invoiceTerms || (order as any)?.data?.invoiceTerms || '').toLowerCase().trim();
        const hasArPayment = Array.isArray((order as any).payments) && (order as any).payments.some((p: any) => String(p?.method || '').toLowerCase() === 'ar');
        const isCreditSale = paymentMethod === 'ar' || hasArPayment || invoiceTerms === 'credit';
        const isDelivered = String(order.status || '').toLowerCase() === 'delivered';
        const isCashLike = paymentMethod === 'cash' || invoiceTerms === 'cash';
        const hasPaidAt = Boolean((order as any)?.paidAt || (order as any)?.data?.paidAt);
        const isInStoreCashSettlement = isInStoreOrder(order) && isDelivered && isCashLike && !isCreditSale;
        const isMarkedCashSettlement = hasPaidAt && isDelivered && isCashLike && !isCreditSale;
        const paid = (rawPaid <= tol && (isInStoreCashSettlement || isMarkedCashSettlement)) ? total : rawPaid;
        const remaining = roundMoneyByCode(Math.max(0, total - paid), currency);
        return { currency, total, paid, remaining, tol, paymentMethod, isCreditSale };
    }, [baseCode, isInStoreOrder, paidSumByOrderId]);

    const openPartialPaymentModal = (orderId: string) => {
        if (!assertMutableOrdersView()) return;
        const order = filteredAndSortedOrders.find(o => o.id === orderId) || orders.find(o => o.id === orderId);
        if (!order) return;
        const { currency, remaining } = getOrderPaymentSnapshot(order);
        setPartialPaymentOrderId(orderId);
        const dp = getCurrencyDecimalsByCode(currency);
        setPartialPaymentAmount(remaining > 0 ? Number(remaining.toFixed(dp)) : 0);
        setPartialPaymentMethod(isInStoreOrder(order) ? 'cash' : ((order.paymentMethod || 'cash').trim() || 'cash'));
        setPartialPaymentOccurredAt(toDateTimeLocalInputValue());
        setPartialPaymentReferenceNumber('');
        setPartialPaymentSenderName('');
        setPartialPaymentSenderPhone('');
        setPartialPaymentDeclaredAmount(remaining > 0 ? Number(remaining.toFixed(dp)) : 0);
        setPartialPaymentAmountConfirmed(false);
        setPartialPaymentAdvancedAccounting(false);
        setPartialPaymentOverrideAccountId('');
        setPartialPaymentDestinationAccountId('');
    };

    const confirmPartialPayment = async () => {
        if (!assertMutableOrdersView()) return;
        if (!partialPaymentOrderId) return;
        if (!canMarkPaid) {
            showNotification('لا تملك صلاحية تسجيل دفعة.', 'error');
            return;
        }
        const order = filteredAndSortedOrders.find(o => o.id === partialPaymentOrderId) || orders.find(o => o.id === partialPaymentOrderId);
        if (!order) return;
        const { currency, remaining } = getOrderPaymentSnapshot(order);
        const amount = Number(partialPaymentAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            showNotification('أدخل مبلغًا صحيحًا.', 'error');
            return;
        }
        const tol = Math.pow(10, -getCurrencyDecimalsByCode(currency));
        if (remaining > 0 && amount > remaining + tol) {
            showNotification('المبلغ أكبر من المتبقي على الطلب.', 'error');
            return;
        }
        setIsRecordingPartialPayment(true);
        try {
            if (partialPaymentMethod === 'cash' && !currentShift) {
                throw new Error('يجب فتح وردية نقدية قبل تسجيل دفعة نقدية.');
            }
            const needsReference = partialPaymentMethod === 'kuraimi' || partialPaymentMethod === 'network';
            if (needsReference) {
                const ref = (partialPaymentReferenceNumber || '').trim();
                const senderName = (partialPaymentSenderName || '').trim();
                const declared = Number(partialPaymentDeclaredAmount) || 0;
                if (!ref) throw new Error(partialPaymentMethod === 'kuraimi' ? 'يرجى إدخال رقم الإيداع.' : 'يرجى إدخال رقم الحوالة.');
                if (!senderName) throw new Error(partialPaymentMethod === 'kuraimi' ? 'يرجى إدخال اسم المودِع.' : 'يرجى إدخال اسم المرسل.');
                if (!(declared > 0)) throw new Error('يرجى إدخال مبلغ العملية.');
                if (Math.abs(declared - amount) > tol) throw new Error('مبلغ العملية لا يطابق مبلغ هذه الدفعة.');
                if (!partialPaymentAmountConfirmed) throw new Error('يرجى تأكيد مطابقة المبلغ قبل تسجيل الدفعة.');
            }
            const occurredAtIso = partialPaymentOccurredAt ? new Date(partialPaymentOccurredAt).toISOString() : undefined;
            const isDestinationOverride = partialPaymentMethod === 'kuraimi' || partialPaymentMethod === 'network';
            if (isDestinationOverride && availablePartialDestinations.length > 0 && !partialPaymentDestinationAccountId) {
                showNotification('يرجى اختيار الحساب البنكي / شركة الصرافة.', 'error');
                setIsRecordingPartialPayment(false);
                return;
            }
            const override = isDestinationOverride && partialPaymentDestinationAccountId
                ? partialPaymentDestinationAccountId
                : (partialPaymentAdvancedAccounting && canManageAccounting && isUuidText(partialPaymentOverrideAccountId)
                    ? String(partialPaymentOverrideAccountId || '').trim()
                    : undefined);
            await recordOrderPaymentPartial(partialPaymentOrderId, amount, partialPaymentMethod, occurredAtIso, override, {
                referenceNumber: (partialPaymentReferenceNumber || '').trim() || undefined,
                senderName: (partialPaymentSenderName || '').trim() || undefined,
                senderPhone: (partialPaymentSenderPhone || '').trim() || undefined,
                declaredAmount: Number(partialPaymentDeclaredAmount) || 0,
                amountConfirmed: Boolean(partialPaymentAmountConfirmed),
            });
            await loadPaidSums(filteredAndSortedOrders.map(o => o.id));
            showNotification('تم تسجيل الدفعة بنجاح.', 'success');
            const supabase = getSupabaseClient();
            const occ = occurredAtIso || new Date().toISOString();
            const idempotencyKey = `partial:${partialPaymentOrderId}:${occ}:${partialPaymentMethod}:${Number(amount) || 0}`;
            if (supabase) {
                try {
                    const { data: p, error: pErr } = await supabase
                        .from('payments')
                        .select('id')
                        .eq('reference_table', 'orders')
                        .eq('reference_id', partialPaymentOrderId)
                        .eq('direction', 'in')
                        .eq('idempotency_key', idempotencyKey)
                        .order('occurred_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();
                    const paymentId = !pErr && (p as any)?.id ? String((p as any).id) : '';
                    if (paymentId) {
                        const ok = window.confirm('هل تريد طباعة سند القبض لهذه الدفعة الآن؟');
                        if (ok) {
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
                                name: (override?.name || fallback.name || wh?.name || '').trim(),
                                address: (override?.address || wh?.address || wh?.location || fallback.address || '').trim(),
                                contactNumber: (override?.contactNumber || wh?.phone || fallback.contactNumber || '').trim(),
                                logoUrl: (override?.logoUrl || fallback.logoUrl || '').trim(),
                                branchName: (wh?.name || '').trim(),
                                branchCode: '',
                            };
                            try {
                                const bid = String(sessionScope.scope?.branchId || '').trim();
                                if (bid) {
                                    const { data: b } = await supabase.from('branches').select('name,code').eq('id', bid).maybeSingle();
                                    brand.branchName = String((b as any)?.name || '');
                                    brand.branchCode = String((b as any)?.code || '');
                                }
                            } catch {
                            }
                            await printReceiptVoucherByPaymentId(paymentId, brand);
                        }
                    }
                } catch {
                }
            }
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
    const getEditableStatusesForOrder = (order: Order): OrderStatus[] => {
        const base = editableStatusOptions;
        if (isInStoreOrder(order)) {
            const allowed = base.filter(s => s !== 'out_for_delivery');
            if (order.status === 'pending') {
                return allowed.filter(s => s === 'pending' || s === 'delivered');
            }
            return allowed;
        }
        return base;
    };

    const handleConfirmCancel = async () => {
        if (!assertMutableOrdersView()) return;
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
        const stableOrderId = order.id;

        const currency = String((order as any).currency || '').toUpperCase() || baseCode;
        const dp = getCurrencyDecimalsByCode(currency);

        const grossSubtotal = Number(order.subtotal) || 0;
        const discountAmount = Number((order as any).discountAmount) || 0;
        const netSubtotal = Math.max(0, grossSubtotal - discountAmount);
        const discountFactor = grossSubtotal > 0 ? (netSubtotal / grossSubtotal) : 1;

        const itemsToReturn = Object.entries(returnItems)
            .filter(([_, qty]) => qty > 0)
            .map(([cartItemId, qty]) => {
                const orderItem = (order.items || []).find(i => i.cartItemId === cartItemId);
                if (!orderItem) return null;
                const menuItemId = orderItem.id || (orderItem as any).menuItemId;

                const unitType = (orderItem as any).unitType;
                const isWeightBased = isWeightBasedUnit(unitType as any);
                const totalQty = isWeightBased ? (Number((orderItem as any).weight) || 0) : (Number(orderItem.quantity) || 0);
                if (!(totalQty > 0)) return null;

                const unitPrice = unitType === 'gram' && (orderItem as any).pricePerUnit ? (Number((orderItem as any).pricePerUnit) || 0) / 1000 : (Number(orderItem.price) || 0);
                const addonsCost = Object.values((orderItem as any).selectedAddons || {}).reduce((sum: number, entry: any) => {
                    const addonPrice = Number(entry?.addon?.price) || 0;
                    const addonQty = Number(entry?.quantity) || 0;
                    return sum + (addonPrice * addonQty);
                }, 0);

                const uomQtyInBase = Number((orderItem as any).uomQtyInBase || 1) || 1;
                const lineGross = isWeightBased
                    ? (unitPrice * totalQty) + addonsCost
                    : ((unitPrice * uomQtyInBase) + addonsCost) * totalQty;

                const menuItemKey = String(menuItemId || cartItemId || '').trim();
                const options = !isWeightBased ? getReturnUomOptions(orderItem, menuItemKey) : [];
                const defaultCode = String(returnUnits[cartItemId] || (orderItem as any).uomCode || unitType || 'piece').trim().toLowerCase();
                const selectedOption = !isWeightBased
                    ? (options.find(o => o.code === defaultCode) || options[0] || { code: String(unitType || 'piece').toLowerCase(), name: unitType, qtyInBase: 1 })
                    : null;
                const selectedQtyInBase = isWeightBased ? 1 : (Number(selectedOption?.qtyInBase || 1) || 1);
                const totalBaseQty = isWeightBased ? totalQty : (totalQty * uomQtyInBase);
                const qtyBase = isWeightBased
                    ? Number(qty) || 0
                    : (Number(qty) || 0) * selectedQtyInBase;
                const proportion = totalBaseQty > 0 ? Math.max(0, Math.min(1, qtyBase / totalBaseQty)) : 0;
                const returnedGross = lineGross * proportion;
                const returnedNet = returnedGross * discountFactor;

                const baseQty = qtyBase;
                const baseUnitPrice = Number((returnedNet / (Number(baseQty) || 1)).toFixed(4));

                return {
                    itemId: menuItemId,
                    itemName: orderItem.name?.ar || orderItem.name?.en || 'Unknown',
                    quantity: baseQty,
                    unitPrice: baseUnitPrice,
                    total: Number(returnedNet.toFixed(dp)),
                    reason: returnReason,
                    // Metadata for UI
                    salesUnitQty: Number(qty) || 0,
                    uomCode: selectedOption?.code || String((orderItem as any).uomCode || unitType || 'piece').trim().toLowerCase(),
                    uomQtyInBase: selectedQtyInBase
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
            // For debugging: Show raw error if available, otherwise default
            const message = raw || 'فشل تنفيذ الاسترجاع.';
            showNotification(message, 'error');
        } finally {
            setIsCreatingReturn(false);
            if (stableOrderId) {
                try { void fetchOrders(); } catch { }
                try { void refreshReturnsForOrder(stableOrderId); } catch { }
            }
        }
    };

    const handleConfirmVoidDelivered = async () => {
        if (!voidOrderId) return;
        if (!canVoidDelivered) return;
        try {
            setIsVoidingOrder(true);
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error('Supabase غير مهيأ.');
            const { error } = await supabase.rpc('void_delivered_order', {
                p_order_id: voidOrderId,
                p_reason: voidReason || null
            } as any);
            if (error) throw error;
            showNotification('تم عكس البيع (إلغاء بعد التسليم) بنجاح.', 'success');
            setVoidOrderId(null);
            setVoidReason('');
        } catch (error) {
            const raw = error instanceof Error ? error.message : (error as any)?.message || (error as any)?.details || JSON.stringify(error);
            showNotification(raw || 'فشل تنفيذ الإلغاء بعد التسليم.', 'error');
        } finally {
            setIsVoidingOrder(false);
        }
    };

    const isDeliveredLocation = (value: unknown): value is { lat: number; lng: number; accuracy?: number } => {
        if (!value || typeof value !== 'object') return false;
        const rec = value as Record<string, unknown>;
        return typeof rec.lat === 'number' && typeof rec.lng === 'number';
    };

    const getReturnStatus = (order: Order): 'full' | 'partial' | '' => {
        const raw = String((order as any).returnStatus ?? (order as any)?.data?.returnStatus ?? '').toLowerCase();
        if (raw === 'full') return 'full';
        if (raw === 'partial') return 'partial';
        return '';
    };

    const renderReturnBadge = (order: Order, variant: 'banner' | 'pill' = 'banner') => {
        const status = getReturnStatus(order);
        if (!status) return null;

        const label = status === 'full' ? 'مسترجع بالكامل' : 'مسترجع جزئيًا';

        if (variant === 'pill') {
            return (
                <span
                    className={
                        status === 'full'
                            ? 'px-2 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
                            : 'px-2 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
                    }
                >
                    {label}
                </span>
            );
        }

        return (
            <div className="mb-2">
                <span
                    className={
                        status === 'full'
                            ? 'inline-flex items-center justify-center w-full px-3 py-2 rounded-md text-sm font-bold bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
                            : 'inline-flex items-center justify-center w-full px-3 py-2 rounded-md text-sm font-bold bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
                    }
                >
                    {label}
                </span>
            </div>
        );
    };

    const renderMobileCard = (order: Order) => {
        const { paid, remaining, tol, isCreditSale } = getOrderPaymentSnapshot(order);
        const returnStatus = getReturnStatus(order);
        const isFullyReturned = returnStatus === 'full';
        const isVoided = Boolean((order as any)?.voidedAt || (order as any)?.data?.voidedAt);
        const canReturn = order.status === 'delivered' && (isCreditSale || paid > tol) && !isFullyReturned && !isVoided;
        const items = Array.isArray((order as any)?.items) ? (order as any).items : [];

        return (
            <div key={order.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 border border-gray-100 dark:border-gray-700">
                {/* Header: ID, Date, Status */}
                <div className="flex justify-between items-start mb-3">
                    <div>
                        <div className="text-sm font-bold text-gray-900 dark:text-white">#{order.id.slice(-6).toUpperCase()}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{new Date(order.createdAt).toLocaleDateString('ar-EG-u-nu-latn')}</div>
                        {getOrderTraceId(order) && (
                            <div className="mt-1 flex items-center gap-2">
                                <div className="text-[11px] text-cyan-700 dark:text-cyan-300 font-mono break-all" dir="ltr">
                                    Trace: {getOrderTraceId(order)}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void copyTraceId(getOrderTraceId(order))}
                                    className="px-2 py-0.5 rounded bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200 text-[10px] font-bold"
                                >
                                    نسخ
                                </button>
                            </div>
                        )}
                        {getOrderFailureReason(order) && (
                            <div className="text-[11px] text-red-600 dark:text-red-400 mt-1 break-words">
                                سبب التعثر: {getOrderFailureReason(order)}
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${adminStatusColors[order.status] || 'bg-gray-100 text-gray-800'}`}>
                            {statusTranslations[order.status] || order.status}
                        </span>
                        {isVoided && (
                            <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200">
                                ⛔ ملغي بعد التسليم
                            </span>
                        )}
                        {renderReturnBadge(order, 'pill')}
                        {order.isScheduled && order.scheduledAt && (
                            <div className="text-[10px] text-purple-600 dark:text-purple-400 font-bold" dir="ltr">
                                🕒 {new Date(order.scheduledAt).toLocaleTimeString('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}
                            </div>
                        )}
                        {(() => {
                            const isCod = order.paymentMethod === 'cash' && !isInStoreOrder(order) && Boolean(order.deliveryZoneId);
                            if (!isCod) return null;
                            const driverId = String(order.deliveredBy || order.assignedDeliveryUserId || '');
                            const bal = driverId ? (Number(driverCashByDriverId[driverId]) || 0) : 0;
                            if (bal <= 0.01) return null;
                            return (
                                <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                                    نقد لدى المندوب: <span className="font-mono ms-1" dir="ltr">{bal.toFixed(2)} {baseCode || '—'}</span>
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
                    {order.deliveryZoneId && !isInStoreOrder(order) && (
                        <div className="text-[10px] text-gray-500">
                            المنطقة: {getDeliveryZoneById(order.deliveryZoneId)?.name['ar'] || 'غير محدد'}
                        </div>
                    )}
                </div>

                {/* Items Summary */}
                <div className="mb-3">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">الأصناف ({items.length})</div>
                    <ul className="text-sm text-gray-800 dark:text-gray-200 space-y-1 pl-2 border-l-2 border-gray-200 dark:border-gray-600">
                        {items.slice(0, 3).map((item: any, idx: number) => (
                            <li key={item.cartItemId || item.id || `${item.menuItemId || 'item'}-${idx}`} className="truncate">
                                {item.quantity}x {item.name?.ar || item.name?.en || 'Item'}
                            </li>
                        ))}
                        {items.length > 3 && <li key="more-items" className="text-xs text-gray-500">+ {items.length - 3} المزيد...</li>}
                    </ul>
                </div>

                {/* Payment & Totals */}
                <div className="flex justify-between items-center mb-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                    <div>
                        <div className="text-xs text-gray-500">الإجمالي</div>
                        <CurrencyDualAmount
                            amount={Number(order.total) || 0}
                            currencyCode={(order as any).currency}
                            baseAmount={(order as any).baseTotal}
                            fxRate={(order as any).fxRate}
                            baseCurrencyCode={baseCode}
                            label="الإجمالي"
                        />
                    </div>
                    <div className="text-right">
                        <div className="text-xs text-gray-500">طريقة الدفع</div>
                        <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{paymentTranslations[order.paymentMethod] || order.paymentMethod}</div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/30">
                        <div className="text-xs text-gray-500">مدفوع</div>
                        <CurrencyDualAmount
                            amount={Number(paid) || 0}
                            currencyCode={(order as any).currency}
                            baseAmount={undefined}
                            fxRate={(order as any).fxRate}
                            label="مدفوع"
                            compact
                        />
                    </div>
                    <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/30 text-right">
                        <div className="text-xs text-gray-500">متبقي</div>
                        <CurrencyDualAmount
                            amount={Number(remaining) || 0}
                            currencyCode={(order as any).currency}
                            baseAmount={undefined}
                            fxRate={(order as any).fxRate}
                            label="المتبقي"
                            compact
                        />
                    </div>
                </div>
                {remaining > 1e-9 && order.status !== 'delivered' && (
                    <div className="mb-3">
                        <span className="px-2 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                            بانتظار التحصيل
                        </span>
                    </div>
                )}

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
                                getEditableStatusesForOrder(order).length === 0 ||
                                (isDeliveryOnly && order.assignedDeliveryUserId === adminUser?.id && !order.deliveryAcceptedAt) ||
                                isFullyReturned ||
                                Boolean((order as any).isDraft)
                            }
                            className={`w-full p-2 border-none rounded-md text-sm font-semibold text-center focus:ring-2 focus:ring-orange-500 transition ${adminStatusColors[order.status]}`}
                        >
                            {order.status === 'cancelled' ? (
                                <option value="cancelled">ملغي</option>
                            ) : getEditableStatusesForOrder(order).length > 0 && !getEditableStatusesForOrder(order).includes(order.status) ? (
                                <>
                                    <option key={`current-${order.status}`} value={order.status}>{statusTranslations[order.status] || order.status}</option>
                                    {getEditableStatusesForOrder(order).map(status => (
                                        <option key={status} value={status}>{statusTranslations[status] || status}</option>
                                    ))}
                                </>
                            ) : (
                                (getEditableStatusesForOrder(order).length > 0 ? getEditableStatusesForOrder(order) : [order.status]).map(status => (
                                    <option key={status} value={status}>{statusTranslations[status] || status}</option>
                                ))
                            )}
                        </select>
                    </div>

                    {isInStoreOrder(order) && order.status === 'pending' && canMarkPaid && (
                        <div className="col-span-2 space-y-2">
                            {String((order as any)?.inStoreFailureReason || (order as any)?.data?.inStoreFailureReason || '').trim() && (
                                <div className="text-[11px] text-gray-600 dark:text-gray-300">
                                    سبب التعليق: {String((order as any)?.inStoreFailureReason || (order as any)?.data?.inStoreFailureReason || '').trim()}
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={() => void attemptResumeInStorePending(order)}
                                disabled={resumePendingBusyId === order.id}
                                className="w-full py-2 bg-emerald-700 text-white rounded-md hover:bg-emerald-800 transition text-sm font-bold disabled:opacity-60"
                            >
                                {resumePendingBusyId === order.id ? 'جاري الإتمام...' : 'إعادة محاولة الإتمام'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setEditOrderId(order.id)}
                                className="w-full py-2 bg-gray-700 text-white rounded-md hover:bg-gray-800 transition text-sm font-bold"
                            >
                                تعديل الأصناف
                            </button>
                            <button
                                type="button"
                                onClick={async () => {
                                    if (!canCancel) return;
                                    try {
                                        await cancelInStorePendingOrder(order.id);
                                        showNotification('تم حذف الطلب المعلّق.', 'success');
                                        try { await fetchOrders(); } catch { }
                                    } catch (e: any) {
                                        showNotification(String(e?.message || 'تعذر حذف الطلب المعلّق.'), 'error');
                                    }
                                }}
                                disabled={!canCancel || resumePendingBusyId === order.id}
                                className="w-full py-2 bg-red-700 text-white rounded-md hover:bg-red-800 transition text-sm font-bold disabled:opacity-60"
                            >
                                حذف الطلب المعلّق
                            </button>
                        </div>
                    )}

                    {/* Delivery Accept Button */}
                    {isDeliveryOnly && !isInStoreOrder(order) && order.assignedDeliveryUserId === adminUser?.id && !order.deliveryAcceptedAt && order.status !== 'delivered' && order.status !== 'cancelled' && (
                        <button
                            type="button"
                            onClick={() => handleAcceptDelivery(order.id)}
                            className="col-span-2 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition text-sm font-bold shadow-sm"
                        >
                            {language === 'ar' ? '✅ قبول المهمة' : 'Accept Job'}
                        </button>
                    )}

                    {/* Delivery Assignment (Admin only) */}
                    {canAssignDelivery && !isInStoreOrder(order) && (
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

                    {order.status === 'delivered' && remaining > 1e-9 && !isVoided && String((order as any).returnStatus || '').toLowerCase() !== 'full' && (
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

                    {order.status === 'delivered' && (paid > tol || isCreditSale || Boolean((order as any)?.paidAt || (order as any)?.data?.paidAt)) && canRequestPurge && !isVoided && (
                        <div className="col-span-2">
                            {pendingPurgeByOrderId[order.id] ? (
                                <div className="space-y-2">
                                    <div className="text-xs p-2 rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 text-amber-800 dark:text-amber-200">
                                        طلب عكس قائم #{pendingPurgeByOrderId[order.id].id.slice(-6).toUpperCase()}
                                    </div>
                                    {currentAdminAuthId && pendingPurgeByOrderId[order.id].requested_by !== currentAdminAuthId && (
                                        <button
                                            onClick={() => { setApprovePurgeRequestId(pendingPurgeByOrderId[order.id].id); setPurgeApprovalNote(''); }}
                                            disabled={isApprovingPurge}
                                            className="w-full py-2 bg-indigo-700 text-white rounded hover:bg-indigo-800 transition text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            اعتماد الطلب وتنفيذ العكس
                                        </button>
                                    )}
                                </div>
                            ) : (
                            <button
                                onClick={() => handlePurgePayment(order.id)}
                                disabled={isPurgingPayment}
                                className="w-full py-2 bg-red-700 text-white rounded hover:bg-red-800 transition text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                تنظيف دفعة طارئ
                            </button>
                            )}
                        </div>
                    )}

                    {/* Quotation Actions */}
                    {Boolean((order as any).isDraft) && (
                        <div className="col-span-2 flex gap-2">
                            <button
                                type="button"
                                onClick={() => printQuotation(order)}
                                className="flex-1 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition text-sm font-semibold"
                            >
                                طباعة عرض السعر
                            </button>
                            <button
                                type="button"
                                onClick={() => loadQuotationToCart(order)}
                                className="flex-1 py-2 bg-amber-500 text-white rounded hover:bg-amber-600 transition text-sm font-semibold text-gray-900"
                            >
                                اعتماد الفاتورة
                            </button>
                        </div>
                    )}

                    {/* Invoice View */}
                    {order.invoiceIssuedAt && canViewInvoice && !Boolean((order as any).isDraft) && (
                        <button
                            onClick={() => navigate(`/admin/invoice/${order.id}`)}
                            className="col-span-2 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm font-semibold"
                        >
                            📄 عرض الفاتورة
                        </button>
                    )}

                    {canViewAccounting && order.paymentMethod === 'cash' && !isInStoreOrder(order) && Boolean(order.deliveryZoneId) && (
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
                                    setRefundMethod(detectRefundMethod(order));
                                }}
                                disabled={String((order as any).returnStatus || '').toLowerCase() === 'full'}
                                className="flex-1 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                ↩️ استرجاع
                            </button>
                        </div>
                    )}

                    {order.status === 'delivered' && canVoidDelivered && !isVoided && String((order as any).returnStatus || '').toLowerCase() !== 'full' && (
                        <button
                            type="button"
                            onClick={() => {
                                setVoidOrderId(order.id);
                                setVoidReason('');
                            }}
                            className="col-span-2 py-2 bg-purple-700 text-white rounded hover:bg-purple-800 transition text-sm font-semibold"
                        >
                            🧾 إلغاء بعد التسليم (عكس)
                        </button>
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

    const printQuotation = async (order: Order) => {
        const fallbackBrand = {
            name: (settings.cafeteriaName?.[language] || settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '').trim(),
            address: (settings.address || '').trim(),
            contactNumber: (settings.contactNumber || '').trim(),
            logoUrl: (settings.logoUrl || '').trim(),
        };
        let printNumber = 1;
        try {
            const supabase = getSupabaseClient();
            if (supabase) {
                const { data: pn } = await supabase.rpc('track_document_print', { p_source_table: 'orders', p_source_id: order.id, p_template: 'PrintableQuotation' });
                printNumber = Number(pn) || 1;
            }
        } catch { /* fallback */ }
        const componentStr = renderToString(
            <PrintableQuotation
                order={order}
                brand={fallbackBrand}
                language={language as 'ar' | 'en'}
                externalCustomerName={order.customerName}
                externalCustomerPhone={order.phoneNumber}
                printNumber={printNumber}
            />
        );
        printContent(componentStr, `Quotation - ${order.id.slice(-6).toUpperCase()}`);
    };

    const handlePrintOrdersList = () => {
        const componentStr = renderToString(
            <div dir="rtl" style={{ padding: '20px', fontFamily: 'sans-serif' }}>
                <h1 style={{ textAlign: 'center', marginBottom: '20px' }}>تقرير الطلبات</h1>
                <div style={{ marginBottom: '10px' }}>
                    <strong>إجمالي الطلبات:</strong> {filteredAndSortedOrders.length}
                </div>
                {Object.keys(totalsByCurrency).length > 0 && (
                    <div style={{ marginBottom: '20px' }}>
                        <strong>المجاميع حسب العملة:</strong>
                        <ul style={{ listStyleType: 'none', padding: 0 }}>
                            {Object.entries(totalsByCurrency).map(([currency, total]) => (
                                <li key={currency}>
                                    {formatMoneyByCode(total, currency)} {currency}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
                    <thead>
                        <tr style={{ backgroundColor: '#f3f4f6' }}>
                            <th style={{ border: '1px solid #d1d5db', padding: '8px', textAlign: 'right' }}>رقم الطلب</th>
                            <th style={{ border: '1px solid #d1d5db', padding: '8px', textAlign: 'right' }}>التاريخ</th>
                            <th style={{ border: '1px solid #d1d5db', padding: '8px', textAlign: 'right' }}>العميل</th>
                            <th style={{ border: '1px solid #d1d5db', padding: '8px', textAlign: 'right' }}>الإجمالي</th>
                            <th style={{ border: '1px solid #d1d5db', padding: '8px', textAlign: 'right' }}>الحالة</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredAndSortedOrders.map(order => {
                            const currency = String((order as any).currency || baseCode).toUpperCase();
                            return (
                                <tr key={order.id}>
                                    <td style={{ border: '1px solid #d1d5db', padding: '8px' }}>#{order.id.slice(-6).toUpperCase()}</td>
                                    <td style={{ border: '1px solid #d1d5db', padding: '8px' }}>{new Date(order.createdAt).toLocaleDateString('ar-EG-u-nu-latn')}</td>
                                    <td style={{ border: '1px solid #d1d5db', padding: '8px' }}>{order.customerName || order.phoneNumber}</td>
                                    <td style={{ border: '1px solid #d1d5db', padding: '8px' }} dir="ltr">{formatMoneyByCode(order.total, currency)} {currency}</td>
                                    <td style={{ border: '1px solid #d1d5db', padding: '8px' }}>{statusTranslations[order.status] || order.status}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
        printContent(componentStr, 'Orders-Report');
    };


    const loadQuotationToCart = (order: Order) => {
        if (!assertMutableOrdersView()) return;
        const lines = (order.items || []).map((item: any) => ({
            menuItemId: String(item.id || item.menuItemId || ''),
            quantity: Number(item.quantity) || 1,
            weight: Number(item.weight) || undefined,
            selectedAddons: item.selectedAddons || {},
            uomCode: item.uomCode,
            uomQtyInBase: item.uomQtyInBase,
            warehouseId: (order as any).warehouseId || sessionScope.scope?.warehouseId || ''
        }));
        setInStoreLines(lines);
        setInStoreCustomerName(order.customerName || '');
        setInStorePhoneNumber(order.phoneNumber || '');
        setInStoreCustomerMode('walk_in');
        setInStoreNotes(`محول من عرض السعر #${order.id.slice(-6).toUpperCase()}\n${order.notes || ''}`.trim());
        setInStoreInvoiceStatement(String((order as any).invoiceStatement || '').trim());
        const quotationCurrency = String((order as any).currency || '').trim().toUpperCase();
        if (quotationCurrency && operationalCurrencies.includes(quotationCurrency)) {
            setInStoreTransactionCurrency(quotationCurrency);
        }
        setIsInStoreSaleOpen(true);
    };
    const openNewInStoreSale = () => {
        if (!assertMutableOrdersView()) return;
        const base = String(baseCode || '').trim().toUpperCase();
        const preferred = base && operationalCurrencies.includes(base)
            ? base
            : (operationalCurrencies[0] || base || '');
        if (preferred) setInStoreTransactionCurrency(preferred);
        setIsInStoreSaleOpen(true);
    };
    const openNewInStoreSaleRef = useRef<(() => void) | null>(null);
    openNewInStoreSaleRef.current = openNewInStoreSale;
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || String(e.key || '').toLowerCase() !== 'n') return;
            const target = e.target as HTMLElement | null;
            const tag = String(target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
            if (!canCreateInStoreSale || isReadOnlyOrdersView) return;
            e.preventDefault();
            e.stopPropagation();
            openNewInStoreSaleRef.current?.();
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [canCreateInStoreSale, isReadOnlyOrdersView]);

    return (
        <div className="animate-fade-in">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <div className="flex flex-col gap-2">
                    <h1 className="text-3xl font-bold dark:text-white">
                        إدارة الطلبات
                        <span className="text-lg font-normal text-gray-500 dark:text-gray-400 mr-2">
                            ({filteredAndSortedOrders.length}{totalOrderCount !== null && totalOrderCount > filteredAndSortedOrders.length ? ` من ${totalOrderCount}` : ''})
                        </span>
                    </h1>
                    {Object.keys(totalsByCurrency).length > 0 && typeof formatMoneyByCode === 'function' && (
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(totalsByCurrency).map(([currency, total]) => (
                                <span key={currency} className="px-3 py-1 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 rounded-md text-sm font-bold border border-emerald-200 dark:border-emerald-800 shadow-sm flex items-center gap-1">
                                    <span>الإجمالي:</span>
                                    <span className="font-mono mx-1" dir="ltr">{formatMoneyByCode(total, currency)}</span>
                                    <span>{currency}</span>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                    <button
                        type="button"
                        onClick={handlePrintOrdersList}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition text-sm font-semibold flex items-center gap-2"
                        title={language === 'ar' ? 'طباعة / حفظ PDF' : 'Print / Save PDF'}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                        <span>{language === 'ar' ? 'طباعة / تصدير PDF' : 'Print / PDF'}</span>
                    </button>
                    {canCreateInStoreSale && (
                        <div className="flex flex-col gap-1">
                            <button
                                type="button"
                                onClick={openNewInStoreSale}
                                disabled={isReadOnlyOrdersView}
                                title={isReadOnlyOrdersView ? (language === 'ar' ? `الزر معطل في هذا العرض. غيّر فلتر المستودع إلى: ${scopeWarehouseName}` : `Disabled in current view. Switch warehouse filter to: ${scopeWarehouseName}`) : (language === 'ar' ? 'إنشاء بيع حضوري سريع' : 'Create quick in-store sale')}
                                className={`px-5 py-2.5 rounded-md transition text-sm font-semibold inline-flex items-center gap-2 ${isReadOnlyOrdersView ? 'bg-gray-300 text-gray-600 dark:bg-gray-700 dark:text-gray-300 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'}`}
                            >
                                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" /></svg>
                                <span>{language === 'ar' ? 'إضافة بيع حضوري' : 'New in-store sale'}</span>
                                {!isReadOnlyOrdersView && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/20">Ctrl+Shift+N</span>}
                            </button>
                            {isReadOnlyOrdersView && (
                                <span className="text-[11px] text-amber-700 dark:text-amber-300">
                                    {language === 'ar'
                                        ? `لتفعيل الزر: اعرض طلبات مستودع الجلسة (${scopeWarehouseName}).`
                                        : `To enable: switch to session warehouse view (${scopeWarehouseName}).`}
                                </span>
                            )}
                            {!isReadOnlyOrdersView && (
                                <span className="text-[11px] text-emerald-700 dark:text-emerald-300">
                                    {language === 'ar' ? 'الأكثر استخدامًا — اختصار سريع: Ctrl+Shift+N' : 'Most used — Quick shortcut: Ctrl+Shift+N'}
                                </span>
                            )}
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <label htmlFor="customerNameFilter" className="text-sm font-medium dark:text-gray-300 mx-2">بحث ذكي:</label>
                        <input
                            id="customerNameFilter"
                            value={customerNameFilter}
                            onChange={(e) => setCustomerNameFilter(e.target.value)}
                            placeholder="الاسم، الهاتف، رقم الطلب، أو Trace..."
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition text-sm w-56"
                        />
                        {customerNameFilter.trim() && (
                            <button
                                type="button"
                                onClick={() => setCustomerNameFilter('')}
                                className="px-3 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-sm font-semibold"
                            >
                                مسح
                            </button>
                        )}
                    </div>
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
                            onChange={(e) => setFilterStatus(e.target.value as OrderStatus | 'all' | 'delivered_no_returns')}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition text-sm"
                        >
                            <option value="all">الكل</option>
                            <option value="delivered_no_returns">تم التوصيل (صافي بدون المسترجع والملغي)</option>
                            {filterStatusOptions.map(status => (
                                <option key={status} value={status}>{statusTranslations[status] || status}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium dark:text-gray-300">من:</label>
                        <input
                            type="date"
                            value={filterDateFrom}
                            onChange={(e) => setFilterDateFrom(e.target.value)}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition text-sm"
                        />
                        <label className="text-sm font-medium dark:text-gray-300">إلى:</label>
                        <input
                            type="date"
                            value={filterDateTo}
                            onChange={(e) => setFilterDateTo(e.target.value)}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition text-sm"
                        />
                        {(filterDateFrom || filterDateTo) && (
                            <button
                                type="button"
                                onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); }}
                                className="px-3 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-sm font-semibold"
                            >
                                مسح
                            </button>
                        )}
                    </div>
                    <div>
                        <label htmlFor="paymentFilter" className="text-sm font-medium dark:text-gray-300 mx-1">طريقة الدفع:</label>
                        <select
                            id="paymentFilter"
                            value={filterPaymentMethod}
                            onChange={(e) => setFilterPaymentMethod(e.target.value)}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition text-sm"
                        >
                            <option value="all">الكل</option>
                            <option value="cash">نقداً</option>
                            <option value="ar">آجل</option>
                            <option value="network">حوالة/بنك</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="shiftFilter" className="text-sm font-medium dark:text-gray-300 mx-1">الوردية:</label>
                        <select
                            id="shiftFilter"
                            value={filterShiftId}
                            onChange={(e) => setFilterShiftId(e.target.value)}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition text-sm"
                        >
                            <option value="all">الكل</option>
                            {recentShifts.map(shift => {
                                const name = adminUserMap[shift.cashier_id] || shift.cashier_id.slice(0, 6);
                                const d = new Date(shift.opened_at);
                                const dateStr = `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
                                return (
                                    <option key={shift.id} value={shift.id}>
                                        {name} - {dateStr}
                                    </option>
                                );
                            })}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="currencyFilter" className="text-sm font-medium dark:text-gray-300 mx-1">العملة:</label>
                        <select
                            id="currencyFilter"
                            value={filterCurrency}
                            onChange={(e) => setFilterCurrency(e.target.value)}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition text-sm"
                        >
                            <option value="all">الكل</option>
                            <option value={baseCode.toUpperCase()}>{baseCode.toUpperCase()}</option>
                            {currencyOptions.filter(c => c.toUpperCase() !== baseCode.toUpperCase()).map(c => (
                                <option key={c} value={c.toUpperCase()}>{c.toUpperCase()}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <label htmlFor="returnsOnly" className="text-sm font-medium dark:text-gray-300">المرتجعات فقط:</label>
                        <input
                            id="returnsOnly"
                            type="checkbox"
                            checked={returnsOnly}
                            onChange={(e) => setReturnsOnly(e.target.checked)}
                            className="h-4 w-4"
                        />
                        {returnsOnly && (
                            <button
                                type="button"
                                onClick={() => setReturnsOnly(false)}
                                className="px-3 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-sm font-semibold"
                            >
                                مسح
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <label htmlFor="autoCandidatesOnly" className="text-sm font-medium dark:text-gray-300">المرشح تلقائيًا فقط:</label>
                        <input
                            id="autoCandidatesOnly"
                            type="checkbox"
                            checked={autoCandidatesOnly}
                            onChange={(e) => setAutoCandidatesOnly(e.target.checked)}
                            className="h-4 w-4"
                        />
                        {autoCandidatesOnly && (
                            <button
                                type="button"
                                onClick={() => setAutoCandidatesOnly(false)}
                                className="px-3 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-sm font-semibold"
                            >
                                مسح
                            </button>
                        )}
                    </div>
                    <div>
                        <label htmlFor="warehouseViewFilter" className="text-sm font-medium dark:text-gray-300 mx-1">نطاق المستودع:</label>
                        <select
                            id="warehouseViewFilter"
                            value={filterWarehouseView}
                            onChange={(e) => setFilterWarehouseView(String(e.target.value || ''))}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition text-sm"
                        >
                            <option value="">المستودع النشط للجلسة</option>
                            <option value="all">كل المستودعات (قراءة فقط)</option>
                            {warehouses.map((w: any) => (
                                <option key={String(w.id)} value={String(w.id)}>
                                    {String(w.name || w.code || w.id)}
                                </option>
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
            {isReadOnlyOrdersView && (
                <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                    وضع عرض فقط — النطاق الحالي: <span className="font-bold">{effectiveWarehouseViewName}</span>، بينما المستودع النشط للجلسة: <span className="font-bold">{scopeWarehouseName}</span>. عمليات التعديل معطلة حتى تعود إلى "المستودع النشط للجلسة".
                </div>
            )}
            {canCreateInStoreSale && !isReadOnlyOrdersView && (
                <button
                    type="button"
                    onClick={openNewInStoreSale}
                    title={language === 'ar' ? 'بيع حضوري سريع (Ctrl+Shift+N)' : 'Quick in-store sale (Ctrl+Shift+N)'}
                    className="fixed z-40 bottom-5 left-5 px-4 py-3 rounded-full shadow-lg bg-emerald-600 text-white hover:bg-emerald-700 font-bold text-sm inline-flex items-center gap-2"
                >
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" /></svg>
                    <span>{language === 'ar' ? 'بيع حضوري سريع' : 'Quick Sale'}</span>
                </button>
            )}

            {canRequestPurge && (
                <div className="mb-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-bold text-gray-800 dark:text-gray-100">مركز التحكم السريع لعكس دفعات الطلبات</div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => void loadPurgeDashboard()}
                                disabled={purgeDashboardLoading || isBulkPurgeBusy}
                                className="px-3 py-1 rounded bg-gray-700 text-white text-xs font-semibold disabled:opacity-60"
                            >
                                تحديث
                            </button>
                            <button
                                type="button"
                                onClick={() => void executeBulkApprovePurge()}
                                disabled={isBulkPurgeBusy || isReadOnlyOrdersView}
                                className="px-3 py-1 rounded bg-indigo-700 text-white text-xs font-semibold disabled:opacity-60"
                            >
                                اعتماد جماعي قابل للتنفيذ
                            </button>
                            <button
                                type="button"
                                onClick={fillAutoPurgeCandidates}
                                disabled={isBulkPurgeBusy || autoCandidateScanBusy || isReadOnlyOrdersView}
                                className="px-3 py-1 rounded bg-emerald-700 text-white text-xs font-semibold disabled:opacity-60"
                            >
                                إحضار الطلبات المرشحة تلقائياً
                            </button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <div className="md:col-span-1">
                            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">ملاحظة الاعتماد الجماعي</label>
                            <input
                                value={bulkApproveNote}
                                onChange={(e) => setBulkApproveNote(e.target.value)}
                                disabled={isReadOnlyOrdersView}
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-sm"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">طلبات عكس معلّقة (آخر 50 طلب)</label>
                            <div className="max-h-36 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-2 space-y-1">
                                {purgeDashboardLoading ? (
                                    <div className="text-xs text-gray-500">جاري التحميل...</div>
                                ) : purgeDashboardRows.length === 0 ? (
                                    <div className="text-xs text-gray-500">لا توجد طلبات معلقة.</div>
                                ) : (
                                    purgeDashboardRows.map((r) => (
                                        <div key={r.id} className="flex items-center justify-between gap-2 text-xs border-b border-gray-100 dark:border-gray-700 pb-1">
                                            <div className="truncate">
                                                #{r.id.slice(-6).toUpperCase()} • طلب {r.order_id.slice(-6).toUpperCase()} • {new Date(r.requested_at).toLocaleString('ar-EG-u-nu-latn')}
                                            </div>
                                            {(!currentAdminAuthId || r.requested_by !== currentAdminAuthId) ? (
                                                <button
                                                    type="button"
                                                    onClick={() => { setApprovePurgeRequestId(r.id); setPurgeApprovalNote(bulkApproveNote); }}
                                                    className="px-2 py-1 rounded bg-indigo-600 text-white text-[11px] font-semibold"
                                                >
                                                    اعتماد
                                                </button>
                                            ) : (
                                                <span className="text-[11px] text-amber-700 dark:text-amber-300">بانتظار مستخدم ثانٍ</span>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                        <div className="md:col-span-2">
                            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">أرقام الطلبات (مفصولة بمسافة أو فاصلة)</label>
                            <textarea
                                value={bulkOrderIdsInput}
                                onChange={(e) => setBulkOrderIdsInput(e.target.value)}
                                disabled={isReadOnlyOrdersView}
                                className="w-full h-20 p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-xs font-mono"
                                placeholder="A1B2C3, D4E5F6, G7H8I9"
                            />
                            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                                أدخل أرقام الطلبات المختصرة (مثل A1B2C3) كما تظهر في الجدول، أو استخدم زر "إحضار الطلبات المرشحة تلقائياً".
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">تصنيف السبب</label>
                            <select
                                value={bulkRequestCategory}
                                onChange={(e) => setBulkRequestCategory(e.target.value)}
                                disabled={isReadOnlyOrdersView}
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-sm"
                            >
                                <option value="misapplied_payment">دفعة مسجلة على الطلب الخطأ</option>
                                <option value="duplicate_settlement">تسوية مكررة</option>
                                <option value="fraud_risk">اشتباه احتيال/مخاطر</option>
                                <option value="compliance_correction">تصحيح امتثال وتدقيق</option>
                                <option value="other">أخرى</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">سبب موحد (20+ حرف)</label>
                            <input
                                value={bulkRequestReason}
                                onChange={(e) => setBulkRequestReason(e.target.value)}
                                disabled={isReadOnlyOrdersView}
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-sm"
                            />
                            <button
                                type="button"
                                onClick={() => void executeBulkRequestPurge()}
                                disabled={isBulkPurgeBusy || isReadOnlyOrdersView}
                                className="mt-2 w-full px-3 py-2 rounded bg-red-700 text-white text-xs font-semibold disabled:opacity-60"
                            >
                                إنشاء طلبات جماعية
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="hidden md:block bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r dark:border-gray-700">رقم الطلب</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r dark:border-gray-700">المرتجع</th>
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
                                    <td colSpan={8} className="text-center py-10 text-gray-500 dark:text-gray-400">
                                        <div className="flex justify-center items-center space-x-2 rtl:space-x-reverse">
                                            <Spinner />
                                            <span>جاري تحميل الطلبات...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredAndSortedOrders.length > 0 ? (
                                filteredAndSortedOrders.map(order => {
                                    const returnStatus = getReturnStatus(order);
                                    const isVoidedDesktop = Boolean((order as any)?.voidedAt || (order as any)?.data?.voidedAt);
                                    const isDraft = Boolean((order as any).isDraft);
                                    const rowClass =
                                        order.id === highlightedOrderId
                                            ? 'bg-yellow-50 dark:bg-yellow-900/20'
                                            : isVoidedDesktop
                                                ? 'bg-purple-50/70 dark:bg-purple-900/10'
                                                : isDraft
                                                    ? 'bg-indigo-50/70 dark:bg-indigo-900/10'
                                                    : returnStatus === 'full'
                                                        ? 'bg-red-50/70 dark:bg-red-900/10'
                                                        : returnStatus === 'partial'
                                                            ? 'bg-amber-50/70 dark:bg-amber-900/10'
                                                            : undefined;
                                    return (
                                        <tr key={order.id} data-order-id={order.id} className={rowClass}>
                                            <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                                <div className="text-sm font-bold text-gray-900 dark:text-white">#{order.id.slice(-6).toUpperCase()}</div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{new Date(order.createdAt).toLocaleDateString('ar-EG-u-nu-latn')}</div>
                                                {getOrderTraceId(order) && (
                                                    <div className="mt-1 flex items-center gap-2">
                                                        <div className="text-[11px] text-cyan-700 dark:text-cyan-300 font-mono break-all" dir="ltr">
                                                            Trace: {getOrderTraceId(order)}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => void copyTraceId(getOrderTraceId(order))}
                                                            className="px-2 py-0.5 rounded bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200 text-[10px] font-bold"
                                                        >
                                                            نسخ
                                                        </button>
                                                    </div>
                                                )}
                                                {getOrderFailureReason(order) && (
                                                    <div className="text-[11px] text-red-600 dark:text-red-400 mt-1 break-words">
                                                        سبب التعثر: {getOrderFailureReason(order)}
                                                    </div>
                                                )}
                                                {order.isScheduled && order.scheduledAt && (
                                                    <div className="text-xs text-purple-600 dark:text-purple-400 mt-1 font-semibold" title={new Date(order.scheduledAt).toLocaleString('ar-EG-u-nu-latn')}>
                                                        مجدول لـ: <span dir="ltr">{new Date(order.scheduledAt).toLocaleTimeString('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700 align-top">
                                                <div className="flex items-center justify-start min-h-[24px]">
                                                    {renderReturnBadge(order, 'pill') || (
                                                        <span className="text-xs text-gray-400">—</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                                <div className="text-sm font-medium text-gray-900 dark:text-white">{order.customerName}</div>
                                                <div className="text-sm text-gray-500 dark:text-gray-400" dir="ltr">{order.phoneNumber}</div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400 max-w-xs truncate" title={order.address}>{order.address}</div>
                                                {order.deliveryZoneId && !isInStoreOrder(order) && (
                                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-xs truncate" title={getDeliveryZoneById(order.deliveryZoneId)?.name['ar'] || order.deliveryZoneId}>
                                                        منطقة التوصيل: {getDeliveryZoneById(order.deliveryZoneId)?.name['ar'] || order.deliveryZoneId.slice(-6).toUpperCase()}
                                                    </div>
                                                )}
                                                {(() => {
                                                    const isCod = order.paymentMethod === 'cash' && !isInStoreOrder(order) && Boolean(order.deliveryZoneId);
                                                    if (!isCod) return null;
                                                    const driverId = String(order.deliveredBy || order.assignedDeliveryUserId || '');
                                                    const bal = driverId ? (Number(driverCashByDriverId[driverId]) || 0) : 0;
                                                    if (bal <= 0.01) return null;
                                                    return (
                                                        <div className="mt-1">
                                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                                                                نقد لدى المندوب: <span className="font-mono ms-1" dir="ltr">{bal.toFixed(2)} {baseCode || '—'}</span>
                                                            </span>
                                                        </div>
                                                    );
                                                })()}
                                                {order.location && !isInStoreOrder(order) && (
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
                                                    {(order.items || []).map((item: CartItem, idx: number) => {
                                                        const selectedAddonsRaw = (item as any)?.selectedAddons;
                                                        const selectedAddonsObj =
                                                            selectedAddonsRaw && typeof selectedAddonsRaw === 'object' ? selectedAddonsRaw : {};
                                                        const addonsArray = Object.values(selectedAddonsObj as Record<string, any>);
                                                        const itemName = String(
                                                            (item as any)?.name?.[language] ||
                                                            (item as any)?.name?.ar ||
                                                            (item as any)?.name?.en ||
                                                            (item as any)?.name ||
                                                            (item as any)?.itemName ||
                                                            (item as any)?.id ||
                                                            (item as any)?.itemId ||
                                                            ''
                                                        );
                                                        const key =
                                                            item.cartItemId ||
                                                            (item as any).id ||
                                                            `${(item as any).menuItemId || 'item'}-${idx}`;
                                                        return (
                                                            <li key={key}>
                                                                <span className="font-semibold">{itemName || 'منتج'} x{Number((item as any)?.quantity || 0)}</span>
                                                                {addonsArray.length > 0 && (
                                                                    <div className="text-xs text-gray-500 dark:text-gray-400 pl-2 rtl:pr-2">
                                                                        {addonsArray
                                                                            .map((entry: any) => {
                                                                                const addon = entry?.addon || entry;
                                                                                const addonName =
                                                                                    addon?.name?.[language] ||
                                                                                    addon?.name?.ar ||
                                                                                    addon?.name?.en ||
                                                                                    addon?.name ||
                                                                                    addon?.title ||
                                                                                    '';
                                                                                return addonName ? `+ ${String(addonName)}` : '';
                                                                            })
                                                                            .filter(Boolean)
                                                                            .join(', ')}
                                                                    </div>
                                                                )}
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                                <CurrencyDualAmount
                                                    amount={Number(order.total || 0)}
                                                    currencyCode={(order as any).currency}
                                                    baseAmount={(order as any).baseTotal}
                                                    fxRate={(order as any).fxRate}
                                                    baseCurrencyCode={baseCode}
                                                    compact
                                                />
                                                {order.discountAmount && order.discountAmount > 0 && <div className="text-xs text-green-600 dark:text-green-400 line-through" dir="ltr">{Number(order.subtotal + order.deliveryFee).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
                                                {(() => {
                                                    const { currency, paid, remaining, tol } = getOrderPaymentSnapshot(order);
                                                    return (
                                                        <div className="mt-1 space-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                                                            <div>مدفوع: <span className="font-mono" dir="ltr">{formatMoneyByCode(paid || 0, currency)} {currency || '—'}</span></div>
                                                            <div>متبقي: <span className="font-mono" dir="ltr">{formatMoneyByCode(remaining || 0, currency)} {currency || '—'}</span></div>
                                                            {remaining > tol && order.status !== 'delivered' && (
                                                                <div>
                                                                    <span className="px-2 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                                                                        بانتظار التحصيل
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300 border-r dark:border-gray-700">{paymentTranslations[order.paymentMethod] || order.paymentMethod}</td>
                                            <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                                {(() => {
                                                    const { remaining, tol } = getOrderPaymentSnapshot(order);
                                                    const isFullyReturned = String((order as any).returnStatus || '').toLowerCase() === 'full';
                                                    const isVoidedTbl = Boolean((order as any)?.voidedAt || (order as any)?.data?.voidedAt);
                                                    const showPaymentActions = order.status === 'delivered' && remaining > tol && !isFullyReturned && !isVoidedTbl;

                                                    const paymentActions = showPaymentActions ? (
                                                        <div className="flex flex-col gap-2">
                                                            <button
                                                                onClick={() => openPartialPaymentModal(order.id)}
                                                                disabled={!canMarkPaid || isReadOnlyOrdersView}
                                                                className="px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition text-sm disabled:opacity-60"
                                                            >
                                                                تحصيل جزئي
                                                            </button>
                                                            <button
                                                                onClick={() => handleMarkPaid(order.id)}
                                                                disabled={!canMarkPaid || isReadOnlyOrdersView}
                                                                className="px-3 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 transition text-sm disabled:opacity-60"
                                                            >
                                                                {order.paymentMethod === 'cash' ? 'تأكيد التحصيل' : 'تأكيد الدفع'}
                                                            </button>
                                                        </div>
                                                    ) : null;

                                                    const hasPaidAtTbl = Boolean((order as any)?.paidAt || (order as any)?.data?.paidAt);
                                                    const { paid: paidTbl, tol: tolTbl, isCreditSale: isCreditSaleTbl } = getOrderPaymentSnapshot(order);
                                                    const purgeAction = order.status === 'delivered' && (paidTbl > tolTbl || isCreditSaleTbl || hasPaidAtTbl) && canRequestPurge && !isVoidedTbl ? (
                                                        pendingPurgeByOrderId[order.id] ? (
                                                            <div className="flex flex-col gap-2">
                                                                <div className="text-[11px] px-2 py-1 rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 text-amber-800 dark:text-amber-200">
                                                                    طلب قائم #{pendingPurgeByOrderId[order.id].id.slice(-6).toUpperCase()}
                                                                </div>
                                                                {currentAdminAuthId && pendingPurgeByOrderId[order.id].requested_by !== currentAdminAuthId && (
                                                                    <button
                                                                        onClick={() => { setApprovePurgeRequestId(pendingPurgeByOrderId[order.id].id); setPurgeApprovalNote(''); }}
                                                                        disabled={isApprovingPurge}
                                                                        className="px-3 py-1 bg-indigo-700 text-white rounded hover:bg-indigo-800 transition text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                                                    >
                                                                        اعتماد وتنفيذ
                                                                    </button>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => handlePurgePayment(order.id)}
                                                                disabled={isPurgingPayment || isReadOnlyOrdersView}
                                                                className="px-3 py-1 bg-red-700 text-white rounded hover:bg-red-800 transition text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                تنظيف دفعة طارئ
                                                            </button>
                                                        )
                                                    ) : null;

                                                    if (Boolean((order as any).isDraft)) {
                                                        return (
                                                            <div className="flex flex-col gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => printQuotation(order)}
                                                                    className="px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition text-xs font-semibold"
                                                                >
                                                                    طباعة عرض السعر
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => loadQuotationToCart(order)}
                                                                    className="px-3 py-1 bg-amber-500 text-white rounded hover:bg-amber-600 transition text-xs font-semibold text-gray-900"
                                                                >
                                                                    اعتماد كفاتورة
                                                                </button>
                                                            </div>
                                                        );
                                                    }

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
                                                                {!isInStoreOrder(order) && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handlePrintDeliveryNote(order)}
                                                                        className="px-3 py-1 bg-gray-800 text-white rounded hover:bg-gray-900 transition text-xs font-semibold"
                                                                    >
                                                                        طباعة سند تسليم
                                                                    </button>
                                                                )}
                                                                {canViewAccounting && getOrderPaymentSnapshot(order).paid > 0 && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => { void handlePrintReceiptVoucher(order); }}
                                                                        className="px-3 py-1 bg-gray-900 text-white rounded hover:bg-black transition text-xs font-semibold"
                                                                    >
                                                                        طباعة سند قبض
                                                                    </button>
                                                                )}
                                                                {paymentActions}
                                                                {purgeAction}
                                                            </div>
                                                        );
                                                    }

                                                    if (order.status === 'delivered') {
                                                        const isCod = order.paymentMethod === 'cash' && !isInStoreOrder(order) && Boolean(order.deliveryZoneId);
                                                        const { paid, total, tol, isCreditSale } = getOrderPaymentSnapshot(order);
                                                        const isPaid = total > 0 && (paid + tol) >= total;
                                                        const canIssueInvoice = !isCod && (isPaid || isCreditSale) && canManageAccounting;
                                                        return (
                                                            <div className="flex flex-col gap-2">
                                                                {canIssueInvoice && (
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="text-xs text-gray-500 dark:text-gray-400">جاري إصدار الفاتورة...</div>
                                                                        <button
                                                                            onClick={() => {
                                                                                const g = guardPosting();
                                                                                if (!g.ok) {
                                                                                    showNotification(g.reason || 'لا تملك صلاحية إصدار الفاتورة.', 'error');
                                                                                    return;
                                                                                }
                                                                                issueInvoiceNow(order.id);
                                                                            }}
                                                                            className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-xs"
                                                                        >
                                                                            إصدار الآن
                                                                        </button>
                                                                    </div>
                                                                )}
                                                                {!isInStoreOrder(order) && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handlePrintDeliveryNote(order)}
                                                                        className="px-3 py-1 bg-gray-800 text-white rounded hover:bg-gray-900 transition text-xs font-semibold"
                                                                    >
                                                                        طباعة سند تسليم
                                                                    </button>
                                                                )}
                                                                {paymentActions}
                                                                {purgeAction}
                                                            </div>
                                                        );
                                                    }

                                                    if (isInStoreOrder(order) && order.status === 'pending' && canMarkPaid) {
                                                        const reason = String((order as any)?.inStoreFailureReason || (order as any)?.data?.inStoreFailureReason || '').trim();
                                                        return (
                                                            <div className="flex flex-col gap-2">
                                                                {reason && (
                                                                    <div className="text-[11px] text-gray-600 dark:text-gray-300">
                                                                        سبب التعليق: {reason}
                                                                    </div>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void attemptResumeInStorePending(order)}
                                                                    disabled={resumePendingBusyId === order.id}
                                                                    className="px-3 py-1 bg-emerald-700 text-white rounded hover:bg-emerald-800 transition text-xs font-semibold disabled:opacity-60"
                                                                >
                                                                    {resumePendingBusyId === order.id ? 'جاري الإتمام...' : 'إعادة محاولة الإتمام'}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setEditOrderId(order.id)}
                                                                    className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-800 transition text-xs font-semibold"
                                                                >
                                                                    تعديل الأصناف
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={async () => {
                                                                        if (!canCancel) return;
                                                                        try {
                                                                            await cancelInStorePendingOrder(order.id);
                                                                            showNotification('تم حذف الطلب المعلّق.', 'success');
                                                                            try { await fetchOrders(); } catch { }
                                                                        } catch (e: any) {
                                                                            showNotification(String(e?.message || 'تعذر حذف الطلب المعلّق.'), 'error');
                                                                        }
                                                                    }}
                                                                    disabled={!canCancel || resumePendingBusyId === order.id}
                                                                    className="px-3 py-1 bg-red-700 text-white rounded hover:bg-red-800 transition text-xs font-semibold disabled:opacity-60"
                                                                >
                                                                    حذف الطلب المعلّق
                                                                </button>
                                                            </div>
                                                        );
                                                    }

                                                    return (
                                                        <div className="flex flex-col gap-2">
                                                            {!isInStoreOrder(order) && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handlePrintDeliveryNote(order)}
                                                                    className="px-3 py-1 bg-gray-800 text-white rounded hover:bg-gray-900 transition text-xs font-semibold"
                                                                >
                                                                    طباعة سند تسليم
                                                                </button>
                                                            )}
                                                            <div className="text-xs text-gray-400">غير متاحة</div>
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {Boolean((order as any)?.voidedAt || (order as any)?.data?.voidedAt) && (
                                                    <div className="mb-2">
                                                        <span className="inline-flex items-center justify-center w-full px-3 py-2 rounded-md text-sm font-bold bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200">
                                                            ⛔ ملغي بعد التسليم
                                                        </span>
                                                    </div>
                                                )}
                                                {renderReturnBadge(order, 'banner')}
                                                <select
                                                    value={order.status}
                                                    onChange={(e) => handleStatusChange(order.id, e.target.value as OrderStatus)}
                                                    disabled={
                                                        isReadOnlyOrdersView ||
                                                        order.status === 'delivered' ||
                                                        order.status === 'cancelled' ||
                                                        getEditableStatusesForOrder(order).length === 0 ||
                                                        (isDeliveryOnly && order.assignedDeliveryUserId === adminUser?.id && !order.deliveryAcceptedAt) ||
                                                        String((order as any).returnStatus || '').toLowerCase() === 'full' ||
                                                        Boolean((order as any).isDraft)
                                                    }
                                                    className={`w-full p-2 border-none rounded-md text-sm focus:ring-2 focus:ring-orange-500 transition ${adminStatusColors[order.status]}`}
                                                >
                                                    {order.status === 'cancelled' ? (
                                                        <option value="cancelled">ملغي</option>
                                                    ) : getEditableStatusesForOrder(order).length > 0 && !getEditableStatusesForOrder(order).includes(order.status) ? (
                                                        <>
                                                            <option key={`current-${order.status}`} value={order.status}>{statusTranslations[order.status] || order.status}</option>
                                                            {getEditableStatusesForOrder(order).map(status => (
                                                                <option key={status} value={status}>{statusTranslations[status] || status}</option>
                                                            ))}
                                                        </>
                                                    ) : (
                                                        (getEditableStatusesForOrder(order).length > 0 ? getEditableStatusesForOrder(order) : [order.status]).map(status => (
                                                            <option key={status} value={status}>{statusTranslations[status] || status}</option>
                                                        ))
                                                    )}
                                                </select>
                                                {canCancel && order.status !== 'delivered' && order.status !== 'cancelled' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setCancelOrderId(order.id)}
                                                        disabled={isReadOnlyOrdersView}
                                                        className="mt-2 w-full px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition text-sm font-semibold"
                                                    >
                                                        {language === 'ar' ? 'إلغاء الطلب' : 'Cancel order'}
                                                    </button>
                                                )}
                                                {(() => {
                                                    const { paid, isCreditSale, tol } = getOrderPaymentSnapshot(order);
                                                    const isFullyReturned = String((order as any).returnStatus || '').toLowerCase() === 'full';
                                                    const isVoidedRow = Boolean((order as any)?.voidedAt || (order as any)?.data?.voidedAt);
                                                    const canReturn = order.status === 'delivered' && (isCreditSale || paid > tol) && !isFullyReturned && !isVoidedRow;
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
                                                                    setRefundMethod(detectRefundMethod(order));
                                                                }}
                                                                className="w-full px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition text-sm font-semibold"
                                                            >
                                                                ↩️ استرجاع (مرتجع)
                                                            </button>
                                                        </div>
                                                    );
                                                })()}
                                                {/* Void-after-delivery button removed: post-delivery cancellations must go
                                                    through the formal returns flow (📚 سجل المرتجعات / ↩️ استرجاع)
                                                    which creates a proper sales_returns record for accounting transparency. */}
                                                {isDeliveryOnly && !isInStoreOrder(order) && order.assignedDeliveryUserId === adminUser?.id && !order.deliveryAcceptedAt && order.status !== 'delivered' && order.status !== 'cancelled' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAcceptDelivery(order.id)}
                                                        className="mt-2 w-full px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition text-sm font-semibold"
                                                    >
                                                        {language === 'ar' ? 'قبول مهمة التوصيل' : 'Accept delivery'}
                                                    </button>
                                                )}
                                                {canAssignDelivery && !isInStoreOrder(order) && (
                                                    <div className="mt-2">
                                                        <select
                                                            value={order.assignedDeliveryUserId || 'none'}
                                                            onChange={(e) => handleAssignDelivery(order.id, e.target.value)}
                                                            disabled={isReadOnlyOrdersView}
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
                                                {canViewAccounting && order.paymentMethod === 'cash' && !isInStoreOrder(order) && Boolean(order.deliveryZoneId) && (
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
                                                {!isInStoreOrder(order) && order.status !== 'delivered' && order.status !== 'cancelled' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setEditOrderId(order.id);
                                                            setEditChangesByCartItemId({});
                                                        }}
                                                        className="mt-2 w-full px-3 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 transition text-sm font-semibold"
                                                    >
                                                        تعديل الأصناف
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={8} className="text-center py-10 text-gray-500 dark:text-gray-400">
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
                    if (isInStoreCreating && !inStoreCreatingSlow) return;
                    if (isInStoreCreating) {
                        closeInStoreAndContinueInBackground();
                        return;
                    }
                    setIsInStoreSaleOpen(false);
                }}
                onConfirm={confirmInStoreSale}
                title={language === 'ar' ? 'بيع حضوري (داخل المحل)' : 'In-store sale'}
                message=""
                isConfirming={isInStoreCreating}
                confirmText={language === 'ar' ? 'تسجيل البيع ⏎' : 'Create sale ⏎'}
                confirmingText={language === 'ar' ? 'جاري التسجيل...' : 'Creating...'}
                cancelText={language === 'ar' ? 'رجوع' : 'Back'}
                confirmButtonClassName="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400"
                maxWidthClassName="max-w-5xl"
                hideConfirmButton={true}
            >
                <div className="space-y-4 relative">
                    {isInStoreCreating && (
                        <div className="absolute inset-0 bg-white/70 dark:bg-gray-900/70 z-50 flex flex-col items-center justify-center rounded-lg backdrop-blur-sm">
                            <div className="w-16 h-16 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mb-4" />
                            <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300 animate-pulse">
                                {inStoreCreatingSlow ? 'لا يزال تسجيل البيع جارياً...' : 'جاري تسجيل البيع...'}
                            </div>
                            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                {inStoreCreatingSlow ? 'يمكنك إغلاق النافذة والمتابعة بالخلفية دون تكرار التسجيل.' : 'لا تغلق الصفحة'}
                            </div>
                            {inStoreCreateOpId && (
                                <div className="text-xs text-gray-500 dark:text-gray-300 mt-1 font-mono" dir="ltr">
                                    {`Trace: ${inStoreCreateOpId}`}
                                </div>
                            )}
                            {inStoreCreateStartedAt > 0 && (
                                <div className="text-xs text-gray-500 dark:text-gray-300 mt-1">
                                    {`المدة: ${Math.floor((Date.now() - inStoreCreateStartedAt) / 1000)} ثانية`}
                                </div>
                            )}
                            {!inStoreCreatingSlow && (
                                <button
                                    type="button"
                                    onClick={closeInStoreAndContinueInBackground}
                                    className="mt-3 px-3 py-1.5 rounded-md bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900 text-xs font-medium"
                                >
                                    إغلاق ومتابعة بالخلفية
                                </button>
                            )}
                            {inStoreCreatingSlow && (
                                <button
                                    type="button"
                                    onClick={closeInStoreAndContinueInBackground}
                                    className="mt-3 px-3 py-1.5 rounded-md bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900 text-xs font-medium"
                                >
                                    إغلاق ومتابعة بالخلفية
                                </button>
                            )}
                        </div>
                    )}
                    <div className="flex items-center justify-between text-xs">
                        <div className="text-gray-600 dark:text-gray-300">الأصناف: <span className="font-mono">{inStoreLines.length}</span></div>
                        <CurrencyDualAmount
                            amount={inStoreTotals.total}
                            currencyCode={inStoreTransactionCurrency}
                            baseAmount={undefined}
                            fxRate={undefined}
                            label="الإجمالي"
                            compact
                        />
                    </div>
                    {inStoreUxStats.total > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px]">
                            <div className="px-2 py-1 rounded bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600">عمليات: <span className="font-mono" dir="ltr">{inStoreUxStats.total}</span></div>
                            <div className="px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">بطيئة: <span className="font-mono" dir="ltr">{inStoreUxStats.slowCount}</span></div>
                            <div className="px-2 py-1 rounded bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-700">خلفية: <span className="font-mono" dir="ltr">{inStoreUxStats.detachedCount}</span></div>
                            <div className="px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700">P95: <span className="font-mono" dir="ltr">{`${inStoreUxStats.p95Ms}ms`}</span></div>
                            <div className="px-2 py-1 rounded bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700">آخر زمن: <span className="font-mono" dir="ltr">{`${inStoreUxStats.lastMs}ms`}</span></div>
                        </div>
                    )}
                    <div className="flex items-center gap-3 text-xs">
                        <div className="flex items-center gap-2">
                            <label className="text-gray-600 dark:text-gray-300">عملة المعاملة</label>
                            <select
                                value={inStoreTransactionCurrency}
                                onChange={(e) => {
                                    const next = String(e.target.value || '').trim().toUpperCase();
                                    setInStoreTransactionCurrency(next);
                                }}
                                disabled={inStorePricingBusy || isInStoreCreating}
                                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            >
                                {operationalCurrencies.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </div>
                        <div className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700">
                            <span className="text-gray-600 dark:text-gray-300 mr-1">FX</span>
                            <span className="font-mono" dir="ltr">{Number(inStoreTransactionFxRate || 1).toFixed(6)}</span>
                            {String(inStoreTransactionCurrency || '').trim().toUpperCase() !== String(baseCode || '').trim().toUpperCase() && Number(inStoreTransactionFxRate || 0) > 0 && (
                                <span className="font-mono text-gray-500 dark:text-gray-300 ml-2" dir="ltr">{`(1 ${String(baseCode || '').trim().toUpperCase()} = ${(1 / Number(inStoreTransactionFxRate || 1)).toFixed(3)} ${String(inStoreTransactionCurrency || '').trim().toUpperCase()})`}</span>
                            )}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                        <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600">
                            <div className="text-gray-500 dark:text-gray-300">المجموع الفرعي</div>
                            <CurrencyDualAmount
                                amount={Number(inStoreTotals.subtotal) || 0}
                                currencyCode={inStoreTransactionCurrency}
                                baseAmount={undefined}
                                fxRate={undefined}
                                compact
                            />
                        </div>
                        <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600">
                            <div className="text-gray-500 dark:text-gray-300">الخصم</div>
                            <CurrencyDualAmount
                                amount={-Math.abs(Number(inStoreTotals.discountAmount) || 0)}
                                currencyCode={inStoreTransactionCurrency}
                                baseAmount={undefined}
                                fxRate={undefined}
                                compact
                            />
                        </div>
                        <div className="p-2 rounded bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                            <div className="text-gray-500 dark:text-gray-300 font-bold mb-1">الإجمالي</div>
                            <CurrencyDualAmount
                                amount={inStoreTotals.total}
                                currencyCode={inStoreTransactionCurrency}
                                baseAmount={undefined}
                                fxRate={undefined}
                                compact
                            />
                        </div>
                    </div>
                    {(inStorePricingBusy || inStoreMissingServerPricing) && (
                        <div className="text-xs text-amber-700 dark:text-amber-300">
                            {inStorePricingBusy
                                ? 'يتم الآن جلب السعر النهائي من الخادم وقد يختلف عن السعر المحلي.'
                                : 'لا يوجد تسعير خادمي معتمد لكل الأصناف، لذلك تم إيقاف التسجيل حتى اكتمال التسعير.'}
                        </div>
                    )}
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
                    <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800/40 space-y-2">
                        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">العميل</div>
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                <input
                                    type="radio"
                                    checked={inStoreCustomerMode === 'walk_in'}
                                    onChange={() => { setInStoreCustomerMode('walk_in'); setInStoreSelectedCustomerId(''); setInStoreCustomerSearchResult(null); setInStoreCustomerPhoneSearch(''); setInStoreSelectedPartyId(''); }}
                                />
                                زبون حضوري (Walk‑In)
                            </label>
                            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                <input
                                    type="radio"
                                    checked={inStoreCustomerMode === 'existing'}
                                    onChange={() => { setInStoreCustomerMode('existing'); setInStoreSelectedPartyId(''); }}
                                />
                                عميل موجود (customers)
                            </label>
                            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                <input
                                    type="radio"
                                    checked={inStoreCustomerMode === 'party'}
                                    onChange={() => { setInStoreCustomerMode('party'); setInStoreSelectedCustomerId(''); setInStoreCustomerSearchResult(null); setInStoreCustomerPhoneSearch(''); }}
                                />
                                طرف مالي (financial_parties)
                            </label>
                        </div>
                        {inStoreCustomerMode === 'existing' && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                                <div className="md:col-span-2">
                                    <label className="block text-[11px] text-gray-600 dark:text-gray-300 mb-1">بحث بالاسم أو رقم الهاتف</label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={inStoreCustomerPhoneSearch}
                                            onChange={(e) => {
                                                setInStoreCustomerPhoneSearch(e.target.value);
                                                setInStoreCustomerSearchResult(null);
                                                setInStoreSelectedCustomerId('');
                                                setInStoreCustomerDropdownOpen(true);
                                            }}
                                            onFocus={() => setInStoreCustomerDropdownOpen(true)}
                                            onBlur={() => window.setTimeout(() => setInStoreCustomerDropdownOpen(false), 150)}
                                            onKeyDown={(e) => {
                                                if (e.key !== 'Enter') return;
                                                const first = inStoreCustomerMatches[0];
                                                if (first) selectInStoreCustomer(first);
                                            }}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                            placeholder="مثال: 771234567 أو محمد"
                                        />
                                        {inStoreCustomerDropdownOpen && inStoreCustomerPhoneSearch.trim() !== '' && (
                                            <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-600 shadow-lg">
                                                {inStoreCustomerMatches.length > 0 ? (
                                                    inStoreCustomerMatches.map((c) => {
                                                        const title = c.fullName || c.phoneNumber || 'غير معروف';
                                                        const meta = [c.phoneNumber].filter(Boolean).join(' • ');
                                                        return (
                                                            <button
                                                                key={c.id}
                                                                type="button"
                                                                onMouseDown={(ev) => ev.preventDefault()}
                                                                onClick={() => selectInStoreCustomer(c)}
                                                                className="w-full px-3 py-2 text-right hover:bg-gray-50 dark:hover:bg-gray-700"
                                                            >
                                                                <div className="font-semibold truncate dark:text-white">{title}</div>
                                                                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{meta}</div>
                                                            </button>
                                                        );
                                                    })
                                                ) : (
                                                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                                                        {inStoreCustomerSearching ? 'جاري البحث...' : 'لا نتائج'}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        const q = inStoreCustomerPhoneSearch.trim();
                                        if (!q) {
                                            setInStoreCustomerSearchResult(null);
                                            setInStoreSelectedCustomerId('');
                                            setInStoreCustomerMatches([]);
                                            return;
                                        }
                                        setInStoreCustomerSearching(true);
                                        const list = await fetchInStoreCustomerMatches(q);
                                        setInStoreCustomerMatches(list);
                                        setInStoreCustomerSearching(false);
                                        if (list.length === 1) {
                                            selectInStoreCustomer(list[0]);
                                            return;
                                        }
                                        if (list.length === 0) {
                                            showNotification('لا نتائج.', 'error');
                                            return;
                                        }
                                        setInStoreCustomerDropdownOpen(true);
                                    }}
                                    className="px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition text-xs font-semibold"
                                >
                                    بحث
                                </button>
                            </div>
                        )}
                        {inStoreCustomerMode === 'existing' && inStoreCustomerSearchResult && (
                            <div className="text-xs text-gray-700 dark:text-gray-300">
                                عميل مختار: <span className="font-mono">{inStoreCustomerSearchResult.fullName || '—'}</span> • <span className="font-mono">{inStoreCustomerSearchResult.phoneNumber || '—'}</span>
                                <div className="mt-1 text-[11px] text-gray-500">ID: <span className="font-mono">{inStoreSelectedCustomerId}</span></div>
                            </div>
                        )}
                        {inStoreCustomerMode === 'party' && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                                <div className="md:col-span-2">
                                    <label className="block text-[11px] text-gray-600 dark:text-gray-300 mb-1">اختيار طرف مالي</label>
                                    <select
                                        value={inStoreSelectedPartyId}
                                        onChange={(e) => {
                                            const next = String(e.target.value || '').trim();
                                            setInStoreSelectedPartyId(next);
                                            const selected = inStorePartyOptions.find(p => p.id === next);
                                            if (selected?.name) {
                                                setInStoreCustomerName(selected.name);
                                                setInStorePhoneNumber('');
                                            }
                                        }}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                    >
                                        <option value="">{inStorePartyLoading ? 'جاري التحميل...' : 'اختر طرفاً'}</option>
                                        {inStorePartyOptions.map((p) => (
                                            <option key={p.id} value={p.id}>{p.name}{p.type ? ` — ${p.type}` : ''}</option>
                                        ))}
                                    </select>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setInStoreSelectedPartyId('');
                                        setInStoreCustomerName('');
                                        setInStorePhoneNumber('');
                                        setInStoreInvoiceStatement('');
                                    }}
                                    className="px-3 py-2 rounded-md bg-gray-700 text-white hover:bg-gray-800 transition text-xs font-semibold"
                                >
                                    مسح
                                </button>
                            </div>
                        )}
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
                    <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">{language === 'ar' ? 'بيان الفاتورة (اختياري)' : 'Invoice statement (optional)'}</label>
                        <textarea
                            rows={2}
                            value={inStoreInvoiceStatement}
                            onChange={(e) => setInStoreInvoiceStatement(e.target.value)}
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
                                checked={inStoreIsCredit}
                                onChange={(e) => {
                                    const checked = e.target.checked;
                                    setInStoreIsCredit(checked);
                                    if (checked) {
                                        const base = toYmd(new Date());
                                        (async () => {
                                            let days = Math.max(0, Number(inStoreCreditDays) || 0) || 30;
                                            if (inStoreCustomerMode === 'party' && inStoreSelectedPartyId) {
                                                const hint = Number(inStoreCreditSummary?.net_days_default);
                                                if (Number.isFinite(hint) && hint >= 0) {
                                                    days = Math.floor(hint);
                                                } else {
                                                    try {
                                                        const supabase = getSupabaseClient();
                                                        if (supabase) {
                                                            const { data, error } = await supabase.rpc('get_party_credit_summary', { p_party_id: String(inStoreSelectedPartyId) });
                                                            if (!error) {
                                                                const d = data as any;
                                                                const nd = Number(d?.net_days_default);
                                                                if (Number.isFinite(nd) && nd >= 0) {
                                                                    days = Math.floor(nd);
                                                                }
                                                            }
                                                        }
                                                    } catch {
                                                    }
                                                }
                                            }
                                            setInStoreCreditDays(days);
                                            setInStoreCreditDueDate(addDaysToYmd(base, days));
                                        })();
                                        setInStoreMultiPaymentEnabled(true);
                                        const initialMethod = inStorePaymentMethod && inStoreVisiblePaymentMethods.includes(inStorePaymentMethod)
                                            ? inStorePaymentMethod
                                            : (inStoreVisiblePaymentMethods[0] || 'cash');
                                        setInStorePaymentLines([{
                                            method: initialMethod,
                                            amount: 0,
                                            declaredAmount: 0,
                                            amountConfirmed: initialMethod === 'cash',
                                            cashReceived: 0,
                                        }]);
                                    } else {
                                        setInStoreCreditDays(30);
                                        setInStoreCreditDueDate('');
                                    }
                                }}
                                disabled={
                                    !(
                                        (inStoreCustomerMode === 'existing' && !!inStoreSelectedCustomerId) ||
                                        (inStoreCustomerMode === 'party' && !!inStoreSelectedPartyId)
                                    )
                                }
                                className="form-checkbox h-5 w-5 text-purple-600 rounded focus:ring-purple-600 disabled:opacity-50"
                            />
                            بيع آجل / ذمم (عميل مسجل أو طرف مالي)
                        </label>
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

                    {inStoreIsCredit && (
                        <div className="mt-2 p-3 border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 rounded-md">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-xs font-semibold text-purple-800 dark:text-purple-300">ملخص الائتمان</div>
                                {inStoreCreditSummaryLoading && (
                                    <div className="text-[11px] text-gray-600 dark:text-gray-300">جاري التحميل...</div>
                                )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                                <div>
                                    <label className="block text-[11px] text-gray-700 dark:text-gray-300 mb-1">أيام الأجل</label>
                                    <NumberInput
                                        id="inStoreCreditDays"
                                        name="inStoreCreditDays"
                                        value={inStoreCreditDays}
                                        onChange={(e) => {
                                            const days = Math.max(0, Number(e.target.value) || 0);
                                            setInStoreCreditDays(days);
                                            const base = toYmd(new Date());
                                            setInStoreCreditDueDate(addDaysToYmd(base, days));
                                        }}
                                        min={0}
                                        step={1}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[11px] text-gray-700 dark:text-gray-300 mb-1">تاريخ الاستحقاق</label>
                                    <input
                                        type="date"
                                        value={inStoreCreditDueDate}
                                        onChange={(e) => setInStoreCreditDueDate(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                    />
                                </div>
                            </div>
                            {!inStoreCreditSummaryLoading && !(inStoreCreditSummary && inStoreCreditSummary.exists) && (
                                <div className="text-[11px] text-gray-700 dark:text-gray-300 mt-1">تعذر تحميل بيانات الائتمان.</div>
                            )}
                            {!inStoreCreditSummaryLoading && (inStoreCreditSummary && inStoreCreditSummary.exists) && (
                                (inStoreCreditSummary.party_mode ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-[11px] text-gray-800 dark:text-gray-200">
                                        <CurrencyDualAmount amount={Number(inStoreCreditSummary.credit_limit || 0)} currencyCode={baseCode} baseAmount={undefined} fxRate={undefined} label="سقف الائتمان (طرف)" compact />
                                        <CurrencyDualAmount amount={Number(inStoreCreditSummary.current_balance || 0)} currencyCode={baseCode} baseAmount={undefined} fxRate={undefined} label="الرصيد الحالي (ذمم)" compact />
                                        <CurrencyDualAmount amount={Number(inStoreCreditSummary.available_credit || 0)} currencyCode={baseCode} baseAmount={undefined} fxRate={undefined} label="المتاح الآن" compact />
                                        <div>
                                            المتاح بعد هذا البيع:{' '}
                                            <span className="font-mono">
                                                {(
                                                    Number(inStoreCreditSummary.available_credit || 0) -
                                                    Math.max(0, (Number(inStoreTotals.baseTotal) || 0) - roundMoney(((inStoreMultiPaymentEnabled ? inStorePaymentLines.reduce((s, p) => s + (Number(p.amount) || 0), 0) : 0) as number) * (Number(inStoreTotals.fxRate) || 1)))
                                                ).toFixed(getCurrencyDecimalsByCode(baseCode || ''))} {baseCode || '—'}
                                            </span>
                                        </div>
                                        {Boolean(inStoreCreditSummary.credit_hold) && (
                                            <div className="md:col-span-2 text-[11px] text-red-700 dark:text-red-300">
                                                هذا الطرف عليه إيقاف ائتمان (Credit Hold) — البيع الآجل يتطلب موافقة/تجاوز.
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-[11px] text-gray-800 dark:text-gray-200">
                                        <CurrencyDualAmount amount={Number(inStoreCreditSummary.credit_limit || 0)} currencyCode={baseCode} baseAmount={undefined} fxRate={undefined} label="سقف الائتمان" compact />
                                        <CurrencyDualAmount amount={Number(inStoreCreditSummary.current_balance || 0)} currencyCode={baseCode} baseAmount={undefined} fxRate={undefined} label="الرصيد الحالي" compact />
                                        <CurrencyDualAmount amount={Number(inStoreCreditSummary.available_credit || 0)} currencyCode={baseCode} baseAmount={undefined} fxRate={undefined} label="المتاح الآن" compact />
                                        <div>
                                            المتاح بعد هذا البيع:{' '}
                                            <span className="font-mono">
                                                {Math.max(
                                                    0,
                                                    Number(inStoreCreditSummary.available_credit || 0) - Math.max(0, (Number(inStoreTotals.baseTotal) || 0) - roundMoney(((inStoreMultiPaymentEnabled ? inStorePaymentLines.reduce((s, p) => s + (Number(p.amount) || 0), 0) : 0) as number) * (Number(inStoreTotals.fxRate) || 1)))
                                                ).toFixed(getCurrencyDecimalsByCode(baseCode || ''))} {baseCode || '—'}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

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
                                            const initialMethod = inStorePaymentMethod && inStoreVisiblePaymentMethods.includes(inStorePaymentMethod)
                                                ? inStorePaymentMethod
                                                : (inStoreVisiblePaymentMethods[0] || '');
                                            setInStorePaymentLines([{
                                                method: initialMethod,
                                                amount: inStoreIsCredit ? 0 : roundMoney(total),
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
                                        const method = inStoreVisiblePaymentMethods[0] || '';
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
                                                                destinationAccountId: undefined,
                                                            } : row));
                                                        }}
                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                    >
                                                        {inStoreVisiblePaymentMethods.map((m) => (
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
                                                    <CurrencyDualAmount
                                                        amount={Number(change || 0)}
                                                        currencyCode={inStoreTransactionCurrency}
                                                        baseAmount={undefined}
                                                        fxRate={undefined}
                                                        label="الباقي"
                                                        compact
                                                    />
                                                </div>
                                            )}

                                            {needsReference && (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    <div className="md:col-span-2">
                                                        <label className="block text-[11px] text-gray-600 dark:text-gray-300 mb-1">تحديد الحساب المالي</label>
                                                        <select
                                                            value={p.destinationAccountId || ''}
                                                            onChange={(e) => setInStorePaymentLines(prev => prev.map((row, i) => i === idx ? { ...row, destinationAccountId: e.target.value } : row))}
                                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                        >
                                                            <option value="">(افتراضي)</option>
                                                            {availableInStoreDestinations
                                                                .filter(a => p.method === 'kuraimi' ? a.parentCode === '1020' : a.parentCode === '1030')
                                                                .map(a => (
                                                                    <option key={a.id} value={a.id}>{a.name}</option>
                                                                ))}
                                                        </select>
                                                    </div>
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
                                <CurrencyDualAmount
                                    amount={inStorePaymentLines.reduce((s, p) => s + (Number(p.amount) || 0), 0)}
                                    currencyCode={inStoreTransactionCurrency}
                                    baseAmount={undefined}
                                    fxRate={undefined}
                                    label="مجموع الدفعات"
                                    compact
                                />
                            </div>
                        ) : (
                            <select
                                value={inStorePaymentMethod}
                                onChange={(e) => setInStorePaymentMethod(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            >
                                {inStoreVisiblePaymentMethods.length === 0 ? (
                                    <option value="">لا توجد طرق دفع مفعلة في الإعدادات</option>
                                ) : (
                                    inStoreVisiblePaymentMethods.map((method) => (
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

                    {!inStoreIsCredit && !inStoreMultiPaymentEnabled && inStorePaymentMethod === 'cash' && (
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
                            <CurrencyDualAmount
                                amount={(inStoreCashReceived > 0 ? Math.max(0, inStoreCashReceived - (Number(inStoreTotals.total) || 0)) : 0)}
                                currencyCode={inStoreTransactionCurrency}
                                baseAmount={undefined}
                                fxRate={undefined}
                                label="الباقي"
                                compact
                            />
                        </div>
                    )}

                    {!inStoreIsCredit && !inStoreMultiPaymentEnabled && (inStorePaymentMethod === 'kuraimi' || inStorePaymentMethod === 'network') && (
                        <div className="p-3 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-md space-y-3">
                            <div className="text-xs font-semibold text-blue-800 dark:text-blue-300">
                                {inStorePaymentMethod === 'kuraimi' ? 'بيانات الإيداع البنكي' : 'بيانات الحوالة'}
                            </div>
                            <div>
                                <label className="block text-xs text-gray-700 dark:text-gray-300 mb-1">تحديد الحساب المالي</label>
                                <select
                                    value={inStorePaymentDestinationAccountId}
                                    onChange={(e) => setInStorePaymentDestinationAccountId(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                >
                                    <option value="">(افتراضي)</option>
                                    {availableInStoreDestinations
                                        .filter(a => inStorePaymentMethod === 'kuraimi' ? a.parentCode === '1020' : a.parentCode === '1030')
                                        .map(a => (
                                            <option key={a.id} value={a.id}>{a.name}</option>
                                        ))}
                                </select>
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
                                    <div className="mt-1">
                                        <CurrencyDualAmount
                                            amount={inStoreTotals.total}
                                            currencyCode={inStoreTransactionCurrency}
                                            baseAmount={undefined}
                                            fxRate={undefined}
                                            label="الإجمالي الحالي"
                                            compact
                                        />
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
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    if (!filteredInStoreMenuItems.length) return;
                                    const next = Math.min(filteredInStoreMenuItems.length - 1, Math.max(0, inStoreSelectedItemIndex + 1));
                                    setInStoreSelectedItemIndex(next);
                                    setInStoreSelectedItemId(filteredInStoreMenuItems[next]?.id || '');
                                    return;
                                }
                                if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    if (!filteredInStoreMenuItems.length) return;
                                    const next = Math.max(0, (inStoreSelectedItemIndex <= 0 ? 0 : inStoreSelectedItemIndex - 1));
                                    setInStoreSelectedItemIndex(next);
                                    setInStoreSelectedItemId(filteredInStoreMenuItems[next]?.id || '');
                                    return;
                                }
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (inStoreSelectedItemId) {
                                        addInStoreLine();
                                        return;
                                    }
                                    const first = filteredInStoreMenuItems[0];
                                    if (first?.id) {
                                        setInStoreSelectedItemId(first.id);
                                        setInStoreSelectedItemIndex(0);
                                    }
                                }
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        />
                        {selectedInStoreMenuItem && selectedInStoreAvailability && (
                            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/60 p-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">
                                        {selectedInStoreMenuItem.name?.[language] || selectedInStoreMenuItem.name?.ar || selectedInStoreMenuItem.name?.en || selectedInStoreMenuItem.id}
                                    </span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800">
                                        الكل: {selectedInStoreAvailability.globalAvailable}
                                    </span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-slate-50 text-slate-800 border-slate-200 dark:bg-slate-900/30 dark:text-slate-200 dark:border-slate-700">
                                        الجلسة: {selectedInStoreAvailability.sessionAvailable}
                                    </span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800">
                                        محجوز: {selectedInStoreAvailability.sessionReserved}
                                    </span>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${selectedInStoreAvailability.status === 'ok'
                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800'
                                        : selectedInStoreAvailability.status === 'switch'
                                            ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800'
                                            : 'bg-red-50 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800'
                                        }`}>
                                        {selectedInStoreAvailability.status === 'ok'
                                            ? 'متوفر في الجلسة'
                                            : selectedInStoreAvailability.status === 'switch'
                                                ? 'يتطلب تبديل مستودع'
                                                : 'غير متوفر إجمالًا'}
                                    </span>
                                    {selectedInStoreAvailability.globalLastUpdated && (
                                        <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                            تحديث: {new Date(selectedInStoreAvailability.globalLastUpdated).toLocaleString('ar-EG-u-nu-latn')}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2">
                            <div className="flex-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 overflow-hidden">
                                <div className="px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-600">
                                    {language === 'ar' ? 'اختر صنف لإضافته (الكمية بين القوسين = إجمالي كل المستودعات)' : 'Choose item to add (quantity in parentheses = total stock)'}
                                </div>
                                <div className="max-h-44 overflow-auto">
                                    {filteredInStoreMenuItems.length === 0 ? (
                                        <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                                            {language === 'ar' ? 'لا توجد نتائج' : 'No items found'}
                                        </div>
                                    ) : filteredInStoreMenuItems.map((mi, idx) => {
                                        const name = mi.name?.[language] || mi.name?.ar || mi.name?.en || mi.id;
                                        const stockRow = getStockByItemId(String(mi.id || ''));
                                        const globalAvailable = getGlobalSellableByItemId(String(mi.id || ''));
                                        const sessionAvailable = stockRow
                                            ? Math.max(0, Number(stockRow.availableQuantity || 0) - Number(stockRow.reservedQuantity || 0))
                                            : globalAvailable;
                                        const isActive = String(inStoreSelectedItemId || '') === String(mi.id || '');
                                        const badge = sessionAvailable > 0
                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800'
                                            : (globalAvailable > 0
                                                ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800'
                                                : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800');
                                        return (
                                            <button
                                                key={mi.id}
                                                type="button"
                                                onClick={() => {
                                                    setInStoreSelectedItemId(mi.id);
                                                    setInStoreSelectedItemIndex(idx);
                                                }}
                                                onDoubleClick={() => {
                                                    setInStoreSelectedItemId(mi.id);
                                                    setInStoreSelectedItemIndex(idx);
                                                    setTimeout(() => addInStoreLine(), 0);
                                                }}
                                                className={`w-full text-right px-3 py-2 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600/40 ${isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="truncate text-sm text-gray-900 dark:text-white">{name}</div>
                                                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">({globalAvailable})</div>
                                                </div>
                                                <div className="mt-1 flex items-center gap-1 flex-wrap">
                                                    <span className="text-[10px] text-gray-500 dark:text-gray-400">جلسة: {sessionAvailable}</span>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${badge}`}>
                                                        {sessionAvailable > 0 ? 'متوفر' : (globalAvailable > 0 ? 'حوّل المستودع' : 'غير متوفر')}
                                                    </span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
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
                                    const uomQty = Number(line.uomQtyInBase || 1) || 1;
                                    const pricingQty = isWeightBased ? (Number(line.weight ?? 0) || 0) : ((Number(line.quantity ?? 0) || 0) * (Number(line.uomQtyInBase || 1) || 1));
                                    const pricingKey = `${line.menuItemId}:${mi.unitType || 'piece'}:${pricingQty}:${inStoreSelectedCustomerId || ''}`;
                                    const priced = inStorePricingMap[pricingKey];
                                    const fallbackUnitPrice = mi.unitType === 'gram' && mi.pricePerUnit ? mi.pricePerUnit / 1000 : mi.price;
                                    const pricedUnitPrice = mi.unitType === 'gram'
                                        ? (priced?.unitPricePerKg ? (priced.unitPricePerKg / 1000) : (Number(priced?.unitPrice) || fallbackUnitPrice))
                                        : (Number(priced?.unitPrice) || fallbackUnitPrice);
                                    const baseUnitPrice = priced?.isTxnPrice
                                        ? convertInStoreTxnToBase(pricedUnitPrice, Number(inStoreTransactionFxRate) || 1)
                                        : pricedUnitPrice;
                                    const stockRow = getStockByItemId(String(mi.id || ''));
                                    const globalAvailable = getGlobalSellableByItemId(String(mi.id || ''));
                                    const sessionAvailableBase = stockRow
                                        ? Math.max(0, Number(stockRow.availableQuantity || 0) - Number(stockRow.reservedQuantity || 0))
                                        : globalAvailable;
                                    const sessionReservedBase = stockRow ? Math.max(0, Number(stockRow.reservedQuantity || 0)) : 0;
                                    let baseAddonsCost = 0;
                                    if (line.selectedAddons && mi.addons) {
                                        Object.entries(line.selectedAddons).forEach(([aid, qty]) => {
                                            const addon = mi.addons?.find(ad => ad.id === aid);
                                            if (addon) {
                                                baseAddonsCost += addon.price * qty;
                                            }
                                        });
                                    }
                                    const baseLineTotal = isWeightBased
                                        ? (baseUnitPrice * (line.weight ?? 0)) + (baseAddonsCost * 1)
                                        : (baseUnitPrice + baseAddonsCost) * (line.quantity ?? 0) * (Number(line.uomQtyInBase || 1) || 1);
                                    const unitPrice = convertBaseToInStoreTxn(baseUnitPrice, Number(inStoreTransactionFxRate) || 1);
                                    const lineTotal = convertBaseToInStoreTxn(baseLineTotal, Number(inStoreTransactionFxRate) || 1);
                                    const currentValue = isWeightBased ? (line.weight ?? 0) : (line.quantity ?? 0);
                                    const sessionAvailableInUom = (!isWeightBased && uomQty > 0)
                                        ? Math.floor((sessionAvailableBase / uomQty) + 1e-9)
                                        : sessionAvailableBase;
                                    const globalAvailableInUom = (!isWeightBased && uomQty > 0)
                                        ? Math.floor((globalAvailable / uomQty) + 1e-9)
                                        : globalAvailable;
                                    const exceeded = typeof sessionAvailableInUom === 'number' ? currentValue > sessionAvailableInUom : false;
                                    const canCoverFromOtherWarehouse = exceeded && currentValue <= globalAvailableInUom;
                                    const stockBadge = isWeightBased
                                        ? null
                                        : (exceeded
                                            ? (canCoverFromOtherWarehouse
                                                ? {
                                                    label: 'يتطلب تبديل مستودع',
                                                    cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800',
                                                }
                                                : {
                                                    label: 'غير متوفر إجمالًا',
                                                    cls: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800',
                                                })
                                            : {
                                                label: 'متوفر في الجلسة',
                                                cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800',
                                            });

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
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{name}</div>
                                                        {stockBadge && (
                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${stockBadge.cls}`}>
                                                                {stockBadge.label}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">{getUnitLabel(String(mi.unitType || 'piece') as any, 'ar') || localizeUomCodeAr(String(mi.unitType || 'piece'))}</div>
                                                    {!isWeightBased ? (
                                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                                            مستودع الجلسة: {sessionAvailableInUom}{' '}
                                                            {localizeUomCodeAr(String(line.uomCode || mi.unitType || 'piece'))}{' '}
                                                            <span className="text-gray-400">({sessionAvailableBase} {getUnitLabel(String(mi.unitType || 'piece') as any, 'ar') || localizeUomCodeAr(String(mi.unitType || 'piece'))} • محجوز: {sessionReservedBase})</span>
                                                        </div>
                                                    ) : null}
                                                    {!isWeightBased ? (
                                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                                            إجمالي كل المستودعات: {globalAvailableInUom}{' '}
                                                            {localizeUomCodeAr(String(line.uomCode || mi.unitType || 'piece'))}{' '}
                                                            <span className="text-gray-400">({globalAvailable} {getUnitLabel(String(mi.unitType || 'piece') as any, 'ar') || localizeUomCodeAr(String(mi.unitType || 'piece'))})</span>
                                                        </div>
                                                    ) : null}
                                                    {!isWeightBased && canCoverFromOtherWarehouse && (
                                                        <div className="text-[11px] text-amber-700 dark:text-amber-300">
                                                            الكمية المطلوبة لا تكفي في مستودع الجلسة؛ يمكن تغطيتها من مستودع آخر عبر اختيار المستودع أدناه.
                                                        </div>
                                                    )}
                                                    {!isWeightBased && exceeded && !canCoverFromOtherWarehouse && (
                                                        <div className="text-[11px] text-red-700 dark:text-red-300">
                                                            الكمية المطلوبة غير متوفرة في إجمالي المستودعات.
                                                        </div>
                                                    )}
                                                    <CurrencyDualAmount
                                                        amount={!isWeightBased ? (unitPrice * uomQty) : unitPrice}
                                                        currencyCode={inStoreTransactionCurrency}
                                                        baseAmount={undefined}
                                                        fxRate={undefined}
                                                        label="السعر المطبق"
                                                        compact
                                                    />
                                                    {inStorePricingBusy ? <span className="text-[11px]"> {' '}…</span> : null}
                                                    {addonNames && <div className="text-xs text-orange-600 dark:text-orange-400">+{addonNames}</div>}
                                                </div>
                                                <CurrencyDualAmount
                                                    amount={lineTotal}
                                                    currencyCode={inStoreTransactionCurrency}
                                                    baseAmount={undefined}
                                                    fxRate={undefined}
                                                    compact
                                                />
                                                <div className="w-36">
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const step = isWeightBased ? (mi.unitType === 'gram' ? 100 : 0.5) : 1;
                                                                const current = isWeightBased ? (line.weight ?? 0) : (line.quantity ?? 0);
                                                                const next = Math.max(0, current - step);
                                                                updateInStoreLine(index, isWeightBased ? { weight: next } : { quantity: next });
                                                            }}
                                                            className="w-8 h-8 flex items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-colors text-lg font-bold shrink-0 select-none"
                                                            aria-label="تقليل الكمية"
                                                        >
                                                            −
                                                        </button>
                                                        <NumberInput
                                                            id={`qty-${index}`}
                                                            name={`qty-${index}`}
                                                            value={isWeightBased ? (line.weight ?? 0) : (line.quantity ?? 0)}
                                                            onChange={(e) => {
                                                                const val = parseFloat(e.target.value) || 0;
                                                                updateInStoreLine(index, isWeightBased ? { weight: val } : { quantity: val });
                                                            }}
                                                            min={0}
                                                            max={sessionAvailableInUom}
                                                            step={isWeightBased ? (mi.unitType === 'gram' ? 1 : 0.01) : 1}
                                                            className={`text-center ${exceeded ? 'border-red-500' : ''}`}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const step = isWeightBased ? (mi.unitType === 'gram' ? 100 : 0.5) : 1;
                                                                const current = isWeightBased ? (line.weight ?? 0) : (line.quantity ?? 0);
                                                                const max = sessionAvailableInUom;
                                                                const next = typeof max === 'number' ? Math.min(max, current + step) : current + step;
                                                                updateInStoreLine(index, isWeightBased ? { weight: next } : { quantity: next });
                                                            }}
                                                            className="w-8 h-8 flex items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors text-lg font-bold shrink-0 select-none"
                                                            aria-label="زيادة الكمية"
                                                        >
                                                            +
                                                        </button>
                                                    </div>
                                                    {exceeded && (
                                                        <div className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                                                            يتجاوز متاح مستودع الجلسة: {sessionAvailableInUom?.toFixed ? sessionAvailableInUom.toFixed(2) : sessionAvailableInUom}
                                                        </div>
                                                    )}
                                                </div>
                                                {!isWeightBased && (
                                                    <div className="w-40">
                                                        <select
                                                            value={String(line.uomCode || mi.unitType || 'piece')}
                                                            onChange={(e) => {
                                                                const code = String(e.target.value || '').trim();
                                                                const baseLabel = String(mi.unitType || 'piece');
                                                                const baseDisplay = getUnitLabel(baseLabel as any, 'ar') || localizeUomCodeAr(baseLabel);
                                                                const fromMap = (itemUomRowsByItemId[mi.id] && itemUomRowsByItemId[mi.id].length > 0)
                                                                    ? itemUomRowsByItemId[mi.id]
                                                                    : [];
                                                                const fromItem = Array.isArray((mi as any)?.uomUnits)
                                                                    ? ((mi as any).uomUnits as Array<{ code: string; name?: string; qtyInBase: number }>)
                                                                    : [];
                                                                const merged = [
                                                                    { code: baseLabel, name: baseDisplay, qtyInBase: 1 },
                                                                    ...fromMap,
                                                                    ...fromItem,
                                                                ].filter((o: any) => String(o?.code || '').trim());
                                                                const uniq = new Map<string, { code: string; name?: string; qtyInBase: number }>();
                                                                for (const o of merged) {
                                                                    const c = String((o as any).code || '').trim();
                                                                    if (!c) continue;
                                                                    const qty = Number((o as any).qtyInBase || 0) || 0;
                                                                    if (!(qty > 0)) continue;
                                                                    if (!uniq.has(c)) uniq.set(c, { code: c, name: (o as any).name, qtyInBase: qty });
                                                                }
                                                                if (!uniq.has('pack')) {
                                                                    const packSize = Number((mi as any)?.packSize || 0);
                                                                    if (packSize > 0) uniq.set('pack', { code: 'pack', name: 'باكت', qtyInBase: packSize });
                                                                }
                                                                if (!uniq.has('carton')) {
                                                                    const cartonSize = Number((mi as any)?.cartonSize || 0);
                                                                    if (cartonSize > 0) uniq.set('carton', { code: 'carton', name: 'كرتون', qtyInBase: cartonSize });
                                                                }
                                                                const options = Array.from(uniq.values());
                                                                const found = options.find((o) => String(o?.code || '').trim() === code);
                                                                const qtyBase = found ? Number(found.qtyInBase) || 1 : (Number(line.uomQtyInBase || 1) || 1);
                                                                updateInStoreLine(index, { uomCode: code, uomQtyInBase: qtyBase });
                                                            }}
                                                            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                        >
                                                            {(() => {
                                                                const baseLabel = String(mi.unitType || 'piece');
                                                                const baseDisplay = getUnitLabel(baseLabel as any, 'ar') || localizeUomCodeAr(baseLabel);
                                                                const fromMap = (itemUomRowsByItemId[mi.id] && itemUomRowsByItemId[mi.id].length > 0)
                                                                    ? itemUomRowsByItemId[mi.id]
                                                                    : [];
                                                                const fromItem = Array.isArray((mi as any)?.uomUnits)
                                                                    ? ((mi as any).uomUnits as Array<{ code: string; name?: string; qtyInBase: number }>)
                                                                    : [];
                                                                const merged = [
                                                                    { code: baseLabel, name: baseDisplay, qtyInBase: 1 },
                                                                    ...fromMap,
                                                                    ...fromItem,
                                                                ].filter((o: any) => String(o?.code || '').trim());
                                                                const uniq = new Map<string, { code: string; name?: string; qtyInBase: number }>();
                                                                for (const o of merged) {
                                                                    const c = String((o as any).code || '').trim();
                                                                    if (!c) continue;
                                                                    const qty = Number((o as any).qtyInBase || 0) || 0;
                                                                    if (!(qty > 0)) continue;
                                                                    if (!uniq.has(c)) uniq.set(c, { code: c, name: (o as any).name, qtyInBase: qty });
                                                                }
                                                                if (!uniq.has('pack')) {
                                                                    const packSize = Number((mi as any)?.packSize || 0);
                                                                    if (packSize > 0) uniq.set('pack', { code: 'pack', name: 'باكت', qtyInBase: packSize });
                                                                }
                                                                if (!uniq.has('carton')) {
                                                                    const cartonSize = Number((mi as any)?.cartonSize || 0);
                                                                    if (cartonSize > 0) uniq.set('carton', { code: 'carton', name: 'كرتون', qtyInBase: cartonSize });
                                                                }
                                                                const options = Array.from(uniq.values()).sort((a, b) => (a.qtyInBase || 0) - (b.qtyInBase || 0));
                                                                return options.map((o: any) => {
                                                                    const nameRaw = String(o.name || '').trim();
                                                                    const displayName = nameRaw || getUnitLabel(String(o.code || '') as any, 'ar') || localizeUomCodeAr(String(o.code || ''));
                                                                    const qtyText = Number(o.qtyInBase) > 1 ? ` (${Number(o.qtyInBase)} ${baseDisplay})` : '';
                                                                    return (
                                                                        <option key={o.code} value={o.code}>
                                                                            {displayName}{qtyText}
                                                                        </option>
                                                                    );
                                                                });
                                                            })()}
                                                        </select>
                                                    </div>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => removeInStoreLine(index)}
                                                    className="w-10 h-10 flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md shrink-0 transition"
                                                >
                                                    <Trash className="w-5 h-5" />
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs mt-1 border-t border-gray-100 dark:border-gray-700 pt-1">
                                                <span className="text-gray-500 dark:text-gray-400 min-w-16 ml-2 font-medium">{language === 'ar' ? 'المستودع:' : 'Warehouse:'}</span>
                                                <select
                                                    value={line.warehouseId || sessionScope.scope?.warehouseId || ''}
                                                    onChange={(e) => updateInStoreLine(index, { warehouseId: e.target.value })}
                                                    className="flex-1 border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 text-xs py-1 px-2 dark:bg-gray-700 dark:text-gray-200"
                                                >
                                                    {warehouses?.filter(w => w.isActive).map(w => (
                                                        <option key={w.id} value={w.id}>{w.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            {/* ── Warehouse FEFO Alerts ── */}
                                            {(() => {
                                                const alerts = inStoreAlertsByIndex[index] || [];
                                                const loading = inStoreAlertsLoadingByIndex[index];
                                                if (loading) return <div className="mt-1 text-[11px] text-gray-400 animate-pulse">جارِ فحص المستودع...</div>;
                                                if (alerts.length === 0) return null;
                                                return (
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {alerts.map((a: WarehouseAlert, i: number) => {
                                                            const colors = {
                                                                error: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800',
                                                                warning: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
                                                                info: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800',
                                                                success: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
                                                            };
                                                            const cls = colors[a.severity] || colors.info;
                                                            return (
                                                                <div key={i} className={`text-[11px] px-2 py-1 rounded-lg border font-medium ${cls}`}
                                                                    onClick={() => {
                                                                        if (a.other_warehouse_id) {
                                                                            if (window.confirm(`هل تريد التبديل إلى مستودع "${a.other_warehouse || ''}"؟`)) {
                                                                                updateInStoreLine(index, { warehouseId: a.other_warehouse_id });
                                                                            }
                                                                        }
                                                                    }}
                                                                    style={{ cursor: a.other_warehouse_id ? 'pointer' : 'default' }}
                                                                >
                                                                    {a.message}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    );
                                })}

                                <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-sm">
                                    <span className="text-gray-600 dark:text-gray-300">{language === 'ar' ? 'الإجمالي' : 'Total'}</span>
                                    <CurrencyDualAmount
                                        amount={inStoreTotals.total}
                                        currencyCode={inStoreTransactionCurrency}
                                        baseAmount={undefined}
                                        fxRate={undefined}
                                        compact
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setInStoreLines([]);
                                            setInStoreSelectedItemId('');
                                            setInStoreSelectedItemIndex(-1);
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
                    {/* ── Sticky Summary Bar ── */}
                    {inStoreLines.length > 0 && (
                        <div className="sticky bottom-0 z-20 -mx-6 px-6 py-3 bg-gradient-to-t from-emerald-50 via-white to-white dark:from-emerald-950/40 dark:via-gray-800 dark:to-gray-800 border-t-2 border-emerald-200 dark:border-emerald-800 shadow-[0_-4px_16px_-4px_rgba(0,0,0,0.1)]">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-1.5">
                                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold">{inStoreLines.length}</span>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">أصناف</span>
                                    </div>
                                    <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                                        <CurrencyDualAmount
                                            amount={inStoreTotals.total}
                                            currencyCode={inStoreTransactionCurrency}
                                            baseAmount={undefined}
                                            fxRate={undefined}
                                            compact
                                        />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={saveInStoreDraftQuotation}
                                        disabled={isInStoreCreating || inStoreLines.length === 0}
                                        className="px-3 py-2 rounded-md border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition text-xs font-medium disabled:opacity-50"
                                    >
                                        📋 عرض سعر
                                    </button>
                                    <button
                                        type="button"
                                        onClick={confirmInStoreSale}
                                        disabled={isInStoreCreating || inStoreLines.length === 0 || inStoreVisiblePaymentMethods.length === 0 || !inStorePaymentMethod || inStorePricingBusy || inStoreMissingServerPricing}
                                        className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 transition-all text-sm font-bold shadow-lg shadow-emerald-600/25 disabled:opacity-50 disabled:shadow-none flex items-center gap-2"
                                    >
                                        ✅ تسجيل البيع
                                        <kbd className="hidden md:inline-block text-[10px] font-mono bg-emerald-700/50 px-1.5 py-0.5 rounded">⏎</kbd>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div >
            </ConfirmationModal >
            <ConfirmationModal
                isOpen={inStoreCreditOverrideModalOpen}
                onClose={() => {
                    if (isInStoreCreating) return;
                    setInStoreCreditOverrideModalOpen(false);
                    setInStoreCreditOverridePending(null);
                    setInStoreCreditOverrideReason('');
                }}
                onConfirm={async () => {
                    const payload = inStoreCreditOverridePending;
                    const reason = String(inStoreCreditOverrideReason || '').trim();
                    if (!payload) {
                        setInStoreCreditOverrideModalOpen(false);
                        return;
                    }
                    if (!reason) {
                        showNotification('يرجى إدخال سبب التجاوز.', 'error');
                        return;
                    }
                    setInStoreCreditOverrideModalOpen(false);
                    setInStoreCreditOverridePending(null);
                    await runCreateInStoreSale(payload, reason);
                }}
                title="موافقة تجاوز سقف ائتمان الطرف"
                message=""
                isConfirming={isInStoreCreating}
                confirmText="اعتماد التجاوز"
                confirmingText="جاري الاعتماد..."
                cancelText="رجوع"
                confirmButtonClassName="bg-red-600 hover:bg-red-700 disabled:bg-red-400"
            >
                <div className="space-y-3">
                    <div className="text-sm text-gray-700 dark:text-gray-200">
                        هذا البيع الآجل يحتاج تجاوز سقف الائتمان أو الطرف عليه Credit Hold. سيتم تسجيل الموافقة في سجل التدقيق.
                    </div>
                    <textarea
                        rows={4}
                        value={inStoreCreditOverrideReason}
                        onChange={(e) => setInStoreCreditOverrideReason(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="اكتب سبب التجاوز..."
                    />
                </div>
            </ConfirmationModal>
            <ConfirmationModal
                isOpen={inStoreBelowCostModalOpen}
                onClose={() => {
                    if (isInStoreCreating) return;
                    setInStoreBelowCostModalOpen(false);
                    setInStoreBelowCostPending(null);
                    setInStoreBelowCostReason('');
                }}
                onConfirm={async () => {
                    const pending = inStoreBelowCostPending;
                    const reason = String(inStoreBelowCostReason || '').trim();
                    if (!pending) {
                        setInStoreBelowCostModalOpen(false);
                        return;
                    }
                    if (!reason) {
                        showNotification('يرجى إدخال سبب التجاوز.', 'error');
                        return;
                    }
                    setInStoreBelowCostModalOpen(false);
                    setInStoreBelowCostPending(null);
                    await runCreateInStoreSale({
                        ...pending.payload,
                        belowCostOverrideReason: reason,
                        existingOrderId: pending.pendingOrderId || (pending.payload as any)?.existingOrderId,
                    }, pending.creditOverrideReason);
                }}
                title="سبب البيع تحت التكلفة"
                message=""
                isConfirming={isInStoreCreating}
                confirmText="متابعة"
                confirmingText="جارٍ التنفيذ..."
                cancelText="رجوع"
                confirmButtonClassName="bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400"
            >
                <div className="space-y-3">
                    <div className="text-sm text-gray-700 dark:text-gray-200">
                        هذا البيع يحتوي صنفاً بسعر صافي أقل من الحد الأدنى (حسب التكلفة/هامش الربح). أدخل سبباً للتجاوز حتى يُسجّل في سجل التدقيق.
                    </div>
                    <textarea
                        rows={4}
                        value={inStoreBelowCostReason}
                        onChange={(e) => setInStoreBelowCostReason(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="اكتب سبب التجاوز..."
                    />
                </div>
            </ConfirmationModal>
            <ConfirmationModal
                isOpen={Boolean(resumePendingBelowCostOrderId)}
                onClose={() => {
                    if (resumePendingBusyId) return;
                    setResumePendingBelowCostOrderId(null);
                    setResumePendingBelowCostReason('');
                }}
                onConfirm={async () => {
                    const orderId = String(resumePendingBelowCostOrderId || '').trim();
                    const reason = String(resumePendingBelowCostReason || '').trim();
                    if (!orderId) {
                        setResumePendingBelowCostOrderId(null);
                        return;
                    }
                    if (!reason) {
                        showNotification('يرجى إدخال سبب التجاوز.', 'error');
                        return;
                    }
                    const order = orders.find(o => o.id === orderId);
                    setResumePendingBelowCostOrderId(null);
                    setResumePendingBelowCostReason('');
                    if (!order) {
                        showNotification('الطلب غير موجود.', 'error');
                        return;
                    }
                    await attemptResumeInStorePending(order, reason);
                }}
                title="سبب البيع تحت التكلفة (إتمام طلب معلّق)"
                message=""
                isConfirming={Boolean(resumePendingBusyId)}
                confirmText="متابعة"
                confirmingText="جارٍ الإتمام..."
                cancelText="رجوع"
                confirmButtonClassName="bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400"
            >
                <div className="space-y-3">
                    <div className="text-sm text-gray-700 dark:text-gray-200">
                        هذا الطلب المعلّق يحتوي صنفاً بسعر صافي أقل من الحد الأدنى. أدخل سبباً للتجاوز ثم أعد المحاولة.
                    </div>
                    <textarea
                        rows={4}
                        value={resumePendingBelowCostReason}
                        onChange={(e) => setResumePendingBelowCostReason(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="اكتب سبب التجاوز..."
                    />
                </div>
            </ConfirmationModal>
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
                isOpen={Boolean(editOrderId)}
                onClose={() => {
                    setEditOrderId(null);
                    setEditChangesByCartItemId({});
                    setEditReservationResult([]);
                }}
                onConfirm={async () => {
                    if (!assertMutableOrdersView()) return;
                    if (!editOrderId) return;
                    const supabase = getSupabaseClient();
                    if (!supabase) return;
                    const order = orders.find(o => o.id === editOrderId);
                    if (!order) return;
                    const status = String(order.status || '').trim();
                    const warehouseId = (order as any)?.warehouseId || sessionScope.scope?.warehouseId || '';
                    const baseItems = (order.items || []).map((it: any) => ({ ...it }));
                    const updatedItems = baseItems.map((it: any) => {
                        const patch = editChangesByCartItemId[it.cartItemId || it.id || ''] || {};
                        if (patch.quantity != null && !(it.unitType === 'kg' || it.unitType === 'gram')) {
                            it.quantity = Number(patch.quantity) || 0;
                        }
                        if (patch.uomCode != null && !(it.unitType === 'kg' || it.unitType === 'gram')) {
                            (it as any).uomCode = String(patch.uomCode || '').trim();
                            (it as any).uomQtyInBase = Number(patch.uomQtyInBase || 1) || 1;
                        }
                        return it;
                    });
                    const isWeightBasedUnit = (u: string | undefined) => (u === 'kg' || u === 'gram');
                    const getBaseQty = (it: any) => {
                        const unit = String(it?.unitType || it?.unit || 'piece');
                        if (isWeightBasedUnit(unit)) {
                            return Number(it?.weight) || Number(it?.quantity) || 0;
                        }
                        const factor = Number((it as any)?.uomQtyInBase || 1) || 1;
                        return (Number(it?.quantity) || 0) * factor;
                    };
                    const mergeByItemId = (list: any[]) => {
                        const merged = new Map<string, number>();
                        for (const it of list) {
                            const isPromo = Boolean((it as any)?.lineType === 'promotion' || (it as any)?.promotionId);
                            if (isPromo) continue;
                            const itemId = String((it as any)?.itemId || (it as any)?.id || '').trim();
                            const qty = Number(getBaseQty(it)) || 0;
                            if (!itemId || !(qty > 0)) continue;
                            merged.set(itemId, (merged.get(itemId) || 0) + qty);
                        }
                        return Array.from(merged.entries()).map(([itemId, quantity]) => ({ itemId, quantity }));
                    };
                    const releaseItems = mergeByItemId(baseItems);
                    const reserveItems = mergeByItemId(updatedItems);
                    const nextData = { ...(order as any) };
                    nextData.items = updatedItems;
                    try {
                        if (warehouseId && (status === 'pending' || status === 'preparing')) {
                            if (releaseItems.length > 0) {
                                const { error: relErr } = await supabase.rpc('release_reserved_stock_for_order', {
                                    p_items: releaseItems,
                                    p_order_id: order.id,
                                    p_warehouse_id: warehouseId,
                                });
                                if (relErr) throw relErr;
                            }
                            if (reserveItems.length > 0) {
                                const { error: resErr } = await supabase.rpc('reserve_stock_for_order', {
                                    p_items: reserveItems,
                                    p_order_id: order.id,
                                    p_warehouse_id: warehouseId,
                                });
                                if (resErr) throw resErr;
                            }
                        }
                        const { error } = await supabase
                            .from('orders')
                            .update({ data: nextData, items: updatedItems })
                            .eq('id', editOrderId);
                        if (error) throw error;
                        const names = new Map<string, string>();
                        for (const it of baseItems) {
                            const itemId = String((it as any)?.itemId || (it as any)?.id || '').trim();
                            const name = String((it as any)?.name?.ar || (it as any)?.name?.en || (it as any)?.name || (it as any)?.itemName || itemId);
                            if (itemId) names.set(itemId, name);
                        }
                        for (const it of updatedItems) {
                            const itemId = String((it as any)?.itemId || (it as any)?.id || '').trim();
                            const name = String((it as any)?.name?.ar || (it as any)?.name?.en || (it as any)?.name || (it as any)?.itemName || itemId);
                            if (itemId && !names.has(itemId)) names.set(itemId, name);
                        }
                        const releasedMap = new Map<string, number>(releaseItems.map(r => [r.itemId, Number(r.quantity) || 0]));
                        const reservedMap = new Map<string, number>(reserveItems.map(r => [r.itemId, Number(r.quantity) || 0]));
                        const allIds = Array.from(new Set<string>([...releasedMap.keys(), ...reservedMap.keys()]));
                        const result = allIds.map(id => ({
                            itemId: id,
                            released: Number(releasedMap.get(id) || 0),
                            reserved: Number(reservedMap.get(id) || 0),
                            name: names.get(id),
                        })).filter(r => (r.released > 0 || r.reserved > 0));
                        setEditReservationResult(result);
                        showNotification('تم حفظ تعديلات الأصناف للطلب بنجاح.', 'success');
                    } catch (err) {
                        showNotification(localizeSupabaseError(err) || 'تعذر حفظ التعديلات.', 'error');
                    } finally {
                    }
                }}
                title="تعديل أصناف الطلب"
                message=""
                isConfirming={false}
                confirmText="حفظ التعديلات"
                confirmingText="جارٍ الحفظ..."
                cancelText="إلغاء"
                maxWidthClassName="max-w-3xl"
                hideConfirmButton={editReservationResult.length > 0}
            >
                {editOrderId && (() => {
                    const order = orders.find(o => o.id === editOrderId);
                    if (!order) return null;
                    const items = (order.items || []) as CartItem[];
                    return (
                        <div className="space-y-3">
                            {editReservationResult.length > 0 && (
                                <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-900/20">
                                    <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">تم تحديث الحجز</div>
                                    <div className="mt-2 space-y-1">
                                        {editReservationResult.map((r) => (
                                            <div key={r.itemId} className="text-xs text-gray-700 dark:text-gray-200 flex items-center justify-between gap-2">
                                                <div className="truncate">{r.name || r.itemId}</div>
                                                <div className="flex items-center gap-3 font-mono">
                                                    <span className="px-2 py-0.5 rounded bg-gray-100 border border-gray-200 dark:bg-gray-800 dark:border-gray-700">حرر: {Number(r.released || 0)}</span>
                                                    <span className="px-2 py-0.5 rounded bg-gray-100 border border-gray-200 dark:bg-gray-800 dark:border-gray-700">حجز: {Number(r.reserved || 0)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {items.map((it: CartItem) => {
                                const isWeight = (it as any).unitType === 'kg' || (it as any).unitType === 'gram';
                                const cartId = it.cartItemId || (it as any).id || '';
                                const name = (it as any).name?.[language] || (it as any).name?.ar || (it as any).name?.en || (it as any).name || (it as any).itemName || '';
                                const uoms = itemUomRowsByItemId[(it as any).id || (it as any).itemId || ''] || (Array.isArray((it as any)?.uomUnits) ? (it as any).uomUnits : []);
                                const baseLabel = (it as any).unitType || 'piece';
                                return (
                                    <div key={cartId} className="flex items-center justify-between gap-2 p-2 border rounded-md dark:border-gray-700">
                                        <div className="min-w-0">
                                            <div className="font-semibold text-sm dark:text-white truncate">{name}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">{isWeight ? 'وزني' : 'غير وزني'}</div>
                                        </div>
                                        {!isWeight ? (
                                            <div className="flex items-center gap-2">
                                                <NumberInput
                                                    id={`edit-qty-${cartId}`}
                                                    name={`edit-qty-${cartId}`}
                                                    value={Number((editChangesByCartItemId[cartId]?.quantity ?? it.quantity) || 0)}
                                                    onChange={(e) => {
                                                        const val = parseFloat(e.target.value) || 0;
                                                        setEditChangesByCartItemId(prev => ({ ...prev, [cartId]: { ...(prev[cartId] || {}), quantity: val } }));
                                                    }}
                                                    min={0}
                                                    step={1}
                                                />
                                                <select
                                                    value={String((editChangesByCartItemId[cartId]?.uomCode ?? (it as any).uomCode ?? baseLabel) || baseLabel)}
                                                    onChange={(e) => {
                                                        const code = String(e.target.value || '').trim();
                                                        const found = (uoms || []).find((o: any) => String(o?.code || '') === code);
                                                        const qtyBase = Number(found?.qtyInBase || (code === baseLabel ? 1 : 0)) || (code === baseLabel ? 1 : 0);
                                                        setEditChangesByCartItemId(prev => ({ ...prev, [cartId]: { ...(prev[cartId] || {}), uomCode: code, uomQtyInBase: qtyBase } }));
                                                    }}
                                                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                >
                                                    {(() => {
                                                        const baseDisplay = getUnitLabel(baseLabel as any, 'ar') || localizeUomCodeAr(baseLabel);
                                                        const baseOpt = [{ code: baseLabel, name: baseDisplay, qtyInBase: 1 }];
                                                        const merged = [...baseOpt, ...(uoms || []).filter((o: any) => String(o?.code || '') !== baseLabel)];
                                                        return merged.map((o: any) => {
                                                            const nameRaw = String(o.name || '').trim();
                                                            const displayName = nameRaw || getUnitLabel(String(o.code || '') as any, 'ar') || localizeUomCodeAr(String(o.code || ''));
                                                            const qtyText = Number(o.qtyInBase) > 1 ? ` (${Number(o.qtyInBase)} ${baseDisplay})` : '';
                                                            return (
                                                                <option key={o.code} value={o.code}>
                                                                    {displayName}{qtyText}
                                                                </option>
                                                            );
                                                        });
                                                    })()}
                                                </select>
                                            </div>
                                        ) : (
                                            <div className="text-xs text-gray-500 dark:text-gray-400">الوزن: {Number((it as any).weight || 0)}</div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}
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
                    const currency = String((order as any).currency || '').toUpperCase() || baseCode;
                    const paid = roundMoneyByCode(Number(paidSumByOrderId[partialPaymentOrderId]) || 0, currency);
                    const total = roundMoneyByCode(Number(order.total) || 0, currency);
                    const remaining = roundMoneyByCode(Math.max(0, total - paid), currency);
                    return (
                        <div className="space-y-4">
                            <div className="grid grid-cols-3 gap-3 text-xs">
                                <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                                    <div className="text-gray-500 dark:text-gray-300">الإجمالي</div>
                                    <CurrencyDualAmount
                                        amount={Number(order.total) || 0}
                                        currencyCode={(order as any).currency}
                                        baseAmount={(order as any).baseTotal}
                                        fxRate={(order as any).fxRate}
                                        baseCurrencyCode={baseCode}
                                        compact
                                    />
                                </div>
                                <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                                    <div className="text-gray-500 dark:text-gray-300">مدفوع</div>
                                    <CurrencyDualAmount
                                        amount={paid}
                                        currencyCode={(order as any).currency}
                                        baseAmount={undefined}
                                        fxRate={(order as any).fxRate}
                                        compact
                                    />
                                </div>
                                <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                                    <div className="text-gray-500 dark:text-gray-300">متبقي</div>
                                    <CurrencyDualAmount
                                        amount={remaining}
                                        currencyCode={(order as any).currency}
                                        baseAmount={undefined}
                                        fxRate={(order as any).fxRate}
                                        compact
                                    />
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
                            {(partialPaymentMethod === 'kuraimi' || partialPaymentMethod === 'network') && (
                                <div className="p-3 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-md space-y-3">
                                    <div className="text-xs font-semibold text-blue-800 dark:text-blue-300">
                                        {partialPaymentMethod === 'kuraimi' ? 'بيانات الإيداع البنكي' : 'بيانات الحوالة'}
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-700 dark:text-gray-300 mb-1">تحديد الحساب المالي</label>
                                        <select
                                            value={partialPaymentDestinationAccountId}
                                            onChange={(e) => setPartialPaymentDestinationAccountId(e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                        >
                                            <option value="">(افتراضي)</option>
                                            {availablePartialDestinations
                                                .filter(a => partialPaymentMethod === 'kuraimi' ? a.parentCode === '1020' : a.parentCode === '1030')
                                                .map(a => (
                                                    <option key={a.id} value={a.id}>{a.name}</option>
                                                ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-700 dark:text-gray-300 mb-1">
                                            {partialPaymentMethod === 'kuraimi' ? 'رقم الإيداع' : 'رقم الحوالة'}
                                        </label>
                                        <input
                                            type="text"
                                            value={partialPaymentReferenceNumber}
                                            onChange={(e) => setPartialPaymentReferenceNumber(e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                            placeholder={partialPaymentMethod === 'kuraimi' ? 'مثال: DEP-12345' : 'مثال: TRX-12345'}
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs text-gray-700 dark:text-gray-300 mb-1">
                                                {partialPaymentMethod === 'kuraimi' ? 'اسم المودِع' : 'اسم المرسل'}
                                            </label>
                                            <input
                                                type="text"
                                                value={partialPaymentSenderName}
                                                onChange={(e) => setPartialPaymentSenderName(e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-700 dark:text-gray-300 mb-1">
                                                {partialPaymentMethod === 'kuraimi' ? 'رقم هاتف المودِع (اختياري)' : 'رقم هاتف المرسل (اختياري)'}
                                            </label>
                                            <input
                                                type="text"
                                                value={partialPaymentSenderPhone}
                                                onChange={(e) => setPartialPaymentSenderPhone(e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                placeholder="مثال: 771234567"
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                                        <div>
                                            <label className="block text-xs text-gray-700 dark:text-gray-300 mb-1">
                                                مبلغ العملية (يجب أن يطابق مبلغ هذه الدفعة)
                                            </label>
                                            <NumberInput
                                                id="partialPaymentDeclaredAmount"
                                                name="partialPaymentDeclaredAmount"
                                                value={partialPaymentDeclaredAmount}
                                                onChange={(e) => setPartialPaymentDeclaredAmount(parseFloat(e.target.value) || 0)}
                                                min={0}
                                                step={1}
                                                className={(Math.abs((Number(partialPaymentDeclaredAmount) || 0) - (Number(partialPaymentAmount) || 0)) > 0.0001) ? 'border-red-500' : ''}
                                            />
                                            <div className="mt-1">
                                                <CurrencyDualAmount
                                                    amount={Number(partialPaymentAmount) || 0}
                                                    currencyCode={(order as any).currency}
                                                    baseAmount={undefined}
                                                    fxRate={(order as any).fxRate}
                                                    baseCurrencyCode={baseCode}
                                                    label="مبلغ الدفعة الحالي"
                                                    compact
                                                />
                                            </div>
                                        </div>
                                        <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                            <input
                                                type="checkbox"
                                                checked={partialPaymentAmountConfirmed}
                                                onChange={(e) => setPartialPaymentAmountConfirmed(e.target.checked)}
                                                className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500"
                                            />
                                            أؤكد مطابقة المبلغ وتم التحقق منه
                                        </label>
                                    </div>
                                </div>
                            )}
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
                            {canViewAccounting && (
                                <div className="space-y-2 rounded-md border border-gray-200 dark:border-gray-700 p-3">
                                    <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-200">
                                        <input
                                            type="checkbox"
                                            checked={partialPaymentAdvancedAccounting}
                                            onChange={(e) => setPartialPaymentAdvancedAccounting(e.target.checked)}
                                        />
                                        إعدادات محاسبية متقدمة
                                    </label>
                                    {partialPaymentAdvancedAccounting && (
                                        <div>
                                            <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">الحساب المحاسبي البديل (Advanced)</label>
                                            <select
                                                value={partialPaymentOverrideAccountId}
                                                onChange={(e) => setPartialPaymentOverrideAccountId(e.target.value)}
                                                disabled={!canManageAccounting}
                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-60"
                                            >
                                                <option value="">-- بدون --</option>
                                                {accounts.map(a => (
                                                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                                                ))}
                                            </select>
                                            {accountsError && (
                                                <div className="mt-1 text-[10px] text-red-600">{accountsError}</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
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
                    setReturnUnits({});
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
                maxWidthClassName="max-w-4xl"
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
                                {(order.items || []).map((item: any) => {
                                    const itemId = item.cartItemId || item.id;
                                    const unitType = (item as any).unitType;
                                    const isWeightBased = isWeightBasedUnit(unitType as any);
                                    const salesQty = isWeightBased ? (Number((item as any).weight) || 0) : (Number(item.quantity) || 0);
                                    const orderUomQtyInBase = Number((item as any).uomQtyInBase || 1) || 1;
                                    const totalBaseQty = isWeightBased ? salesQty : (salesQty * orderUomQtyInBase);
                                    const itemName = item.name?.ar || item.name?.en || 'Item';
                                    const menuItemId = String(item.id || item.menuItemId || itemId || '').trim();
                                    const options = !isWeightBased ? getReturnUomOptions(item, menuItemId || String(itemId)) : [];
                                    const defaultCode = String(returnUnits[itemId] || (item as any).uomCode || unitType || 'piece').trim().toLowerCase();
                                    const selectedOption = !isWeightBased
                                        ? (options.find(o => o.code === defaultCode) || options[0] || { code: String(unitType || 'piece').toLowerCase(), name: unitType, qtyInBase: 1 })
                                        : null;
                                    const selectedQtyInBase = isWeightBased ? 1 : (Number(selectedOption?.qtyInBase || 1) || 1);
                                    const maxQty = isWeightBased
                                        ? salesQty
                                        : (selectedQtyInBase > 0 ? (totalBaseQty / selectedQtyInBase) : salesQty);
                                    const currentReturnQty = returnItems[itemId] || 0;

                                    return (
                                        <div key={itemId} className="flex items-center justify-between p-2 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800">
                                            <div className="flex-1">
                                                <div className="font-semibold text-sm">{itemName}</div>
                                                <div className="text-xs text-gray-500">
                                                    {isWeightBased ? 'الوزن في الطلب: ' : 'الكمية في الطلب: '}
                                                    {salesQty}
                                                    {!isWeightBased && totalBaseQty > 0 && (
                                                        <span className="ms-2 text-[11px] text-gray-400">
                                                            (بالأساس: {totalBaseQty})
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {!isWeightBased && options.length > 0 && (
                                                    <select
                                                        value={selectedOption?.code || ''}
                                                        onChange={(e) => {
                                                            const nextCode = String(e.target.value || '').trim().toLowerCase();
                                                            const nextOpt = options.find(o => o.code === nextCode);
                                                            const nextQtyInBase = Number(nextOpt?.qtyInBase || 1) || 1;
                                                            const nextMax = nextQtyInBase > 0 ? (totalBaseQty / nextQtyInBase) : maxQty;
                                                            setReturnUnits(prev => ({ ...prev, [itemId]: nextCode }));
                                                            setReturnItems(prev => ({ ...prev, [itemId]: Math.min(prev[itemId] || 0, nextMax) }));
                                                        }}
                                                        className="h-8 px-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-xs"
                                                    >
                                                        {options.map((opt) => (
                                                            <option key={opt.code} value={opt.code}>
                                                                {opt.name || opt.code} ({opt.qtyInBase})
                                                            </option>
                                                        ))}
                                                    </select>
                                                )}
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
                                                    className="w-40"
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
                                    <option value="ar">تخفيض ذمة مدينة (آجل)</option>
                                    <option value="store_credit">رصيد عميل</option>
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
                                            const item = (order.items || []).find(i => i.cartItemId === cartItemId);
                                            if (!item) return sum;
                                            const unitType = (item as any).unitType;
                                            const isWeightBased = isWeightBasedUnit(unitType as any);
                                            const totalQty = isWeightBased ? (Number((item as any).weight) || 0) : (Number(item.quantity) || 0);
                                            if (!(totalQty > 0)) return sum;
                                            const unitPrice = unitType === 'gram' && (item as any).pricePerUnit ? (Number((item as any).pricePerUnit) || 0) / 1000 : (Number(item.price) || 0);
                                            const addonsCost = Object.values((item as any).selectedAddons || {}).reduce((s: number, entry: any) => {
                                                const addonPrice = Number(entry?.addon?.price) || 0;
                                                const addonQty = Number(entry?.quantity) || 0;
                                                return s + (addonPrice * addonQty);
                                            }, 0);
                                            const uomQtyInBase = Number((item as any).uomQtyInBase || 1) || 1;
                                            const lineGross = isWeightBased
                                                ? (unitPrice * totalQty) + addonsCost
                                                : ((unitPrice * uomQtyInBase) + addonsCost) * totalQty;
                                            const menuItemId = String(item.id || (item as any).menuItemId || cartItemId || '').trim();
                                            const options = !isWeightBased ? getReturnUomOptions(item, menuItemId || String(cartItemId)) : [];
                                            const defaultCode = String(returnUnits[cartItemId] || (item as any).uomCode || unitType || 'piece').trim().toLowerCase();
                                            const selectedOption = !isWeightBased
                                                ? (options.find(o => o.code === defaultCode) || options[0] || { code: String(unitType || 'piece').toLowerCase(), name: unitType, qtyInBase: 1 })
                                                : null;
                                            const selectedQtyInBase = isWeightBased ? 1 : (Number(selectedOption?.qtyInBase || 1) || 1);
                                            const totalBaseQty = isWeightBased ? totalQty : (totalQty * uomQtyInBase);
                                            const qtyBase = isWeightBased
                                                ? Number(qty) || 0
                                                : (Number(qty) || 0) * selectedQtyInBase;
                                            const proportion = totalBaseQty > 0 ? Math.max(0, Math.min(1, qtyBase / totalBaseQty)) : 0;
                                            return sum + (lineGross * proportion * discountFactor);
                                        }, 0);

                                        return (
                                            <CurrencyDualAmount
                                                amount={Number(total)}
                                                currencyCode={(order as any).currency}
                                                baseAmount={(order as any).baseTotal}
                                                fxRate={(order as any).fxRate}
                                                baseCurrencyCode={baseCode}
                                                compact
                                            />
                                        );
                                    })()}
                                </span>
                            </div>
                        </div>
                    );
                })()}
            </ConfirmationModal>

            <ConfirmationModal
                isOpen={Boolean(voidOrderId)}
                onClose={() => {
                    if (isVoidingOrder) return;
                    setVoidOrderId(null);
                    setVoidReason('');
                }}
                onConfirm={handleConfirmVoidDelivered}
                title="إلغاء بعد التسليم (عكس)"
                message=""
                isConfirming={isVoidingOrder}
                confirmText="تأكيد العكس"
                confirmingText="جاري التنفيذ..."
                cancelText="إلغاء"
                confirmButtonClassName="bg-purple-700 hover:bg-purple-800 disabled:bg-purple-400"
                maxWidthClassName="max-w-2xl"
            >
                <div className="space-y-3">
                    <div className="bg-purple-50 dark:bg-purple-900/20 p-3 rounded-md text-sm text-purple-900 dark:text-purple-200">
                        هذا الإجراء يعكس قيود الإيراد/الضريبة/الذمم ويعيد المخزون، ويضع علامة “تم الإلغاء بعد التسليم” على الطلب.
                    </div>
                    <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">سبب الإلغاء</label>
                        <textarea
                            value={voidReason}
                            onChange={(e) => setVoidReason(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            rows={2}
                            placeholder="مثال: إلغاء إداري، خطأ في الفاتورة..."
                        />
                    </div>
                </div>
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
                        {canManageAccounting && (
                            <div className="flex items-center justify-end">
                                <button
                                    type="button"
                                    disabled={returnsDocsRepairing}
                                    onClick={() => void handleRepairLegacySalesReturnDocuments()}
                                    className="px-3 py-2 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60"
                                >
                                    {returnsDocsRepairing ? 'جاري الإصلاح...' : 'إصلاح سندات الصرف للمرتجعات القديمة'}
                                </button>
                            </div>
                        )}
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
                                                <div className="flex items-center gap-2">
                                                    <div className="text-xs text-gray-600 dark:text-gray-300">
                                                        {r.status === 'completed' ? 'مكتمل' : (r.status === 'draft' ? 'مسودة' : 'ملغي')}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (!returnsOrder) return;
                                                            void handlePrintSalesReturn(String(r.id), returnsOrder);
                                                        }}
                                                        className="px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                                                    >
                                                        طباعة
                                                    </button>
                                                    {r.status === 'completed' && (
                                                        <>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    if (!returnsOrder) return;
                                                                    void handlePrintSalesReturnPaymentVoucher(String(r.id), returnsOrder);
                                                                }}
                                                                className="px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                                                            >
                                                                سند صرف
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    if (!returnsOrder) return;
                                                                    void handlePrintSalesReturnJournalVoucher(String(r.id), returnsOrder);
                                                                }}
                                                                className="px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                                                            >
                                                                قيد
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            {r.status === 'draft' && (
                                                <div className="mt-2 flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        disabled={Boolean(returnsActionBusy.id)}
                                                        onClick={() => {
                                                            if (!returnsOrderId) return;
                                                            void retryProcessDraftReturn(returnsOrderId, String(r.id));
                                                        }}
                                                        className="px-3 py-2 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
                                                    >
                                                        {returnsActionBusy.id === String(r.id) && returnsActionBusy.action === 'process' ? 'جاري الإكمال...' : 'إكمال المرتجع'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={Boolean(returnsActionBusy.id)}
                                                        onClick={() => {
                                                            if (!returnsOrderId) return;
                                                            void cancelDraftReturn(returnsOrderId, String(r.id));
                                                        }}
                                                        className="px-3 py-2 rounded-md bg-gray-200 text-gray-800 text-xs font-semibold hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 disabled:opacity-60"
                                                    >
                                                        {returnsActionBusy.id === String(r.id) && returnsActionBusy.action === 'cancel' ? 'جاري الإلغاء...' : 'إلغاء المسودة'}
                                                    </button>
                                                </div>
                                            )}
                                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                                التاريخ: {String(r.returnDate || r.return_date || '').slice(0, 19).replace('T', ' ')}
                                            </div>
                                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                                طريقة الرد: {paymentTranslations[String(r.refundMethod || r.refund_method || 'unknown')] || String(r.refundMethod || r.refund_method || 'غير محدد')}
                                            </div>
                                            <CurrencyDualAmount
                                                amount={Number(r.totalRefundAmount ?? r.total_refund_amount ?? 0)}
                                                currencyCode={(returnsOrder as any)?.currency}
                                                baseAmount={(returnsOrder as any)?.baseTotal}
                                                fxRate={(returnsOrder as any)?.fxRate}
                                                baseCurrencyCode={baseCode}
                                                label="المبلغ"
                                                compact
                                            />
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

            {/* Purge Payment Confirmation Modal */}
            <ConfirmationModal
                isOpen={Boolean(purgePaymentOrderId)}
                onClose={() => {
                    if (isPurgingPayment) return;
                    setPurgePaymentOrderId(null);
                    setPurgePaymentReason('');
                    setPurgePaymentReasonCategory('misapplied_payment');
                }}
                onConfirm={executePurgePayment}
                title="طلب عكس دفعة مع اعتماد ثنائي"
                message=""
                isConfirming={isPurgingPayment}
                confirmText="إرسال طلب العكس"
                confirmingText="جاري الإرسال..."
                confirmButtonClassName="bg-red-700 hover:bg-red-800 disabled:bg-red-400"
            >
                <div className="space-y-4">
                    <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-sm text-red-800 dark:text-red-200 leading-relaxed">
                        <p className="font-semibold mb-1">ضوابط التنفيذ:</p>
                        <ul className="list-disc list-inside space-y-1 text-xs">
                            <li>لا يتم حذف القيود، يتم إنشاء قيود عكس فقط</li>
                            <li>يتطلب اعتماد مستخدم ثانٍ مختلف عن مقدم الطلب</li>
                            <li>يرفض التنفيذ داخل الفترات المحاسبية المغلقة</li>
                        </ul>
                        <p className="mt-2 font-bold">السبب إلزامي (20 حرفًا على الأقل).</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تصنيف السبب *</label>
                        <select
                            value={purgePaymentReasonCategory}
                            onChange={(e) => setPurgePaymentReasonCategory(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            disabled={isPurgingPayment}
                        >
                            <option value="misapplied_payment">دفعة مسجلة على الطلب الخطأ</option>
                            <option value="duplicate_settlement">تسوية مكررة</option>
                            <option value="fraud_risk">اشتباه احتيال/مخاطر</option>
                            <option value="compliance_correction">تصحيح امتثال وتدقيق</option>
                            <option value="other">أخرى</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">سبب العكس *</label>
                        <input
                            type="text"
                            value={purgePaymentReason}
                            onChange={(e) => setPurgePaymentReason(e.target.value)}
                            placeholder="مثال: تم تسجيل التحصيل على فاتورة خاطئة وتم اكتشافها عبر المطابقة البنكية"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                            disabled={isPurgingPayment}
                        />
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                        الطلب: #{purgePaymentOrderId?.slice(-6).toUpperCase()}
                    </div>
                </div>
            </ConfirmationModal>
            <ConfirmationModal
                isOpen={Boolean(approvePurgeRequestId)}
                onClose={() => {
                    if (isApprovingPurge) return;
                    setApprovePurgeRequestId(null);
                    setPurgeApprovalNote('');
                }}
                onConfirm={executeApprovePurge}
                title="اعتماد عكس الدفعة"
                message=""
                isConfirming={isApprovingPurge}
                confirmText="اعتماد وتنفيذ"
                confirmingText="جاري التنفيذ..."
                confirmButtonClassName="bg-indigo-700 hover:bg-indigo-800 disabled:bg-indigo-400"
            >
                <div className="space-y-3">
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                        سيتم إنشاء قيد/قيود عكس محاسبية بدل الحذف، وتوثيق العملية بسجل تدقيق عالي الخطورة.
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ملاحظة الاعتماد *</label>
                        <input
                            type="text"
                            value={purgeApprovalNote}
                            onChange={(e) => setPurgeApprovalNote(e.target.value)}
                            placeholder="مثال: تمت المراجعة والمطابقة البنكية وتمت الموافقة على العكس"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            disabled={isApprovingPurge}
                        />
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                        رقم الطلب: #{approvePurgeRequestId?.slice(-6).toUpperCase()}
                    </div>
                </div>
            </ConfirmationModal>
        </div >
    );
};

export default ManageOrdersScreen;
