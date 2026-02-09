import { useMemo, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { Link } from 'react-router-dom';
import Invoice from '../../components/Invoice';
import PrintableInvoice, { generateZatcaTLV } from '../../components/admin/PrintableInvoice';
import PrintableOrder from '../../components/admin/PrintableOrder';
import PrintableReceiptVoucher from '../../components/admin/vouchers/PrintableReceiptVoucher';
import PrintablePaymentVoucher from '../../components/admin/vouchers/PrintablePaymentVoucher';
import PrintableJournalVoucher from '../../components/admin/vouchers/PrintableJournalVoucher';
import PrintablePurchaseOrder from '../../components/admin/documents/PrintablePurchaseOrder';
import PrintableGrn from '../../components/admin/documents/PrintableGrn';
import PrintableWarehouseTransfer from '../../components/admin/documents/PrintableWarehouseTransfer';
import { useSettings } from '../../contexts/SettingsContext';
import { useToast } from '../../contexts/ToastContext';
import { printContent } from '../../utils/printUtils';
import { printPdfFromElement } from '../../utils/export';
import { AZTA_IDENTITY } from '../../config/identity';
import type { Addon, CartItem, Order, PurchaseOrder } from '../../types';
import type { VoucherLine } from '../../components/admin/vouchers/PrintableVoucherBase';
import type { PrintableGrnData } from '../../components/admin/documents/PrintableGrn';
import type { PrintableWarehouseTransferData } from '../../components/admin/documents/PrintableWarehouseTransfer';

type TemplateKey =
  | 'invoice_a4'
  | 'invoice_thermal_58'
  | 'invoice_thermal_80'
  | 'delivery_note'
  | 'receipt_voucher'
  | 'payment_voucher'
  | 'journal_voucher'
  | 'purchase_order'
  | 'grn'
  | 'warehouse_transfer';

const nowIso = () => new Date().toISOString();

const buildMockOrder = (): Order => {
  const addonCheese: Addon = { id: 'addon-1', name: { ar: 'جبن', en: 'Cheese' }, price: 300 };
  const addonSpicy: Addon = { id: 'addon-2', name: { ar: 'حار', en: 'Spicy' }, price: 0 };

  const items: CartItem[] = [
    {
      id: 'item-1',
      name: { ar: 'شاورما دجاج', en: 'Chicken Shawarma' },
      description: { ar: 'وجبة طازجة', en: 'Fresh meal' },
      price: 1500,
      imageUrl: '',
      category: 'sandwiches',
      addons: [addonCheese, addonSpicy],
      quantity: 2,
      selectedAddons: {
        [addonCheese.id]: { addon: addonCheese, quantity: 1 },
        [addonSpicy.id]: { addon: addonSpicy, quantity: 1 },
      },
      cartItemId: 'cart-1',
    },
    {
      id: 'item-2',
      name: { ar: 'عصير مانجو', en: 'Mango Juice' },
      description: { ar: 'عصير طبيعي', en: 'Fresh juice' },
      price: 900,
      imageUrl: '',
      category: 'drinks',
      addons: [],
      quantity: 1,
      selectedAddons: {},
      cartItemId: 'cart-2',
    },
  ];

  const subtotal = 3900;
  const deliveryFee = 0;
  const taxRate = 15;
  const taxAmount = Number(((subtotal + deliveryFee) * (taxRate / 100)).toFixed(2));
  const total = Number((subtotal + deliveryFee + taxAmount).toFixed(2));
  const issuedAt = nowIso();

  return {
    id: '00000000-0000-0000-0000-000000000001',
    orderSource: 'in_store',
    warehouseId: 'warehouse-1',
    items,
    subtotal,
    deliveryFee,
    deliveryZoneId: '',
    total,
    customerName: 'عميل تجريبي',
    phoneNumber: '777777777',
    address: 'صنعاء - شارع الزبيري',
    paymentMethod: 'cash',
    status: 'delivered',
    createdAt: issuedAt,
    paidAt: issuedAt,
    invoiceIssuedAt: issuedAt,
    invoiceNumber: 'INV-TEST-0001',
    invoicePrintCount: 0,
    invoiceSnapshot: {
      issuedAt,
      invoiceNumber: 'INV-TEST-0001',
      createdAt: issuedAt,
      orderSource: 'in_store',
      currency: 'YER',
      fxRate: 0,
      items,
      subtotal,
      deliveryFee,
      discountAmount: 0,
      total,
      paymentMethod: 'cash',
      customerName: 'عميل تجريبي',
      phoneNumber: '777777777',
      address: 'صنعاء - شارع الزبيري',
      deliveryZoneId: '',
      taxAmount,
      taxRate,
      invoiceTerms: 'cash',
      netDays: 0,
      dueDate: '',
    },
    currency: 'YER',
    fxRate: 0,
    taxAmount,
    taxRate,
  };
};

const buildMockPurchaseOrder = (): PurchaseOrder => {
  const purchaseDate = nowIso();
  return {
    id: 'po-0001',
    supplierId: 'supplier-1',
    supplierName: 'مورد تجريبي',
    status: 'completed',
    poNumber: 'PO-TEST-0001',
    referenceNumber: 'SUP-INV-7788',
    currency: 'YER',
    fxRate: 0,
    totalAmount: 35000,
    paidAmount: 35000,
    baseTotal: 0,
    purchaseDate,
    itemsCount: 2,
    warehouseId: 'warehouse-1',
    warehouseName: 'المستودع الرئيسي',
    paymentTerms: 'cash',
    netDays: 0,
    dueDate: '',
    notes: 'طلب تجريبي لمعاينة القالب',
    fxLocked: false,
    createdBy: 'admin-1',
    createdAt: purchaseDate,
    items: [
      {
        id: 'poi-1',
        purchaseOrderId: 'po-0001',
        itemId: 'item-1',
        itemName: 'شاورما دجاج',
        quantity: 10,
        receivedQuantity: 10,
        unitCost: 2500,
        totalCost: 25000,
      },
      {
        id: 'poi-2',
        purchaseOrderId: 'po-0001',
        itemId: 'item-2',
        itemName: 'عصير مانجو',
        quantity: 10,
        receivedQuantity: 10,
        unitCost: 1000,
        totalCost: 10000,
      },
    ],
    hasReturns: false,
  };
};

const buildMockGrn = (): PrintableGrnData => {
  const receivedAt = nowIso();
  return {
    grnNumber: 'GRN-TEST-0001',
    documentStatus: 'مكتمل',
    referenceId: 'po-0001',
    receivedAt,
    purchaseOrderNumber: 'PO-TEST-0001',
    supplierName: 'مورد تجريبي',
    warehouseName: 'المستودع الرئيسي',
    notes: 'استلام تجريبي لمعاينة القالب',
    currency: 'YER',
    items: [
      { itemId: 'item-1', itemName: 'شاورما دجاج', quantity: 10, unitCost: 2500, productionDate: null, expiryDate: null },
      { itemId: 'item-2', itemName: 'عصير مانجو', quantity: 10, unitCost: 1000, productionDate: null, expiryDate: null },
    ],
  };
};

const buildMockWarehouseTransfer = (): PrintableWarehouseTransferData => {
  const transferDate = nowIso();
  return {
    transferNumber: 'WT-TEST-0001',
    documentStatus: 'تم الترحيل',
    referenceId: 'transfer-0001',
    transferDate,
    status: 'completed',
    fromWarehouseName: 'المستودع الرئيسي',
    toWarehouseName: 'فرع 2',
    notes: 'تحويل تجريبي لمعاينة القالب',
    items: [
      { itemId: 'item-1', itemName: 'شاورما دجاج', quantity: 5, notes: null },
      { itemId: 'item-2', itemName: 'عصير مانجو', quantity: 6, notes: 'عاجل' },
    ],
  };
};

const buildMockVoucherLines = (): VoucherLine[] => [
  { accountCode: '1101', accountName: 'الصندوق', debit: 0, credit: 2400, memo: 'تحصيل نقدي' },
  { accountCode: '4101', accountName: 'إيرادات المبيعات', debit: 2400, credit: 0, memo: 'مبيعات' },
];

export default function DocumentTemplatesScreen() {
  const { settings, language } = useSettings();
  const { showNotification } = useToast();
  const [active, setActive] = useState<TemplateKey>('invoice_a4');
  const [busy, setBusy] = useState<string>('');

  const systemName = language === 'ar' ? AZTA_IDENTITY.tradeNameAr : AZTA_IDENTITY.tradeNameEn;

  const brand = useMemo(() => {
    const name = (settings.cafeteriaName?.[language] || settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '').trim();
    const address = String(settings.address || '').trim();
    const contactNumber = String(settings.contactNumber || '').trim();
    const logoUrl = String(settings.logoUrl || '').trim();
    const vatNumber = String(settings.taxSettings?.taxNumber || '').trim();
    return { name, address, contactNumber, logoUrl, vatNumber };
  }, [language, settings.address, settings.cafeteriaName, settings.contactNumber, settings.logoUrl, settings.taxSettings?.taxNumber]);

  const mockOrder = useMemo(() => buildMockOrder(), []);
  const mockPo = useMemo(() => buildMockPurchaseOrder(), []);
  const mockGrn = useMemo(() => buildMockGrn(), []);
  const mockTransfer = useMemo(() => buildMockWarehouseTransfer(), []);
  const voucherLines = useMemo(() => buildMockVoucherLines(), []);

  const templates = useMemo(() => {
    return [
      { key: 'invoice_a4' as const, group: 'الفواتير', title: 'فاتورة A4', hint: 'مناسبة للطباعة الرسمية وPDF.' },
      { key: 'invoice_thermal_58' as const, group: 'الفواتير', title: 'فاتورة حرارية 58mm', hint: 'مناسبة لطابعات POS.' },
      { key: 'invoice_thermal_80' as const, group: 'الفواتير', title: 'فاتورة حرارية 80mm', hint: 'مناسبة لطابعات POS.' },
      { key: 'delivery_note' as const, group: 'المبيعات', title: 'سند تسليم', hint: 'يستخدم مع التوصيل.' },
      { key: 'receipt_voucher' as const, group: 'المحاسبة', title: 'سند قبض', hint: 'يستخدم لتحصيل المدفوعات.' },
      { key: 'payment_voucher' as const, group: 'المحاسبة', title: 'سند صرف', hint: 'يستخدم لمصروف/صرف.' },
      { key: 'journal_voucher' as const, group: 'المحاسبة', title: 'سند قيد يومية', hint: 'مراجعة قيود اليومية.' },
      { key: 'purchase_order' as const, group: 'المشتريات/الاستلام', title: 'أمر شراء', hint: 'قالب طباعة أمر الشراء.' },
      { key: 'grn' as const, group: 'المشتريات/الاستلام', title: 'إشعار استلام (GRN)', hint: 'قالب استلام أصناف.' },
      { key: 'warehouse_transfer' as const, group: 'المخزون', title: 'تحويل مخزني', hint: 'قالب تحويل بين المستودعات.' },
    ];
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof templates>();
    templates.forEach((t) => {
      const arr = map.get(t.group) || [];
      arr.push(t);
      map.set(t.group, arr);
    });
    return Array.from(map.entries());
  }, [templates]);

  const runPrint = async (key: TemplateKey) => {
    try {
      setBusy(key);
      if (key === 'invoice_a4') {
        const ok = await printPdfFromElement('doc-template-a4', 'فاتورة A4 (قالب)');
        if (!ok) showNotification('تعذر بدء الطباعة. تأكد من السماح بالنوافذ المنبثقة.', 'error');
        return;
      }

      if (key === 'invoice_thermal_58' || key === 'invoice_thermal_80') {
        const thermalPaperWidth = key === 'invoice_thermal_80' ? '80mm' : '58mm';
        const sellerName = systemName;
        const vatRegistrationNumber = brand.vatNumber || '—';
        const timestamp = nowIso();
        const total = String(Number(mockOrder.total || 0).toFixed(2));
        const vatTotal = String(Number(mockOrder.taxAmount || 0).toFixed(2));
        const tlv = generateZatcaTLV(sellerName, vatRegistrationNumber, timestamp, total, vatTotal);
        const QRCode = (await import('qrcode')).default;
        const qrCodeDataUrl = await QRCode.toDataURL(tlv, { margin: 1, width: thermalPaperWidth === '80mm' ? 170 : 140 });
        const content = renderToString(
          <PrintableInvoice
            order={mockOrder}
            language="ar"
            companyName={brand.name}
            companyAddress={brand.address}
            companyPhone={brand.contactNumber}
            logoUrl={brand.logoUrl}
            vatNumber={brand.vatNumber}
            thermal
            thermalPaperWidth={thermalPaperWidth}
            qrCodeDataUrl={qrCodeDataUrl}
          />
        );
        printContent(content, `فاتورة حرارية (${thermalPaperWidth})`, { page: 'auto' });
        return;
      }

      if (key === 'delivery_note') {
        const content = renderToString(
          <PrintableOrder
            order={mockOrder}
            language="ar"
            companyName={brand.name}
            companyAddress={brand.address}
            companyPhone={brand.contactNumber}
            logoUrl={brand.logoUrl}
          />
        );
        printContent(content, 'سند تسليم (قالب)', { page: 'auto' });
        return;
      }

      if (key === 'receipt_voucher') {
        const content = renderToString(
          <PrintableReceiptVoucher
            data={{
              voucherNumber: 'RV-TEST-0001',
              status: 'مُرحّل',
              referenceId: mockOrder.id,
              date: new Date().toLocaleString('ar-EG-u-nu-latn'),
              memo: 'تحصيل طلب تجريبي',
              currency: 'YER',
              amount: 2400,
              amountWords: 'ألفان وأربعمائة',
              lines: voucherLines,
            }}
            brand={{ name: brand.name, address: brand.address, contactNumber: brand.contactNumber, logoUrl: brand.logoUrl }}
          />
        );
        printContent(content, 'سند قبض (قالب)', { page: 'auto' });
        return;
      }

      if (key === 'payment_voucher') {
        const content = renderToString(
          <PrintablePaymentVoucher
            data={{
              voucherNumber: 'PV-TEST-0001',
              status: 'مُرحّل',
              referenceId: 'expense-0001',
              date: new Date().toLocaleString('ar-EG-u-nu-latn'),
              memo: 'صرف تجريبي',
              currency: 'YER',
              amount: 1800,
              amountWords: 'ألف وثمانمائة',
              lines: voucherLines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
            }}
            brand={{ name: brand.name, address: brand.address, contactNumber: brand.contactNumber, logoUrl: brand.logoUrl }}
          />
        );
        printContent(content, 'سند صرف (قالب)', { page: 'auto' });
        return;
      }

      if (key === 'journal_voucher') {
        const content = renderToString(
          <PrintableJournalVoucher
            data={{
              voucherNumber: 'JV-TEST-0001',
              status: 'مُرحّل',
              referenceId: 'journal-0001',
              date: new Date().toLocaleString('ar-EG-u-nu-latn'),
              memo: 'قيد يومية تجريبي',
              currency: 'YER',
              amount: null,
              amountWords: null,
              lines: voucherLines,
            }}
            brand={{ name: brand.name, address: brand.address, contactNumber: brand.contactNumber, logoUrl: brand.logoUrl }}
          />
        );
        printContent(content, 'سند قيد يومية (قالب)', { page: 'auto' });
        return;
      }

      if (key === 'purchase_order') {
        const content = renderToString(
          <PrintablePurchaseOrder
            order={mockPo}
            language="ar"
            documentStatus="مكتمل"
            referenceId={mockPo.id}
            brand={{ name: brand.name, address: brand.address, contactNumber: brand.contactNumber, logoUrl: brand.logoUrl, vatNumber: brand.vatNumber }}
          />
        );
        printContent(content, 'أمر شراء (قالب)', { page: 'A4' });
        return;
      }

      if (key === 'grn') {
        const content = renderToString(
          <PrintableGrn
            data={mockGrn}
            language="ar"
            brand={{ name: brand.name, address: brand.address, contactNumber: brand.contactNumber, logoUrl: brand.logoUrl, vatNumber: brand.vatNumber }}
          />
        );
        printContent(content, 'إشعار استلام (GRN) (قالب)', { page: 'A4' });
        return;
      }

      if (key === 'warehouse_transfer') {
        const content = renderToString(
          <PrintableWarehouseTransfer
            data={mockTransfer}
            language="ar"
            brand={{ name: brand.name, address: brand.address, contactNumber: brand.contactNumber, logoUrl: brand.logoUrl }}
          />
        );
        printContent(content, 'تحويل مخزني (قالب)', { page: 'A4' });
        return;
      }
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر فتح المعاينة/الطباعة'), 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">قوالب المستندات</h1>
          <div className="text-sm text-gray-500 dark:text-gray-400">معاينة وطباعة قوالب الفواتير والمستندات بدون الحاجة لطلب فعلي.</div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin/printed-documents" className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700">
            سجل المستندات المطبوعة
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
          <div className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-3">القوالب</div>
          <div className="space-y-4">
            {grouped.map(([group, items]) => (
              <div key={group}>
                <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2">{group}</div>
                <div className="space-y-2">
                  {items.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setActive(t.key)}
                      className={`w-full text-right px-3 py-2 rounded-lg border text-sm transition ${
                        active === t.key
                          ? 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-200'
                          : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700/30'
                      }`}
                    >
                      <div className="font-bold">{t.title}</div>
                      <div className="text-xs opacity-80">{t.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-gray-700 dark:text-gray-200">المعاينة</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">يمكنك فتح نافذة المعاينة/الطباعة للقالب المحدد.</div>
              </div>
              <button
                type="button"
                onClick={() => { void runPrint(active); }}
                disabled={Boolean(busy)}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-bold hover:bg-black disabled:opacity-60"
              >
                {busy ? 'جاري التحضير...' : 'فتح المعاينة/الطباعة'}
              </button>
            </div>
          </div>

          {(active === 'invoice_a4') && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4 overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold text-gray-700 dark:text-gray-200">فاتورة A4 (معاينة داخلية)</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">الهوية: {systemName}</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 overflow-auto">
                <div id="doc-template-a4" className="min-w-[900px]">
                  <Invoice
                    order={mockOrder}
                    settings={settings}
                    branding={{ name: brand.name, address: brand.address, contactNumber: brand.contactNumber, logoUrl: brand.logoUrl }}
                  />
                </div>
              </div>
            </div>
          )}

          {(active === 'invoice_thermal_58' || active === 'invoice_thermal_80') && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4 overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold text-gray-700 dark:text-gray-200">فاتورة حرارية (معاينة داخلية)</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{active === 'invoice_thermal_80' ? '80mm' : '58mm'}</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 overflow-auto">
                <div className="inline-block bg-white p-3 rounded-lg">
                  <PrintableInvoice
                    order={mockOrder}
                    language="ar"
                    companyName={brand.name}
                    companyAddress={brand.address}
                    companyPhone={brand.contactNumber}
                    logoUrl={brand.logoUrl}
                    vatNumber={brand.vatNumber}
                    thermal
                    thermalPaperWidth={active === 'invoice_thermal_80' ? '80mm' : '58mm'}
                  />
                </div>
              </div>
            </div>
          )}

          {active === 'delivery_note' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4 overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold text-gray-700 dark:text-gray-200">سند تسليم (معاينة داخلية)</div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 overflow-auto">
                <div className="inline-block bg-white p-3 rounded-lg">
                  <PrintableOrder
                    order={mockOrder}
                    language="ar"
                    companyName={brand.name}
                    companyAddress={brand.address}
                    companyPhone={brand.contactNumber}
                    logoUrl={brand.logoUrl}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
            <div className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">الإشعارات</div>
            <div className="text-sm text-gray-600 dark:text-gray-300">
              إشعارات النظام تظهر من أيقونة الجرس أعلى لوحة التحكم، وليست قالب طباعة مستقل مثل الفواتير والسندات.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

