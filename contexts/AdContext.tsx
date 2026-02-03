import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import type { Ad } from '../types';
import { disableRealtime, getSupabaseClient, isRealtimeEnabled } from '../supabase';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';

interface AdContextType {
  ads: Ad[];
  loading: boolean;
  fetchAds: () => Promise<void>;
  addAd: (ad: Omit<Ad, 'id' | 'order'>) => Promise<void>;
  updateAd: (ad: Ad) => Promise<void>;
  deleteAd: (adId: string) => Promise<void>;
}

const AdContext = createContext<AdContextType | undefined>(undefined);


export const AdProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchAds = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setAds([]);
        return;
      }
      const { data: rows, error: rowsError } = await supabase.from('ads').select('id,data');
      if (rowsError) throw new Error(localizeSupabaseError(rowsError));
      const list = (rows || []).map(row => row.data as Ad).filter(Boolean);
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setAds(list);
    } catch (error) {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline || isAbortLikeError(error)) return;
        const msg = localizeSupabaseError(error);
        if (msg && import.meta.env.DEV) console.error(msg);
    } finally {
        setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAds();
  }, [fetchAds]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const scheduleRefetch = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchAds();
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

    if (!isRealtimeEnabled()) {
      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('focus', onFocus);
          window.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('online', onOnline);
          if (typeof intervalId === 'number') window.clearInterval(intervalId);
        }
      };
    }

    const channel = supabase
      .channel('public:ads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ads' }, () => {
        void fetchAds();
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
        if (typeof intervalId === 'number') window.clearInterval(intervalId);
      }
      supabase.removeChannel(channel);
    };
  }, [fetchAds]);

  const addAd = async (adData: Omit<Ad, 'id' | 'order'>) => {
    const highestOrder = ads.reduce((max, ad) => Math.max(max, ad.order), -1);
    const newAd = { 
        ...adData, 
        id: crypto.randomUUID(), 
        order: highestOrder + 1 
    };
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('ads').insert({
        id: newAd.id,
        status: newAd.status,
        display_order: Number.isFinite(newAd.order) ? newAd.order : 0,
        data: newAd,
      });
      if (error) throw new Error(localizeSupabaseError(error));
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchAds();
  };

  const updateAd = async (updatedAd: Ad) => {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('ads').upsert(
        {
          id: updatedAd.id,
          status: updatedAd.status,
          display_order: Number.isFinite(updatedAd.order) ? updatedAd.order : 0,
          data: updatedAd,
        },
        { onConflict: 'id' }
      );
      if (error) throw new Error(localizeSupabaseError(error));
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchAds();
  };

  const deleteAd = async (adId: string) => {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('ads').delete().eq('id', adId);
      if (error) throw new Error(localizeSupabaseError(error));
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchAds();
  };
  
  return (
    <AdContext.Provider value={{ ads, loading, fetchAds, addAd, updateAd, deleteAd }}>
      {children}
    </AdContext.Provider>
  );
};

export const useAds = () => {
  const context = useContext(AdContext);
  if (context === undefined) {
    throw new Error('useAds must be used within an AdProvider');
  }
  return context;
};
