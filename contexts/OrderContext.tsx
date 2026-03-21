import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback, useMemo, useRef } from 'react';
import type { CartItem, Order, OrderStatus, StockManagement, OrderAuditAction, OrderAuditActorType, OrderAuditEvent, MenuItem } from '../types';
import { useUserAuth } from './UserAuthContext';
import { useSettings } from './SettingsContext';
import { useChallenges } from './ChallengeContext';
import { useAuth } from './AuthContext';
import { useSessionScope } from './SessionScopeContext';
import { generateInvoiceNumber } from '../utils/orderUtils';
import { disableRealtime, getBaseCurrencyCode, getSupabaseClient, isRealtimeEnabled, isRpcStrictMode, isRpcWrappersAvailable, markRpcStrictModeEnabled, reloadPostgrestSchema, rpcHasFunction } from '../supabase';
import { createLogger, measurePerformance } from '../utils/logger';
import { localizeSupabaseError, isAbortLikeError, resolveErrorMessage } from '../utils/errorUtils';
import { enqueueRpc, upsertOfflinePosOrder } from '../utils/offlineQueue';
import { decryptField, isEncrypted } from '../utils/encryption';
import { getCurrencyDecimalsByCode } from '../utils/currencyDecimals';

const logger = createLogger('OrderContext');

interface OrderContextType {
  orders: Order[];
  userOrders: Order[];
  loading: boolean;
  addOrder: (orderData: Omit<Order, 'id' | 'createdAt' | 'status' | 'userId' | 'pointsEarned'>) => Promise<Order>;
  createInStoreSale: (input: {
    lines: Array<
      | { menuItemId: string; quantity?: number; weight?: number; selectedAddons?: Record<string, number> }
      | { promotionId: string; bundleQty?: number; promotionLineId?: string; promotionSnapshot?: any }
    >;
    currency?: string;
    customerId?: string;
    partyId?: string;
    customerName?: string;
    phoneNumber?: string;
    notes?: string;
    invoiceStatement?: string;
    discountType?: 'amount' | 'percent';
    discountValue?: number;
    paymentMethod: string;
    paymentReferenceNumber?: string;
    paymentSenderName?: string;
    paymentSenderPhone?: string;
    paymentDeclaredAmount?: number;
    paymentAmountConfirmed?: boolean;
    paymentDestinationAccountId?: string;
    isCredit?: boolean;
    creditDays?: number;
    dueDate?: string;
    creditOverrideReason?: string;
    existingOrderId?: string;
    paymentBreakdown?: Array<{
      method: string;
      amount: number;
      referenceNumber?: string;
      senderName?: string;
      senderPhone?: string;
      declaredAmount?: number;
      amountConfirmed?: boolean;
      destinationAccountId?: string;
      cashReceived?: number;
    }>;
  }) => Promise<Order>;
  createInStorePendingOrder: (input: {
    lines: Array<
      | { menuItemId: string; quantity?: number; weight?: number; selectedAddons?: Record<string, number> }
      | { promotionId: string; bundleQty?: number; promotionLineId?: string; promotionSnapshot?: any }
    >;
    currency?: string;
    customerId?: string;
    partyId?: string;
    discountType?: 'amount' | 'percent';
    discountValue?: number;
    customerName?: string;
    phoneNumber?: string;
    notes?: string;
  }) => Promise<Order>;
  createInStoreDraftQuotation: (input: {
    lines: Array<
      | { menuItemId: string; quantity?: number; weight?: number; selectedAddons?: Record<string, number> }
    >;
    customerId?: string;
    partyId?: string;
    customerName?: string;
    phoneNumber?: string;
    notes?: string;
    invoiceStatement?: string;
    discountType?: 'amount' | 'percent';
    discountValue?: number;
  }) => Promise<Order>;
  resumeInStorePendingOrder: (orderId: string, payment: {
    paymentMethod: string;
    paymentBreakdown?: Array<{
      method: string;
      amount: number;
      referenceNumber?: string;
      senderName?: string;
      senderPhone?: string;
      declaredAmount?: number;
      amountConfirmed?: boolean;
      destinationAccountId?: string;
      cashReceived?: number;
    }>;
    occurredAt?: string;
    belowCostOverrideReason?: string;
  }) => Promise<Order>;
  cancelInStorePendingOrder: (orderId: string) => Promise<void>;
  updateOrderStatus: (orderId: string, status: OrderStatus, meta?: { deliveredLocation?: { lat: number; lng: number; accuracy?: number }; deliveryPin?: string }) => Promise<void>;
  assignOrderToDelivery: (orderId: string, deliveryUserId: string | null) => Promise<void>;
  acceptDeliveryAssignment: (orderId: string) => Promise<void>;
  getOrderById: (orderId: string) => Order | undefined;
  fetchRemoteOrderById: (orderId: string) => Promise<Order | undefined>;
  fetchOrders: (opts?: { dateFrom?: string; dateTo?: string }) => Promise<void>;
  awardPointsForReviewedOrder: (orderId: string) => Promise<boolean>;
  incrementInvoicePrintCount: (orderId: string) => Promise<void>;
  markOrderPaid: (orderId: string) => Promise<void>;
  recordOrderPaymentPartial: (
    orderId: string,
    amount: number,
    method?: string,
    occurredAt?: string,
    overrideAccountId?: string,
    meta?: {
      referenceNumber?: string;
      senderName?: string;
      senderPhone?: string;
      declaredAmount?: number;
      amountConfirmed?: boolean;
      destinationAccountId?: string;
    }
  ) => Promise<void>;
  issueInvoiceNow: (orderId: string) => Promise<void>;
}



const OrderContext = createContext<OrderContextType | undefined>(undefined);

export const OrderProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const { currentUser, addLoyaltyPoints, updateCustomerStatsAndTier, updateCustomer } = useUserAuth();
  const { settings } = useSettings();
  const { updateChallengeProgress } = useChallenges();
  const { isAuthenticated: isAdminAuthenticated, user: adminUser, hasPermission } = useAuth();
  const sessionScope = useSessionScope();

  const addressCacheRef = useRef<Map<string, string>>(new Map());
  const reserveStockRpcModeRef = useRef<null | 'wrapper' | 'direct3' | 'legacy1'>(null);
  const confirmDeliveryWithCreditRpcModeRef = useRef<null | 'wrapper' | 'direct4'>(null);
  const confirmDeliveryRpcModeRef = useRef<null | 'wrapper' | 'direct4' | 'direct3'>(null);


  const logAudit = async (action: string, details: string, metadata?: any) => {
    const supabase = getSupabaseClient();
    if (!supabase || !adminUser) return;
    try {
      await supabase.from('system_audit_logs').insert({
        action,
        module: 'orders',
        details,
        performed_by: adminUser.id,
        performed_at: new Date().toISOString(),
        metadata
      });
    } catch (err) {
      console.error('Audit log failed:', err);
    }
  };

  const isUuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const resolveOrderDestinationAccountId = (orderLike: any, methodLike?: string): string | undefined => {
    const method = String(methodLike || orderLike?.paymentMethod || '').trim();
    if (!method) return undefined;
    const fromBreakdown = (Array.isArray(orderLike?.paymentBreakdown) ? orderLike.paymentBreakdown : [])
      .find((p: any) => String(p?.method || '').trim() === method);
    const fromBreakdownDest = String((fromBreakdown as any)?.destinationAccountId || '').trim();
    if (isUuid(fromBreakdownDest)) return fromBreakdownDest;
    if (method === 'kuraimi') {
      const dest = String(orderLike?.paymentBank?.destinationAccountId || '').trim();
      if (isUuid(dest)) return dest;
    }
    if (method === 'network') {
      const dest = String(orderLike?.paymentNetworkRecipient?.destinationAccountId || '').trim();
      if (isUuid(dest)) return dest;
    }
    return undefined;
  };

  const isRpcNotFoundError = (err: any) => {
    const code = String(err?.code || '');
    const msg = String(err?.message || '');
    const details = String(err?.details || '');
    const status = (err as any)?.status;
    return (
      code === 'PGRST202' ||
      code === '42883' ||
      code === '22P02' || // invalid input syntax for type json — PostgREST overload disambiguation issue
      status === 404 ||
      /Could not find the function/i.test(msg) ||
      /PGRST202/i.test(details)
    );
  };

  const isRecordOrderPaymentNotFoundError = (err: any) => {
    const code = String(err?.code || '');
    const msg = String(err?.message || '');
    return isRpcNotFoundError(err) || (code === '42883' && /record_order_payment/i.test(msg));
  };

  const attachRecordOrderPaymentDiagnostic = async (err: any) => {
    if (!err || !isRecordOrderPaymentNotFoundError(err)) return err;
    const existing = String((err as any)?.__diagnosticMessage || '').trim();
    if (existing) return err;
    try {
      const checks = await Promise.all([
        rpcHasFunction('public.record_order_payment'),
        rpcHasFunction('public.record_order_payment(uuid,numeric,text,timestamptz,text,text)'),
        rpcHasFunction('public.record_order_payment(uuid, numeric, text, timestamptz, text, text)'),
        rpcHasFunction('public.record_order_payment(uuid,numeric,text,timestamptz,text)'),
        rpcHasFunction('public.record_order_payment(uuid, numeric, text, timestamptz, text)'),
        rpcHasFunction('public.record_order_payment(uuid,numeric,text,timestamptz)'),
        rpcHasFunction('public.record_order_payment(uuid, numeric, text, timestamptz)'),
      ]);
      const exists = checks.some(Boolean);
      (err as any).__diagnosticMessage = exists
        ? 'خدمة تسجيل الدفعات موجودة على الخادم لكن غير متاحة عبر الـ API حالياً (صلاحية EXECUTE أو مخطط PostgREST قديم). ادفع/طبّق ترحيلات Supabase وتأكد من وجود: grant execute on function public.record_order_payment(...) to authenticated ثم أعد المحاولة.'
        : 'خدمة تسجيل الدفعات غير موجودة على الخادم أو لم يتم تطبيق ترحيلات Supabase (migrations). ادفع/طبّق الترحيلات ثم أعد المحاولة.';
    } catch { }
    return err;
  };

  const rpcRecordOrderPayment = async (
    supabase: any,
    input: {
      orderId: string;
      amount: number;
      method: string;
      occurredAt: string;
      currency?: string;
      idempotencyKey?: string;
      overrideAccountId?: string;
      referenceNumber?: string;
      senderName?: string;
      senderPhone?: string;
      declaredAmount?: number;
      amountConfirmed?: boolean;
      destinationAccountId?: string;
    }
  ): Promise<any> => {
    const callV2 = async () => {
      const base: any = {
        p_order_id: input.orderId,
        p_amount: input.amount,
        p_method: input.method,
        p_occurred_at: input.occurredAt,
        p_data: {},
      };
      if (typeof input.currency === 'string' && input.currency.trim()) {
        base.p_currency = input.currency.trim().toUpperCase();
      }
      const key = String(input.idempotencyKey || '').trim();
      if (key) {
        base.p_idempotency_key = key;
      }
      const override = String(input.overrideAccountId || '').trim();
      if (override) {
        base.p_data.overrideAccountId = override;
      }
      const referenceNumber = String(input.referenceNumber || '').trim();
      if (referenceNumber) base.p_data.referenceNumber = referenceNumber;
      const senderName = String(input.senderName || '').trim();
      if (senderName) base.p_data.senderName = senderName;
      const senderPhone = String(input.senderPhone || '').trim();
      if (senderPhone) base.p_data.senderPhone = senderPhone;
      const declaredAmount = Number(input.declaredAmount);
      if (Number.isFinite(declaredAmount) && declaredAmount > 0) base.p_data.declaredAmount = declaredAmount;
      if (typeof input.amountConfirmed === 'boolean') base.p_data.amountConfirmed = input.amountConfirmed;
      const destinationAccountId = String(input.destinationAccountId || '').trim();
      if (destinationAccountId) base.p_data.destinationAccountId = destinationAccountId;
      const { error } = await supabase.rpc('record_order_payment_v2', base);
      return error;
    };

    const call = async (includeIdempotencyKey: boolean) => {
      const base: any = {
        p_order_id: input.orderId,
        p_amount: input.amount,
        p_method: input.method,
        p_occurred_at: input.occurredAt,
      };
      if (typeof input.currency === 'string' && input.currency.trim()) {
        base.p_currency = input.currency.trim().toUpperCase();
      }
      if (includeIdempotencyKey) {
        const key = String(input.idempotencyKey || '').trim();
        if (key) {
          base.p_idempotency_key = key;
        } else {
          includeIdempotencyKey = false;
        }
      }
      const { error } = await supabase.rpc('record_order_payment', base);
      return error;
    };

    const hasOverride = String(input.overrideAccountId || '').trim().length > 0;
    const hasMeta =
      String(input.referenceNumber || '').trim().length > 0 ||
      String(input.senderName || '').trim().length > 0 ||
      String(input.senderPhone || '').trim().length > 0 ||
      (Number.isFinite(Number(input.declaredAmount)) && Number(input.declaredAmount) > 0) ||
      typeof input.amountConfirmed === 'boolean' ||
      String(input.destinationAccountId || '').trim().length > 0;
    let error: any = null;
    if (hasOverride || hasMeta) {
      error = await callV2();
      if (!error) return null;
      if (isRecordOrderPaymentNotFoundError(error)) {
        const reloaded = await reloadPostgrestSchema();
        if (reloaded) error = await callV2();
      }
      if (!error) return null;
    }

    error = await call(true);
    if (!error) return null;

    if (isRecordOrderPaymentNotFoundError(error)) {
      const reloaded = await reloadPostgrestSchema();
      if (reloaded) error = await call(true);
    }
    if (!error) return null;

    if (isRecordOrderPaymentNotFoundError(error)) {
      error = await call(false);
    }
    if (!error) return null;

    if (isRecordOrderPaymentNotFoundError(error)) {
      const reloaded = await reloadPostgrestSchema();
      if (reloaded) error = await call(false);
    }
    await attachRecordOrderPaymentDiagnostic(error);
    return error;
  };

  const localizeRecordOrderPaymentError = (err: any) => {
    const diag = String((err as any)?.__diagnosticMessage || '').trim();
    if (diag) return diag;
    if (isRecordOrderPaymentNotFoundError(err)) {
      return 'خدمة تسجيل الدفعات غير مفعلة على الخادم أو لم يتم تحديث مخطط قاعدة البيانات. طبّق تحديثات Supabase (migrations) ثم أعد المحاولة.';
    }
    return localizeSupabaseError(err);
  };

  const rpcReserveStockForOrder = async (supabase: any, input: { items: any[]; orderId?: string | null; warehouseId?: string | null }) => {
    const tryDirect3 = async () => {
      const { error } = await supabase.rpc('reserve_stock_for_order', {
        p_items: input.items,
        p_order_id: input.orderId ?? null,
        p_warehouse_id: input.warehouseId ?? null,
      });
      return error;
    };
    const tryWrapper = async () => {
      const { error } = await supabase.rpc('reserve_stock_for_order', {
        p_payload: {
          p_items: input.items,
          p_order_id: input.orderId ?? null,
          p_warehouse_id: input.warehouseId ?? null,
        }
      });
      return error;
    };
    const tryLegacy1 = async () => {
      const { error } = await supabase.rpc('reserve_stock_for_order', {
        p_items: input.items,
      });
      return error;
    };

    const runByMode = async (mode: 'wrapper' | 'direct3' | 'legacy1') => {
      if (mode === 'wrapper') return await tryWrapper();
      if (mode === 'direct3') return await tryDirect3();
      return await tryLegacy1();
    };

    const cached = reserveStockRpcModeRef.current;
    if (cached) {
      const err = await runByMode(cached);
      if (!err || !isRpcNotFoundError(err)) return err;
      reserveStockRpcModeRef.current = null;
    }

    const strict = isRpcStrictMode();
    if (strict) {
      let err = await tryWrapper();
      if (err && isRpcNotFoundError(err)) {
        const reloaded = await reloadPostgrestSchema();
        if (reloaded) err = await tryWrapper();
      }
      if (!err || !isRpcNotFoundError(err)) {
        reserveStockRpcModeRef.current = 'wrapper';
        if (await isRpcWrappersAvailable()) markRpcStrictModeEnabled();
        return err;
      }
      return err;
    }

    let err = await tryWrapper();
    if (!err || !isRpcNotFoundError(err)) {
      reserveStockRpcModeRef.current = 'wrapper';
      if (await isRpcWrappersAvailable()) markRpcStrictModeEnabled();
      return err;
    }

    {
      const reloaded = await reloadPostgrestSchema();
      if (reloaded) {
        err = await tryWrapper();
        if (!err || !isRpcNotFoundError(err)) {
          reserveStockRpcModeRef.current = 'wrapper';
          if (await isRpcWrappersAvailable()) markRpcStrictModeEnabled();
          return err;
        }
      }
    }

    err = await tryDirect3();
    if (!err || !isRpcNotFoundError(err)) {
      reserveStockRpcModeRef.current = 'direct3';
      return err;
    }

    err = await tryLegacy1();
    if (!err || !isRpcNotFoundError(err)) {
      reserveStockRpcModeRef.current = 'legacy1';
    }
    return err;
  };

  const rpcConfirmOrderDeliveryWithCredit = async (supabase: any, input: { orderId: string; items: any[]; updatedData: any; warehouseId: string }) => {
    const tryDirect4 = async () => {
      const args = {
        p_order_id: input.orderId,
        p_items: input.items,
        p_updated_data: input.updatedData,
        p_warehouse_id: input.warehouseId,
      };

      // Skip _rpc wrapper — call confirm_order_delivery_with_credit directly
      // (the _rpc alias has a stale body on some environments causing 42703 errors).
      const { data, error } = await supabase.rpc('confirm_order_delivery_with_credit', args);
      return { data, error };
    };
    const tryWrapper = async () => {
      const { data, error } = await supabase.rpc('confirm_order_delivery_with_credit', {
        p_payload: {
          p_order_id: input.orderId,
          p_items: input.items,
          p_updated_data: input.updatedData,
          p_warehouse_id: input.warehouseId,
        }
      });
      return { data, error };
    };

    const runByMode = async (mode: 'wrapper' | 'direct4') => (mode === 'wrapper' ? await tryWrapper() : await tryDirect4());
    const cached = confirmDeliveryWithCreditRpcModeRef.current;
    if (cached) {
      const res = await runByMode(cached);
      if (!res.error || !isRpcNotFoundError(res.error)) return res;
      confirmDeliveryWithCreditRpcModeRef.current = null;
    }

    const strict = isRpcStrictMode();
    if (strict) {
      let res = await tryDirect4();
      if (res.error && isRpcNotFoundError(res.error)) {
        const reloaded = await reloadPostgrestSchema();
        if (reloaded) res = await tryDirect4();
      }
      if (!res.error || !isRpcNotFoundError(res.error)) {
        confirmDeliveryWithCreditRpcModeRef.current = 'direct4';
        return res;
      }
      res = await tryWrapper();
      if (res.error && isRpcNotFoundError(res.error)) {
        const reloaded = await reloadPostgrestSchema();
        if (reloaded) res = await tryWrapper();
      }
      if (!res.error || !isRpcNotFoundError(res.error)) {
        confirmDeliveryWithCreditRpcModeRef.current = 'wrapper';
        if (await isRpcWrappersAvailable()) markRpcStrictModeEnabled();
        return res;
      }
      return res;
    }

    // Prefer direct4 mode — wrapper triggers PostgREST disambiguation issues
    let res = await tryDirect4();
    if (!res.error) {
      confirmDeliveryWithCreditRpcModeRef.current = 'direct4';
      return res;
    }
    if (!isRpcNotFoundError(res.error)) {
      confirmDeliveryWithCreditRpcModeRef.current = 'direct4';
      return res;
    }

    res = await tryWrapper();
    if (!res.error) {
      confirmDeliveryWithCreditRpcModeRef.current = 'wrapper';
      if (await isRpcWrappersAvailable()) markRpcStrictModeEnabled();
      return res;
    }
    if (!isRpcNotFoundError(res.error)) {
      confirmDeliveryWithCreditRpcModeRef.current = 'wrapper';
      return res;
    }

    {
      const reloaded = await reloadPostgrestSchema();
      if (reloaded) {
        res = await tryDirect4();
        if (!res.error) {
          confirmDeliveryWithCreditRpcModeRef.current = 'direct4';
          return res;
        }
      }
    }

    // Final compatibility fallback: use non-credit delivery RPCs on legacy schemas
    if (res?.error && isRpcNotFoundError(res.error)) {
      try {
        const fallback = await rpcConfirmOrderDelivery(supabase, input);
        if (!fallback.error) {
          confirmDeliveryWithCreditRpcModeRef.current = 'direct4';
          return fallback;
        }
      } catch {
      }
    }

    return res;
  };

  const rpcConfirmOrderDelivery = async (supabase: any, input: { orderId: string; items: any[]; updatedData: any; warehouseId: string }) => {
    const tryDirect4 = async () => {
      const args = {
        p_order_id: input.orderId,
        p_items: input.items,
        p_updated_data: input.updatedData,
        p_warehouse_id: input.warehouseId,
      };

      // Skip _rpc wrapper — call confirm_order_delivery directly (the _rpc alias
      // has a stale body on some environments causing 42703 errors).
      const { data, error } = await supabase.rpc('confirm_order_delivery', args);
      return { data, error };
    };
    const tryDirect3 = async () => {
      const { data, error } = await supabase.rpc('confirm_order_delivery', {
        p_order_id: input.orderId,
        p_items: input.items,
        p_updated_data: input.updatedData,
      });
      return { data, error };
    };
    const tryWrapper = async () => {
      const { data, error } = await supabase.rpc('confirm_order_delivery', {
        p_payload: {
          p_order_id: input.orderId,
          p_items: input.items,
          p_updated_data: input.updatedData,
          p_warehouse_id: input.warehouseId,
        }
      });
      return { data, error };
    };

    const runByMode = async (mode: 'wrapper' | 'direct4' | 'direct3') => {
      if (mode === 'wrapper') return await tryWrapper();
      if (mode === 'direct3') return await tryDirect3();
      return await tryDirect4();
    };
    const cached = confirmDeliveryRpcModeRef.current;
    if (cached) {
      const res = await runByMode(cached);
      if (!res.error || !isRpcNotFoundError(res.error)) return res;
      confirmDeliveryRpcModeRef.current = null;
    }

    const strict = isRpcStrictMode();
    if (strict) {
      let res = await tryDirect4();
      if (res.error && isRpcNotFoundError(res.error)) {
        const reloaded = await reloadPostgrestSchema();
        if (reloaded) res = await tryDirect4();
      }
      if (!res.error || !isRpcNotFoundError(res.error)) {
        confirmDeliveryRpcModeRef.current = 'direct4';
        return res;
      }
      res = await tryWrapper();
      if (res.error && isRpcNotFoundError(res.error)) {
        const reloaded = await reloadPostgrestSchema();
        if (reloaded) res = await tryWrapper();
      }
      if (!res.error || !isRpcNotFoundError(res.error)) {
        confirmDeliveryRpcModeRef.current = 'wrapper';
        if (await isRpcWrappersAvailable()) markRpcStrictModeEnabled();
        return res;
      }
      return res;
    }

    // Prefer direct4 mode — the wrapper mode triggers PostgREST overload
    // disambiguation issues (22P02) with overloaded function signatures.
    let res = await tryDirect4();
    if (!res.error || !isRpcNotFoundError(res.error)) {
      confirmDeliveryRpcModeRef.current = 'direct4';
      return res;
    }

    res = await tryWrapper();
    if (!res.error || !isRpcNotFoundError(res.error)) {
      confirmDeliveryRpcModeRef.current = 'wrapper';
      if (await isRpcWrappersAvailable()) markRpcStrictModeEnabled();
      return res;
    }

    {
      const reloaded = await reloadPostgrestSchema();
      if (reloaded) {
        res = await tryDirect4();
        if (!res.error || !isRpcNotFoundError(res.error)) {
          confirmDeliveryRpcModeRef.current = 'direct4';
          return res;
        }
      }
    }

    res = await tryDirect3();
    if (!res.error || !isRpcNotFoundError(res.error)) {
      confirmDeliveryRpcModeRef.current = 'direct3';
    }
    return res;
  };

  const resolveOrderAddress = useCallback(async (order: Order): Promise<Order> => {
    const currentAddr = typeof (order as any).address === 'string' ? (order as any).address : '';
    if (currentAddr && addressCacheRef.current.has(currentAddr)) {
      const cached = addressCacheRef.current.get(currentAddr)!;
      return { ...(order as any), address: cached };
    }
    const next = await decryptField(order as any, 'address' as any);
    const addr = typeof (next as any).address === 'string' ? (next as any).address : '';
    const display = addr && isEncrypted(addr) ? 'عنوان مشفّر' : addr;
    const cacheKey = currentAddr || addr;
    if (cacheKey) {
      addressCacheRef.current.set(cacheKey, display);
    }
    return { ...(order as any), ...(next as any), address: display } as any;
  }, []);

  const fetchRemoteOrderById = useCallback(async (orderId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return undefined;
    try {
      const isSchemaCacheMissingColumnError = (err: any, column: string) => {
        const code = String(err?.code || '');
        const msg = String(err?.message || '');
        if (code === 'PGRST204' && msg) return msg.toLowerCase().includes(String(column).toLowerCase());
        return /schema cache/i.test(msg) && new RegExp(String(column).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(msg);
      };

      const trySelectWithDeliveryZoneId = async () => {
        return await supabase
          .from('orders')
          .select('id,status,created_at,delivery_zone_id,currency,fx_rate,base_total,data,order_events(action,actor_id)')
          .eq('id', orderId)
          .maybeSingle();
      };

      let row: any = null;
      let error: any = null;
      ({ data: row, error } = await trySelectWithDeliveryZoneId());
      if (error && isSchemaCacheMissingColumnError(error, 'delivery_zone_id')) {
        ({ data: row, error } = await supabase
          .from('orders')
          .select('id,status,created_at,currency,fx_rate,base_total,data,order_events(action,actor_id)')
          .eq('id', orderId)
          .maybeSingle());
      }
      if (error) throw error;
      if (!row) return undefined;
      const base = (row.data || {}) as Order;
      const colStatus = (row.status as OrderStatus) || undefined;
      const dataStatus = (base as any).status as OrderStatus | undefined;
      const resolvedStatus: OrderStatus = colStatus || dataStatus || 'pending';
      const colCurrency = typeof (row as any)?.currency === 'string' ? String((row as any).currency).toUpperCase() : '';
      const dataCurrency = typeof (base as any)?.currency === 'string' ? String((base as any).currency).toUpperCase() : '';
      const currency = colCurrency || dataCurrency;
      const fxRate = typeof (row as any)?.fx_rate === 'number' ? (row as any).fx_rate : (Number((base as any)?.fxRate) || Number((base as any)?.fx_rate) || undefined);
      const baseTotal = typeof (row as any)?.base_total === 'number' ? (row as any).base_total : (Number((base as any)?.baseTotal) || Number((base as any)?.base_total) || undefined);
      const events = typeof row?.order_events === 'object' && row.order_events !== null ? (Array.isArray(row.order_events) ? row.order_events : [row.order_events]) : [];
      const createdEvent = events.find((e: any) => String(e?.action || '') === 'order.created');
      const _createdBy = createdEvent?.actor_id ? String(createdEvent.actor_id) : undefined;
      const enriched: Order = {
        ...base,
        id: String(row.id),
        status: resolvedStatus,
        createdAt: (row.created_at as string) || base.createdAt || new Date().toISOString(),
        deliveryZoneId: (row.delivery_zone_id as string) || base.deliveryZoneId,
        ...(currency ? { currency } : {}),
        ...(_createdBy ? { _createdBy } : {}),
      };
      if (fxRate != null && Number.isFinite(Number(fxRate))) (enriched as any).fxRate = Number(fxRate);
      if (baseTotal != null && Number.isFinite(Number(baseTotal))) (enriched as any).baseTotal = Number(baseTotal);
      return enriched;
    } catch {
      return undefined;
    }
  }, []);

  const fetchOrderPaidAmount = useCallback(async (orderId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return 0;
    const { data: rows, error } = await supabase
      .from('payments')
      .select('amount')
      .eq('reference_table', 'orders')
      .eq('direction', 'in')
      .eq('reference_id', orderId);
    if (error) throw error;
    return (rows || []).reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0);
  }, []);

  const updateRemoteOrder = useCallback(async (order: Order, options?: { includeStatus?: boolean }) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const existing = orders.find((o) => o.id === order.id);
      if (existing && (existing.invoiceIssuedAt || existing.invoiceSnapshot)) {
        const existingCurrency = String((existing as any).currency || '').trim().toUpperCase();
        const nextCurrency = String((order as any).currency || '').trim().toUpperCase();
        if (existingCurrency && nextCurrency && existingCurrency !== nextCurrency) {
          throw new Error('لا يمكن تغيير عملة الطلب بعد إصدار الفاتورة.');
        }
        if (existingCurrency && !nextCurrency) {
          (order as any).currency = existingCurrency;
        }
      }
      const isSchemaCacheMissingColumnError = (err: any, column: string) => {
        const code = String(err?.code || '');
        const msg = String(err?.message || '');
        if (code === 'PGRST204' && msg) return msg.toLowerCase().includes(String(column).toLowerCase());
        return /schema cache/i.test(msg) && new RegExp(String(column).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(msg);
      };
      const includeStatus = options?.includeStatus !== false;
      const payload: Record<string, any> = {
        data: order,
      };
      if (includeStatus) payload.status = order.status;
      if (typeof (order as any).currency === 'string' && String((order as any).currency).trim()) {
        payload.currency = String((order as any).currency).trim().toUpperCase();
      }
      if (typeof order.deliveryZoneId === 'string' && isUuid(order.deliveryZoneId)) {
        payload.delivery_zone_id = order.deliveryZoneId;
      }
      if (typeof (order as any).warehouseId === 'string' && isUuid((order as any).warehouseId)) {
        payload.warehouse_id = (order as any).warehouseId;
      }

      let error: any = null;
      ({ error } = await supabase
        .from('orders')
        .update(payload)
        .eq('id', order.id));

      if (error && (isSchemaCacheMissingColumnError(error, 'delivery_zone_id') || isSchemaCacheMissingColumnError(error, 'warehouse_id'))) {
        const fallback: Record<string, any> = { data: order };
        if (includeStatus) fallback.status = order.status;
        if (typeof (order as any).currency === 'string' && String((order as any).currency).trim()) {
          fallback.currency = String((order as any).currency).trim().toUpperCase();
        }
        ({ error } = await supabase
          .from('orders')
          .update(fallback)
          .eq('id', order.id));
      }

      if (error) throw error;
    } catch (err) {
      const msg = String((err as any)?.message || (err as any)?.details || err || '');
      // Supress known expected errors that callers might handle gracefully
      if (!/posted_order_immutable/i.test(msg)) {
        console.error('Failed to update order:', err);
      }
      throw new Error(localizeSupabaseError(err));
    }
  }, []);

  const createRemoteOrder = useCallback(async (order: Order) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const isSchemaCacheMissingColumnError = (err: any, column: string) => {
        const code = String(err?.code || '');
        const msg = String(err?.message || '');
        if (code === 'PGRST204' && msg) return msg.toLowerCase().includes(String(column).toLowerCase());
        return /schema cache/i.test(msg) && new RegExp(String(column).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(msg);
      };
      const scopedWarehouseId = sessionScope?.scope?.warehouseId;
      const warehouseId = (typeof (order as any).warehouseId === 'string' && isUuid((order as any).warehouseId))
        ? (order as any).warehouseId
        : (typeof scopedWarehouseId === 'string' && isUuid(scopedWarehouseId) ? scopedWarehouseId : null);
      const deliveryZoneId = (typeof order.deliveryZoneId === 'string' && isUuid(order.deliveryZoneId))
        ? order.deliveryZoneId
        : null;
      const payload: Record<string, any> = {
        id: order.id,
        status: order.status,
        delivery_zone_id: deliveryZoneId,
        warehouse_id: warehouseId,
        data: order,
      };
      const partyId = (order as any)?.partyId;
      payload.party_id = isUuid(partyId) ? partyId : null;
      if (typeof (order as any).currency === 'string' && String((order as any).currency).trim()) {
        payload.currency = String((order as any).currency).trim().toUpperCase();
      }
      payload.customer_auth_user_id = isUuid(order.userId) ? order.userId : null;

      let error: any = null;
      ({ error } = await supabase
        .from('orders')
        .insert(payload));

      if (error && (
        isSchemaCacheMissingColumnError(error, 'delivery_zone_id')
        || isSchemaCacheMissingColumnError(error, 'warehouse_id')
        || isSchemaCacheMissingColumnError(error, 'party_id')
      )) {
        const fallback: Record<string, any> = {
          id: order.id,
          status: order.status,
          data: order,
          customer_auth_user_id: payload.customer_auth_user_id,
        };
        if (typeof (order as any).currency === 'string' && String((order as any).currency).trim()) {
          fallback.currency = String((order as any).currency).trim().toUpperCase();
        }
        ({ error } = await supabase
          .from('orders')
          .insert(fallback));
      }

      if (error) throw error;
    } catch (err: any) {
      logger.error('Failed to create order:', err);
      // Normalize distinct error objects (like from Supabase) into real Error instances for UI handling
      if (typeof err === 'object' && err !== null && !(err instanceof Error)) {
        const msg = err.message || 'Unknown database error';
        const details = err.details || err.hint || '';
        throw new Error(`Database Error: ${msg} ${details}`.trim());
      }
      throw err;
    }
  }, [sessionScope?.scope?.warehouseId]);

  const upsertRemoteOrderEvent = useCallback(async (event: OrderAuditEvent) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const payload = {
        id: event.id,
        order_id: event.orderId,
        action: event.action,
        actor_type: event.actorType,
        actor_id: isUuid(event.actorId) ? event.actorId : null,
        from_status: event.fromStatus ?? null,
        to_status: event.toStatus ?? null,
        payload: (event.payload && typeof event.payload === 'object') ? event.payload : {},
        created_at: event.createdAt,
      };
      const { error } = await supabase.from('order_events').insert(payload);
      if (error) throw error;
    } catch (err) {
      console.error('Failed to upsert order event:', err);
    }
  }, []);

  const getRequestedItemQuantity = (item: CartItem) => {
    const unitType = item.unitType || item.unit || 'piece';
    if (unitType === 'kg' || unitType === 'gram') {
      return typeof item.weight === 'number' ? item.weight : item.quantity;
    }
    return item.quantity;
  };
  const getRequestedBaseQuantity = (item: CartItem) => {
    const unitType = item.unitType || item.unit || 'piece';
    if (unitType === 'kg' || unitType === 'gram') {
      return typeof item.weight === 'number' ? item.weight : item.quantity;
    }
    const factor = Number((item as any).uomQtyInBase || 1) || 1;
    return (Number(item.quantity) || 0) * factor;
  };

  const addOrderEvent = useCallback(
    async (input: {
      orderId: string;
      action: OrderAuditAction;
      actorType: OrderAuditActorType;
      actorId?: string;
      fromStatus?: OrderStatus;
      toStatus?: OrderStatus;
      payload?: Record<string, unknown>;
      createdAt?: string;
    }) => {
      const nowIso = input.createdAt || new Date().toISOString();
      const event: OrderAuditEvent = {
        id: crypto.randomUUID(),
        orderId: input.orderId,
        action: input.action,
        actorType: input.actorType,
        actorId: input.actorId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        createdAt: nowIso,
        payload: input.payload,
      };
      await upsertRemoteOrderEvent(event);
    },
    [upsertRemoteOrderEvent]
  );



  const canAssignDelivery = () => {
    if (!isAdminAuthenticated) return false;
    return hasPermission('orders.updateStatus.all');
  };

  const canAcceptDelivery = () => {
    if (!isAdminAuthenticated) return false;
    if (hasPermission('orders.updateStatus.all')) return true;
    return hasPermission('orders.updateStatus.delivery');
  };

  const canUpdateStatus = (nextStatus: OrderStatus) => {
    if (!isAdminAuthenticated) return false;
    if (hasPermission('orders.updateStatus.all')) return true;
    if (!hasPermission('orders.updateStatus.delivery')) return false;
    return nextStatus === 'out_for_delivery' || nextStatus === 'delivered';
  };

  const canCancelOrder = () => {
    if (!isAdminAuthenticated) return false;
    return hasPermission('orders.cancel') || hasPermission('orders.updateStatus.all');
  };

  const canMarkPaidOrder = () => {
    if (!isAdminAuthenticated) return false;
    return hasPermission('orders.markPaid') || hasPermission('orders.updateStatus.all');
  };

  const canCreateInStoreSale = () => {
    if (!isAdminAuthenticated) return false;
    return hasPermission('orders.createInStore') || hasPermission('orders.updateStatus.all');
  };

  const isAllowedTransition = (from: OrderStatus, to: OrderStatus) => {
    if (from === to) return true;
    if (from === 'delivered' || from === 'cancelled') return false;
    if (to === 'cancelled') return true;
    if (from === 'scheduled') return to === 'pending' || to === 'preparing';
    if (from === 'pending') return to === 'preparing' || to === 'out_for_delivery';
    if (from === 'preparing') return to === 'out_for_delivery' || to === 'delivered';
    if (from === 'out_for_delivery') return to === 'delivered';
    return false;
  };

  const toStockFromRow = (row: any): StockManagement | undefined => {
    const itemId = typeof row?.item_id === 'string' ? row.item_id : undefined;
    if (!itemId) return undefined;
    const data = (row?.data && typeof row.data === 'object') ? row.data : {};
    const warehouseId = typeof row?.warehouse_id === 'string'
      ? row.warehouse_id
      : (typeof (data as any).warehouseId === 'string' ? (data as any).warehouseId : undefined);
    if (!warehouseId) return undefined;
    const availableQuantity = Number.isFinite(Number(row?.available_quantity))
      ? Number(row.available_quantity)
      : (Number.isFinite(Number((data as any).availableQuantity)) ? Number((data as any).availableQuantity) : 0);
    const reservedQuantity = Number.isFinite(Number(row?.reserved_quantity))
      ? Number(row.reserved_quantity)
      : (Number.isFinite(Number((data as any).reservedQuantity)) ? Number((data as any).reservedQuantity) : 0);
    const qcHoldQuantity = Number.isFinite(Number(row?.qc_hold_quantity))
      ? Number(row.qc_hold_quantity)
      : (Number.isFinite(Number((data as any).qcHoldQuantity)) ? Number((data as any).qcHoldQuantity) : 0);
    const unit = typeof row?.unit === 'string' ? row.unit : (typeof (data as any).unit === 'string' ? (data as any).unit : 'piece');
    const lowStockThreshold = Number.isFinite(Number(row?.low_stock_threshold))
      ? Number(row.low_stock_threshold)
      : (Number.isFinite(Number((data as any).lowStockThreshold)) ? Number((data as any).lowStockThreshold) : 5);
    const lastUpdated = typeof row?.last_updated === 'string'
      ? row.last_updated
      : (typeof (data as any).lastUpdated === 'string' ? (data as any).lastUpdated : new Date().toISOString());
    return {
      id: itemId,
      itemId,
      warehouseId,
      availableQuantity,
      qcHoldQuantity,
      reservedQuantity,
      unit: unit as any,
      lastUpdated,
      lowStockThreshold,
    };
  };

  const loadMenuItemById = async (itemId: string): Promise<MenuItem | undefined> => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');
    const { data: row, error } = await supabase.from('menu_items').select('id,data').eq('id', itemId).maybeSingle();
    if (error) throw error;
    return row?.data as MenuItem | undefined;
  };

  const loadStockRecord = async (itemId: string, fallbackAvailable: number, unit: StockManagement['unit'], warehouseId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');
    const { data: row, error } = await supabase
      .from('stock_management')
      .select('item_id, warehouse_id, available_quantity, qc_hold_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data')
      .eq('item_id', itemId)
      .eq('warehouse_id', warehouseId)
      .maybeSingle();
    if (error) throw error;
    const existing = row ? toStockFromRow(row) : undefined;
    if (existing) return existing;
    const menuItem = await loadMenuItemById(itemId);
    const initialAvailable = typeof menuItem?.availableStock === 'number' ? menuItem.availableStock : fallbackAvailable;
    const stock: StockManagement = {
      id: itemId,
      itemId,
      warehouseId,
      availableQuantity: Number.isFinite(Number(initialAvailable)) ? Number(initialAvailable) : 0,
      unit,
      reservedQuantity: 0,
      lastUpdated: new Date().toISOString(),
      lowStockThreshold: 5,
    };
    const { error: upsertError } = await supabase.from('stock_management').upsert({
      item_id: stock.itemId,
      warehouse_id: warehouseId,
      available_quantity: stock.availableQuantity,
      reserved_quantity: stock.reservedQuantity,
      unit: String(stock.unit || 'piece'),
      low_stock_threshold: stock.lowStockThreshold ?? 5,
      last_updated: stock.lastUpdated,
      data: stock,
    }, { onConflict: 'item_id,warehouse_id' });
    if (upsertError) throw upsertError;
    return stock;
  };

  const ensureSufficientStockForOrderItems = async (items: CartItem[], warehouseId: string) => {
    for (const item of items) {
      const requested = getRequestedBaseQuantity(item);
      if (!(requested > 0)) continue;
      const lineWarehouseId = String((item as any)?.warehouseId || warehouseId || '').trim();
      if (!lineWarehouseId) {
        throw new Error('لا يمكن التحقق من المخزون بدون تحديد مستودع للصنف.');
      }
      const unit = (item.unitType || item.unit || 'piece') as StockManagement['unit'];
      const current = await loadStockRecord(item.id, item.availableStock || 0, unit, lineWarehouseId);
      const availableToSell = current.availableQuantity - current.reservedQuantity;
      if (availableToSell + 1e-9 < requested) {
        try {
          const rpcClient = getSupabaseClient();
          if (rpcClient) {
            await rpcClient.rpc('recompute_stock_for_item', {
              p_item_id: item.id,
              p_warehouse_id: lineWarehouseId,
            });
          }
        } catch { }
        const refreshed = await loadStockRecord(item.id, item.availableStock || 0, unit, lineWarehouseId);
        const refreshedAvailableToSell = refreshed.availableQuantity - refreshed.reservedQuantity;
        if (refreshedAvailableToSell + 1e-9 >= requested) continue;
        const name = item.name?.ar || item.id;
        throw new Error(`الكمية المطلوبة من "${name}" غير متوفرة في هذا المستودع. المتاح: ${refreshedAvailableToSell}`);
      }
    }
  };

  const isInvoiceEligible = useCallback((order: Order) => {
    if (order.status !== 'delivered') return false;
    const isCod = order.paymentMethod === 'cash' && order.orderSource !== 'in_store' && Boolean(order.deliveryZoneId);
    if (isCod) return Boolean(order.paidAt);
    return true;
  }, []);

  const ensureInvoiceIssued = useCallback(async (order: Order, issuedAtIso?: string): Promise<Order> => {
    if (order.invoiceIssuedAt && order.invoiceNumber) return order;
    if (!isInvoiceEligible(order)) return order;
    const orderWarehouseId =
      (order as any).warehouseId ||
      (order as any).warehouse_id ||
      (order as any).data?.warehouseId ||
      (order as any).data?.warehouse_id;
    if (!orderWarehouseId) {
      throw new Error('لا يمكن إصدار فاتورة بدون مستودع.');
    }

    const invoiceIssuedAt = order.invoiceIssuedAt || issuedAtIso || order.deliveredAt || order.createdAt || order.paidAt || new Date().toISOString();
    const baseCurrency = (await getBaseCurrencyCode()) || undefined;
    const rawFxRate = (order as any).fxRate ?? (order as any).fx_rate ?? (order as any).data?.fxRate ?? (order as any).data?.fx_rate;
    const fxRate = Number(rawFxRate);
    const fxRateSnapshot = Number.isFinite(fxRate) ? fxRate : undefined;
    let invoiceNumber = order.invoiceNumber || '';
    try {
      const supabase = getSupabaseClient();
      if (supabase && !invoiceNumber) {
        const { data, error } = await supabase.rpc('assign_invoice_number_if_missing', { p_order_id: order.id });
        if (!error && typeof data === 'string' && data) {
          invoiceNumber = data;
        }
      }
    } catch { }
    if (!invoiceNumber) {
      invoiceNumber = generateInvoiceNumber(order.id, invoiceIssuedAt);
    }
    const invoicePrintCount = typeof order.invoicePrintCount === 'number' ? order.invoicePrintCount : 0;

    const shouldAddSnapshot = !order.invoiceSnapshot;
    const snapshot: Order['invoiceSnapshot'] = shouldAddSnapshot
      ? {
        issuedAt: invoiceIssuedAt,
        invoiceNumber,
        createdAt: order.createdAt,
        orderSource: order.orderSource,
        items: typeof structuredClone === 'function' ? structuredClone(order.items) : JSON.parse(JSON.stringify(order.items)),
        currency: order.currency,
        fxRate: fxRateSnapshot,
        baseCurrency,
        totals: {
          subtotal: order.subtotal,
          discountAmount: order.discountAmount,
          deliveryFee: order.deliveryFee,
          taxAmount: (order as any).taxAmount,
          total: order.total,
        },
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        discountAmount: order.discountAmount,
        total: order.total,
        paymentMethod: order.paymentMethod,
        customerName: order.customerName,
        phoneNumber: order.phoneNumber,
        invoiceStatement: (order as any).invoiceStatement,
        address: order.address,
        deliveryZoneId: order.deliveryZoneId,
        invoiceTerms: (order as any).invoiceTerms,
        netDays: (order as any).netDays,
        dueDate: (order as any).dueDate,
      }
      : undefined;

    const run = async (): Promise<Order> => {
      const nextOrder: Order = {
        ...order,
        invoiceIssuedAt,
        invoiceNumber,
        invoicePrintCount,
        ...(snapshot ? { invoiceSnapshot: snapshot } : {}),
      };
      try {
        const supabase = getSupabaseClient();
        const isCod = nextOrder.paymentMethod === 'cash' && nextOrder.orderSource !== 'in_store' && Boolean(nextOrder.deliveryZoneId);
        if (supabase && !isCod) {
          await supabase.rpc('post_invoice_issued', { p_order_id: nextOrder.id, p_issued_at: invoiceIssuedAt });
        }
      } catch { }
      await addOrderEvent({
        orderId: order.id,
        action: 'order.invoiceIssued',
        actorType: isAdminAuthenticated ? 'admin' : 'system',
        actorId: isAdminAuthenticated ? adminUser?.id : undefined,
        createdAt: invoiceIssuedAt,
        payload: { invoiceNumber },
      });
      if ((nextOrder.status as any) !== 'posted') {
        try {
          await updateRemoteOrder(nextOrder, { includeStatus: false });
        } catch (err: any) {
          // If the order is already posted, we can't update it. Ignore this error to stop the retry loop.
          if (String(err?.message || '').includes('posted_order_immutable') || /مُرحّل.*مقفّل/i.test(String(err?.message || '')) || err?.code === 'P0001') {
            console.warn('Skipping update for posted order in ensureInvoiceIssued:', nextOrder.id);
          } else if ((nextOrder.status as any) === 'delivered' || (nextOrder.status as any) === 'posted') {
            console.warn('Swallowing update error for delivered/posted order:', nextOrder.id, err);
          } else {
            throw err;
          }
        }
      }
      setOrders(prev => prev.map(o => (o.id === nextOrder.id ? nextOrder : o)));
      return nextOrder;
    };
    return await run();
  }, [addOrderEvent, adminUser?.id, isAdminAuthenticated, isInvoiceEligible, updateRemoteOrder, getSupabaseClient]);

  const isFetchingRef = useRef(false);
  const invoiceEnsureAttemptedRef = useRef<Set<string>>(new Set());
  const fetchOrders = useCallback(async (opts?: { dateFrom?: string; dateTo?: string }) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    const startedAt = Date.now();
    let failed = false;
    let fetchedRows = 0;
    setLoading(true);
    let nextOrders: Order[] = [];
    try {
      const shouldLoadAll = isAdminAuthenticated;
      const supabase = getSupabaseClient();
      if (supabase) {
        if (!shouldLoadAll && !currentUser) {
          nextOrders = [];
        } else {
          const loadRemote = async () => {
            const isSchemaCacheMissingColumnError = (err: any, column: string) => {
              const code = String(err?.code || '');
              const msg = String(err?.message || '');
              if (code === 'PGRST204' && msg) return msg.toLowerCase().includes(String(column).toLowerCase());
              return /schema cache/i.test(msg) && new RegExp(String(column).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(msg);
            };
            const conn: any = (typeof navigator !== 'undefined' && (navigator as any).connection) ? (navigator as any).connection : null;
            const eff: string = typeof conn?.effectiveType === 'string' ? conn.effectiveType : '';
            const isSlow = eff === 'slow-2g' || eff === '2g';
            // When a date range is provided, filter by date on the server — no row limit needed.
            // When no date range is given, use a safety cap to avoid loading thousands of records.
            const hardLimit = isSlow ? 200 : 500;
            const hasDateFilter = !!(opts?.dateFrom || opts?.dateTo);
            const applyDateFilters = (q: any) => {
              if (opts?.dateFrom) q = q.gte('created_at', opts.dateFrom);
              if (opts?.dateTo) {
                // End of day for dateTo
                const end = new Date(opts.dateTo);
                end.setHours(23, 59, 59, 999);
                q = q.lte('created_at', end.toISOString());
              }
              return q;
            };
            const queryWithZone = () => {
              let baseQuery = supabase
                .from('orders')
                .select('id,status,created_at,delivery_zone_id,warehouse_id,currency,fx_rate,base_total,data,order_events(action,actor_id)')
                .order('created_at', { ascending: false });
              if (!hasDateFilter) baseQuery = baseQuery.limit(hardLimit);
              baseQuery = applyDateFilters(baseQuery);
              if (shouldLoadAll) return baseQuery;
              return baseQuery.eq('customer_auth_user_id', currentUser!.id);
            };
            const queryWithoutZone = () => {
              let baseQuery = supabase
                .from('orders')
                .select('id,status,created_at,warehouse_id,currency,fx_rate,base_total,data,order_events(action,actor_id)')
                .order('created_at', { ascending: false });
              if (!hasDateFilter) baseQuery = baseQuery.limit(hardLimit);
              baseQuery = applyDateFilters(baseQuery);
              if (shouldLoadAll) return baseQuery;
              return baseQuery.eq('customer_auth_user_id', currentUser!.id);
            };

            let result: any = await queryWithZone();
            if (result.error && isSchemaCacheMissingColumnError(result.error, 'delivery_zone_id')) {
              const reloaded = await reloadPostgrestSchema();
              if (reloaded) {
                result = await queryWithZone();
              }
            }
            if (result.error && isSchemaCacheMissingColumnError(result.error, 'delivery_zone_id')) {
              result = await queryWithoutZone();
            }
            return result;
          };

          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            nextOrders = [];
          } else {
            // Race remote with a short timeout to avoid UI hanging
            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timeoutId = controller ? setTimeout(() => controller.abort(), 6000) : null;
            const { data: rows, error } = await loadRemote();
            if (timeoutId) clearTimeout(timeoutId);
            if (error) throw error;
            const merged: Order[] = (rows || []).map((r: any) => {
              const base = (r?.data || {}) as Order;
              const colStatus = (r?.status as OrderStatus) || undefined;
              const dataStatus = (base as any).status as OrderStatus | undefined;
              const resolvedStatus: OrderStatus =
                colStatus || dataStatus || 'pending';
              const colCurrency = typeof r?.currency === 'string' ? String(r.currency).toUpperCase() : '';
              const dataCurrency = typeof (base as any)?.currency === 'string' ? String((base as any).currency).toUpperCase() : '';
              const currency = colCurrency || dataCurrency;
              const fxRate = typeof r?.fx_rate === 'number' ? r.fx_rate : (Number((base as any)?.fxRate) || Number((base as any)?.fx_rate) || undefined);
              const baseTotal = typeof r?.base_total === 'number' ? r.base_total : (Number((base as any)?.baseTotal) || Number((base as any)?.base_total) || undefined);
              const events = typeof r?.order_events === 'object' && r.order_events !== null ? (Array.isArray(r.order_events) ? r.order_events : [r.order_events]) : [];
              const createdEvent = events.find((e: any) => String(e?.action || '') === 'order.created');
              const _createdBy = createdEvent?.actor_id ? String(createdEvent.actor_id) : undefined;
              const enriched: Order = {
                ...base,
                id: String(r.id),
                status: resolvedStatus,
                createdAt: typeof r.created_at === 'string' ? r.created_at : (base.createdAt || new Date().toISOString()),
                deliveryZoneId: typeof r.delivery_zone_id === 'string' ? r.delivery_zone_id : base.deliveryZoneId,
                ...(r.warehouse_id ? { warehouseId: r.warehouse_id } : {}),
                ...(currency ? { currency } : {}),
                ...(_createdBy ? { _createdBy } : {}),
              };
              if (fxRate != null && Number.isFinite(Number(fxRate))) (enriched as any).fxRate = Number(fxRate);
              if (baseTotal != null && Number.isFinite(Number(baseTotal))) (enriched as any).baseTotal = Number(baseTotal);
              return enriched;
            }).filter(Boolean);
            merged.sort((a, b) => (String(b.createdAt || '')).localeCompare(String(a.createdAt || '')));
            fetchedRows = merged.length;
            setOrders(merged);
            void (async () => {
              try {
                const remoteOrders = await Promise.all(merged.map((o) => resolveOrderAddress(o)));
                remoteOrders.sort((a, b) => (String(b.createdAt || '')).localeCompare(String(a.createdAt || '')));
                setOrders(remoteOrders);
              } catch {
              }
            })();
            nextOrders = merged;
          }

          // Process missing invoices in the background without blocking or re-fetching
          const shouldEnsureInvoices = isAdminAuthenticated;
          if (shouldEnsureInvoices) {
            const needsInvoice = nextOrders.filter(o => isInvoiceEligible(o) && !o.invoiceIssuedAt && !o.invoiceSnapshot && !invoiceEnsureAttemptedRef.current.has(o.id));
            if (needsInvoice.length > 0) {
              void (async () => {
                for (const order of needsInvoice) {
                  invoiceEnsureAttemptedRef.current.add(order.id);
                  try {
                    await ensureInvoiceIssued(order);
                  } catch (err) {
                    console.error("Background invoice issuance failed", err);
                  }
                }
              })();
            }
          }
        }
      } else {
        nextOrders = [];
      }
    } catch (error: any) {
      failed = true;
      const msg = String(error?.message || '');
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const isAborted = /abort|ERR_ABORTED|Failed to fetch/i.test(msg);
      if (import.meta.env.DEV) {
        if (isOffline || isAborted) {
          logger.info('تخطي جلب الطلبات: الشبكة غير متاحة أو الطلب أُلغي.');
        } else {
          logger.error('تعذر جلب الطلبات من الخادم:', {
            message: msg,
            code: String(error?.code || ''),
            status: (error as any)?.status,
            details: String(error?.details || ''),
            hint: String(error?.hint || ''),
          });
        }
      }
    } finally {
      const durationMs = Date.now() - startedAt;
      measurePerformance('orders.fetch', startedAt);
      if (durationMs > 5000 || failed) {
        logger.warn('orders_fetch_health', {
          durationMs,
          failed,
          fetchedRows,
          isAuthenticated: isAdminAuthenticated,
        });
      }
      if (!failed) {
        setOrders(nextOrders);
      }
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [currentUser, ensureInvoiceIssued, isAdminAuthenticated, isInvoiceEligible, resolveOrderAddress]);

  useEffect(() => {
    const init = async () => {
      await fetchOrders();
    };
    init();

    const onOffline = () => setOrders([]);
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', onOffline);
    }

    const supabase = getSupabaseClient();
    if (!supabase || !isRealtimeEnabled()) {
      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('offline', onOffline);
        }
      };
    }

    // Helper functions for notifications
    const playNotification = (soundPath: string, text: string) => {
      // 1. System Notification
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          try { new Notification('تنبيه جديد', { body: text, icon: '/logo.jpg' }); } catch { }
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
              try { new Notification('تنبيه جديد', { body: text, icon: '/logo.jpg' }); } catch { }
            }
          });
        }
      }

      // 2. Sound with TTS Fallback
      const audio = new Audio(soundPath);
      audio.play().catch(() => {
        // Fallback to TTS if sound file fails or interaction required
        if ('speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'ar-SA'; // Arabic
          window.speechSynthesis.speak(utterance);
        }
      });
    };

    const notifyNewOrder = (id: string) => {
      const text = `طلب جديد وصل #${id.slice(-4)}`;
      playNotification('/sounds/new_order.mp3', text);
    };

    const notifyDeliveryAssignment = (id: string) => {
      const text = `تم إسناد طلب جديد إليك #${id.slice(-4)}`;
      playNotification('/sounds/delivery_assigned.mp3', text);
    };

    const changeFilter = (!isAdminAuthenticated && currentUser?.id) ? `customer_auth_user_id=eq.${currentUser.id}` : undefined;
    const channel = supabase
      .channel('public:orders_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: changeFilter },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row: any = payload.new;
            const newOrderRaw = row?.data as Order;
            if (newOrderRaw) {
              void (async () => {
                const enriched: Order = {
                  ...newOrderRaw,
                  id: String(row.id),
                  status: (row.status as OrderStatus) || newOrderRaw.status || 'pending',
                  createdAt: typeof row.created_at === 'string' ? row.created_at : (newOrderRaw.createdAt || new Date().toISOString()),
                  deliveryZoneId: typeof row.delivery_zone_id === 'string' ? row.delivery_zone_id : newOrderRaw.deliveryZoneId,
                };
                const newOrder = await resolveOrderAddress(enriched);
                setOrders((prev) => {
                  if (prev.find(o => o.id === newOrder.id)) return prev;
                  if (isAdminAuthenticated || newOrder.userId === currentUser?.id) {
                    if (isAdminAuthenticated) {
                      if (adminUser?.role === 'cashier') {
                        if (newOrder.assignedDeliveryUserId === adminUser?.id) {
                          notifyNewOrder(newOrder.id);
                        }
                      } else {
                        notifyNewOrder(newOrder.id);
                      }
                    }
                    return [newOrder, ...prev].sort((a, b) => (String(b.createdAt || '')).localeCompare(String(a.createdAt || '')));
                  }
                  return prev;
                });
              })();
            }
          } else if (payload.eventType === 'UPDATE') {
            const row: any = payload.new;
            const updatedOrderRaw = row?.data as Order;
            if (updatedOrderRaw) {
              void (async () => {
                const enriched: Order = {
                  ...updatedOrderRaw,
                  id: String(row.id),
                  status: (row.status as OrderStatus) || updatedOrderRaw.status || 'pending',
                  createdAt: typeof row.created_at === 'string' ? row.created_at : (updatedOrderRaw.createdAt || new Date().toISOString()),
                  deliveryZoneId: typeof row.delivery_zone_id === 'string' ? row.delivery_zone_id : updatedOrderRaw.deliveryZoneId,
                };
                const updatedOrder = await resolveOrderAddress(enriched);
                setOrders((prev) => prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)));
                if (adminUser?.role === 'delivery' && updatedOrder.assignedDeliveryUserId === adminUser.id && !updatedOrder.deliveryAcceptedAt && updatedOrder.status !== 'delivered') {
                  notifyDeliveryAssignment(updatedOrder.id);
                }
              })();
            }
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id; // Corrected: payload.old contains the id
            if (deletedId) {
              setOrders(prev => prev.filter(o => o.id !== deletedId));
            }
          }
        }
      )
      .subscribe((status: any) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          disableRealtime();
          supabase.removeChannel(channel);
        }
      });

    return () => {
      supabase.removeChannel(channel);
      if (typeof window !== 'undefined') {
        window.removeEventListener('offline', onOffline);
      }
    };
  }, [isAdminAuthenticated, currentUser?.id, adminUser, resolveOrderAddress]);

  const issueInvoiceNow = useCallback(async (orderId: string) => {
    const existingLocal = orders.find(o => o.id === orderId);
    const existing = existingLocal || (await fetchRemoteOrderById(orderId));
    if (!existing) return;
    const nowIso = new Date().toISOString();
    await ensureInvoiceIssued(existing, nowIso);
    // await fetchOrders();
  }, [orders, ensureInvoiceIssued, fetchRemoteOrderById, fetchOrders]);


  const addOrder = async (orderData: Omit<Order, 'id' | 'createdAt' | 'status' | 'userId' | 'pointsEarned'>): Promise<Order> => {
    if (!currentUser) {
      throw new Error('يجب تسجيل الدخول قبل إنشاء الطلب.');
    }

    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');

    const simplifiedItems = orderData.items.map((item: any) => {
      if (item?.lineType === 'promotion' || item?.promotionId || item?.promotionSnapshot?.promotionId) {
        return {
          lineType: 'promotion',
          promotionId: String(item.promotionId || item.promotionSnapshot?.promotionId || item.id),
          bundleQty: Number(item.quantity) || 1,
          cartItemId: String(item.cartItemId || crypto.randomUUID()),
        };
      }
      const addonsSimple: Record<string, number> = {};
      if (item.selectedAddons) {
        Object.entries(item.selectedAddons).forEach(([key, val]: any) => {
          if (val?.quantity > 0) addonsSimple[key] = val.quantity;
        });
      }
      return {
        itemId: item.id,
        quantity: item.quantity,
        weight: item.weight,
        uomCode: typeof item.uomCode === 'string' ? item.uomCode.trim() : undefined,
        selectedAddons: addonsSimple,
      };
    });

    let scopedWarehouseId: string | null = null;
    try {
      scopedWarehouseId = sessionScope?.scope?.warehouseId || sessionScope.requireScope().warehouseId;
    } catch {
      scopedWarehouseId = null;
    }
    if (!scopedWarehouseId) {
      const wid = (orderData as any)?.warehouseId;
      if (typeof wid === 'string' && wid.trim().length > 0) {
        scopedWarehouseId = wid.trim();
      }
    }
    const rpcPayload = {
      p_items: simplifiedItems,
      p_delivery_zone_id: orderData.deliveryZoneId,
      p_payment_method: orderData.paymentMethod,
      p_notes: orderData.notes,
      p_address: orderData.address,
      p_location: orderData.location,
      p_customer_name: orderData.customerName,
      p_phone_number: orderData.phoneNumber,
      p_is_scheduled: Boolean(orderData.isScheduled),
      p_scheduled_at: orderData.scheduledAt || null,
      p_coupon_code: orderData.appliedCouponCode || null,
      p_points_redeemed_value: orderData.pointsRedeemedValue || 0,
      p_payment_proof_type: orderData.paymentProofType || null,
      p_payment_proof: orderData.paymentProof || null,
      p_currency: (orderData as any)?.currency ? String((orderData as any).currency).trim().toUpperCase() : null,
      p_warehouse_id: scopedWarehouseId
    };

    const { data: createdOrderData, error } = await supabase.rpc('create_order_secure_with_payment_proof', rpcPayload);
    if (error) {
      console.error('RPC Error:', error);
      throw new Error(localizeSupabaseError(error));
    }

    let createdId: string | undefined = undefined;
    let newOrder: Order | undefined = undefined;
    try {
      const candidate = createdOrderData as any;
      createdId = typeof candidate?.id === 'string' ? candidate.id : undefined;
      if (candidate && typeof candidate === 'object' && Array.isArray(candidate.items) && typeof candidate.userId === 'string') {
        newOrder = candidate as Order;
      }
    } catch {
    }
    if (!newOrder) {
      if (!createdId) {
        throw new Error('تعذر تحديد رقم الطلب الذي تم إنشاؤه.');
      }
      try {
        const { data: row, error: fetchError } = await supabase.from('orders').select('id,data').eq('id', createdId).maybeSingle();
        if (fetchError) throw fetchError;
        const payload = row?.data as Order | undefined;
        if (!payload) throw new Error('تعذر تحميل تفاصيل الطلب بعد إنشائه.');
        newOrder = payload;
      } catch (err) {
        throw new Error(localizeSupabaseError(err));
      }
    }

    if (createdId) {
      const createdAtRaw = (newOrder as any)?.createdAt ? String((newOrder as any).createdAt) : '';
      const createdAtOk = Boolean(createdAtRaw) && Number.isFinite(Date.parse(createdAtRaw));
      if (!createdAtOk) {
        try {
          const { data: row, error: fetchError } = await supabase
            .from('orders')
            .select('created_at,status,delivery_zone_id,data')
            .eq('id', createdId)
            .maybeSingle();
          if (!fetchError && row) {
            const base = (row.data || {}) as Order;
            newOrder = {
              ...base,
              ...newOrder,
              id: String(createdId),
              status: (row.status as OrderStatus) || (newOrder as any).status || base.status || 'pending',
              createdAt: typeof (row as any).created_at === 'string' ? (row as any).created_at : (createdAtRaw || new Date().toISOString()),
              deliveryZoneId: typeof (row as any).delivery_zone_id === 'string' ? (row as any).delivery_zone_id : (newOrder as any).deliveryZoneId || base.deliveryZoneId,
            } as Order;
          }
        } catch {
        }
      }
    }

    const displayOrder = await resolveOrderAddress(newOrder);
    setOrders(prev => (prev.some(o => o.id === displayOrder.id) ? prev : [displayOrder, ...prev]));

    void (async () => {
      // Referrer Logic (Client-side for now, could be moved to RPC later)
      if (currentUser) {
        // Points redemption and Coupon usage are now handled by RPC
        // Only First Order Referrer Reward remains here

        const isFirstOrder = userOrders.length === 0;
        const { referralRewardPoints } = settings.loyaltySettings;

        if (isFirstOrder && currentUser.referredBy && !currentUser.firstOrderDiscountApplied && supabase) {
          let referrerAuthId: string | undefined;
          try {
            const { data: rows, error } = await supabase
              .from('customers')
              .select('auth_user_id, referral_code')
              .eq('referral_code', currentUser.referredBy)
              .limit(1);
            if (!error) {
              referrerAuthId = (rows || [])[0]?.auth_user_id ? String((rows || [])[0]?.auth_user_id) : undefined;
            }
          } catch {
          }

          if (referrerAuthId) {
            try {
              await addLoyaltyPoints(referrerAuthId, referralRewardPoints);
              if (import.meta.env.DEV) {
                console.log(`Awarded ${referralRewardPoints} points to referrer ${referrerAuthId}`);
              }
            } catch (error) {
              if (import.meta.env.DEV) {
                console.error('Failed to reward referrer', error);
              }
            }
          }

          try {
            await updateCustomer({ ...currentUser, firstOrderDiscountApplied: true });
          } catch (error) {
            if (import.meta.env.DEV) {
              logger.error('Failed to mark first order discount applied', error);
            }
          }
        }
      }

      try {
        await fetchOrders();
      } catch {
      }
    })();

    return displayOrder;
  };

  const createInStoreSale = async (input: {
    lines: Array<
      | { menuItemId: string; quantity?: number; weight?: number; selectedAddons?: Record<string, number>; batchId?: string; uomCode?: string; uomQtyInBase?: number; warehouseId?: string }
      | { promotionId: string; bundleQty?: number; promotionLineId?: string; promotionSnapshot?: any; warehouseId?: string }
    >;
    currency?: string;
    customerId?: string;
    partyId?: string;
    customerName?: string;
    phoneNumber?: string;
    notes?: string;
    invoiceStatement?: string;
    clientTraceId?: string;
    belowCostOverrideReason?: string;
    discountType?: 'amount' | 'percent';
    discountValue?: number;
    paymentMethod: string;
    paymentReferenceNumber?: string;
    paymentSenderName?: string;
    paymentSenderPhone?: string;
    paymentDeclaredAmount?: number;
    paymentAmountConfirmed?: boolean;
    paymentDestinationAccountId?: string;
    isCredit?: boolean;
    creditDays?: number;
    dueDate?: string;
    paymentBreakdown?: Array<{
      method: string;
      amount: number;
      referenceNumber?: string;
      senderName?: string;
      senderPhone?: string;
      declaredAmount?: number;
      amountConfirmed?: boolean;
      destinationAccountId?: string;
      cashReceived?: number;
    }>;
  }) => {
    if (!isAdminAuthenticated || !canCreateInStoreSale()) {
      throw new Error('ليس لديك صلاحية تسجيل بيع حضوري.');
    }
    const canMarkPaidUi = hasPermission('orders.markPaid');

    const IN_STORE_DELIVERY_ZONE_ID = '11111111-1111-4111-8111-111111111111';
    const baseCurrency = String((await getBaseCurrencyCode()) || '').toUpperCase().trim() || 'YER';
    const desiredCurrency = String((input as any).currency || baseCurrency || '').toUpperCase().trim() || baseCurrency;
    const enabledPaymentMethods = Object.entries(settings.paymentMethods || {})
      .filter(([, isEnabled]) => Boolean(isEnabled))
      .map(([key]) => key);

    if (enabledPaymentMethods.length === 0) {
      throw new Error('لا توجد طرق دفع مفعلة في الإعدادات.');
    }

    const method = (input.paymentMethod || '').trim();
    if (!method && !input.isCredit) {
      throw new Error('يرجى اختيار طريقة الدفع.');
    }

    if (!input.isCredit && !enabledPaymentMethods.includes(method)) {
      throw new Error('طريقة الدفع غير مفعلة في الإعدادات.');
    }

    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    const normalizedMenuLines = rawLines
      .filter((l: any) => typeof l?.menuItemId === 'string' && Boolean(l.menuItemId))
      .map((l: any) => ({
        menuItemId: String(l.menuItemId),
        quantity: typeof l.quantity === 'number' ? l.quantity : undefined,
        weight: typeof l.weight === 'number' ? l.weight : undefined,
        batchId: typeof l.batchId === 'string' && l.batchId.trim() ? String(l.batchId) : undefined,
        selectedAddons: l.selectedAddons || {},
        uomCode: typeof l.uomCode === 'string' && l.uomCode.trim() ? l.uomCode.trim() : undefined,
        uomQtyInBase: typeof l.uomQtyInBase === 'number' && l.uomQtyInBase > 0 ? l.uomQtyInBase : 1,
        warehouseId: typeof l.warehouseId === 'string' && l.warehouseId.trim() ? String(l.warehouseId).trim() : undefined,
        _pricedByRpc: l._pricedByRpc,
        price: l.price,
        pricePerUnit: l.pricePerUnit,
        _fefoBatchId: l._fefoBatchId,
        _fefoBatchCode: l._fefoBatchCode,
        _fefoExpiryDate: l._fefoExpiryDate,
        _fefoUnitCost: l._fefoUnitCost,
        _fefoMinPrice: l._fefoMinPrice,
        _fefoNextBatchMinPrice: l._fefoNextBatchMinPrice,
        _fefoWarningNextBatchPriceDiff: l._fefoWarningNextBatchPriceDiff,
      }));
    const normalizedPromoLines = rawLines
      .filter((l: any) => typeof l?.promotionId === 'string' && Boolean(l.promotionId))
      .map((l: any) => ({
        promotionId: String(l.promotionId),
        bundleQty: typeof l.bundleQty === 'number' ? l.bundleQty : undefined,
        promotionLineId: typeof l.promotionLineId === 'string' ? l.promotionLineId : undefined,
        promotionSnapshot: l.promotionSnapshot,
        warehouseId: typeof l.warehouseId === 'string' && l.warehouseId.trim() ? String(l.warehouseId).trim() : undefined,
      }));

    if (!normalizedMenuLines.length && !normalizedPromoLines.length) {
      throw new Error('يجب إضافة صنف واحد على الأقل.');
    }

    const menuItems = await Promise.all(normalizedMenuLines.map((l) => loadMenuItemById(l.menuItemId)));
    if (menuItems.some((m) => !m)) {
      throw new Error('تعذر تحميل بعض الأصناف.');
    }

    const nowIso = new Date().toISOString();
    const warehouseId = sessionScope.requireScope().warehouseId;
    if (input.isCredit) {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase غير مهيأ.');
      const rawId = String(input.customerId || '').trim();
      const rawPartyId = String((input as any).partyId || '').trim();
      if (!isUuid(rawId) && !isUuid(rawPartyId)) {
        throw new Error('لا يمكن البيع الآجل بدون عميل أو طرف مالي صالح.');
      }
      if (isUuid(rawId)) {
        const { data: cRow } = await supabase
          .from('customers')
          .select('auth_user_id, customer_type, payment_terms, credit_limit')
          .eq('auth_user_id', rawId)
          .maybeSingle();
        if (!cRow?.auth_user_id) {
          throw new Error('البيع الآجل متاح فقط لعميل مسجل في قسم إدارة العملاء بنوع wholesale.');
        }
      }
    }
    let items: CartItem[] = normalizedMenuLines.map((line, idx) => {
      const menuItem = menuItems[idx]!;
      const unitType = menuItem.unitType;
      const isWeightBased = unitType === 'kg' || unitType === 'gram';
      const quantity = !isWeightBased ? (line.quantity || 0) : 1;
      const weight = isWeightBased ? (line.weight || 0) : undefined;
      const uomQtyInBase = !isWeightBased ? (Number(line.uomQtyInBase) || 1) : 1;
      const uomCode = !isWeightBased ? (typeof line.uomCode === 'string' ? line.uomCode : undefined) : undefined;

      // Resolve addons
      const resolvedAddons: CartItem['selectedAddons'] = {};
      if (line.selectedAddons && menuItem.addons) {
        Object.entries(line.selectedAddons).forEach(([addonId, addonQty]) => {
          const addon = menuItem.addons?.find(addonDef => addonDef.id === addonId);
          const qty = Number(addonQty) || 0;
          if (addon && qty > 0) {
            resolvedAddons[addonId] = { addon, quantity: qty };
          }
        });
      }

      return {
        ...menuItem,
        quantity,
        weight,
        selectedAddons: resolvedAddons,
        forcedBatchId: line.batchId,
        uomQtyInBase,
        uomCode,
        warehouseId: line.warehouseId,
        cartItemId: crypto.randomUUID(),
        ...(line._pricedByRpc ? {
          _pricedByRpc: line._pricedByRpc,
          price: line.price !== undefined ? line.price : menuItem.price,
          pricePerUnit: line.pricePerUnit !== undefined ? line.pricePerUnit : ((line.price !== undefined ? line.price : menuItem.price) * 1000),
          _fefoBatchId: line._fefoBatchId,
          _fefoBatchCode: line._fefoBatchCode,
          _fefoExpiryDate: line._fefoExpiryDate,
          _fefoUnitCost: line._fefoUnitCost,
          _fefoMinPrice: line._fefoMinPrice,
          _fefoNextBatchMinPrice: line._fefoNextBatchMinPrice,
          _fefoWarningNextBatchPriceDiff: line._fefoWarningNextBatchPriceDiff,
        } : {})
      };
    });

    if (normalizedPromoLines.length > 0) {
      const rawDiscount = Number(input.discountValue) || 0;
      if (rawDiscount > 0) {
        throw new Error('لا يمكن تطبيق خصم يدوي على فاتورة تحتوي عرضاً.');
      }

      const promoItems: CartItem[] = normalizedPromoLines.map((line) => {
        const snapshot = line.promotionSnapshot;
        const bundleQty = Math.max(1, Number(line.bundleQty ?? snapshot?.bundleQty) || 1);
        const finalTotal = Number(snapshot?.finalTotal) || 0;
        if (!snapshot || !snapshot.promotionId || !Number.isFinite(finalTotal)) {
          throw new Error('تعذر إتمام بيع العرض: يلزم تسعير العرض من الخادم قبل الإتمام.');
        }
        const perBundlePrice = bundleQty > 0 ? finalTotal / bundleQty : finalTotal;
        const promotionLineId = line.promotionLineId || crypto.randomUUID();

        const promoLine: CartItem = {
          id: String(snapshot.promotionId),
          name: { ar: String(snapshot.name || ''), en: String(snapshot.name || '') },
          description: { ar: '', en: '' },
          imageUrl: '',
          category: 'promotion',
          price: perBundlePrice,
          unitType: 'bundle',
          quantity: bundleQty,
          selectedAddons: {},
          warehouseId: line.warehouseId,
          cartItemId: crypto.randomUUID(),
        } as any;

        (promoLine as any).lineType = 'promotion';
        (promoLine as any).promotionId = String(snapshot.promotionId);
        (promoLine as any).promotionLineId = promotionLineId;
        (promoLine as any).promotionSnapshot = snapshot;
        return promoLine;
      });

      items = [...items, ...promoItems];
    }

    if (items.some((i) => getRequestedItemQuantity(i) <= 0)) {
      throw new Error('الكمية/الوزن يجب أن يكون أكبر من صفر.');
    }
    const stockBearingItems = items.filter((it: any) => !(it?.lineType === 'promotion' || it?.promotionId));
    const lineWarehouseIds = Array.from(new Set(
      stockBearingItems
        .map((it: any) => String(it?.warehouseId || warehouseId || '').trim())
        .filter(Boolean)
    ));
    const effectiveOrderWarehouseId = String(lineWarehouseIds[0] || warehouseId || '').trim();
    if (!effectiveOrderWarehouseId) {
      throw new Error('لا يمكن إنشاء الطلب بدون تحديد مستودع تنفيذ.');
    }

    const hasPromoLines =
      Array.isArray((items as any[])) && (items as any[]).some((it: any) => it?.lineType === 'promotion' || it?.promotionId);
    const offlineHint = typeof navigator !== 'undefined' && navigator.onLine === false;

    // Client-side sequential stock checks were removed here because they caused 
    // massive O(N) latency during checkout on slow connections. 
    // Stock validation is strictly enforced by the backend RPC (confirm_order_delivery).

    let pricedItems: CartItem[] = items;
    if (!offlineHint) {
      const supabaseForPricing = getSupabaseClient();
      if (!supabaseForPricing) throw new Error('Supabase غير مهيأ.');

      const canReuseServerPriced = items.every((item: any) => {
        if (item?.lineType === 'promotion' || item?.promotionId) return true;
        if ((item as any)?._pricedByRpc !== true) return false;
        const unitPrice = Number(item?.price);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) return false;
        if (item.unitType === 'gram') {
          const per = Number(item?.pricePerUnit);
          if (!Number.isFinite(per) || per <= 0) return false;
        }
        return true;
      });

      if (canReuseServerPriced) {
        pricedItems = items.map((item: any) => {
          if (item?.lineType === 'promotion' || item?.promotionId) return item as CartItem;
          const unitPrice = Number(item.price);
          if (item.unitType === 'gram') {
            const per = Number(item.pricePerUnit) || unitPrice * 1000;
            return { ...item, price: unitPrice, pricePerUnit: per };
          }
          return { ...item, price: unitPrice };
        });
      } else {
        pricedItems = await Promise.all(items.map(async (item: any) => {
          if (item?.lineType === 'promotion' || item?.promotionId) return item as CartItem;
          const uomFactor = Number((item as any).uomQtyInBase) || 1;
          const pricingQty = (item.unitType === 'kg' || item.unitType === 'gram')
            ? (item.weight || item.quantity)
            : item.quantity * uomFactor;
          const rawCustomerId = (input.customerId && String(input.customerId).trim() !== '') ? String(input.customerId) : null;
          const call = async (customerId: string | null) => {
            return await supabaseForPricing!.rpc('get_fefo_pricing', {
              p_item_id: item.id,
              p_warehouse_id: (item as any).warehouseId || effectiveOrderWarehouseId,
              p_quantity: pricingQty,
              p_customer_id: customerId,
              p_currency_code: desiredCurrency,
              p_batch_id: (item as any).forcedBatchId || null,
            });
          };
          let { data, error } = await call(rawCustomerId);

          if (error && isRpcNotFoundError(error)) {
            const reloaded = await reloadPostgrestSchema();
            if (reloaded) {
              const retry = await call(rawCustomerId);
              data = retry.data;
              error = retry.error;
            }
          }

          if (error) throw new Error(localizeSupabaseError(error));
          const row = (Array.isArray(data) ? data[0] : data) as any;
          const unitPrice = Number(row?.suggested_price);
          if (!Number.isFinite(unitPrice) || unitPrice < 0) {
            throw new Error('تعذر احتساب السعر.');
          }
          const basePatch: any = {
            _pricedByRpc: true,
            _fefoBatchId: row?.batch_id ? String(row.batch_id) : undefined,
            _fefoBatchCode: row?.batch_code ? String(row.batch_code) : undefined,
            _fefoExpiryDate: row?.expiry_date ? String(row.expiry_date) : undefined,
            _fefoUnitCost: Number(row?.unit_cost) || 0,
            _fefoMinPrice: row?.min_price != null ? Number(row?.min_price) : undefined,
            _fefoNextBatchMinPrice: row?.next_batch_min_price != null ? Number(row?.next_batch_min_price) : undefined,
            _fefoWarningNextBatchPriceDiff: Boolean(row?.warning_next_batch_price_diff),
          };
          if (item.unitType === 'gram') {
            return { ...item, price: unitPrice, pricePerUnit: unitPrice * 1000, ...basePatch };
          }
          return { ...item, price: unitPrice, ...basePatch };
        }));
      }
    } else {
      pricedItems = items.map((item) => {
        if (!(item as any)?._pricedByRpc) {
          throw new Error('لا يمكن إتمام البيع بدون تسعير معتمد من الخادم. افتح النظام متصلاً لتأكيد الأسعار ثم أعد المحاولة.');
        }
        const unitPrice = Number(item.price);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new Error('تعذر احتساب السعر بدون اتصال. يرجى فتح النظام متصلاً لتحديث الأسعار.');
        }
        if (item.unitType === 'gram') {
          return { ...item, price: unitPrice, pricePerUnit: item.pricePerUnit || unitPrice * 1000 };
        }
        return { ...item, price: unitPrice };
      });
    }

    items = pricedItems;

    let fxRate = 1;

    items = items.map((item: any) => {
      const basePrice = Number(item._basePrice != null ? item._basePrice : item.price) || 0;
      const selected = item.selectedAddons && typeof item.selectedAddons === 'object' ? item.selectedAddons : {};
      const nextSelected: any = {};
      for (const [id, entry] of Object.entries(selected)) {
        const e: any = entry as any;
        const addon = e?.addon;
        const addonBase = Number(addon?._basePrice != null ? addon._basePrice : addon?.price) || 0;
        nextSelected[id] = {
          ...e,
          addon: addon ? { ...addon, _basePrice: addonBase } : addon,
        };
      }
      const next: any = {
        ...item,
        _basePrice: basePrice,
        selectedAddons: nextSelected,
      };
      if (item.unitType === 'gram') {
        const basePerUnit = Number(item._basePricePerUnit != null ? item._basePricePerUnit : (Number(item.pricePerUnit) || basePrice * 1000)) || 0;
        next._basePricePerUnit = basePerUnit;
      }
      return next as CartItem;
    });
    if (desiredCurrency !== baseCurrency) {
      if (offlineHint) {
        throw new Error('لا يمكن إتمام بيع بعملة غير أساسية بدون اتصال. أعد المحاولة وأنت متصل.');
      }
      const supabaseFx = getSupabaseClient();
      if (!supabaseFx) throw new Error('Supabase غير مهيأ.');
      const { data: fxValue, error: fxErr } = await supabaseFx.rpc('get_fx_rate_rpc', {
        p_currency_code: desiredCurrency,
      } as any);
      if (fxErr) throw new Error(localizeSupabaseError(fxErr));
      const fx = Number(fxValue);
      if (!Number.isFinite(fx) || !(fx > 0)) {
        throw new Error('لا يوجد سعر صرف تشغيلي صالح لهذه العملة. أضف السعر من شاشة أسعار الصرف.');
      }
      fxRate = fx;
    }

    if (desiredCurrency !== baseCurrency && fxRate > 0) {
      items = items.map((item: any) => {
        const wasServerPriced = Boolean((item as any)?._pricedByRpc);
        const baseUnitPrice = Number((item as any)?._basePrice != null ? (item as any)._basePrice : item.price) || 0;
        const nextSelected: any = {};
        for (const [id, entry] of Object.entries(item.selectedAddons || {})) {
          const e: any = entry as any;
          const addon = e?.addon;
          const addonBase = Number(addon?._basePrice != null ? addon._basePrice : addon?.price) || 0;
          const addonPriceTxn = addonBase / fxRate;
          nextSelected[id] = {
            ...e,
            addon: addon
              ? {
                ...addon,
                _basePrice: addonBase,
                price: addonPriceTxn,
              }
              : addon,
          };
        }
        if (item.unitType === 'gram') {
          const basePerUnit = Number((item as any)?._basePricePerUnit != null ? (item as any)._basePricePerUnit : ((Number(item.pricePerUnit) || baseUnitPrice * 1000))) || 0;
          const nextPerUnit = wasServerPriced ? (Number(item.pricePerUnit) || (basePerUnit / fxRate)) : (basePerUnit / fxRate);
          const nextUnitPrice = nextPerUnit / 1000;
          return {
            ...item,
            price: nextUnitPrice,
            pricePerUnit: nextPerUnit,
            selectedAddons: nextSelected,
          };
        }
        const nextUnitPrice = wasServerPriced ? (Number(item.price) || (baseUnitPrice / fxRate)) : (baseUnitPrice / fxRate);
        return {
          ...item,
          price: nextUnitPrice,
          selectedAddons: nextSelected,
        };
      });
    }

    const computedSubtotal = items.reduce((total, item) => {
      const addonsPrice = Object.values(item.selectedAddons || {}).reduce(
        (sum, { addon, quantity }) => sum + addon.price * quantity,
        0
      );

      let itemPrice = item.price;
      let itemQuantity = item.quantity;
      const uomFactor = Number((item as any)?.uomQtyInBase || 1) || 1;

      if (item.unitType === 'kg' || item.unitType === 'gram') {
        itemQuantity = item.weight || item.quantity;
        if (item.unitType === 'gram' && item.pricePerUnit) {
          itemPrice = item.pricePerUnit / 1000;
        }
      } else {
        itemQuantity = (Number(itemQuantity) || 0) * uomFactor;
      }

      return total + (itemPrice + addonsPrice) * itemQuantity;
    }, 0);

    const discountType = input.discountType === 'percent' ? 'percent' : 'amount';
    const discountValueRaw = Number(input.discountValue) || 0;
    const discountValue = Number.isFinite(discountValueRaw) ? discountValueRaw : 0;
    const discountAmount = discountType === 'percent'
      ? Math.max(0, Math.min(100, discountValue)) * computedSubtotal / 100
      : Math.max(0, Math.min(computedSubtotal, discountValue));

    const taxableBase = Math.max(0, computedSubtotal - discountAmount);
    const computedTotal = taxableBase;
    const currencyDecimals = getCurrencyDecimalsByCode(desiredCurrency);
    const computedTotalRounded = Number(computedTotal.toFixed(currencyDecimals));

    const normalizedBreakdown = (input.paymentBreakdown || [])
      .map((p) => ({
        method: (p.method || '').trim(),
        amount: Number(p.amount) || 0,
        referenceNumber: (p.referenceNumber || '').trim() || undefined,
        senderName: (p.senderName || '').trim() || undefined,
        senderPhone: (p.senderPhone || '').trim() || undefined,
        declaredAmount: Number(p.declaredAmount) || 0,
        amountConfirmed: Boolean(p.amountConfirmed),
        destinationAccountId: String((p as any).destinationAccountId || '').trim() || undefined,
        cashReceived: Number(p.cashReceived) || 0,
      }))
      .filter((p) => Boolean(p.method) && (Number(p.amount) || 0) > 0);

    const fallbackNeedsReference = method === 'kuraimi' || method === 'network';
    const fallbackBreakdown = [
      {
        method,
        amount: computedTotalRounded,
        referenceNumber: fallbackNeedsReference ? (input.paymentReferenceNumber || '').trim() || undefined : undefined,
        senderName: fallbackNeedsReference ? (input.paymentSenderName || '').trim() || undefined : undefined,
        senderPhone: fallbackNeedsReference ? (input.paymentSenderPhone || '').trim() || undefined : undefined,
        declaredAmount: fallbackNeedsReference ? (Number(input.paymentDeclaredAmount) || 0) : 0,
        amountConfirmed: fallbackNeedsReference ? Boolean(input.paymentAmountConfirmed) : true,
        destinationAccountId: fallbackNeedsReference ? String((input as any).paymentDestinationAccountId || '').trim() || undefined : undefined,
        cashReceived: 0,
      },
    ];

    const paymentBreakdown = input.isCredit
      ? normalizedBreakdown
      : (normalizedBreakdown.length > 0 ? normalizedBreakdown : fallbackBreakdown);

    const breakdownMethods = new Set(paymentBreakdown.map((p) => p.method));
    const cashLines = paymentBreakdown.filter((p) => p.method === 'cash');
    if (cashLines.length > 1) {
      throw new Error('لا يمكن تكرار الدفع النقدي أكثر من مرة في نفس البيع.');
    }

    for (const p of paymentBreakdown) {
      if (!enabledPaymentMethods.includes(p.method)) {
        throw new Error('توجد طريقة دفع غير مفعلة ضمن تقسيم الدفع.');
      }
      const needsReference = p.method === 'kuraimi' || p.method === 'network';
      if (needsReference) {
        if (!p.referenceNumber) {
          throw new Error(p.method === 'kuraimi' ? 'يرجى إدخال رقم الإيداع.' : 'يرجى إدخال رقم الحوالة.');
        }
        if (!p.senderName) {
          throw new Error(p.method === 'kuraimi' ? 'يرجى إدخال اسم المودِع.' : 'يرجى إدخال اسم المرسل.');
        }
        if (!(p.declaredAmount > 0)) {
          throw new Error('يرجى إدخال مبلغ العملية.');
        }
        if (Math.abs((Number(p.declaredAmount) || 0) - (Number(p.amount) || 0)) > 0.0001) {
          throw new Error('مبلغ العملية لا يطابق مبلغ طريقة الدفع.');
        }
        if (!p.amountConfirmed) {
          throw new Error('يرجى تأكيد مطابقة المبلغ قبل تسجيل البيع.');
        }
      }
      if (p.method === 'cash') {
        if (p.cashReceived > 0 && p.cashReceived + 1e-9 < p.amount) {
          throw new Error('المبلغ المستلم نقداً أقل من المطلوب.');
        }
      }
    }

    if (!input.isCredit && !breakdownMethods.has(method)) {
      throw new Error('طريقة الدفع الرئيسية لا تطابق تقسيم الدفع.');
    }

    let paymentTotal = paymentBreakdown.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    // ── Auto-reconcile payment amounts to match server-recomputed total ──
    // The frontend computes the total from local menu-item prices, but
    // createInStoreSale re-prices using get_fefo_pricing (batch-based).
    // Small drifts are expected; auto-correct instead of throwing.
    const payTol = Math.pow(10, -currencyDecimals);
    const priceDrift = Math.abs(paymentTotal - computedTotalRounded);
    if (!input.isCredit && priceDrift > payTol && paymentBreakdown.length > 0) {
      // Prefer adjusting the cash line if present, otherwise adjust the largest line
      const cashIdx = paymentBreakdown.findIndex(p => p.method === 'cash');
      const mainIdx = cashIdx >= 0
        ? cashIdx
        : paymentBreakdown.reduce((best, p, i, arr) =>
          (Number(p.amount) || 0) > (Number(arr[best].amount) || 0) ? i : best, 0);
      const diff = computedTotalRounded - paymentTotal;
      const nextAmount = Math.max(0, (Number(paymentBreakdown[mainIdx].amount) || 0) + diff);
      paymentBreakdown[mainIdx].amount = nextAmount;
      // Keep amounts aligned for method-specific fields
      if (paymentBreakdown[mainIdx].method === 'kuraimi' || paymentBreakdown[mainIdx].method === 'network') {
        (paymentBreakdown[mainIdx] as any).declaredAmount = nextAmount;
        (paymentBreakdown[mainIdx] as any).amountConfirmed = true;
      } else if (paymentBreakdown[mainIdx].method === 'cash') {
        const cr = Number((paymentBreakdown[mainIdx] as any).cashReceived) || 0;
        if (cr > 0) {
          (paymentBreakdown[mainIdx] as any).cashReceived = nextAmount;
        }
      }
      paymentTotal = paymentBreakdown.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      if (import.meta.env.DEV) {
        console.log('[createInStoreSale] Auto-reconciled payment drift:', priceDrift.toFixed(4), 'adjusted by', diff.toFixed(4));
      }
    }

    if (input.isCredit && paymentTotal - computedTotalRounded > payTol) {
      throw new Error('مجموع الدفعات أكبر من إجمالي البيع.');
    }
    const isFullyPaid = input.isCredit
      ? (paymentTotal + payTol >= computedTotalRounded)
      : (Math.abs(paymentTotal - computedTotalRounded) <= payTol);

    if (!input.isCredit && !isFullyPaid) {
      throw new Error('مجموع تقسيم الدفع لا يطابق إجمالي البيع.');
    }

    const cashEntry = cashLines[0];
    const cashReceived = cashEntry && cashEntry.cashReceived > 0 ? cashEntry.cashReceived : undefined;
    const cashChange = cashEntry && cashEntry.cashReceived > 0 ? Math.max(0, cashEntry.cashReceived - cashEntry.amount) : undefined;

    const orderPaymentMethod = input.isCredit ? 'ar' : (paymentBreakdown.length === 1 ? paymentBreakdown[0].method : 'mixed');
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
    const saleDateYmd = toYmd(new Date());
    const creditDays = Math.max(0, Number(input.creditDays) || 0) || 30;
    const dueYmd = input.isCredit
      ? (typeof input.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ? input.dueDate : addDaysToYmd(saleDateYmd, creditDays))
      : saleDateYmd;
    let invoiceNumber = generateInvoiceNumber(crypto.randomUUID(), nowIso);
    const singleNeedsReference = orderPaymentMethod === 'kuraimi' || orderPaymentMethod === 'network';
    const singleReferenceNumber = paymentBreakdown.length === 1 ? (paymentBreakdown[0].referenceNumber || '') : '';
    const singleSenderName = paymentBreakdown.length === 1 ? (paymentBreakdown[0].senderName || '') : '';
    const singleSenderPhone = paymentBreakdown.length === 1 ? (paymentBreakdown[0].senderPhone || '') : '';
    const singleDeclaredAmount = paymentBreakdown.length === 1 ? (Number(paymentBreakdown[0].declaredAmount) || 0) : 0;

    const promotionLines = (items as any[])
      .filter((it) => it?.lineType === 'promotion' || it?.promotionId)
      .map((it) => ({
        ...(it.promotionSnapshot || {}),
        promotionLineId: String(it.promotionLineId || crypto.randomUUID()),
      }));

    const shouldAttemptImmediatePayment = canMarkPaidUi;
    let effectiveCustomerAuthId: string | undefined = undefined;
    if (isUuid(input.customerId || '')) {
      try {
        const supabase = getSupabaseClient();
        if (supabase) {
          const { data: cRow } = await supabase
            .from('customers')
            .select('auth_user_id')
            .eq('auth_user_id', String(input.customerId))
            .maybeSingle();
          if (cRow?.auth_user_id) effectiveCustomerAuthId = String(input.customerId);
        }
      } catch { }
    }
    const rawPartyId = String((input as any).partyId || '').trim();
    const existingOrderId = String((input as any).existingOrderId || '').trim();
    const isResumingExistingOrder = isUuid(existingOrderId);
    if (!offlineHint && isUuid(rawPartyId)) {
      try {
        const supabase = getSupabaseClient();
        if (supabase) {
          const { data: pRow, error: pErr } = await supabase
            .from('financial_parties')
            .select('id, party_type, is_active')
            .eq('id', rawPartyId)
            .maybeSingle();
          if (pErr) throw pErr;
          if (!pRow?.id) {
            throw new Error('الطرف المالي غير موجود.');
          }
          if (pRow.is_active === false) {
            throw new Error('الطرف المالي غير نشط.');
          }
          if (input.isCredit) {
            const pType = String((pRow as any).party_type || '').trim().toLowerCase();
            const allowed = pType === 'customer' || pType === 'partner' || pType === 'generic' || pType === 'employee' || pType === 'supplier';
            if (!allowed) {
              throw new Error('لا يمكن إنشاء بيع آجل لهذا النوع من الأطراف المالية.');
            }
          }
        }
      } catch (err: any) {
        throw new Error(typeof err?.message === 'string' && err.message ? err.message : 'تعذر التحقق من الطرف المالي.');
      }
    }
    const clientTraceId = String((input as any).clientTraceId || '').trim();
    const newOrder: Order = {
      id: isResumingExistingOrder ? existingOrderId : crypto.randomUUID(),
      userId: effectiveCustomerAuthId,
      orderSource: 'in_store',
      warehouseId: effectiveOrderWarehouseId,
      currency: desiredCurrency,
      customerId: input.customerId || undefined,
      items,
      ...(promotionLines.length ? ({ promotionLines } as any) : {}),
      subtotal: computedSubtotal,
      deliveryFee: 0,
      deliveryZoneId: IN_STORE_DELIVERY_ZONE_ID,
      discountAmount,
      total: computedTotal,
      customerName: input.customerName?.trim() || 'زبون حضوري',
      phoneNumber: input.phoneNumber?.trim() || '',
      notes: input.notes?.trim() || undefined,
      address: 'داخل المحل',
      paymentMethod: orderPaymentMethod || 'cash',
      paymentBreakdown: paymentBreakdown.length > 0 ? paymentBreakdown.map((p) => ({
        method: p.method,
        amount: p.amount,
        referenceNumber: p.referenceNumber,
        senderName: p.senderName,
        senderPhone: p.senderPhone,
        destinationAccountId: (p as any).destinationAccountId,
        cashReceived: p.method === 'cash' ? (p.cashReceived > 0 ? p.cashReceived : undefined) : undefined,
        cashChange: p.method === 'cash' && p.cashReceived > 0 ? Math.max(0, p.cashReceived - p.amount) : undefined,
      })) : undefined,
      cashReceived: canMarkPaidUi ? cashReceived : undefined,
      cashChange: canMarkPaidUi ? cashChange : undefined,
      paymentProofType: canMarkPaidUi && singleNeedsReference ? 'ref_number' : undefined,
      paymentProof: canMarkPaidUi && singleNeedsReference ? singleReferenceNumber : undefined,
      paymentSenderName: canMarkPaidUi && singleNeedsReference ? singleSenderName : undefined,
      paymentSenderPhone: canMarkPaidUi && singleNeedsReference ? singleSenderPhone : undefined,
      paymentDeclaredAmount: canMarkPaidUi && singleNeedsReference ? singleDeclaredAmount : undefined,
      paymentVerifiedBy: canMarkPaidUi && singleNeedsReference ? adminUser?.id : undefined,
      paymentVerifiedAt: canMarkPaidUi && singleNeedsReference ? nowIso : undefined,
      status: shouldAttemptImmediatePayment ? 'delivered' : 'pending',
      createdAt: nowIso,
      deliveredAt: shouldAttemptImmediatePayment ? nowIso : undefined,
      paidAt: undefined,
      reviewPointsAwarded: false,
      invoiceNumber,
      invoiceIssuedAt: undefined,
      invoiceSnapshot: undefined,
      invoicePrintCount: 0,
      isCreditSale: Boolean(input.isCredit),
      invoiceTerms: input.isCredit ? 'credit' : 'cash',
      netDays: input.isCredit ? creditDays : 0,
      dueDate: dueYmd,
    };
    const creditOverrideReason = String((input as any).creditOverrideReason || '').trim();
    if (creditOverrideReason) (newOrder as any).creditOverrideReason = creditOverrideReason;
    const belowCostOverrideReason = String((input as any).belowCostOverrideReason || '').trim();
    if (belowCostOverrideReason) (newOrder as any).belowCostOverrideReason = belowCostOverrideReason;
    (newOrder as any).fxRate = fxRate;
    (newOrder as any).baseCurrency = baseCurrency;
    if (clientTraceId) {
      (newOrder as any).clientTraceId = clientTraceId;
      (newOrder as any).traceId = clientTraceId;
    }
    if (isUuid(rawPartyId)) (newOrder as any).partyId = rawPartyId;

    const payloadItems = newOrder.items
      .filter((item: any) => !(item?.lineType === 'promotion' || item?.promotionId))
      .map((item) => ({
        itemId: String((item as any)?.itemId || item.id || ''),
        quantity: getRequestedItemQuantity(item),
        uomCode: String((item as any)?.uomCode || '').trim() || undefined,
        uomQtyInBase: Number((item as any)?.uomQtyInBase) || 1,
        batchId: (item as any)?._fefoBatchId || (item as any)?.forcedBatchId || undefined,
        warehouseId: (item as any)?.warehouseId || undefined,
      }))
      .filter((entry) => Number(entry.quantity) > 0);
    if (shouldAttemptImmediatePayment && payloadItems.length === 0 && !hasPromoLines) {
      throw new Error('لا يمكن إتمام البيع: تأكد من الكمية/الوزن للأصناف.');
    }

    const queueOfflineSale = async () => {
      if (hasPromoLines) {
        throw new Error('لا يمكن إتمام بيع عرض دون اتصال بالخادم. أعد المحاولة عند توفر الاتصال.');
      }
      const offlineOrder: Order = {
        ...newOrder,
        offlineId: newOrder.id,
        offlineState: 'CREATED_OFFLINE',
        status: 'pending',
        deliveredAt: undefined,
        paidAt: undefined,
        invoiceIssuedAt: undefined,
      };
      upsertOfflinePosOrder({ offlineId: offlineOrder.id, orderId: offlineOrder.id, state: 'CREATED_OFFLINE' });
      enqueueRpc('sync_offline_pos_sale', {
        p_offline_id: offlineOrder.id,
        p_order_id: offlineOrder.id,
        p_order_data: offlineOrder,
        p_items: payloadItems,
        p_warehouse_id: effectiveOrderWarehouseId,
        p_payments: (paymentBreakdown || []).map((p) => ({
          method: p.method,
          amount: Number(p.amount) || 0,
          referenceNumber: p.referenceNumber,
          senderName: p.senderName,
          senderPhone: p.senderPhone,
          destinationAccountId: (p as any).destinationAccountId,
          declaredAmount: Number((p as any).declaredAmount) || 0,
          amountConfirmed: Boolean((p as any).amountConfirmed),
          cashReceived: (p as any).cashReceived,
          occurredAt: nowIso,
        })),
      });
      setOrders(prev => [offlineOrder, ...prev.filter(o => o.id !== offlineOrder.id)]);
      return offlineOrder;
    };

    let paymentRecordOk = true;
    let paidAtIso: string | undefined;
    let shouldIssueInvoice = false;
    // invoiceNumber already declared above
    let finalized: Order = newOrder;

    try {
      if (isResumingExistingOrder) {
        // The order may not actually exist remotely if the previous attempt failed
        // before the insert completed. Try update first, but fall back to create.
        try {
          await updateRemoteOrder({ ...newOrder, status: 'pending' });
          // Verify the order actually exists after update (update on 0 rows is silent)
          const supabaseCheck = getSupabaseClient();
          if (supabaseCheck) {
            const { data: existing } = await supabaseCheck.from('orders').select('id').eq('id', newOrder.id).maybeSingle();
            if (!existing) {
              await createRemoteOrder({ ...newOrder, status: 'pending' });
            }
          }
        } catch {
          // If update fails for any reason, try creating instead
          await createRemoteOrder({ ...newOrder, status: 'pending' });
        }
      } else {
        await createRemoteOrder({ ...newOrder, status: 'pending' });
      }

      if (shouldAttemptImmediatePayment) {
        try {
          const supabase = getSupabaseClient();
          if (supabase) {
            const sb1 = supabase!;
            const { data: invNum } = await sb1.rpc('assign_invoice_number_if_missing', { p_order_id: newOrder.id });
            if (typeof invNum === 'string' && invNum) {
              invoiceNumber = invNum;
              newOrder.invoiceNumber = invNum;
            }
          }
        } catch { }
      }

      const buildValidationInvoiceSnapshot = (): NonNullable<Order['invoiceSnapshot']> => {
        const issuedAt = nowIso;
        const invNum = newOrder.invoiceNumber || invoiceNumber || generateInvoiceNumber(newOrder.id, issuedAt);
        const snapshotItems = typeof structuredClone === 'function'
          ? structuredClone(newOrder.items || [])
          : JSON.parse(JSON.stringify(newOrder.items || []));
        return {
          issuedAt,
          invoiceNumber: invNum,
          createdAt: newOrder.createdAt || issuedAt,
          orderSource: 'in_store',
          currency: desiredCurrency || baseCurrency,
          fxRate: fxRate,
          baseCurrency: baseCurrency,
          totals: {
            subtotal: newOrder.subtotal,
            discountAmount: newOrder.discountAmount,
            deliveryFee: newOrder.deliveryFee,
            taxAmount: (newOrder as any).taxAmount,
            total: newOrder.total,
          },
          subtotal: newOrder.subtotal,
          deliveryFee: newOrder.deliveryFee,
          discountAmount: newOrder.discountAmount,
          total: newOrder.total,
          paymentMethod: newOrder.paymentMethod,
          paymentBreakdown: Array.isArray(newOrder.paymentBreakdown) ? newOrder.paymentBreakdown : undefined,
          isCreditSale: Boolean(newOrder.isCreditSale),
          invoiceTerms: newOrder.invoiceTerms || (newOrder.isCreditSale ? 'credit' : 'cash'),
          customerName: newOrder.customerName,
          phoneNumber: newOrder.phoneNumber,
          invoiceStatement: (newOrder as any).invoiceStatement,
          address: newOrder.address,
          deliveryZoneId: newOrder.deliveryZoneId,
          items: snapshotItems,
        };
      };

      const deliveryPayload: Order = {
        ...newOrder,
        paidAt: undefined,
        invoiceNumber: invoiceNumber || newOrder.invoiceNumber,
        invoiceIssuedAt: nowIso,
        invoiceSnapshot: buildValidationInvoiceSnapshot(),
      };
      finalized = deliveryPayload;

      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase غير مهيأ.');
      const sb2 = supabase!;
      if (canMarkPaidUi) {
        const rollbackCreatedOrder = async (reason: string) => {
          try {
            const pending = {
              ...finalized,
              status: 'pending',
              inStoreFailureAt: nowIso,
              inStoreFailureReason: reason,
            };
            const sanitizedPending = sanitizeForJsonb(JSON.parse(JSON.stringify(pending)));
            const { error: updErr } = await sb2.from('orders').update({ status: 'pending', data: sanitizedPending }).eq('id', newOrder.id);
            if (updErr) await sb2.from('orders').update({ status: 'pending' }).eq('id', newOrder.id);
          } catch {
          }
        };

        const sanitizeForJsonb = (obj: any): any => {
          if (obj === undefined || obj === null) return null;
          if (typeof obj === 'number') {
            if (!Number.isFinite(obj)) return null;
            return obj;
          }
          if (typeof obj === 'string') {
            return obj.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
          }
          if (typeof obj === 'boolean') return obj;
          if (Array.isArray(obj)) return obj.map(sanitizeForJsonb);
          if (typeof obj === 'object') {
            const newObj: any = {};
            for (const key of Object.keys(obj)) {
              const val = obj[key];
              if (val === undefined) continue;
              newObj[key] = sanitizeForJsonb(val);
            }
            return newObj;
          }
          return null;
        };

        const sanitizedFinalized = sanitizeForJsonb(JSON.parse(JSON.stringify(finalized)));
        const sanitizedItems = sanitizeForJsonb(JSON.parse(JSON.stringify(payloadItems)));

        if (import.meta.env.DEV) {
          console.log('[createInStoreSale] RPC payload items length:', sanitizedItems.length, 'warehouseId:', warehouseId);
          console.log('[createInStoreSale] Delegating invoice generation to backend.');
        }

        const { error: rpcError } = await rpcConfirmOrderDeliveryWithCredit(sb2, {
          orderId: newOrder.id,
          items: sanitizedItems,
          updatedData: sanitizedFinalized,
          warehouseId: effectiveOrderWarehouseId,
        });

        let confirmError: any = rpcError;
        if (confirmError) {
          const msgLower = String((confirmError as any)?.message || '').trim().toLowerCase();
          if (msgLower === 'posted_order_immutable' || msgLower.includes('posted_order_immutable')) {
            const fresh = await fetchRemoteOrderById(newOrder.id);
            if (fresh) {
              finalized = fresh;
            }
            confirmError = null;
          }
        }
        if (confirmError) {
          const isInvoiceSnapshotError = (() => {
            const rawCombined = [
              String((confirmError as any)?.message || '').trim(),
              String((confirmError as any)?.details || '').trim(),
              String((confirmError as any)?.hint || '').trim(),
            ].filter(Boolean).join('\n').toLowerCase();
            const localized = localizeSupabaseError(confirmError).toLowerCase();
            const combined = `${rawCombined}\n${localized}`;
            return combined.includes('invoice_snapshot_fields_missing')
              || combined.includes('invoice_snapshot_required')
              || combined.includes('invoice_snapshot_items_missing');
          })();

          if (isInvoiceSnapshotError) {
            try {
              const issuedAtIso = nowIso;
              const baseCurrencyCode = String((await getBaseCurrencyCode()) || baseCurrency || 'YER').toUpperCase();
              const fxRateSnapshot = Number.isFinite(Number(fxRate)) ? Number(fxRate) : 1;
              const currencySnapshot = desiredCurrency || baseCurrencyCode;
              const invNum = newOrder.invoiceNumber || invoiceNumber || generateInvoiceNumber(newOrder.id, issuedAtIso);
              const snapshot: any = {
                issuedAt: issuedAtIso,
                invoiceNumber: invNum,
                createdAt: newOrder.createdAt || issuedAtIso,
                orderSource: 'in_store',
                items: typeof structuredClone === 'function'
                  ? structuredClone(newOrder.items || [])
                  : JSON.parse(JSON.stringify(newOrder.items || [])),
                currency: currencySnapshot,
                fxRate: fxRateSnapshot,
                baseCurrency: baseCurrencyCode,
                totals: {
                  subtotal: newOrder.subtotal,
                  discountAmount: newOrder.discountAmount,
                  deliveryFee: newOrder.deliveryFee,
                  taxAmount: (newOrder as any).taxAmount,
                  total: newOrder.total,
                },
                subtotal: newOrder.subtotal,
                deliveryFee: newOrder.deliveryFee,
                discountAmount: newOrder.discountAmount,
                total: newOrder.total,
                paymentMethod: newOrder.paymentMethod,
                paymentBreakdown: Array.isArray(newOrder.paymentBreakdown) ? newOrder.paymentBreakdown : undefined,
                isCreditSale: Boolean(newOrder.isCreditSale),
                invoiceTerms: newOrder.invoiceTerms || (newOrder.isCreditSale ? 'credit' : 'cash'),
                customerName: newOrder.customerName,
                phoneNumber: newOrder.phoneNumber,
                invoiceStatement: (newOrder as any).invoiceStatement,
                address: newOrder.address,
                deliveryZoneId: newOrder.deliveryZoneId,
              };

              const retryFinalized = sanitizeForJsonb(JSON.parse(JSON.stringify({
                ...finalized,
                invoiceSnapshot: snapshot,
                invoiceIssuedAt: issuedAtIso,
                invoiceNumber: invNum,
              })));

              const { error: retryError } = await rpcConfirmOrderDeliveryWithCredit(sb2, {
                orderId: newOrder.id,
                items: sanitizedItems,
                updatedData: retryFinalized,
                warehouseId: effectiveOrderWarehouseId,
              });
              confirmError = retryError;
              if (!confirmError) {
                const freshOrder = await fetchRemoteOrderById(newOrder.id);
                if (freshOrder) {
                  finalized = freshOrder;
                }
              }
            } catch {
            }
          }

          const offlineNow = typeof navigator !== 'undefined' && navigator.onLine === false;
          if (offlineNow || isAbortLikeError(confirmError)) {
            await rollbackCreatedOrder('offline_or_aborted');
            const fresh = await fetchRemoteOrderById(newOrder.id);
            return fresh || ({ ...newOrder, status: 'pending' } as Order);
          }
          {
            const msg = String((confirmError as any)?.message || '').trim().toLowerCase();
            if (msg === 'posted_order_immutable' || msg.includes('posted_order_immutable')) {
              const fresh = await fetchRemoteOrderById(newOrder.id);
              if (fresh) return fresh;
              return ({ ...newOrder, status: 'delivered' } as Order);
            }
          }
          {
            const rawCombined = [
              String((confirmError as any)?.message || '').trim(),
              String((confirmError as any)?.details || '').trim(),
              String((confirmError as any)?.hint || '').trim(),
            ].filter(Boolean).join(' | ');
            const upper = rawCombined.toUpperCase();
            const token =
              upper.includes('BELOW_COST_REASON_REQUIRED')
                ? 'BELOW_COST_REASON_REQUIRED'
                : upper.includes('SELLING_BELOW_COST_NOT_ALLOWED')
                  ? 'SELLING_BELOW_COST_NOT_ALLOWED'
                  : null;
            if (token) {
              await rollbackCreatedOrder(`below_cost | ${token}`);
              const e: any = new Error(token);
              e.pendingOrderId = newOrder.id;
              e.original = confirmError;
              throw e;
            }
          }
          const code = String((confirmError as any)?.code || '').trim();
          const rawMsg = [
            String((confirmError as any)?.message || '').trim(),
            String((confirmError as any)?.details || '').trim(),
            String((confirmError as any)?.hint || '').trim(),
          ].filter(Boolean).join(' | ');
          const localizedMsg = localizeSupabaseError(confirmError);
          const combinedMsg = (localizedMsg || rawMsg || '').trim();
          const combinedForDisplay = (() => {
            const generic = combinedMsg === 'فشل العملية.' || combinedMsg === 'حدث خطأ غير متوقع.' || combinedMsg === 'UNKNOWN' || combinedMsg === 'Unknown';
            const dbg = rawMsg;
            if (generic && dbg) return `${combinedMsg} (${dbg})`;
            return combinedMsg;
          })();
          const schemaHint = (() => {
            const m = `${rawMsg}\n${localizedMsg}`.toLowerCase();
            if (code === '42883' && m.includes('_money_round') && m.includes('numeric') && m.includes('text')) {
              return 'قاعدة البيانات غير محدثة: دالة تقريب العملة مفقودة. طبّق ترحيلات Supabase الخاصة بالتقريب/العملات ثم أعد المحاولة.';
            }
            if (code === '42703' && (m.includes('currency_code') || m.includes('fx_rate') || m.includes('foreign_amount'))) {
              return 'قاعدة البيانات غير محدثة: أعمدة FX غير موجودة على القيود. طبّق ترحيلات FX ثم أعد المحاولة.';
            }
            if (code === '42883' && (m.includes('confirm_order_delivery_with_credit') || m.includes('confirm_order_delivery'))) {
              return 'قاعدة البيانات غير محدثة: وظائف تأكيد تسليم الطلب غير موجودة. طبّق ترحيلات Supabase الخاصة بواجهات التسليم ثم أعد المحاولة.';
            }
            return '';
          })();
          if (schemaHint) {
            await rollbackCreatedOrder(`schema_mismatch | ${schemaHint}${code ? ` | code:${code}` : ''}`);
            throw new Error(`${schemaHint}${code ? ` (code:${code})` : ''} تم إنشاء الطلب كـ "معلق" ويمكن إتمامه بعد تطبيق الترحيلات.`);
          }
          const timeoutText = `${rawMsg}\n${combinedMsg}`.toLowerCase();
          const isStatementTimeout =
            timeoutText.includes('statement timeout') ||
            timeoutText.includes('canceling statement due to statement timeout') ||
            timeoutText.includes('query_canceled');
          if (isStatementTimeout) {
            await rollbackCreatedOrder(`statement_timeout | ${combinedForDisplay || combinedMsg || 'query_canceled'}${code ? ` | code:${code}` : ''}`);
            const freshPending = await fetchRemoteOrderById(newOrder.id);
            return freshPending || ({ ...newOrder, status: 'pending' } as Order);
          }
          const rollbackReason = [combinedForDisplay || combinedMsg || 'rpc_error', code ? `code:${code}` : ''].filter(Boolean).join(' | ');
          await rollbackCreatedOrder(rollbackReason);
          console.error('In-store sale confirmation failed:', confirmError);
          const msg = schemaHint || combinedForDisplay || combinedMsg;
          throw new Error(
            msg && msg.trim()
              ? `لم يتم تنفيذ البيع. تم حفظ الطلب كمعلّق. السبب: ${msg}${code ? ` (code:${code})` : ''}`
              : 'لم يتم تنفيذ البيع (فشل خصم المخزون أو التأكيد). تم حفظ الطلب كمعلّق. تحقق من توفر الأصناف والمستودع ثم أعد المحاولة.'
          );
        }

        // Fetch fresh order to get the backend-generated invoice details
        const freshOrder = await fetchRemoteOrderById(newOrder.id);
        if (freshOrder) {
          finalized = freshOrder;
        } else {
          // Fallback if fetch fails (unlikely)
          console.warn('[createInStoreSale] Could not fetch fresh order after delivery.');
        }

        if (paymentBreakdown.length > 0) {
          const paymentCurrency = String((finalized as any).currency || (await getBaseCurrencyCode()) || '').toUpperCase();
          const sbPay = getSupabaseClient();
          if (!sbPay) throw new Error('Supabase غير مهيأ.');
          const queuePaymentRepair = (payment: { amount: number; method: string; referenceNumber?: string; senderName?: string; senderPhone?: string; declaredAmount?: number; amountConfirmed?: boolean; destinationAccountId?: string }, idx: number) => {
            const amount = Number(payment.amount) || 0;
            if (!(amount > 0)) return;
            const idempotencyKey = `instore:${newOrder.id}:${nowIso}:${idx}:${payment.method}:${amount}`;
            enqueueRpc('record_order_payment_v2', {
              p_order_id: newOrder.id,
              p_amount: amount,
              p_method: payment.method,
              p_occurred_at: nowIso,
              p_idempotency_key: idempotencyKey,
              p_currency: paymentCurrency,
              p_data: {
                referenceNumber: payment.referenceNumber,
                senderName: payment.senderName,
                senderPhone: payment.senderPhone,
                declaredAmount: Number(payment.declaredAmount) || undefined,
                amountConfirmed: typeof payment.amountConfirmed === 'boolean' ? payment.amountConfirmed : undefined,
                destinationAccountId: String(payment.destinationAccountId || '').trim() || undefined,
              },
            });
          };
          for (let i = 0; i < paymentBreakdown.length; i++) {
            const p = paymentBreakdown[i];
            const rpcErr = await rpcRecordOrderPayment(sbPay, {
              orderId: newOrder.id,
              amount: Number(p.amount) || 0,
              method: p.method,
              occurredAt: nowIso,
              currency: paymentCurrency,
              idempotencyKey: `instore:${newOrder.id}:${nowIso}:${i}:${p.method}:${Number(p.amount) || 0}`,
              destinationAccountId: String((p as any).destinationAccountId || '').trim() || undefined,
              referenceNumber: p.referenceNumber || undefined,
              senderName: p.senderName || undefined,
              senderPhone: p.senderPhone || undefined,
              declaredAmount: Number((p as any).declaredAmount) || undefined,
              amountConfirmed: typeof (p as any).amountConfirmed === 'boolean' ? Boolean((p as any).amountConfirmed) : undefined,
            });
            if (rpcErr) {
              paymentRecordOk = false;
              const transientError = (typeof navigator !== 'undefined' && navigator.onLine === false) || isAbortLikeError(rpcErr);
              if (transientError) {
                queuePaymentRepair(p, i);
                continue;
              }
              if (import.meta.env.DEV) {
                logger.warn('Failed to record payment for in-store sale:', rpcErr);
              }
              break;
            }
          }
        }

        // ── Ensure credit (AR) sales always have an AR payment record ──
        // If isCredit and no AR payment was recorded via the breakdown loop,
        // create an AR payment for the full order amount so the sale appears
        // in shift reports and AR aging correctly.
        if (input.isCredit && paymentRecordOk) {
          const hasArPayment = paymentBreakdown.some(p => p.method === 'ar');
          if (!hasArPayment) {
            const arCurrency = String((finalized as any).currency || (await getBaseCurrencyCode()) || '').toUpperCase();
            const sbAr = getSupabaseClient();
            if (sbAr) {
              const arAmount = computedTotalRounded - paymentBreakdown.reduce((s, p) => s + (Number(p.amount) || 0), 0);
              if (arAmount > 0) {
                const arErr = await rpcRecordOrderPayment(sbAr, {
                  orderId: newOrder.id,
                  amount: arAmount,
                  method: 'ar',
                  occurredAt: nowIso,
                  currency: arCurrency,
                  idempotencyKey: `instore:${newOrder.id}:${nowIso}:ar:${arAmount}`,
                });
                if (arErr) {
                  paymentRecordOk = false;
                  const transientError = (typeof navigator !== 'undefined' && navigator.onLine === false) || isAbortLikeError(arErr);
                  if (transientError) {
                    enqueueRpc('record_order_payment_v2', {
                      p_order_id: newOrder.id,
                      p_amount: arAmount,
                      p_method: 'ar',
                      p_occurred_at: nowIso,
                      p_idempotency_key: `instore:${newOrder.id}:${nowIso}:ar:${arAmount}`,
                      p_currency: arCurrency,
                      p_data: {},
                    });
                  }
                  if (import.meta.env.DEV) {
                    logger.warn('Failed to record AR payment for credit sale:', arErr);
                  }
                }
              }
            }
          }
        }

        paidAtIso = (paymentRecordOk && isFullyPaid) ? nowIso : undefined;
        shouldIssueInvoice = (paymentRecordOk && isFullyPaid);
        if (paidAtIso) {
          // تجنب تعديل سجل الطلب بعد نشره (posted_order_immutable)
          // نحدّث الحالة محليًا فقط. الخادم سيعكس ذلك عبر المدفوعات/التقارير.
          finalized = { ...finalized, paidAt: paidAtIso } as Order;
        }

      } else {
        const { data: sessionData, error: sessionError } = await sb2.auth.getSession();
        if (sessionError || !sessionData.session) {
          const { error: deleteErr } = await sb2.from('orders').delete().eq('id', newOrder.id);
          if (deleteErr) {
            await sb2.from('orders').update({ status: 'cancelled' }).eq('id', newOrder.id);
          }
          throw new Error('انتهت الجلسة. الرجاء تسجيل الدخول مرة أخرى.');
        }

        const merged = new Map<string, { quantity: number; itemId: string; batchId?: string }>();
        for (const item of (newOrder.items || []).filter((it: any) => !(it?.lineType === 'promotion' || it?.promotionId))) {
          const itemId = String((item as any)?.itemId || (item as any)?.id || '');
          const quantity = Number(getRequestedBaseQuantity(item)) || 0;
          if (!itemId || !(quantity > 0)) continue;
          const batchId = String((item as any)?._fefoBatchId || (item as any)?.forcedBatchId || '').trim();
          const key = `${itemId}:${batchId}`;
          const prev = merged.get(key);
          merged.set(key, { itemId, batchId: batchId || undefined, quantity: (prev?.quantity || 0) + quantity });
        }

        const promoLines = Array.isArray((newOrder as any).promotionLines) ? (newOrder as any).promotionLines : [];
        for (const line of promoLines) {
          const promoItems = Array.isArray((line as any)?.items) ? (line as any).items : [];
          for (const pi of promoItems) {
            const itemId = String((pi as any)?.itemId || (pi as any)?.id || '');
            const quantity = Number((pi as any)?.quantity) || 0;
            if (!itemId || !(quantity > 0)) continue;
            const key = `${itemId}:`;
            const prev = merged.get(key);
            merged.set(key, { itemId, quantity: (prev?.quantity || 0) + quantity });
          }
        }

        const reserveItems = Array.from(merged.values())
          .map(({ itemId, quantity, batchId }) => ({ itemId, quantity, batchId }))
          .filter((x) => x.itemId && Number(x.quantity) > 0);

        if (reserveItems.length > 0) {
          const reserveErr = await rpcReserveStockForOrder(sb2, { items: reserveItems, orderId: newOrder.id, warehouseId: effectiveOrderWarehouseId });
          if (reserveErr) {
            const offlineNow = typeof navigator !== 'undefined' && navigator.onLine === false;
            if (offlineNow || isAbortLikeError(reserveErr)) {
              const { error: deleteErr } = await sb2.from('orders').delete().eq('id', newOrder.id);
              if (deleteErr) {
                await sb2.from('orders').update({ status: 'cancelled' }).eq('id', newOrder.id);
              }
              return await queueOfflineSale();
            }
            const { error: deleteErr } = await sb2.from('orders').delete().eq('id', newOrder.id);
            if (deleteErr) {
              await sb2.from('orders').update({ status: 'cancelled' }).eq('id', newOrder.id);
            }
            throw new Error(localizeSupabaseError(reserveErr));
          }
        }
      }
    } catch (err: any) {
      const offlineNow = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offlineNow || isAbortLikeError(err)) {
        return await queueOfflineSale();
      }
      throw err;
    }




    await Promise.all([
      addOrderEvent({
        orderId: newOrder.id,
        action: 'order.created',
        actorType: 'admin',
        actorId: adminUser?.id,
        toStatus: newOrder.status,
        createdAt: nowIso,
        payload: {
          orderSource: 'in_store',
          paymentMethod: newOrder.paymentMethod,
          paymentReferenceNumber: newOrder.paymentProof,
          paymentSenderName: newOrder.paymentSenderName,
          paymentDeclaredAmount: newOrder.paymentDeclaredAmount,
          paymentBreakdown: newOrder.paymentBreakdown,
          discountAmount,
          total: newOrder.total,
          invoiceNumber: finalized.invoiceNumber, // Used backend generated number if available
          paymentRecordOk,
        },
      }),
      ...(shouldIssueInvoice && finalized.invoiceNumber ? [addOrderEvent({
        orderId: newOrder.id,
        action: 'order.invoiceIssued',
        actorType: 'system',
        createdAt: nowIso,
        payload: { invoiceNumber: finalized.invoiceNumber },
      })] : []),
    ]);

    // We already have the fresh order in `finalized` (if canMarkPaidUi path was taken)
    // No need to call updateRemoteOrder again for "shouldIssueInvoice" as backend did it.


    if (canMarkPaidUi && !paymentRecordOk) {
      setOrders(prev => [finalized, ...prev.filter(o => o.id !== finalized.id)]);
      return finalized;
    }

    if (shouldIssueInvoice) {
      setOrders(prev => [finalized, ...prev.filter(o => o.id !== finalized.id)]);
      return finalized;
    }

    if (!canMarkPaidUi) {
      setOrders(prev => [newOrder, ...prev.filter(o => o.id !== newOrder.id)]);
      return newOrder;
    }

    logAudit('instore_sale_created', `In-store sale created #${invoiceNumber}`, {
      orderId: newOrder.id,
      total: newOrder.total,
      itemsCount: items.length
    });

    setOrders(prev => [finalized, ...prev.filter(o => o.id !== finalized.id)]);

    return finalized;
  };

  const createInStorePendingOrder = async (input: {
    lines: Array<
      | { menuItemId: string; quantity?: number; weight?: number; selectedAddons?: Record<string, number>; warehouseId?: string }
      | { promotionId: string; bundleQty?: number; promotionLineId?: string; promotionSnapshot?: any; warehouseId?: string }
    >;
    currency?: string;
    customerId?: string;
    partyId?: string;
    discountType?: 'amount' | 'percent';
    discountValue?: number;
    customerName?: string;
    phoneNumber?: string;
    notes?: string;
  }) => {
    if (!isAdminAuthenticated || !canCreateInStoreSale()) {
      throw new Error('ليس لديك صلاحية تسجيل بيع حضوري.');
    }
    if ((input.lines || []).some((l: any) => l?.promotionId)) {
      throw new Error('لا يمكن إنشاء فاتورة معلقة تحتوي عرضاً.');
    }
    const IN_STORE_DELIVERY_ZONE_ID = '11111111-1111-4111-8111-111111111111';
    const baseCurrency = String((await getBaseCurrencyCode()) || '').toUpperCase().trim() || 'YER';
    const desiredCurrency = String((input as any).currency || baseCurrency || '').toUpperCase().trim() || baseCurrency;
    const normalizedLines: Array<{ menuItemId: string; quantity?: number; weight?: number; selectedAddons: Record<string, number>; warehouseId?: string }> = (input.lines || [])
      .filter((l: any) => typeof l?.menuItemId === 'string' && Boolean(l.menuItemId))
      .map((l: any) => ({
        menuItemId: String(l.menuItemId),
        quantity: typeof l.quantity === 'number' ? l.quantity : undefined,
        weight: typeof l.weight === 'number' ? l.weight : undefined,
        selectedAddons: (l.selectedAddons && typeof l.selectedAddons === 'object') ? (l.selectedAddons as Record<string, number>) : {},
        warehouseId: typeof l.warehouseId === 'string' && l.warehouseId.trim() ? String(l.warehouseId).trim() : undefined,
      }));
    if (!normalizedLines.length) {
      throw new Error('يجب إضافة صنف واحد على الأقل.');
    }
    const menuItems = await Promise.all(normalizedLines.map((l) => loadMenuItemById(l.menuItemId)));
    if (menuItems.some((m) => !m)) {
      throw new Error('تعذر تحميل بعض الأصناف.');
    }
    const warehouseId = sessionScope.requireScope().warehouseId;
    let items: CartItem[] = normalizedLines.map((line, idx) => {
      const menuItem = menuItems[idx]!;
      const unitType = menuItem.unitType;
      const isWeightBased = unitType === 'kg' || unitType === 'gram';
      const quantity = !isWeightBased ? (line.quantity || 0) : 1;
      const weight = isWeightBased ? (line.weight || 0) : undefined;
      const resolvedAddons: CartItem['selectedAddons'] = {};
      if (line.selectedAddons && menuItem.addons) {
        Object.entries(line.selectedAddons).forEach(([addonId, qty]) => {
          const addon = menuItem.addons?.find(addonDef => addonDef.id === addonId);
          const q = Number(qty) || 0;
          if (addon && q > 0) {
            resolvedAddons[addonId] = { addon, quantity: q };
          }
        });
      }
      return {
        ...menuItem,
        quantity,
        weight,
        selectedAddons: resolvedAddons,
        warehouseId: line.warehouseId,
        cartItemId: crypto.randomUUID(),
      };
    });
    if (items.some((i) => getRequestedItemQuantity(i) <= 0)) {
      throw new Error('الكمية/الوزن يجب أن يكون أكبر من صفر.');
    }
    const lineWarehouseIds = Array.from(new Set(
      items
        .map((it: any) => String(it?.warehouseId || warehouseId || '').trim())
        .filter(Boolean)
    ));
    const effectiveOrderWarehouseId = String(lineWarehouseIds[0] || warehouseId || '').trim();
    if (!effectiveOrderWarehouseId) {
      throw new Error('لا يمكن إنشاء الطلب بدون تحديد مستودع تنفيذ.');
    }
    await ensureSufficientStockForOrderItems(items, effectiveOrderWarehouseId);
    const supabaseForPricing = getSupabaseClient();
    if (!supabaseForPricing) throw new Error('Supabase غير مهيأ.');
    const pricedItems = await Promise.all(items.map(async (item) => {
      const uomFactor = Number((item as any)?.uomQtyInBase || 1) || 1;
      const pricingQty = (item.unitType === 'kg' || item.unitType === 'gram')
        ? (item.weight || item.quantity)
        : item.quantity * uomFactor;
      const { data, error } = await supabaseForPricing!.rpc('get_fefo_pricing', {
        p_item_id: item.id,
        p_warehouse_id: (item as any).warehouseId || effectiveOrderWarehouseId,
        p_currency_code: desiredCurrency,
        p_customer_id: input.customerId ? String(input.customerId) : null,
        p_quantity: pricingQty,
      });
      if (error) {
        throw new Error(localizeSupabaseError(error));
      }
      const row = (Array.isArray(data) ? data[0] : data) as any;
      const unitPrice = Number(row?.suggested_price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error('تعذر احتساب السعر.');
      }
      if (item.unitType === 'gram') {
        return { ...item, price: unitPrice, pricePerUnit: unitPrice * 1000 };
      }
      return { ...item, price: unitPrice };
    }));
    items = pricedItems;

    let fxRate = 1;

    items = items.map((item: any) => {
      const basePrice = Number(item.price) || 0;
      const selected = item.selectedAddons && typeof item.selectedAddons === 'object' ? item.selectedAddons : {};
      const nextSelected: any = {};
      for (const [id, entry] of Object.entries(selected)) {
        const e: any = entry as any;
        const addon = e?.addon;
        const addonBase = Number(addon?.price) || 0;
        nextSelected[id] = {
          ...e,
          addon: addon ? { ...addon, _basePrice: addonBase } : addon,
        };
      }
      const next: any = {
        ...item,
        _basePrice: basePrice,
        selectedAddons: nextSelected,
      };
      if (item.unitType === 'gram') {
        const basePerUnit = Number(item.pricePerUnit) || basePrice * 1000;
        next._basePricePerUnit = basePerUnit;
      }
      return next as CartItem;
    });
    if (desiredCurrency !== baseCurrency) {
      const supabaseFx = getSupabaseClient();
      if (!supabaseFx) throw new Error('Supabase غير مهيأ.');
      const { data: fxValue, error: fxErr } = await supabaseFx.rpc('get_fx_rate_rpc', {
        p_currency_code: desiredCurrency,
      } as any);
      if (fxErr) throw new Error(localizeSupabaseError(fxErr));
      const fx = Number(fxValue);
      if (!Number.isFinite(fx) || !(fx > 0)) {
        throw new Error('لا يوجد سعر صرف تشغيلي صالح لهذه العملة. أضف السعر من شاشة أسعار الصرف.');
      }
      fxRate = fx;
    }

    if (desiredCurrency !== baseCurrency && fxRate > 0) {
      items = items.map((item: any) => {
        const wasServerPriced = Boolean((item as any)?._pricedByRpc);
        const baseUnitPrice = Number((item as any)?._basePrice != null ? (item as any)._basePrice : item.price) || 0;
        const nextSelected: any = {};
        for (const [id, entry] of Object.entries(item.selectedAddons || {})) {
          const e: any = entry as any;
          const addon = e?.addon;
          const addonBase = Number(addon?._basePrice != null ? addon._basePrice : addon?.price) || 0;
          const addonPriceTxn = addonBase / fxRate;
          nextSelected[id] = {
            ...e,
            addon: addon
              ? {
                ...addon,
                _basePrice: addonBase,
                price: addonPriceTxn,
              }
              : addon,
          };
        }
        if (item.unitType === 'gram') {
          const basePerUnit = Number((item as any)?._basePricePerUnit != null ? (item as any)._basePricePerUnit : ((Number(item.pricePerUnit) || baseUnitPrice * 1000))) || 0;
          const nextPerUnit = wasServerPriced ? (Number(item.pricePerUnit) || (basePerUnit / fxRate)) : (basePerUnit / fxRate);
          const nextUnitPrice = nextPerUnit / 1000;
          return {
            ...item,
            price: nextUnitPrice,
            pricePerUnit: nextPerUnit,
            selectedAddons: nextSelected,
          };
        }
        const nextUnitPrice = wasServerPriced ? (Number(item.price) || (baseUnitPrice / fxRate)) : (baseUnitPrice / fxRate);
        return {
          ...item,
          price: nextUnitPrice,
          selectedAddons: nextSelected,
        };
      });
    }

    const computedSubtotal = items.reduce((total, item) => {
      const addonsPrice = Object.values(item.selectedAddons || {}).reduce(
        (sum, { addon, quantity }) => sum + addon.price * quantity,
        0
      );
      let itemPrice = item.price;
      let itemQuantity = item.quantity;
      const uomFactor = Number((item as any)?.uomQtyInBase || 1) || 1;
      if (item.unitType === 'kg' || item.unitType === 'gram') {
        itemQuantity = item.weight || item.quantity;
        if (item.unitType === 'gram' && item.pricePerUnit) {
          itemPrice = item.pricePerUnit / 1000;
        }
      } else {
        itemQuantity = (Number(itemQuantity) || 0) * uomFactor;
      }
      return total + (itemPrice + addonsPrice) * itemQuantity;
    }, 0);
    const discountType = input.discountType === 'percent' ? 'percent' : 'amount';
    const discountValueRaw = Number(input.discountValue) || 0;
    const discountValue = Number.isFinite(discountValueRaw) ? discountValueRaw : 0;
    const discountAmount = discountType === 'percent'
      ? Math.max(0, Math.min(100, discountValue)) * computedSubtotal / 100
      : Math.max(0, Math.min(computedSubtotal, discountValue));
    const computedTotal = Math.max(0, computedSubtotal - discountAmount);
    const nowIso = new Date().toISOString();
    const newOrder: Order = {
      id: crypto.randomUUID(),
      userId: isUuid(input.customerId) ? input.customerId : undefined,
      orderSource: 'in_store',
      warehouseId: effectiveOrderWarehouseId,
      currency: desiredCurrency,
      customerId: input.customerId || undefined,
      items,
      subtotal: computedSubtotal,
      deliveryFee: 0,
      deliveryZoneId: IN_STORE_DELIVERY_ZONE_ID,
      discountAmount,
      total: computedTotal,
      customerName: input.customerName?.trim() || 'زبون حضوري',
      phoneNumber: input.phoneNumber?.trim() || '',
      notes: input.notes?.trim() || undefined,
      invoiceStatement: String((input as any).invoiceStatement || '').trim() || undefined,
      address: 'داخل المحل',
      paymentMethod: 'mixed',
      status: 'pending',
      createdAt: nowIso,
    };
    (newOrder as any).fxRate = fxRate;
    (newOrder as any).baseCurrency = baseCurrency;
    (newOrder as any).fxRate = fxRate;
    (newOrder as any).baseCurrency = baseCurrency;
    const partyId = String((input as any).partyId || '').trim();
    if (isUuid(partyId)) (newOrder as any).partyId = partyId;
    await createRemoteOrder(newOrder);
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      const { error: deleteErr } = await supabase.from('orders').delete().eq('id', newOrder.id);
      if (deleteErr) {
        await supabase.from('orders').update({ status: 'cancelled' }).eq('id', newOrder.id);
      }
      throw new Error('انتهت الجلسة. الرجاء تسجيل الدخول مرة أخرى.');
    }
    const payloadItems = newOrder.items
      .map((item) => ({
        itemId: item.id,
        quantity: getRequestedItemQuantity(item),
        uomCode: String((item as any)?.uomCode || '').trim() || undefined,
        uomQtyInBase: Number((item as any)?.uomQtyInBase) || 1,
        batchId: (item as any)?._fefoBatchId || (item as any)?.forcedBatchId || undefined,
        warehouseId: (item as any)?.warehouseId || undefined,
      }))
      .filter((entry) => Number(entry.quantity) > 0);
    const sb3 = supabase!;
    const reserveErr = await rpcReserveStockForOrder(sb3, { items: payloadItems, orderId: newOrder.id, warehouseId: effectiveOrderWarehouseId });
    if (reserveErr) {
      const { error: deleteErr } = await sb3.from('orders').delete().eq('id', newOrder.id);
      if (deleteErr) {
        await sb3.from('orders').update({ status: 'cancelled' }).eq('id', newOrder.id);
      }
      throw new Error(localizeSupabaseError(reserveErr));
    }
    await addOrderEvent({
      orderId: newOrder.id,
      action: 'order.created',
      actorType: 'admin',
      actorId: adminUser?.id,
      toStatus: 'pending',
      createdAt: nowIso,
      payload: { orderSource: 'in_store', total: newOrder.total, itemsCount: items.length },
    });
    setOrders(prev => [newOrder, ...prev.filter(o => o.id !== newOrder.id)]);
    return newOrder;
  };

  const createInStoreDraftQuotation = async (input: {
    lines: Array<{ menuItemId: string; quantity?: number; weight?: number; selectedAddons?: Record<string, number> }>;
    customerId?: string;
    partyId?: string;
    customerName?: string;
    phoneNumber?: string;
    notes?: string;
    invoiceStatement?: string;
    discountType?: 'amount' | 'percent';
    discountValue?: number;
  }) => {
    if (!isAdminAuthenticated || !canCreateInStoreSale()) {
      throw new Error('ليس لديك صلاحية تسجيل بيع حضوري.');
    }
    const IN_STORE_DELIVERY_ZONE_ID = '11111111-1111-4111-8111-111111111111';
    const normalizedLines: Array<{ menuItemId: string; quantity?: number; weight?: number; selectedAddons: Record<string, number> }> = (input.lines || [])
      .filter((l: any) => typeof l?.menuItemId === 'string' && Boolean(l.menuItemId))
      .map((l: any) => ({
        menuItemId: String(l.menuItemId),
        quantity: typeof l.quantity === 'number' ? l.quantity : undefined,
        weight: typeof l.weight === 'number' ? l.weight : undefined,
        selectedAddons: (l.selectedAddons && typeof l.selectedAddons === 'object') ? (l.selectedAddons as Record<string, number>) : {},
      }));
    if (!normalizedLines.length) {
      throw new Error('يجب إضافة صنف واحد على الأقل.');
    }
    const menuItems = await Promise.all(normalizedLines.map((l) => loadMenuItemById(l.menuItemId)));
    if (menuItems.some((m) => !m)) {
      throw new Error('تعذر تحميل بعض الأصناف.');
    }
    const warehouseId = sessionScope.requireScope().warehouseId;
    let items: CartItem[] = normalizedLines.map((line, idx) => {
      const menuItem = menuItems[idx]!;
      const unitType = menuItem.unitType;
      const isWeightBased = unitType === 'kg' || unitType === 'gram';
      const quantity = !isWeightBased ? (line.quantity || 0) : 1;
      const weight = isWeightBased ? (line.weight || 0) : undefined;
      const resolvedAddons: CartItem['selectedAddons'] = {};
      if (line.selectedAddons && menuItem.addons) {
        Object.entries(line.selectedAddons).forEach(([addonId, qty]) => {
          const addon = menuItem.addons?.find(addonDef => addonDef.id === addonId);
          const q = Number(qty) || 0;
          if (addon && q > 0) {
            resolvedAddons[addonId] = { addon, quantity: q };
          }
        });
      }
      return { ...menuItem, quantity, weight, selectedAddons: resolvedAddons, cartItemId: crypto.randomUUID() };
    });
    if (items.some((i) => getRequestedItemQuantity(i) <= 0)) {
      throw new Error('الكمية/الوزن يجب أن يكون أكبر من صفر.');
    }
    const desiredCurrency = String(((input as any).currency || (await getBaseCurrencyCode()) || '')).toUpperCase();
    const supabaseForPricing = getSupabaseClient();
    if (!supabaseForPricing) throw new Error('Supabase غير مهيأ.');
    const pricedItems = await Promise.all(items.map(async (item) => {
      const uomFactor = Number((item as any)?.uomQtyInBase || 1) || 1;
      const pricingQty = (item.unitType === 'kg' || item.unitType === 'gram')
        ? (item.weight || item.quantity)
        : item.quantity * uomFactor;
      let { data, error } = await supabaseForPricing!.rpc('get_fefo_pricing', {
        p_item_id: item.id,
        p_warehouse_id: warehouseId,
        p_customer_id: input.customerId ? String(input.customerId) : null,
        p_quantity: pricingQty,
        p_currency_code: desiredCurrency,
      });
      if (error) throw new Error(localizeSupabaseError(error));
      const row = (Array.isArray(data) ? data[0] : data) as any;
      const unitPrice = Number(row?.suggested_price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('تعذر احتساب السعر.');
      if (item.unitType === 'gram') return { ...item, price: unitPrice, pricePerUnit: unitPrice * 1000 };
      return { ...item, price: unitPrice };
    }));
    items = pricedItems;
    const computedSubtotal = items.reduce((total, item) => {
      const addonsPrice = Object.values(item.selectedAddons || {}).reduce((sum, { addon, quantity }) => sum + addon.price * quantity, 0);
      let itemPrice = item.price;
      let itemQuantity = item.quantity;
      const uomFactor = Number((item as any)?.uomQtyInBase || 1) || 1;
      if (item.unitType === 'kg' || item.unitType === 'gram') {
        itemQuantity = item.weight || item.quantity;
        if (item.unitType === 'gram' && item.pricePerUnit) {
          itemPrice = item.pricePerUnit / 1000;
        }
      } else {
        itemQuantity = (Number(itemQuantity) || 0) * uomFactor;
      }
      return total + (itemPrice + addonsPrice) * itemQuantity;
    }, 0);
    const discountType = input.discountType === 'percent' ? 'percent' : 'amount';
    const discountValueRaw = Number(input.discountValue) || 0;
    const discountValue = Number.isFinite(discountValueRaw) ? discountValueRaw : 0;
    const discountAmount = discountType === 'percent'
      ? Math.max(0, Math.min(100, discountValue)) * computedSubtotal / 100
      : Math.max(0, Math.min(computedSubtotal, discountValue));
    const computedTotal = Math.max(0, computedSubtotal - discountAmount);
    const nowIso = new Date().toISOString();
    const newOrder: Order = {
      id: crypto.randomUUID(),
      userId: isUuid(input.customerId) ? input.customerId : undefined,
      orderSource: 'in_store',
      warehouseId,
      currency: desiredCurrency,
      customerId: input.customerId || undefined,
      items,
      subtotal: computedSubtotal,
      deliveryFee: 0,
      deliveryZoneId: IN_STORE_DELIVERY_ZONE_ID,
      discountAmount,
      total: computedTotal,
      customerName: input.customerName?.trim() || 'زبون حضوري',
      phoneNumber: input.phoneNumber?.trim() || '',
      notes: input.notes?.trim() || undefined,
      invoiceStatement: String((input as any).invoiceStatement || '').trim() || undefined,
      address: 'داخل المحل',
      paymentMethod: 'unknown',
      status: 'pending',
      createdAt: nowIso,
      isDraft: true,
    };
    const partyId = String((input as any).partyId || '').trim();
    if (isUuid(partyId)) (newOrder as any).partyId = partyId;
    await createRemoteOrder(newOrder);
    await addOrderEvent({
      orderId: newOrder.id,
      action: 'order.created',
      actorType: 'admin',
      actorId: adminUser?.id,
      toStatus: 'pending',
      createdAt: nowIso,
      payload: { orderSource: 'in_store', total: newOrder.total, itemsCount: items.length, isDraft: true },
    });
    setOrders(prev => [newOrder, ...prev.filter(o => o.id !== newOrder.id)]);
    return newOrder;
  };
  const resumeInStorePendingOrder = async (orderId: string, payment: {
    paymentMethod: string;
    paymentBreakdown?: Array<{
      method: string;
      amount: number;
      referenceNumber?: string;
      senderName?: string;
      senderPhone?: string;
      declaredAmount?: number;
      amountConfirmed?: boolean;
      cashReceived?: number;
    }>;
    occurredAt?: string;
    belowCostOverrideReason?: string;
    customerId?: string;
    partyId?: string;
    isCreditSale?: boolean;
    invoiceTerms?: string;
  }) => {
    const existing = (await fetchRemoteOrderById(orderId)) || orders.find(o => o.id === orderId);
    if (!existing || existing.status !== 'pending') {
      throw new Error('الطلب غير موجود أو ليس في حالة التعليق.');
    }
    const nowIso = new Date().toISOString();
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');
    const { data: approvalRow, error: approvalErr } = await supabase
      .from('orders')
      .select('discount_requires_approval, discount_approval_status')
      .eq('id', existing.id)
      .maybeSingle();
    if (approvalErr) throw new Error(localizeSupabaseError(approvalErr));
    if (Boolean((approvalRow as any)?.discount_requires_approval) && String((approvalRow as any)?.discount_approval_status || '') !== 'approved') {
      throw new Error('لا يمكن إتمام الطلب قبل اعتماد موافقة الخصم.');
    }
    const resolveWarehouseId = async (): Promise<string> => {
      const byCol = typeof (existing as any).warehouseId === 'string' ? (existing as any).warehouseId : undefined;
      if (byCol) return byCol;
      const scoped = sessionScope.scope?.warehouseId;
      if (scoped) return scoped;
      throw new Error('نطاق المستودع غير محدد لهذا الطلب. يمنع التنفيذ خارج نطاق الجلسة.');
    };
    const warehouseId = await resolveWarehouseId();
    const merged = new Map<string, number>();
    const baseItems = (existing.items || []).filter((it: any) => !(it?.lineType === 'promotion' || it?.promotionId || it?.category === 'promotion'));
    for (const item of baseItems) {
      const itemId = String((item as any)?.itemId || (item as any)?.id || '');
      const quantity = Number(getRequestedBaseQuantity(item)) || 0;
      if (!itemId || !(quantity > 0)) continue;
      merged.set(itemId, (merged.get(itemId) || 0) + quantity);
    }
    const promoLines = Array.isArray((existing as any).promotionLines) ? (existing as any).promotionLines : [];
    for (const line of promoLines) {
      const promoItems = Array.isArray((line as any)?.items) ? (line as any).items : [];
      for (const pi of promoItems) {
        const itemId = String((pi as any)?.itemId || (pi as any)?.id || '');
        const quantity = Number((pi as any)?.quantity) || 0;
        if (!itemId || !(quantity > 0)) continue;
        merged.set(itemId, (merged.get(itemId) || 0) + quantity);
      }
    }
    const reserveItems = Array.from(merged.entries())
      .map(([itemId, quantity]) => ({ itemId, quantity }))
      .filter((x) => isUuid(x.itemId) && Number(x.quantity) > 0);
    if (reserveItems.length > 0) {
      const { error: releaseErr } = await supabase.rpc('release_reserved_stock_for_order', {
        p_items: reserveItems,
        p_order_id: existing.id,
        p_warehouse_id: warehouseId,
      });
      if (releaseErr) {
        throw new Error(localizeSupabaseError(releaseErr));
      }
    }
    const payloadItems = baseItems
      .map((item) => ({
        itemId: String((item as any)?.itemId || (item as any)?.id || ''),
        quantity: getRequestedItemQuantity(item),
        uomCode: String((item as any)?.uomCode || '').trim() || undefined,
      }))
      .filter((entry) => isUuid(entry.itemId) && Number(entry.quantity) > 0);
    if (payloadItems.length === 0 && promoLines.length === 0) {
      throw new Error('لا يمكن إتمام الطلب: تأكد من الكمية/الوزن للأصناف.');
    }
    const belowCostOverrideReason = String((payment as any).belowCostOverrideReason || '').trim();
    const updatedDelivered: Order = {
      ...existing,
      status: 'delivered',
      deliveredAt: nowIso,
      paidAt: nowIso,
      paymentMethod: payment.paymentMethod,
      ...(belowCostOverrideReason ? ({ belowCostOverrideReason } as any) : {}),
      ...(payment.customerId ? { customerId: payment.customerId } : {}),
      ...((payment.partyId ? { partyId: payment.partyId } : {}) as any),
      ...(typeof payment.isCreditSale === 'boolean' ? { isCreditSale: payment.isCreditSale } : {}),
      ...(payment.invoiceTerms ? { invoiceTerms: payment.invoiceTerms } : {}),
    };
    const { error: rpcError } = await rpcConfirmOrderDeliveryWithCredit(supabase, {
      orderId: existing.id,
      items: payloadItems,
      updatedData: updatedDelivered,
      warehouseId,
    });
    if (rpcError) {
      throw new Error(localizeSupabaseError(rpcError));
    }
    await fetchRemoteOrderById(existing.id);
    const breakdown = (payment.paymentBreakdown || [
      { method: payment.paymentMethod, amount: existing.total || 0 }
    ]).filter(p => (Number(p.amount) || 0) > 0);
    for (let i = 0; i < breakdown.length; i++) {
      const p = breakdown[i];
      const error = await rpcRecordOrderPayment(supabase, {
        orderId: existing.id,
        amount: Number(p.amount) || 0,
        method: p.method,
        occurredAt: payment.occurredAt || nowIso,
        currency: String((existing as any).currency || (await getBaseCurrencyCode()) || '').toUpperCase(),
        idempotencyKey: `resume:${existing.id}:${payment.occurredAt || nowIso}:${i}:${p.method}:${Number(p.amount) || 0}`,
        destinationAccountId: String((p as any).destinationAccountId || '').trim() || resolveOrderDestinationAccountId(existing, p.method),
        referenceNumber: String((p as any).referenceNumber || '').trim() || undefined,
        senderName: String((p as any).senderName || '').trim() || undefined,
        senderPhone: String((p as any).senderPhone || '').trim() || undefined,
        declaredAmount: Number((p as any).declaredAmount) || undefined,
        amountConfirmed: typeof (p as any).amountConfirmed === 'boolean' ? Boolean((p as any).amountConfirmed) : undefined,
      });
      if (error) throw new Error(localizeRecordOrderPaymentError(error));
    }
    await ensureInvoiceIssued(updatedDelivered, nowIso);
    setOrders(prev => prev.map(o => (o.id === existing.id ? { ...updatedDelivered } : o)));
    return { ...updatedDelivered };
  };

  const cancelInStorePendingOrder = async (orderId: string) => {
    const existing = (await fetchRemoteOrderById(orderId)) || orders.find(o => o.id === orderId);
    if (!existing || existing.status !== 'pending') {
      throw new Error('الطلب غير موجود أو ليس في حالة التعليق.');
    }
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');

    // We no longer attempt to delete orders or manually manage stock here.
    // The cancel_order RPC handles stock release, payment reversal, and status update reliably on the server.
    const clearPendingSettlementMarkers = async (targetOrderId: string) => {
      const { data: row, error: rowErr } = await supabase
        .from('orders')
        .select('status,data')
        .eq('id', targetOrderId)
        .maybeSingle();
      if (rowErr || !row) return false;
      const status = String((row as any)?.status || '').trim().toLowerCase();
      const data = ((row as any)?.data && typeof (row as any).data === 'object' ? (row as any).data : {}) as Record<string, any>;
      const snapshotIssuedAt = String(data?.invoiceSnapshot?.issuedAt || '').trim();
      const topIssuedAt = String(data?.invoiceIssuedAt || '').trim();
      const deliveredAt = String(data?.deliveredAt || '').trim();
      const src = String(data?.orderSource || '').trim();
      const inStoreFailed = Boolean(String(data?.inStoreFailureAt || '').trim() || String(data?.inStoreFailureReason || '').trim());
      if (status !== 'pending') return false;
      if (deliveredAt) return false;
      if (src !== 'in_store') return false;
      if (!inStoreFailed) return false;
      if (!snapshotIssuedAt && !topIssuedAt && !String(data?.paidAt || '').trim()) return false;
      const nextData = { ...data };
      delete (nextData as any).invoiceSnapshot;
      delete (nextData as any).invoiceIssuedAt;
      delete (nextData as any).paidAt;
      const { error: clearErr } = await supabase
        .from('orders')
        .update({ data: nextData, updated_at: new Date().toISOString() } as any)
        .eq('id', targetOrderId)
        .eq('status', 'pending');
      return !clearErr;
    };

    let cancelErr: any = null;
    {
      const { error } = await supabase.rpc('cancel_order', {
        p_order_id: existing.id,
        p_reason: 'تم الإلغاء من قبل البائع'
      });
      cancelErr = error;
    }
    if (cancelErr) {
      const raw = String(resolveErrorMessage(cancelErr) || '').toLowerCase();
      if (raw.includes('cannot_cancel_settled')) {
        const cleared = await clearPendingSettlementMarkers(existing.id);
        if (cleared) {
          const { error } = await supabase.rpc('cancel_order', {
            p_order_id: existing.id,
            p_reason: 'تم الإلغاء من قبل البائع'
          });
          cancelErr = error;
        }
      }
    }

    if (cancelErr) {
      throw new Error(localizeSupabaseError(cancelErr));
    }

    const cancelled = { ...existing, status: 'cancelled' } as Order;
    setOrders(prev => prev.map(o => (o.id === existing.id ? cancelled : o)));
  };

  const assignOrderToDelivery = async (orderId: string, deliveryUserId: string | null) => {
    const existing = (await fetchRemoteOrderById(orderId)) || orders.find(o => o.id === orderId);
    if (!existing) {
      throw new Error('الطلب غير موجود.');
    }
    if (!canAssignDelivery()) {
      throw new Error('ليس لديك صلاحية تعيين مندوب.');
    }
    if (existing.status === 'delivered' || existing.status === 'cancelled') {
      throw new Error('لا يمكن تعيين مندوب لطلب مكتمل أو ملغي.');
    }

    const nextAssigned = deliveryUserId || undefined;
    const nowIso = new Date().toISOString();

    await addOrderEvent({
      orderId,
      action: nextAssigned ? 'order.assignedDelivery' : 'order.unassignedDelivery',
      actorType: 'admin',
      actorId: adminUser?.id,
      createdAt: nowIso,
      payload: { assignedDeliveryUserId: nextAssigned || null },
    });
    const nextOrder = { ...existing, assignedDeliveryUserId: nextAssigned } as Order;
    if ((existing.assignedDeliveryUserId || undefined) !== nextAssigned) {
      nextOrder.deliveryAcceptedAt = undefined;
      nextOrder.deliveryAcceptedBy = undefined;
    }
    await updateRemoteOrder(nextOrder);
    setOrders(prev => prev.map(o => (o.id === nextOrder.id ? nextOrder : o)));

    // await fetchOrders();
  };

  const acceptDeliveryAssignment = async (orderId: string) => {
    const existing = (await fetchRemoteOrderById(orderId)) || orders.find(o => o.id === orderId);
    if (!existing) {
      throw new Error('الطلب غير موجود.');
    }
    if (!canAcceptDelivery()) {
      throw new Error('ليس لديك صلاحية قبول مهمة التوصيل.');
    }

    if (!existing.assignedDeliveryUserId) {
      throw new Error('لا يوجد مندوب معيّن لهذا الطلب.');
    }

    if (adminUser?.role === 'delivery' && existing.assignedDeliveryUserId !== adminUser?.id && !hasPermission('orders.updateStatus.all')) {
      throw new Error('الطلب غير معيّن لك.');
    }

    if (existing.deliveryAcceptedAt) return;

    const nowIso = new Date().toISOString();
    await addOrderEvent({
      orderId,
      action: 'order.deliveryAccepted',
      actorType: 'admin',
      actorId: adminUser?.id,
      createdAt: nowIso,
    });
    const nextOrder = { ...existing, deliveryAcceptedAt: nowIso, deliveryAcceptedBy: adminUser?.id } as Order;
    await updateRemoteOrder(nextOrder);
    setOrders(prev => prev.map(o => (o.id === nextOrder.id ? nextOrder : o)));

    // await fetchOrders();
  };

  const awardPointsForReviewedOrder = async (orderId: string): Promise<boolean> => {
    const order = (await fetchRemoteOrderById(orderId)) || orders.find(o => o.id === orderId);
    if (order && order.status === 'delivered' && !order.reviewPointsAwarded && order.pointsEarned && order.userId) {
      await addLoyaltyPoints(order.userId, order.pointsEarned);
      await updateRemoteOrder({ ...order, reviewPointsAwarded: true } as Order, { includeStatus: false });
      // await fetchOrders();
      return true;
    }
    return false;
  };


  const updateOrderStatus = async (orderId: string, status: OrderStatus, meta?: { deliveryPin?: string; deliveredLocation?: { lat: number; lng: number; accuracy?: number } }) => {
    const remoteSnapshot = await fetchRemoteOrderById(orderId);
    const existing = remoteSnapshot || orders.find(o => o.id === orderId);
    if (!existing) {
      throw new Error('الطلب غير موجود.');
    }

    if (status === 'cancelled' && !canCancelOrder()) {
      throw new Error('ليس لديك صلاحية إلغاء الطلب.');
    }

    if (status !== 'cancelled' && !canUpdateStatus(status)) {
      throw new Error('ليس لديك صلاحية تغيير حالة الطلب.');
    }

    const isDeliveryActor = adminUser?.role === 'delivery' && hasPermission('orders.updateStatus.delivery') && !hasPermission('orders.updateStatus.all');
    if (isDeliveryActor && (status === 'out_for_delivery' || status === 'delivered')) {
      if (!existing.assignedDeliveryUserId || existing.assignedDeliveryUserId !== adminUser?.id) {
        throw new Error('الطلب غير معيّن لك كمندوب.');
      }
      if (!existing.deliveryAcceptedAt) {
        throw new Error('يجب قبول مهمة التوصيل قبل متابعة الحالة.');
      }
    }

    const isInStore = String((existing as any).orderSource || '').trim() === 'in_store';
    if (isInStore && status === 'out_for_delivery') {
      throw new Error('لا يمكن تعيين حالة "في الطريق" لبيع حضوري.');
    }
    const allowFastInStoreDelivery = isInStore && existing.status === 'pending' && status === 'delivered';
    if (!allowFastInStoreDelivery && !isAllowedTransition(existing.status, status)) {
      throw new Error('تغيير الحالة غير مسموح.');
    }

    if (existing.status === status) {
      return;
    }

    const willDeliver = status === 'delivered' && existing.status !== 'delivered';
    const willCancel = status === 'cancelled' && existing.status !== 'cancelled' && existing.status !== 'delivered';

    const nowIso = new Date().toISOString();

    // Log critical status changes
    if (willCancel) {
      logAudit('order_cancelled', `Order #${orderId.slice(0, 8)} cancelled`, {
        orderId,
        fromStatus: existing.status,
        toStatus: status
      });
    } else if (willDeliver) {
      logAudit('order_delivered', `Order #${orderId.slice(0, 8)} delivered`, {
        orderId,
        total: existing.total,
        paymentMethod: existing.paymentMethod
      });
    }
    const updates: Partial<Order> = { status };
    const isCodDeliveryOrder =
      (existing.paymentMethod || '').trim() === 'cash' &&
      (existing.orderSource || '').trim() !== 'in_store' &&
      Boolean(existing.deliveryZoneId);

    if (status === 'out_for_delivery' && !existing.outForDeliveryAt) {
      updates.outForDeliveryAt = nowIso;
    }

    if (status === 'delivered') {
      if (isDeliveryActor && existing.deliveryPin) {
        const provided = (meta?.deliveryPin || '').trim();
        if (!provided) {
          throw new Error('يجب إدخال رمز التسليم.');
        }
        if (provided !== existing.deliveryPin) {
          throw new Error('رمز التسليم غير صحيح.');
        }
      }
      if (!existing.deliveredBy) {
        updates.deliveredBy = adminUser?.id;
      }
      if (!existing.deliveredLocation && meta?.deliveredLocation) {
        updates.deliveredLocation = meta.deliveredLocation;
      }
    }

    if (status === 'delivered' && !existing.deliveredAt) {
      updates.deliveredAt = nowIso;
    }

    if (status === 'cancelled' && !existing.cancelledAt) {
      updates.cancelledAt = nowIso;
    }

    // Non-COD: لا نضبط paidAt هنا؛ سيتم ضبطه فقط بعد تسجيل الدفع بنجاح لاحقًا لضمان السلامة المحاسبية.

    await addOrderEvent({
      orderId,
      action: 'order.statusChanged',
      actorType: 'admin',
      actorId: adminUser?.id,
      fromStatus: existing.status,
      toStatus: status,
      createdAt: nowIso,
      payload: status === 'delivered' && existing.deliveryPin
        ? {
          deliveryPinVerified: true,
          deliveredLocation: meta?.deliveredLocation ? meta.deliveredLocation : undefined,
        }
        : undefined,
    });
    let deliveredSnapshot: Order | undefined;
    let deliveryQueued = false;
    if (willDeliver) {
      let invoiceSnapshot = existing.invoiceSnapshot;
      if (!invoiceSnapshot || !invoiceSnapshot.currency || !invoiceSnapshot.baseCurrency) {
        // Construct a valid snapshot if missing to satisfy trigger
        const baseCurrency = (await getBaseCurrencyCode()) || 'SAR';
        const currency = existing.currency || baseCurrency;
        const fxRate = Number(existing.fxRate) || 1;
        const nowSnapshot = new Date().toISOString();

        invoiceSnapshot = {
          issuedAt: existing.invoiceIssuedAt || nowSnapshot,
          invoiceNumber: existing.invoiceNumber || generateInvoiceNumber(existing.id, nowSnapshot),
          createdAt: existing.createdAt,
          orderSource: existing.orderSource || 'in_store',
          items: typeof structuredClone === 'function' ? structuredClone(existing.items) : JSON.parse(JSON.stringify(existing.items)),
          currency: currency,
          fxRate: fxRate,
          baseCurrency: baseCurrency,
          totals: {
            subtotal: existing.subtotal,
            discountAmount: existing.discountAmount,
            deliveryFee: existing.deliveryFee,
            taxAmount: (existing as any).taxAmount || 0,
            total: existing.total,
          },
          subtotal: existing.subtotal,
          deliveryFee: existing.deliveryFee,
          discountAmount: existing.discountAmount,
          total: existing.total,
          paymentMethod: existing.paymentMethod,
          customerName: existing.customerName,
          phoneNumber: existing.phoneNumber,
          address: existing.address,
          deliveryZoneId: existing.deliveryZoneId,
        };
      }

      // Ensure invoiceIssuedAt & invoiceNumber exist at top-level of data so that
      // the DB trigger trg_issue_invoice_on_delivery does NOT overwrite our
      // snapshot (its generated snapshot lacks currency/fxRate/baseCurrency).
      const snapshotIssuedAt = invoiceSnapshot?.issuedAt || existing.invoiceIssuedAt || nowIso;
      const snapshotInvoiceNumber = invoiceSnapshot?.invoiceNumber || existing.invoiceNumber || '';
      const updated = {
        ...existing,
        ...updates,
        invoiceSnapshot,
        invoiceIssuedAt: existing.invoiceIssuedAt || snapshotIssuedAt,
        invoiceNumber: existing.invoiceNumber || snapshotInvoiceNumber,
      } as Order;


      // Use atomic RPC for delivery confirmation (Status Update + Stock Deduction)
      const baseItems = (updated.items || []).filter((it: any) => !(it?.lineType === 'promotion' || it?.promotionId || it?.category === 'promotion'));
      const merged = new Map<string, number>();
      for (const item of baseItems) {
        const itemId = String((item as any)?.itemId || (item as any)?.id || '');
        const quantity = Number(getRequestedBaseQuantity(item)) || 0;
        if (!itemId || !(quantity > 0)) continue;
        merged.set(itemId, (merged.get(itemId) || 0) + quantity);
      }
      const promoLines = Array.isArray((updated as any).promotionLines) ? (updated as any).promotionLines : [];
      for (const line of promoLines) {
        const promoItems = Array.isArray((line as any)?.items) ? (line as any).items : [];
        for (const pi of promoItems) {
          const itemId = String((pi as any)?.itemId || (pi as any)?.id || '');
          const quantity = Number((pi as any)?.quantity) || 0;
          if (!itemId || !(quantity > 0)) continue;
          merged.set(itemId, (merged.get(itemId) || 0) + quantity);
        }
      }
      const reserveItems = Array.from(merged.entries())
        .map(([itemId, quantity]) => ({ itemId, quantity }))
        .filter((x) => isUuid(x.itemId) && Number(x.quantity) > 0);
      const payloadItems = baseItems
        .map((item) => ({
          itemId: String((item as any)?.itemId || (item as any)?.id || ''),
          quantity: getRequestedItemQuantity(item),
          uomCode: String((item as any)?.uomCode || '').trim() || undefined,
        }))
        .filter((entry) => isUuid(entry.itemId) && Number(entry.quantity) > 0);
      if (payloadItems.length === 0) {
        if (baseItems.length > 0) {
          throw new Error('لا يمكن تأكيد التسليم: لا توجد أصناف قابلة للتسليم.');
        }
        throw new Error('لا يمكن تأكيد التسليم: الطلب لا يحتوي أصناف.');
      }

      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase غير مهيأ.');
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        throw new Error('انتهت الجلسة. الرجاء تسجيل الدخول مرة أخرى.');
      }

      const resolveWarehouseId = async (orderId?: string): Promise<string> => {
        const tryOrder = orderId ? await supabase.from('orders').select('warehouse_id,data').eq('id', orderId).maybeSingle() : { data: null, error: null };
        const orderRow: any = tryOrder?.data || null;
        const byCol = typeof orderRow?.warehouse_id === 'string' ? orderRow?.warehouse_id : undefined;
        const byData = typeof orderRow?.data?.warehouseId === 'string' ? orderRow?.data?.warehouseId : undefined;
        const candidate = byCol || byData;
        if (candidate) return candidate;
        throw new Error('نطاق المستودع غير محدد لهذا الطلب. يمنع التنفيذ خارج نطاق الجلسة.');
      };
      const warehouseId = await resolveWarehouseId(updated.id);
      if (isInStore && reserveItems.length > 0) {
        const { error: releaseErr } = await supabase.rpc('release_reserved_stock_for_order', {
          p_items: reserveItems,
          p_order_id: updated.id,
          p_warehouse_id: warehouseId,
        });
        if (releaseErr) {
          throw new Error(localizeSupabaseError(releaseErr));
        }
      }
      let isWholesaleCustomer = false;
      try {
        const { data: customerTypeRes, error: customerTypeErr } = await supabase.rpc('get_order_customer_type', { p_order_id: updated.id });
        if (!customerTypeErr) {
          isWholesaleCustomer = String(customerTypeRes || '').trim() === 'wholesale';
        }
      } catch {
      }

      const rpcRes = isWholesaleCustomer
        ? await rpcConfirmOrderDeliveryWithCredit(supabase, {
          orderId: updated.id,
          items: payloadItems,
          updatedData: updated,
          warehouseId,
        })
        : await rpcConfirmOrderDelivery(supabase, {
          orderId: updated.id,
          items: payloadItems,
          updatedData: updated,
          warehouseId,
        });
      const rpcError = rpcRes?.error;

      if (rpcError) {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline || isAbortLikeError(rpcError)) {
          const name = isWholesaleCustomer ? 'confirm_order_delivery_with_credit' : 'confirm_order_delivery';
          enqueueRpc(name, {
            p_payload: {
              p_order_id: updated.id,
              p_items: payloadItems,
              p_updated_data: updated,
              p_warehouse_id: warehouseId,
            }
          });
          deliveryQueued = true;
        } else {
          console.error('Delivery confirmation failed:', rpcError);
          throw new Error(localizeSupabaseError(rpcError));
        }
      } else {
        const rpcStatus = typeof rpcRes?.data === 'object' && rpcRes?.data
          ? String((rpcRes.data as any)?.status || '')
          : '';
        const rpcOrderData = typeof rpcRes?.data === 'object' && rpcRes?.data
          ? (rpcRes.data as any)?.data
          : undefined;
        const readBack = async (attempt: number): Promise<{ status: string; data: any } | null> => {
          const waitMs = attempt === 0 ? 0 : Math.min(250 * Math.pow(2, attempt - 1), 3000);
          if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
          const { data: row, error: readErr } = await supabase
            .from('orders')
            .select('status,data')
            .eq('id', updated.id)
            .maybeSingle();
          if (readErr) {
            throw new Error(localizeSupabaseError(readErr) || (readErr instanceof Error ? readErr.message : String((readErr as any)?.message || 'تعذر قراءة الطلب من الخادم')));
          }
          if (!row) return null;
          return { status: String((row as any).status || ''), data: (row as any).data };
        };

        let confirmed: { status: string; data: any } | null = null;
        if (rpcStatus === 'delivered') {
          confirmed = { status: 'delivered', data: rpcOrderData || updated };
        } else {
          for (let i = 0; i < 6; i++) {
            confirmed = await readBack(i);
            if (confirmed && confirmed.status === 'delivered') break;
          }
        }
        if (!confirmed) {
          throw new Error('تعذر قراءة الطلب من الخادم بعد التسليم. تحقق من الاتصال/الصلاحيات ثم أعد المحاولة.');
        }
        if (confirmed.status !== 'delivered') {
          const st = confirmed.status || 'غير معروفة';
          const callDeliveryRpc = async (mode: 'wrapper' | 'direct4' | 'direct3') => {
            if (isWholesaleCustomer) {
              if (mode === 'direct4' || mode === 'direct3') {
                const { error } = await supabase.rpc('confirm_order_delivery_with_credit', {
                  p_order_id: updated.id,
                  p_items: payloadItems,
                  p_updated_data: updated,
                  p_warehouse_id: warehouseId,
                });
                return error;
              }
              const { error } = await supabase.rpc('confirm_order_delivery_with_credit', {
                p_payload: {
                  p_order_id: updated.id,
                  p_items: payloadItems,
                  p_updated_data: updated,
                  p_warehouse_id: warehouseId,
                },
              });
              return error;
            }
            if (mode === 'direct4') {
              const { error } = await supabase.rpc('confirm_order_delivery', {
                p_order_id: updated.id,
                p_items: payloadItems,
                p_updated_data: updated,
                p_warehouse_id: warehouseId,
              });
              return error;
            }
            if (mode === 'direct3') {
              const { error } = await supabase.rpc('confirm_order_delivery', {
                p_order_id: updated.id,
                p_items: payloadItems,
                p_updated_data: updated,
              });
              return error;
            }
            const { error } = await supabase.rpc('confirm_order_delivery', {
              p_payload: {
                p_order_id: updated.id,
                p_items: payloadItems,
                p_updated_data: updated,
                p_warehouse_id: warehouseId,
              },
            });
            return error;
          };

          const modeRef = isWholesaleCustomer ? confirmDeliveryWithCreditRpcModeRef : confirmDeliveryRpcModeRef;
          const preferredMode = (modeRef.current || 'wrapper') as 'wrapper' | 'direct4' | 'direct3';
          const alternateMode: 'wrapper' | 'direct4' | 'direct3' = preferredMode === 'wrapper' ? 'direct4' : 'wrapper';

          let retryErr = await callDeliveryRpc(alternateMode);
          if (retryErr && isRpcNotFoundError(retryErr)) {
            const reloaded = await reloadPostgrestSchema();
            if (reloaded) retryErr = await callDeliveryRpc(alternateMode);
          }
          if (retryErr && isRpcNotFoundError(retryErr)) {
            retryErr = await callDeliveryRpc(preferredMode);
            if (retryErr && isRpcNotFoundError(retryErr)) {
              const reloaded = await reloadPostgrestSchema();
              if (reloaded) retryErr = await callDeliveryRpc(preferredMode);
            }
          }
          if (!isWholesaleCustomer && retryErr && isRpcNotFoundError(retryErr)) {
            retryErr = await callDeliveryRpc('direct3');
            if (retryErr && isRpcNotFoundError(retryErr)) {
              const reloaded = await reloadPostgrestSchema();
              if (reloaded) retryErr = await callDeliveryRpc('direct3');
            }
          }
          if (retryErr) {
            throw new Error(localizeSupabaseError(retryErr));
          }

          for (let i = 0; i < 6; i++) {
            confirmed = await readBack(i);
            if (confirmed && confirmed.status === 'delivered') break;
          }
          if (confirmed && confirmed.status === 'delivered') {
            deliveredSnapshot = ({ ...(confirmed.data || {}), id: updated.id, status: 'delivered' } as any) as Order;
          } else {
            let hasSaleOut: boolean | undefined;
            try {
              const { data: mv, error: mvErr } = await supabase
                .from('inventory_movements')
                .select('id')
                .eq('reference_table', 'orders')
                .eq('reference_id', updated.id)
                .eq('movement_type', 'sale_out')
                .eq('warehouse_id', warehouseId)
                .limit(1);
              if (!mvErr) {
                hasSaleOut = Array.isArray(mv) && mv.length > 0;
              }
            } catch {
            }

            const saleOutHint =
              typeof hasSaleOut === 'boolean'
                ? hasSaleOut
                  ? 'تم رصد حركة مخزون sale_out للطلب، لكن الحالة لم تُثبت.'
                  : 'لم يتم رصد حركة مخزون sale_out للطلب؛ غالباً فشل خصم المخزون أو تم منع التحديث بواسطة Trigger.'
                : 'تعذر التحقق من حركة المخزون لهذا الطلب.';

            throw new Error(`لم يتم تحديث حالة الطلب على الخادم (الحالة الحالية: ${st}). ${saleOutHint}`);
          }
        }
        deliveredSnapshot = ({ ...(confirmed.data || {}), id: updated.id, status: 'delivered' } as any) as Order;
      }
    }
    if (willCancel) {
      const updated = { ...existing, ...updates } as Order;
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase غير مهيأ.');
      const clearPendingSettlementMarkers = async (targetOrderId: string) => {
        const { data: row, error: rowErr } = await supabase
          .from('orders')
          .select('status,data')
          .eq('id', targetOrderId)
          .maybeSingle();
        if (rowErr || !row) return false;
        const status = String((row as any)?.status || '').trim().toLowerCase();
        const data = ((row as any)?.data && typeof (row as any).data === 'object' ? (row as any).data : {}) as Record<string, any>;
        const snapshotIssuedAt = String(data?.invoiceSnapshot?.issuedAt || '').trim();
        const topIssuedAt = String(data?.invoiceIssuedAt || '').trim();
        const deliveredAt = String(data?.deliveredAt || '').trim();
        const src = String(data?.orderSource || '').trim();
        const inStoreFailed = Boolean(String(data?.inStoreFailureAt || '').trim() || String(data?.inStoreFailureReason || '').trim());
        if (status !== 'pending') return false;
        if (deliveredAt) return false;
        if (src !== 'in_store') return false;
        if (!inStoreFailed) return false;
        if (!snapshotIssuedAt && !topIssuedAt && !String(data?.paidAt || '').trim()) return false;
        const nextData = { ...data };
        delete (nextData as any).invoiceSnapshot;
        delete (nextData as any).invoiceIssuedAt;
        delete (nextData as any).paidAt;
        const { error: clearErr } = await supabase
          .from('orders')
          .update({ data: nextData, updated_at: new Date().toISOString() } as any)
          .eq('id', targetOrderId)
          .eq('status', 'pending');
        return !clearErr;
      };
      let rpcError: any = null;
      {
        const { error } = await supabase.rpc('cancel_order', {
          p_order_id: updated.id,
          p_reason: '',
        });
        rpcError = error;
      }
      if (rpcError) {
        const raw = String(resolveErrorMessage(rpcError) || '').toLowerCase();
        if (raw.includes('cannot_cancel_settled')) {
          const cleared = await clearPendingSettlementMarkers(updated.id);
          if (cleared) {
            const { error } = await supabase.rpc('cancel_order', {
              p_order_id: updated.id,
              p_reason: '',
            });
            rpcError = error;
          }
        }
      }
      if (rpcError) {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline || isAbortLikeError(rpcError)) {
          enqueueRpc('cancel_order', {
            p_order_id: updated.id,
            p_reason: '',
          });
        } else {
          console.error('Order cancellation failed:', rpcError);
          throw new Error(localizeSupabaseError(rpcError));
        }
      }
    }

    if (deliveryQueued) {
      throw new Error('تمت إضافة عملية التسليم إلى الطابور. سيتم الخصم والتأكيد عند توفر الاتصال.');
    }
    if (willDeliver) {
      let updated = (deliveredSnapshot || ({ ...existing, ...updates } as Order)) as Order;
      if (updated.status !== 'delivered') {
        throw new Error('لا يمكن تسجيل الدفع قبل تثبيت حالة "تم التسليم".');
      }
      // بعد تأكيد التسليم، نتعامل مع مسار non-COD لضمان عدم ضبط paidAt بدون تسجيل Payment بنجاح.
      if (!isCodDeliveryOrder) {
        try {
          const supabase = getSupabaseClient();
          if (!supabase) throw new Error('Supabase غير مهيأ.');
          const { data: customerTypeRes } = await supabase.rpc('get_order_customer_type', { p_order_id: updated.id });
          const isWholesaleCustomer = String(customerTypeRes || '').trim() === 'wholesale';
          const paidAlready = await fetchOrderPaidAmount(updated.id);
          const remaining = Math.max(0, (Number(updated.total) || 0) - paidAlready);
          let paidAtIso: string | undefined;
          if (isWholesaleCustomer) {
            // Credit sale path: لا يتم التحصيل هنا، يبقى بانتظار التحصيل
            paidAtIso = undefined;
          } else if (remaining > 0) {
            const error = await rpcRecordOrderPayment(supabase, {
              orderId: updated.id,
              amount: remaining,
              method: updated.paymentMethod,
              occurredAt: nowIso,
              currency: String((updated as any).currency || (await getBaseCurrencyCode()) || '').toUpperCase(),
              idempotencyKey: `delivery:${updated.id}:${nowIso}:${Number(remaining) || 0}`,
            destinationAccountId: resolveOrderDestinationAccountId(updated, updated.paymentMethod),
            });
            if (error) {
              const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
              if (isOffline || isAbortLikeError(error)) {
                throw new Error('تعذر تسجيل الدفع بسبب الاتصال. أعد المحاولة عند توفر الإنترنت.');
              }
              if (!isRecordOrderPaymentNotFoundError(error)) {
                throw new Error(localizeRecordOrderPaymentError(error));
              }
            } else {
              paidAtIso = nowIso;
            }
          } else {
            // تم سداد كامل المبلغ مسبقًا (دفعات جزئية)، يسمح بضبط paidAt الآن
            paidAtIso = nowIso;
          }
          if (paidAtIso) {
            updated = { ...updated, paidAt: paidAtIso } as Order;
            try {
              await updateRemoteOrder(updated, { includeStatus: false });
            } catch (patchErr: any) {
              const errMsg = String(patchErr?.message || patchErr || '');
              if (!/posted_order_immutable/i.test(errMsg) && !/مُرحّل.*مقفّل/i.test(errMsg)) throw patchErr;
              // Order already posted by delivery triggers — safe to ignore
            }
            try {
              updated = await ensureInvoiceIssued(updated, paidAtIso);
            } catch (invErr: any) {
              const errMsg = String(invErr?.message || invErr || '');
              if (!/posted_order_immutable/i.test(errMsg) && !/مُرحّل.*مقفّل/i.test(errMsg)) throw invErr;
            }
          }
        } catch (err) {
          // تمرير الخطأ ليُبلغ الواجهة؛ لا نضبط paidAt إن فشل الدفع في وضع Online
          throw err instanceof Error ? err : new Error(String(err || 'Payment error'));
        }
      } else {
        // COD: المسار غير متأثر هنا؛ الضبط يتم عبر وظائف التسوية فقط
        updated = await ensureInvoiceIssued(updated, nowIso);
      }
      deliveredSnapshot = updated;

      // AWARD POINTS LOGIC
      if (updated.userId && updated.pointsEarned && updated.pointsEarned > 0) {
        try {
          await addLoyaltyPoints(updated.userId, updated.pointsEarned);
          await updateCustomerStatsAndTier(updated.userId, updated.total);

          if (import.meta.env.DEV) {
            console.log(`Awarded ${updated.pointsEarned} points to user ${updated.userId}`);
          }
        } catch (error) {
          console.error("Failed to award points/update stats on delivery", error);
        }
      }

      // تحديث تقدم التحديات بعد تأكيد التسليم فقط
      try {
        await updateChallengeProgress(updated);
      } catch (error) {
        if (import.meta.env.DEV) {
          logger.error('Failed to update challenge progress on delivery', error);
        }
      }
    }
    const persistBase = deliveredSnapshot || remoteSnapshot || existing;
    const persisted = { ...persistBase, ...updates } as Order;
    if (!willDeliver) {
      await updateRemoteOrder(persisted);
    }
    const display = await resolveOrderAddress(persisted);
    setOrders(prev => prev.map(o => (o.id === display.id ? display : o)));
    // await fetchOrders(); // Re-fetch to update the state
  };

  const markOrderPaid = async (orderId: string) => {
    const existing = (await fetchRemoteOrderById(orderId)) || orders.find(o => o.id === orderId);
    if (!existing) return;
    if (!canMarkPaidOrder()) {
      throw new Error('ليس لديك صلاحية تأكيد الدفع/التحصيل.');
    }
    if (existing.status !== 'delivered') {
      throw new Error('لا يمكن تأكيد التحصيل قبل تسليم الطلب.');
    }

    const nowIso = new Date().toISOString();
    let finalOrder: Order = { ...existing, paidAt: existing.paidAt || nowIso } as Order;
    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        const isCodDeliveryOrder =
          (existing.paymentMethod || '').trim() === 'cash' &&
          (existing.orderSource || '').trim() !== 'in_store' &&
          Boolean(existing.deliveryZoneId);

        if (isCodDeliveryOrder) {
          const { data: paidAtValue, error } = await supabase.rpc('cod_settle_order', {
            p_order_id: existing.id,
            p_occurred_at: nowIso,
          });
          if (error) throw error;
          const paidAtIso = typeof paidAtValue === 'string' ? paidAtValue : nowIso;
          await addOrderEvent({
            orderId,
            action: 'order.markedPaid',
            actorType: 'admin',
            actorId: adminUser?.id,
            createdAt: paidAtIso,
            payload: { paymentMethod: existing.paymentMethod, mode: 'cod_settlement' },
          });
          const refreshed = await fetchRemoteOrderById(orderId);
          if (refreshed) {
            setOrders(prev => prev.map(o => (o.id === refreshed.id ? refreshed : o)));
          }
          return;
        }

        const paidAlready = await fetchOrderPaidAmount(existing.id);
        const currencyCodeRaw = String((existing as any).currency || (await getBaseCurrencyCode()) || '').toUpperCase();
        const currencyCode = currencyCodeRaw || 'YER';
        const dp = currencyCode === 'YER' ? 0 : 2;
        const roundMoney = (v: number) => {
          const n = Number(v);
          if (!Number.isFinite(n)) return 0;
          const pow = Math.pow(10, dp);
          return Math.round(n * pow) / pow;
        };
        const total = roundMoney(Number(existing.total) || 0);
        const paidRounded = roundMoney(paidAlready);
        const tol = Math.pow(10, -dp);
        let remaining = roundMoney(Math.max(0, total - paidRounded));
        if (!(remaining > tol)) remaining = 0;

        if (remaining > 0) {
          const error = await rpcRecordOrderPayment(supabase, {
            orderId: existing.id,
            amount: remaining,
            method: existing.paymentMethod,
            occurredAt: nowIso,
            currency: currencyCode,
            idempotencyKey: `markPaid:${existing.id}:${nowIso}:${Number(remaining) || 0}`,
            destinationAccountId: resolveOrderDestinationAccountId(existing, existing.paymentMethod),
          });
          if (error) {
            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            if (isOffline || isAbortLikeError(error)) {
              throw new Error('تعذر تسجيل الدفع بسبب الاتصال. أعد المحاولة عند توفر الإنترنت.');
            }
            throw new Error(localizeRecordOrderPaymentError(error));
          }
        }

        const paidAtIso = existing.paidAt || nowIso;
        const updated = { ...existing, paidAt: paidAtIso } as Order;
        finalOrder = updated;

        await addOrderEvent({
          orderId,
          action: 'order.markedPaid',
          actorType: 'admin',
          actorId: adminUser?.id,
          createdAt: paidAtIso,
          payload: { paymentMethod: existing.paymentMethod },
        });

        try {
          await updateRemoteOrder(updated, { includeStatus: false });
        } catch (patchErr: any) {
          const errMsg = String(patchErr?.message || patchErr || '');
          if (!/posted_order_immutable/i.test(errMsg) && !/مُرحّل.*مقفّل/i.test(errMsg)) throw patchErr;
        }
        finalOrder = await ensureInvoiceIssued(updated, paidAtIso);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        logger.warn('Failed to record payment:', err);
      }
      throw err;
    }
    setOrders(prev => prev.map(o => (o.id === finalOrder.id ? finalOrder : o)));
    // await fetchOrders();
  };

  const recordOrderPaymentPartial = useCallback(
    async (
      orderId: string,
      amount: number,
      method?: string,
      occurredAt?: string,
      overrideAccountId?: string,
      meta?: { referenceNumber?: string; senderName?: string; senderPhone?: string; declaredAmount?: number; amountConfirmed?: boolean; destinationAccountId?: string }
    ) => {
      const existing = (await fetchRemoteOrderById(orderId)) || orders.find(o => o.id === orderId);
      if (!existing) return;
      if (!canMarkPaidOrder()) {
        throw new Error('ليس لديك صلاحية تسجيل دفعة.');
      }
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new Error('قيمة الدفعة غير صحيحة.');
      }
      const occurredAtIso = occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString();
      const methodValue = (method || existing.paymentMethod || 'cash').trim() || 'cash';
      const ref = String(meta?.referenceNumber || '').trim();
      const senderName = String(meta?.senderName || '').trim();
      const senderPhone = String(meta?.senderPhone || '').trim();
      const declaredAmount = Number(meta?.declaredAmount);
      const amountConfirmed = Boolean(meta?.amountConfirmed);
      const destinationAccountId = String(meta?.destinationAccountId || '').trim() || resolveOrderDestinationAccountId(existing, methodValue);

      await addOrderEvent({
        orderId,
        action: 'order.paymentRecorded',
        actorType: 'admin',
        actorId: adminUser?.id,
        createdAt: occurredAtIso,
        payload: {
          amount: numericAmount,
          method: methodValue,
          ...(ref ? { referenceNumber: ref } : {}),
          ...(senderName ? { senderName } : {}),
          ...(senderPhone ? { senderPhone } : {}),
          ...(Number.isFinite(declaredAmount) && declaredAmount > 0 ? { declaredAmount } : {}),
          ...(meta && typeof meta.amountConfirmed === 'boolean' ? { amountConfirmed } : {}),
          ...(destinationAccountId ? { destinationAccountId } : {}),
        },
      });

      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase غير مهيأ.');
      }
      const error = await rpcRecordOrderPayment(supabase, {
        orderId: existing.id,
        amount: numericAmount,
        method: methodValue,
        occurredAt: occurredAtIso,
        currency: String((existing as any).currency || (await getBaseCurrencyCode()) || '').toUpperCase(),
        idempotencyKey: `partial:${existing.id}:${occurredAtIso}:${methodValue}:${Number(numericAmount) || 0}`,
        overrideAccountId,
        referenceNumber: ref || undefined,
        senderName: senderName || undefined,
        senderPhone: senderPhone || undefined,
        declaredAmount: Number.isFinite(declaredAmount) ? declaredAmount : undefined,
        amountConfirmed: meta && typeof meta.amountConfirmed === 'boolean' ? amountConfirmed : undefined,
        destinationAccountId: destinationAccountId || undefined,
      });
      if (error) {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline || isAbortLikeError(error)) {
          throw new Error('تعذر تسجيل الدفع بسبب الاتصال. أعد المحاولة عند توفر الإنترنت.');
        }
        throw new Error(localizeRecordOrderPaymentError(error));
      }

      const refreshed = (await fetchRemoteOrderById(existing.id)) || existing;
      await ensureInvoiceIssued(refreshed, occurredAtIso);
    },
    [addOrderEvent, adminUser?.id, ensureInvoiceIssued, fetchRemoteOrderById, orders]
  );

  const incrementInvoicePrintCount = async (orderId: string) => {
    const order = (await fetchRemoteOrderById(orderId)) || orders.find(o => o.id === orderId);
    if (!order?.invoiceIssuedAt) return;
    const currentCount = typeof order.invoicePrintCount === 'number' ? order.invoicePrintCount : 0;
    const nowIso = new Date().toISOString();

    // Optimistic UI update
    const nextCount = currentCount + 1;
    const updated = { ...order, invoicePrintCount: nextCount, invoiceLastPrintedAt: nowIso } as Order;
    setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));

    await addOrderEvent({
      orderId,
      action: 'order.invoicePrinted',
      actorType: isAdminAuthenticated ? 'admin' : 'system',
      actorId: adminUser?.id,
      createdAt: nowIso,
      payload: { invoiceNumber: order.invoiceNumber, nextPrintCount: nextCount },
    });

    if (isAdminAuthenticated && adminUser?.id) {
      await logAudit('invoice_printed', `Invoice printed #${String(order.invoiceNumber || '').trim()}`, {
        orderId,
        invoiceNumber: order.invoiceNumber,
        nextPrintCount: nextCount,
        invoiceLastPrintedAt: nowIso,
      });
    }

    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        const { error } = await supabase.rpc('increment_invoice_print_count', { p_order_id: orderId });
        if (error) {
          console.error('Failed to increment invoice print count via RPC:', error);
          // Fallback to updateRemoteOrder if RPC fails (e.g. older migration not applied yet)
          await updateRemoteOrder(updated, { includeStatus: false });
        }
      }
    } catch (err) {
      console.error('Error incrementing invoice print count:', err);
    }
  };

  const getOrderById = (orderId: string) => {
    return orders.find(order => order.id === orderId);
  }

  const userOrders = useMemo(() => {
    if (!currentUser) {
      return [];
    }
    return orders.filter(order => order.userId === currentUser.id);
  }, [currentUser, orders]);

  return (
    <OrderContext.Provider value={{ orders, userOrders, loading, addOrder, createInStoreSale, createInStorePendingOrder, createInStoreDraftQuotation, resumeInStorePendingOrder, cancelInStorePendingOrder, updateOrderStatus, assignOrderToDelivery, acceptDeliveryAssignment, getOrderById, fetchRemoteOrderById, fetchOrders, awardPointsForReviewedOrder, incrementInvoicePrintCount, markOrderPaid, recordOrderPaymentPartial, issueInvoiceNow }}>
      {children}
    </OrderContext.Provider>
  );
};

export const useOrders = () => {
  const context = useContext(OrderContext);
  if (context === undefined) {
    throw new Error('useOrders must be used within an OrderProvider');
  }
  return context;
};
