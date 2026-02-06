type Brand = {
  name?: string;
  address?: string;
  contactNumber?: string;
  logoUrl?: string;
  branchName?: string;
  branchCode?: string;
};

export type VoucherLine = {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo?: string | null;
};

export type VoucherData = {
  title: string;
  voucherNumber: string;
  status?: string;
  referenceId?: string;
  date: string;
  memo?: string | null;
  currency?: string | null;
  amount?: number | null;
  amountWords?: string | null;
  lines: VoucherLine[];
};

const fmt = (n: number) => {
  const v = Number(n || 0);
  try {
    return v.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return v.toFixed(2);
  }
};

export default function PrintableVoucherBase(props: { data: VoucherData; brand?: Brand }) {
  const { data, brand } = props;
  const totalDebit = data.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = data.lines.reduce((s, l) => s + Number(l.credit || 0), 0);

  return (
    <div>
      <div className="header">
        {brand?.logoUrl ? <img src={brand.logoUrl} alt={brand?.name || ''} style={{ height: '40px', display: 'inline-block', marginBottom: '8px' }} /> : null}
        <h1>{(brand?.name || '').trim()}</h1>
        <p>{data.title}</p>
        {brand?.branchName ? <p style={{ fontSize: '12px' }}>{brand.branchName}{brand?.branchCode ? ` • ${brand.branchCode}` : ''}</p> : null}
        {brand?.address ? <p style={{ fontSize: '12px' }}>{brand.address}</p> : null}
        {brand?.contactNumber ? <p style={{ fontSize: '12px' }}>{`هاتف: ${brand.contactNumber}`}</p> : null}
      </div>

      <div className="border-b mb-4">
        <div className="info-row">
          <span className="font-bold">رقم السند:</span>
          <span dir="ltr">{data.voucherNumber}</span>
        </div>
        {data.status ? (
          <div className="info-row">
            <span className="font-bold">الحالة:</span>
            <span>{data.status}</span>
          </div>
        ) : null}
        {data.referenceId ? (
          <div className="info-row">
            <span className="font-bold">المعرف المرجعي:</span>
            <span dir="ltr">{data.referenceId}</span>
          </div>
        ) : null}
        <div className="info-row">
          <span className="font-bold">التاريخ:</span>
          <span dir="ltr">{data.date}</span>
        </div>
        {data.memo ? (
          <div className="info-row">
            <span className="font-bold">البيان:</span>
            <span>{data.memo}</span>
          </div>
        ) : null}
        {typeof data.amount === 'number' ? (
          <div className="info-row">
            <span className="font-bold">المبلغ:</span>
            <span dir="ltr">{fmt(data.amount)} {String(data.currency || '').toUpperCase() || ''}</span>
          </div>
        ) : null}
        {data.amountWords ? (
          <div className="info-row">
            <span className="font-bold">المبلغ بالحروف:</span>
            <span>{data.amountWords}</span>
          </div>
        ) : null}
      </div>

      <div className="mb-4">
        <h3 className="font-bold mb-2">تفاصيل القيود</h3>
        <table>
          <thead>
            <tr>
              <th style={{ width: '120px' }}>الحساب</th>
              <th>اسم الحساب</th>
              <th style={{ width: '140px' }}>مدين</th>
              <th style={{ width: '140px' }}>دائن</th>
              <th>بيان</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 ? (
              <tr><td colSpan={5} className="text-center" style={{ color: '#6b7280' }}>لا توجد سطور</td></tr>
            ) : data.lines.map((l, idx) => (
              <tr key={`${l.accountCode}-${idx}`}>
                <td className="font-mono" dir="ltr">{l.accountCode}</td>
                <td className="font-bold">{l.accountName}</td>
                <td dir="ltr">{fmt(Number(l.debit || 0))}</td>
                <td dir="ltr">{fmt(Number(l.credit || 0))}</td>
                <td>{l.memo || '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td colSpan={2}>الإجمالي</td>
              <td dir="ltr">{fmt(totalDebit)}</td>
              <td dir="ltr">{fmt(totalCredit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
        <div style={{ borderTop: '1px solid #111', paddingTop: '8px', textAlign: 'center' }}>إعداد</div>
        <div style={{ borderTop: '1px solid #111', paddingTop: '8px', textAlign: 'center' }}>اعتماد</div>
        <div style={{ borderTop: '1px solid #111', paddingTop: '8px', textAlign: 'center' }}>استلام</div>
      </div>

      <div className="mt-4 text-center" style={{ borderTop: '2px dashed #000', paddingTop: '10px', fontSize: '12px', color: '#666' }}>
        <p>{`تم الطباعة: ${new Date().toLocaleString('ar-EG-u-nu-latn')}`}</p>
      </div>
    </div>
  );
}
