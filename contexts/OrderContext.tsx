import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback, useMemo, useRef } from 'react';
import type { CartItem, Order, OrderStatus, StockManagement, OrderAuditAction, OrderAuditActorType, OrderAuditEvent, MenuItem } from '../types';
import { useUserAuth } from './UserAuthContext';
import { useSettings } from './SettingsContext';
import { useChallenges } from './ChallengeContext';
import { useAuth } from './AuthContext';
import { useSessionScope } from './SessionScopeContext';
import { generateInvoiceNumber } from '../utils/orderUtils';
import { getSupabaseClient, isRpcStrictMode, markRpcStrictModeEnabled, isRpcWrappersAvailable, reloadPostgrestSchema } from '../supabase';
import { createLogger } from '../utils/logger';
import { localizeSupabaseError, isAbortLikeError } from '../utils/errorUtils';
import { enqueueRpc, upsertOfflinePosOrder } from '../utils/offlineQueue';
import { decryptField, isEncrypted } from '../utils/encryption';

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
    customerId?: string;
    customerName?: string;
    phoneNumber?: string;
    notes?: string;
    discountType?: 'amount' | 'percent';
    discountValue?: number;
    paymentMethod: string;
    paymentReferenceNumber?: string;
    paymentSenderName?: string;
    paymentSenderPhone?: string;
    paymentDeclaredAmount?: number;
    paymentAmountConfirmed?: boolean;
    isCredit?: boolean;
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
  }) => Promise<Order>;
  createInStorePendingOrder: (input: {
    lines: Array<
      | { menuItemId: string; quantity?: number; weight?: number; selectedAddons?: Record<string, number> }
      | { promotionId: string; bundleQty?: number; promotionLineId?: string; promotionSnapshot?: any }
    >;
    customerId?: string;
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
    customerName?: string;
    phoneNumber?: string;
    notes?: string;
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
      cashReceived?: number;
    }>;
    occurredAt?: string;
  }) => Promise<Order>;
  cancelInStorePendingOrder: (orderId: string) => Promise<void>;
  updateOrderStatus: (orderId: string, status: OrderStatus, meta?: { deliveredLocation?: { lat: number; lng: number; accuracy?: number }; deliveryPin?: string }) => Promise<void>;
  assignOrderToDelivery: (orderId: string, deliveryUserId: string | null) => Promise<void>;
  acceptDeliveryAssignment: (orderId: string) => Promise<void>;
  getOrderById: (orderId: string) => Order | undefined;
  fetchOrders: () => Promise<void>;
  awardPointsForReviewedOrder: (orderId: string) => Promise<boolean>;
  incrementInvoicePrintCount: (orderId: string) => Promise<void>;
  markOrderPaid: (orderId: string) => Promise<void>;
  recordOrderPaymentPartial: (orderId: string, amount: number, method?: string, occurredAt?: string) => Promise<void>;
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
  const confirmDeliveryRpcModeRef = useRef<null | 'wrapper' | 'direct4'>(null);


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

  const isRpcNotFoundError = (err: any) => {
    const code = String(err?.code || '');
    const msg = String(err?.message || '');
    const details = String(err?.details || '');
    const status = (err as any)?.status;
    return (
      code === 'PGRST202' ||
      status === 404 ||
      /Could not find the function/i.test(msg) ||
      /PGRST202/i.test(details)
    );
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
      const { error } = await supabase.rpc('confirm_order_delivery_with_credit', {
        p_order_id: input.orderId,
        p_items: input.items,
        p_updated_data: input.updatedData,
        p_warehouse_id: input.warehouseId,
      });
      return error;
    };
    const tryWrapper = async () => {
      const { error } = await supabase.rpc('confirm_order_delivery_with_credit', {
        p_payload: {
          p_order_id: input.orderId,
          p_items: input.items,
          p_updated_data: input.updatedData,
          p_warehouse_id: input.warehouseId,
        }
      });
      return error;
    };

    const runByMode = async (mode: 'wrapper' | 'direct4') => (mode === 'wrapper' ? await tryWrapper() : await tryDirect4());
    const cached = confirmDeliveryWithCreditRpcModeRef.current;
    if (cached) {
      const err = await runByMode(cached);
      if (!err || !isRpcNotFoundError(err)) return err;
      confirmDeliveryWithCreditRpcModeRef.current = null;
    }

    const strict = isRpcStrictMode();
    if (strict) {
      let err = await tryWrapper();
      if (err && isRpcNotFoundError(err)) {
        const reloaded = await reloadPostgrestSchema();
        if (reloaded) err = await tryWrapper();
      }
      if (!err || !isRpcNotFoundError(err)) {
        confirmDeliveryWithCreditRpcModeRef.current = 'wrapper';
        if (await isRpcWrappersAvailable()) markRpcStrictModeEnabled();
        return err;
      }
      return err;
    }

    let err = await tryWrapper();
    if (!err || !isRpcNotFoundError(err)) {
      confirmDeliveryWithCreditRpcModeRef.current = 'wrapper';
      if (await isRpcWrappersAvailable()) markRpcStrictModeEnabled();
      return err;
    }

    {
      const reloaded = await reloadPostgrestSchema();
      if (reloaded) {
        err = await tryWrapper();
        if (!err || !isRpcNotFoundError(err)) {
          confirmDeliveryWithCreditRpcModeRef.current = 'wrapper';
          if (await isRpcWrappersAvailable()) markRpcStrictModeEnabled();
          return err;
        }
      }
    }

    err = await tryDirect4();
    if (!err || !isRpcNotFoundError(err)) {
      confirmDeliveryWithCreditRpcModeRef.current = 'direct4';
    }
    return err;
  };

  const rpcConfirmOrderDelivery = async (supabase: any, input: { orderId: string; items: any[]; updatedData: any; warehouseId: string }) => {
    const tryDirect4 = async () => {
      const { error } = await supabase.rpc('confirm_order_delivery', {
        p_order_id: input.orderId,
        p_items: input.items,
        p_updated_data: input.updatedData,
        p_warehouse_id: input.warehouseId,
      });
      return error;
    };
    const tryWrapper = async () => {
      const { error } = await supabase.rpc('confirm_order_delivery', {
        p_payload: {
          p_order_id: input.orderId,
          p_items: input.items,
          p_updated_data: input.updatedData,
          p_warehouse_id: input.warehouseId,
        }
      });
      return error;
    };

    const runByMode = async (mode: 'wrapper' | 'direct4') => (mode === 'wrapper' ? await tryWrapper() : await tryDirect4());
    const cached = confirmDeliveryRpcModeRef.current;
    if (cached) {
      const err = await runByMode(cached);
      if (!err || !isRpcNotFoundError(err)) return err;
      confirmDeliveryRpcModeRef.current = null;
    }

    const strict = isRpcStrictMode();
    if (strict) {
      let err = await tryWrapper();
      if (err && isRpcNotFoundError(err)) {
        const reloaded = await reloadPostgrestSchema();
        if (reloaded) err = await tryWrapper();
      }
      if (!err || !isRpcNotFoundError(err)) {
        confirmDeliveryRpcModeRef.current = 'wrapper';
        if (await isRpcWrappersAvailable()) markRpcStrictModeEnabled();
        return err;
      }
      return err;
    }

    let err = await tryWrapper();
    if (!err || !isRpcNotFoundError(err)) {
      confirmDeliveryRpcModeRef.current = 'wrapper';
      if (await isRpcWrappersAvailable()) markRpcStrictModeEnabled();
      return err;
    }

    {
      const reloaded = await reloadPostgrestSchema();
      if (reloaded) {
        err = await tryWrapper();
        if (!err || !isRpcNotFoundError(err)) {
          confirmDeliveryRpcModeRef.current = 'wrapper';
          if (await isRpcWrappersAvailable()) markRpcStrictModeEnabled();
          return err;
        }
      }
    }

    err = await tryDirect4();
    if (!err || !isRpcNotFoundError(err)) {
      confirmDeliveryRpcModeRef.current = 'direct4';
    }
    return err;
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
      const { data: row, error } = await supabase
        .from('orders')
        .select('id,status,created_at,delivery_zone_id,data')
        .eq('id', orderId)
        .maybeSingle();
      if (error) throw error;
      if (!row) return undefined;
      const base = (row.data || {}) as Order;
      const enriched: Order = {
        ...base,
        id: String(row.id),
        status: (row.status as OrderStatus) || base.status || 'pending',
        createdAt: (row.created_at as string) || base.createdAt || new Date().toISOString(),
        deliveryZoneId: (row.delivery_zone_id as string) || base.deliveryZoneId,
      };
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

  const updateRemoteOrder = useCallback(async (order: Order) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const payload: Record<string, any> = {
        status: order.status,
        data: order,
      };
      if (typeof order.deliveryZoneId === 'string' && isUuid(order.deliveryZoneId)) {
        payload.delivery_zone_id = order.deliveryZoneId;
      }
      if (typeof (order as any).warehouseId === 'string' && isUuid((order as any).warehouseId)) {
        payload.warehouse_id = (order as any).warehouseId;
      }

      const { error } = await supabase
        .from('orders')
        .update(payload)
        .eq('id', order.id);

      if (error) throw error;
    } catch (err) {
      console.error('Failed to update order:', err);
      throw new Error(localizeSupabaseError(err));
    }
  }, []);

  const createRemoteOrder = useCallback(async (order: Order) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const payload: Record<string, any> = {
        id: order.id,
        status: order.status,
        delivery_zone_id: order.deliveryZoneId ?? null,
        warehouse_id: (order as any).warehouseId ?? null,
        data: order,
      };
      payload.customer_auth_user_id = order.userId || (order.orderSource === 'in_store' ? adminUser?.id : undefined);
      if (!payload.customer_auth_user_id) {
        throw new Error('تعذر إنشاء الطلب: معرف المستخدم غير متوفر. تأكد من تسجيل الدخول (للبيع الحضوري: يجب أن تكون مسجلاً كمدير).');
      }

      const { error } = await supabase
        .from('orders')
        .insert(payload);

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
  }, []);



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
    const availableQuantity = Number.isFinite(Number(row?.available_quantity))
      ? Number(row.available_quantity)
      : (Number.isFinite(Number((data as any).availableQuantity)) ? Number((data as any).availableQuantity) : 0);
    const reservedQuantity = Number.isFinite(Number(row?.reserved_quantity))
      ? Number(row.reserved_quantity)
      : (Number.isFinite(Number((data as any).reservedQuantity)) ? Number((data as any).reservedQuantity) : 0);
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
      availableQuantity,
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
      .select('item_id, available_quantity, reserved_quantity, unit, low_stock_threshold, last_updated, data')
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
      const requested = getRequestedItemQuantity(item);
      if (!(requested > 0)) continue;
      const unit = (item.unitType || item.unit || 'piece') as StockManagement['unit'];
      const current = await loadStockRecord(item.id, item.availableStock || 0, unit, warehouseId);
      const availableToSell = current.availableQuantity - current.reservedQuantity;
      if (availableToSell + 1e-9 < requested) {
        const name = item.name?.ar || item.id;
        throw new Error(`الكمية المطلوبة من "${name}" غير متوفرة. المتاح: ${availableToSell}`);
      }
    }
  };

  const isInvoiceEligible = useCallback((order: Order) => {
    if (order.status !== 'delivered') return false;
    const isCod = order.paymentMethod === 'cash' && order.orderSource !== 'in_store' && Boolean(order.deliveryZoneId);
    if (isCod) return Boolean(order.paidAt);
    return true;
  }, []);

  const ensureInvoiceIssued = useCallback(async (order: Order, issuedAtIso?: string) => {
    if (order.invoiceIssuedAt && order.invoiceNumber) return;
    if (!isInvoiceEligible(order)) return;

    const invoiceIssuedAt = order.invoiceIssuedAt || issuedAtIso || order.deliveredAt || order.createdAt || order.paidAt || new Date().toISOString();
    let invoiceNumber = order.invoiceNumber || '';
    try {
      const supabase = getSupabaseClient();
      if (supabase && !invoiceNumber) {
        const { data, error } = await supabase.rpc('assign_invoice_number_if_missing', { p_order_id: order.id });
        if (!error && typeof data === 'string' && data) {
          invoiceNumber = data;
        }
      }
    } catch {}
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
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        discountAmount: order.discountAmount,
        total: order.total,
        paymentMethod: order.paymentMethod,
        customerName: order.customerName,
        phoneNumber: order.phoneNumber,
        address: order.address,
        deliveryZoneId: order.deliveryZoneId,
      }
      : undefined;

    const run = async () => {
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
      } catch {}
      await addOrderEvent({
        orderId: order.id,
        action: 'order.invoiceIssued',
        actorType: isAdminAuthenticated ? 'admin' : 'system',
        actorId: isAdminAuthenticated ? adminUser?.id : undefined,
        createdAt: invoiceIssuedAt,
        payload: { invoiceNumber },
      });
      await updateRemoteOrder(nextOrder);
      setOrders(prev => prev.map(o => (o.id === nextOrder.id ? nextOrder : o)));
    };
    await run();
  }, [addOrderEvent, adminUser?.id, isAdminAuthenticated, isInvoiceEligible, updateRemoteOrder, getSupabaseClient]);

  const isFetchingRef = useRef(false);
  const invoiceEnsureAttemptedRef = useRef<Set<string>>(new Set());
  const fetchOrders = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
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
            const conn: any = (typeof navigator !== 'undefined' && (navigator as any).connection) ? (navigator as any).connection : null;
            const eff: string = typeof conn?.effectiveType === 'string' ? conn.effectiveType : '';
            const isSlow = eff === 'slow-2g' || eff === '2g';
            const hardLimit = isSlow ? 60 : 150;
            const baseQuery = supabase
              .from('orders')
              .select('id,status,created_at,delivery_zone_id,data')
              .order('created_at', { ascending: false })
              .limit(hardLimit);
            if (shouldLoadAll) return await baseQuery;
            return await baseQuery.eq('customer_auth_user_id', currentUser!.id);
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
            const merged = (rows || []).map((r: any) => {
              const base = (r?.data || {}) as Order;
              const enriched: Order = {
                ...base,
                id: String(r.id),
                status: (r.status as OrderStatus) || base.status || 'pending',
                createdAt: typeof r.created_at === 'string' ? r.created_at : (base.createdAt || new Date().toISOString()),
                deliveryZoneId: typeof r.delivery_zone_id === 'string' ? r.delivery_zone_id : base.deliveryZoneId,
              };
              return enriched;
            }).filter(Boolean);
            merged.sort((a, b) => (String(b.createdAt || '')).localeCompare(String(a.createdAt || '')));
            setOrders(merged);
            setLoading(false);
            void (async () => {
              try {
                const remoteOrders = await Promise.all(merged.map(o => resolveOrderAddress(o)));
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
            const needsInvoice = nextOrders.filter(o => isInvoiceEligible(o) && !o.invoiceIssuedAt && !invoiceEnsureAttemptedRef.current.has(o.id));
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
      const msg = String(error?.message || '');
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const isAborted = /abort|ERR_ABORTED|Failed to fetch/i.test(msg);
      if (import.meta.env.DEV) {
        if (isOffline || isAborted) {
          logger.info('تخطي جلب الطلبات: الشبكة غير متاحة أو الطلب أُلغي.');
        } else {
          logger.error('تعذر جلب الطلبات من الخادم:', error);
        }
      }
    } finally {
      setOrders(nextOrders);
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
    if (!supabase) {
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
      .subscribe();

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
        selectedAddons: addonsSimple,
      };
    });

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
        p_payment_proof: orderData.paymentProof || null
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
      | { menuItemId: string; quantity?: number; weight?: number; selectedAddons?: Record<string, number> }
      | { promotionId: string; bundleQty?: number; promotionLineId?: string; promotionSnapshot?: any }
    >;
    customerId?: string;
    customerName?: string;
    phoneNumber?: string;
    notes?: string;
    discountType?: 'amount' | 'percent';
    discountValue?: number;
    paymentMethod: string;
    paymentReferenceNumber?: string;
    paymentSenderName?: string;
    paymentSenderPhone?: string;
    paymentDeclaredAmount?: number;
    paymentAmountConfirmed?: boolean;
    isCredit?: boolean;
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
  }) => {
    if (!isAdminAuthenticated || !canCreateInStoreSale()) {
      throw new Error('ليس لديك صلاحية تسجيل بيع حضوري.');
    }
    const canMarkPaidUi = hasPermission('orders.markPaid');

    const IN_STORE_DELIVERY_ZONE_ID = '11111111-1111-4111-8111-111111111111';
    const enabledPaymentMethods = Object.entries(settings.paymentMethods || {})
      .filter(([, isEnabled]) => Boolean(isEnabled))
      .map(([key]) => key);

    if (enabledPaymentMethods.length === 0) {
      throw new Error('لا توجد طرق دفع مفعلة في الإعدادات.');
    }

    const method = (input.paymentMethod || '').trim();
    if (!method) {
      throw new Error('يرجى اختيار طريقة الدفع.');
    }

    if (!enabledPaymentMethods.includes(method)) {
      throw new Error('طريقة الدفع غير مفعلة في الإعدادات.');
    }

    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    const normalizedMenuLines = rawLines
      .filter((l: any) => typeof l?.menuItemId === 'string' && Boolean(l.menuItemId))
      .map((l: any) => ({
        menuItemId: String(l.menuItemId),
        quantity: typeof l.quantity === 'number' ? l.quantity : undefined,
        weight: typeof l.weight === 'number' ? l.weight : undefined,
        selectedAddons: l.selectedAddons || {},
      }));
    const normalizedPromoLines = rawLines
      .filter((l: any) => typeof l?.promotionId === 'string' && Boolean(l.promotionId))
      .map((l: any) => ({
        promotionId: String(l.promotionId),
        bundleQty: typeof l.bundleQty === 'number' ? l.bundleQty : undefined,
        promotionLineId: typeof l.promotionLineId === 'string' ? l.promotionLineId : undefined,
        promotionSnapshot: l.promotionSnapshot,
      }));

    if (!normalizedMenuLines.length && !normalizedPromoLines.length) {
      throw new Error('يجب إضافة صنف واحد على الأقل.');
    }

    if (normalizedPromoLines.length > 0 && offline) {
      throw new Error('لا يمكن إتمام بيع عرض بدون اتصال بالخادم.');
    }

    const menuItems = await Promise.all(normalizedMenuLines.map((l) => loadMenuItemById(l.menuItemId)));
    if (menuItems.some((m) => !m)) {
      throw new Error('تعذر تحميل بعض الأصناف.');
    }

    const nowIso = new Date().toISOString();
    const warehouseId = sessionScope.requireScope().warehouseId;
    let items: CartItem[] = normalizedMenuLines.map((line, idx) => {
      const menuItem = menuItems[idx]!;
      const unitType = menuItem.unitType;
      const isWeightBased = unitType === 'kg' || unitType === 'gram';
      const quantity = !isWeightBased ? (line.quantity || 0) : 1;
      const weight = isWeightBased ? (line.weight || 0) : undefined;

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
        cartItemId: crypto.randomUUID(),
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

    if (!offline) {
      const stockCheckItems = items.filter((it: any) => !(it?.lineType === 'promotion' || it?.promotionId));
      await ensureSufficientStockForOrderItems(stockCheckItems, warehouseId);
    }

    let pricedItems: CartItem[] = items;
    if (!offline) {
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
        const pricingQty = (item.unitType === 'kg' || item.unitType === 'gram')
          ? (item.weight || item.quantity)
          : item.quantity;
        const call = async (customerId: string | null) => {
          return await supabaseForPricing!.rpc('get_item_price_with_discount', {
            p_item_id: item.id,
            p_customer_id: customerId,
            p_quantity: pricingQty,
          });
        };
        const rawCustomerId = (input.customerId && String(input.customerId).trim() !== '') ? String(input.customerId) : null;
        let { data, error } = await call(rawCustomerId);
        
        if (error && isRpcNotFoundError(error)) {
            const reloaded = await reloadPostgrestSchema();
            if (reloaded) {
                const retry = await call(rawCustomerId);
                data = retry.data;
                error = retry.error;
            }
        }

        if (error) {
          const code = String((error as any)?.code || '');
          const msg = String((error as any)?.message || '');
          if (code === '42883' || /operator does not exist:\s*text\s*=\s*uuid/i.test(msg)) {
            const retry = await call(null);
            data = retry.data;
            error = retry.error;
          }
        }
        if (error) throw new Error(localizeSupabaseError(error));
        const unitPrice = Number(data);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new Error('تعذر احتساب السعر.');
        }
        if (item.unitType === 'gram') {
          return { ...item, price: unitPrice, pricePerUnit: unitPrice * 1000 };
        }
        return { ...item, price: unitPrice };
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

    const computedSubtotal = items.reduce((total, item) => {
      const addonsPrice = Object.values(item.selectedAddons || {}).reduce(
        (sum, { addon, quantity }) => sum + addon.price * quantity,
        0
      );

      let itemPrice = item.price;
      let itemQuantity = item.quantity;

      if (item.unitType === 'kg' || item.unitType === 'gram') {
        itemQuantity = item.weight || item.quantity;
        if (item.unitType === 'gram' && item.pricePerUnit) {
          itemPrice = item.pricePerUnit / 1000;
        }
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

    const normalizedBreakdown = (input.paymentBreakdown || [])
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
      .filter((p) => Boolean(p.method) && (Number(p.amount) || 0) > 0);

    const fallbackNeedsReference = method === 'kuraimi' || method === 'network';
    const fallbackBreakdown = [
      {
        method,
        amount: computedTotal,
        referenceNumber: fallbackNeedsReference ? (input.paymentReferenceNumber || '').trim() || undefined : undefined,
        senderName: fallbackNeedsReference ? (input.paymentSenderName || '').trim() || undefined : undefined,
        senderPhone: fallbackNeedsReference ? (input.paymentSenderPhone || '').trim() || undefined : undefined,
        declaredAmount: fallbackNeedsReference ? (Number(input.paymentDeclaredAmount) || 0) : 0,
        amountConfirmed: fallbackNeedsReference ? Boolean(input.paymentAmountConfirmed) : true,
        cashReceived: 0,
      },
    ];

    const paymentBreakdown = normalizedBreakdown.length > 0 ? normalizedBreakdown : fallbackBreakdown;

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

    if (!breakdownMethods.has(method)) {
      throw new Error('طريقة الدفع الرئيسية لا تطابق تقسيم الدفع.');
    }

    const paymentTotal = paymentBreakdown.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const isFullyPaid = Math.abs(paymentTotal - computedTotal) <= 0.01;
    
    if (!input.isCredit && !isFullyPaid) {
      throw new Error('مجموع تقسيم الدفع لا يطابق إجمالي البيع.');
    }

    const cashEntry = cashLines[0];
    const cashReceived = cashEntry && cashEntry.cashReceived > 0 ? cashEntry.cashReceived : undefined;
    const cashChange = cashEntry && cashEntry.cashReceived > 0 ? Math.max(0, cashEntry.cashReceived - cashEntry.amount) : undefined;

    const orderPaymentMethod = paymentBreakdown.length === 1 ? paymentBreakdown[0].method : 'mixed';
    let invoiceNumber = generateInvoiceNumber(crypto.randomUUID(), nowIso);
    const singleNeedsReference = orderPaymentMethod === 'kuraimi' || orderPaymentMethod === 'network';
    const singleReferenceNumber = paymentBreakdown.length === 1 ? (paymentBreakdown[0].referenceNumber || '') : '';
    const singleSenderName = paymentBreakdown.length === 1 ? (paymentBreakdown[0].senderName || '') : '';
    const singleSenderPhone = paymentBreakdown.length === 1 ? (paymentBreakdown[0].senderPhone || '') : '';
    const singleDeclaredAmount = paymentBreakdown.length === 1 ? (Number(paymentBreakdown[0].declaredAmount) || 0) : 0;

    // Prepare Invoice Snapshot immediately
    const invoiceSnapshot: Order['invoiceSnapshot'] = {
      issuedAt: nowIso,
      invoiceNumber,
      createdAt: nowIso,
      orderSource: 'in_store',
      items: items,
      subtotal: computedSubtotal,
      deliveryFee: 0,
      deliveryZoneId: IN_STORE_DELIVERY_ZONE_ID,
      discountAmount,
      total: computedTotal,
      paymentMethod: orderPaymentMethod,
      paymentBreakdown: paymentBreakdown.map((p) => ({
        method: p.method,
        amount: p.amount,
        referenceNumber: p.referenceNumber,
        senderName: p.senderName,
        senderPhone: p.senderPhone,
        cashReceived: p.method === 'cash' ? (p.cashReceived > 0 ? p.cashReceived : undefined) : undefined,
        cashChange: p.method === 'cash' && p.cashReceived > 0 ? Math.max(0, p.cashReceived - p.amount) : undefined,
      })),
      cashReceived,
      cashChange,
      paymentProofType: singleNeedsReference ? 'ref_number' : undefined,
      paymentProof: singleNeedsReference ? singleReferenceNumber : undefined,
      paymentSenderName: singleNeedsReference ? singleSenderName : undefined,
      paymentSenderPhone: singleNeedsReference ? singleSenderPhone : undefined,
      paymentDeclaredAmount: singleNeedsReference ? singleDeclaredAmount : undefined,
      paymentVerifiedBy: singleNeedsReference ? adminUser?.id : undefined,
      paymentVerifiedAt: singleNeedsReference ? nowIso : undefined,
      customerName: input.customerName?.trim() || 'زبون حضوري',
      phoneNumber: input.phoneNumber?.trim() || '',
      address: 'داخل المحل',
    };

    const promotionLines = (items as any[])
      .filter((it) => it?.lineType === 'promotion' || it?.promotionId)
      .map((it) => ({
        ...(it.promotionSnapshot || {}),
        promotionLineId: String(it.promotionLineId || crypto.randomUUID()),
      }));

      // Only mark as paid if it is actually fully paid, or if we are skipping validation (e.g. forced by UI)
      // But for POS, we should rely on isFullyPaid.
      const actuallyPaidAt = (canMarkPaidUi && isFullyPaid) ? nowIso : undefined;

      const newOrder: Order = {
      id: crypto.randomUUID(),
      userId: adminUser?.id,
      orderSource: 'in_store',
      warehouseId,
      customerId: input.customerId || undefined,
      offlineState: offline ? 'CREATED_OFFLINE' : undefined,
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
      paymentMethod: canMarkPaidUi ? orderPaymentMethod : 'unknown',
      paymentBreakdown: canMarkPaidUi ? paymentBreakdown.map((p) => ({
        method: p.method,
        amount: p.amount,
        referenceNumber: p.referenceNumber,
        senderName: p.senderName,
        senderPhone: p.senderPhone,
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
      status: offline ? 'pending' : (canMarkPaidUi ? 'delivered' : 'pending'),
      createdAt: nowIso,
      deliveredAt: offline ? undefined : (canMarkPaidUi ? nowIso : undefined),
      paidAt: offline ? undefined : actuallyPaidAt,
      reviewPointsAwarded: false,
      invoiceNumber,
      invoiceIssuedAt: offline ? undefined : (canMarkPaidUi ? nowIso : undefined),
      invoiceSnapshot: canMarkPaidUi ? invoiceSnapshot : undefined,
      invoicePrintCount: 0,
    };

    const payloadItems = newOrder.items
      .filter((item: any) => !(item?.lineType === 'promotion' || item?.promotionId))
      .map((item) => ({
        itemId: item.id,
        quantity: getRequestedItemQuantity(item),
      }))
      .filter((entry) => Number(entry.quantity) > 0);

    if (offline) {
      newOrder.offlineId = newOrder.id;
      upsertOfflinePosOrder({ offlineId: newOrder.id, orderId: newOrder.id, state: 'CREATED_OFFLINE' });
      enqueueRpc('sync_offline_pos_sale', {
        p_offline_id: newOrder.id,
        p_order_id: newOrder.id,
        p_order_data: newOrder,
        p_items: payloadItems,
        p_warehouse_id: warehouseId,
        p_payments: (paymentBreakdown || []).map((p) => ({
          method: p.method,
          amount: Number(p.amount) || 0,
          referenceNumber: p.referenceNumber,
          senderName: p.senderName,
          senderPhone: p.senderPhone,
          declaredAmount: Number((p as any).declaredAmount) || 0,
          amountConfirmed: Boolean((p as any).amountConfirmed),
          cashReceived: (p as any).cashReceived,
          occurredAt: nowIso,
        })),
      });
      setOrders(prev => [newOrder, ...prev]);
      return newOrder;
    }

    // 1. Insert as pending (safe state)
    await createRemoteOrder({ ...newOrder, status: 'pending' });

    // 1.1 Assign official invoice number from sequence if online
    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        const sb1 = supabase!;
        const { data: invNum } = await sb1.rpc('assign_invoice_number_if_missing', { p_order_id: newOrder.id });
        if (typeof invNum === 'string' && invNum) {
          newOrder.invoiceNumber = invNum;
          if (newOrder.invoiceSnapshot) {
            newOrder.invoiceSnapshot!.invoiceNumber = invNum;
          }
        }
      }
    } catch {}

    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');
    const sb2 = supabase!;
    if (canMarkPaidUi) {
      const rpcError = await rpcConfirmOrderDeliveryWithCredit(sb2, {
        orderId: newOrder.id,
        items: payloadItems,
        updatedData: newOrder,
        warehouseId,
      });

      if (rpcError) {
        const offlineNow = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (offlineNow || isAbortLikeError(rpcError)) {
          const hasPromoLines =
            Array.isArray((newOrder as any).promotionLines) && (newOrder as any).promotionLines.length > 0;
          if (hasPromoLines) {
            throw new Error('لا يمكن إتمام بيع عرض دون اتصال بالخادم. أعد المحاولة عند توفر الاتصال.');
          }
          newOrder.offlineId = newOrder.id;
          newOrder.offlineState = 'CREATED_OFFLINE';
          newOrder.status = 'pending';
          newOrder.deliveredAt = undefined;
          newOrder.paidAt = undefined;
          newOrder.invoiceIssuedAt = undefined;
          upsertOfflinePosOrder({ offlineId: newOrder.id, orderId: newOrder.id, state: 'CREATED_OFFLINE' });
          enqueueRpc('sync_offline_pos_sale', {
            p_offline_id: newOrder.id,
            p_order_id: newOrder.id,
            p_order_data: newOrder,
            p_items: payloadItems,
            p_warehouse_id: warehouseId,
            p_payments: (paymentBreakdown || []).map((p) => ({ ...p, occurredAt: nowIso })),
          });
          setOrders(prev => [newOrder, ...prev]);
          return newOrder;
        }
        await sb2.from('orders').delete().eq('id', newOrder.id);
        console.error('In-store sale confirmation failed:', rpcError);
        throw new Error(localizeSupabaseError(rpcError));
      }
    }


    if (canMarkPaidUi) {
      try {
        const supabase = getSupabaseClient();
        if (supabase) {
          const sbPay = supabase!;
          for (let i = 0; i < paymentBreakdown.length; i++) {
            const p = paymentBreakdown[i];
            const { error } = await sbPay.rpc('record_order_payment', {
              p_order_id: newOrder.id,
              p_amount: Number(p.amount) || 0,
              p_method: p.method,
              p_occurred_at: nowIso,
              p_idempotency_key: `instore:${newOrder.id}:${nowIso}:${i}:${p.method}:${Number(p.amount) || 0}`,
            });
            if (error) {
              if (import.meta.env.DEV) {
                logger.warn('Failed to record payment for in-store sale:', error);
              }
            }
          }
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          logger.warn('Failed to record payment for in-store sale:', err);
        }
      }
    }

    if (canMarkPaidUi) {
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
            invoiceNumber,
          },
        }),
        addOrderEvent({
          orderId: newOrder.id,
          action: 'order.invoiceIssued',
          actorType: 'system',
          createdAt: nowIso,
          payload: { invoiceNumber },
        })
      ]);
    } else {
      await addOrderEvent({
        orderId: newOrder.id,
        action: 'order.created',
        actorType: 'admin',
        actorId: adminUser?.id,
        toStatus: newOrder.status,
        createdAt: nowIso,
        payload: {
          orderSource: 'in_store',
          discountAmount,
          total: newOrder.total,
          awaitingPayment: true,
        },
      });
    }

    logAudit('instore_sale_created', `In-store sale created #${invoiceNumber}`, { 
        orderId: newOrder.id, 
        total: newOrder.total, 
        itemsCount: items.length 
    });

    setOrders(prev => [newOrder, ...prev]);

    // await fetchOrders();
    return newOrder;
  };

  const createInStorePendingOrder = async (input: {
    lines: Array<
      | { menuItemId: string; quantity?: number; weight?: number; selectedAddons?: Record<string, number> }
      | { promotionId: string; bundleQty?: number; promotionLineId?: string; promotionSnapshot?: any }
    >;
    customerId?: string;
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
      return {
        ...menuItem,
        quantity,
        weight,
        selectedAddons: resolvedAddons,
        cartItemId: crypto.randomUUID(),
      };
    });
    if (items.some((i) => getRequestedItemQuantity(i) <= 0)) {
      throw new Error('الكمية/الوزن يجب أن يكون أكبر من صفر.');
    }
    await ensureSufficientStockForOrderItems(items, warehouseId);
    const supabaseForPricing = getSupabaseClient();
    if (!supabaseForPricing) throw new Error('Supabase غير مهيأ.');
    const pricedItems = await Promise.all(items.map(async (item) => {
      const pricingQty = (item.unitType === 'kg' || item.unitType === 'gram')
        ? (item.weight || item.quantity)
        : item.quantity;
      const { data, error } = await supabaseForPricing!.rpc('get_item_price_with_discount', {
        p_item_id: item.id,
        p_customer_id: input.customerId ? String(input.customerId) : null,
        p_quantity: pricingQty,
      });
      if (error) {
        throw new Error(localizeSupabaseError(error));
      }
      const unitPrice = Number(data);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error('تعذر احتساب السعر.');
      }
      if (item.unitType === 'gram') {
        return { ...item, price: unitPrice, pricePerUnit: unitPrice * 1000 };
      }
      return { ...item, price: unitPrice };
    }));
    items = pricedItems;
    const computedSubtotal = items.reduce((total, item) => {
      const addonsPrice = Object.values(item.selectedAddons || {}).reduce(
        (sum, { addon, quantity }) => sum + addon.price * quantity,
        0
      );
      let itemPrice = item.price;
      let itemQuantity = item.quantity;
      if (item.unitType === 'kg' || item.unitType === 'gram') {
        itemQuantity = item.weight || item.quantity;
        if (item.unitType === 'gram' && item.pricePerUnit) {
          itemPrice = item.pricePerUnit / 1000;
        }
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
      userId: adminUser?.id,
      orderSource: 'in_store',
      warehouseId,
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
      address: 'داخل المحل',
      paymentMethod: 'mixed',
      status: 'pending',
      createdAt: nowIso,
    };
    await createRemoteOrder(newOrder);
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      await supabase.from('orders').delete().eq('id', newOrder.id);
      throw new Error('انتهت الجلسة. الرجاء تسجيل الدخول مرة أخرى.');
    }
    const payloadItems = newOrder.items
      .map((item) => ({
        itemId: item.id,
        quantity: getRequestedItemQuantity(item),
      }))
      .filter((entry) => Number(entry.quantity) > 0);
    const sb3 = supabase!;
    const reserveErr = await rpcReserveStockForOrder(sb3, { items: payloadItems, orderId: newOrder.id, warehouseId });
    if (reserveErr) {
      await sb3.from('orders').delete().eq('id', newOrder.id);
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
    setOrders(prev => [newOrder, ...prev]);
    return newOrder;
  };

  const createInStoreDraftQuotation = async (input: {
    lines: Array<{ menuItemId: string; quantity?: number; weight?: number; selectedAddons?: Record<string, number> }>;
    customerId?: string;
    customerName?: string;
    phoneNumber?: string;
    notes?: string;
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
    const supabaseForPricing = getSupabaseClient();
    if (!supabaseForPricing) throw new Error('Supabase غير مهيأ.');
    const pricedItems = await Promise.all(items.map(async (item) => {
      const pricingQty = (item.unitType === 'kg' || item.unitType === 'gram') ? (item.weight || item.quantity) : item.quantity;
      const { data, error } = await supabaseForPricing!.rpc('get_item_price_with_discount', {
        p_item_id: item.id,
        p_customer_id: input.customerId ? String(input.customerId) : null,
        p_quantity: pricingQty,
      });
      if (error) throw new Error(localizeSupabaseError(error));
      const unitPrice = Number(data);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('تعذر احتساب السعر.');
      if (item.unitType === 'gram') return { ...item, price: unitPrice, pricePerUnit: unitPrice * 1000 };
      return { ...item, price: unitPrice };
    }));
    items = pricedItems;
    const computedSubtotal = items.reduce((total, item) => {
      const addonsPrice = Object.values(item.selectedAddons || {}).reduce((sum, { addon, quantity }) => sum + addon.price * quantity, 0);
      let itemPrice = item.price;
      let itemQuantity = item.quantity;
      if (item.unitType === 'kg' || item.unitType === 'gram') {
        itemQuantity = item.weight || item.quantity;
        if (item.unitType === 'gram' && item.pricePerUnit) {
          itemPrice = item.pricePerUnit / 1000;
        }
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
      userId: adminUser?.id,
      orderSource: 'in_store',
      warehouseId,
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
      address: 'داخل المحل',
      paymentMethod: 'unknown',
      status: 'pending',
      createdAt: nowIso,
      isDraft: true,
    };
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
    setOrders(prev => [newOrder, ...prev]);
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
      throw new Error('نطاق المستودع غير محدد لهذا الطلب. يمنع التنفيذ خارج نطاق الجلسة.');
    };
    const warehouseId = await resolveWarehouseId();
    const payloadItems = existing.items
      .map((item) => ({
        itemId: item.id,
        quantity: getRequestedItemQuantity(item),
      }))
      .filter((entry) => Number(entry.quantity) > 0);
    const updatedDelivered: Order = { ...existing, status: 'delivered', deliveredAt: nowIso, paidAt: nowIso, paymentMethod: payment.paymentMethod };
    const rpcError = await rpcConfirmOrderDeliveryWithCredit(supabase, {
      orderId: existing.id,
      items: payloadItems,
      updatedData: updatedDelivered,
      warehouseId,
    });
    if (rpcError) {
      throw new Error(localizeSupabaseError(rpcError));
    }
    const breakdown = (payment.paymentBreakdown || [
      { method: payment.paymentMethod, amount: existing.total || 0 }
    ]).filter(p => (Number(p.amount) || 0) > 0);
    for (let i = 0; i < breakdown.length; i++) {
      const p = breakdown[i];
      const { error } = await supabase.rpc('record_order_payment', {
        p_order_id: existing.id,
        p_amount: Number(p.amount) || 0,
        p_method: p.method,
        p_occurred_at: payment.occurredAt || nowIso,
        p_idempotency_key: `resume:${existing.id}:${payment.occurredAt || nowIso}:${i}:${p.method}:${Number(p.amount) || 0}`,
      });
      if (error) {
        throw new Error(localizeSupabaseError(error));
      }
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
    const payloadItems = existing.items
      .map((item) => ({
        itemId: item.id,
        quantity: getRequestedItemQuantity(item),
      }))
      .filter((entry) => Number(entry.quantity) > 0);
    const resolveWarehouseId = async (): Promise<string> => {
      const byCol = typeof (existing as any).warehouseId === 'string' ? (existing as any).warehouseId : undefined;
      if (byCol) return byCol;
      throw new Error('نطاق المستودع غير محدد لهذا الطلب. يمنع التنفيذ خارج نطاق الجلسة.');
    };
    const warehouseId = await resolveWarehouseId();
    const { error: releaseErr } = await supabase.rpc('release_reserved_stock_for_order', {
      p_items: payloadItems,
      p_order_id: existing.id,
      p_warehouse_id: warehouseId,
    });
    if (releaseErr) {
      throw new Error(localizeSupabaseError(releaseErr));
    }
    await supabase.from('orders').delete().eq('id', existing.id);
    setOrders(prev => prev.filter(o => o.id !== existing.id));
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
      await updateRemoteOrder({ ...order, reviewPointsAwarded: true } as Order);
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

    if (!isAllowedTransition(existing.status, status)) {
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
    if (willDeliver) {
      const updated = { ...existing, ...updates } as Order;
      
      // Use atomic RPC for delivery confirmation (Status Update + Stock Deduction)
      const payloadItems = updated.items
        .map((item) => ({
          itemId: item.id,
          quantity: getRequestedItemQuantity(item),
        }))
        .filter((entry) => Number(entry.quantity) > 0);

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
      let isWholesaleCustomer = false;
      try {
        const { data: customerTypeRes, error: customerTypeErr } = await supabase.rpc('get_order_customer_type', { p_order_id: updated.id });
        if (!customerTypeErr) {
          isWholesaleCustomer = String(customerTypeRes || '').trim() === 'wholesale';
        }
      } catch {
      }

      const rpcError = isWholesaleCustomer
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
        } else {
          console.error('Delivery confirmation failed:', rpcError);
          throw new Error(localizeSupabaseError(rpcError));
        }
      }
    }
    if (willCancel) {
      const updated = { ...existing, ...updates } as Order;
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase غير مهيأ.');
      const { error: rpcError } = await supabase.rpc('cancel_order', {
        p_order_id: updated.id,
        p_reason: '',
      });
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

    if (willDeliver) {
      let updated = { ...existing, ...updates } as Order;
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
            const { error } = await supabase.rpc('record_order_payment', {
              p_order_id: updated.id,
              p_amount: remaining,
              p_method: updated.paymentMethod,
              p_occurred_at: nowIso,
              p_idempotency_key: `delivery:${updated.id}:${nowIso}:${Number(remaining) || 0}`,
            });
            if (error) {
              const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
              if (isOffline || isAbortLikeError(error)) {
                // Offline: إبقاء السلوك كما هو عبر الطابور، مع السماح بضبط paidAt
                enqueueRpc('record_order_payment', {
                  p_order_id: updated.id,
                  p_amount: remaining,
                  p_method: updated.paymentMethod,
                  p_occurred_at: nowIso,
                  p_idempotency_key: `delivery:${updated.id}:${nowIso}:${Number(remaining) || 0}`,
                });
                paidAtIso = nowIso;
              } else {
                // الأكثر أمانًا محاسبيًا: إيقاف العملية بدون ضبط paidAt إذا فشل تسجيل الدفع
                throw new Error('تعذر تسجيل الدفعة عند التسليم (غير COD). لن يتم ضبط وقت الدفع paidAt.');
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
            await ensureInvoiceIssued(updated, paidAtIso);
            await updateRemoteOrder(updated);
          }
        } catch (err) {
          // تمرير الخطأ ليُبلغ الواجهة؛ لا نضبط paidAt إن فشل الدفع في وضع Online
          throw err instanceof Error ? err : new Error(String(err || 'Payment error'));
        }
      } else {
        // COD: المسار غير متأثر هنا؛ الضبط يتم عبر وظائف التسوية فقط
        await ensureInvoiceIssued(updated, nowIso);
      }

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
    const persistBase = remoteSnapshot || existing;
    const persisted = { ...persistBase, ...updates } as Order;
    if (!willCancel) {
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

    const nowIso = new Date().toISOString();
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

        const updates: Partial<Order> = { paidAt: existing.paidAt || nowIso };
        await addOrderEvent({
          orderId,
          action: 'order.markedPaid',
          actorType: 'admin',
          actorId: adminUser?.id,
          createdAt: updates.paidAt,
          payload: { paymentMethod: existing.paymentMethod },
        });

        const updated = { ...existing, ...updates } as Order;
        await ensureInvoiceIssued(updated, updates.paidAt);
        await updateRemoteOrder(updated);

        const paidAlready = await fetchOrderPaidAmount(updated.id);
        const remaining = Math.max(0, (Number(updated.total) || 0) - paidAlready);
        if (remaining > 0) {
          const { error } = await supabase.rpc('record_order_payment', {
            p_order_id: updated.id,
            p_amount: remaining,
            p_method: updated.paymentMethod,
            p_occurred_at: updates.paidAt,
            p_idempotency_key: `markPaid:${updated.id}:${updates.paidAt}:${Number(remaining) || 0}`,
          });
          if (error) {
            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            if (isOffline || isAbortLikeError(error)) {
              enqueueRpc('record_order_payment', {
                p_order_id: updated.id,
                p_amount: remaining,
                p_method: updated.paymentMethod,
                p_occurred_at: updates.paidAt,
                p_idempotency_key: `markPaid:${updated.id}:${updates.paidAt}:${Number(remaining) || 0}`,
              });
            } else {
              throw error;
            }
          }
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        logger.warn('Failed to record payment:', err);
      }
      throw err;
    }
    const updates: Partial<Order> = { paidAt: existing.paidAt || nowIso };
    const updated = { ...existing, ...updates } as Order;
    setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
    // await fetchOrders();
  };

  const recordOrderPaymentPartial = useCallback(
    async (orderId: string, amount: number, method?: string, occurredAt?: string) => {
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

      await addOrderEvent({
        orderId,
        action: 'order.paymentRecorded',
        actorType: 'admin',
        actorId: adminUser?.id,
        createdAt: occurredAtIso,
        payload: { amount: numericAmount, method: methodValue },
      });

      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase غير مهيأ.');
      }
      try {
        const { error } = await supabase.rpc('record_order_payment', {
          p_order_id: existing.id,
          p_amount: numericAmount,
          p_method: methodValue,
          p_occurred_at: occurredAtIso,
          p_idempotency_key: `partial:${existing.id}:${occurredAtIso}:${Number(numericAmount) || 0}`,
        });
        if (error) throw error;
      } catch (err) {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline || isAbortLikeError(err)) {
          enqueueRpc('record_order_payment', {
            p_order_id: existing.id,
            p_amount: numericAmount,
            p_method: methodValue,
            p_occurred_at: occurredAtIso,
            p_idempotency_key: `partial:${existing.id}:${occurredAtIso}:${Number(numericAmount) || 0}`,
          });
        } else {
          throw new Error(localizeSupabaseError(err));
        }
      }
    },
    [addOrderEvent, adminUser?.id, fetchRemoteOrderById, orders]
  );

  const incrementInvoicePrintCount = async (orderId: string) => {
    const order = (await fetchRemoteOrderById(orderId)) || orders.find(o => o.id === orderId);
    if (!order?.invoiceIssuedAt) return;
    const currentCount = typeof order.invoicePrintCount === 'number' ? order.invoicePrintCount : 0;
    const nowIso = new Date().toISOString();
    await addOrderEvent({
      orderId,
      action: 'order.invoicePrinted',
      actorType: isAdminAuthenticated ? 'admin' : 'system',
      actorId: adminUser?.id,
      createdAt: nowIso,
      payload: { invoiceNumber: order.invoiceNumber, nextPrintCount: currentCount + 1 },
    });
    if (isAdminAuthenticated && adminUser?.id) {
      await logAudit('invoice_printed', `Invoice printed #${String(order.invoiceNumber || '').trim()}`, {
        orderId,
        invoiceNumber: order.invoiceNumber,
        nextPrintCount: currentCount + 1,
        invoiceLastPrintedAt: nowIso,
      });
    }
    const updated = { ...order, invoicePrintCount: currentCount + 1, invoiceLastPrintedAt: nowIso } as Order;
    await updateRemoteOrder(updated);
    setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
    // await fetchOrders();
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
    <OrderContext.Provider value={{ orders, userOrders, loading, addOrder, createInStoreSale, createInStorePendingOrder, createInStoreDraftQuotation, resumeInStorePendingOrder, cancelInStorePendingOrder, updateOrderStatus, assignOrderToDelivery, acceptDeliveryAssignment, getOrderById, fetchOrders, awardPointsForReviewedOrder, incrementInvoicePrintCount, markOrderPaid, recordOrderPaymentPartial, issueInvoiceNow }}>
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
