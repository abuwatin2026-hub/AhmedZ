import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { disableRealtime, getBaseCurrencyCode, getSupabaseClient, isRealtimeEnabled, reloadPostgrestSchema } from '../supabase';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';
import { normalizeIsoDateOnly, toDateInputValue, toUtcIsoFromLocalDateTimeInput } from '../utils/dateUtils';
import { Supplier, PurchaseOrder } from '../types';
import { useAuth } from './AuthContext';

interface PurchasesContextType {
    suppliers: Supplier[];
    purchaseOrders: PurchaseOrder[];
    loading: boolean;
    error: string | null;
    addSupplier: (supplier: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    updateSupplier: (id: string, updates: Partial<Supplier>) => Promise<void>;
    deleteSupplier: (id: string) => Promise<void>;
    createPurchaseOrder: (
        supplierId: string,
        purchaseDate: string,
        currency: string,
        fxRate: number,
        items: Array<{ itemId: string; quantity: number; unitCost: number; productionDate?: string; expiryDate?: string }>,
        receiveNow?: boolean,
        referenceNumber?: string,
        warehouseId?: string,
        paymentTerms?: 'cash' | 'credit',
        netDays?: number,
        dueDate?: string
    ) => Promise<void>;
    deletePurchaseOrder: (purchaseOrderId: string) => Promise<void>;
    cancelPurchaseOrder: (purchaseOrderId: string, reason?: string, occurredAt?: string) => Promise<void>;
    recordPurchaseOrderPayment: (
        purchaseOrderId: string,
        amount: number,
        method: string,
        occurredAt?: string,
        data?: Record<string, unknown>
    ) => Promise<string>;
    receivePurchaseOrderPartial: (
        purchaseOrderId: string,
        items: Array<{ itemId: string; quantity: number; productionDate?: string; expiryDate?: string }>,
        occurredAt?: string
    ) => Promise<string>;
    createPurchaseReturn: (
        purchaseOrderId: string,
        items: Array<{ itemId: string; quantity: number }>,
        reason?: string,
        occurredAt?: string
    ) => Promise<void>;
    updatePurchaseOrderInvoiceNumber: (purchaseOrderId: string, invoiceNumber: string | null) => Promise<void>;
    getPurchaseReturnSummary: (purchaseOrderId: string) => Promise<Record<string, number>>;
    fetchPurchaseOrders: () => Promise<void>;
}

const PurchasesContext = createContext<PurchasesContextType | undefined>(undefined);

export const PurchasesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { user } = useAuth();
  const supabase = getSupabaseClient();

  const mapSupplierRow = (row: any): Supplier => {
    const now = new Date().toISOString();
    return {
      id: String(row?.id),
      name: String(row?.name || ''),
      preferredCurrency: typeof row?.preferred_currency === 'string' ? row.preferred_currency : (typeof row?.preferredCurrency === 'string' ? row.preferredCurrency : undefined),
      contactPerson: typeof row?.contact_person === 'string' ? row.contact_person : (typeof row?.contactPerson === 'string' ? row.contactPerson : undefined),
      phone: typeof row?.phone === 'string' ? row.phone : (typeof row?.phone === 'string' ? row.phone : undefined),
      email: typeof row?.email === 'string' ? row.email : (typeof row?.email === 'string' ? row.email : undefined),
      taxNumber: typeof row?.tax_number === 'string' ? row.tax_number : (typeof row?.taxNumber === 'string' ? row.taxNumber : undefined),
      address: typeof row?.address === 'string' ? row.address : (typeof row?.address === 'string' ? row.address : undefined),
      createdAt: typeof row?.created_at === 'string' ? row.created_at : now,
      updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : now,
    };
  };

  const toDbSupplier = (obj: Partial<Supplier>): Record<string, unknown> => {
    const payload: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(obj, 'name')) payload.name = obj.name ?? null;
    if (Object.prototype.hasOwnProperty.call(obj, 'contactPerson')) payload.contact_person = obj.contactPerson ?? null;
    if (Object.prototype.hasOwnProperty.call(obj, 'preferredCurrency')) {
      const v = typeof obj.preferredCurrency === 'string' ? obj.preferredCurrency.trim().toUpperCase() : obj.preferredCurrency;
      payload.preferred_currency = typeof v === 'string' && v.length === 0 ? null : v ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'phone')) {
      const v = typeof obj.phone === 'string' ? obj.phone.trim() : obj.phone;
      payload.phone = typeof v === 'string' && v.length === 0 ? null : v ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'email')) {
      const v = typeof obj.email === 'string' ? obj.email.trim() : obj.email;
      payload.email = typeof v === 'string' && v.length === 0 ? null : v ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'taxNumber')) {
      const v = typeof obj.taxNumber === 'string' ? obj.taxNumber.trim() : obj.taxNumber;
      payload.tax_number = typeof v === 'string' && v.length === 0 ? null : v ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'address')) payload.address = obj.address ?? null;
    return payload;
  };

  const isUniqueViolation = (err: unknown) => {
    const anyErr = err as any;
    const code = typeof anyErr?.code === 'string' ? anyErr.code : '';
    if (code === '23505') return true;
    const msg = typeof anyErr?.message === 'string' ? anyErr.message.toLowerCase() : '';
    const details = typeof anyErr?.details === 'string' ? anyErr.details.toLowerCase() : '';
    const hint = typeof anyErr?.hint === 'string' ? anyErr.hint.toLowerCase() : '';
    const combined = `${msg}\n${details}\n${hint}`;
    return (
      combined.includes('duplicate') ||
      combined.includes('duplicate key') ||
      combined.includes('unique') ||
      combined.includes('violates unique constraint') ||
      combined.includes('already exists') ||
      combined.includes('البيانات المدخلة موجودة مسبق') ||
      combined.includes('موجودة مسبق')
    );
  };

  const normalizeUomCode = (value: unknown) => {
    const v = String(value ?? '').trim();
    return v.length ? v : 'piece';
  };

  const isUuid = (value: unknown) => {
    const v = String(value ?? '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  };

  const toIsoDateOnlyOrNull = (value: unknown) => {
    const normalized = normalizeIsoDateOnly(String(value ?? ''));
    if (!normalized) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
  };

  const ensureUomId = useCallback(async (codeRaw: unknown) => {
    if (!supabase) throw new Error('Supabase غير مهيأ.');
    const code = normalizeUomCode(codeRaw);
    const { data: existing, error: existingErr } = await supabase
      .from('uom')
      .select('id')
      .eq('code', code)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing?.id) return String(existing.id);

    try {
      const { data: inserted, error: insertErr } = await supabase
        .from('uom')
        .insert([{ code, name: code }])
        .select('id')
        .single();
      if (insertErr) throw insertErr;
      return String(inserted.id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const { data: after, error: afterErr } = await supabase
          .from('uom')
          .select('id')
          .eq('code', code)
          .maybeSingle();
        if (afterErr) throw afterErr;
        if (after?.id) return String(after.id);
      }
      throw err;
    }
  }, [supabase]);

  const ensureItemUomRow = useCallback(async (itemId: string) => {
    if (!supabase) throw new Error('Supabase غير مهيأ.');
    const id = String(itemId || '').trim();
    if (!id) throw new Error('معرف الصنف غير صالح.');

    const { data: existingIU, error: existingIUErr } = await supabase
      .from('item_uom')
      .select('id')
      .eq('item_id', id)
      .maybeSingle();
    if (existingIUErr) throw existingIUErr;
    if (existingIU?.id) return;

    const { data: itemRow, error: itemErr } = await supabase
      .from('menu_items')
      .select('id, base_unit, unit_type, data')
      .eq('id', id)
      .maybeSingle();
    if (itemErr) throw itemErr;
    if (!itemRow?.id) throw new Error('الصنف غير موجود.');

    const dataObj: any = (itemRow as any).data || {};
    const unit = normalizeUomCode(
      (itemRow as any).base_unit ??
      (itemRow as any).unit_type ??
      dataObj?.baseUnit ??
      dataObj?.unitType ??
      dataObj?.base_unit
    );
    const uomId = await ensureUomId(unit);

    try {
      const { error: insertIUErr } = await supabase
        .from('item_uom')
        .insert([{ item_id: id, base_uom_id: uomId, purchase_uom_id: null, sales_uom_id: null }]);
      if (insertIUErr) throw insertIUErr;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }, [ensureUomId, supabase]);

  const updateMenuItemDates = useCallback(async (items: Array<{ itemId: string; productionDate?: string; expiryDate?: string }>) => {
      if (!supabase) return;
      const metaUpdates = items.filter(i => i.productionDate || i.expiryDate);
      if (metaUpdates.length === 0) return;
      await Promise.all(metaUpdates.map(async (i) => {
          const { data: row, error: loadErr } = await supabase
              .from('menu_items')
              .select('id,data')
              .eq('id', i.itemId)
              .maybeSingle();
          if (loadErr) return;
          if (!row) return;
          const current = row.data as any;
          const next = {
              ...current,
              productionDate: (i.productionDate ?? current?.productionDate ?? current?.harvestDate),
              expiryDate: i.expiryDate ?? current?.expiryDate,
          };
          await supabase
              .from('menu_items')
              .update({ data: next })
              .eq('id', row.id);
      }));
  }, [supabase]);

  const ensureApprovalRequest = useCallback(async (orderId: string, type: 'po' | 'receipt', amount: number) => {
    if (!supabase) return null;
    const { data: existingRows, error: existingErr } = await supabase
      .from('approval_requests')
      .select('id,status')
      .eq('target_table', 'purchase_orders')
      .eq('target_id', orderId)
      .eq('request_type', type)
      .in('status', ['pending', 'approved'] as any)
      .limit(1);
    if (!existingErr && Array.isArray(existingRows) && existingRows.length > 0) {
      const row: any = existingRows[0];
      return String(row.id);
    }
    const seedPolicy = async () => {
      try {
        const { data: rows, error: polErr } = await supabase
          .from('approval_policies')
          .select('id')
          .eq('request_type', type)
          .eq('is_active', true)
          .order('min_amount', { ascending: false })
          .limit(1);
        if (!polErr && Array.isArray(rows) && rows.length > 0) {
          const pid = String((rows[0] as any)?.id || '');
          if (pid) {
            await supabase.from('approval_policy_steps').upsert(
              { policy_id: pid, step_no: 1, approver_role: 'manager' } as any,
              { onConflict: 'policy_id,step_no' } as any
            );
            return;
          }
        }
      } catch {
      }

      try {
        const { data: inserted, error: insertErr } = await supabase
          .from('approval_policies')
          .insert([{ request_type: type, min_amount: 0, max_amount: null, steps_count: 1, is_active: true }] as any)
          .select('id')
          .single();
        if (insertErr) throw insertErr;
        const policyId = String((inserted as any)?.id || '');
        if (policyId) {
          await supabase.from('approval_policy_steps').upsert(
            { policy_id: policyId, step_no: 1, approver_role: 'manager' } as any,
            { onConflict: 'policy_id,step_no' } as any
          );
        }
      } catch {
      }
    };

    const tryCreate = async () => await supabase.rpc('create_approval_request', {
      p_target_table: 'purchase_orders',
      p_target_id: orderId,
      p_request_type: type,
      p_amount: amount,
      p_payload: { purchaseOrderId: orderId },
    } as any);

    let { data: reqId, error: createErr } = await tryCreate();
    if (createErr) {
      const msg = String((createErr as any)?.message || '');
      const code = String((createErr as any)?.code || '');
      if (/schema cache|could not find the function|PGRST202/i.test(msg) || code === 'PGRST202') {
        const reloaded = await reloadPostgrestSchema();
        if (reloaded) {
          const retry = await tryCreate();
          reqId = retry.data as any;
          createErr = retry.error as any;
        }
      }
    }
    if (createErr) {
      const msg = String((createErr as any)?.message || '');
      const code = String((createErr as any)?.code || '');
      if (/approval policy not found/i.test(msg)) {
        await seedPolicy();
        const retry = await tryCreate();
        if (!retry.error) {
          return typeof retry.data === 'string' ? retry.data : null;
        }
      }
      if (code === '23505' || /duplicate key|unique/i.test(msg)) {
        const { data: afterRows } = await supabase
          .from('approval_requests')
          .select('id,status')
          .eq('target_table', 'purchase_orders')
          .eq('target_id', orderId)
          .eq('request_type', type)
          .in('status', ['pending', 'approved'] as any)
          .order('created_at', { ascending: false })
          .limit(1);
        if (Array.isArray(afterRows) && afterRows.length > 0) {
          return String((afterRows[0] as any)?.id || '') || null;
        }
      }
      return null;
    }
    return typeof reqId === 'string' ? reqId : null;
  }, [supabase]);

  const fetchSuppliers = useCallback(async (opts?: { silent?: boolean }) => {
      if (!supabase) return;
      try {
          if (!opts?.silent) setError(null);
          const { data, error } = await supabase.from('suppliers').select('*').order('name');
          if (error) throw error;
          const mapped = (data || []).map(mapSupplierRow);
          setSuppliers(mapped);
      } catch (err) {
          const msg = String((err as any)?.message || '');
          const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
          const isAborted = /abort|ERR_ABORTED|Failed to fetch/i.test(msg) || isAbortLikeError(err);
          if (isOffline || isAborted) return;
          const message = localizeSupabaseError(err);
          if (message) setError(message);
          if (!opts?.silent && message) throw new Error(message);
      } finally {
          setLoading(false);
      }
    }, [supabase]);

    const fetchPurchaseOrders = useCallback(async (opts?: { silent?: boolean }) => {
        if (!supabase) return;
        try {
            if (!opts?.silent) setError(null);
            const { data, error } = await supabase
                .from('purchase_orders')
                .select(`
          *,
          supplier:suppliers(name),
          warehouse:warehouses(name),
          items:purchase_items(
             *,
             item:menu_items(id,data)
          )
        `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const formatted: PurchaseOrder[] = (data || []).map((order: any) => ({
                id: order.id,
                supplierId: order.supplier_id ?? order.supplierId,
                supplierName: order.supplier?.name,
                status: order.status,
                approvalStatus: order.approval_status ?? order.approvalStatus,
                requiresApproval: Boolean(order.requires_approval ?? order.requiresApproval),
                approvalRequestId: order.approval_request_id ?? order.approvalRequestId,
                poNumber: order.po_number ?? order.poNumber ?? undefined,
                referenceNumber: order.reference_number ?? order.referenceNumber,
                currency: order.currency ?? order.currency,
                fxRate: Number(order.fx_rate ?? order.fxRate ?? 0) || undefined,
                totalAmount: Number(order.total_amount ?? order.totalAmount ?? 0),
                paidAmount: Number(order.paid_amount ?? order.paidAmount ?? 0),
                baseTotal: Number(order.base_total ?? order.baseTotal ?? 0) || undefined,
                purchaseDate: order.purchase_date ?? order.purchaseDate,
                itemsCount: Number(order.items_count ?? order.itemsCount ?? order.items?.length ?? 0),
                warehouseId: order.warehouse_id ?? order.warehouseId,
                warehouseName: order.warehouse?.name ?? order.warehouse_name ?? undefined,
                paymentTerms: (order.payment_terms === 'credit' ? 'credit' : 'cash'),
                netDays: Number(order.net_days ?? 0),
                dueDate: order.due_date ?? undefined,
                notes: order.notes,
                createdBy: order.created_by ?? order.createdBy,
                createdAt: order.created_at ?? order.createdAt,
                updatedAt: order.updated_at ?? order.updatedAt,
                items: (order.items || []).map((item: any) => ({
                    id: item.id,
                    purchaseOrderId: item.purchase_order_id ?? item.purchaseOrderId,
                    itemId: item.item_id ?? item.itemId,
                    itemName: item.item?.data?.name?.ar || item.item?.data?.name?.en || item.item_name || item.itemName || 'Unknown Item',
                    quantity: Number(item.quantity ?? 0),
                    qtyBase: Number(item.qty_base ?? item.qtyBase ?? item.quantity ?? 0),
                    receivedQuantity: Number(item.received_quantity ?? item.receivedQuantity ?? 0),
                    uomId: item.uom_id ?? item.uomId ?? null,
                    unitCost: Number(item.unit_cost ?? item.unitCost ?? 0),
                    unitCostBase: Number(item.unit_cost_base ?? item.unitCostBase ?? 0),
                    totalCost: Number(item.total_cost ?? item.totalCost ?? (Number(item.quantity ?? 0) * Number(item.unit_cost ?? 0)))
                }))
            }));

            const orderIds = formatted.map(o => o.id);
            let returnsByOrder: Record<string, number> = {};
            if (orderIds.length > 0) {
                const CHUNK_SIZE = 60;
                const chunks: string[][] = [];
                for (let i = 0; i < orderIds.length; i += CHUNK_SIZE) {
                    chunks.push(orderIds.slice(i, i + CHUNK_SIZE));
                }
                const results = await Promise.all(chunks.map(async (chunk) => {
                    const { data: rows, error: err } = await supabase
                        .from('purchase_returns')
                        .select('id, purchase_order_id')
                        .in('purchase_order_id', chunk);
                    if (err) return [];
                    return Array.isArray(rows) ? rows : [];
                }));
                for (const returnsRows of results.flat()) {
                    const k = String((returnsRows as any)?.purchase_order_id || '');
                    if (!k) continue;
                    returnsByOrder[k] = (returnsByOrder[k] || 0) + 1;
                }
            }

            const withReturns = formatted.map(o => ({
                ...o,
                hasReturns: (returnsByOrder[o.id] || 0) > 0
            }));

            setPurchaseOrders(withReturns);
            try {
              const eps = 0.000000001;
              const candidates = withReturns
                .filter((o) => o.status === 'partial')
                .filter((o) => Array.isArray(o.items) && o.items.length > 0)
                .filter((o) => (o.items || []).every((it: any) => (Number(it?.receivedQuantity || 0) + eps) >= Number(it?.quantity || 0)))
                .map((o) => o.id)
                .filter(Boolean)
                .slice(0, 8);
              if (candidates.length > 0) {
                await Promise.allSettled(
                  candidates.map(async (id) => {
                    const res = await supabase.rpc('reconcile_purchase_order_receipt_status', { p_order_id: id } as any);
                    const msg = String((res as any)?.error?.message || '');
                    if (/schema cache|could not find the function|PGRST202/i.test(msg)) return;
                  })
                );
                void fetchPurchaseOrders({ silent: true });
              }
            } catch {
            }
        } catch (err) {
            const msg = String((err as any)?.message || '');
            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            const isAborted = /abort|ERR_ABORTED|Failed to fetch/i.test(msg);
            if (isOffline || isAborted) {
                if (!opts?.silent) {
                    console.info('تخطي جلب أوامر الشراء: الشبكة غير متاحة أو الطلب أُلغي.');
                }
                return;
            }
            const message = localizeSupabaseError(err);
            setError(message);
            if (!opts?.silent) throw new Error(message);
        }
    }, [supabase]);

  useEffect(() => {
      if (!supabase || !user) return;
      fetchSuppliers({ silent: true }).catch(() => undefined);
      fetchPurchaseOrders({ silent: true }).catch(() => undefined);
  }, [fetchPurchaseOrders, fetchSuppliers, supabase, user]);

  useEffect(() => {
    if (!supabase || !user) return;
    const scheduleRefetch = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchSuppliers({ silent: true });
      void fetchPurchaseOrders({ silent: true });
    };

    const onFocus = () => scheduleRefetch();
    const onVisibility = () => scheduleRefetch();
    const onOnline = () => scheduleRefetch();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      window.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('online', onOnline);
    }

    if (!isRealtimeEnabled()) {
      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('focus', onFocus);
          window.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('online', onOnline);
        }
      };
    }

    const channel = supabase
      .channel('public:purchases')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, () => {
        void fetchSuppliers({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders' }, () => {
        void fetchPurchaseOrders({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_items' }, () => {
        void fetchPurchaseOrders({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_returns' }, () => {
        void fetchPurchaseOrders({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_return_items' }, () => {
        void fetchPurchaseOrders({ silent: true });
      })
      .subscribe((status: any) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          disableRealtime();
          supabase.removeChannel(channel);
        }
      });

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('online', onOnline);
      }
      supabase.removeChannel(channel);
    };
  }, [fetchPurchaseOrders, fetchSuppliers, supabase, user]);

  const addSupplier = async (supplier: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>) => {
      if (!supabase) return;
      const payload = toDbSupplier(supplier);
      if (!payload.name || String(payload.name).trim() === '') {
        throw new Error('اسم المورد مطلوب');
      }
      try {
        const { error } = await supabase.from('suppliers').insert([payload]);
        if (error) throw error;
        await fetchSuppliers();
      } catch (err) {
        throw new Error(localizeSupabaseError(err));
      }
  };

  const updateSupplier = async (id: string, updates: Partial<Supplier>) => {
      if (!supabase) return;
      const payload = toDbSupplier(updates);
      try {
        const { error } = await supabase.from('suppliers').update(payload).eq('id', id);
        if (error) throw error;
        await fetchSuppliers();
      } catch (err) {
        throw new Error(localizeSupabaseError(err));
      }
  };

    const deleteSupplier = async (id: string) => {
        if (!supabase) return;
        try {
          // فحص مراجع مانعة قبل الحذف: أوامر شراء مرتبطة بالمورد
          const { count: poCount, error: poErr } = await supabase
            .from('purchase_orders')
            .select('id', { count: 'exact', head: true })
            .eq('supplier_id', id);
          if (poErr) throw poErr;
          if (typeof poCount === 'number' && poCount > 0) {
            throw new Error('لا يمكن حذف المورد: توجد أوامر شراء مرتبطة بهذا المورد.');
          }
          const { error } = await supabase.from('suppliers').delete().eq('id', id);
          if (error) throw error;
          await fetchSuppliers();
        } catch (err) {
          throw new Error(localizeSupabaseError(err));
        }
    };

    const createPurchaseOrder = async (
        supplierId: string,
        purchaseDate: string,
        currency: string,
        fxRate: number,
        items: Array<{ itemId: string; quantity: number; unitCost: number; uomCode?: string; uomQtyInBase?: number; productionDate?: string; expiryDate?: string }>,
        receiveNow: boolean = true,
        referenceNumber?: string,
        warehouseId?: string,
        paymentTerms?: 'cash' | 'credit',
        netDays?: number,
        dueDate?: string
    ) => {
        if (!supabase) throw new Error('Supabase غير مهيأ.');
        if (!user) throw new Error('لم يتم تسجيل الدخول.');

        const poCurrency = String(currency || '').trim().toUpperCase();
        const poFxRate = Number(fxRate);
        if (!poCurrency) throw new Error('عملة أمر الشراء مطلوبة.');
        if (!Number.isFinite(poFxRate) || poFxRate <= 0) throw new Error('سعر الصرف غير صالح.');

        const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
        const itemsCount = items.length;
        const normalizedDate = normalizeIsoDateOnly(purchaseDate) || toDateInputValue();

        try {
          setError(null);
          const providedRef = typeof referenceNumber === 'string' ? referenceNumber.trim() : '';

          let scopeWarehouseId: string | null = null;
          let scopeBranchId: string | null = null;
          let scopeCompanyId: string | null = null;
          try {
            const { data: scopeRows, error: scopeErr } = await supabase.rpc('get_admin_session_scope');
            if (!scopeErr && Array.isArray(scopeRows) && scopeRows.length > 0) {
              const row: any = scopeRows[0];
              scopeWarehouseId = (row?.warehouse_id ?? row?.warehouseId ?? null) as any;
              scopeBranchId = (row?.branch_id ?? row?.branchId ?? null) as any;
              scopeCompanyId = (row?.company_id ?? row?.companyId ?? null) as any;
            }
          } catch {
          }
          if (!scopeWarehouseId) {
            try {
              const { data: wh, error: whErr } = await supabase.rpc('_resolve_default_admin_warehouse_id');
              if (!whErr && wh) scopeWarehouseId = String(wh);
            } catch {
            }
          }
          if (!scopeWarehouseId) {
            throw new Error('لا يوجد مستودع نشط. أضف مستودع (MAIN) ثم أعد المحاولة.');
          }
          const providedWarehouseId = typeof warehouseId === 'string' ? warehouseId.trim() : '';
          const effectiveWarehouseId = providedWarehouseId || scopeWarehouseId;
          const effectiveTerms = paymentTerms === 'credit' ? 'credit' : 'cash';
          const effectiveNetDays = effectiveTerms === 'credit' ? Math.max(0, Number(netDays) || 0) : 0;
          const effectiveDueDate = effectiveTerms === 'credit'
            ? (normalizeIsoDateOnly(String(dueDate || '')) || null)
            : normalizedDate;
          const uniqueItemIds = Array.from(new Set(items.map(i => String(i.itemId || '').trim()).filter(Boolean)));
          await Promise.all(uniqueItemIds.map(async (id) => ensureItemUomRow(id)));
          if (receiveNow) {
            const { error: whErr } = await supabase.rpc('_resolve_default_warehouse_id');
            if (whErr) throw whErr;
          }

          if (providedRef) {
            const { data: existingByRef, error: refErr } = await supabase
              .from('purchase_orders')
              .select('id')
              .eq('reference_number', providedRef)
              .limit(1)
              .maybeSingle();
            if (refErr) throw refErr;
            if (existingByRef?.id) {
              throw new Error('رقم فاتورة المورد مستخدم بالفعل.');
            }
          }

          let lastInsertError: unknown = null;
          let orderData: any | null = null;
          let currentRef = providedRef;

          for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
              const { data, error: orderError } = await supabase
                .from('purchase_orders')
                .insert([{
                  supplier_id: supplierId,
                  purchase_date: normalizedDate,
                  reference_number: currentRef || null,
                  currency: poCurrency,
                  fx_rate: poFxRate,
                  total_amount: totalAmount,
                  items_count: itemsCount,
                  created_by: user.id,
                  status: 'draft',
                  warehouse_id: effectiveWarehouseId,
                  branch_id: scopeBranchId ?? undefined,
                  company_id: scopeCompanyId ?? undefined,
                  payment_terms: effectiveTerms,
                  net_days: effectiveNetDays,
                  due_date: effectiveDueDate,
                }])
                .select()
                .single();

              if (orderError) throw orderError;
              orderData = data;
              lastInsertError = null;
              break;
            } catch (err) {
              lastInsertError = err;
              if (isUniqueViolation(err)) throw err;
              throw err;
            }
          }

          if (!orderData) throw lastInsertError ?? new Error('فشل إنشاء أمر الشراء.');
          const orderId = orderData.id;

          const purchaseItems = await Promise.all(items.map(async (item) => {
            const qtyInBase = Math.max(1, Number(item.uomQtyInBase || 1));
            const unitCost = Number(item.unitCost || 0);
            const uomCode = String(item.uomCode || '').trim().toLowerCase();
            const uomId = uomCode ? await ensureUomId(uomCode) : null;
            return {
              purchase_order_id: orderId,
              item_id: item.itemId,
              quantity: Number(item.quantity || 0),
              uom_id: uomId,
              unit_cost: unitCost,
              unit_cost_foreign: unitCost,
              unit_cost_base: qtyInBase > 0 ? (unitCost / qtyInBase) : unitCost,
              total_cost: Number(item.quantity || 0) * unitCost,
            };
          }));

          try {
            const { error: itemsError } = await supabase.from('purchase_items').insert(purchaseItems);
            if (itemsError) throw itemsError;
          } catch (itemsErr) {
            try {
              await supabase.from('purchase_items').delete().eq('purchase_order_id', orderId);
            } catch {
            }
            try {
              await supabase.from('purchase_orders').delete().eq('id', orderId);
            } catch {
            }
            throw itemsErr;
          }

          if (receiveNow) {
            await ensureApprovalRequest(orderId, 'receipt', totalAmount);
          }

          if (receiveNow) {
            const baseNow = new Date();
            const occurredAtIsoBase = baseNow.toISOString();
            const rawReceiveItems = items.map(i => ({
              itemId: String(i.itemId || '').trim(),
              quantity: Number(i.quantity || 0),
              uomCode: String((i as any).uomCode || '').trim().toLowerCase() || null,
              harvestDate: toIsoDateOnlyOrNull(i.productionDate),
              expiryDate: toIsoDateOnlyOrNull(i.expiryDate),
            })).filter(x => x.itemId && Number(x.quantity || 0) > 0);

            const mergedByKey = new Map<string, any>();
            for (const row of rawReceiveItems) {
              const key = `${String(row.itemId || '').trim()}::${String(row.uomCode || '')}`;
              if (!key) continue;
              const prev = mergedByKey.get(key);
              if (!prev) {
                mergedByKey.set(key, { ...row });
                continue;
              }
              prev.quantity = Number(prev.quantity || 0) + Number(row.quantity || 0);
              if (!prev.harvestDate && row.harvestDate) prev.harvestDate = row.harvestDate;
              if (!prev.expiryDate && row.expiryDate) prev.expiryDate = row.expiryDate;
            }
            const receiveItems = Array.from(mergedByKey.values()).filter((r: any) => Number(r?.quantity || 0) > 0);

            const computeIdempotencyKey = async (occurredAtIso: string) => {
              const parts = receiveItems
                .map((x: any) => [
                  String(x.itemId || ''),
                  String(Number(x.quantity || 0)),
                  String(x.uomCode || ''),
                  String(x.harvestDate || ''),
                  String(x.expiryDate || ''),
                ].join(':'))
                .sort()
                .join('|');
              const raw = `receive:${orderId}:${occurredAtIso}:${parts}`;
              try {
                const anyCrypto: any = (globalThis as any)?.crypto;
                if (anyCrypto?.subtle?.digest) {
                  const enc = new TextEncoder();
                  const buf = await anyCrypto.subtle.digest('SHA-256', enc.encode(raw));
                  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
                  return `rcv_${hex}`;
                }
              } catch {
              }
              return raw.length > 180 ? raw.slice(0, 180) : raw;
            };
            const tryReceive = async (occurredAtIso: string) => {
              const idempotencyKey = await computeIdempotencyKey(occurredAtIso);
              const receiveItemsWithIdempotency = receiveItems.map((x: any) => ({ ...x, idempotencyKey }));
              const { data, error } = await supabase.rpc('receive_purchase_order_partial', {
                p_order_id: orderId,
                p_items: receiveItemsWithIdempotency,
                p_occurred_at: occurredAtIso
              });
              return { data, error, idempotencyKey, occurredAtIso, receiveItemsWithIdempotency };
            };

            const recoverFromDuplicate = async (orderId: string, occurredAtIso: string, idempotencyKey: string) => {
              try {
                const { data: existing, error: existingErr } = await supabase
                  .from('purchase_receipts')
                  .select('id')
                  .eq('purchase_order_id', orderId)
                  .eq('idempotency_key', idempotencyKey)
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                if (!existingErr && existing?.id) {
                  try {
                    const repairRes = await supabase.rpc('repair_purchase_receipt_stock', { p_receipt_id: existing.id } as any);
                    const repairMsg = String((repairRes as any)?.error?.message || '');
                    if (/schema cache|could not find the function|PGRST202/i.test(repairMsg)) {
                      await reloadPostgrestSchema();
                    }
                  } catch {
                  }
                  try {
                    await supabase.rpc('reconcile_purchase_order_receipt_status', { p_order_id: orderId } as any);
                  } catch {
                  }
                  await updateMenuItemDates(items);
                  await fetchPurchaseOrders({ silent: false });
                  return true;
                }
              } catch {
              }

              try {
                const minIso = new Date(new Date(occurredAtIso).getTime() - 60_000).toISOString();
                const maxIso = new Date(new Date(occurredAtIso).getTime() + 60_000).toISOString();
                const { data: recent, error: recentErr } = await supabase
                  .from('purchase_receipts')
                  .select('id,received_at')
                  .eq('purchase_order_id', orderId)
                  .gte('received_at', minIso)
                  .lte('received_at', maxIso)
                  .order('received_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                if (!recentErr && recent?.id) {
                  try {
                    const repairRes = await supabase.rpc('repair_purchase_receipt_stock', { p_receipt_id: recent.id } as any);
                    const repairMsg = String((repairRes as any)?.error?.message || '');
                    if (/schema cache|could not find the function|PGRST202/i.test(repairMsg)) {
                      await reloadPostgrestSchema();
                    }
                  } catch {
                  }
                  try {
                    await supabase.rpc('reconcile_purchase_order_receipt_status', { p_order_id: orderId } as any);
                  } catch {
                  }
                  await updateMenuItemDates(items);
                  await fetchPurchaseOrders({ silent: false });
                  return true;
                }
              } catch {
              }

              return false;
            };

            let lastReceiveErr: any = null;
            for (let attempt = 0; attempt < 3; attempt += 1) {
              const occurredAtIso = new Date(new Date(occurredAtIsoBase).getTime() + (attempt * 1100)).toISOString();
              const result = await tryReceive(occurredAtIso);
              if (!result.error) {
                await updateMenuItemDates(items);
                await fetchPurchaseOrders({ silent: false });
                return;
              }

              const msg = String((result.error as any)?.message || '');
              const code = String((result.error as any)?.code || '');
              const isDup = isUniqueViolation(result.error) || /^duplicate_constraint:/i.test(msg);

              if (isDup) {
                const recovered = await recoverFromDuplicate(orderId, occurredAtIso, result.idempotencyKey);
                if (recovered) return;
                if (/idx_purchase_receipts_grn_number_unique/i.test(msg) || /grn_number/i.test(msg)) {
                  lastReceiveErr = result.error as any;
                  continue;
                }
              }

              if (/RECEIPT_APPROVAL_REQUIRED/i.test(msg)) {
                const reqId = await ensureApprovalRequest(orderId, 'receipt', totalAmount);
                if (reqId) {
                  throw new Error('يتطلب الاستلام موافقة. تم إنشاء طلب موافقة للاستلام؛ يرجى اعتماده من قسم الموافقات ثم أعد المحاولة.');
                }
                throw new Error('يتطلب الاستلام موافقة. يرجى إنشاء/اعتماد طلب الموافقة من قسم الموافقات ثم إعادة المحاولة.');
              }
              if (/RECEIPT_APPROVAL_PENDING/i.test(msg)) {
                throw new Error('طلب موافقة الاستلام ما زال معلقًا. اعتمده من قسم الموافقات ثم أعد المحاولة.');
              }
              if (/purchase receipt requires approval/i.test(msg)) {
                const reqId = await ensureApprovalRequest(orderId, 'receipt', totalAmount);
                if (reqId) {
                  throw new Error('تم إنشاء طلب موافقة للاستلام. يرجى اعتماده من قسم الموافقات ثم أعد المحاولة.');
                } else {
                  throw new Error('يتطلب الاستلام موافقة. تعذر إنشاء طلب الموافقة تلقائياً؛ يرجى إنشائه من قسم الموافقات ثم إعادة المحاولة.');
                }
              }
              if (/accounting_documents/i.test(msg) && /branch_id/i.test(msg)) {
                throw new Error('تم حفظ أمر الشراء، لكن فشل استلام المخزون بسبب إعدادات الفرع/الشركة في المحاسبة. تأكد من ضبط فرع للمستودع أو إنشاء فرع افتراضي ثم أعد المحاولة.');
              }
              if (/schema cache|could not find the function|PGRST202/i.test(msg) || code === 'PGRST202') {
                const reloaded = await reloadPostgrestSchema();
                if (reloaded) {
                  const retry = await tryReceive(occurredAtIso);
                  if (!retry.error) {
                    await updateMenuItemDates(items);
                    await fetchPurchaseOrders({ silent: false });
                    return;
                  }
                  lastReceiveErr = retry.error as any;
                  continue;
                }
              }

              throw result.error as any;
            }

            if (lastReceiveErr) throw lastReceiveErr;
          }

          await fetchPurchaseOrders({ silent: false });
        } catch (err) {
          const localized = localizeSupabaseError(err);
          const anyErr = err as any;
          const rawMsg = typeof anyErr?.message === 'string' ? anyErr.message : '';
          const rawCode = typeof anyErr?.code === 'string' ? anyErr.code : '';
          if (import.meta.env.DEV && localized === 'الحقول المطلوبة ناقصة.' && rawMsg) {
            const extra = `${rawCode ? `${rawCode}: ` : ''}${rawMsg}`.trim();
            throw new Error(extra ? `${localized} (تفاصيل: ${extra})` : localized);
          }
          throw new Error(localized);
        }
    };

    const deletePurchaseOrder = async (purchaseOrderId: string) => {
        if (!supabase) throw new Error('Supabase غير مهيأ.');
        if (!user) throw new Error('لم يتم تسجيل الدخول.');
        try {
            setError(null);
            const { error } = await supabase.rpc('purge_purchase_order', { p_order_id: purchaseOrderId });
            if (error) throw error;
            await fetchPurchaseOrders({ silent: false });
        } catch (err) {
            throw new Error(localizeSupabaseError(err));
        }
    };

    const cancelPurchaseOrder = async (purchaseOrderId: string, reason?: string, occurredAt?: string) => {
        if (!supabase) throw new Error('Supabase غير مهيأ.');
        if (!user) throw new Error('لم يتم تسجيل الدخول.');
        try {
            setError(null);
            const { error } = await supabase.rpc('cancel_purchase_order', {
                p_order_id: purchaseOrderId,
                p_reason: reason && reason.trim().length ? reason.trim() : null,
                p_occurred_at: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString()
            });
            if (error) throw error;
            await fetchPurchaseOrders({ silent: false });
        } catch (err) {
            throw new Error(localizeSupabaseError(err));
        }
    };

    const recordPurchaseOrderPayment = async (
        purchaseOrderId: string,
        amount: number,
        method: string,
        occurredAt?: string,
        data?: Record<string, unknown>
    ): Promise<string> => {
        if (!supabase) throw new Error('Supabase غير مهيأ.');
        if (!user) throw new Error('لم يتم تسجيل الدخول.');
        try {
          const id = String(purchaseOrderId || '').trim();
          if (!id) throw new Error('معرف أمر الشراء غير صالح.');
          const numericAmount = Number(amount);
          if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('قيمة الدفعة غير صحيحة.');
          const methodValue = String(method || '').trim() || 'cash';
          const occurredAtIso = (() => {
            if (!occurredAt) return new Date().toISOString();
            const converted = toUtcIsoFromLocalDateTimeInput(occurredAt);
            if (converted) return converted;
            const parsed = new Date(String(occurredAt).trim());
            if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
            return parsed.toISOString();
          })();
          const payloadData = data && typeof data === 'object' ? data : {};
          const resolvedBase = (await getBaseCurrencyCode()) || '';
          if (!resolvedBase) throw new Error('العملة الأساسية غير محددة.');

          const { data: poRow, error: poErr } = await supabase
            .from('purchase_orders')
            .select('currency')
            .eq('id', id)
            .maybeSingle();
          if (poErr) throw poErr;
          const poCurrency = String((poRow as any)?.currency || '').toUpperCase() || resolvedBase;

          const argsWithData = {
            p_purchase_order_id: id,
            p_amount: numericAmount,
            p_method: methodValue,
            p_occurred_at: occurredAtIso,
            p_currency: poCurrency,
            p_data: payloadData,
          } as any;

          let { error } = await supabase.rpc('record_purchase_order_payment', argsWithData);
          if (error) {
            const msg = String((error as any)?.message || '');
            if (/schema cache|could not find the function|PGRST202/i.test(msg)) {
              const { error: retryErr } = await supabase.rpc('record_purchase_order_payment', {
                p_purchase_order_id: id,
                p_amount: numericAmount,
                p_method: methodValue,
                p_occurred_at: occurredAtIso,
                p_currency: poCurrency,
              } as any);
              if (retryErr) throw retryErr;
              error = null as any;
            }
          }
          if (error) throw error;
          await fetchPurchaseOrders();
          const idempotencyKey = typeof (payloadData as any)?.idempotencyKey === 'string'
            ? String((payloadData as any).idempotencyKey || '').trim()
            : (typeof (payloadData as any)?.idempotency_key === 'string' ? String((payloadData as any).idempotency_key || '').trim() : '');
          if (idempotencyKey) {
            const { data: p, error: qErr } = await supabase
              .from('payments')
              .select('id')
              .eq('reference_table', 'purchase_orders')
              .eq('reference_id', id)
              .eq('direction', 'out')
              .eq('idempotency_key', idempotencyKey)
              .order('occurred_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (!qErr && (p as any)?.id) return String((p as any).id);
          }
          const minIso = new Date(new Date(occurredAtIso).getTime() - 15_000).toISOString();
          const maxIso = new Date(new Date(occurredAtIso).getTime() + 15_000).toISOString();
          const { data: p2 } = await supabase
            .from('payments')
            .select('id,occurred_at,amount')
            .eq('reference_table', 'purchase_orders')
            .eq('reference_id', id)
            .eq('direction', 'out')
            .gte('occurred_at', minIso)
            .lte('occurred_at', maxIso)
            .order('occurred_at', { ascending: false })
            .limit(5);
          const best = (Array.isArray(p2) ? p2 : []).find((x: any) => Math.abs(Number(x?.amount || 0) - numericAmount) < 0.0001);
          return best?.id ? String(best.id) : '';
        } catch (err) {
          const anyErr = err as any;
          const localized = localizeSupabaseError(err);
          const code = typeof anyErr?.code === 'string' ? anyErr.code : '';
          const message = typeof anyErr?.message === 'string' ? anyErr.message : '';
          const details = typeof anyErr?.details === 'string' ? anyErr.details : '';
          const hint = typeof anyErr?.hint === 'string' ? anyErr.hint : '';
          if (import.meta.env.DEV && (code || details || hint) && localized) {
            const extra = [code, message, details, hint].map(s => String(s || '').trim()).filter(Boolean).join(' | ');
            throw new Error(extra ? `${localized} (${extra})` : localized);
          }
          throw new Error(localized);
        }
    };

    const receivePurchaseOrderPartial = async (
        purchaseOrderId: string,
        items: Array<{
          itemId: string;
          quantity: number;
          uomCode?: string;
          productionDate?: string;
          expiryDate?: string;
          transportCost?: number;
          supplyTaxCost?: number;
          importShipmentId?: string;
        }>,
        occurredAt?: string
    ): Promise<string> => {
        if (!supabase || !user) throw new Error('قاعدة البيانات غير متاحة.');
        try {
          const orderId = String(purchaseOrderId || '').trim();
          if (!isUuid(orderId)) throw new Error('معرف أمر الشراء غير صالح.');
          const occurredAtIso = occurredAt
            ? (toUtcIsoFromLocalDateTimeInput(occurredAt) || new Date(occurredAt).toISOString())
            : new Date().toISOString();
          const normalizedItems = (items || []).map((i) => {
            const itemId = String((i as any)?.itemId || '').trim();
            const qty = Number((i as any)?.quantity || 0);
            const uomCode = String((i as any)?.uomCode || '').trim().toLowerCase();
            const importShipmentIdRaw = String(
              (i as any)?.importShipmentId || (i as any)?.shipmentId || (i as any)?.import_shipment_id || ''
            ).trim();
            const importShipmentId = importShipmentIdRaw && isUuid(importShipmentIdRaw) ? importShipmentIdRaw : '';
            if (!itemId) throw new Error('معرّف الصنف غير صالح.');
            if (!Number.isFinite(qty) || qty <= 0) throw new Error('كمية الاستلام غير صالحة.');
            return {
              itemId,
              quantity: qty,
              uomCode: uomCode || null,
              harvestDate: toIsoDateOnlyOrNull((i as any)?.productionDate),
              expiryDate: toIsoDateOnlyOrNull((i as any)?.expiryDate),
              transportCost: (i as any).transportCost,
              supplyTaxCost: (i as any).supplyTaxCost,
              importShipmentId: importShipmentId || undefined,
            };
          });
          const mergedByKey = new Map<string, any>();
          for (const row of normalizedItems) {
            const key = `${String(row.itemId || '').trim()}::${String(row.uomCode || '')}`;
            if (!key) continue;
            const prev = mergedByKey.get(key);
            if (!prev) {
              mergedByKey.set(key, { ...row });
              continue;
            }
            prev.quantity = Number(prev.quantity || 0) + Number(row.quantity || 0);
            if (!prev.harvestDate && row.harvestDate) prev.harvestDate = row.harvestDate;
            if (!prev.expiryDate && row.expiryDate) prev.expiryDate = row.expiryDate;
            if (!prev.importShipmentId && row.importShipmentId) prev.importShipmentId = row.importShipmentId;
            const prevTransport = Number(prev.transportCost || 0);
            const rowTransport = Number(row.transportCost || 0);
            if (prevTransport === 0 && rowTransport !== 0) prev.transportCost = row.transportCost;
            const prevTax = Number(prev.supplyTaxCost || 0);
            const rowTax = Number(row.supplyTaxCost || 0);
            if (prevTax === 0 && rowTax !== 0) prev.supplyTaxCost = row.supplyTaxCost;
          }
          const mergedItems = Array.from(mergedByKey.values()).filter((r: any) => Number(r?.quantity || 0) > 0);
          if (mergedItems.length === 0) throw new Error('كمية الاستلام غير صالحة.');
          const buildIdempotencyPayload = () => {
            const parts = mergedItems
              .map((x: any) => [
                String(x.itemId || ''),
                String(Number(x.quantity || 0)),
                String(x.uomCode || ''),
                String(x.harvestDate || ''),
                String(x.expiryDate || ''),
                String(Number(x.transportCost || 0)),
                String(Number(x.supplyTaxCost || 0)),
                String(x.importShipmentId || ''),
              ].join(':'))
              .sort()
              .join('|');
            return `receive:${orderId}:${occurredAtIso}:${parts}`;
          };
          const computeIdempotencyKey = async () => {
            const raw = buildIdempotencyPayload();
            try {
              const anyCrypto: any = (globalThis as any)?.crypto;
              if (anyCrypto?.subtle?.digest) {
                const enc = new TextEncoder();
                const buf = await anyCrypto.subtle.digest('SHA-256', enc.encode(raw));
                const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
                return `rcv_${hex}`;
              }
            } catch {
            }
            return raw.length > 180 ? raw.slice(0, 180) : raw;
          };
          const idempotencyKey = await computeIdempotencyKey();
          const normalizedItemsWithIdempotency = mergedItems.map((x: any) => ({ ...x, idempotencyKey }));
          const { error: whErr } = await supabase.rpc('_resolve_default_warehouse_id');
          if (whErr) throw whErr;
          const args = {
            p_order_id: orderId,
            p_items: normalizedItemsWithIdempotency,
            p_occurred_at: occurredAtIso
          } as any;
          let { data, error } = await supabase.rpc('receive_purchase_order_partial', args);
          if (error) {
            const msg = String((error as any)?.message || '');
            const code = String((error as any)?.code || '');
            if (code === '23505' && /uq_purchase_receipts_idempotency/i.test(msg)) {
              const retry = await supabase.rpc('receive_purchase_order_partial', args);
              if (!retry.error) {
                await updateMenuItemDates(items);
                await fetchPurchaseOrders();
                return String(retry.data || '');
              }
              try {
                const { data: existing, error: existingErr } = await supabase
                  .from('purchase_receipts')
                  .select('id')
                  .eq('purchase_order_id', orderId)
                  .eq('idempotency_key', idempotencyKey)
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                if (!existingErr && existing?.id) {
                  try {
                    const repairRes = await supabase.rpc('repair_purchase_receipt_stock', { p_receipt_id: existing.id } as any);
                    const repairMsg = String((repairRes as any)?.error?.message || '');
                    if (/schema cache|could not find the function|PGRST202/i.test(repairMsg)) {
                      await reloadPostgrestSchema();
                    }
                  } catch {
                  }
                  try {
                    await supabase.rpc('reconcile_purchase_order_receipt_status', { p_order_id: orderId } as any);
                  } catch {
                  }
                  await updateMenuItemDates(items);
                  await fetchPurchaseOrders();
                  return String(existing.id || '');
                }
              } catch {
              }
              error = retry.error as any;
            }
            if (isUniqueViolation(error)) {
              try {
                const minIso = new Date(new Date(occurredAtIso).getTime() - 60_000).toISOString();
                const maxIso = new Date(new Date(occurredAtIso).getTime() + 60_000).toISOString();
                const { data: recent, error: recentErr } = await supabase
                  .from('purchase_receipts')
                  .select('id,received_at')
                  .eq('purchase_order_id', orderId)
                  .gte('received_at', minIso)
                  .lte('received_at', maxIso)
                  .order('received_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                if (!recentErr && recent?.id) {
                  try {
                    const repairRes = await supabase.rpc('repair_purchase_receipt_stock', { p_receipt_id: recent.id } as any);
                    const repairMsg = String((repairRes as any)?.error?.message || '');
                    if (/schema cache|could not find the function|PGRST202/i.test(repairMsg)) {
                      await reloadPostgrestSchema();
                    }
                  } catch {
                  }
                  try {
                    await supabase.rpc('reconcile_purchase_order_receipt_status', { p_order_id: orderId } as any);
                  } catch {
                  }
                  await updateMenuItemDates(items);
                  await fetchPurchaseOrders();
                  return String(recent.id || '');
                }
              } catch {
              }
            }
            if (/RECEIPT_APPROVAL_REQUIRED/i.test(msg)) {
              const { data: poRow } = await supabase
                .from('purchase_orders')
                .select('total_amount')
                .eq('id', purchaseOrderId)
                .maybeSingle();
              const amt = Number((poRow as any)?.total_amount || 0);
              const reqId = await ensureApprovalRequest(purchaseOrderId, 'receipt', amt);
              if (reqId) {
                throw new Error('يتطلب الاستلام موافقة. تم إنشاء طلب موافقة للاستلام؛ يرجى اعتماده من قسم الموافقات ثم أعد المحاولة.');
              }
              throw new Error('يتطلب الاستلام موافقة. يرجى إنشاء/اعتماد طلب الموافقة من قسم الموافقات ثم إعادة المحاولة.');
            }
            if (/RECEIPT_APPROVAL_PENDING/i.test(msg)) {
              throw new Error('طلب موافقة الاستلام ما زال معلقًا. اعتمده من قسم الموافقات ثم أعد المحاولة.');
            }
            if (/purchase receipt requires approval/i.test(msg)) {
              const { data: poRow } = await supabase
                .from('purchase_orders')
                .select('total_amount')
                .eq('id', purchaseOrderId)
                .maybeSingle();
              const amt = Number((poRow as any)?.total_amount || 0);
              const reqId = await ensureApprovalRequest(purchaseOrderId, 'receipt', amt);
              if (reqId) {
                throw new Error('يتطلب الاستلام موافقة. تم إنشاء طلب الموافقة، يرجى الاعتماد ثم إعادة المحاولة.');
              } else {
                throw new Error('يتطلب الاستلام موافقة. تعذر إنشاء طلب الموافقة تلقائياً؛ يرجى إنشائه من قسم الموافقات ثم إعادة المحاولة.');
              }
            }
            if (/schema cache|could not find the function|PGRST202/i.test(msg)) {
              const reloaded = await reloadPostgrestSchema();
              if (reloaded) {
                const retry = await supabase.rpc('receive_purchase_order_partial', args);
                if (!retry.error) {
                  await updateMenuItemDates(items);
                  await fetchPurchaseOrders();
                  return String(retry.data || '');
                }
                error = retry.error as any;
              }
            }
            if (/received exceeds ordered/i.test(msg)) {
              throw new Error('كمية الاستلام تجاوزت الكمية المطلوبة لبعض الأصناف. حدّث الصفحة وأعد المحاولة.');
            }
            if (/immutable record/i.test(msg)) {
              throw new Error('تعذر استلام أمر الشراء بسبب محاولة تعديل قيود محاسبية مُقفلة. غالبًا توجد عملية سابقة أعادت ترحيل/تعديل نفس القيد. الحل يكون عبر إجراء عكسي (Reversal) بدل التعديل، أو تحديث منطق الترحيل بقاعدة البيانات.');
            }
            throw error;
          }
          await updateMenuItemDates(items);
          await fetchPurchaseOrders();
          return String(data || '');
        } catch (err) {
          throw new Error(localizeSupabaseError(err));
        }
    };

    const createPurchaseReturn = async (
        purchaseOrderId: string,
        items: Array<{ itemId: string; quantity: number }>,
        reason?: string,
        occurredAt?: string
    ) => {
        if (!supabase) throw new Error('Supabase غير مهيأ.');
        try {
          const trimmedOrderId = String(purchaseOrderId || '').trim();
          if (!trimmedOrderId) throw new Error('معرف أمر الشراء غير صالح.');

          const occurredIso = (() => {
            if (!occurredAt) return new Date().toISOString();
            const parsed = new Date(String(occurredAt || '').trim());
            if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
            const now = new Date();
            if (parsed.getSeconds() === 0 && parsed.getMilliseconds() === 0) {
              parsed.setSeconds(now.getSeconds(), now.getMilliseconds());
            }
            return parsed.toISOString();
          })();

          const mergedByItemId = new Map<string, number>();
          for (const row of items || []) {
            const itemId = String((row as any)?.itemId || '').trim();
            const qty = Number((row as any)?.quantity || 0);
            if (!itemId || !(qty > 0)) continue;
            mergedByItemId.set(itemId, (mergedByItemId.get(itemId) || 0) + qty);
          }
          const mergedItems = Array.from(mergedByItemId.entries()).map(([itemId, quantity]) => ({ itemId, quantity }));
          if (mergedItems.length === 0) throw new Error('الرجاء إدخال كمية للمرتجع.');

          const { data: authData } = await supabase.auth.getUser();
          const authUserId = typeof authData?.user?.id === 'string' ? authData.user.id : null;

          const { data, error } = await supabase.rpc('create_purchase_return', {
            p_order_id: trimmedOrderId,
            p_items: mergedItems,
            p_reason: reason || null,
            p_occurred_at: occurredIso,
          });
          if (error) throw error;

          let returnId = typeof data === 'string' ? data : '';
          if (!returnId && authUserId) {
            const occurred = new Date(occurredIso);
            const minIso = new Date(occurred.getTime() - 10_000).toISOString();
            const maxIso = new Date(occurred.getTime() + 10_000).toISOString();
            const { data: row, error: findErr } = await supabase
              .from('purchase_returns')
              .select('id')
              .eq('purchase_order_id', trimmedOrderId)
              .eq('created_by', authUserId)
              .gte('returned_at', minIso)
              .lte('returned_at', maxIso)
              .order('returned_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (findErr) throw findErr;
            returnId = typeof (row as any)?.id === 'string' ? String((row as any).id) : '';
          }

          if (!returnId) throw new Error('تم تنفيذ العملية بدون إرجاع رقم المرتجع. يرجى تحديث دالة create_purchase_return في قاعدة البيانات.');

          const { data: returnItems, error: itemsErr } = await supabase
            .from('purchase_return_items')
            .select('id')
            .eq('return_id', returnId)
            .limit(1);
          if (itemsErr) throw itemsErr;
          if (!Array.isArray(returnItems) || returnItems.length === 0) {
            throw new Error('لم يتم إنشاء بنود المرتجع فعلياً. يرجى مراجعة صلاحيات قاعدة البيانات ودالة المرتجع.');
          }

          const { data: movements, error: mvErr } = await supabase
            .from('inventory_movements')
            .select('id')
            .eq('reference_table', 'purchase_returns')
            .eq('reference_id', returnId)
            .limit(1);
          if (mvErr) throw mvErr;
          if (!Array.isArray(movements) || movements.length === 0) {
            throw new Error('لم يتم إنشاء حركة مخزون للمرتجع. يرجى مراجعة دالة post_inventory_movement.');
          }

          await fetchPurchaseOrders();
        } catch (err) {
          const anyErr = err as any;
          const localized = localizeSupabaseError(err);
          const code = typeof anyErr?.code === 'string' ? anyErr.code : '';
          const message = typeof anyErr?.message === 'string' ? anyErr.message : '';
          const details = typeof anyErr?.details === 'string' ? anyErr.details : '';
          const hint = typeof anyErr?.hint === 'string' ? anyErr.hint : '';
          if (import.meta.env.DEV && (code || details || hint) && localized) {
            const extra = [code, message, details, hint].map(s => String(s || '').trim()).filter(Boolean).join(' | ');
            throw new Error(extra ? `${localized} (${extra})` : localized);
          }
          throw new Error(localized);
        }
    };

    const updatePurchaseOrderInvoiceNumber = async (purchaseOrderId: string, invoiceNumber: string | null) => {
        if (!supabase) throw new Error('Supabase غير مهيأ.');
        if (!user) throw new Error('لم يتم تسجيل الدخول.');
        const orderId = String(purchaseOrderId || '').trim();
        if (!orderId) throw new Error('معرف أمر الشراء غير صالح.');
        const normalized = typeof invoiceNumber === 'string' ? invoiceNumber.trim() : '';
        const nextValue = normalized.length ? normalized : null;
        try {
            setError(null);
            if (nextValue) {
                const { data: existing, error: refErr } = await supabase
                    .from('purchase_orders')
                    .select('id')
                    .eq('reference_number', nextValue)
                    .limit(1)
                    .maybeSingle();
                if (refErr) throw refErr;
                if (existing?.id && String(existing.id) !== orderId) {
                    throw new Error('رقم فاتورة المورد مستخدم بالفعل.');
                }
            }

            const { error } = await supabase
                .from('purchase_orders')
                .update({ reference_number: nextValue })
                .eq('id', orderId);
            if (error) throw error;
            await fetchPurchaseOrders({ silent: true });
        } catch (err) {
            throw new Error(localizeSupabaseError(err));
        }
    };

    const getPurchaseReturnSummary = async (purchaseOrderId: string): Promise<Record<string, number>> => {
        const summary: Record<string, number> = {};
        if (!supabase) return summary;
        try {
            const { data: returns, error: rErr } = await supabase
                .from('purchase_returns')
                .select('id')
                .eq('purchase_order_id', purchaseOrderId);
            if (rErr) throw rErr;
            const ids = (returns || []).map((r: any) => r?.id).filter(Boolean);
            if (ids.length === 0) return summary;
            const { data: items, error: iErr } = await supabase
                .from('purchase_return_items')
                .select('item_id, quantity, return_id')
                .in('return_id', ids);
            if (iErr) throw iErr;
            for (const row of items || []) {
                const key = String((row as any)?.item_id || '');
                const qty = Number((row as any)?.quantity) || 0;
                if (!key) continue;
                summary[key] = (summary[key] || 0) + qty;
            }
        } catch (err) {
            // Return empty summary on error; UI will still be capped by server
        }
        return summary;
    };

    return (
        <PurchasesContext.Provider value={{
            suppliers,
            purchaseOrders,
            loading,
            error,
            addSupplier,
            updateSupplier,
            deleteSupplier,
            createPurchaseOrder,
            deletePurchaseOrder,
            cancelPurchaseOrder,
            recordPurchaseOrderPayment,
            receivePurchaseOrderPartial,
            createPurchaseReturn,
            updatePurchaseOrderInvoiceNumber,
            getPurchaseReturnSummary,
            fetchPurchaseOrders
        }}>
            {children}
        </PurchasesContext.Provider>
    );
};

export const usePurchases = () => {
    const context = useContext(PurchasesContext);
    if (context === undefined) {
        throw new Error('usePurchases must be used within a PurchasesProvider');
    }
    return context;
};
