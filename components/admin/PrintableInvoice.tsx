import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Order } from '../../types';
import { formatDateForPrint } from '../../utils/printUtils';
import { computeCartItemPricing } from '../../utils/orderUtils';

// Helper to generate TLV base64 for ZATCA QR
const generateZatcaTLV = (sellerName: string, vatRegistrationNumber: string, timestamp: string, total: string, vatTotal: string) => {
    // Note: Buffer is a Node.js API. In browser we might need a polyfill or simple byte array manipulation.
    // For simplicity in this React component, we'll assume a lightweight implementation:
    const simpleTLV = (tag: number, value: string) => {
        const utf8Encoder = new TextEncoder();
        const valueBytes = utf8Encoder.encode(value);
        const len = valueBytes.length;
        const tagByte = new Uint8Array([tag]);
        const lenByte = new Uint8Array([len]);
        const combined = new Uint8Array(tagByte.length + lenByte.length + valueBytes.length);
        combined.set(tagByte);
        combined.set(lenByte, tagByte.length);
        combined.set(valueBytes, tagByte.length + lenByte.length);
        return combined;
    };

    const tags = [
        simpleTLV(1, sellerName),
        simpleTLV(2, vatRegistrationNumber),
        simpleTLV(3, timestamp),
        simpleTLV(4, total),
        simpleTLV(5, vatTotal)
    ];

    // Concatenate all Uint8Arrays
    const totalLength = tags.reduce((acc, curr) => acc + curr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    tags.forEach(tag => {
        result.set(tag, offset);
        offset += tag.length;
    });

    // Convert to Base64
    let binary = '';
    const len = result.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(result[i]);
    }
    return window.btoa(binary);
};

interface PrintableInvoiceProps {
    order: Order;
    language?: 'ar' | 'en';
    cafeteriaName?: string;
    cafeteriaPhone?: string;
    cafeteriaAddress?: string;
    logoUrl?: string;
    vatNumber?: string; // Added VAT Number
    deliveryZoneName?: string;
    thermal?: boolean;
    thermalPaperWidth?: '58mm' | '80mm';
    isCopy?: boolean;
    copyNumber?: number;
    audit?: any;
}

const PrintableInvoice: React.FC<PrintableInvoiceProps> = ({
    order,
    language = 'ar',
    cafeteriaName,
    cafeteriaPhone,
    cafeteriaAddress,
    logoUrl,
    vatNumber,
    deliveryZoneName,
    thermal = false,
    thermalPaperWidth = '58mm',
    isCopy = false,
    copyNumber,
    audit,
}) => {
    const invoiceSnapshot = order.invoiceSnapshot;
    const invoiceOrder = invoiceSnapshot
        ? {
            ...order,
            createdAt: invoiceSnapshot.createdAt,
            deliveryZoneId: invoiceSnapshot.deliveryZoneId,
            items: invoiceSnapshot.items,
            subtotal: invoiceSnapshot.subtotal,
            deliveryFee: invoiceSnapshot.deliveryFee,
            discountAmount: invoiceSnapshot.discountAmount,
            total: invoiceSnapshot.total,
            paymentMethod: invoiceSnapshot.paymentMethod,
            customerName: invoiceSnapshot.customerName,
            phoneNumber: invoiceSnapshot.phoneNumber,
            address: invoiceSnapshot.address,
            invoiceIssuedAt: invoiceSnapshot.issuedAt,
            invoiceNumber: invoiceSnapshot.invoiceNumber,
            orderSource: invoiceSnapshot.orderSource,
            taxAmount: invoiceSnapshot.taxAmount,
            taxRate: invoiceSnapshot.taxRate,
        }
        : order;

    const resolvedCafeteriaName = cafeteriaName || '';
    const resolvedCafeteriaPhone = cafeteriaPhone || '';
    const resolvedCafeteriaAddress = cafeteriaAddress || '';
    const resolvedLogoUrl = logoUrl || '';
    const resolvedVatNumber = vatNumber || '';
    const resolvedThermalPaperWidth: '58mm' | '80mm' = thermalPaperWidth === '80mm' ? '80mm' : '58mm';

    const numericCellStyle: React.CSSProperties = {
        textAlign: 'right',
        direction: 'ltr',
        fontVariantNumeric: 'tabular-nums',
        fontFeatureSettings: '"tnum"',
    };

    // Generate ZATCA QR Code Data
    const qrData = generateZatcaTLV(
        resolvedCafeteriaName,
        resolvedVatNumber,
        invoiceOrder.invoiceIssuedAt || new Date().toISOString(),
        invoiceOrder.total.toFixed(2),
        (invoiceOrder.taxAmount || 0).toFixed(2)
    );

    const getPaymentMethodText = (method: string) => {
        const methodMap: Record<string, string> = {
            cash: 'نقدًا',
            kuraimi: 'حسابات بنكية',
            network: 'حوالات',
            card: 'حوالات',
            bank: 'حسابات بنكية',
            bank_transfer: 'حسابات بنكية',
            mixed: language === 'ar' ? 'متعدد' : 'Mixed',
        };
        return methodMap[method] || method;
    };

    return (
        <div style={{ maxWidth: thermal ? resolvedThermalPaperWidth : '800px', width: thermal ? resolvedThermalPaperWidth : 'auto', margin: '0 auto', color: '#000', fontFamily: thermal ? 'Tahoma, Arial, sans-serif' : 'inherit', fontSize: thermal ? '12px' : '14px' }}>
            {isCopy && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ fontWeight: 700, color: '#b91c1c' }}>
                        {language === 'ar' ? 'نسخة' : 'Copy'} {typeof copyNumber === 'number' ? `#${copyNumber}` : ''}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                        {invoiceOrder.invoiceLastPrintedAt ? `${language === 'ar' ? 'آخر طباعة' : 'Last printed'}: ${formatDateForPrint(invoiceOrder.invoiceLastPrintedAt)}` : ''}
                    </div>
                </div>
            )}
            <div style={{ textAlign: 'center', marginBottom: thermal ? '6px' : '10px' }}>
                {resolvedLogoUrl ? (
                    <img src={resolvedLogoUrl} alt={resolvedCafeteriaName} style={{ height: thermal ? '28px' : '40px', display: 'inline-block' }} />
                ) : null}
                <div style={{ fontWeight: 800, fontSize: thermal ? '16px' : '20px', marginTop: '6px' }}>{resolvedCafeteriaName}</div>
                {resolvedCafeteriaAddress ? <div style={{ fontSize: thermal ? '11px' : '13px' }}>{resolvedCafeteriaAddress}</div> : null}
                {resolvedCafeteriaPhone ? <div style={{ fontSize: thermal ? '11px' : '13px' }}>هاتف: {resolvedCafeteriaPhone}</div> : null}
                {resolvedVatNumber ? <div style={{ fontSize: thermal ? '11px' : '13px', marginTop: '2px' }}>الرقم الضريبي: {resolvedVatNumber}</div> : null}
            </div>

            <div style={{ borderTop: '1px dashed #000', margin: thermal ? '6px 0' : '10px 0' }}></div>

            <div style={{ textAlign: 'center', fontWeight: 700, marginBottom: thermal ? '6px' : '10px', fontSize: thermal ? '14px' : '20px' }}>
                {language === 'ar' ? 'فاتورة' : 'Invoice'}
            </div>

            <div style={{ marginBottom: thermal ? '6px' : '12px', display: 'grid', gridTemplateColumns: thermal ? '1fr' : '1fr 1fr', gap: thermal ? '6px' : '20px' }}>
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 700 }}>{language === 'ar' ? 'رقم:' : 'No.:'}</span>
                        <span>{invoiceOrder.invoiceNumber || `#${invoiceOrder.id.slice(-8).toUpperCase()}`}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 700 }}>{language === 'ar' ? 'التاريخ:' : 'Date:'}</span>
                        <span>{formatDateForPrint(invoiceOrder.invoiceIssuedAt || invoiceOrder.createdAt)}</span>
                    </div>
                </div>
                <div>
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>{language === 'ar' ? 'إلى:' : 'To:'}</div>
                    <div>{invoiceOrder.customerName}</div>
                    {invoiceOrder.phoneNumber ? <div>{invoiceOrder.phoneNumber}</div> : null}
                    {invoiceOrder.address ? <div style={{ fontSize: thermal ? '11px' : '12px', color: '#444' }}>{invoiceOrder.address}</div> : null}
                    {invoiceOrder.deliveryZoneId && (
                        <div style={{ fontSize: thermal ? '11px' : '12px', color: '#444' }}>
                            {language === 'ar' ? 'منطقة:' : 'Zone:'}{' '}
                            {deliveryZoneName
                                ? deliveryZoneName
                                : (invoiceOrder.orderSource === 'in_store'
                                    ? (language === 'ar' ? 'داخل المحل' : 'In-store')
                                    : invoiceOrder.deliveryZoneId.slice(-6).toUpperCase())}
                        </div>
                    )}
                </div>
            </div>

            <table className="mb-4" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr>
                        <th style={{ width: thermal ? '24px' : '50px', borderBottom: '1px dashed #000', textAlign: 'center' }}>#</th>
                        <th style={{ borderBottom: '1px dashed #000', textAlign: 'left' }}>الصنف</th>
                        <th style={{ width: thermal ? '60px' : '80px', borderBottom: '1px dashed #000', ...numericCellStyle }}>الكمية</th>
                        <th style={{ width: thermal ? '70px' : '100px', borderBottom: '1px dashed #000', ...numericCellStyle }}>السعر</th>
                        <th style={{ width: thermal ? '80px' : '100px', borderBottom: '1px dashed #000', ...numericCellStyle }}>المجموع</th>
                    </tr>
                </thead>
                <tbody>
                    {invoiceOrder.items.map((item, index) => {
                        const pricing = computeCartItemPricing(item);
                        const displayQty = pricing.isWeightBased
                            ? `${pricing.quantity} ${pricing.unitType === 'gram' ? (language === 'ar' ? 'جم' : 'g') : (language === 'ar' ? 'كجم' : 'kg')}`
                            : String(item.quantity);

                        return (
                            <React.Fragment key={item.cartItemId || index}>
                                <tr>
                                    <td style={{ textAlign: 'center' }}>{index + 1}</td>
                                    <td>
                                        <div style={{ fontWeight: 700 }}>{item.name?.[language] || item.name?.ar || item.name?.en || item.id}</div>
                                        {Object.values(item.selectedAddons).length > 0 ? (
                                            <div style={{ fontSize: thermal ? '10px' : '12px', color: '#666', marginTop: '2px' }}>
                                                {Object.values(item.selectedAddons).map(({ addon, quantity }, i) => (
                                                    <div key={i}>
                                                        + {quantity > 1 && `${quantity}x `}{addon.name[language]} ({addon.price} ر.ي)
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
                                    </td>
                                    <td style={numericCellStyle}>{displayQty}</td>
                                    <td style={numericCellStyle}>{pricing.unitPrice.toFixed(2)}</td>
                                    <td style={{ ...numericCellStyle, fontWeight: 700 }}>{pricing.lineTotal.toFixed(2)}</td>
                                </tr>
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>

            <div style={{ marginLeft: 'auto', width: thermal ? '100%' : '300px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{language === 'ar' ? 'المجموع الفرعي:' : 'Subtotal:'}</span>
                    <span style={numericCellStyle}>{invoiceOrder.subtotal.toFixed(2)} ر.ي</span>
                </div>

                {invoiceOrder.discountAmount && invoiceOrder.discountAmount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#16a34a' }}>
                        <span>{language === 'ar' ? 'الخصم:' : 'Discount:'}</span>
                        <span style={numericCellStyle}>- {invoiceOrder.discountAmount.toFixed(2)} ر.ي</span>
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{language === 'ar' ? 'رسوم التوصيل:' : 'Delivery fee:'}</span>
                    <span style={numericCellStyle}>{(Number(invoiceOrder.deliveryFee) || 0).toFixed(2)} ر.ي</span>
                </div>

                {invoiceOrder.taxAmount && invoiceOrder.taxAmount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>{language === 'ar' ? `الضريبة (${invoiceOrder.taxRate || 0}%):` : `Tax (${invoiceOrder.taxRate || 0}%):`}</span>
                        <span style={numericCellStyle}>{invoiceOrder.taxAmount.toFixed(2)} ر.ي</span>
                    </div>
                )}

                <div style={{ borderTop: '1px dashed #000', margin: thermal ? '6px 0' : '10px 0' }}></div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: thermal ? '14px' : '18px', padding: thermal ? '6px' : '10px' }}>
                    <span>{language === 'ar' ? 'الإجمالي:' : 'Total:'}</span>
                    <span style={{ ...numericCellStyle, color: '#000' }}>{invoiceOrder.total.toFixed(2)} ر.ي</span>
                </div>
            </div>

            <div className="mt-4 mb-4">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="font-bold">{language === 'ar' ? 'طريقة الدفع:' : 'Payment method:'}</span>
                    <span>{getPaymentMethodText(invoiceOrder.paymentMethod)}</span>
                </div>
                {Array.isArray((invoiceOrder as any).paymentBreakdown) && (invoiceOrder as any).paymentBreakdown.length > 0 && (
                    <div style={{ marginTop: '6px', fontSize: thermal ? '11px' : '12px' }}>
                        {(invoiceOrder as any).paymentBreakdown.map((p: any, idx: number) => {
                            const amount = Number(p?.amount) || 0;
                            const method = typeof p?.method === 'string' ? p.method : '';
                            const ref = typeof p?.referenceNumber === 'string' ? p.referenceNumber : '';
                            const cashReceived = Number(p?.cashReceived) || 0;
                            const cashChange = Number(p?.cashChange) || 0;
                            const left = [
                                getPaymentMethodText(method),
                                ref ? ref : '',
                                method === 'cash' && cashReceived > 0 ? `${language === 'ar' ? 'مستلم' : 'Received'}: ${cashReceived.toFixed(2)}` : '',
                                method === 'cash' && cashReceived > 0 ? `${language === 'ar' ? 'باقي' : 'Change'}: ${cashChange.toFixed(2)}` : '',
                            ].filter(Boolean).join(' • ');
                            return (
                                <div key={`${method}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                                    <span>{left}</span>
                                    <span style={{ fontWeight: 700 }}>{amount.toFixed(2)} ر.ي</span>
                                </div>
                            );
                        })}
                    </div>
                )}
                {invoiceOrder.orderSource && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="font-bold">{language === 'ar' ? 'مصدر الطلب:' : 'Source:'}</span>
                        <span>{invoiceOrder.orderSource === 'in_store' ? (language === 'ar' ? 'حضوري' : 'In-store') : (language === 'ar' ? 'أونلاين' : 'Online')}</span>
                    </div>
                )}
                {invoiceOrder.appliedCouponCode && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="font-bold">{language === 'ar' ? 'كوبون الخصم:' : 'Coupon:'}</span>
                        <span>{invoiceOrder.appliedCouponCode}</span>
                    </div>
                )}
                {audit && (audit.discountType || audit.journalEntryId || (Array.isArray(audit.promotions) && audit.promotions.length > 0)) && (
                    <div style={{ marginTop: '8px', borderTop: '1px dashed #000', paddingTop: '6px', fontSize: thermal ? '10px' : '12px' }}>
                        <div style={{ fontWeight: 700, marginBottom: '4px' }}>{language === 'ar' ? 'تفاصيل التدقيق' : 'Audit Details'}</div>
                        {audit.discountType && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                                <span>{language === 'ar' ? 'نوع الخصم' : 'Discount Type'}</span>
                                <span style={{ fontWeight: 700 }} dir="ltr">{String(audit.discountType)}</span>
                            </div>
                        )}
                        {Array.isArray(audit.promotions) && audit.promotions.length > 0 && (
                            <div style={{ marginTop: '4px' }}>
                                <div style={{ fontWeight: 700 }}>{language === 'ar' ? 'العروض' : 'Promotions'}</div>
                                {audit.promotions.map((p: any, idx: number) => {
                                    const promoName = String(p?.promotionName || '—');
                                    const promoId = String(p?.promotionId || '');
                                    const approvalId = String(p?.approvalRequestId || '');
                                    return (
                                        <div key={`${promoId || idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                                            <span>{promoName}</span>
                                            <span style={{ fontFamily: 'monospace' }} dir="ltr">
                                                {promoId ? promoId.slice(-8) : '—'}
                                                {approvalId ? ` • APR-${approvalId.slice(-8)}` : ''}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {audit.discountType === 'Manual Discount' && audit.manualDiscountApprovalRequestId && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '4px' }}>
                                <span>{language === 'ar' ? 'موافقة الخصم' : 'Discount Approval'}</span>
                                <span style={{ fontFamily: 'monospace' }} dir="ltr">
                                    APR-{String(audit.manualDiscountApprovalRequestId).slice(-8)}
                                    {audit.manualDiscountApprovalStatus ? ` • ${String(audit.manualDiscountApprovalStatus)}` : ''}
                                </span>
                            </div>
                        )}
                        {audit.journalEntryId && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '4px' }}>
                                <span>{language === 'ar' ? 'قيد اليومية' : 'Journal Entry'}</span>
                                <span style={{ fontFamily: 'monospace', fontWeight: 700 }} dir="ltr">JE-{String(audit.journalEntryId).slice(-8)}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="mt-4 text-center" style={{ borderTop: '1px dashed #000', paddingTop: thermal ? '8px' : '15px', fontSize: thermal ? '12px' : '14px' }}>
                <p className="font-bold mb-2">
                    {language === 'ar' ? `شكراً لطلبك من ${resolvedCafeteriaName}!` : `Thank you for your order from ${resolvedCafeteriaName}!`}
                </p>
                <p style={{ color: '#666', fontSize: thermal ? '10px' : '12px' }}>
                    {language === 'ar' ? 'نتمنى لك يوماً سعيداً' : 'We wish you a great day'}
                </p>
            </div>

            <div className="mt-4 text-center" style={{ fontSize: thermal ? '9px' : '10px', color: '#999' }}>
                <p>{language === 'ar' ? 'تم الطباعة' : 'Printed'}: {new Date().toLocaleString(language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US')}</p>
                {isCopy ? (
                    <p style={{ marginTop: '4px', fontWeight: 700, color: '#b91c1c' }}>{language === 'ar' ? 'نسخة' : 'Copy'}</p>
                ) : null}
            </div>
            
            <div style={{ textAlign: 'center', marginTop: '10px', display: 'flex', justifyContent: 'center' }}>
                <QRImage value={qrData} size={thermal ? 100 : 128} />
            </div>
        </div>
    );
};

export default PrintableInvoice;

const QRImage: React.FC<{ value: string; size?: number }> = ({ value, size = 128 }) => {
    const [url, setUrl] = useState<string>('');
    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const dataUrl = await QRCode.toDataURL(value, { width: size, margin: 1 });
                if (active) setUrl(dataUrl);
            } catch {
                if (active) setUrl('');
            }
        })();
        return () => { active = false; };
    }, [value, size]);
    if (!url) return null;
    return <img src={url} alt="QR" style={{ width: size, height: size }} />;
};
