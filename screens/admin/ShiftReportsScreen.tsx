import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSupabaseClient } from '../../supabase';
import type { CashShift, Order } from '../../types';
import * as Icons from '../../components/icons';
import { useAuth } from '../../contexts/AuthContext';
import { exportToXlsx, sharePdf } from '../../utils/export';
import { getInvoiceOrderView } from '../../utils/orderUtils';
import { useSettings } from '../../contexts/SettingsContext';

const ShiftReportsScreen: React.FC = () => {
    const [shifts, setShifts] = useState<CashShift[]>([]);
    const [loading, setLoading] = useState(true);
    const [cashierLabelById, setCashierLabelById] = useState<Record<string, string>>({});
    const [closeShiftId, setCloseShiftId] = useState<string | null>(null);
    const [closeAmount, setCloseAmount] = useState('');
    const [closeNotes, setCloseNotes] = useState('');
    const [closeUseDenoms, setCloseUseDenoms] = useState(false);
    const [closeDenoms, setCloseDenoms] = useState<Record<string, number>>({});
    const [closeExpected, setCloseExpected] = useState<number | null>(null);
    const [closeTotalsByMethod, setCloseTotalsByMethod] = useState<Record<string, { in: number; out: number }>>({});
    const [closeCountedByMethod, setCloseCountedByMethod] = useState<Record<string, string>>({});
    const [closeForcedReason, setCloseForcedReason] = useState('');
    const [closeError, setCloseError] = useState('');
    const [isClosing, setIsClosing] = useState(false);
    const supabase = getSupabaseClient();
    const { user } = useAuth();
    const canManageShifts = user?.role === 'owner' || user?.role === 'manager';
    const [isOpenModal, setIsOpenModal] = useState(false);
    const [openCashierId, setOpenCashierId] = useState<string>('');
    const [openStartAmount, setOpenStartAmount] = useState<string>('0');
    const [openError, setOpenError] = useState('');
    const [isOpening, setIsOpening] = useState(false);
    const [cashierOptions, setCashierOptions] = useState<Array<{ id: string; label: string }>>([]);
    const [reportShiftId, setReportShiftId] = useState<string | null>(null);
    const [reportLoading, setReportLoading] = useState(false);
    const [reportError, setReportError] = useState('');
    const [reportShift, setReportShift] = useState<any | null>(null);
    const [reportPayments, setReportPayments] = useState<any[]>([]);
    const [reportOrders, setReportOrders] = useState<Order[]>([]);
    const [reportMissingRefunds, setReportMissingRefunds] = useState<number>(0);
    const [reportExpectedCash, setReportExpectedCash] = useState<number | null>(null);
    const navigate = useNavigate();
    const { settings } = useSettings();

    useEffect(() => {
        const loadShifts = async () => {
            if (!supabase) return;
            const { data, error } = await supabase
                .from('cash_shifts')
                .select('*')
                .order('opened_at', { ascending: false })
                .limit(50); // Pagination later

            if (error) {
                console.error(error);
            } else if (data) {
                const mapped: CashShift[] = data.map(d => ({
                    id: d.id,
                    cashierId: d.cashier_id,
                    openedAt: d.opened_at,
                    closedAt: d.closed_at,
                    startAmount: d.start_amount,
                    endAmount: d.end_amount,
                    expectedAmount: d.expected_amount,
                    difference: d.difference,
                    status: d.status,
                    notes: d.notes
                }));
                setShifts(mapped);

                const cashierIds = Array.from(new Set(mapped.map(s => s.cashierId).filter(Boolean)));
                if (cashierIds.length) {
                    const { data: cashiers, error: cashiersError } = await supabase
                        .from('admin_users')
                        .select('auth_user_id, full_name, username, email')
                        .in('auth_user_id', cashierIds);
                    if (cashiersError) {
                        console.error(cashiersError);
                    } else if (cashiers) {
                        const next: Record<string, string> = {};
                        cashiers.forEach((c: any) => {
                            const label = String(c.full_name || c.username || c.email || '').trim();
                            if (c.auth_user_id && label) next[String(c.auth_user_id)] = label;
                        });
                        setCashierLabelById(next);
                    }
                }
            }
            setLoading(false);
        };
        loadShifts();
    }, [supabase]);

    useEffect(() => {
        const loadCashiers = async () => {
            if (!supabase || !canManageShifts) return;
            const { data, error } = await supabase
                .from('admin_users')
                .select('auth_user_id, full_name, username, email, role, is_active')
                .eq('role', 'cashier')
                .eq('is_active', true)
                .order('username', { ascending: true });
            if (error) {
                return;
            }
            const opts = (data || [])
                .map((c: any) => ({
                    id: String(c.auth_user_id),
                    label: String(c.full_name || c.username || c.email || '').trim()
                }))
                .filter(o => o.id && o.label);
            setCashierOptions(opts);
        };
        loadCashiers();
    }, [supabase, canManageShifts]);

    const refresh = async () => {
        if (!supabase) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('cash_shifts')
            .select('*')
            .order('opened_at', { ascending: false })
            .limit(50);
        if (error) {
            console.error(error);
            setLoading(false);
            return;
        }
        const mapped: CashShift[] = (data || []).map((d: any) => ({
            id: d.id,
            cashierId: d.cashier_id,
            openedAt: d.opened_at,
            closedAt: d.closed_at,
            startAmount: d.start_amount,
            endAmount: d.end_amount,
            expectedAmount: d.expected_amount,
            difference: d.difference,
            status: d.status,
            notes: d.notes
        }));
        setShifts(mapped);
        const cashierIds = Array.from(new Set(mapped.map(s => s.cashierId).filter(Boolean)));
        if (cashierIds.length) {
            const { data: cashiers, error: cashiersError } = await supabase
                .from('admin_users')
                .select('auth_user_id, full_name, username, email')
                .in('auth_user_id', cashierIds);
            if (!cashiersError && cashiers) {
                const next: Record<string, string> = {};
                cashiers.forEach((c: any) => {
                    const label = String(c.full_name || c.username || c.email || '').trim();
                    if (c.auth_user_id && label) next[String(c.auth_user_id)] = label;
                });
                setCashierLabelById(next);
            }
        }
        setLoading(false);
    };

    const openCloseModal = (shiftId: string) => {
        setCloseShiftId(shiftId);
        setCloseAmount('');
        setCloseNotes('');
        setCloseUseDenoms(false);
        setCloseDenoms({});
        setCloseExpected(null);
        setCloseTotalsByMethod({});
        setCloseCountedByMethod({});
        setCloseForcedReason('');
        setCloseError('');
    };

    useEffect(() => {
        const loadExpected = async () => {
            if (!supabase) return;
            if (!closeShiftId) return;
            const { data, error } = await supabase.rpc('calculate_cash_shift_expected', { p_shift_id: closeShiftId });
            if (error) {
                setCloseExpected(null);
                return;
            }
            const numeric = Number(data);
            setCloseExpected(Number.isFinite(numeric) ? numeric : null);
        };
        loadExpected();
    }, [supabase, closeShiftId]);

    useEffect(() => {
        const loadCloseMethodTotals = async () => {
            if (!supabase) return;
            if (!closeShiftId) {
                setCloseTotalsByMethod({});
                return;
            }
            const { data, error } = await supabase
                .from('payments')
                .select('method,direction,amount')
                .eq('shift_id', closeShiftId)
                .limit(5000);
            if (error) {
                setCloseTotalsByMethod({});
                return;
            }
            const totals: Record<string, { in: number; out: number }> = {};
            for (const row of Array.isArray(data) ? data : []) {
                const method = String((row as any)?.method || '').trim() || '-';
                const dir = String((row as any)?.direction || '').toLowerCase();
                const amt = Number((row as any)?.amount) || 0;
                if (!totals[method]) totals[method] = { in: 0, out: 0 };
                if (dir === 'in') totals[method].in += amt;
                else if (dir === 'out') totals[method].out += amt;
            }
            setCloseTotalsByMethod(totals);
            setCloseCountedByMethod((prev) => {
                if (Object.keys(prev).length) return prev;
                const next: Record<string, string> = {};
                for (const [method, v] of Object.entries(totals)) {
                    if (String(method).toLowerCase() === 'cash') continue;
                    const net = (v?.in || 0) - (v?.out || 0);
                    next[method] = net.toFixed(2);
                }
                return next;
            });
        };
        loadCloseMethodTotals();
    }, [supabase, closeShiftId]);

    useEffect(() => {
        const loadReport = async () => {
            if (!supabase) return;
            if (!reportShiftId) {
                setReportShift(null);
                setReportPayments([]);
                setReportOrders([]);
                setReportMissingRefunds(0);
                setReportError('');
                setReportLoading(false);
                setReportExpectedCash(null);
                return;
            }
            setReportLoading(true);
            setReportError('');
            try {
                const { data: shiftRow, error: shiftError } = await supabase
                    .from('cash_shifts')
                    .select('*')
                    .eq('id', reportShiftId)
                    .single();
                if (shiftError) throw shiftError;
                setReportShift(shiftRow || null);

                const paymentsSelect = 'id,direction,method,amount,currency,reference_table,reference_id,occurred_at,created_by,data';
                const { data: payRows, error: payError } = await supabase
                    .from('payments')
                    .select(paymentsSelect)
                    .eq('shift_id', reportShiftId)
                    .order('occurred_at', { ascending: true })
                    .limit(5000);
                if (payError) throw payError;
                const pList = Array.isArray(payRows) ? payRows : [];
                setReportPayments(pList);

                const orderIds = Array.from(
                    new Set(
                        pList
                            .filter((p: any) => String(p.reference_table || '') === 'orders' && p.reference_id)
                            .map((p: any) => String(p.reference_id))
                            .filter(Boolean)
                    )
                );
                const nextOrders: Order[] = [];
                const chunkSize = 200;
                for (let i = 0; i < orderIds.length; i += chunkSize) {
                    const chunk = orderIds.slice(i, i + chunkSize);
                    const { data: orderRows, error: orderError } = await supabase
                        .from('orders')
                        .select('id,status,data')
                        .in('id', chunk);
                    if (orderError) throw orderError;
                    for (const row of orderRows || []) {
                        const base = (row as any)?.data;
                        if (!base || typeof base !== 'object') continue;
                        const view = getInvoiceOrderView(base as Order);
                        nextOrders.push({
                            ...view,
                            id: String((row as any).id || (view as any).id || ''),
                            status: String((row as any).status || view.status || '') as any,
                        });
                    }
                }
                setReportOrders(nextOrders.filter(o => o.status === 'delivered' && Boolean(o.paidAt)));

                const refundPaymentIds = new Set(
                    pList
                        .filter((p: any) => String(p.reference_table || '') === 'sales_returns' && p.reference_id)
                        .map((p: any) => String(p.reference_id))
                        .filter(Boolean)
                );
                const rangeStart = shiftRow?.opened_at ? String(shiftRow.opened_at) : null;
                const rangeEnd = shiftRow?.closed_at ? String(shiftRow.closed_at) : new Date().toISOString();
                let missingRefunds = 0;
                if (rangeStart) {
                    let q = supabase
                        .from('sales_returns')
                        .select('id,total_refund_amount,return_date,created_by')
                        .gte('return_date', rangeStart)
                        .lte('return_date', rangeEnd)
                        .limit(2000);
                    if (shiftRow?.cashier_id) {
                        q = q.eq('created_by', String(shiftRow.cashier_id));
                    }
                    const { data: retRows, error: retError } = await q;
                    if (!retError && Array.isArray(retRows)) {
                        for (const r of retRows) {
                            const rid = String((r as any)?.id || '');
                            if (!rid || refundPaymentIds.has(rid)) continue;
                            missingRefunds += Number((r as any)?.total_refund_amount) || 0;
                        }
                    }
                }
                setReportMissingRefunds(missingRefunds);
            } catch (err: any) {
                const raw = String(err?.message || '');
                setReportError(raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'تعذر تحميل تقرير الوردية.');
                setReportShift(null);
                setReportPayments([]);
                setReportOrders([]);
                setReportMissingRefunds(0);
            } finally {
                setReportLoading(false);
            }
        };
        void loadReport();
    }, [supabase, reportShiftId]);

    useEffect(() => {
        const loadReportExpected = async () => {
            if (!supabase) return;
            if (!reportShiftId) {
                setReportExpectedCash(null);
                return;
            }
            const { data, error } = await supabase.rpc('calculate_cash_shift_expected', { p_shift_id: reportShiftId });
            if (error) {
                setReportExpectedCash(null);
                return;
            }
            const numeric = Number(data);
            setReportExpectedCash(Number.isFinite(numeric) ? numeric : null);
        };
        void loadReportExpected();
    }, [supabase, reportShiftId]);

    const methodLabel = (method: string) => {
        const m = (method || '').toLowerCase();
        if (m === 'cash') return 'نقد';
        if (m === 'network') return 'شبكة';
        if (m === 'kuraimi') return 'حوالة/كريمي';
        if (m === 'bank') return 'حوالة/كريمي';
        if (m === 'card') return 'شبكة';
        if (m === 'ar') return 'آجل';
        if (m === 'store_credit') return 'رصيد عميل';
        return method || '-';
    };

    const shortId = (value: unknown, take: number = 6) => {
        const s = String(value || '').trim();
        if (!s) return '';
        return s.slice(-take).toUpperCase();
    };

    const paymentDetails = (p: any) => {
        const refTable = String(p?.reference_table || '').trim();
        const refId = String(p?.reference_id || '').trim();
        const data = (p?.data && typeof p.data === 'object' ? p.data : {}) as Record<string, unknown>;
        const kind = String((data as any)?.kind || '').trim();
        const reason = String((data as any)?.reason || '').trim();
        const direction = String(p?.direction || '').trim();

        if (refTable === 'cash_shifts' && kind === 'cash_movement') {
            if (reason) return reason;
            return direction === 'in' ? 'إيداع داخل الوردية' : direction === 'out' ? 'صرف داخل الوردية' : 'حركة نقدية';
        }
        if (refTable === 'orders' && refId) return `دفعة طلب ${shortId(refId)}`;
        if (refTable === 'sales_returns' && refId) {
            const orderId = String((data as any)?.orderId || '').trim();
            if (orderId) return `مرتجع ${shortId(refId)} للطلب ${shortId(orderId)}`;
            return `مرتجع ${shortId(refId)}`;
        }
        if (reason) return reason;
        if (refTable && refId) return `${refTable}:${shortId(refId)}`;
        if (refTable) return refTable;
        return '-';
    };

    useEffect(() => {
        if (!closeUseDenoms) return;
        const total = Object.entries(closeDenoms).reduce((sum, [denom, count]) => {
            const d = Number(denom);
            const c = Number(count);
            if (!Number.isFinite(d) || !Number.isFinite(c)) return sum;
            return sum + (d * c);
        }, 0);
        setCloseAmount(total.toFixed(2));
    }, [closeUseDenoms, closeDenoms]);

    const submitClose = async () => {
        if (!supabase || !closeShiftId) return;
        setCloseError('');
        const num = parseFloat(closeAmount);
        if (isNaN(num) || num < 0) {
            setCloseError('يرجى إدخال مبلغ صحيح.');
            return;
        }
        const expected = closeExpected;
        const tenderCounts: Record<string, number> = {};
        for (const [method, raw] of Object.entries(closeCountedByMethod)) {
            const n = Number(raw);
            if (Number.isFinite(n)) tenderCounts[method] = n;
        }
        tenderCounts['cash'] = num;

        const cashMismatch = expected !== null && Math.abs(num - expected) > 0.01;
        const otherMismatch = Object.entries(closeTotalsByMethod).some(([method, totals]) => {
            if (String(method).toLowerCase() === 'cash') return false;
            const exp = (totals?.in || 0) - (totals?.out || 0);
            const counted = Number(tenderCounts[method]);
            if (!Number.isFinite(counted)) return false;
            return Math.abs(counted - exp) > 0.01;
        });
        if ((cashMismatch || otherMismatch) && !closeForcedReason.trim()) {
            setCloseError('يرجى إدخال سبب الإغلاق عند وجود فرق.');
            return;
        }
        setIsClosing(true);
        try {
            const { error } = await supabase.rpc('close_cash_shift_v2', {
                p_shift_id: closeShiftId,
                p_end_amount: num,
                p_notes: closeNotes || null,
                p_forced_reason: closeForcedReason.trim() || null,
                p_denomination_counts: closeUseDenoms ? closeDenoms : null,
                p_tender_counts: tenderCounts
            });
            if (error) throw error;
            setCloseShiftId(null);
            await refresh();
        } catch (err) {
            const raw = err instanceof Error ? err.message : '';
            setCloseError(raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'تعذر إغلاق الوردية.');
        } finally {
            setIsClosing(false);
        }
    };

    const reportComputed = useMemo(() => {
        const totalsByMethod: Record<string, { in: number; out: number }> = {};
        for (const p of reportPayments) {
            const key = String((p as any)?.method || '-');
            if (!totalsByMethod[key]) totalsByMethod[key] = { in: 0, out: 0 };
            const dir = String((p as any)?.direction || '').toLowerCase();
            const amt = Number((p as any)?.amount) || 0;
            if (dir === 'in') totalsByMethod[key].in += amt;
            if (dir === 'out') totalsByMethod[key].out += amt;
        }
        const refunds = reportPayments.filter((p: any) => String(p?.direction || '') === 'out' && String(p?.reference_table || '') === 'sales_returns');
        const refundIds = new Set(refunds.map((p: any) => String(p?.reference_id || '')).filter(Boolean));
        const refundsTotal = refunds.reduce((sum: number, p: any) => sum + (Number(p?.amount) || 0), 0);
        const salesTotal = reportOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
        const discountsTotal = reportOrders.reduce((sum, o) => sum + (Number(o.discountAmount) || 0), 0);
        return {
            totalsByMethod,
            refundsTotal,
            refundsCount: refundIds.size,
            salesTotal,
            discountsTotal,
            netTotal: salesTotal - refundsTotal,
            paymentsCount: reportPayments.length,
            ordersCount: reportOrders.length,
        };
    }, [reportPayments, reportOrders]);

    const reportCashExpected = useMemo(() => {
        const startAmount = Number((reportShift as any)?.start_amount) || 0;
        const cash = reportComputed.totalsByMethod['cash'] || { in: 0, out: 0 };
        const fallback = startAmount + (Number(cash.in) || 0) - (Number(cash.out) || 0);
        const closedExpected = (reportShift && String((reportShift as any)?.status || '') === 'closed' && (reportShift as any)?.expected_amount !== null && (reportShift as any)?.expected_amount !== undefined)
            ? Number((reportShift as any).expected_amount)
            : null;
        if (Number.isFinite(closedExpected as any)) return Number(closedExpected);
        if (Number.isFinite(reportExpectedCash as any)) return Number(reportExpectedCash);
        return fallback;
    }, [reportShift, reportComputed.totalsByMethod, reportExpectedCash]);

    const renderReportBody = (mode: 'screen' | 'print') => {
        const shiftRow = reportShift;
        const cashierId = String(shiftRow?.cashier_id || '');
        const cashierLabel = cashierLabelById[cashierId] || (cashierId ? cashierId.slice(0, 8) : '-');
        const openedAt = shiftRow?.opened_at ? new Date(String(shiftRow.opened_at)).toLocaleString() : '-';
        const closedAt = shiftRow?.closed_at ? new Date(String(shiftRow.closed_at)).toLocaleString() : '-';
        const status = String(shiftRow?.status || '');
        const startAmount = Number(shiftRow?.start_amount) || 0;
        const endAmount = shiftRow?.end_amount === null || shiftRow?.end_amount === undefined ? null : Number(shiftRow.end_amount);
        const diff = shiftRow?.difference === null || shiftRow?.difference === undefined ? null : Number(shiftRow.difference);
        const tenderCounts = (shiftRow?.tender_counts && typeof shiftRow.tender_counts === 'object') ? (shiftRow.tender_counts as Record<string, unknown>) : null;

        const methodKeys = new Set<string>();
        Object.keys(reportComputed.totalsByMethod || {}).forEach(k => methodKeys.add(String(k || '-')));
        Object.keys(tenderCounts || {}).forEach(k => methodKeys.add(String(k || '-')));
        methodKeys.add('cash');
        const methods = Array.from(methodKeys).sort((a, b) => (a === 'cash' ? -1 : b === 'cash' ? 1 : a.localeCompare(b)));

        const tenderRows = methods.map((method) => {
            const exp = method.toLowerCase() === 'cash'
                ? reportCashExpected
                : ((reportComputed.totalsByMethod[method]?.in || 0) - (reportComputed.totalsByMethod[method]?.out || 0));
            let counted: number | null = null;
            if (tenderCounts && Object.prototype.hasOwnProperty.call(tenderCounts, method)) {
                const n = Number((tenderCounts as any)[method]);
                counted = Number.isFinite(n) ? n : null;
            } else if (method.toLowerCase() === 'cash' && endAmount !== null && Number.isFinite(endAmount)) {
                counted = endAmount;
            }
            const d = counted !== null ? counted - exp : null;
            return { method, exp, counted, diff: d };
        });

        const titleClass = mode === 'print' ? 'text-2xl font-bold' : 'text-xl font-bold';

        return (
            <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className={titleClass}>تقرير وردية</div>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-300">
                            {cashierLabel} <span className="mx-2">•</span> {openedAt} <span className="mx-2">•</span> {status === 'open' ? 'مفتوحة' : 'مغلقة'}
                        </div>
                        {status !== 'open' && (
                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-300">
                                إغلاق: {closedAt}
                            </div>
                        )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-300 font-mono">
                        {shiftRow?.id ? String(shiftRow.id).slice(-8).toUpperCase() : ''}
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                        <div className="text-xs text-gray-500 dark:text-gray-300">عهدة البداية</div>
                        <div className="mt-1 text-lg font-bold font-mono dark:text-white">{startAmount.toFixed(2)}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                        <div className="text-xs text-gray-500 dark:text-gray-300">النقد المتوقع</div>
                        <div className="mt-1 text-lg font-bold font-mono dark:text-white">{reportCashExpected.toFixed(2)}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                        <div className="text-xs text-gray-500 dark:text-gray-300">النقد الفعلي</div>
                        <div className="mt-1 text-lg font-bold font-mono dark:text-white">{endAmount === null ? '-' : endAmount.toFixed(2)}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                        <div className="text-xs text-gray-500 dark:text-gray-300">فرق النقد</div>
                        <div className={`mt-1 text-lg font-bold font-mono ${diff !== null && Math.abs(diff) > 0.01 ? 'text-red-600 dark:text-red-400' : 'dark:text-white'}`}>
                            {diff === null ? '-' : (diff > 0 ? '+' : '') + diff.toFixed(2)}
                        </div>
                    </div>
                </div>

                <div className="p-4 rounded-lg bg-white dark:bg-gray-800 shadow">
                    <div className="flex items-center justify-between">
                        <div className="font-bold dark:text-white">ملخص الوردية</div>
                        <div className="text-xs text-gray-500 dark:text-gray-300">
                            {reportComputed.ordersCount} طلب <span className="mx-2">•</span> {reportComputed.paymentsCount} عملية
                        </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                            <div className="text-xs text-gray-500 dark:text-gray-300">المبيعات</div>
                            <div className="mt-1 text-lg font-bold font-mono dark:text-white">{reportComputed.salesTotal.toFixed(2)}</div>
                        </div>
                        <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                            <div className="text-xs text-gray-500 dark:text-gray-300">المرتجعات</div>
                            <div className="mt-1 text-lg font-bold font-mono text-rose-600 dark:text-rose-400">{reportComputed.refundsTotal.toFixed(2)}</div>
                            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-300">{reportComputed.refundsCount} عملية إرجاع</div>
                        </div>
                        <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                            <div className="text-xs text-gray-500 dark:text-gray-300">الخصومات</div>
                            <div className="mt-1 text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">{reportComputed.discountsTotal.toFixed(2)}</div>
                        </div>
                        <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                            <div className="text-xs text-gray-500 dark:text-gray-300">الصافي</div>
                            <div className="mt-1 text-lg font-bold font-mono dark:text-white">{reportComputed.netTotal.toFixed(2)}</div>
                        </div>
                    </div>
                    {reportMissingRefunds > 0.01 && (
                        <div className="mt-3 p-3 rounded-lg bg-amber-50 text-amber-900 text-sm">
                            مرتجعات غير مرتبطة بعمليات دفع داخل الوردية: {reportMissingRefunds.toFixed(2)}
                        </div>
                    )}
                </div>

                <div className="p-4 rounded-lg bg-white dark:bg-gray-800 shadow">
                    <div className="font-bold dark:text-white">تسوية حسب طريقة الدفع</div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-300">
                        {tenderCounts ? 'يعرض المتوقع والمعدود والفروقات.' : 'يعرض المتوقع. المعدود يظهر بعد إغلاق الوردية.'}
                    </div>
                    <div className="mt-3 space-y-2">
                        <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 dark:text-gray-300">
                            <div className="col-span-4">الطريقة</div>
                            <div className="col-span-3 text-right">المتوقع</div>
                            <div className="col-span-3 text-right">المعدود</div>
                            <div className="col-span-2 text-right">الفرق</div>
                        </div>
                        {tenderRows.map((r) => (
                            <div key={r.method} className="grid grid-cols-12 gap-2 items-center">
                                <div className="col-span-4 text-sm dark:text-gray-200">{methodLabel(r.method)}</div>
                                <div className="col-span-3 text-right text-sm font-mono dark:text-gray-200">{Number(r.exp).toFixed(2)}</div>
                                <div className="col-span-3 text-right text-sm font-mono dark:text-gray-200">{r.counted === null ? '-' : r.counted.toFixed(2)}</div>
                                <div className={`col-span-2 text-right text-sm font-mono ${r.diff !== null && Math.abs(r.diff) > 0.01 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}>
                                    {r.diff === null ? '-' : (r.diff > 0 ? '+' : '') + r.diff.toFixed(2)}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    if (loading) return <div className="p-8 text-center">جاري تحميل الورديات...</div>;

    const openCashierIds = new Set(shifts.filter(s => s.status === 'open').map(s => s.cashierId));

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-bold dark:text-white">تقارير الورديات</h1>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={refresh}
                        className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                        تحديث
                    </button>
                    {canManageShifts && (
                        <button
                            type="button"
                            onClick={() => setIsOpenModal(true)}
                            className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700"
                        >
                            فتح وردية
                        </button>
                    )}
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
                <div className="overflow-x-auto">
                    <table className="min-w-[1000px] w-full text-left">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                            <th className="p-2 sm:p-4 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-300">الحالة</th>
                            <th className="p-2 sm:p-4 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-300">الكاشير</th>
                            <th className="p-2 sm:p-4 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-300">فتح</th>
                            <th className="p-2 sm:p-4 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-300">إغلاق</th>
                            <th className="p-2 sm:p-4 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-300">عهدة البداية</th>
                            <th className="p-2 sm:p-4 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-300">النقد المتوقع</th>
                            <th className="p-2 sm:p-4 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-300">النقد الفعلي</th>
                            <th className="p-2 sm:p-4 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-300">فرق النقد</th>
                            <th className="p-2 sm:p-4 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-300">تفاصيل</th>
                            <th className="p-2 sm:p-4 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-300">ملاحظات</th>
                            {canManageShifts && <th className="p-2 sm:p-4 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-300">إجراءات</th>}
                        </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {shifts.map(shift => (
                            <tr key={shift.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                <td className="p-2 sm:p-4">
                                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${shift.status === 'open'
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-gray-100 text-gray-700'
                                        }`}>
                                        {shift.status === 'open' ? <Icons.ClockIcon className="w-3 h-3" /> : <Icons.CheckIcon className="w-3 h-3" />}
                                        {shift.status === 'open' ? 'مفتوحة' : 'مغلقة'}
                                    </span>
                                </td>
                                <td className="p-2 sm:p-4 text-xs sm:text-sm dark:text-gray-300">
                                    {cashierLabelById[shift.cashierId] || shift.cashierId?.slice(0, 8) || '-'}
                                </td>
                                <td className="p-2 sm:p-4 text-xs sm:text-sm dark:text-gray-300">
                                    {new Date(shift.openedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </td>
                                <td className="p-2 sm:p-4 text-xs sm:text-sm dark:text-gray-300">
                                    {shift.closedAt ? new Date(shift.closedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                                </td>
                                <td className="p-2 sm:p-4 text-xs sm:text-sm font-mono dark:text-gray-300">
                                    {shift.startAmount.toFixed(2)}
                                </td>
                                <td className="p-2 sm:p-4 text-xs sm:text-sm font-mono dark:text-gray-300">
                                    {shift.expectedAmount?.toFixed(2) ?? '-'}
                                </td>
                                <td className="p-2 sm:p-4 text-xs sm:text-sm font-mono dark:text-gray-300">
                                    {shift.endAmount?.toFixed(2) ?? '-'}
                                </td>
                                <td className="p-2 sm:p-4">
                                    {shift.difference !== undefined && shift.difference !== null ? (
                                        <span className={`font-bold font-mono ${Math.abs(shift.difference) > 0.01
                                            ? 'text-red-500'
                                            : 'text-green-500'
                                            }`}>
                                            {shift.difference > 0 ? '+' : ''}{shift.difference.toFixed(2)}
                                        </span>
                                    ) : '-'}
                                </td>
                                <td className="p-2 sm:p-4">
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => navigate(`/admin/shift-reports/${shift.id}`)}
                                            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                                        >
                                            عرض
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setReportError('');
                                                setReportShiftId(shift.id);
                                            }}
                                            className="px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                                        >
                                            تقرير
                                        </button>
                                    </div>
                                </td>
                                <td className="p-2 sm:p-4 text-xs sm:text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">
                                    {shift.notes}
                                </td>
                                {canManageShifts && (
                                    <td className="p-2 sm:p-4">
                                        {shift.status === 'open' ? (
                                            <button
                                                type="button"
                                                onClick={() => openCloseModal(shift.id)}
                                                className="px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600"
                                            >
                                                إغلاق
                                            </button>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                )}
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {closeShiftId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="bg-gray-100 dark:bg-gray-700 p-4 flex justify-between items-center border-b dark:border-gray-600">
                            <h2 className="text-xl font-bold text-gray-800 dark:text-white">إغلاق وردية</h2>
                            <button
                                type="button"
                                onClick={() => { setCloseShiftId(null); setCloseTotalsByMethod({}); }}
                                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
                            >
                                <Icons.XIcon className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">النقد الفعلي بعد الجرد</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={closeAmount}
                                    onChange={(e) => setCloseAmount(e.target.value)}
                                    disabled={closeUseDenoms}
                                    className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-lg font-mono dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="0.00"
                                    required
                                />
                                {closeExpected !== null && (
                                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-300">
                                        المتوقع: <span className="font-mono">{closeExpected.toFixed(2)}</span>{' '}
                                        <span className="mx-1">—</span>
                                        الفرق: <span className={`font-mono font-bold ${Math.abs(Number(closeAmount) - closeExpected) > 0.01 ? 'text-red-500' : 'text-gray-500 dark:text-gray-300'}`}>
                                            {(Number.isFinite(Number(closeAmount)) ? (Number(closeAmount) - closeExpected).toFixed(2) : '-')}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                                <div className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">تسوية حسب طريقة الدفع</div>
                                <div className="text-xs text-gray-500 dark:text-gray-300 mb-3">النقد يتم جرده. باقي الطرق يمكنك تركها كما هي أو تعديلها إذا لزم.</div>
                                <div className="space-y-2">
                                    <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 dark:text-gray-300">
                                        <div className="col-span-4">الطريقة</div>
                                        <div className="col-span-3 text-right">المتوقع</div>
                                        <div className="col-span-3 text-right">المعدود</div>
                                        <div className="col-span-2 text-right">الفرق</div>
                                    </div>
                                    {Object.keys(closeTotalsByMethod).length === 0 ? (
                                        <div className="text-xs text-gray-500 dark:text-gray-300">لا توجد بيانات كافية.</div>
                                    ) : (
                                        Object.entries(closeTotalsByMethod)
                                            .sort(([a], [b]) => (a === 'cash' ? -1 : b === 'cash' ? 1 : a.localeCompare(b)))
                                            .map(([method, totals]) => {
                                                const exp = (totals?.in || 0) - (totals?.out || 0);
                                                const isCash = String(method).toLowerCase() === 'cash';
                                                const counted = isCash ? Number(closeAmount) : Number(closeCountedByMethod[method]);
                                                const diff = Number.isFinite(counted) ? counted - exp : NaN;
                                                return (
                                                    <div key={method} className="grid grid-cols-12 gap-2 items-center">
                                                        <div className="col-span-4 text-sm dark:text-gray-200">{methodLabel(method)}</div>
                                                        <div className="col-span-3 text-right text-sm font-mono dark:text-gray-200">{exp.toFixed(2)}</div>
                                                        <div className="col-span-3">
                                                            {isCash ? (
                                                                <div className="text-right text-sm font-mono dark:text-gray-200">{Number.isFinite(Number(closeAmount)) ? Number(closeAmount).toFixed(2) : '-'}</div>
                                                            ) : (
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    value={closeCountedByMethod[method] ?? ''}
                                                                    onChange={(e) => setCloseCountedByMethod((prev) => ({ ...prev, [method]: e.target.value }))}
                                                                    className="w-full px-2 py-1 border rounded-lg text-sm font-mono text-right dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                                    placeholder={exp.toFixed(2)}
                                                                />
                                                            )}
                                                        </div>
                                                        <div className={`col-span-2 text-right text-sm font-mono ${Number.isFinite(diff) && Math.abs(diff) > 0.01 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}>
                                                            {Number.isFinite(diff) ? (diff > 0 ? '+' : '') + diff.toFixed(2) : '-'}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium dark:text-gray-300">عدّ الفئات</label>
                                <input
                                    type="checkbox"
                                    checked={closeUseDenoms}
                                    onChange={(e) => setCloseUseDenoms(e.target.checked)}
                                    className="h-5 w-5"
                                />
                            </div>
                            {closeUseDenoms && (
                                <div className="grid grid-cols-2 gap-3">
                                    {[10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000].map((denom) => (
                                        <div key={denom} className="flex items-center gap-2">
                                            <div className="w-20 text-sm font-mono text-gray-700 dark:text-gray-200">{denom}</div>
                                            <input
                                                type="number"
                                                min={0}
                                                step="1"
                                                value={String(closeDenoms[String(denom)] ?? '')}
                                                onChange={(e) => {
                                                    const raw = e.target.value;
                                                    const count = raw === '' ? 0 : Math.max(0, Math.floor(Number(raw) || 0));
                                                    setCloseDenoms((prev) => ({ ...prev, [String(denom)]: count }));
                                                }}
                                                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono"
                                                placeholder="0"
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">ملاحظات (اختياري)</label>
                                <textarea
                                    value={closeNotes}
                                    onChange={(e) => setCloseNotes(e.target.value)}
                                    className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-20 resize-none dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="سبب الإغلاق أو أي ملاحظات..."
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">سبب الإغلاق عند وجود فرق (إلزامي عند الفرق)</label>
                                <textarea
                                    value={closeForcedReason}
                                    onChange={(e) => setCloseForcedReason(e.target.value)}
                                    className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-20 resize-none dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="اكتب سبب الفرق..."
                                />
                            </div>
                            {closeError && <p className="text-red-500 text-sm text-center">{closeError}</p>}
                            <button
                                type="button"
                                disabled={isClosing}
                                onClick={submitClose}
                                className="w-full py-3 rounded-lg font-bold text-white shadow-lg transition-all bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isClosing ? 'جاري الإغلاق...' : 'إغلاق الوردية'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isOpenModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="bg-gray-100 dark:bg-gray-700 p-4 flex justify-between items-center border-b dark:border-gray-600">
                            <h2 className="text-xl font-bold text-gray-800 dark:text-white">فتح وردية لكاشير</h2>
                            <button
                                type="button"
                                onClick={() => { setIsOpenModal(false); setOpenError(''); }}
                                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
                            >
                                <Icons.XIcon className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            {openError && (
                                <div className="p-3 rounded-lg bg-red-50 text-red-700">{openError}</div>
                            )}
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">اختر الكاشير</label>
                                <select
                                    value={openCashierId}
                                    onChange={(e) => setOpenCashierId(e.target.value)}
                                    className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                >
                                    <option value="">-- اختر --</option>
                                    {cashierOptions
                                        .filter(opt => !openCashierIds.has(opt.id) || opt.id === openCashierId)
                                        .map(opt => (
                                            <option key={opt.id} value={opt.id}>{opt.label}</option>
                                        ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">عهدة البداية</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={openStartAmount}
                                    onChange={(e) => setOpenStartAmount(e.target.value)}
                                    min={0}
                                    className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-lg font-mono dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="0.00"
                                />
                            </div>
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => { setIsOpenModal(false); setOpenError(''); }}
                                    className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="button"
                                    disabled={isOpening}
                                    onClick={async () => {
                                        setOpenError('');
                                        setIsOpening(true);
                                        if (!openCashierId) { setOpenError('اختر الكاشير أولاً'); return; }
                                        const amount = parseFloat(openStartAmount || '0');
                                        if (isNaN(amount) || amount < 0) { setOpenError('القيمة لا يمكن أن تكون سالبة'); setIsOpening(false); return; }
                                        if (!supabase) { setOpenError('Supabase غير متاح'); setIsOpening(false); return; }
                                        const { error } = await supabase.rpc('open_cash_shift_for_cashier', {
                                            p_cashier_id: openCashierId,
                                            p_start_amount: amount
                                        });
                                        if (error) {
                                            const raw = String((error as any)?.message || '');
                                            const low = raw.toLowerCase();
                                            let msg = raw || 'فشل الفتح';
                                            if (low.includes('already has an open shift')) msg = 'هذا الكاشير لديه وردية مفتوحة بالفعل';
                                            else if (low.includes('not allowed')) msg = 'ليس لديك صلاحية تنفيذ هذا الإجراء';
                                            else if (low.includes('invalid start amount')) msg = 'قيمة عهدة البداية غير صالحة';
                                            else if (low.includes('p_cashier_id')) msg = 'اختر الكاشير أولاً';
                                            setOpenError(msg);
                                            setIsOpening(false);
                                            return;
                                        }
                                        setIsOpenModal(false);
                                        setOpenCashierId('');
                                        setOpenStartAmount('0');
                                        await refresh();
                                        setIsOpening(false);
                                    }}
                                    className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700"
                                >
                                    {isOpening ? 'جاري الفتح...' : 'فتح'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {reportShiftId && (
                <>
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[min(90dvh,calc(100dvh-2rem))] overflow-hidden flex flex-col">
                            <div className="bg-gray-100 dark:bg-gray-700 p-4 flex justify-between items-center border-b dark:border-gray-600">
                                <h2 className="text-xl font-bold text-gray-800 dark:text-white">تقرير وردية</h2>
                                <button
                                    type="button"
                                    onClick={() => setReportShiftId(null)}
                                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
                                >
                                    <Icons.XIcon className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-4 overflow-y-auto min-h-0">
                                {reportLoading ? (
                                    <div className="p-6 text-center text-gray-600 dark:text-gray-300">جاري تحميل التقرير...</div>
                                ) : reportError ? (
                                    <div className="p-4 rounded-lg bg-red-50 text-red-700">{reportError}</div>
                                ) : !reportShift ? (
                                    <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-200">لا توجد بيانات.</div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex flex-wrap gap-2 justify-end">
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    const id = `shift-report-print-${reportShiftId}`;
                                                    await sharePdf(
                                                        id,
                                                        'تقرير الوردية',
                                                        `shift-${reportShiftId}.pdf`,
                                                        {
                                                            headerTitle: settings.cafeteriaName?.ar || 'تقارير',
                                                            headerSubtitle: 'تقرير الوردية',
                                                            logoUrl: settings.logoUrl || '',
                                                            footerText: `${settings.address || ''} • ${settings.contactNumber || ''}`,
                                                        }
                                                    );
                                                }}
                                                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                                            >
                                                طباعة/مشاركة PDF
                                            </button>
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    const shiftRow = reportShift;
                                                    const cashierId = String(shiftRow?.cashier_id || '');
                                                    const cashierLabel = cashierLabelById[cashierId] || (cashierId ? cashierId.slice(0, 8) : '-');
                                                    const rows: (string | number)[][] = [
                                                        ['المعرف', String(shiftRow?.id || '')],
                                                        ['الكاشير', cashierLabel],
                                                        ['الحالة', String(shiftRow?.status || '') === 'open' ? 'مفتوحة' : 'مغلقة'],
                                                        ['فتح', shiftRow?.opened_at ? new Date(String(shiftRow.opened_at)).toISOString() : ''],
                                                        ['إغلاق', shiftRow?.closed_at ? new Date(String(shiftRow.closed_at)).toISOString() : ''],
                                                        ['عهدة البداية', (Number(shiftRow?.start_amount) || 0).toFixed(2)],
                                                        ['النقد المتوقع', reportCashExpected.toFixed(2)],
                                                        ['النقد الفعلي', shiftRow?.end_amount === null || shiftRow?.end_amount === undefined ? '' : Number(shiftRow.end_amount).toFixed(2)],
                                                        ['فرق النقد', shiftRow?.difference === null || shiftRow?.difference === undefined ? '' : Number(shiftRow.difference).toFixed(2)],
                                                        ['المبيعات', reportComputed.salesTotal.toFixed(2)],
                                                        ['المرتجعات', reportComputed.refundsTotal.toFixed(2)],
                                                        ['الخصومات', reportComputed.discountsTotal.toFixed(2)],
                                                        ['الصافي', reportComputed.netTotal.toFixed(2)],
                                                        ['عدد الطلبات', reportComputed.ordersCount],
                                                        ['عدد العمليات', reportComputed.paymentsCount],
                                                        ['مرتجعات غير مرتبطة', reportMissingRefunds.toFixed(2)],
                                                    ];
                                                await exportToXlsx(
                                                    ['البند', 'القيمة'],
                                                    rows,
                                                    `shift-${reportShiftId}-summary.xlsx`,
                                                    { sheetName: 'Shift Summary', currencyColumns: [1], currencyFormat: '#,##0.00' }
                                                );
                                                }}
                                                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                                            >
                                                تصدير Excel (ملخص)
                                            </button>
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    const tenderCounts = (reportShift?.tender_counts && typeof reportShift.tender_counts === 'object') ? (reportShift.tender_counts as Record<string, unknown>) : null;
                                                    const methodKeys = new Set<string>();
                                                    Object.keys(reportComputed.totalsByMethod || {}).forEach(k => methodKeys.add(String(k || '-')));
                                                    Object.keys(tenderCounts || {}).forEach(k => methodKeys.add(String(k || '-')));
                                                    methodKeys.add('cash');
                                                    const methods = Array.from(methodKeys).sort((a, b) => (a === 'cash' ? -1 : b === 'cash' ? 1 : a.localeCompare(b)));
                                                    const rows = methods.map((method) => {
                                                        const exp = method.toLowerCase() === 'cash'
                                                            ? reportCashExpected
                                                            : ((reportComputed.totalsByMethod[method]?.in || 0) - (reportComputed.totalsByMethod[method]?.out || 0));
                                                        let counted: string | number = '';
                                                        if (tenderCounts && Object.prototype.hasOwnProperty.call(tenderCounts, method)) {
                                                            const n = Number((tenderCounts as any)[method]);
                                                            counted = Number.isFinite(n) ? n.toFixed(2) : '';
                                                        } else if (method.toLowerCase() === 'cash' && reportShift?.end_amount !== null && reportShift?.end_amount !== undefined) {
                                                            const n = Number(reportShift.end_amount);
                                                            counted = Number.isFinite(n) ? n.toFixed(2) : '';
                                                        }
                                                        const diff = counted === '' ? '' : (Number(counted) - exp).toFixed(2);
                                                        return [methodLabel(method), exp.toFixed(2), counted, diff];
                                                    });
                                                    await exportToXlsx(
                                                        ['طريقة الدفع', 'المتوقع', 'المعدود', 'الفرق'],
                                                        rows,
                                                        `shift-${reportShiftId}-tenders.xlsx`,
                                                        { sheetName: 'Shift Tenders', currencyColumns: [1, 2, 3], currencyFormat: '#,##0.00' }
                                                    );
                                                }}
                                                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                                            >
                                                تصدير Excel (تسوية)
                                            </button>
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    const headers = ['الوقت', 'الاتجاه', 'طريقة الدفع', 'المبلغ', 'تفاصيل', 'المرجع'];
                                                    const rows = reportPayments.map(p => ([
                                                        new Date(String((p as any)?.occurred_at)).toISOString(),
                                                        String((p as any)?.direction || '') === 'in' ? 'داخل' : String((p as any)?.direction || '') === 'out' ? 'خارج' : String((p as any)?.direction || '-'),
                                                        methodLabel(String((p as any)?.method || '')),
                                                        Number((p as any)?.amount || 0).toFixed(2),
                                                        paymentDetails(p),
                                                        (p as any)?.reference_table ? `${String((p as any)?.reference_table)}${(p as any)?.reference_id ? `:${String((p as any)?.reference_id).slice(-6).toUpperCase()}` : ''}` : '-',
                                                    ]));
                                                    await exportToXlsx(
                                                        headers,
                                                        rows,
                                                        `shift-${reportShiftId}-payments.xlsx`,
                                                        { sheetName: 'Shift Payments', currencyColumns: [3], currencyFormat: '#,##0.00' }
                                                    );
                                                }}
                                                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                                            >
                                                تصدير Excel (عمليات)
                                            </button>
                                        </div>
                                        {renderReportBody('screen')}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {reportShift && (
                        <div className="fixed left-[-10000px] top-0 w-[900px] bg-white text-black p-6" id={`shift-report-print-${reportShiftId}`}>
                            <div className="mb-4">
                                <div className="flex items-center gap-3">
                                    {settings.logoUrl ? <img src={settings.logoUrl} alt="" className="h-10 w-auto" /> : null}
                                    <div className="leading-tight">
                                        <div className="font-bold text-black">{settings.cafeteriaName?.ar || settings.cafeteriaName?.en || ''}</div>
                                        <div className="text-xs text-black">{[settings.address || '', settings.contactNumber || ''].filter(Boolean).join(' • ')}</div>
                                    </div>
                                </div>
                            </div>
                            {renderReportBody('print')}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default ShiftReportsScreen;
