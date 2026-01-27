import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '../supabase';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';
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
        items: Array<{ itemId: string; quantity: number; unitCost: number; productionDate?: string; expiryDate?: string }>,
        receiveNow?: boolean,
        referenceNumber?: string
    ) => Promise<void>;
    deletePurchaseOrder: (purchaseOrderId: string) => Promise<void>;
    cancelPurchaseOrder: (purchaseOrderId: string, reason?: string, occurredAt?: string) => Promise<void>;
    recordPurchaseOrderPayment: (
        purchaseOrderId: string,
        amount: number,
        method: string,
        occurredAt?: string,
        data?: Record<string, unknown>
    ) => Promise<void>;
    receivePurchaseOrderPartial: (
        purchaseOrderId: string,
        items: Array<{ itemId: string; quantity: number; productionDate?: string; expiryDate?: string }>,
        occurredAt?: string
    ) => Promise<void>;
    createPurchaseReturn: (
        purchaseOrderId: string,
        items: Array<{ itemId: string; quantity: number }>,
        reason?: string,
        occurredAt?: string
    ) => Promise<void>;
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
    return msg.includes('duplicate') || msg.includes('unique');
  };

  const normalizeUomCode = (value: unknown) => {
    const v = String(value ?? '').trim();
    return v.length ? v : 'piece';
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
                referenceNumber: order.reference_number ?? order.referenceNumber,
                totalAmount: Number(order.total_amount ?? order.totalAmount ?? 0),
                paidAmount: Number(order.paid_amount ?? order.paidAmount ?? 0),
                purchaseDate: order.purchase_date ?? order.purchaseDate,
                itemsCount: Number(order.items_count ?? order.itemsCount ?? order.items?.length ?? 0),
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
                    receivedQuantity: Number(item.received_quantity ?? item.receivedQuantity ?? 0),
                    unitCost: Number(item.unit_cost ?? item.unitCost ?? 0),
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

    const channel = supabase
      .channel('public:purchases')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, async () => {
        await fetchSuppliers({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders' }, async () => {
        await fetchPurchaseOrders({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_items' }, async () => {
        await fetchPurchaseOrders({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_returns' }, async () => {
        await fetchPurchaseOrders({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_return_items' }, async () => {
        await fetchPurchaseOrders({ silent: true });
      })
      .subscribe();

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
        items: Array<{ itemId: string; quantity: number; unitCost: number; productionDate?: string; expiryDate?: string }>,
        receiveNow: boolean = true,
        referenceNumber?: string
    ) => {
        if (!supabase) throw new Error('Supabase غير مهيأ.');
        if (!user) throw new Error('لم يتم تسجيل الدخول.');

        const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
        const itemsCount = items.length;
        const normalizedDate = (() => {
          const d = new Date(purchaseDate);
          if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
          return d.toISOString().slice(0, 10);
        })();

        try {
          setError(null);
          const providedRef = typeof referenceNumber === 'string' ? referenceNumber.trim() : '';
          if (!providedRef) {
            throw new Error('رقم فاتورة المورد مطلوب.');
          }

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
          const uniqueItemIds = Array.from(new Set(items.map(i => String(i.itemId || '').trim()).filter(Boolean)));
          await Promise.all(uniqueItemIds.map(async (id) => ensureItemUomRow(id)));
          if (receiveNow) {
            const { error: whErr } = await supabase.rpc('_resolve_default_warehouse_id');
            if (whErr) throw whErr;
          }

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
                  reference_number: currentRef,
                  total_amount: totalAmount,
                  items_count: itemsCount,
                  created_by: user.id,
                  status: 'draft',
                  warehouse_id: scopeWarehouseId,
                  branch_id: scopeBranchId ?? undefined,
                  company_id: scopeCompanyId ?? undefined,
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

          const purchaseItems = items.map(item => ({
              purchase_order_id: orderId,
              item_id: item.itemId,
              quantity: item.quantity,
              unit_cost: item.unitCost,
              total_cost: item.quantity * item.unitCost
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
              const { error: receiveError } = await supabase.rpc('receive_purchase_order_partial', {
                  p_order_id: orderId,
                  p_items: items.map(i => ({
                      itemId: i.itemId,
                      quantity: i.quantity,
                      harvestDate: i.productionDate,
                      expiryDate: i.expiryDate
                  })),
                  p_occurred_at: new Date(`${normalizedDate}T00:00:00.000Z`).toISOString()
              });
              if (receiveError) throw receiveError;
              await updateMenuItemDates(items);
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
    ) => {
        if (!supabase || !user) return;
        try {
          const payloadData = data && typeof data === 'object' ? data : undefined;
          const { error } = await supabase.rpc('record_purchase_order_payment', {
              p_purchase_order_id: purchaseOrderId,
              p_amount: amount,
              p_method: method,
              p_occurred_at: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
              p_data: payloadData ?? {}
          });
          if (error) throw error;
          await fetchPurchaseOrders();
        } catch (err) {
          throw new Error(localizeSupabaseError(err));
        }
    };

    const receivePurchaseOrderPartial = async (
        purchaseOrderId: string,
        items: Array<{ itemId: string; quantity: number; productionDate?: string; expiryDate?: string }>,
        occurredAt?: string
    ) => {
        if (!supabase || !user) return;
        try {
          const { error: whErr } = await supabase.rpc('_resolve_default_warehouse_id');
          if (whErr) throw whErr;
          const { error } = await supabase.rpc('receive_purchase_order_partial', {
              p_order_id: purchaseOrderId,
              p_items: items.map(i => ({
                  itemId: i.itemId,
                  quantity: i.quantity,
                  harvestDate: i.productionDate,
                  expiryDate: i.expiryDate
              })),
              p_occurred_at: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString()
          });
          if (error) throw error;
          await updateMenuItemDates(items);
          await fetchPurchaseOrders();
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
        if (!supabase || !user) return;
        try {
          const { error } = await supabase.rpc('create_purchase_return', {
              p_order_id: purchaseOrderId,
              p_items: items,
              p_reason: reason || null,
              p_occurred_at: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString()
          });
          if (error) throw error;
          await fetchPurchaseOrders();
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
