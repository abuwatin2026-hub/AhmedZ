import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { getSupabaseClient } from '../supabase';
import { localizeSupabaseError, isAbortLikeError } from '../utils/errorUtils';
import { useAuth } from './AuthContext';

export type SessionScope = {
  companyId: string;
  branchId: string;
  warehouseId: string;
};

type SessionScopeContextType = {
  scope: SessionScope | null;
  loading: boolean;
  error: string | null;
  refreshScope: () => Promise<void>;
  requireScope: () => SessionScope;
};

const SessionScopeContext = createContext<SessionScopeContextType | undefined>(undefined);

export const SessionScopeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const [scope, setScope] = useState<SessionScope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshScope = useCallback(async () => {
    if (!isAuthenticated || !user?.id) {
      setScope(null);
      setError(null);
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      setScope(null);
      setError('Supabase غير مهيأ.');
      return;
    }
    setLoading(true);
    try {
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('get_admin_session_scope');
      if (rpcError) throw rpcError;
      const row: any = Array.isArray(data) ? data[0] : data;
      const companyId = typeof row?.company_id === 'string' ? row.company_id : '';
      const branchId = typeof row?.branch_id === 'string' ? row.branch_id : '';
      const warehouseId = typeof row?.warehouse_id === 'string' ? row.warehouse_id : '';
      if (!companyId || !branchId || !warehouseId) {
        throw new Error('نطاق الجلسة غير مكتمل. يجب تعيين الشركة/الفرع/المستودع للمستخدم.');
      }
      setScope({ companyId, branchId, warehouseId });
    } catch (e) {
      if (isAbortLikeError(e)) return;
      const msg = localizeSupabaseError(e) || (e instanceof Error ? e.message : '');
      setScope(null);
      setError(msg || 'فشل تحميل نطاق الجلسة.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    void refreshScope();
  }, [refreshScope]);

  const requireScope = useCallback(() => {
    if (!scope) throw new Error(error || 'نطاق الجلسة غير متاح.');
    return scope;
  }, [error, scope]);

  const value = useMemo<SessionScopeContextType>(() => ({
    scope,
    loading,
    error,
    refreshScope,
    requireScope,
  }), [error, loading, refreshScope, requireScope, scope]);

  return (
    <SessionScopeContext.Provider value={value}>
      {children}
    </SessionScopeContext.Provider>
  );
};

export const useSessionScope = () => {
  const ctx = useContext(SessionScopeContext);
  if (!ctx) {
    return {
      scope: null,
      loading: false,
      error: null,
      refreshScope: async () => undefined,
      requireScope: () => {
        throw new Error('SessionScopeProvider غير مُفعّل.');
      },
    } as SessionScopeContextType;
  }
  return ctx;
};
