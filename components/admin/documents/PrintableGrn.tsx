import { formatDateOnly, formatTimeForPrint } from '../../../utils/printUtils';

type Brand = {
  name?: string;
  address?: string;
  contactNumber?: string;
  logoUrl?: string;
  branchName?: string;
  branchCode?: string;
  vatNumber?: string;
};

export type PrintableGrnData = {
  grnNumber: string;
  documentStatus?: string;
  referenceId?: string;
  receivedAt: string;
  purchaseOrderNumber?: string;
  supplierName?: string;
  warehouseName?: string;
  notes?: string | null;
  items: Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    unitCost: number;
    productionDate?: string | null;
    expiryDate?: string | null;
    totalCost?: number;
  }>;
  currency?: string;
};

export default function PrintableGrn(props: { data: PrintableGrnData; brand?: Brand; language?: 'ar' | 'en' }) {
  const { data, brand, language = 'ar' } = props;
  const currency = String(data.currency || '').toUpperCase() || '—';

  const fmt = (n: number) => {
    const v = Number(n || 0);
    try {
      return v.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      return v.toFixed(2);
    }
  };

  const total = data.items.reduce((sum, it) => sum + Number(it.totalCost ?? (Number(it.quantity || 0) * Number(it.unitCost || 0))), 0);

  return (
    <div>
      <div className="header">
        {brand?.logoUrl ? <img src={brand.logoUrl} alt={brand?.name || ''} style={{ height: '40px', display: 'inline-block', marginBottom: '8px' }} /> : null}
        <h1>{(brand?.name || '').trim()}</h1>
        <p>{language === 'en' ? 'Goods Receipt Note (GRN)' : 'إشعار استلام (GRN)'}</p>
        {brand?.branchName ? <p style={{ fontSize: '12px' }}>{brand.branchName}{brand?.branchCode ? ` • ${brand.branchCode}` : ''}</p> : null}
        {brand?.address ? <p style={{ fontSize: '12px' }}>{brand.address}</p> : null}
        {brand?.contactNumber ? <p style={{ fontSize: '12px' }}>{language === 'en' ? 'Phone:' : 'هاتف:'} {brand.contactNumber}</p> : null}
        {brand?.vatNumber ? <p style={{ fontSize: '12px' }}>{language === 'en' ? 'VAT No:' : 'الرقم الضريبي:'} {brand.vatNumber}</p> : null}
      </div>

      <div className="border-b mb-4">
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'GRN Number:' : 'رقم الإشعار:'}</span>
          <span dir="ltr">{data.grnNumber}</span>
        </div>
        {data.documentStatus ? (
          <div className="info-row">
            <span className="font-bold">{language === 'en' ? 'Status:' : 'الحالة:'}</span>
            <span>{data.documentStatus}</span>
          </div>
        ) : null}
        {data.referenceId ? (
          <div className="info-row">
            <span className="font-bold">{language === 'en' ? 'Reference ID:' : 'المعرف المرجعي:'}</span>
            <span dir="ltr">{data.referenceId}</span>
          </div>
        ) : null}
        {data.purchaseOrderNumber ? (
          <div className="info-row">
            <span className="font-bold">{language === 'en' ? 'PO Number:' : 'رقم أمر الشراء:'}</span>
            <span dir="ltr">{data.purchaseOrderNumber}</span>
          </div>
        ) : null}
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'Date:' : 'التاريخ:'}</span>
          <span>{formatDateOnly(data.receivedAt)}</span>
        </div>
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'Time:' : 'الوقت:'}</span>
          <span>{formatTimeForPrint(data.receivedAt)}</span>
        </div>
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'Supplier:' : 'المورد:'}</span>
          <span>{data.supplierName || '—'}</span>
        </div>
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'Warehouse:' : 'المستودع:'}</span>
          <span>{data.warehouseName || '—'}</span>
        </div>
      </div>

      <div className="mb-4">
        <h3 className="font-bold mb-2">{language === 'en' ? 'Received Items' : 'الأصناف المستلمة'}</h3>
        <table>
          <thead>
            <tr>
              <th style={{ width: '60px' }}>{language === 'en' ? 'Qty' : 'الكمية'}</th>
              <th>{language === 'en' ? 'Item' : 'الصنف'}</th>
              <th style={{ width: '120px' }}>{language === 'en' ? 'Unit Cost' : 'سعر الوحدة'}</th>
              <th style={{ width: '120px' }}>{language === 'en' ? 'Prod.' : 'الإنتاج'}</th>
              <th style={{ width: '120px' }}>{language === 'en' ? 'Expiry' : 'الانتهاء'}</th>
              <th style={{ width: '140px' }}>{language === 'en' ? 'Line Total' : 'الإجمالي'}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center" style={{ color: '#6b7280' }}>{language === 'en' ? 'No items' : 'لا توجد أصناف'}</td>
              </tr>
            ) : data.items.map((it, idx) => {
              const qty = Number(it.quantity || 0);
              const unit = Number(it.unitCost || 0);
              const line = Number(it.totalCost ?? qty * unit);
              return (
                <tr key={`${it.itemId}-${idx}`}>
                  <td className="text-center font-bold" dir="ltr">{qty}</td>
                  <td className="font-bold">{it.itemName || it.itemId}</td>
                  <td dir="ltr">{fmt(unit)} <span className="text-xs">{currency}</span></td>
                  <td dir="ltr">{it.productionDate ? formatDateOnly(it.productionDate) : '—'}</td>
                  <td dir="ltr">{it.expiryDate ? formatDateOnly(it.expiryDate) : '—'}</td>
                  <td dir="ltr" className="font-bold">{fmt(line)} <span className="text-xs">{currency}</span></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td colSpan={5}>{language === 'en' ? 'Total' : 'الإجمالي'}</td>
              <td dir="ltr">{fmt(total)} <span className="text-xs">{currency}</span></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {data.notes ? (
        <div className="mb-4" style={{ padding: '10px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
          <div className="font-bold mb-2">{language === 'en' ? 'Notes' : 'ملاحظات'}</div>
          <div>{data.notes}</div>
        </div>
      ) : null}

      <div className="mt-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div style={{ borderTop: '1px solid #111', paddingTop: '8px', textAlign: 'center' }}>{language === 'en' ? 'Storekeeper' : 'أمين المخزن'}</div>
        <div style={{ borderTop: '1px solid #111', paddingTop: '8px', textAlign: 'center' }}>{language === 'en' ? 'Receiver' : 'المستلم'}</div>
      </div>

      <div className="mt-4 text-center" style={{ borderTop: '2px dashed #000', paddingTop: '10px', fontSize: '12px', color: '#666' }}>
        <p>{language === 'en' ? 'Printed at' : 'تم الطباعة'}: {new Date().toLocaleString('ar-EG-u-nu-latn')}</p>
      </div>
    </div>
  );
}
