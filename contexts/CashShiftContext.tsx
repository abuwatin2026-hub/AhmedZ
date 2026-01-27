import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getSupabaseClient } from '../supabase';
import { useAuth } from './AuthContext';
import { CashShift } from '../types';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';

interface CashShiftContextType {
    currentShift: CashShift | null;
    loading: boolean;
    startShift: (startAmount: number) => Promise<void>;
    endShift: (endAmount: number, notes?: string) => Promise<void>;
    refreshShift: () => Promise<void>;
    expectedCash: number;
}

const CashShiftContext = createContext<CashShiftContextType | undefined>(undefined);

export const CashShiftProvider = ({ children }: { children: ReactNode }) => {
    const { user, hasPermission } = useAuth();
    const [currentShift, setCurrentShift] = useState<CashShift | null>(null);
    const [loading, setLoading] = useState(true);
    const [expectedCash, setExpectedCash] = useState(0);

    const supabase = getSupabaseClient();

    const logAudit = async (action: string, details: string, metadata?: any) => {
        if (!supabase || !user) return;
        try {
            await supabase.from('system_audit_logs').insert({
                action,
                module: 'shifts',
                details,
                performed_by: user.id,
                performed_at: new Date().toISOString(),
                metadata
            });
        } catch (err) {
            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            if (isOffline || isAbortLikeError(err)) return;
            const msg = localizeSupabaseError(err);
            if (msg && import.meta.env.DEV) console.error(msg);
        }
    };

    const calculateExpectedCash = async (shift: CashShift) => {
        if (!shift || !supabase) return 0;

        const { data: paymentsByShift, error: paymentsByShiftError } = await supabase
            .from('payments')
            .select('amount,direction')
            .eq('method', 'cash')
            .eq('shift_id', shift.id);

        if (!paymentsByShiftError) {
            const cashIn = paymentsByShift
                ?.filter((p: any) => p.direction === 'in')
                .reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0) || 0;
            const cashOut = paymentsByShift
                ?.filter((p: any) => p.direction === 'out')
                .reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0) || 0;
            return shift.startAmount + cashIn - cashOut;
        }
        return shift.startAmount;
    };

    const refreshShift = async () => {
        if (!user || !supabase) {
            setCurrentShift(null);
            setLoading(false);
            return;
        }

        try {
            const { data, error } = await supabase
                .from('cash_shifts')
                .select('*')
                .eq('cashier_id', user.id)
                .eq('status', 'open')
                .order('opened_at', { ascending: false })
                .limit(1);

            if (error) {
                const c = (error as any)?.code;
                if (c !== 'PGRST116' && c !== '42501' && c !== 'PGRST301') {
                    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
                    if (!isOffline && !isAbortLikeError(error)) {
                        const msg = localizeSupabaseError(error);
                        if (msg && import.meta.env.DEV) console.error(msg);
                    }
                }
            }

            const row = Array.isArray(data) ? data[0] : data;
            if (row) {
                const shift: CashShift = {
                    id: row.id,
                    cashierId: row.cashier_id,
                    openedAt: row.opened_at,
                    startAmount: row.start_amount,
                    status: row.status,
                    notes: row.notes
                };
                setCurrentShift(shift);
                const expected = await calculateExpectedCash(shift);
                setExpectedCash(expected);
            } else {
                setCurrentShift(null);
                setExpectedCash(0);
            }
        } catch (err) {
            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            if (!isOffline && !isAbortLikeError(err)) {
                const msg = localizeSupabaseError(err);
                if (msg && import.meta.env.DEV) console.error(msg);
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refreshShift();
    }, [user]);

    useEffect(() => {
        if (!supabase || !currentShift?.id) return;
        let disposed = false;
        let timer: number | undefined;

        const recalc = async () => {
            if (disposed) return;
            try {
                const expected = await calculateExpectedCash(currentShift);
                if (!disposed) setExpectedCash(expected);
            } catch {
            }
        };

        const schedule = () => {
            if (disposed) return;
            if (timer) window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                void recalc();
            }, 150);
        };

        schedule();

        const channel = supabase
            .channel(`cash_shift:${currentShift.id}:payments`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'payments', filter: `shift_id=eq.${currentShift.id}` },
                () => schedule()
            )
            .subscribe();

        return () => {
            disposed = true;
            if (timer) window.clearTimeout(timer);
            supabase.removeChannel(channel);
        };
    }, [supabase, currentShift?.id]);

    const startShift = async (startAmount: number) => {
        if (!user || !supabase) return;
        if (!hasPermission('cashShifts.open') && !hasPermission('cashShifts.manage')) {
            throw new Error('ليس لديك صلاحية فتح وردية.');
        }
        try {
            const { error } = await supabase
                .from('cash_shifts')
                .insert({
                    cashier_id: user.id,
                    start_amount: startAmount,
                    status: 'open',
                    opened_at: new Date().toISOString()
                })
                .single();

            if (error) {
                const msg = String((error as any)?.message || '');
                if (/uq_cash_shifts_open_per_cashier/i.test(msg) || /duplicate key/i.test(msg)) {
                    throw new Error('لديك وردية مفتوحة بالفعل.');
                }
                throw new Error(localizeSupabaseError(error));
            }

            logAudit('open_shift', `Shift opened with amount ${startAmount}`, { startAmount });
            
            await refreshShift();
        } catch (err) {
            throw new Error(localizeSupabaseError(err));
        }
    };

    const endShift = async (endAmount: number, notes?: string) => {
        if (!currentShift || !supabase) return;
        if (!hasPermission('cashShifts.closeSelf') && !hasPermission('cashShifts.manage')) {
            throw new Error('ليس لديك صلاحية إغلاق الوردية.');
        }

        try {
            const forceReason = (notes || '').trim() || null;
            if (Math.abs(endAmount - expectedCash) > 0.01 && !forceReason) {
                throw new Error('يرجى إدخال سبب عند وجود فرق في الجرد.');
            }
            const { error: closeError } = await supabase.rpc('close_cash_shift_v2', {
                p_shift_id: currentShift.id,
                p_end_amount: endAmount,
                p_notes: notes ?? null,
                p_forced_reason: forceReason,
                p_denomination_counts: null,
                p_tender_counts: null
            });
            if (closeError) throw new Error(localizeSupabaseError(closeError));

            const diff = endAmount - expectedCash;
            logAudit('close_shift', `Shift closed with amount ${endAmount}`, { 
                endAmount, 
                expectedCash, 
                difference: diff,
                notes 
            });

            await refreshShift();
        } catch (err) {
            throw new Error(localizeSupabaseError(err));
        }
    };

    return (
        <CashShiftContext.Provider value={{ currentShift, loading, startShift, endShift, refreshShift, expectedCash }}>
            {children}
        </CashShiftContext.Provider>
    );
};

export const useCashShift = () => {
    const context = useContext(CashShiftContext);
    if (context === undefined) {
        throw new Error('useCashShift must be used within a CashShiftProvider');
    }
    return context;
};
