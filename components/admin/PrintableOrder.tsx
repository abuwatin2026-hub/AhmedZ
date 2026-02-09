import React from 'react';
import { Order } from '../../types';

interface PrintableOrderProps {
    order: Order;
    language?: 'ar' | 'en';
    cafeteriaName?: string;
    cafeteriaAddress?: string;
    cafeteriaPhone?: string;
    logoUrl?: string;
}

const PrintableOrder: React.FC<PrintableOrderProps> = ({ order, language = 'ar', cafeteriaName = '', cafeteriaAddress = '', cafeteriaPhone = '', logoUrl = '' }) => {
    const storeName = cafeteriaName;

    const getStatusText = (status: string) => {
        const statusMap: Record<string, string> = language === 'en'
            ? {
                pending: 'Pending',
                preparing: 'Preparing',
                out_for_delivery: 'Out for delivery',
                delivered: 'Delivered',
                scheduled: 'Scheduled',
            }
            : {
                pending: 'قيد الانتظار',
                preparing: 'قيد التحضير',
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
                }
                .header-section {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 30px;
                    border-bottom: 2px solid #1e293b;
                    padding-bottom: 20px;
                }
                .store-info h1 { font-size: 24px; font-weight: 800; margin: 0; color: #1e293b; }
                .store-info p { margin: 2px 0; font-size: 13px; color: #64748b; }
                .doc-title {
                    text-align: left;
                }
                .doc-title h2 {
                    font-size: 28px;
                    font-weight: 900;
                    color: #1e293b;
                    margin: 0;
                    text-transform: uppercase;
                }
                .doc-title .order-id {
                    font-size: 18px;
                    font-weight: bold;
                    color: #64748b;
                    font-family: 'Courier New', monospace;
                }

                .grid-info {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                    margin-bottom: 30px;
                }
                .info-box {
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    padding: 15px;
                }
                .info-box h3 {
                    margin: 0 0 10px 0;
                    font-size: 14px;
                    font-weight: bold;
                    color: #334155;
                    border-bottom: 1px dashed #cbd5e1;
                    padding-bottom: 5px;
                }
                .info-row {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 5px;
                    font-size: 13px;
                }
                .info-row span:first-child { color: #64748b; }
                .info-row span:last-child { font-weight: 600; color: #0f172a; }
                .tabular { font-variant-numeric: tabular-nums; font-family: 'Courier New', monospace; }

                .items-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 30px;
                }
                .items-table th {
                    background: #1e293b;
                    color: white;
                    padding: 10px;
                    text-align: right;
                    font-size: 12px;
                }
                .items-table td {
                    padding: 12px 10px;
                    border-bottom: 1px solid #e2e8f0;
                    vertical-align: top;
                }
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
                
                .footer {
                    margin-top: 50px;
                    text-align: center;
                    font-size: 11px;
                    color: #94a3b8;
                    border-top: 1px dashed #cbd5e1;
                    padding-top: 10px;
                }
            `}</style>

            <div className="header-section">
                <div className="store-info">
                    {logoUrl && <img src={logoUrl} alt="Logo" style={{ height: 50, marginBottom: 10 }} />}
                    <h1>{storeName}</h1>
                    {cafeteriaAddress && <p>{cafeteriaAddress}</p>}
                    {cafeteriaPhone && <p dir="ltr">{cafeteriaPhone}</p>}
                </div>
                <div className="doc-title">
                    <h2>{language === 'en' ? 'Delivery Note' : 'سند تسليم'}</h2>
                    <div className="order-id tabular" dir="ltr">#{order.id.slice(-6).toUpperCase()}</div>
                </div>
            </div>

            <div className="grid-info">
                <div className="info-box">
                    <h3>بيانات الطلب</h3>
                    <div className="info-row">
                        <span>التاريخ:</span>
                        <span className="tabular" dir="ltr">{new Date(order.createdAt).toLocaleDateString('en-GB')}</span>
                    </div>
                    <div className="info-row">
                        <span>الوقت:</span>
                        <span className="tabular" dir="ltr">{new Date(order.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="info-row">
                        <span>الحالة:</span>
                        <span>{getStatusText(order.status)}</span>
                    </div>
                    {order.isScheduled && order.scheduledAt && (
                        <div className="info-row" style={{ color: '#d97706', fontWeight: 'bold' }}>
                            <span>⏰ مجدول لـ:</span>
                            <span className="tabular" dir="ltr">{new Date(order.scheduledAt).toLocaleString('en-GB')}</span>
                        </div>
                    )}
                </div>

                <div className="info-box">
                    <h3>بيانات العميل</h3>
                    <div className="info-row">
                        <span>الاسم:</span>
                        <span>{order.customerName}</span>
                    </div>
                    <div className="info-row">
                        <span>الهاتف:</span>
                        <span className="tabular" dir="ltr">{order.phoneNumber}</span>
                    </div>
                    {order.address && (
                        <div className="info-row">
                            <span>العنوان:</span>
                            <span>{order.address}</span>
                        </div>
                    )}
                </div>
            </div>

            {order.notes && (
                <div className="notes-box">
                    <div className="notes-title">⚠️ ملاحظات خاصة (Special Notes)</div>
                    <div style={{ fontSize: 16, fontWeight: 'bold' }}>{order.notes}</div>
                </div>
            )}

            <h3 style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 10, color: '#1e293b' }}>تفاصيل الأصناف</h3>
            <table className="items-table">
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

            <div className="footer">
                <div className="tabular" dir="ltr">Printed: {new Date().toLocaleString('en-GB')}</div>
            </div>
        </div>
    );
};

export default PrintableOrder;
