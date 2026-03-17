export const shortId = (value: string | null | undefined, tail: number = 8) => {
  const s = String(value || '').trim();
  if (!s) return '—';
  if (s.length <= tail) return s.toUpperCase();
  return s.slice(-tail).toUpperCase();
};

const UNIT_LABELS_CACHE_KEY = 'AZTA_UNIT_LABELS_MAP';

const readUnitLabelCache = () => {
  try {
    const fromWindow = (globalThis as any)?.__AZTA_UNIT_LABELS_MAP;
    if (fromWindow && typeof fromWindow === 'object') return fromWindow as Record<string, string>;
  } catch {}
  try {
    if (typeof localStorage === 'undefined') return {} as Record<string, string>;
    const raw = localStorage.getItem(UNIT_LABELS_CACHE_KEY);
    if (!raw) return {} as Record<string, string>;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {} as Record<string, string>;
    return parsed as Record<string, string>;
  } catch {
    return {} as Record<string, string>;
  }
};

const getCachedUnitLabelAr = (rawCode: string) => {
  const raw = String(rawCode || '').trim();
  if (!raw) return '';
  const map = readUnitLabelCache();
  const direct = String((map as any)?.[raw] || '').trim();
  if (direct) return direct;
  const normalized = raw.toLowerCase();
  const byNormalized = String((map as any)?.[normalized] || '').trim();
  if (byNormalized) return byNormalized;
  return '';
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
  const raw = String(code || '').trim();
  const cached = getCachedUnitLabelAr(raw);
  if (cached) return cached;
  const s = raw.toLowerCase();
  if (!s) return '—';
  if (/^unit_/i.test(s) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s)) return 'وحدة';
  if (s === 'piece') return 'قطعة';
  if (s === 'pcs' || s === 'pc' || s === 'unit') return 'قطعة';
  if (s === 'pack') return 'باكت';
  if (s === 'packet' || s === 'pkt') return 'باكت';
  if (s === 'carton') return 'كرتون';
  if (s === 'ctn') return 'كرتون';
  if (s === 'box') return 'صندوق';
  if (s === 'bottle') return 'قارورة';
  if (s === 'bag') return 'كيس';
  if (s === 'liter' || s === 'litre' || s === 'l') return 'لتر';
  if (s === 'ml' || s === 'milliliter') return 'مل';
  if (s === 'kg') return 'كغ';
  if (s === 'kilogram') return 'كغ';
  if (s === 'gram' || s === 'g') return 'غ';
  return 'وحدة';
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
/** Translates template class names (e.g. 'PrintablePurchaseOrder') to Arabic */
export const localizeTemplateAr = (template: string | null | undefined): string => {
  const s = String(template || '').trim();
  if (!s) return '—';
  const map: Record<string, string> = {
    PrintablePurchaseOrder:     'نموذج أمر شراء',
    PrintableGrn:               'نموذج استلام بضاعة',
    PrintableOrder:             'نموذج فاتورة مبيعات',
    PrintableQuotation:         'نموذج عرض سعر',
    PrintableReceipt:           'نموذج إيصال دفع',
    PrintableWarehouseTransfer: 'نموذج تحويل مستودع',
    PrintableContract:          'نموذج عقد موظف',
    PrintableContractPDF:       'نموذج عقد موظف (PDF)',
    PrintableGuarantee:         'نموذج ضمان موظف',
    PrintableGuaranteePDF:      'نموذج ضمان موظف (PDF)',
    PrintablePaymentVoucher:    'نموذج سند صرف',
    PrintableReceiptVoucher:    'نموذج سند قبض',
    PrintableJournalVoucher:    'نموذج قيد يومية',
  };
  return map[s] || s;
};

/**
 * Translates auto-generated English detail strings to Arabic.
 * e.g. 'Printed PO PO-MAIN-2026-000004' -> Arabic equivalent
 */
export const localizeDetailsAr = (details: string | null | undefined): string => {
  const raw = String(details || '').trim();
  if (!raw) return '—';
  const patterns: [RegExp, string][] = [
    [/^Printed PO (.+)$/i,         'طباعة أمر شراء رقم $1'],
    [/^Printed GRN (.+)$/i,        'طباعة إشعار استلام رقم $1'],
    [/^Printed Order (.+)$/i,      'طباعة فاتورة رقم $1'],
    [/^Printed Quotation (.+)$/i,  'طباعة عرض سعر رقم $1'],
    [/^Printed Receipt (.+)$/i,    'طباعة إيصال دفع رقم $1'],
    [/^Printed Transfer (.+)$/i,   'طباعة تحويل مستودع رقم $1'],
    [/^Printed Contract (.+)$/i,   'طباعة عقد موظف رقم $1'],
    [/^Printed Guarantee (.+)$/i,  'طباعة ضمان موظف رقم $1'],
    [/^Printed Voucher (.+)$/i,    'طباعة سند رقم $1'],
    [/^Printed Journal (.+)$/i,    'طباعة قيد يومية رقم $1'],
    [/^Printed document (.+)$/i,   'طباعة مستند رقم $1'],
  ];
  for (const [regex, replacement] of patterns) {
    if (regex.test(raw)) return raw.replace(regex, replacement);
  }
  return raw;
};

