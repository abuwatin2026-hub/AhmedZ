
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
    <div className="transfer-container" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <style>{`
            @media print {
                @page { size: A4; margin: 0; }
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
            .transfer-container {
                font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                max-width: 210mm;
                margin: 0 auto;
                background: white;
                color: #1e293b;
                line-height: 1.5;
                padding: 40px;
                border-top: 5px solid #1e293b;
            }
            .header-section {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 40px;
                border-bottom: 2px solid #e2e8f0;
                padding-bottom: 20px;
            }
            .company-info { text-align: ${language === 'ar' ? 'right' : 'left'}; }
            .company-info h1 { font-size: 24px; font-weight: 800; margin: 0 0 5px 0; color: #0f172a; }
            .company-info p { margin: 2px 0; font-size: 13px; color: #475569; }
            
            .doc-title {
                text-align: ${language === 'ar' ? 'left' : 'right'};
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
            
            .lines-table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 30px; font-size: 12px; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
            .lines-table th {
                background: #1e293b;
                color: white;
                font-weight: 700;
                text-align: center;
                padding: 12px;
                border-bottom: 2px solid #0f172a;
            }
            .lines-table th:first-child { text-align: ${language === 'ar' ? 'right' : 'left'}; }
            .lines-table td {
                padding: 12px;
                border-bottom: 1px solid #e2e8f0;
                vertical-align: top;
                color: #334155;
            }
            .lines-table tr:last-child td { border-bottom: none; }
            .lines-table tr:nth-child(even) { background-color: #f8fafc; }
            
            .signatures-section {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 50px;
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
            <h2>{language === 'en' ? 'Warehouse Transfer' : 'تحويل مخزني'}</h2>
            <div className="ref-number tabular" dir="ltr">#{data.transferNumber}</div>
            <div style={{ marginTop: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 'bold', background: data.documentStatus === 'posted' ? '#dcfce7' : '#f1f5f9', color: data.documentStatus === 'posted' ? '#166534' : '#64748b', padding: '4px 12px', borderRadius: 20 }}>
                    {data.documentStatus || 'DRAFT'}
                </span>
            </div>
        </div>
      </div>

      <div className="info-grid">
        <div className="info-item">
            <span className="info-label">{language === 'en' ? 'Date' : 'التاريخ'}</span>
            <span className="info-value tabular" dir="ltr">{new Date(data.transferDate).toLocaleDateString('en-GB')}</span>
        </div>
        <div className="info-item">
            <span className="info-label">{language === 'en' ? 'Reference' : 'المرجع'}</span>
            <span className="info-value tabular" dir="ltr">{data.referenceId || '—'}</span>
        </div>
        <div className="info-item">
            <span className="info-label">{language === 'en' ? 'From Warehouse' : 'من المستودع'}</span>
            <span className="info-value">{data.fromWarehouseName}</span>
        </div>
        <div className="info-item">
            <span className="info-label">{language === 'en' ? 'To Warehouse' : 'إلى المستودع'}</span>
            <span className="info-value">{data.toWarehouseName}</span>
        </div>
        <div className="info-item">
             <span className="info-label">{language === 'en' ? 'Status' : 'حالة النقل'}</span>
             <span className="info-value">{data.status}</span>
        </div>
      </div>

      <table className="lines-table">
          <thead>
            <tr>
              <th style={{ width: '50%' }}>{language === 'en' ? 'Item' : 'الصنف'}</th>
              <th style={{ width: '15%' }}>{language === 'en' ? 'Qty' : 'الكمية'}</th>
              <th style={{ width: '35%' }}>{language === 'en' ? 'Notes' : 'ملاحظات'}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr><td colSpan={3} className="text-center" style={{ padding: 30, color: '#94a3b8' }}>{language === 'en' ? 'No items' : 'لا توجد أصناف'}</td></tr>
            ) : data.items.map((it, idx) => (
              <tr key={`${it.itemId}-${idx}`}>
                <td>
                    <div style={{ fontWeight: 600 }}>{it.itemName || it.itemId}</div>
                </td>
                <td className="text-center tabular font-bold" dir="ltr">{Number(it.quantity || 0)}</td>
                <td style={{ color: '#64748b', fontSize: 11 }}>{it.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
      </table>

      {data.notes && (
        <div style={{ padding: 15, background: '#fefce8', border: '1px solid #fef08a', borderRadius: 6, marginBottom: 30 }}>
          <div style={{ fontWeight: 'bold', fontSize: 12, color: '#854d0e', marginBottom: 5 }}>{language === 'en' ? 'Notes' : 'ملاحظات'}</div>
          <div style={{ fontSize: 13, color: '#713f12' }}>{data.notes}</div>
        </div>
      )}

      <div className="signatures-section">
        <div className="signature-box">
            <div className="signature-label">{language === 'en' ? 'Sender' : 'المُرسل'}</div>
        </div>
        <div className="signature-box">
            <div className="signature-label">{language === 'en' ? 'Receiver' : 'المُستلم'}</div>
        </div>
      </div>

      <div className="footer-meta">
        <div>
            {language === 'en' ? 'Printed at' : 'تم الطباعة'}: <span dir="ltr" className="tabular">{new Date().toLocaleString('en-GB')}</span>
        </div>
        <div>
            Generated by {brand?.name || 'AZTA ERP'}
        </div>
      </div>
    </div>
  );
}
