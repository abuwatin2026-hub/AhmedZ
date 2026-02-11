import { formatDateOnly } from '../../../utils/printUtils';
type Brand = {
  name?: string;
  address?: string;
  contactNumber?: string;
  logoUrl?: string;
  branchName?: string;
  branchCode?: string;
};

type StatementRow = {
  occurred_at: string;
  journal_entry_id: string;
  journal_line_id: string;
  account_code: string;
  account_name: string;
  direction: 'debit' | 'credit';
  foreign_amount: number | null;
  base_amount: number;
  currency_code: string;
  fx_rate: number | null;
  memo: string | null;
  source_table: string | null;
  source_id: string | null;
  source_event: string | null;
  running_balance: number;
  open_base_amount: number | null;
  open_foreign_amount: number | null;
  open_status: string | null;
  allocations?: any;
};

const fmt = (n: number) => {
  const v = Number(n || 0);
  try {
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return v.toFixed(2);
  }
};

export default function PrintablePartyLedgerStatement(props: {
  brand?: Brand;
  partyId: string;
  partyName: string;
  accountCode?: string | null;
  currency?: string | null;
  start?: string | null;
  end?: string | null;
  rows: StatementRow[];
  printCurrencyCode?: string | null;
  printFxRate?: number | null;
  baseCurrencyCode?: string | null;
}) {
  const { brand, partyId, partyName, accountCode, currency, start, end, rows, printCurrencyCode, printFxRate, baseCurrencyCode } = props;
  const selectedCode = String(printCurrencyCode || '').trim().toUpperCase();
  const baseCode = String(baseCurrencyCode || '').trim().toUpperCase();
  const rate = Number(printFxRate || 1) || 1;
  const convert = (v: number): number => {
    if (selectedCode && baseCode && selectedCode !== baseCode) return (Number(v || 0) / rate);
    return Number(v || 0);
  };
  const totals = (() => {
    const debit = rows.reduce((s, r) => s + (r.direction === 'debit' ? convert(Number(r.base_amount || 0)) : 0), 0);
    const credit = rows.reduce((s, r) => s + (r.direction === 'credit' ? convert(Number(r.base_amount || 0)) : 0), 0);
    const last = rows.length ? convert(rows[rows.length - 1].running_balance) : 0;
    return { debit, credit, last };
  })();
  const periodText = [start ? formatDateOnly(start) : null, end ? formatDateOnly(end) : null]
    .filter(Boolean)
    .join(' — ');
  const headerFilters = [
    accountCode ? `الحساب: ${accountCode}` : '',
    currency ? `العملة: ${String(currency).toUpperCase()}` : '',
    periodText ? `الفترة: ${periodText}` : '',
    selectedCode ? `طباعة بعملة: ${selectedCode}${(baseCode && selectedCode !== baseCode && rate > 0) ? ` • سعر: ${rate}` : ''}` : '',
  ]
    .filter(Boolean)
    .join(' • ');

  return (
    <div className="statement-container" dir="rtl">
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .statement-container {
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
          margin-bottom: 24px;
          border-bottom: 2px solid #e2e8f0;
          padding-bottom: 16px;
        }
        .company-info { text-align: right; }
        .company-info h1 { font-size: 22px; font-weight: 800; margin: 0 0 5px 0; color: #0f172a; }
        .company-info p { margin: 2px 0; font-size: 13px; color: #475569; }
        .doc-title {
          text-align: left;
          background: #f8fafc;
          padding: 12px 20px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
        }
        .doc-title h2 {
          font-size: 22px;
          font-weight: 900;
          color: #0f172a;
          margin: 0;
        }
        .doc-title .ref {
          font-size: 13px;
          color: #64748b;
          margin-top: 6px;
          font-family: 'Courier New', monospace;
        }
        .party-info {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin: 18px 0;
          background: #f8fafc;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
        }
        .info-item { display: flex; flex-direction: column; }
        .info-label { font-size: 11px; color: #64748b; font-weight: bold; margin-bottom: 4px; }
        .info-value { font-size: 14px; font-weight: 600; color: #0f172a; }
        .tabular { font-variant-numeric: tabular-nums; font-family: 'Courier New', monospace; word-break: break-word; overflow-wrap: anywhere; }
        .summary {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-bottom: 18px;
        }
        .summary-card {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 12px;
        }
        .summary-card .label { font-size: 12px; color: #64748b; }
        .summary-card .value { font-size: 18px; font-weight: 800; color: #0f172a; }
        .lines-table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 18px; font-size: 12px; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; table-layout: fixed; }
        .lines-table th {
          background: #1e293b;
          color: white;
          font-weight: 700;
          text-align: center;
          padding: 10px;
          border-bottom: 2px solid #0f172a;
        }
        .lines-table th:first-child { text-align: right; }
        .lines-table td {
          padding: 10px;
          border-bottom: 1px solid #e2e8f0;
          vertical-align: top;
          color: #334155;
          word-break: break-word;
          overflow-wrap: anywhere;
        }
        .lines-table tr:last-child td { border-bottom: none; }
        .lines-table tr:nth-child(even) { background-color: #f8fafc; }
        .footer-meta {
          margin-top: 24px;
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
          {brand?.logoUrl && <img src={brand.logoUrl} alt="Logo" style={{ height: 56, marginBottom: 8 }} />}
          <h1>{(brand?.name || '').trim()}</h1>
          {brand?.branchName && <p>{brand.branchName}</p>}
          {brand?.address && <p>{brand.address}</p>}
          {brand?.contactNumber && <p dir="ltr" className="tabular">{brand.contactNumber}</p>}
        </div>
        <div className="doc-title">
          <h2>كشف حساب طرف</h2>
          <div className="ref tabular" dir="ltr">Party: {partyName} • {partyId.slice(-8).toUpperCase()}</div>
          {headerFilters && <div className="ref">{headerFilters}</div>}
        </div>
      </div>

      <div className="party-info">
        <div className="info-item">
          <span className="info-label">اسم الطرف</span>
          <span className="info-value">{partyName || '—'}</span>
        </div>
        <div className="info-item">
          <span className="info-label">المعرف</span>
          <span className="info-value tabular" dir="ltr">{partyId}</span>
        </div>
        <div className="info-item">
          <span className="info-label">تاريخ الطباعة</span>
          <span className="info-value tabular" dir="ltr">{new Date().toLocaleString('en-GB')}</span>
        </div>
      </div>

      <div className="summary">
        <div className="summary-card">
          <div className="label">إجمالي مدين</div>
          <div className="value tabular" dir="ltr">{fmt(totals.debit)}</div>
        </div>
        <div className="summary-card">
          <div className="label">إجمالي دائن</div>
          <div className="value tabular" dir="ltr">{fmt(totals.credit)}</div>
        </div>
        <div className="summary-card">
          <div className="label">الرصيد الحالي</div>
          <div className="value tabular" dir="ltr">{fmt(totals.last)}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
            {totals.last < 0 ? 'دائن' : totals.last > 0 ? 'مدين' : 'متزن'}
          </div>
        </div>
      </div>

      <table className="lines-table">
        <thead>
          <tr>
            <th style={{ width: '12%' }}>التاريخ</th>
            <th style={{ width: '10%' }}>رمز الحساب</th>
            <th style={{ width: '18%' }}>اسم الحساب</th>
            <th style={{ width: '12%' }}>مدين</th>
            <th style={{ width: '12%' }}>دائن</th>
            <th style={{ width: '12%' }}>الرصيد</th>
            <th style={{ width: '12%' }}>المصدر</th>
            <th style={{ width: '12%' }}>المتبقي/الحالة</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={8} className="text-center" style={{ padding: 28, color: '#94a3b8' }}>لا توجد حركات</td></tr>
          ) : rows.map((r) => (
            <tr key={r.journal_line_id}>
              <td className="tabular" dir="ltr">{new Date(r.occurred_at).toLocaleString('en-GB')}</td>
              <td className="tabular" dir="ltr" style={{ fontWeight: 700, color: '#475569' }}>{r.account_code}</td>
              <td style={{ fontWeight: 600 }}>{r.account_name}</td>
              <td className="tabular text-center" dir="ltr" style={{ color: r.direction === 'debit' ? '#0f172a' : '#cbd5e1' }}>
                {r.direction === 'debit' ? fmt(convert(Number(r.base_amount || 0))) : '—'}
                <div style={{ fontSize: 10, color: '#64748b' }}>{selectedCode || baseCode}</div>
              </td>
              <td className="tabular text-center" dir="ltr" style={{ color: r.direction === 'credit' ? '#0f172a' : '#cbd5e1' }}>
                {r.direction === 'credit' ? fmt(convert(Number(r.base_amount || 0))) : '—'}
                <div style={{ fontSize: 10, color: '#64748b' }}>{selectedCode || baseCode}</div>
              </td>
              <td className="tabular text-center" dir="ltr">{fmt(convert(Number(r.running_balance || 0)))}</td>
              <td>
                {(() => {
                  const t = String(r.source_table || '').trim();
                  const e = String(r.source_event || '').trim();
                  const id = String(r.source_id || '').trim();
                  const mapTable = (x: string) => {
                    const xl = x.toLowerCase();
                    if (xl === 'payments') return 'دفعة';
                    if (xl === 'purchase_orders') return 'أمر شراء';
                    if (xl === 'orders') return 'طلب/فاتورة';
                    if (xl === 'inventory_movements') return 'حركة مخزون';
                    if (xl === 'journal_vouchers') return 'قيد اليومية';
                    return x || '—';
                  };
                  const mapEvent = (x: string) => {
                    const xl = x.toLowerCase();
                    if (xl === 'out') return 'صرف';
                    if (xl === 'in') return 'قبض';
                    if (xl === 'created') return 'إنشاء';
                    if (xl === 'purchase_in') return 'استلام مشتريات';
                    return x || '';
                  };
                  const label = [mapTable(t), mapEvent(e)].filter(Boolean).join(' • ');
                  const shortId = id ? id.slice(-8).toUpperCase() : '—';
                  return (
                    <>
                      <div className="tabular" style={{ fontSize: 11 }}>{label || '—'}</div>
                      <div className="tabular" dir="ltr" style={{ fontSize: 11, color: '#64748b' }}>{shortId}</div>
                    </>
                  );
                })()}
              </td>
              <td>
                <div className="tabular" dir="ltr" style={{ fontSize: 12 }}>
                  {r.open_base_amount == null ? '—' : fmt(convert(Number(r.open_base_amount || 0)))}
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  {r.open_status === 'open' ? 'مفتوح' : r.open_status === 'partially_settled' ? 'مجزأ' : r.open_status ? 'مُسوّى' : '—'}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="footer-meta">
        <div>تمت الطباعة بواسطة النظام في <span dir="ltr" className="tabular">{new Date().toLocaleString('en-GB')}</span></div>
        <div>{brand?.name || 'AZTA ERP'}</div>
      </div>
    </div>
  );
}
