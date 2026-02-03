import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { disableRealtime, getSupabaseClient, isRealtimeEnabled } from '../supabase';
import { localizeSupabaseError } from '../utils/errorUtils';
import { SalesReturn, SalesReturnItem, Order } from '../types';
import { useAuth } from './AuthContext';

interface SalesReturnContextType {
  returns: SalesReturn[];
  loading: boolean;
  createReturn: (order: Order, items: SalesReturnItem[], reason?: string, refundMethod?: 'cash' | 'network' | 'kuraimi') => Promise<SalesReturn>;
  processReturn: (returnId: string) => Promise<void>;
  getReturnsByOrder: (orderId: string) => Promise<SalesReturn[]>;
}

const SalesReturnContext = createContext<SalesReturnContextType | undefined>(undefined);

export const SalesReturnProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [returns, setReturns] = useState<SalesReturn[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const supabase = getSupabaseClient();

  const mapRowToSalesReturn = (row: any): SalesReturn => {
    return {
      id: String(row?.id || ''),
      orderId: String(row?.order_id || row?.orderId || ''),
      returnDate: String(row?.return_date || row?.returnDate || ''),
      reason: typeof row?.reason === 'string' ? row.reason : undefined,
      refundMethod: (row?.refund_method || row?.refundMethod) as any,
      totalRefundAmount: Number(row?.total_refund_amount ?? row?.totalRefundAmount ?? 0) || 0,
      items: Array.isArray(row?.items) ? row.items : [],
      status: (row?.status || 'draft') as any,
      createdBy: typeof row?.created_by === 'string' ? row.created_by : (typeof row?.createdBy === 'string' ? row.createdBy : undefined),
      createdAt: String(row?.created_at || row?.createdAt || ''),
    };
  };

  const fetchReturns = useCallback(async () => {
    if (!user?.id || !supabase) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('sales_returns')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setReturns((data || []).map(mapRowToSalesReturn));
    } catch (error) {
      console.error('Error fetching sales returns:', error);
    } finally {
      setLoading(false);
    }
  }, [supabase, user?.id]);

  useEffect(() => {
    fetchReturns();
  }, [fetchReturns]);

  useEffect(() => {
    if (!user?.id || !supabase) return;
    const scheduleRefetch = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchReturns();
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
      .channel('public:sales_returns')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_returns' }, () => {
        void fetchReturns();
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
  }, [fetchReturns, supabase, user?.id]);

  const createReturn = async (order: Order, items: SalesReturnItem[], reason?: string, refundMethod: 'cash' | 'network' | 'kuraimi' = 'cash') => {
    try {
      setLoading(true);
      
      const itemsTotal = items.reduce((sum, item) => sum + item.total, 0);
      const deliveryFee = Number((order as any)?.deliveryFee ?? (order as any)?.delivery_fee ?? 0) || 0;
      const totalRefundAmount = Math.max(0, itemsTotal - Math.max(0, deliveryFee));

      const returnData = {
        order_id: order.id,
        return_date: new Date().toISOString(),
        reason,
        refund_method: refundMethod,
        total_refund_amount: totalRefundAmount,
        items: items, // JSONB
        status: 'draft',
        created_by: user?.id
      };

      const { data, error } = await supabase!
        .from('sales_returns')
        .insert([returnData])
        .select()
        .single();

      if (error) throw error;
      
      const mapped = mapRowToSalesReturn(data);
      setReturns(prev => [mapped, ...prev]);
      return mapped;
    } catch (error) {
      console.error('Error creating sales return:', error);
      throw new Error(localizeSupabaseError(error));
    } finally {
      setLoading(false);
    }
  };

  const processReturn = async (returnId: string) => {
    try {
      setLoading(true);
      
      // Call the RPC function we defined in the migration
      const { error } = await supabase!.rpc('process_sales_return', {
        p_return_id: returnId
      });

      if (error) throw error;

      // Update local state
      setReturns(prev => 
        prev.map(r => r.id === returnId ? { ...r, status: 'completed' } : r)
      );

    } catch (error) {
      console.error('Error processing sales return:', error);
      throw new Error(localizeSupabaseError(error));
    } finally {
      setLoading(false);
    }
  };

  const getReturnsByOrder = async (orderId: string) => {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('sales_returns')
      .select('*')
      .eq('order_id', orderId);
      
    if (error) {
        console.error("Error fetching returns for order:", error);
        return [];
    }
    return (data || []).map(mapRowToSalesReturn);
  };

  return (
    <SalesReturnContext.Provider value={{
      returns,
      loading,
      createReturn,
      processReturn,
      getReturnsByOrder
    }}>
      {children}
    </SalesReturnContext.Provider>
  );
};

export const useSalesReturn = () => {
  const context = useContext(SalesReturnContext);
  if (context === undefined) {
    throw new Error('useSalesReturn must be used within a SalesReturnProvider');
  }
  return context;
};
