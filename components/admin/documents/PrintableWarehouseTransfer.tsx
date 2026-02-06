import { formatDateOnly } from '../../../utils/printUtils';

type Brand = {
  name?: string;
  address?: string;
  contactNumber?: string;
  logoUrl?: string;
  branchName?: string;
  branchCode?: string;
};

export type PrintableWarehouseTransferData = {
  transferNumber: string;
  documentStatus?: string;
  referenceId?: string;
  transferDate: string;
  status: string;
  fromWarehouseName: string;
  toWarehouseName: string;
  notes?: string | null;
  items: Array<{ itemName: string; itemId: string; quantity: number; notes?: string | null }>;
};

export default function PrintableWarehouseTransfer(props: { data: PrintableWarehouseTransferData; brand?: Brand; language?: 'ar' | 'en' }) {
  const { data, brand, language = 'ar' } = props;

  return (
    <div>
      <div className="header">
        {brand?.logoUrl ? <img src={brand.logoUrl} alt={brand?.name || ''} style={{ height: '40px', display: 'inline-block', marginBottom: '8px' }} /> : null}
        <h1>{(brand?.name || '').trim()}</h1>
        <p>{language === 'en' ? 'Warehouse Transfer' : 'تحويل مخزني'}</p>
        {brand?.branchName ? <p style={{ fontSize: '12px' }}>{brand.branchName}{brand?.branchCode ? ` • ${brand.branchCode}` : ''}</p> : null}
        {brand?.address ? <p style={{ fontSize: '12px' }}>{brand.address}</p> : null}
        {brand?.contactNumber ? <p style={{ fontSize: '12px' }}>{language === 'en' ? 'Phone:' : 'هاتف:'} {brand.contactNumber}</p> : null}
      </div>

      <div className="border-b mb-4">
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'Transfer No:' : 'رقم التحويل:'}</span>
          <span dir="ltr">{data.transferNumber}</span>
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
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'Date:' : 'التاريخ:'}</span>
          <span>{formatDateOnly(data.transferDate)}</span>
        </div>
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'From:' : 'من:'}</span>
          <span>{data.fromWarehouseName}</span>
        </div>
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'To:' : 'إلى:'}</span>
          <span>{data.toWarehouseName}</span>
        </div>
        <div className="info-row">
          <span className="font-bold">{language === 'en' ? 'Status:' : 'الحالة:'}</span>
          <span>{data.status}</span>
        </div>
      </div>

      <div className="mb-4">
        <h3 className="font-bold mb-2">{language === 'en' ? 'Items' : 'الأصناف'}</h3>
        <table>
          <thead>
            <tr>
              <th style={{ width: '60px' }}>{language === 'en' ? 'Qty' : 'الكمية'}</th>
              <th>{language === 'en' ? 'Item' : 'الصنف'}</th>
              <th>{language === 'en' ? 'Notes' : 'ملاحظات'}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr><td colSpan={3} className="text-center" style={{ color: '#6b7280' }}>{language === 'en' ? 'No items' : 'لا توجد أصناف'}</td></tr>
            ) : data.items.map((it, idx) => (
              <tr key={`${it.itemId}-${idx}`}>
                <td className="text-center font-bold" dir="ltr">{Number(it.quantity || 0)}</td>
                <td className="font-bold">{it.itemName || it.itemId}</td>
                <td>{it.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.notes ? (
        <div className="mb-4" style={{ padding: '10px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
          <div className="font-bold mb-2">{language === 'en' ? 'Notes' : 'ملاحظات'}</div>
          <div>{data.notes}</div>
        </div>
      ) : null}

      <div className="mt-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div style={{ borderTop: '1px solid #111', paddingTop: '8px', textAlign: 'center' }}>{language === 'en' ? 'Sender' : 'المُرسل'}</div>
        <div style={{ borderTop: '1px solid #111', paddingTop: '8px', textAlign: 'center' }}>{language === 'en' ? 'Receiver' : 'المُستلم'}</div>
      </div>

      <div className="mt-4 text-center" style={{ borderTop: '2px dashed #000', paddingTop: '10px', fontSize: '12px', color: '#666' }}>
        <p>{language === 'en' ? 'Printed at' : 'تم الطباعة'}: {new Date().toLocaleString('ar-EG-u-nu-latn')}</p>
      </div>
    </div>
  );
}
