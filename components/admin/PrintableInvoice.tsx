import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Order } from '../../types';
import { computeCartItemPricing } from '../../utils/orderUtils';
import { AZTA_IDENTITY } from '../../config/identity';

// Helper to generate TLV base64 for ZATCA QR
export const generateZatcaTLV = (sellerName: string, vatRegistrationNumber: string, timestamp: string, total: string, vatTotal: string) => {
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
    companyName?: string;
    companyPhone?: string;
    companyAddress?: string;
    logoUrl?: string;
    vatNumber?: string; // Added VAT Number
    deliveryZoneName?: string;
    thermal?: boolean;
    thermalPaperWidth?: '58mm' | '80mm';
    isCopy?: boolean;
    copyNumber?: number;
    audit?: any;
    qrCodeDataUrl?: string;
}

const PrintableInvoice: React.FC<PrintableInvoiceProps> = ({
    order,
    language = 'ar',
    companyName,
    companyPhone,
    companyAddress,
    logoUrl,
    vatNumber,
    deliveryZoneName,
    thermalPaperWidth = '58mm',
    isCopy = false,
    qrCodeDataUrl,
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
            invoiceTerms: invoiceSnapshot.invoiceTerms ?? (order as any).invoiceTerms,
            netDays: invoiceSnapshot.netDays ?? (order as any).netDays,
            dueDate: invoiceSnapshot.dueDate ?? (order as any).dueDate,
            currency: invoiceSnapshot.currency ?? (order as any).currency,
            fxRate: invoiceSnapshot.fxRate ?? (order as any).fxRate,
        }
        : order;

    const resolvedCompanyName = companyName || '';
    const resolvedCompanyPhone = companyPhone || '';
    const resolvedCompanyAddress = companyAddress || '';
    const resolvedLogoUrl = logoUrl || '';
    const resolvedVatNumber = vatNumber || '';
    const resolvedThermalPaperWidth: '58mm' | '80mm' = thermalPaperWidth === '80mm' ? '80mm' : '58mm';
    const systemName = language === 'ar' ? AZTA_IDENTITY.tradeNameAr : AZTA_IDENTITY.tradeNameEn;
    const branchName = resolvedCompanyName.trim();
    const showBranchName = Boolean(branchName) && branchName !== systemName.trim();

    const currencyCode = String((invoiceOrder as any).currency || '').toUpperCase();
    const currencyLabel = currencyCode || '—';
    const formatAmount = (value: number) => {
        const n = Number(value) || 0;
        try {
            return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } catch {
            return n.toFixed(2);
        }
    };

    // Generate ZATCA QR Code Data
    const qrData = generateZatcaTLV(
        systemName,
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
            ar: 'آجل',
            mixed: language === 'ar' ? 'متعدد' : 'Mixed',
        };
        return methodMap[method] || method;
    };

    const invoiceTerms: 'cash' | 'credit' = (invoiceOrder as any).invoiceTerms === 'credit' || invoiceOrder.paymentMethod === 'ar' ? 'credit' : 'cash';
    const invoiceDueDate = typeof (invoiceOrder as any).dueDate === 'string' ? String((invoiceOrder as any).dueDate) : '';

    return (
        <div className="thermal-invoice" dir="rtl">
            <style>{`
                .thermal-invoice {
                    font-family: 'Tahoma', 'Arial', sans-serif;
                    font-size: 12px;
                    line-height: 1.4;
                    color: #000;
                    width: ${resolvedThermalPaperWidth};
                    max-width: ${resolvedThermalPaperWidth};
                    margin: 0 auto;
                    padding: 0 2px;
                }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .text-left { text-align: left; }
                .font-bold { font-weight: bold; }
                .text-xs { font-size: 10px; }
                .text-sm { font-size: 11px; }
                .text-lg { font-size: 14px; }
                .text-xl { font-size: 16px; }
                .mb-1 { margin-bottom: 4px; }
                .mb-2 { margin-bottom: 8px; }
                .mt-1 { margin-top: 4px; }
                .mt-2 { margin-top: 8px; }
                .py-1 { padding-top: 4px; padding-bottom: 4px; }
                .border-b { border-bottom: 1px dashed #000; }
                .border-t { border-top: 1px dashed #000; }
                .border-y { border-top: 1px dashed #000; border-bottom: 1px dashed #000; }
                .flex { display: flex; justify-content: space-between; align-items: baseline; }
                .tabular { font-variant-numeric: tabular-nums; font-family: 'Courier New', monospace; letter-spacing: -0.5px; }
                .logo-img { height: 40px; margin-bottom: 5px; display: block; margin-left: auto; margin-right: auto; }
                table { width: 100%; border-collapse: collapse; }
                th { text-align: right; font-size: 10px; border-bottom: 1px dashed #000; padding-bottom: 4px; }
                td { padding: 4px 0; vertical-align: top; }
                .item-name { font-weight: bold; margin-bottom: 2px; }
                .item-meta { font-size: 10px; color: #444; }
                .total-box { border: 2px solid #000; padding: 8px; margin-top: 10px; border-radius: 4px; }
                .watermark { 
                    position: fixed; top: 30%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg);
                    font-size: 40px; font-weight: bold; color: rgba(0,0,0,0.1); pointer-events: none; z-index: 0; border: 4px solid rgba(0,0,0,0.1); padding: 10px 40px;
                }
            `}</style>

            {isCopy && (
                <div className="watermark">نسخة</div>
            )}

            <div className="text-center mb-2">
                {resolvedLogoUrl && <img src={resolvedLogoUrl} alt="Logo" className="logo-img" />}
                <div className="font-bold text-lg mb-1">{systemName}</div>
                {showBranchName && <div className="text-sm mb-1">{branchName}</div>}
                <div className="text-xs">{resolvedCompanyAddress}</div>
                {resolvedCompanyPhone && <div className="text-xs" dir="ltr">{resolvedCompanyPhone}</div>}
                {resolvedVatNumber && <div className="text-xs mt-1 font-bold">الرقم الضريبي: <span dir="ltr" className="tabular">{resolvedVatNumber}</span></div>}
            </div>

            <div className="text-center border-y py-1 mb-2">
                <div className="font-bold text-lg">فاتورة ضريبية</div>
                <div className="text-xs uppercase tracking-wider">Tax Invoice</div>
            </div>

            <div className="mb-2 text-sm">
                <div className="flex">
                    <span>رقم الفاتورة:</span>
                    <span className="font-bold tabular" dir="ltr">{invoiceOrder.invoiceNumber || invoiceOrder.id.slice(-8).toUpperCase()}</span>
                </div>
                <div className="flex">
                    <span>التاريخ:</span>
                    <span className="tabular" dir="ltr">{new Date(invoiceOrder.invoiceIssuedAt || invoiceOrder.createdAt).toLocaleDateString('en-GB')} {new Date(invoiceOrder.invoiceIssuedAt || invoiceOrder.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                </div>
                <div className="flex">
                    <span>العميل:</span>
                    <span className="font-bold">{invoiceOrder.customerName}</span>
                </div>
                {invoiceOrder.deliveryZoneId && (
                    <div className="flex">
                        <span>المنطقة:</span>
                        <span>{deliveryZoneName || invoiceOrder.deliveryZoneId}</span>
                    </div>
                )}
            </div>

            <table className="mb-2">
                <thead>
                    <tr>
                        <th style={{ width: '45%' }}>الصنف</th>
                        <th style={{ width: '15%', textAlign: 'center' }}>الكمية</th>
                        <th style={{ width: '20%', textAlign: 'center' }}>السعر</th>
                        <th style={{ width: '20%', textAlign: 'left' }}>المجموع</th>
                    </tr>
                </thead>
                <tbody>
                    {invoiceOrder.items.map((item, index) => {
                        const pricing = computeCartItemPricing(item);
                        const displayQty = pricing.isWeightBased
                            ? `${pricing.quantity} ${pricing.unitType === 'gram' ? 'جم' : 'كجم'}`
                            : String(item.quantity);

                        return (
                            <tr key={item.cartItemId || index}>
                                <td>
                                    <div className="item-name">{item.name?.[language] || item.name?.ar || item.name?.en}</div>
                                    {Object.values(item.selectedAddons).length > 0 && (
                                        <div className="item-meta">
                                            {Object.values(item.selectedAddons).map(({ addon, quantity }, i) => (
                                                <span key={i}>+ {addon.name[language]} {quantity > 1 ? `(${quantity})` : ''} </span>
                                            ))}
                                        </div>
                                    )}
                                </td>
                                <td className="text-center tabular">{displayQty}</td>
                                <td className="text-center tabular">{formatAmount(pricing.unitPrice)}</td>
                                <td className="text-left font-bold tabular">{formatAmount(pricing.lineTotal)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            <div className="border-t pt-2 mb-2">
                <div className="flex mb-1">
                    <span>المجموع الفرعي:</span>
                    <span className="tabular">{formatAmount(invoiceOrder.subtotal)}</span>
                </div>
                {(invoiceOrder.discountAmount || 0) > 0 && (
                    <div className="flex mb-1">
                        <span>الخصم:</span>
                        <span className="tabular">- {formatAmount(invoiceOrder.discountAmount || 0)}</span>
                    </div>
                )}
                <div className="flex mb-1">
                    <span>الضريبة (15%):</span>
                    <span className="tabular">{formatAmount(invoiceOrder.taxAmount || 0)}</span>
                </div>
                {Number(invoiceOrder.deliveryFee) > 0 && (
                    <div className="flex mb-1">
                        <span>التوصيل:</span>
                        <span className="tabular">{formatAmount(Number(invoiceOrder.deliveryFee))}</span>
                    </div>
                )}
            </div>

            <div className="total-box text-center mb-4">
                <div className="text-sm font-bold mb-1">الإجمالي النهائي</div>
                <div className="text-xl font-bold tabular" dir="ltr">{formatAmount(invoiceOrder.total)} {currencyLabel}</div>
            </div>

            <div className="mb-4 text-sm border-b pb-2">
                <div className="flex">
                    <span className="font-bold">طريقة الدفع:</span>
                    <span>{getPaymentMethodText(invoiceOrder.paymentMethod)}</span>
                </div>
                {invoiceTerms === 'credit' && (
                    <div className="flex mt-1">
                        <span>تاريخ الاستحقاق:</span>
                        <span className="tabular" dir="ltr">{invoiceDueDate ? new Date(invoiceDueDate).toLocaleDateString('en-GB') : '-'}</span>
                    </div>
                )}
            </div>

            <div className="text-center mb-4">
                <div style={{ display: 'inline-block', padding: '5px', background: 'white' }}>
                    {qrCodeDataUrl ? (
                        <img src={qrCodeDataUrl} alt="QR" style={{ width: thermalPaperWidth === '80mm' ? 120 : 100, height: thermalPaperWidth === '80mm' ? 120 : 100 }} />
                    ) : (
                        <QRImage value={qrData} size={thermalPaperWidth === '80mm' ? 120 : 100} />
                    )}
                </div>
                <div className="text-xs mt-1">امسح للتحقق (ZATCA)</div>
            </div>

            <div className="text-center text-xs mt-2">
                <div className="font-bold">شكراً لزيارتكم!</div>
                <div className="mt-1 tabular" dir="ltr">{new Date().toLocaleString('en-GB')}</div>
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
