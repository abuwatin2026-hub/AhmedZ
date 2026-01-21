
import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import type { Addon } from '../types';
import { getSupabaseClient } from '../supabase';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';

interface AddonContextType {
  addons: Addon[];
  addAddon: (addon: Omit<Addon, 'id'>) => Promise<void>;
  updateAddon: (addon: Addon) => Promise<void>;
  deleteAddon: (addonId: string) => Promise<void>;
  fetchAddons: () => Promise<void>;
}

const AddonContext = createContext<AddonContextType | undefined>(undefined);

export const AddonProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [addons, setAddons] = useState<Addon[]>([]);

  const getAddonNameText = (addon: Addon | Omit<Addon, 'id'>) => {
    const name = (addon as any)?.name;
    if (name && typeof name === 'object') {
      const ar = typeof name.ar === 'string' ? name.ar : '';
      const en = typeof name.en === 'string' ? name.en : '';
      return ar || en || '';
    }
    return '';
  };

  const fetchAddons = useCallback(async () => {
    try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          setAddons([]);
          return;
        }
        const { data: rows, error: rowsError } = await supabase.from('addons').select('id,data');
        if (rowsError) throw rowsError;

        const list = (rows || []).map(row => row.data as Addon).filter(Boolean);
        setAddons(list);
    } catch(error) {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline || isAbortLikeError(error)) return;
        const msg = localizeSupabaseError(error);
        if (msg && import.meta.env.DEV) console.error(msg);
    }
  }, []);

  useEffect(() => {
    fetchAddons();
  }, [fetchAddons]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const scheduleRefetch = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchAddons();
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
      .channel('public:addons')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'addons' }, async () => {
        await fetchAddons();
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
  }, [fetchAddons]);

  const addAddon = async (addonData: Omit<Addon, 'id'>) => {
    const newAddon = { ...addonData, id: crypto.randomUUID() };
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error } = await supabase.from('addons').insert({
          id: newAddon.id,
          name: getAddonNameText(newAddon),
          is_active: true,
          data: newAddon,
        });
        if (error) throw error;
      } catch (err) {
        throw new Error(localizeSupabaseError(err));
      }
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchAddons();
  };
  
  const updateAddon = async (updatedAddon: Addon) => {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error } = await supabase.from('addons').upsert(
          {
            id: updatedAddon.id,
            name: getAddonNameText(updatedAddon),
            is_active: true,
            data: updatedAddon,
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
    await fetchAddons();
  };

  const deleteAddon = async (addonId: string) => {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error } = await supabase.from('addons').delete().eq('id', addonId);
        if (error) throw error;
      } catch (err) {
        throw new Error(localizeSupabaseError(err));
      }
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchAddons();
  };

  return (
    <AddonContext.Provider value={{ addons, addAddon, updateAddon, deleteAddon, fetchAddons }}>
      {children}
    </AddonContext.Provider>
  );
};

export const useAddons = () => {
  const context = useContext(AddonContext);
  if (context === undefined) {
    throw new Error('useAddons must be used within an AddonProvider');
  }
  return context;
};
