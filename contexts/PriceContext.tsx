import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import type { MenuItem, PriceHistory } from '../types';
import { useAuth } from './AuthContext';
import { useSettings } from './SettingsContext';
import { getSupabaseClient } from '../supabase';
import { localizeSupabaseError } from '../utils/errorUtils';

interface PriceContextType {
    priceHistory: PriceHistory[];
    loading: boolean;
    fetchPriceHistory: (itemId?: string) => Promise<void>;
    updatePrice: (itemId: string, newPrice: number, reason: string) => Promise<void>;
    getPriceHistoryByItemId: (itemId: string) => PriceHistory[];
}

const PriceContext = createContext<PriceContextType | undefined>(undefined);

export const PriceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [priceHistory, setPriceHistory] = useState<PriceHistory[]>([]);
    const [loading, setLoading] = useState(true);
    const { isAuthenticated, user, hasPermission } = useAuth();
    const { language } = useSettings();

    const fetchPriceHistory = useCallback(async (itemId?: string) => {
        setLoading(true);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) {
                setPriceHistory([]);
                return;
            }
            const baseQuery = supabase.from('price_history').select('id,data,created_at');
            const { data: rows, error } = itemId
                ? await baseQuery.eq('item_id', itemId)
                : await baseQuery;
            if (error) throw error;
            const history = (rows || []).map(row => row.data as PriceHistory).filter(Boolean);
            history.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            setPriceHistory(history);
        } catch (error) {
            if (import.meta.env.DEV) {
                console.error('Error fetching price history:', error);
            }
        } finally {
            setLoading(false);
        }
    }, []);

  useEffect(() => {
      fetchPriceHistory();
  }, [fetchPriceHistory]);

  useEffect(() => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const channel = supabase
          .channel('public:price_history')
          .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'price_history' },
              async () => {
                  await fetchPriceHistory();
              }
          )
          .subscribe();
      return () => {
          supabase.removeChannel(channel);
      };
  }, [fetchPriceHistory]);

    const updatePrice = async (itemId: string, newPrice: number, reason: string) => {
        if (!isAuthenticated || !hasPermission('prices.manage')) {
            throw new Error(language === 'ar' ? 'ليس لديك صلاحية تعديل الأسعار.' : 'You do not have permission to update prices.');
        }
        if (!Number.isFinite(newPrice) || newPrice <= 0) {
            throw new Error(language === 'ar' ? 'السعر غير صالح.' : 'Invalid price.');
        }
        if (!reason?.trim()) {
            throw new Error(language === 'ar' ? 'سبب تعديل السعر مطلوب.' : 'Price change reason is required.');
        }

        const supabase = getSupabaseClient();
        if (!supabase) {
            throw new Error(language === 'ar' ? 'Supabase غير مهيأ.' : 'Supabase is not configured.');
        }
        try {
            let item: MenuItem | undefined;
            const { data: row, error } = await supabase.from('menu_items').select('id,data,price').eq('id', itemId).maybeSingle();
            if (error) throw error;
            const dataItem = row?.data as MenuItem | undefined;
            if (dataItem) {
                const normalizedPrice = Number.isFinite(Number((row as any)?.price))
                    ? Number((row as any)?.price)
                    : (Number.isFinite(Number((dataItem as any)?.price)) ? Number((dataItem as any).price) : 0);
                item = { ...dataItem, price: normalizedPrice };
            }
            if (!item) return;

            if (item.price !== newPrice) {
                const priceHistoryEntry: PriceHistory = {
                    id: crypto.randomUUID(),
                    itemId,
                    price: newPrice,
                    date: new Date().toISOString(),
                    reason: reason.trim(),
                    changedBy: user?.fullName || user?.username || user?.id || undefined,
                };
                const updatedItem: MenuItem = { ...item, price: newPrice };

                const dateOnly = priceHistoryEntry.date.slice(0, 10);
                const { error: historyError } = await supabase.from('price_history').insert({
                  id: priceHistoryEntry.id,
                  item_id: priceHistoryEntry.itemId,
                  date: dateOnly,
                  data: priceHistoryEntry,
                });
                if (historyError) throw historyError;

                const { error: itemError } = await supabase
                    .from('menu_items')
                    .update({ price: newPrice, data: updatedItem })
                    .eq('id', updatedItem.id);
                if (itemError) throw itemError;

                await fetchPriceHistory();
            }
        } catch (err) {
            const message = localizeSupabaseError(err);
            throw new Error(message || (language === 'ar' ? 'فشل تحديث السعر' : 'Failed to update price'));
        }
    };

    const getPriceHistoryByItemId = useCallback((itemId: string) => {
        return priceHistory.filter(history => history.itemId === itemId);
    }, [priceHistory]);

    return (
        <PriceContext.Provider value={{
            priceHistory,
            loading,
            fetchPriceHistory,
            updatePrice,
            getPriceHistoryByItemId,
        }}>
            {children}
        </PriceContext.Provider>
    );
};

export const usePriceHistory = () => {
    const context = useContext(PriceContext);
    if (context === undefined) {
        throw new Error('usePriceHistory must be used within a PriceProvider');
    }
    return context;
};
