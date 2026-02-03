import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { disableRealtime, getSupabaseClient, isRealtimeEnabled } from '../supabase';
import { SystemAuditLog } from '../types';
import { useAuth } from './AuthContext';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';

interface SystemAuditContextType {
  logs: SystemAuditLog[];
  loading: boolean;
  logAction: (action: string, module: string, details: string, metadata?: Record<string, any>) => Promise<void>;
  fetchLogs: (filters?: { module?: string; dateFrom?: string; dateTo?: string }) => Promise<void>;
}

const SystemAuditContext = createContext<SystemAuditContextType | undefined>(undefined);

export const SystemAuditProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [logs, setLogs] = useState<SystemAuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const { user, hasPermission } = useAuth();
  const supabase = getSupabaseClient();
  const canViewAuditLogs = Boolean(user && (user.role === 'owner' || user.role === 'manager' || hasPermission('reports.view')));

  const mapLogRow = (row: any): SystemAuditLog => {
    return {
      id: String(row?.id),
      action: String(row?.action || ''),
      module: String(row?.module || ''),
      details: String(row?.details || ''),
      performedBy: String(row?.performed_by || row?.performedBy || ''),
      performedAt: String(row?.performed_at || row?.performedAt || ''),
      ipAddress: typeof row?.ip_address === 'string' ? row.ip_address : (typeof row?.ipAddress === 'string' ? row.ipAddress : undefined),
      metadata: (row?.metadata && typeof row.metadata === 'object') ? row.metadata : undefined,
      riskLevel: typeof row?.risk_level === 'string' ? row.risk_level : (typeof row?.riskLevel === 'string' ? row.riskLevel : undefined),
      reasonCode: typeof row?.reason_code === 'string' ? row.reason_code : (typeof row?.reasonCode === 'string' ? row.reasonCode : undefined),
    };
  };

  const fetchLogs = useCallback(async (filters?: { module?: string; dateFrom?: string; dateTo?: string }) => {
    if (!supabase) return;
    if (!canViewAuditLogs) return;
    try {
      setLoading(true);
      let query = supabase
        .from('system_audit_logs') // We assume this table will be created
        .select('id, action, module, details, performed_by, performed_at, ip_address, metadata, risk_level, reason_code')
        .order('performed_at', { ascending: false })
        .limit(100);

      if (filters?.module) {
        query = query.eq('module', filters.module);
      }
      if (filters?.dateFrom) {
        query = query.gte('performed_at', filters.dateFrom);
      }
      
      const { data, error } = await query;

      if (error) {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline || isAbortLikeError(error)) return;
        const msg = localizeSupabaseError(error);
        if (msg) console.warn(msg);
        return;
      }
      setLogs((data || []).map(mapLogRow));
    } catch (error) {
      const msg = String((error as any)?.message || '');
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const isAborted = /abort|ERR_ABORTED|Failed to fetch/i.test(msg) || isAbortLikeError(error);
      if (isOffline || isAborted) {
        if (import.meta.env.DEV) console.info('تخطي جلب سجل النظام: الشبكة غير متاحة أو الطلب أُلغي.');
      } else {
        const localized = localizeSupabaseError(error);
        if (localized) console.error(localized);
      }
    } finally {
      setLoading(false);
    }
  }, [canViewAuditLogs, supabase]);

  useEffect(() => {
    if (user?.id && canViewAuditLogs) {
      fetchLogs();
    }
  }, [user?.id, canViewAuditLogs, fetchLogs]);

  useEffect(() => {
    if (!supabase) return;
    if (!user?.id) return;
    if (!canViewAuditLogs) return;
    if (!isRealtimeEnabled()) return;
    const channel = supabase
      .channel('public:system_audit_logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_audit_logs' }, () => {
        void fetchLogs();
      })
      .subscribe((status: any) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          disableRealtime();
          supabase.removeChannel(channel);
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, user?.id, canViewAuditLogs, fetchLogs]);

  const logAction = async (action: string, module: string, details: string, metadata?: Record<string, any>) => {
    if (!user?.id || !supabase) return;
    try {
      // Fire and forget, don't block UI
      supabase.from('system_audit_logs').insert([{
        action,
        module,
        details,
        performed_by: user.id,
        performed_at: new Date().toISOString(),
        metadata
      }]).then(({ error }) => {
        if (!error) return;
        if (isAbortLikeError(error)) return;
        const msg = localizeSupabaseError(error);
        if (msg) console.error(msg);
      });
    } catch (error) {
      const msg = localizeSupabaseError(error);
      if (msg) console.error(msg);
    }
  };

  return (
    <SystemAuditContext.Provider value={{
      logs,
      loading,
      logAction,
      fetchLogs
    }}>
      {children}
    </SystemAuditContext.Provider>
  );
};

export const useSystemAudit = () => {
  const context = useContext(SystemAuditContext);
  if (context === undefined) {
    throw new Error('useSystemAudit must be used within a SystemAuditProvider');
  }
  return context;
};
