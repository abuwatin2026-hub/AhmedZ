import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getSupabaseClient } from '../../supabase';
import * as Icons from '../../components/icons';
import { useAuth } from '../../contexts/AuthContext';
import { useCashShift } from '../../contexts/CashShiftContext';
import { localizeSupabaseError } from '../../utils/errorUtils';
import { exportToXlsx, sharePdf } from '../../utils/export';
import { buildPdfBrandOptions, buildXlsxBrandOptions } from '../../utils/branding';
import { getInvoiceOrderView } from '../../utils/orderUtils';
import type { Order } from '../../types';
import { useSettings } from '../../contexts/SettingsContext';

type ShiftRow = {
  id: string;
  cashier_id: string | null;
  opened_at: string;
  closed_at: string | null;
  start_amount: number | null;
  end_amount: number | null;
  expected_amount: number | null;
  difference: number | null;
  status: 'open' | 'closed' | string;
  notes: string | null;
  forced_close: boolean;
  forced_close_reason: string | null;
  denomination_counts: Record<string, unknown> | null;
  tender_counts: Record<string, unknown> | null;
};

type PaymentRow = {
  id: string;
  direction: 'in' | 'out' | string;
  method: string;
  amount: number;
  currency: string;
  reference_table: string | null;
  reference_id: string | null;
  occurred_at: string;
  created_by: string | null;
  data: Record<string, unknown>;
};

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

const formatNumber = (value: unknown) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toFixed(2);
};

const shortId = (value: unknown, take: number = 6) => {
  const s = String(value || '').trim();
  if (!s) return '';
  return s.slice(-take).toUpperCase();
};

const paymentDetails = (p: PaymentRow) => {
  const refTable = String(p.reference_table || '').trim();
  const refId = String(p.reference_id || '').trim();
  const data = (p.data && typeof p.data === 'object' ? p.data : {}) as Record<string, unknown>;
  const kind = String(data.kind || '').trim();
  const reason = String(data.reason || '').trim();

  if (refTable === 'cash_shifts' && kind === 'cash_movement') {
    if (reason) return reason;
    return p.direction === 'in' ? 'إيداع داخل الوردية' : p.direction === 'out' ? 'صرف داخل الوردية' : 'حركة نقدية';
  }

  if (refTable === 'orders' && refId) {
    return `دفعة طلب ${shortId(refId)}`;
  }

  if (refTable === 'sales_returns' && refId) {
    const orderId = String(data.orderId || '').trim();
    if (orderId) return `مرتجع ${shortId(refId)} للطلب ${shortId(orderId)}`;
    return `مرتجع ${shortId(refId)}`;
  }

  if (reason) return reason;
  if (refTable && refId) return `${refTable}:${shortId(refId)}`;
  if (refTable) return refTable;
  return '-';
};

const ShiftDetailsScreen: React.FC = () => {
  const { shiftId } = useParams<{ shiftId: string }>();
  const navigate = useNavigate();
  const supabase = getSupabaseClient();
  const { user, hasPermission } = useAuth();
  const { currentShift } = useCashShift();
  const { settings } = useSettings();
  const [loading, setLoading] = useState(true);
  const [shift, setShift] = useState<ShiftRow | null>(null);
  const [cashierLabel, setCashierLabel] = useState<string>('');
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [recognizedOrders, setRecognizedOrders] = useState<Order[]>([]);
  const [expectedCash, setExpectedCash] = useState<number | null>(null);
  const [error, setError] = useState<string>('');
  const [resolvedShiftId, setResolvedShiftId] = useState<string | null>(shiftId || null);
  const [cashMoveOpen, setCashMoveOpen] = useState(false);
  const [cashMoveDirection, setCashMoveDirection] = useState<'in' | 'out'>('in');
  const [cashMoveAmount, setCashMoveAmount] = useState('');
  const [cashMoveReason, setCashMoveReason] = useState('');
  const [cashMoveError, setCashMoveError] = useState('');
  const [cashMoveLoading, setCashMoveLoading] = useState(false);

  useEffect(() => {
    if (shiftId) {
      setResolvedShiftId(shiftId);
      return;
    }
    if (currentShift?.id) {
      setResolvedShiftId(currentShift.id);
      return;
    }
    const loadMyOpenShift = async () => {
      if (!supabase) return;
      if (!user?.id) return;
      try {
        const { data, error } = await supabase
          .from('cash_shifts')
          .select('id')
          .eq('cashier_id', user.id)
          .eq('status', 'open')
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          setResolvedShiftId(null);
          return;
        }
        setResolvedShiftId(data?.id ? String(data.id) : null);
      } catch {
        setResolvedShiftId(null);
      }
    };
    void loadMyOpenShift();
  }, [shiftId, currentShift?.id, supabase, user?.id]);

  useEffect(() => {
    const load = async () => {
      if (!supabase) return;
      if (!resolvedShiftId) {
        setShift(null);
        setPayments([]);
        setExpectedCash(null);
        setError('');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const { data: shiftData, error: shiftError } = await supabase
          .from('cash_shifts')
          .select('*')
          .eq('id', resolvedShiftId)
          .single();
        if (shiftError) throw shiftError;
        if (!shiftData) throw new Error('تعذر تحميل الوردية.');

        const mapped: ShiftRow = {
          id: String(shiftData.id),
          cashier_id: shiftData.cashier_id ? String(shiftData.cashier_id) : null,
          opened_at: String(shiftData.opened_at),
          closed_at: shiftData.closed_at ? String(shiftData.closed_at) : null,
          start_amount: shiftData.start_amount === null || shiftData.start_amount === undefined ? null : Number(shiftData.start_amount),
          end_amount: shiftData.end_amount === null || shiftData.end_amount === undefined ? null : Number(shiftData.end_amount),
          expected_amount: shiftData.expected_amount === null || shiftData.expected_amount === undefined ? null : Number(shiftData.expected_amount),
          difference: shiftData.difference === null || shiftData.difference === undefined ? null : Number(shiftData.difference),
          status: shiftData.status,
          notes: shiftData.notes ? String(shiftData.notes) : null,
          forced_close: Boolean(shiftData.forced_close),
          forced_close_reason: shiftData.forced_close_reason ? String(shiftData.forced_close_reason) : null,
          denomination_counts: shiftData.denomination_counts && typeof shiftData.denomination_counts === 'object' ? (shiftData.denomination_counts as Record<string, unknown>) : null,
          tender_counts: shiftData.tender_counts && typeof shiftData.tender_counts === 'object' ? (shiftData.tender_counts as Record<string, unknown>) : null,
        };
        setShift(mapped);

        if (mapped.cashier_id) {
          const { data: cashier, error: cashierError } = await supabase
            .from('admin_users')
            .select('full_name, username, email')
            .eq('auth_user_id', mapped.cashier_id)
            .maybeSingle();
          if (!cashierError && cashier) {
            const label = String(cashier.full_name || cashier.username || cashier.email || '').trim();
            setCashierLabel(label);
          }
        }

        const paymentsSelect = 'id,direction,method,amount,currency,reference_table,reference_id,occurred_at,created_by,data';
        const { data: shiftLinked, error: shiftLinkedError } = await supabase
          .from('payments')
          .select(paymentsSelect)
          .eq('shift_id', resolvedShiftId)
          .order('occurred_at', { ascending: false })
          .limit(2000);
        if (shiftLinkedError) throw shiftLinkedError;

        const mappedPayments: PaymentRow[] = (Array.isArray(shiftLinked) ? shiftLinked : []).map((p: any) => ({
          id: String(p.id),
          direction: p.direction,
          method: String(p.method || ''),
          amount: Number(p.amount) || 0,
          currency: String(p.currency || 'YER'),
          reference_table: p.reference_table ? String(p.reference_table) : null,
          reference_id: p.reference_id ? String(p.reference_id) : null,
          occurred_at: String(p.occurred_at),
          created_by: p.created_by ? String(p.created_by) : null,
          data: (p.data && typeof p.data === 'object' ? p.data : {}) as Record<string, unknown>,
        }));
        setPayments(mappedPayments);

        const orderIds = Array.from(
          new Set(
            mappedPayments
              .filter(p => p.reference_table === 'orders' && p.reference_id)
              .map(p => String(p.reference_id))
              .filter(Boolean)
          )
        );
        if (orderIds.length) {
          const chunkSize = 200;
          const nextOrders: Order[] = [];
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
          const effective = nextOrders.filter(o => o.status === 'delivered' && Boolean(o.paidAt));
          setRecognizedOrders(effective);
        } else {
          setRecognizedOrders([]);
        }

        const { data: expectedData, error: expectedError } = await supabase.rpc('calculate_cash_shift_expected', { p_shift_id: resolvedShiftId });
        if (!expectedError) {
          const numeric = Number(expectedData);
          setExpectedCash(Number.isFinite(numeric) ? numeric : null);
        }
      } catch (err: any) {
        const localized = localizeSupabaseError(err);
        setError(localized || 'تعذر تحميل تفاصيل الوردية.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [supabase, resolvedShiftId]);

  const submitCashMove = async () => {
    if (!supabase) return;
    if (!resolvedShiftId) return;
    setCashMoveError('');
    const canCashIn = hasPermission('cashShifts.cashIn') || hasPermission('cashShifts.manage');
    const canCashOut = hasPermission('cashShifts.cashOut') || hasPermission('cashShifts.manage');
    if (cashMoveDirection === 'in' && !canCashIn) {
      setCashMoveError('ليس لديك صلاحية الإيداع داخل الوردية.');
      return;
    }
    if (cashMoveDirection === 'out' && !canCashOut) {
      setCashMoveError('ليس لديك صلاحية الصرف داخل الوردية.');
      return;
    }
    if (cashMoveDirection === 'out' && !cashMoveReason.trim()) {
      setCashMoveError('يرجى إدخال سبب الصرف.');
      return;
    }
    const amount = Number(cashMoveAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setCashMoveError('يرجى إدخال مبلغ صحيح.');
      return;
    }
    setCashMoveLoading(true);
    try {
      const { error } = await supabase.rpc('record_shift_cash_movement', {
        p_shift_id: resolvedShiftId,
        p_direction: cashMoveDirection,
        p_amount: amount,
        p_reason: cashMoveReason.trim() || null,
        p_occurred_at: null,
      });
      if (error) throw error;

      const paymentsSelect = 'id,direction,method,amount,currency,reference_table,reference_id,occurred_at,created_by,data';
      const { data: shiftLinked, error: shiftLinkedError } = await supabase
        .from('payments')
        .select(paymentsSelect)
        .eq('shift_id', resolvedShiftId)
        .order('occurred_at', { ascending: false })
        .limit(200);
      if (shiftLinkedError) throw shiftLinkedError;
      setPayments(
        (Array.isArray(shiftLinked) ? shiftLinked : []).map((p: any) => ({
          id: String(p.id),
          direction: p.direction,
          method: String(p.method || ''),
          amount: Number(p.amount) || 0,
          currency: String(p.currency || 'YER'),
          reference_table: p.reference_table ? String(p.reference_table) : null,
          reference_id: p.reference_id ? String(p.reference_id) : null,
          occurred_at: String(p.occurred_at),
          created_by: p.created_by ? String(p.created_by) : null,
          data: (p.data && typeof p.data === 'object' ? p.data : {}) as Record<string, unknown>,
        }))
      );

      setCashMoveOpen(false);
      setCashMoveAmount('');
      setCashMoveReason('');
    } catch (err: any) {
      const localized = localizeSupabaseError(err);
      setCashMoveError(localized || 'تعذر تسجيل العملية.');
    } finally {
      setCashMoveLoading(false);
    }
  };

  const computed = useMemo(() => {
    const totalsByMethod: Record<string, { in: number; out: number }> = {};
    for (const p of payments) {
      const key = p.method || '-';
      if (!totalsByMethod[key]) totalsByMethod[key] = { in: 0, out: 0 };
      if (p.direction === 'in') totalsByMethod[key].in += Number(p.amount) || 0;
      if (p.direction === 'out') totalsByMethod[key].out += Number(p.amount) || 0;
    }
    const cash = totalsByMethod['cash'] || { in: 0, out: 0 };
    const refundsTotal = payments
      .filter(p => p.direction === 'out' && p.reference_table === 'sales_returns')
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const salesTotal = recognizedOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const discountsTotal = recognizedOrders.reduce((sum, o) => sum + (Number(o.discountAmount) || 0), 0);
    return { totalsByMethod, cash, refundsTotal, salesTotal, discountsTotal };
  }, [payments, recognizedOrders]);

  if (loading) return <div className="p-8 text-center">جاري تحميل التفاصيل...</div>;

  if (!shift) {
    const backPath = shiftId ? '/admin/shift-reports' : '/admin/dashboard';
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold dark:text-white">{shiftId ? 'تفاصيل الوردية' : 'ورديتي'}</h1>
          <button
            type="button"
            onClick={() => navigate(backPath)}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            رجوع
          </button>
        </div>
        {error ? (
          <div className="p-4 rounded-lg bg-red-50 text-red-700">{error}</div>
        ) : (
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
            لا توجد وردية مفتوحة حاليًا.
          </div>
        )}
      </div>
    );
  }

  const expectedDisplay = shift.status === 'closed' && shift.expected_amount !== null ? shift.expected_amount : expectedCash;
  const canCashIn = hasPermission('cashShifts.cashIn') || hasPermission('cashShifts.manage');
  const canCashOut = hasPermission('cashShifts.cashOut') || hasPermission('cashShifts.manage');
  const canCashMove = shift.status === 'open' && (canCashIn || canCashOut);
  const reportElementId = 'shift-report-print';

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="print-only mb-4">
        <div className="flex items-center gap-3">
          {settings.logoUrl ? <img src={settings.logoUrl} alt="" className="h-10 w-auto" /> : null}
          <div className="leading-tight">
            <div className="font-bold text-black">{settings.cafeteriaName?.ar || settings.cafeteriaName?.en || ''}</div>
            <div className="text-xs text-black">{[settings.address || '', settings.contactNumber || ''].filter(Boolean).join(' • ')}</div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold dark:text-white">{shiftId ? 'تفاصيل الوردية' : 'ورديتي'}</h1>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {cashierLabel || (shift.cashier_id ? shift.cashier_id.slice(0, 8) : '-')}{' '}
            <span className="mx-2">•</span>
            {new Date(shift.opened_at).toLocaleString()}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
          onClick={async () => {
            if (!shift) return;
            await sharePdf(
              reportElementId,
              'تقرير الوردية',
              `shift-${shift.id}.pdf`,
              buildPdfBrandOptions(settings, 'تقرير الوردية', { pageNumbers: true })
            );
          }}
          className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          طباعة/مشاركة
        </button>
          <button
            type="button"
            onClick={async () => {
              if (!shift) return;
              const expectedDisplay = shift.status === 'closed' && shift.expected_amount !== null ? shift.expected_amount : expectedCash;
              const expCash = Number.isFinite(Number(expectedDisplay)) ? Number(expectedDisplay) : (Number(shift.start_amount) || 0) + (computed.cash.in || 0) - (computed.cash.out || 0);
              const sectionRows: (string | number)[][] = [
                ['معلومات', 'المعرف', shift.id],
                ['معلومات', 'الحالة', shift.status === 'open' ? 'مفتوحة' : 'مغلقة'],
                ['معلومات', 'فتح', new Date(shift.opened_at).toISOString()],
                ['معلومات', 'إغلاق', shift.closed_at ? new Date(shift.closed_at).toISOString() : ''],
                ['ملخص', 'عهدة البداية', formatNumber(shift.start_amount)],
                ['ملخص', 'النقد المتوقع', expCash.toFixed(2)],
                ['ملخص', 'النقد الفعلي', formatNumber(shift.end_amount)],
                ['ملخص', 'فرق النقد', formatNumber(shift.difference)],
                ['ملخص', 'المبيعات', computed.salesTotal.toFixed(2)],
                ['ملخص', 'المرتجعات', computed.refundsTotal.toFixed(2)],
                ['ملخص', 'الخصومات', computed.discountsTotal.toFixed(2)],
                ['ملخص', 'الصافي', (computed.salesTotal - computed.refundsTotal).toFixed(2)],
                ['ملخص', 'عدد الطلبات', recognizedOrders.length],
                ['ملخص', 'عدد العمليات', payments.length],
              ];
              const tenderCounts = (shift.tender_counts && typeof shift.tender_counts === 'object') ? (shift.tender_counts as Record<string, unknown>) : null;
              const methodKeys = new Set<string>();
              Object.keys(computed.totalsByMethod || {}).forEach(k => methodKeys.add(String(k || '-')));
              Object.keys(tenderCounts || {}).forEach(k => methodKeys.add(String(k || '-')));
              methodKeys.add('cash');
              const methods = Array.from(methodKeys).sort((a, b) => (a === 'cash' ? -1 : b === 'cash' ? 1 : a.localeCompare(b)));
              for (const method of methods) {
                const exp = method.toLowerCase() === 'cash'
                  ? expCash
                  : ((computed.totalsByMethod[method]?.in || 0) - (computed.totalsByMethod[method]?.out || 0));
                let counted: number | null = null;
                if (tenderCounts && Object.prototype.hasOwnProperty.call(tenderCounts, method)) {
                  const n = Number((tenderCounts as any)[method]);
                  counted = Number.isFinite(n) ? n : null;
                } else if (method.toLowerCase() === 'cash' && shift.end_amount !== null && shift.end_amount !== undefined) {
                  const n = Number(shift.end_amount);
                  counted = Number.isFinite(n) ? n : null;
                }
                const diff = counted !== null ? counted - exp : null;
                sectionRows.push([
                  'تسوية',
                  methodLabel(method),
                  `expected=${exp.toFixed(2)} counted=${counted === null ? '' : counted.toFixed(2)} diff=${diff === null ? '' : diff.toFixed(2)}`
                ]);
              }
              await exportToXlsx(
                ['القسم', 'البند', 'القيمة'], 
                sectionRows, 
                `shift-${shift.id}-summary.xlsx`,
                { sheetName: 'Shift Summary', ...buildXlsxBrandOptions(settings, 'الوردية', 3, { periodText: `التاريخ: ${new Date().toLocaleDateString('ar-SA')}` }) }
              );
            }}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            تصدير Excel (ملخص)
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!shift) return;
              const headers = ['الوقت', 'الاتجاه', 'طريقة الدفع', 'المبلغ', 'تفاصيل', 'المرجع'];
              const rows = payments.map(p => ([
                new Date(p.occurred_at).toISOString(),
                p.direction === 'in' ? 'داخل' : p.direction === 'out' ? 'خارج' : String(p.direction || '-'),
                methodLabel(p.method),
                Number(p.amount || 0).toFixed(2),
                paymentDetails(p),
                p.reference_table ? `${p.reference_table}${p.reference_id ? `:${String(p.reference_id).slice(-6).toUpperCase()}` : ''}` : '-',
              ]));
              await exportToXlsx(
                headers, 
                rows, 
                `shift-${shift.id}-payments.xlsx`,
                { sheetName: 'Shift Payments', currencyColumns: [3], currencyFormat: '#,##0.00', ...buildXlsxBrandOptions(settings, 'عمليات الوردية', headers.length, { periodText: `التاريخ: ${new Date().toLocaleDateString('ar-SA')}` }) }
              );
            }}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            تصدير Excel (عمليات)
          </button>
          {canCashMove && (
            <button
              type="button"
              onClick={() => {
                setCashMoveError('');
                setCashMoveDirection(canCashIn ? 'in' : 'out');
                setCashMoveAmount('');
                setCashMoveReason('');
                setCashMoveOpen(true);
              }}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >
              صرف/إيداع
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate(shiftId ? '/admin/shift-reports' : '/admin/dashboard')}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            رجوع
          </button>
        </div>
      </div>

      {error && <div className="p-4 rounded-lg bg-red-50 text-red-700">{error}</div>}

      {cashMoveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md max-h-[min(90dvh,calc(100dvh-2rem))] overflow-hidden flex flex-col">
            <div className="bg-gray-100 dark:bg-gray-700 p-4 flex justify-between items-center border-b dark:border-gray-600">
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">صرف/إيداع</h2>
              <button
                type="button"
                onClick={() => setCashMoveOpen(false)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
              >
                <Icons.XIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto min-h-0">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">الاتجاه</label>
                <select
                  value={cashMoveDirection}
                  onChange={(e) => setCashMoveDirection(e.target.value === 'out' ? 'out' : 'in')}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                >
                  {canCashIn && <option value="in">داخل</option>}
                  {canCashOut && <option value="out">خارج</option>}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">المبلغ</label>
                <input
                  type="number"
                  step="0.01"
                  value={cashMoveAmount}
                  onChange={(e) => setCashMoveAmount(e.target.value)}
                  className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-lg font-mono dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                  {cashMoveDirection === 'out' ? 'السبب (مطلوب)' : 'السبب (اختياري)'}
                </label>
                <textarea
                  value={cashMoveReason}
                  onChange={(e) => setCashMoveReason(e.target.value)}
                  className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-20 resize-none dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="سبب العملية..."
                />
              </div>
              {cashMoveError && <p className="text-red-500 text-sm text-center">{cashMoveError}</p>}
              <button
                type="button"
                disabled={cashMoveLoading}
                onClick={submitCashMove}
                className="w-full py-3 rounded-lg font-bold text-white shadow-lg transition-all bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cashMoveLoading ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div id={reportElementId} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 dark:text-gray-300">الحالة</div>
          <div className="mt-2 flex items-center gap-2">
            {shift.status === 'open' ? <Icons.ClockIcon className="w-5 h-5 text-green-600" /> : <Icons.CheckIcon className="w-5 h-5 text-gray-600" />}
            <span className="font-bold dark:text-white">{shift.status === 'open' ? 'مفتوحة' : 'مغلقة'}</span>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 dark:text-gray-300">عهدة البداية</div>
          <div className="mt-2 text-xl font-bold font-mono text-green-600">{formatNumber(shift.start_amount)}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 dark:text-gray-300">النقد المتوقع</div>
          <div className="mt-2 text-xl font-bold font-mono text-indigo-600">{formatNumber(expectedDisplay)}</div>
          <div className="mt-1 text-xs text-gray-400">
            داخل: {formatNumber(computed.cash.in)} — خارج: {formatNumber(computed.cash.out)}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 dark:text-gray-300">النقد الفعلي</div>
          <div className="mt-2 text-xl font-bold font-mono dark:text-white">{formatNumber(shift.end_amount)}</div>
          <div className={`mt-1 text-xs ${shift.difference && Math.abs(shift.difference) > 0.01 ? 'text-red-500' : 'text-gray-400'}`}>
            الفرق: {formatNumber(shift.difference)}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="font-bold dark:text-white">ملخص الوردية</div>
          <div className="text-xs text-gray-500 dark:text-gray-300">{recognizedOrders.length} طلب</div>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-xs text-gray-500 dark:text-gray-300">المبيعات</div>
            <div className="mt-1 text-lg font-bold font-mono dark:text-white">{computed.salesTotal.toFixed(2)}</div>
          </div>
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-xs text-gray-500 dark:text-gray-300">المرتجعات</div>
            <div className="mt-1 text-lg font-bold font-mono text-rose-600 dark:text-rose-400">{computed.refundsTotal.toFixed(2)}</div>
          </div>
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-xs text-gray-500 dark:text-gray-300">الخصومات</div>
            <div className="mt-1 text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">{computed.discountsTotal.toFixed(2)}</div>
          </div>
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <div className="text-xs text-gray-500 dark:text-gray-300">الصافي</div>
            <div className="mt-1 text-lg font-bold font-mono dark:text-white">{(computed.salesTotal - computed.refundsTotal).toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="font-bold dark:text-white">ملخص طرق الدفع (متوقع)</div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-300">التسوية إلزامية للنقد فقط. باقي الطرق للعرض.</div>
        </div>
        <div className="p-4">
          {Object.keys(computed.totalsByMethod).length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-300">لا توجد عمليات.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(computed.totalsByMethod)
                .sort(([a], [b]) => (a === 'cash' ? -1 : b === 'cash' ? 1 : a.localeCompare(b)))
                .map(([method, totals]) => {
                  const net = (totals?.in || 0) - (totals?.out || 0);
                  return (
                    <div key={method} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-bold dark:text-gray-200">{methodLabel(method)}</div>
                        <div className="text-sm font-mono dark:text-gray-200">{net.toFixed(2)}</div>
                      </div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-300">
                        داخل: <span className="font-mono">{(totals?.in || 0).toFixed(2)}</span> — خارج:{' '}
                        <span className="font-mono">{(totals?.out || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {(shift.status === 'closed' && (shift.forced_close || shift.forced_close_reason || shift.denomination_counts || shift.tender_counts)) && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="font-bold dark:text-white">بيانات الإغلاق</div>
          </div>
          <div className="p-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="text-gray-500 dark:text-gray-300">إغلاق قسري</div>
              <div className="font-bold dark:text-white">{shift.forced_close ? 'نعم' : 'لا'}</div>
            </div>
            {shift.forced_close_reason && (
              <div>
                <div className="text-gray-500 dark:text-gray-300 mb-1">سبب الإغلاق</div>
                <div className="dark:text-white whitespace-pre-wrap">{shift.forced_close_reason}</div>
              </div>
            )}
            {shift.denomination_counts && (
              <div>
                <div className="text-gray-500 dark:text-gray-300 mb-1">عدّ الفئات</div>
                <pre className="text-xs p-3 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-gray-200 overflow-auto">{JSON.stringify(shift.denomination_counts, null, 2)}</pre>
              </div>
            )}
            {shift.tender_counts && (
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <div className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">تسوية حسب طريقة الدفع (المعدود)</div>
                <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 dark:text-gray-300 mb-2">
                  <div className="col-span-4">الطريقة</div>
                  <div className="col-span-3 text-right">المتوقع</div>
                  <div className="col-span-3 text-right">المعدود</div>
                  <div className="col-span-2 text-right">الفرق</div>
                </div>
                <div className="space-y-2">
                  {Object.entries(shift.tender_counts)
                    .map(([k, v]) => [String(k || '-'), v] as const)
                    .sort(([a], [b]) => (a === 'cash' ? -1 : b === 'cash' ? 1 : a.localeCompare(b)))
                    .map(([method, rawCounted]) => {
                      const isCash = method.toLowerCase() === 'cash';
                      const exp = isCash
                        ? (Number(expectedDisplay) || 0)
                        : (((computed.totalsByMethod[method]?.in || 0) - (computed.totalsByMethod[method]?.out || 0)));
                      const counted = Number(rawCounted);
                      const diff = Number.isFinite(counted) ? counted - exp : NaN;
                      return (
                        <div key={method} className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-4 text-sm dark:text-gray-200">{methodLabel(method)}</div>
                          <div className="col-span-3 text-right text-sm font-mono dark:text-gray-200">{exp.toFixed(2)}</div>
                          <div className="col-span-3 text-right text-sm font-mono dark:text-gray-200">{Number.isFinite(counted) ? counted.toFixed(2) : '-'}</div>
                          <div className={`col-span-2 text-right text-sm font-mono ${Number.isFinite(diff) && Math.abs(diff) > 0.01 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}>
                            {Number.isFinite(diff) ? (diff > 0 ? '+' : '') + diff.toFixed(2) : '-'}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="font-bold dark:text-white">العمليات المرتبطة بالوردية</div>
          <div className="text-xs text-gray-500 dark:text-gray-300">{payments.length} عملية</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="p-4 text-sm font-medium text-gray-500 dark:text-gray-300">الوقت</th>
                <th className="p-4 text-sm font-medium text-gray-500 dark:text-gray-300">الاتجاه</th>
                <th className="p-4 text-sm font-medium text-gray-500 dark:text-gray-300">الطريقة</th>
                <th className="p-4 text-sm font-medium text-gray-500 dark:text-gray-300">المبلغ</th>
                <th className="p-4 text-sm font-medium text-gray-500 dark:text-gray-300">تفاصيل</th>
                <th className="p-4 text-sm font-medium text-gray-500 dark:text-gray-300">المرجع</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {payments.length === 0 ? (
                <tr>
                  <td className="p-6 text-center text-gray-500 dark:text-gray-300" colSpan={6}>
                    لا توجد عمليات مسجلة لهذه الوردية.
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="p-4 text-sm font-mono dark:text-gray-300">
                      {new Date(p.occurred_at).toLocaleString()}
                    </td>
                    <td className="p-4 text-sm dark:text-gray-300">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${p.direction === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                        {p.direction === 'in' ? 'داخل' : 'خارج'}
                      </span>
                    </td>
                    <td className="p-4 text-sm dark:text-gray-300">{p.method}</td>
                    <td className="p-4 text-sm font-mono dark:text-gray-300">{formatNumber(p.amount)}</td>
                    <td className="p-4 text-sm text-gray-700 dark:text-gray-200">{paymentDetails(p)}</td>
                    <td className="p-4 text-sm text-gray-500 dark:text-gray-300">
                      {p.reference_table ? `${p.reference_table}${p.reference_id ? `:${String(p.reference_id).slice(-6).toUpperCase()}` : ''}` : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  );
};

export default ShiftDetailsScreen;
