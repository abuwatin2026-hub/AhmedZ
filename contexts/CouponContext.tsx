
import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Coupon } from '../types';
import { getSupabaseClient } from '../supabase';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';

interface CouponContextType {
  coupons: Coupon[];
  validateCoupon: (code: string) => Coupon | null;
  addCoupon: (coupon: Omit<Coupon, 'id'>) => Promise<void>;
  updateCoupon: (coupon: Coupon) => Promise<void>;
  deleteCoupon: (couponId: string) => Promise<void>;
  incrementCouponUsage: (couponId: string) => Promise<void>;
}

const CouponContext = createContext<CouponContextType | undefined>(undefined);

export const CouponProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [coupons, setCoupons] = useState<Coupon[]>([]);

  const fetchCoupons = useCallback(async () => {
    try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          setCoupons([]);
          return;
        }
        const { data: rows, error: rowsError } = await supabase.from('coupons').select('id,data');
        if (rowsError) throw rowsError;
        const list = (rows || []).map(row => row.data as Coupon).filter(Boolean);
        setCoupons(list);
    } catch (error) {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline || isAbortLikeError(error)) return;
        const msg = localizeSupabaseError(error);
        if (msg && import.meta.env.DEV) console.error(msg);
    }
  }, []);

  useEffect(() => {
    fetchCoupons();
  }, [fetchCoupons]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const scheduleRefetch = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchCoupons();
    };

    const onFocus = () => scheduleRefetch();
    const onVisibility = () => scheduleRefetch();
    const onOnline = () => scheduleRefetch();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      window.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('online', onOnline);
    }

    const intervalId = typeof window !== 'undefined'
      ? window.setInterval(() => scheduleRefetch(), 30000)
      : undefined;

    const channel = supabase
      .channel('public:coupons')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coupons' }, async () => {
        await fetchCoupons();
      })
      .subscribe();
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('online', onOnline);
        if (typeof intervalId === 'number') window.clearInterval(intervalId);
      }
      supabase.removeChannel(channel);
    };
  }, [fetchCoupons]);


  const validateCoupon = (code: string): Coupon | null => {
    if (!code) return null;
    const coupon = coupons.find(c => c.code.toUpperCase() === code.toUpperCase());
    
    if (!coupon) return null;

    // Check if active
    if (!coupon.isActive) return null;

    // Check expiry
    if (coupon.expiresAt) {
      const now = new Date();
      const expiry = new Date(coupon.expiresAt);
      if (now > expiry) return null;
    }

    // Check usage limit
    if (coupon.usageLimit && (coupon.usageCount || 0) >= coupon.usageLimit) {
      return null;
    }

    return coupon;
  };

  const incrementCouponUsage = async (couponId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    
    // We need to implement atomic increment ideally, but for now we update JSONB
    // Since coupon data is inside a JSONB column 'data', we need a more complex update or RPC.
    // For MVP, we will fetch, increment in memory, and update.
    // Warning: This is not race-condition safe.
    
    const coupon = coupons.find(c => c.id === couponId);
    if (!coupon) return;

    const updatedCoupon = {
        ...coupon,
        usageCount: (coupon.usageCount || 0) + 1
    };

    await updateCoupon(updatedCoupon);
  };
  
  const addCoupon = async (couponData: Omit<Coupon, 'id'>) => {
    const newCoupon = { ...couponData, id: crypto.randomUUID() };
    const supabase = getSupabaseClient();
    if (supabase) {
        try {
          const { error } = await supabase.from('coupons').insert({
            id: newCoupon.id,
            code: newCoupon.code,
            is_active: true,
            data: newCoupon,
          });
          if (error) throw error;
        } catch (err) {
          throw new Error(localizeSupabaseError(err));
        }
    } else {
        throw new Error('Supabase غير مهيأ.');
    }
    await fetchCoupons();
  };
  
  const updateCoupon = async (updatedCoupon: Coupon) => {
    const supabase = getSupabaseClient();
    if (supabase) {
        try {
          const { error } = await supabase.from('coupons').upsert(
            {
              id: updatedCoupon.id,
              code: updatedCoupon.code,
              is_active: true,
              data: updatedCoupon,
            },
            { onConflict: 'id' }
          );
          if (error) throw error;
        } catch (err) {
          throw new Error(localizeSupabaseError(err));
        }
    } else {
        throw new Error('Supabase غير مهيأ.');
    }
    await fetchCoupons();
  };

  const deleteCoupon = async (couponId: string) => {
    const supabase = getSupabaseClient();
    if (supabase) {
        try {
          const { error } = await supabase.from('coupons').delete().eq('id', couponId);
          if (error) throw error;
        } catch (err) {
          throw new Error(localizeSupabaseError(err));
        }
    } else {
        throw new Error('Supabase غير مهيأ.');
    }
    await fetchCoupons();
  };


  return (
    <CouponContext.Provider value={{ coupons, validateCoupon, addCoupon, updateCoupon, deleteCoupon, incrementCouponUsage }}>
      {children}
    </CouponContext.Provider>
  );
};

export const useCoupons = () => {
  const context = useContext(CouponContext);
  if (context === undefined) {
    throw new Error('useCoupons must be used within a CouponProvider');
  }
  return context;
};
