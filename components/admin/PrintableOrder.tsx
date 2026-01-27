import React from 'react';
import { Order } from '../../types';
import { formatTimeForPrint, formatDateOnly } from '../../utils/printUtils';

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
        <div>
            <div className="header">
                {logoUrl ? <img src={logoUrl} alt={storeName} style={{ height: '40px', display: 'inline-block', marginBottom: '8px' }} /> : null}
                <h1>{storeName}</h1>
                <p>{language === 'en' ? 'Delivery Note' : 'سند تسليم'}</p>
                {cafeteriaAddress ? <p style={{ fontSize: '12px' }}>{cafeteriaAddress}</p> : null}
                {cafeteriaPhone ? <p style={{ fontSize: '12px' }}>هاتف: {cafeteriaPhone}</p> : null}
            </div>

            <div className="border-b mb-4">
                <div className="info-row">
                    <span className="font-bold">رقم الطلب:</span>
                    <span>#{order.id.slice(-6).toUpperCase()}</span>
                </div>
                <div className="info-row">
                    <span className="font-bold">التاريخ:</span>
                    <span>{formatDateOnly(order.createdAt)}</span>
                </div>
                <div className="info-row">
                    <span className="font-bold">الوقت:</span>
                    <span>{formatTimeForPrint(order.createdAt)}</span>
                </div>
                <div className="info-row">
                    <span className="font-bold">الحالة:</span>
                    <span>{getStatusText(order.status)}</span>
                </div>
                {order.isScheduled && order.scheduledAt && (
                    <div className="info-row">
                        <span className="font-bold">⏰ مجدول لـ:</span>
                        <span>{formatTimeForPrint(order.scheduledAt)}</span>
                    </div>
                )}
            </div>

            <div className="border-b mb-4">
                <h3 className="font-bold mb-2">معلومات العميل:</h3>
                <div className="info-row">
                    <span>الاسم:</span>
                    <span>{order.customerName}</span>
                </div>
                <div className="info-row">
                    <span>الهاتف:</span>
                    <span>{order.phoneNumber}</span>
                </div>
                {order.address ? (
                    <div className="info-row">
                        <span>العنوان:</span>
                        <span>{order.address}</span>
                    </div>
                ) : null}
            </div>

            <div className="mb-4">
                <h3 className="font-bold mb-2">الأصناف:</h3>
                <table>
                    <thead>
                        <tr>
                            <th style={{ width: '60px' }}>الكمية</th>
                            <th>الصنف</th>
                            <th>الإضافات</th>
                        </tr>
                    </thead>
                    <tbody>
                        {order.items.map((item, index) => (
                            <tr key={index}>
                                <td className="text-center font-bold" style={{ fontSize: '18px' }}>
                                    {item.quantity}
                                </td>
                                <td className="font-bold">{item.name[language]}</td>
                                <td>
                                    {Object.values(item.selectedAddons).length > 0 ? (
                                        <ul style={{ listStyle: 'none', padding: 0 }}>
                                            {Object.values(item.selectedAddons).map(({ addon, quantity }, i) => (
                                                <li key={i}>
                                                    <span style={{ color: '#16a34a', fontWeight: 'bold' }}>+</span>{' '}
                                                    {quantity > 1 && `${quantity}x `}
                                                    {addon.name[language]}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <span style={{ color: '#9ca3af' }}>-</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {order.notes && (
                <div className="mb-4" style={{
                    padding: '10px',
                    background: '#fef2f2',
                    border: '2px solid #ef4444',
                    borderRadius: '5px'
                }}>
                    <h3 className="font-bold mb-2" style={{ color: '#dc2626' }}>ملاحظات خاصة:</h3>
                    <p style={{ fontSize: '16px', fontWeight: 'bold' }}>{order.notes}</p>
                </div>
            )}

            <div className="mt-4 text-center" style={{
                borderTop: '2px dashed #000',
                paddingTop: '10px',
                fontSize: '12px',
                color: '#666'
            }}>
                <p>تم الطباعة: {new Date().toLocaleString('ar-EG-u-nu-latn')}</p>
            </div>
        </div>
    );
};

export default PrintableOrder;
