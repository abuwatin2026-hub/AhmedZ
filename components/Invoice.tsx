import { forwardRef, useEffect, useMemo, useState } from 'react';
import { Order, AppSettings, CartItem } from '../types';
import { useDeliveryZones } from '../contexts/DeliveryZoneContext';
import { computeCartItemPricing } from '../utils/orderUtils';
import CurrencyDualAmount from './common/CurrencyDualAmount';
import QRCode from 'qrcode';
import { generateZatcaTLV } from './admin/PrintableInvoice';
import { AZTA_IDENTITY } from '../config/identity';

interface InvoiceProps {
  order: Order;
  settings: AppSettings;
  branding?: {
    name?: string;
    address?: string;
    contactNumber?: string;
    logoUrl?: string;
  };
}

const Invoice = forwardRef<HTMLDivElement, InvoiceProps>(({ order, settings, branding }, ref) => {
    const lang = 'ar';
    const { getDeliveryZoneById } = useDeliveryZones();
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
            taxAmount: (invoiceSnapshot as any).taxAmount,
            taxRate: (invoiceSnapshot as any).taxRate,
            currency: (invoiceSnapshot as any).currency,
            fxRate: (invoiceSnapshot as any).fxRate,
            baseTotal: (invoiceSnapshot as any).baseTotal,
            paymentMethod: invoiceSnapshot.paymentMethod,
            customerName: invoiceSnapshot.customerName,
            phoneNumber: invoiceSnapshot.phoneNumber,
            address: invoiceSnapshot.address,
            invoiceIssuedAt: invoiceSnapshot.issuedAt,
            invoiceNumber: invoiceSnapshot.invoiceNumber,
            orderSource: invoiceSnapshot.orderSource,
            invoiceTerms: invoiceSnapshot.invoiceTerms ?? (order as any).invoiceTerms,
            netDays: invoiceSnapshot.netDays ?? (order as any).netDays,
            dueDate: invoiceSnapshot.dueDate ?? (order as any).dueDate,
            paymentBreakdown: (invoiceSnapshot as any).paymentBreakdown ?? (order as any).paymentBreakdown,
        }
        : order;
    const deliveryZone = invoiceOrder.deliveryZoneId ? getDeliveryZoneById(invoiceOrder.deliveryZoneId) : undefined;
    const systemName = lang === 'ar' ? AZTA_IDENTITY.tradeNameAr : AZTA_IDENTITY.tradeNameEn;
    const systemKey = AZTA_IDENTITY.merchantKey;
    const branchName = (branding?.name || '').trim();
    const showBranchName = Boolean(branchName) && branchName !== systemName;
    const storeAddress = branding?.address ?? settings.address;
    const storeContactNumber = branding?.contactNumber ?? settings.contactNumber;
    const storeLogoUrl = branding?.logoUrl ?? settings.logoUrl;
    const isCopy = (invoiceOrder.invoicePrintCount || 0) > 0;
    const invoiceDate = invoiceOrder.invoiceIssuedAt || invoiceOrder.createdAt;
    const invoiceTerms: 'cash' | 'credit' = (invoiceOrder as any).invoiceTerms === 'credit' || invoiceOrder.paymentMethod === 'ar' ? 'credit' : 'cash';
    const invoiceTermsLabel = invoiceTerms === 'credit' ? 'أجل' : 'نقد';
    const invoiceDueDate = typeof (invoiceOrder as any).dueDate === 'string' ? String((invoiceOrder as any).dueDate) : '';
    const currencyCode = String((invoiceOrder as any).currency || '').toUpperCase() || '—';
    const vatNumber = (settings.taxSettings?.taxNumber || '').trim();
    const taxAmount = Number((invoiceOrder as any).taxAmount) || 0;
    const issueIso = String(invoiceDate || new Date().toISOString());

    const qrValue = useMemo(() => {
        if (!vatNumber) return '';
        const total = (Number(invoiceOrder.total) || 0).toFixed(2);
        const vatTotal = taxAmount.toFixed(2);
        return generateZatcaTLV(systemName || systemKey || '—', vatNumber, issueIso, total, vatTotal);
    }, [issueIso, invoiceOrder.total, systemKey, systemName, taxAmount, vatNumber]);

    const [qrUrl, setQrUrl] = useState<string>('');

    useEffect(() => {
        let active = true;
        if (!qrValue) {
            setQrUrl('');
            return;
        }
        (async () => {
            try {
                const dataUrl = await QRCode.toDataURL(qrValue, { width: 160, margin: 1 });
                if (active) setQrUrl(dataUrl);
            } catch {
                if (active) setQrUrl('');
            }
        })();
        return () => {
            active = false;
        };
    }, [qrValue]);

    const getPaymentMethodName = (method: string) => {
        const methods: Record<string, string> = {
            'cash': 'نقدًا',
            'network': 'حوالات',
            'kuraimi': 'حسابات بنكية',
            'card': 'حوالات',
            'bank': 'حسابات بنكية',
            'bank_transfer': 'حسابات بنكية',
            'online': 'حوالات',
            'ar': 'آجل'
        };
        return methods[method] || method;
    };

    const getUnitTypeName = (type: string) => {
        const types: Record<string, string> = {
            'kg': 'كجم',
            'gram': 'جم',
            'piece': 'قطعة',
            'box': 'علبة'
        };
        return types[type] || type;
    };

    return (
        <div ref={ref} className="bg-white text-gray-900 w-full min-h-[297mm] p-8 md:p-12 relative print:p-0 print:m-0 print:w-full print:h-auto" id="print-area" dir="rtl" style={{ fontFamily: 'Tajawal, Cairo, sans-serif' }}>
            {/* Watermark for Copy */}
            {isCopy && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden z-0">
                    <div className="text-gray-100 font-black text-[10rem] -rotate-45 select-none opacity-60">نسخة</div>
                </div>
            )}

            {/* Header Section */}
            <div className="relative z-10 border-b-2 border-gray-800 pb-6 mb-8">
                <div className="flex items-start justify-between gap-8">
                    {/* Brand Info */}
                    <div className="flex-1">
                        <div className="flex items-start gap-5">
                            {storeLogoUrl && (
                                <img src={storeLogoUrl} alt="Logo" className="h-24 w-auto object-contain" />
                            )}
                            <div>
                                <h1 className="text-3xl font-black text-gray-900 tracking-tight">{systemName}</h1>
                                <div className="text-sm font-semibold text-gray-600 mt-1 uppercase tracking-wider" dir="ltr">{systemKey}</div>
                                <div className="mt-3 space-y-1 text-sm text-gray-600">
                                    {showBranchName && (
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-gray-800">الفرع:</span>
                                            <span>{branchName}</span>
                                        </div>
                                    )}
                                    {storeAddress && (
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-gray-800">العنوان:</span>
                                            <span>{storeAddress}</span>
                                        </div>
                                    )}
                                    {storeContactNumber && (
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-gray-800">الهاتف:</span>
                                            <span dir="ltr">{storeContactNumber}</span>
                                        </div>
                                    )}
                                    {vatNumber && (
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-gray-800">الرقم الضريبي:</span>
                                            <span dir="ltr" className="font-mono">{vatNumber}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Invoice Title & Meta */}
                    <div className="text-left rtl:text-left">
                        <h2 className="text-4xl font-black text-gray-900 uppercase">فاتورة ضريبية</h2>
                        <div className="text-gray-500 text-sm tracking-[0.2em] mt-1 uppercase">Tax Invoice</div>
                        
                        <div className="mt-6 flex flex-col gap-2 items-end">
                            <div className="inline-flex flex-col items-end border-r-4 border-gray-900 pr-4">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">رقم الفاتورة / Invoice No</span>
                                <span className="text-xl font-bold font-mono" dir="ltr">{invoiceOrder.invoiceNumber || invoiceOrder.id.slice(-8).toUpperCase()}</span>
                            </div>
                            <div className="inline-flex flex-col items-end border-r-4 border-gray-900 pr-4 mt-2">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">التاريخ / Date</span>
                                <span className="text-lg font-bold font-mono" dir="ltr">{new Date(invoiceDate).toLocaleDateString('ar-EG-u-nu-latn')}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-12 mb-8 relative z-10">
                {/* Bill To */}
                <div className="bg-gray-50 rounded-lg p-6 border border-gray-100">
                    <div className="flex items-center gap-2 mb-4 border-b border-gray-200 pb-2">
                        <span className="text-sm font-black text-gray-900 uppercase tracking-wider">العميل (Bill To)</span>
                    </div>
                    <div className="space-y-1">
                        <div className="text-lg font-bold text-gray-900">{invoiceOrder.customerName}</div>
                        {invoiceOrder.phoneNumber && (
                            <div className="text-sm text-gray-600 font-mono" dir="ltr">{invoiceOrder.phoneNumber}</div>
                        )}
                        {invoiceOrder.address && (
                            <div className="text-sm text-gray-600 mt-1">{invoiceOrder.address}</div>
                        )}
                         {vatNumber && ( // Assuming customer might have VAT, but using system VAT for now. If customer VAT exists, it should be here.
                            <div className="text-xs text-gray-500 mt-2">
                                {/* Placeholder for Customer VAT if available in future */}
                            </div>
                        )}
                    </div>
                </div>

                {/* Details */}
                <div className="bg-gray-50 rounded-lg p-6 border border-gray-100">
                    <div className="flex items-center gap-2 mb-4 border-b border-gray-200 pb-2">
                        <span className="text-sm font-black text-gray-900 uppercase tracking-wider">تفاصيل (Details)</span>
                    </div>
                    <div className="grid grid-cols-2 gap-y-4 gap-x-8 text-sm">
                        <div>
                            <span className="block text-xs text-gray-500 font-bold mb-1">طريقة الدفع</span>
                            <span className="font-semibold text-gray-900">{getPaymentMethodName(invoiceOrder.paymentMethod)}</span>
                        </div>
                        <div>
                            <span className="block text-xs text-gray-500 font-bold mb-1">شروط الدفع</span>
                            <span className="font-semibold text-gray-900">{invoiceTermsLabel}</span>
                        </div>
                        {invoiceTerms === 'credit' && invoiceDueDate && (
                            <div>
                                <span className="block text-xs text-gray-500 font-bold mb-1">تاريخ الاستحقاق</span>
                                <span className="font-semibold text-gray-900 font-mono" dir="ltr">{new Date(invoiceDueDate).toLocaleDateString('ar-EG-u-nu-latn')}</span>
                            </div>
                        )}
                        {invoiceOrder.orderSource && (
                            <div>
                                <span className="block text-xs text-gray-500 font-bold mb-1">المصدر</span>
                                <span className="font-semibold text-gray-900">{invoiceOrder.orderSource === 'in_store' ? 'داخل المتجر' : 'أونلاين'}</span>
                            </div>
                        )}
                        {invoiceOrder.deliveryZoneId && (
                             <div className="col-span-2">
                                <span className="block text-xs text-gray-500 font-bold mb-1">منطقة التوصيل</span>
                                <span className="font-semibold text-gray-900">{(deliveryZone?.name?.[lang] || deliveryZone?.name?.ar || deliveryZone?.name?.en) || invoiceOrder.deliveryZoneId}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Items Table */}
            <div className="mb-8 relative z-10">
                <table className="w-full text-right border-collapse">
                    <thead>
                        <tr className="bg-gray-900 text-white">
                            <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider rounded-tr-lg">#</th>
                            <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider w-1/2">الصنف / Item</th>
                            <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-center">الكمية / Qty</th>
                            <th className="py-4 px-6 text-xs font-bold uppercase tracking-wider text-left rounded-tl-lg pl-8">الإجمالي / Total</th>
                        </tr>
                    </thead>
                    <tbody className="text-gray-800 text-sm">
                        {invoiceOrder.items.map((item: CartItem, idx: number) => {
                            const pricing = computeCartItemPricing(item);
                            const displayQty = pricing.isWeightBased ? `${pricing.quantity} ${getUnitTypeName(pricing.unitType)}` : String(item.quantity);
                            
                            return (
                                <tr key={item.cartItemId} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                                    <td className="py-4 px-6 font-mono text-gray-500">{idx + 1}</td>
                                    <td className="py-4 px-6">
                                        <div className="font-bold text-gray-900 text-base">{item.name?.[lang] || item.name?.ar || item.name?.en || item.id}</div>
                                        <div className="flex flex-wrap gap-2 text-xs text-gray-500 mt-1">
                                            <span className="font-mono">{pricing.unitPrice.toFixed(2)} {currencyCode}</span>
                                            {pricing.addonsArray.length > 0 && (
                                                <div className="flex flex-wrap gap-1">
                                                    {pricing.addonsArray.map(({ addon, quantity }) => (
                                                        <span key={addon.id} className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                                                            + {addon.name?.[lang] || addon.name?.ar} {quantity > 1 ? `(${quantity})` : ''}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="py-4 px-6 text-center font-mono font-medium">{displayQty}</td>
                                    <td className="py-4 px-6 text-left font-mono font-bold text-gray-900 pl-8" dir="ltr">
                                        <CurrencyDualAmount amount={pricing.lineTotal} currencyCode={currencyCode} compact />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Footer Section: QR & Totals */}
            <div className="flex flex-col md:flex-row gap-12 items-start relative z-10">
                {/* Left: QR & Notes */}
                <div className="flex-1">
                    {qrUrl && (
                        <div className="flex items-center gap-6 bg-white border border-gray-200 p-4 rounded-xl shadow-sm w-fit">
                            <img src={qrUrl} alt="ZATCA QR" className="w-32 h-32 object-contain" />
                            <div className="space-y-1">
                                <div className="text-xs font-bold text-gray-900 uppercase">QR Code</div>
                                <div className="text-[10px] text-gray-500 max-w-[120px] leading-tight">
                                    امسح الرمز للتحقق من الفاتورة عبر تطبيق هيئة الزكاة والضريبة والجمارك.
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {/* Payment Breakdown if exists */}
                    {(invoiceOrder as any).paymentBreakdown?.methods && (invoiceOrder as any).paymentBreakdown.methods.length > 0 && (
                        <div className="mt-6 text-sm">
                            <div className="font-bold text-gray-900 mb-2">تفاصيل السداد:</div>
                            <div className="space-y-1 text-gray-600">
                                {(invoiceOrder as any).paymentBreakdown.methods.map((m: any, idx: number) => (
                                    <div key={idx} className="flex gap-2">
                                        <span>• {getPaymentMethodName(m.method)}:</span>
                                        <span className="font-mono" dir="ltr">{Number(m.amount).toFixed(2)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Right: Totals */}
                <div className="w-full md:w-[400px]">
                    <div className="bg-gray-50 rounded-xl p-6 border border-gray-100 space-y-3">
                        <div className="flex justify-between items-center text-gray-600">
                            <span className="font-medium text-sm">المجموع الفرعي (Subtotal)</span>
                            <span className="font-mono font-bold" dir="ltr">
                                <CurrencyDualAmount amount={Number(invoiceOrder.subtotal) || 0} currencyCode={currencyCode} compact />
                            </span>
                        </div>
                        
                        {(invoiceOrder.discountAmount || 0) > 0 && (
                            <div className="flex justify-between items-center text-emerald-600">
                                <span className="font-medium text-sm">الخصم (Discount)</span>
                                <span className="font-mono font-bold" dir="ltr">
                                    - <CurrencyDualAmount amount={Number(invoiceOrder.discountAmount) || 0} currencyCode={currencyCode} compact />
                                </span>
                            </div>
                        )}

                        <div className="flex justify-between items-center text-gray-600">
                            <span className="font-medium text-sm">الضريبة (VAT {Number((invoiceOrder as any).taxRate) || 0}%)</span>
                            <span className="font-mono font-bold" dir="ltr">
                                <CurrencyDualAmount amount={taxAmount} currencyCode={currencyCode} compact />
                            </span>
                        </div>

                        <div className="h-px bg-gray-200 my-2"></div>

                        <div className="flex justify-between items-center text-gray-900 text-lg">
                            <span className="font-black">الإجمالي (Total)</span>
                            <span className="font-black font-mono" dir="ltr">
                                <CurrencyDualAmount 
                                    amount={Number(invoiceOrder.total) || 0} 
                                    currencyCode={currencyCode} 
                                    baseAmount={(invoiceOrder as any).baseTotal}
                                    fxRate={(invoiceOrder as any).fxRate}
                                    compact 
                                />
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer Bottom */}
            <div className="mt-auto pt-12">
                <div className="grid grid-cols-3 gap-8 text-center text-sm text-gray-500 border-t border-gray-200 pt-8">
                    <div className="space-y-2">
                        <div className="font-bold text-gray-900">المستلم (Receiver)</div>
                        <div className="h-16 border border-dashed border-gray-300 rounded-lg bg-gray-50/50"></div>
                    </div>
                    <div className="space-y-1 pt-4">
                        <div className="font-bold text-gray-900">{systemName}</div>
                        <div className="text-xs">شكراً لتعاملكم معنا | Thank you for your business</div>
                    </div>
                    <div className="space-y-2">
                        <div className="font-bold text-gray-900">البائع (Seller)</div>
                        <div className="h-16 border border-dashed border-gray-300 rounded-lg bg-gray-50/50"></div>
                    </div>
                </div>
                {/* Print Meta */}
                <div className="text-center mt-8 text-[10px] text-gray-400 font-mono">
                    System Ref: {invoiceOrder.id} | Printed: {new Date().toISOString()} | Page 1 of 1
                </div>
            </div>
        </div>
    );
});

export default Invoice;
