import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Promotion, PromotionApplicationSnapshot, PromotionItem } from '../types';
import { getSupabaseClient } from '../supabase';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';

type UpsertPromotionInput = Omit<Promotion, 'id'> & { id?: string };

interface PromotionContextType {
  activePromotions: PromotionApplicationSnapshot[];
  refreshActivePromotions: (opts?: { customerId?: string | null; warehouseId?: string | null }) => Promise<void>;
  applyPromotionToCart: (input: { promotionId: string; bundleQty: number; customerId?: string | null; warehouseId?: string | null; couponCode?: string | null }) => Promise<PromotionApplicationSnapshot>;
  adminPromotions: Promotion[];
  refreshAdminPromotions: () => Promise<void>;
  savePromotion: (input: { promotion: UpsertPromotionInput; items: PromotionItem[]; activate?: boolean }) => Promise<{ promotionId: string; approvalRequestId?: string | null; approvalStatus?: string; isActive?: boolean }>;
  deactivatePromotion: (promotionId: string) => Promise<void>;
}

const PromotionContext = createContext<PromotionContextType | undefined>(undefined);

export const PromotionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activePromotions, setActivePromotions] = useState<PromotionApplicationSnapshot[]>([]);
  const [adminPromotions, setAdminPromotions] = useState<Promotion[]>([]);

  const refreshActivePromotions = useCallback(async (opts?: { customerId?: string | null; warehouseId?: string | null }) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setActivePromotions([]);
        return;
      }

      const { data, error } = await supabase.rpc('get_active_promotions', {
        p_customer_id: opts?.customerId ?? null,
        p_warehouse_id: opts?.warehouseId ?? null,
      });
      if (error) throw error;
      setActivePromotions((Array.isArray(data) ? data : []) as PromotionApplicationSnapshot[]);
    } catch (err) {
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isOffline || isAbortLikeError(err)) return;
      const raw = String((err as any)?.message || '').toLowerCase().trim();
      if (raw.includes('not authenticated') || raw.includes('invalid jwt') || raw.includes('jwt')) {
        setActivePromotions([]);
        return;
      }
      const msg = localizeSupabaseError(err);
      if (msg && import.meta.env.DEV) console.error(msg);
    }
  }, []);

  const applyPromotionToCart = useCallback(async (input: { promotionId: string; bundleQty: number; customerId?: string | null; warehouseId?: string | null; couponCode?: string | null }) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('قاعدة البيانات غير متاحة');

    const payload = {
      customerId: input.customerId ?? null,
      warehouseId: input.warehouseId ?? null,
      bundleQty: Number(input.bundleQty) || 1,
      couponCode: input.couponCode ?? null,
    };
    const { data, error } = await supabase.rpc('apply_promotion_to_cart', {
      p_cart_payload: payload,
      p_promotion_id: input.promotionId,
    });
    if (error) throw new Error(localizeSupabaseError(error));
    return data as PromotionApplicationSnapshot;
  }, []);

  const refreshAdminPromotions = useCallback(async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setAdminPromotions([]);
        return;
      }

      const { data, error } = await supabase.rpc('get_promotions_admin');
      if (error) throw error;
      const list = (Array.isArray(data) ? data : []) as any[];
      setAdminPromotions(list.map((row) => ({
        id: String(row.id),
        name: String(row.name || ''),
        imageUrl: typeof row.image_url === 'string' ? row.image_url : (row.data?.imageUrl || undefined),
        startAt: String(row.start_at || row.startAt || ''),
        endAt: String(row.end_at || row.endAt || ''),
        isActive: Boolean(row.is_active ?? row.isActive),
        discountMode: (row.discount_mode ?? row.discountMode) as any,
        fixedTotal: row.fixed_total ?? row.fixedTotal ?? undefined,
        percentOff: row.percent_off ?? row.percentOff ?? undefined,
        displayOriginalTotal: row.display_original_total ?? row.displayOriginalTotal ?? undefined,
        maxUses: row.max_uses ?? row.maxUses ?? undefined,
        exclusiveWithCoupon: Boolean(row.exclusive_with_coupon ?? row.exclusiveWithCoupon ?? true),
        requiresApproval: Boolean(row.requires_approval ?? row.requiresApproval ?? false),
        approvalStatus: (row.approval_status ?? row.approvalStatus) as any,
        approvalRequestId: row.approval_request_id ?? row.approvalRequestId ?? null,
        items: (Array.isArray(row.items) ? row.items : []).map((it: any) => ({
          id: it.id ?? undefined,
          itemId: String(it.itemId ?? it.item_id ?? ''),
          quantity: Number(it.quantity) || 0,
          sortOrder: typeof it.sortOrder === 'number' ? it.sortOrder : (typeof it.sort_order === 'number' ? it.sort_order : undefined),
        })),
      })));
    } catch (err) {
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isOffline || isAbortLikeError(err)) return;
      const raw = String((err as any)?.message || '').toLowerCase().trim();
      if (raw.includes('not authenticated') || raw.includes('invalid jwt') || raw.includes('jwt')) {
        setAdminPromotions([]);
        return;
      }
      const msg = localizeSupabaseError(err);
      if (msg && import.meta.env.DEV) console.error(msg);
    }
  }, []);

  const savePromotion = useCallback(async (input: { promotion: UpsertPromotionInput; items: PromotionItem[]; activate?: boolean }) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('قاعدة البيانات غير متاحة');

    const { data, error } = await supabase.rpc('upsert_promotion', {
      p_promotion: {
        id: input.promotion.id ?? null,
        name: input.promotion.name,
        imageUrl: (input.promotion as any).imageUrl ?? null,
        startAt: input.promotion.startAt,
        endAt: input.promotion.endAt,
        discountMode: input.promotion.discountMode,
        fixedTotal: input.promotion.fixedTotal ?? null,
        percentOff: input.promotion.percentOff ?? null,
        displayOriginalTotal: input.promotion.displayOriginalTotal ?? null,
        maxUses: input.promotion.maxUses ?? null,
        exclusiveWithCoupon: input.promotion.exclusiveWithCoupon ?? true,
        data: {
          ...(typeof (input.promotion as any).data === 'object' ? (input.promotion as any).data : {}),
          imageUrl: (input.promotion as any).imageUrl ?? undefined,
        },
      },
      p_items: input.items.map((it) => ({
        itemId: it.itemId,
        quantity: it.quantity,
        sortOrder: it.sortOrder ?? 0,
      })),
      p_activate: Boolean(input.activate),
    });
    if (error) throw new Error(localizeSupabaseError(error));
    await refreshAdminPromotions();
    return {
      promotionId: String((data as any)?.promotionId || ''),
      approvalRequestId: (data as any)?.approvalRequestId ?? null,
      approvalStatus: (data as any)?.approvalStatus,
      isActive: (data as any)?.isActive,
    };
  }, [refreshAdminPromotions]);

  const deactivatePromotion = useCallback(async (promotionId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('قاعدة البيانات غير متاحة');
    const { error } = await supabase.rpc('deactivate_promotion', { p_promotion_id: promotionId });
    if (error) throw new Error(localizeSupabaseError(error));
    await refreshAdminPromotions();
  }, [refreshAdminPromotions]);

  useEffect(() => {
    void refreshActivePromotions();
  }, [refreshActivePromotions]);

  const value = useMemo<PromotionContextType>(() => ({
    activePromotions,
    refreshActivePromotions,
    applyPromotionToCart,
    adminPromotions,
    refreshAdminPromotions,
    savePromotion,
    deactivatePromotion,
  }), [activePromotions, refreshActivePromotions, applyPromotionToCart, adminPromotions, refreshAdminPromotions, savePromotion, deactivatePromotion]);

  return <PromotionContext.Provider value={value}>{children}</PromotionContext.Provider>;
};

export const usePromotions = () => {
  const context = useContext(PromotionContext);
  if (!context) throw new Error('usePromotions must be used within PromotionProvider');
  return context;
};

