import React from 'react';
import { Order } from '../../types';

interface PrintableOrderProps {
    order: Order;
    language?: 'ar' | 'en';
    companyName?: string;
    companyAddress?: string;
    companyPhone?: string;
    logoUrl?: string;
}

const PrintableOrder: React.FC<PrintableOrderProps> = ({ order, language = 'ar', companyName = '', companyAddress = '', companyPhone = '', logoUrl = '' }) => {
    const storeName = companyName;

    const getStatusText = (status: string) => {
        const statusMap: Record<string, string> = language === 'en'
            ? {
                pending: 'Pending',
                preparing: 'Processing',
                out_for_delivery: 'Out for delivery',
                delivered: 'Delivered',
                scheduled: 'Scheduled',
            }
            : {
                pending: 'قيد الانتظار',
                preparing: 'قيد التجهيز',
                out_for_delivery: 'في الطريق',
                delivered: 'تم التسليم',
                scheduled: 'مجدول',
            };
        return statusMap[status] || status;
    };

    return (
        <div className="order-container" dir="rtl">
            <style>{`
                @media print {
                    @page { size: A4; margin: 0; }
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
                .order-container {
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
                    grid-template-columns: repeat(2, 1fr);
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
                    text-align: right;
                    padding: 12px;
                    border-bottom: 2px solid #0f172a;
                }
                .lines-table td {
                    padding: 12px;
                    border-bottom: 1px solid #e2e8f0;
                    vertical-align: top;
                    color: #334155;
                }
                .lines-table tr:last-child td { border-bottom: none; }
                .lines-table tr:nth-child(even) { background-color: #f8fafc; }
                .qty-badge {
                    background: #e2e8f0;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-weight: bold;
                    font-family: 'Courier New', monospace;
                }

                .notes-box {
                    background: #fef2f2;
                    border: 2px solid #ef4444;
                    border-radius: 8px;
                    padding: 15px;
                    margin-bottom: 30px;
                    color: #b91c1c;
                }
                .notes-title { font-weight: bold; margin-bottom: 5px; display: flex; align-items: center; gap: 5px; }
                
                .footer-meta {
                    margin-top: 50px;
                    text-align: center;
                    font-size: 10px;
                    color: #94a3b8;
                    border-top: 1px dashed #cbd5e1;
                    padding-top: 10px;
                    display: flex;
                    justify-content: space-between;
                }
            `}</style>

            <div className="header-section">
                <div className="company-info">
                    {logoUrl && <img src={logoUrl} alt="Logo" style={{ height: 60, marginBottom: 10 }} />}
                    <h1>{storeName}</h1>
                    {companyAddress && <p>{companyAddress}</p>}
                    {companyPhone && <p dir="ltr">{companyPhone}</p>}
                </div>
                <div className="doc-title">
                    <h2>{language === 'en' ? 'Delivery Note' : 'سند تسليم'}</h2>
                    <div className="ref-number tabular" dir="ltr">#{order.id.slice(-6).toUpperCase()}</div>
                </div>
            </div>

            <div className="info-grid">
                <div className="info-item">
                    <span className="info-label">التاريخ</span>
                    <span className="info-value tabular" dir="ltr">{new Date(order.createdAt).toLocaleDateString('en-GB')}</span>
                </div>
                <div className="info-item">
                    <span className="info-label">الوقت</span>
                    <span className="info-value tabular" dir="ltr">{new Date(order.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="info-item">
                    <span className="info-label">اسم العميل</span>
                    <span className="info-value">{order.customerName}</span>
                </div>
                <div className="info-item">
                    <span className="info-label">رقم الهاتف</span>
                    <span className="info-value tabular" dir="ltr">{order.phoneNumber}</span>
                </div>
                {order.address && (
                    <div className="info-item" style={{ gridColumn: 'span 2' }}>
                        <span className="info-label">العنوان</span>
                        <span className="info-value">{order.address}</span>
                    </div>
                )}
                <div className="info-item">
                    <span className="info-label">الحالة</span>
                    <span className="info-value">{getStatusText(order.status)}</span>
                </div>
                {order.isScheduled && order.scheduledAt && (
                    <div className="info-item">
                        <span className="info-label">تاريخ الجدولة</span>
                        <span className="info-value tabular" dir="ltr" style={{ color: '#d97706' }}>{new Date(order.scheduledAt).toLocaleString('en-GB')}</span>
                    </div>
                )}
            </div>

            {order.notes && (
                <div className="notes-box">
                    <div className="notes-title">⚠️ ملاحظات خاصة (Special Notes)</div>
                    <div style={{ fontSize: 16, fontWeight: 'bold' }}>{order.notes}</div>
                </div>
            )}

            <h3 style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 15, color: '#1e293b' }}>تفاصيل الأصناف</h3>
            <table className="lines-table">
                <thead>
                    <tr>
                        <th style={{ width: '10%', textAlign: 'center' }}>الكمية</th>
                        <th style={{ width: '60%' }}>الصنف</th>
                        <th style={{ width: '30%' }}>الإضافات</th>
                    </tr>
                </thead>
                <tbody>
                    {order.items.map((item, index) => (
                        <tr key={index}>
                            <td style={{ textAlign: 'center' }}>
                                <span className="qty-badge tabular">{item.quantity}</span>
                            </td>
                            <td style={{ fontWeight: 600, fontSize: 14 }}>
                                {item.name[language]}
                            </td>
                            <td>
                                {Object.values(item.selectedAddons).length > 0 ? (
                                    <div style={{ fontSize: 12, color: '#475569' }}>
                                        {Object.values(item.selectedAddons).map(({ addon, quantity }, i) => (
                                            <div key={i} style={{ marginBottom: 2 }}>
                                                <span style={{ color: '#16a34a', fontWeight: 'bold' }}>+</span>{' '}
                                                {quantity > 1 && <span className="tabular">{quantity}x </span>}
                                                {addon.name[language]}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <span style={{ color: '#cbd5e1' }}>—</span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div className="footer-meta">
                <div>Printed: <span className="tabular" dir="ltr">{new Date().toLocaleString('en-GB')}</span></div>
                <div>Generated by AZTA ERP</div>
            </div>
        </div>
    );
};

export default PrintableOrder;
