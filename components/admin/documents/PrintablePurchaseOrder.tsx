import { PurchaseOrder } from '../../../types';
import { formatDateOnly } from '../../../utils/printUtils';

type Brand = {
  name?: string;
  address?: string;
  contactNumber?: string;
  logoUrl?: string;
  branchName?: string;
  branchCode?: string;
  vatNumber?: string;
};

export default function PrintablePurchaseOrder(props: { order: PurchaseOrder; brand?: Brand; language?: 'ar' | 'en'; documentStatus?: string; referenceId?: string }) {
  const { order, brand, language = 'ar', documentStatus, referenceId } = props;
  const docNo = order.poNumber || `PO-${order.id.slice(-6).toUpperCase()}`;
  const currency = String(order.currency || '').toUpperCase() || '—';
  const fx = Number(order.fxRate || 0);
  const items = Array.isArray(order.items) ? order.items : [];

  const fmt = (n: number) => {
    const v = Number(n || 0);
    try {
      return v.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      return v.toFixed(2);
    }
  };

  return (
    <div>
      <div className="header">
        {brand?.logoUrl ? <img src={brand.logoUrl} alt={brand?.name || ''} style={{ height: '40px', display: 'inline-block', marginBottom: '8px' }} /> : null}
        <h1>{(brand?.name || '').trim()}</h1>
        <p>{language === 'en' ? 'Purchase Order' : 'أمر شراء'}</p>
        {brand?.branchName ? <p style={{ fontSize: '12px' }}>{brand.branchName}{brand?.branchCode ? ` • ${brand.branchCode}` : ''}</p> : null}
        {brand?.address ? <p style={{ fontSize: '12px' }}>{brand.address}</p> : null}
        {brand?.contactNumber ? <p style={{ fontSize: '12px' }}>{language === 'en' ? 'Phone:' : 'هاتف:'} {brand.contactNumber}</p> : null}
        {brand?.vatNumber ? <p style={{ fontSize: '12px' }}>{language === 'en' ? 'VAT No:' : 'الرقم الضريبي:'} {brand.vatNumber}</p> : null}
      </div>

      <div className="border-b mb-4">
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'PO Number:' : 'رقم أمر الشراء:'}</span>
          <span dir="ltr">{docNo}</span>
        </div>
        {documentStatus ? (
          <div className="info-row">
            <span className="font-bold">{language === 'en' ? 'Status:' : 'الحالة:'}</span>
            <span>{documentStatus}</span>
          </div>
        ) : null}
        {referenceId ? (
          <div className="info-row">
            <span className="font-bold">{language === 'en' ? 'Reference ID:' : 'المعرف المرجعي:'}</span>
            <span dir="ltr">{referenceId}</span>
          </div>
        ) : null}
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'Date:' : 'التاريخ:'}</span>
          <span>{formatDateOnly(order.purchaseDate)}</span>
        </div>
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'Supplier:' : 'المورد:'}</span>
          <span>{order.supplierName || '—'}</span>
        </div>
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'Warehouse:' : 'المستودع:'}</span>
          <span>{order.warehouseName || '—'}</span>
        </div>
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'Currency:' : 'العملة:'}</span>
          <span dir="ltr">{currency}</span>
        </div>
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'FX Rate:' : 'سعر الصرف:'}</span>
          <span dir="ltr">{fx > 0 ? fx.toFixed(6) : '—'}</span>
        </div>
        {order.referenceNumber ? (
          <div className="info-row">
            <span className="font-bold">{language === 'en' ? 'Supplier Invoice:' : 'فاتورة المورد:'}</span>
            <span dir="ltr">{order.referenceNumber}</span>
          </div>
        ) : null}
      </div>

      <div className="mb-4">
        <h3 className="font-bold mb-2">{language === 'en' ? 'Items' : 'الأصناف'}</h3>
        <table>
          <thead>
            <tr>
              <th style={{ width: '60px' }}>{language === 'en' ? 'Qty' : 'الكمية'}</th>
              <th>{language === 'en' ? 'Item' : 'الصنف'}</th>
              <th style={{ width: '120px' }}>{language === 'en' ? 'Unit Cost' : 'سعر الوحدة'}</th>
              <th style={{ width: '140px' }}>{language === 'en' ? 'Line Total' : 'الإجمالي'}</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center" style={{ color: '#6b7280' }}>{language === 'en' ? 'No items' : 'لا توجد أصناف'}</td>
              </tr>
            ) : items.map((it) => {
              const qty = Number(it.quantity || 0);
              const unit = Number(it.unitCost || 0);
              const total = Number(it.totalCost || qty * unit);
              return (
                <tr key={it.id}>
                  <td className="text-center font-bold" dir="ltr">{qty}</td>
                  <td className="font-bold">{it.itemName || it.itemId}</td>
                  <td dir="ltr">{fmt(unit)} <span className="text-xs">{currency}</span></td>
                  <td dir="ltr" className="font-bold">{fmt(total)} <span className="text-xs">{currency}</span></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td colSpan={3}>{language === 'en' ? 'Total' : 'الإجمالي'}</td>
              <td dir="ltr">{fmt(Number(order.totalAmount || 0))} <span className="text-xs">{currency}</span></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {order.notes ? (
        <div className="mb-4" style={{ padding: '10px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
          <div className="font-bold mb-2">{language === 'en' ? 'Notes' : 'ملاحظات'}</div>
          <div>{order.notes}</div>
        </div>
      ) : null}

      <div className="mt-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
        <div style={{ borderTop: '1px solid #111', paddingTop: '8px', textAlign: 'center' }}>{language === 'en' ? 'Prepared By' : 'إعداد'}</div>
        <div style={{ borderTop: '1px solid #111', paddingTop: '8px', textAlign: 'center' }}>{language === 'en' ? 'Approved By' : 'اعتماد'}</div>
        <div style={{ borderTop: '1px solid #111', paddingTop: '8px', textAlign: 'center' }}>{language === 'en' ? 'Received By' : 'استلام'}</div>
      </div>

      <div className="mt-4 text-center" style={{ borderTop: '2px dashed #000', paddingTop: '10px', fontSize: '12px', color: '#666' }}>
        <p>{language === 'en' ? 'Printed at' : 'تم الطباعة'}: {new Date().toLocaleString('ar-EG-u-nu-latn')}</p>
      </div>
    </div>
  );
}
