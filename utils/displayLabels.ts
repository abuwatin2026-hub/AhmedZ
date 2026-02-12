export const shortId = (value: string | null | undefined, tail: number = 8) => {
  const s = String(value || '').trim();
  if (!s) return '—';
  if (s.length <= tail) return s.toUpperCase();
  return s.slice(-tail).toUpperCase();
};

export const localizeDocStatusAr = (status: string | null | undefined) => {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return '—';
  if (s === 'posted') return 'مرحل';
  if (s === 'draft') return 'مسودة';
  if (s === 'approved') return 'معتمد';
  if (s === 'pending') return 'معلق';
  if (s === 'failed') return 'فشل';
  if (s === 'cancelled' || s === 'canceled') return 'ملغي';
  if (s === 'completed') return 'مكتمل';
  return status || '—';
};

export const localizeDocTypeAr = (docType: string | null | undefined) => {
  const s = String(docType || '').trim().toLowerCase();
  if (!s) return '—';
  if (s === 'grn') return 'إشعار استلام (GRN)';
  if (s === 'po') return 'أمر شراء (PO)';
  if (s === 'invoice') return 'فاتورة';
  if (s === 'delivery_note') return 'سند تسليم';
  if (s === 'receipt_voucher') return 'سند قبض';
  if (s === 'journal_voucher') return 'قيد يومية';
  return docType || '—';
};

export const localizeUomCodeAr = (code: string | null | undefined, name?: string | null) => {
  const rawName = String(name || '').trim();
  if (rawName) return rawName;
  const s = String(code || '').trim().toLowerCase();
  if (!s) return '—';
  if (s === 'piece') return 'قطعة';
  if (s === 'pack') return 'باكت';
  if (s === 'carton') return 'كرتون';
  if (s === 'box') return 'صندوق';
  if (s === 'bottle') return 'قارورة';
  if (s === 'kg') return 'كغ';
  if (s === 'gram' || s === 'g') return 'غ';
  return code || '—';
};

export const localizeMovementTypeAr = (movementType: string | null | undefined) => {
  const s = String(movementType || '').trim().toLowerCase();
  if (!s) return '—';
  if (s === 'purchase_in') return 'استلام مشتريات';
  if (s === 'sale_out') return 'صرف بيع';
  if (s === 'transfer_in') return 'تحويل وارد';
  if (s === 'transfer_out') return 'تحويل صادر';
  if (s === 'adjustment_in') return 'تسوية زيادة';
  if (s === 'adjustment_out') return 'تسوية نقص';
  if (s === 'wastage_out') return 'هدر';
  if (s === 'expired_out') return 'منتهي';
  if (s === 'return_in') return 'مرتجع وارد';
  if (s === 'return_out') return 'مرتجع صادر';
  return movementType || '—';
};

export const localizeSourceTableAr = (sourceTable: string | null | undefined) => {
  const s = String(sourceTable || '').trim().toLowerCase();
  if (!s) return '—';
  if (s === 'payments') return 'دفعات';
  if (s === 'purchase_orders') return 'أوامر شراء';
  if (s === 'purchase_receipts') return 'استلام مشتريات';
  if (s === 'orders') return 'مبيعات/فواتير';
  if (s === 'expenses') return 'مصاريف';
  if (s === 'import_expenses') return 'مصاريف استيراد';
  if (s === 'inventory_movements') return 'حركات مخزون';
  if (s === 'import_shipments') return 'شحنات';
  if (s === 'party_fx_revaluation') return 'إعادة تقييم عملة (أطراف)';
  if (s === 'journal_vouchers') return 'قيود يومية';
  return sourceTable || '—';
};

export const localizeSourceEventAr = (sourceEvent: string | null | undefined) => {
  const raw = String(sourceEvent || '').trim();
  const s = raw.toLowerCase();
  if (!s) return '';
  if (s.startsWith('in:orders:')) return 'تحصيل مبيعات';
  if (s.startsWith('out:purchase_orders:')) return 'دفع مورد';
  if (s.startsWith('out:expenses:')) return 'دفع مصروف';
  if (s.startsWith('out:import_expenses:')) return 'دفع مصروف استيراد';
  if (s === 'accrual') return 'استحقاق';
  if (s === 'delivered') return 'تسليم';
  if (s === 'invoiced') return 'فوتره';
  if (s === 'landed_cost_close') return 'إغلاق تكاليف شحنة';
  if (s === 'landed_cost_cogs_adjust') return 'تعديل تكلفة مبيعات (شحنة)';
  if (s === 'purchase_in') return 'استلام مشتريات';
  if (s === 'sale_out') return 'صرف بيع';
  if (s === 'out') return 'صرف';
  if (s === 'in') return 'قبض';
  if (s === 'created') return 'إنشاء';
  if (s === 'approved') return 'اعتماد';
  return raw;
};

export const localizeOpenStatusAr = (openStatus: string | null | undefined) => {
  const s = String(openStatus || '').trim().toLowerCase();
  if (!s) return '—';
  if (s === 'open') return 'مفتوح';
  if (s === 'partially_settled') return 'مجزّأ';
  if (s === 'settled' || s === 'closed') return 'مُسوّى';
  return openStatus || '—';
};

export const formatSourceRefAr = (sourceTable: string | null | undefined, sourceEvent: string | null | undefined, sourceId: string | null | undefined) => {
  const t = localizeSourceTableAr(sourceTable);
  const e = localizeSourceEventAr(sourceEvent);
  const label = [t, e].filter((x) => String(x || '').trim()).join(' • ');
  const id = shortId(sourceId);
  if (label && label !== '—') return `${label} • ${id}`;
  return id;
};

