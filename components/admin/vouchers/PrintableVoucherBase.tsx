


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
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return v.toFixed(2);
  }
};

export default function PrintableVoucherBase(props: { data: VoucherData; brand?: Brand }) {
  const { data, brand } = props;
  const totalDebit = data.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = data.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  
  // Format date safely to avoid RTL scrambling
  const formattedDate = new Date(data.date).toLocaleDateString('en-GB');
  const currency = data.currency?.toUpperCase() || '—';

  return (
    <div className="voucher-container" dir="rtl">
        <style>{`
            @media print {
                @page { size: A4; margin: 0; }
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
            .voucher-container {
                font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                max-width: 210mm;
                margin: 0 auto;
                background: white;
                color: #1e293b;
                line-height: 1.5;
                padding: 40px;
                border-top: 5px solid #1e293b; /* Luxury top border */
            }
            .header-section {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 40px;
                border-bottom: 2px solid #e2e8f0;
                padding-bottom: 20px;
            }
            .company-info { text-align: right; }
            .company-info h1 { font-size: 24px; font-weight: 800; margin: 0 0 5px 0; color: #0f172a; }
            .company-info p { margin: 2px 0; font-size: 13px; color: #475569; }
            
            .doc-title {
                text-align: left;
                background: #f8fafc;
                padding: 15px 25px;
                border-radius: 8px;
                border: 1px solid #e2e8f0;
            }
            .doc-title h2 {
                font-size: 24px;
                font-weight: 900;
                color: #0f172a;
                margin: 0;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .doc-title .ref-number {
                font-size: 14px;
                color: #64748b;
                margin-top: 5px;
                font-family: 'Courier New', monospace;
            }
            
            .info-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 20px;
                margin-bottom: 30px;
                background: #f8fafc;
                padding: 20px;
                border-radius: 8px;
                border: 1px solid #e2e8f0;
            }
            .info-item { display: flex; flex-direction: column; }
            .info-label { font-size: 11px; color: #64748b; font-weight: bold; margin-bottom: 4px; }
            .info-value { font-size: 14px; font-weight: 600; color: #0f172a; }
            .tabular { font-variant-numeric: tabular-nums; font-family: 'Courier New', monospace; }
            
            .amount-box {
                grid-column: span 4;
                background: #1e293b;
                color: white;
                padding: 15px;
                border-radius: 6px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 30px;
            }
            .amount-box .label { font-size: 14px; font-weight: bold; }
            .amount-box .value { font-size: 20px; font-weight: 800; font-family: 'Courier New', monospace; }
            
            .lines-table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 30px; font-size: 12px; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
            .lines-table th {
                background: #1e293b;
                color: white;
                font-weight: 700;
                text-align: center;
                padding: 12px;
                border-bottom: 2px solid #0f172a;
            }
            .lines-table th:first-child { text-align: right; }
            .lines-table td {
                padding: 12px;
                border-bottom: 1px solid #e2e8f0;
                vertical-align: top;
                color: #334155;
            }
            .lines-table tr:last-child td { border-bottom: none; }
            .lines-table tr:nth-child(even) { background-color: #f8fafc; }
            .lines-table .total-row td {
                background: #f8fafc;
                font-weight: 800;
                border-top: 2px solid #cbd5e1;
                font-size: 14px;
                color: #0f172a;
            }
            
            .signatures-section {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 30px;
                margin-top: 60px;
            }
            .signature-box {
                border-top: 1px solid #cbd5e1;
                padding-top: 10px;
                text-align: center;
            }
            .signature-label { font-size: 12px; font-weight: bold; color: #64748b; margin-bottom: 40px; }
            
            .footer-meta {
                margin-top: 40px;
                border-top: 1px dashed #cbd5e1;
                padding-top: 10px;
                display: flex;
                justify-content: space-between;
                font-size: 10px;
                color: #94a3b8;
            }
        `}</style>

      <div className="header-section">
        <div className="company-info">
            {brand?.logoUrl && <img src={brand.logoUrl} alt="Logo" style={{ height: 60, marginBottom: 10 }} />}
            <h1>{(brand?.name || '').trim()}</h1>
            {brand?.branchName && <p>{brand.branchName}</p>}
            {brand?.address && <p>{brand.address}</p>}
            {brand?.contactNumber && <p dir="ltr">{brand.contactNumber}</p>}
        </div>
        <div className="doc-title">
            <h2>{data.title}</h2>
            <div className="ref-number tabular" dir="ltr">#{data.voucherNumber}</div>
            <div style={{ marginTop: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 'bold', background: data.status === 'posted' ? '#dcfce7' : '#f1f5f9', color: data.status === 'posted' ? '#166534' : '#64748b', padding: '4px 12px', borderRadius: 20 }}>
                    {data.status || 'DRAFT'}
                </span>
            </div>
        </div>
      </div>

      <div className="info-grid">
        <div className="info-item">
            <span className="info-label">التاريخ</span>
            <span className="info-value tabular" dir="ltr">{formattedDate}</span>
        </div>
        <div className="info-item">
            <span className="info-label">المعرف المرجعي</span>
            <span className="info-value tabular" dir="ltr">{data.referenceId || '—'}</span>
        </div>
        <div className="info-item" style={{ gridColumn: 'span 2' }}>
            <span className="info-label">الوصف / البيان</span>
            <span className="info-value">{data.memo || '—'}</span>
        </div>
      </div>

      {typeof data.amount === 'number' && (
        <div className="amount-box">
            <div>
                <div className="label">المبلغ الإجمالي</div>
                {data.amountWords && <div style={{ fontSize: 11, fontWeight: 'normal', opacity: 0.8, marginTop: 4 }}>{data.amountWords}</div>}
            </div>
            <div className="value" dir="ltr">
                {fmt(data.amount)} <span style={{ fontSize: 12 }}>{currency}</span>
            </div>
        </div>
      )}

      <div className="table-container">
        <table className="lines-table">
          <thead>
            <tr>
              <th style={{ width: '15%' }}>رمز الحساب</th>
              <th style={{ width: '35%' }}>اسم الحساب</th>
              <th style={{ width: '25%' }}>البيان</th>
              <th style={{ width: '12%' }}>مدين</th>
              <th style={{ width: '12%' }}>دائن</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 ? (
              <tr><td colSpan={5} className="text-center" style={{ padding: 40, color: '#94a3b8' }}>لا توجد قيود مسجلة</td></tr>
            ) : data.lines.map((l, idx) => (
              <tr key={`${l.accountCode}-${idx}`}>
                <td className="tabular" dir="ltr" style={{ fontWeight: 'bold', color: '#475569' }}>{l.accountCode}</td>
                <td style={{ fontWeight: 600 }}>{l.accountName}</td>
                <td style={{ color: '#64748b', fontSize: 11 }}>{l.memo || '—'}</td>
                <td className="tabular text-center" dir="ltr" style={{ color: Number(l.debit) > 0 ? '#0f172a' : '#cbd5e1' }}>{Number(l.debit) > 0 ? fmt(l.debit) : '—'}</td>
                <td className="tabular text-center" dir="ltr" style={{ color: Number(l.credit) > 0 ? '#0f172a' : '#cbd5e1' }}>{Number(l.credit) > 0 ? fmt(l.credit) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td colSpan={3} style={{ textAlign: 'left', paddingLeft: 20 }}>الإجمالي Total</td>
              <td className="tabular text-center" dir="ltr">{fmt(totalDebit)}</td>
              <td className="tabular text-center" dir="ltr">{fmt(totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="signatures-section">
        <div className="signature-box">
            <div className="signature-label">إعداد (Prepared By)</div>
        </div>
        <div className="signature-box">
            <div className="signature-label">مراجعة (Checked By)</div>
        </div>
        <div className="signature-box">
            <div className="signature-label">اعتماد (Approved By)</div>
        </div>
      </div>

      <div className="footer-meta">
        <div>
            تمت الطباعة بواسطة النظام في <span dir="ltr" className="tabular">{new Date().toLocaleString('en-GB')}</span>
        </div>
        <div>
            Generated by {brand?.name || 'AZTA ERP'}
        </div>
      </div>
    </div>
  );
}
