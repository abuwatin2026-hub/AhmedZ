/**
 * Shared utility functions used across shift-related screens:
 * - ShiftDetailsScreen
 * - ShiftReportsScreen
 * - ShiftReconciliationScreen
 */

/** Human-readable label for a payment method code */
export const methodLabel = (method: string): string => {
  const m = (method || '').toLowerCase();
  if (m === 'cash') return 'نقد';
  if (m === 'network' || m === 'card') return 'شبكة/بطاقة';
  if (m === 'kuraimi' || m === 'bank') return 'حوالة بنكية';
  if (m === 'ar') return 'آجل';
  if (m === 'store_credit') return 'رصيد عميل';
  return method || '-';
};

/** Format a number to 2 decimal places, or '-' if not finite */
export const formatNumber = (value: unknown): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toFixed(2);
};

/** Truncate a UUID or other string to the last N characters, uppercased */
export const shortId = (value: unknown, take: number = 6): string => {
  const s = String(value || '').trim();
  if (!s) return '';
  return s.slice(-take).toUpperCase();
};

/** Generate a human-readable description for a payment row */
export const paymentDetails = (p: {
  direction?: string;
  reference_table?: string | null;
  reference_id?: string | null;
  data?: Record<string, unknown> | null;
}): string => {
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
