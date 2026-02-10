import { forwardRef, useEffect, useMemo, useState } from 'react';
import { Order, AppSettings, CartItem } from '../types';
import { useDeliveryZones } from '../contexts/DeliveryZoneContext';
import { computeCartItemPricing } from '../utils/orderUtils';
import CurrencyDualAmount from './common/CurrencyDualAmount';
import QRCode from 'qrcode';
import { generateZatcaTLV } from './admin/PrintableInvoice';
import { AZTA_IDENTITY } from '../config/identity';
import { useItemMeta } from '../contexts/ItemMetaContext';

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
    const { getUnitLabel } = useItemMeta();

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

    return (
        <div ref={ref} className="bg-white text-gray-900 w-full min-h-[297mm] p-8 md:p-12 relative print:p-0 print:m-0 print:w-full print:h-auto border-t-[5px] border-t-slate-800" id="print-area" dir="rtl" style={{ fontFamily: 'Tajawal, Cairo, sans-serif' }}>
            {/* Watermark for Copy */}
            {isCopy && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden z-0">
                    <div className="text-gray-100 font-black text-[10rem] -rotate-45 select-none opacity-60">نسخة</div>
                </div>
            )}

            {/* Header Section */}
            <div className="relative z-10 border-b-2 border-slate-200 pb-6 mb-8">
                <div className="flex items-start justify-between gap-8">
                    {/* Brand Info */}
                    <div className="flex-1">
                        <div className="flex items-start gap-5">
                            {storeLogoUrl && (
                                <img src={storeLogoUrl} alt="Logo" className="h-28 w-auto object-contain drop-shadow-sm" />
                            )}
                            <div>
                                <h1 className="text-4xl font-black text-slate-900 tracking-tight">{systemName}</h1>
                                <div className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-widest" dir="ltr">{systemKey}</div>
                                <div className="mt-4 space-y-1.5 text-sm text-slate-600">
                                    {showBranchName && (
                                        <div className="flex items-center gap-2">
                                            <span className="w-4 h-4 flex items-center justify-center bg-slate-100 rounded text-slate-500 text-[10px]">🏢</span>
                                            <span className="font-bold text-slate-800">الفرع:</span>
                                            <span>{branchName}</span>
                                        </div>
                                    )}
                                    {storeAddress && (
                                        <div className="flex items-center gap-2">
                                            <span className="w-4 h-4 flex items-center justify-center bg-slate-100 rounded text-slate-500 text-[10px]">📍</span>
                                            <span className="font-bold text-slate-800">العنوان:</span>
                                            <span>{storeAddress}</span>
                                        </div>
                                    )}
                                    {storeContactNumber && (
                                        <div className="flex items-center gap-2">
                                            <span className="w-4 h-4 flex items-center justify-center bg-slate-100 rounded text-slate-500 text-[10px]">📞</span>
                                            <span className="font-bold text-slate-800">الهاتف:</span>
                                            <span dir="ltr">{storeContactNumber}</span>
                                        </div>
                                    )}
                                    {vatNumber && (
                                        <div className="flex items-center gap-2">
                                            <span className="w-4 h-4 flex items-center justify-center bg-slate-100 rounded text-slate-500 text-[10px]">🔢</span>
                                            <span className="font-bold text-slate-800">الرقم الضريبي:</span>
                                            <span dir="ltr" className="font-mono bg-slate-50 px-1 rounded">{vatNumber}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Invoice Title & Meta */}
                    <div className="text-left rtl:text-left">
                        <h2 className="text-5xl font-black text-slate-900 uppercase tracking-tighter">فاتورة</h2>
                        <div className="text-slate-400 text-sm font-bold tracking-[0.4em] mt-1 uppercase">Tax Invoice</div>
                        
                        <div className="mt-8 flex flex-col gap-3 items-end">
                            <div className="inline-flex flex-col items-end border-r-4 border-slate-800 pr-4">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">رقم الفاتورة / Invoice No</span>
                                <span className="text-2xl font-black font-mono text-slate-800" dir="ltr">{invoiceOrder.invoiceNumber || invoiceOrder.id.slice(-8).toUpperCase()}</span>
                            </div>
                            <div className="inline-flex flex-col items-end border-r-4 border-slate-300 pr-4 mt-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">التاريخ / Date</span>
                                <span className="text-lg font-bold font-mono text-slate-700" dir="ltr">{new Date(invoiceDate).toLocaleDateString('en-GB')}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-12 mb-10 relative z-10">
                {/* Bill To */}
                <div className="bg-slate-50 rounded-xl p-6 border border-slate-200 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-1 h-full bg-slate-800"></div>
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-200 pb-2">
                        <span className="text-sm font-black text-slate-800 uppercase tracking-wider">العميل (Bill To)</span>
                    </div>
                    <div className="space-y-1.5 relative z-10">
                        <div className="text-xl font-bold text-slate-900">{invoiceOrder.customerName}</div>
                        {invoiceOrder.phoneNumber && (
                            <div className="text-sm text-slate-600 font-mono flex items-center gap-2" dir="ltr">
                                <span className="text-slate-400">📱</span>
                                {invoiceOrder.phoneNumber}
                            </div>
                        )}
                        {invoiceOrder.address && (
                            <div className="text-sm text-slate-600 mt-1 flex items-start gap-2">
                                <span className="text-slate-400 mt-1">📍</span>
                                {invoiceOrder.address}
                            </div>
                        )}
                    </div>
                </div>

                {/* Details */}
                <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm relative">
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-2">
                        <span className="text-sm font-black text-slate-800 uppercase tracking-wider">تفاصيل (Details)</span>
                    </div>
                    <div className="grid grid-cols-2 gap-y-5 gap-x-8 text-sm">
                        <div>
                            <span className="block text-[10px] text-slate-400 font-bold uppercase mb-1">طريقة الدفع</span>
                            <span className="font-bold text-slate-800 bg-slate-100 px-2 py-1 rounded text-xs">{getPaymentMethodName(invoiceOrder.paymentMethod)}</span>
                        </div>
                        <div>
                            <span className="block text-[10px] text-slate-400 font-bold uppercase mb-1">شروط الدفع</span>
                            <span className="font-bold text-slate-800">{invoiceTermsLabel}</span>
                        </div>
                        {invoiceTerms === 'credit' && invoiceDueDate && (
                            <div>
                                <span className="block text-[10px] text-slate-400 font-bold uppercase mb-1">تاريخ الاستحقاق</span>
                                <span className="font-bold text-slate-600 font-mono bg-slate-100 px-2 py-1 rounded text-xs" dir="ltr">{new Date(invoiceDueDate).toLocaleDateString('en-GB')}</span>
                            </div>
                        )}
                        {invoiceOrder.orderSource && (
                            <div>
                                <span className="block text-[10px] text-slate-400 font-bold uppercase mb-1">المصدر</span>
                                <span className="font-bold text-slate-800">{invoiceOrder.orderSource === 'in_store' ? 'داخل المتجر' : 'أونلاين'}</span>
                            </div>
                        )}
                        {invoiceOrder.deliveryZoneId && (
                             <div className="col-span-2">
                                <span className="block text-[10px] text-slate-400 font-bold uppercase mb-1">منطقة التوصيل</span>
                                <span className="font-bold text-slate-800">{(deliveryZone?.name?.[lang] || deliveryZone?.name?.ar || deliveryZone?.name?.en) || invoiceOrder.deliveryZoneId}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Items Table */}
            <div className="mb-10 relative z-10 overflow-hidden rounded-xl border border-slate-200 shadow-sm">
                <table className="w-full text-right border-collapse">
                    <thead>
                        <tr className="bg-slate-900 text-white">
                            <th className="py-4 px-6 text-[10px] font-black uppercase tracking-widest text-slate-400 w-16 text-center">#</th>
                            <th className="py-4 px-6 text-[10px] font-black uppercase tracking-widest w-1/2">الصنف / Item</th>
                            <th className="py-4 px-6 text-[10px] font-black uppercase tracking-widest text-center">الكمية / Qty</th>
                            <th className="py-4 px-6 text-[10px] font-black uppercase tracking-widest text-left pl-8">الإجمالي / Total</th>
                        </tr>
                    </thead>
                    <tbody className="text-slate-800 text-sm bg-white">
                        {invoiceOrder.items.map((item: CartItem, idx: number) => {
                            const pricing = computeCartItemPricing(item);
                            const displayQty = pricing.isWeightBased ? `${pricing.quantity} ${getUnitLabel(pricing.unitType as any, 'ar')}` : String(item.quantity);
                            
                            return (
                                <tr key={item.cartItemId} className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors`}>
                                    <td className="py-4 px-6 font-mono text-slate-400 text-center text-xs">{idx + 1}</td>
                                    <td className="py-4 px-6">
                                        <div className="font-bold text-slate-900 text-base">{item.name?.[lang] || item.name?.ar || item.name?.en || item.id}</div>
                                        <div className="flex flex-wrap gap-2 text-xs text-slate-500 mt-1.5">
                                            <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{pricing.unitPrice.toFixed(2)} {currencyCode}</span>
                                            {pricing.addonsArray.length > 0 && (
                                                <div className="flex flex-wrap gap-1">
                                                    {pricing.addonsArray.map(({ addon, quantity }) => (
                                                        <span key={addon.id} className="bg-slate-50 px-1.5 py-0.5 rounded text-slate-700 border border-slate-200">
                                                            + {addon.name?.[lang] || addon.name?.ar} {quantity > 1 ? `(${quantity})` : ''}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="py-4 px-6 text-center">
                                        <span className="font-mono font-bold bg-slate-100 px-3 py-1 rounded-full text-slate-800">{displayQty}</span>
                                    </td>
                                    <td className="py-4 px-6 text-left font-mono font-bold text-slate-900 pl-8 text-base" dir="ltr">
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
                        <div className="flex items-start gap-5 bg-slate-50 border border-slate-200 p-5 rounded-2xl shadow-sm w-fit">
                            <div className="bg-white p-2 rounded-xl shadow-sm border border-slate-100">
                                <img src={qrUrl} alt="ZATCA QR" className="w-28 h-28 object-contain" />
                            </div>
                            <div className="space-y-2 pt-2">
                                <div className="text-xs font-black text-slate-900 uppercase tracking-wider">التحقق الضريبي</div>
                                <div className="text-[10px] text-slate-500 max-w-[140px] leading-relaxed">
                                    هذه الفاتورة متوافقة مع متطلبات هيئة الزكاة والضريبة والجمارك (ZATCA). امسح الرمز للتحقق.
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {/* Payment Breakdown if exists */}
                    {(invoiceOrder as any).paymentBreakdown?.methods && (invoiceOrder as any).paymentBreakdown.methods.length > 0 && (
                        <div className="mt-8 text-sm border-t border-slate-200 pt-6 max-w-xs">
                            <div className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                                تفاصيل السداد:
                            </div>
                            <div className="space-y-2 text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                                {(invoiceOrder as any).paymentBreakdown.methods.map((m: any, idx: number) => (
                                    <div key={idx} className="flex justify-between items-center text-xs">
                                        <span>{getPaymentMethodName(m.method)}</span>
                                        <span className="font-mono font-bold text-slate-800" dir="ltr">{Number(m.amount).toFixed(2)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Right: Totals */}
                <div className="w-full md:w-[420px]">
                    <div className="bg-slate-900 text-white rounded-2xl p-8 shadow-lg space-y-4 relative overflow-hidden">
                        
                        <div className="flex justify-between items-center text-slate-300 relative z-10">
                            <span className="font-medium text-sm">المجموع الفرعي (Subtotal)</span>
                            <span className="font-mono font-bold text-white" dir="ltr">
                                <CurrencyDualAmount amount={Number(invoiceOrder.subtotal) || 0} currencyCode={currencyCode} compact />
                            </span>
                        </div>
                        
                        {(invoiceOrder.discountAmount || 0) > 0 && (
                            <div className="flex justify-between items-center text-emerald-400 relative z-10">
                                <span className="font-medium text-sm">الخصم (Discount)</span>
                                <span className="font-mono font-bold" dir="ltr">
                                    - <CurrencyDualAmount amount={Number(invoiceOrder.discountAmount) || 0} currencyCode={currencyCode} compact />
                                </span>
                            </div>
                        )}

                        <div className="flex justify-between items-center text-slate-300 relative z-10">
                            <span className="font-medium text-sm">الضريبة (VAT {Number((invoiceOrder as any).taxRate) || 0}%)</span>
                            <span className="font-mono font-bold text-white" dir="ltr">
                                <CurrencyDualAmount amount={taxAmount} currencyCode={currencyCode} compact />
                            </span>
                        </div>

                        <div className="h-px bg-slate-700 my-2 relative z-10"></div>

                        <div className="flex justify-between items-center relative z-10">
                            <span className="font-black text-xl">الإجمالي (Total)</span>
                            <span className="font-black font-mono text-3xl tracking-tight text-white" dir="ltr">
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
            <div className="mt-auto pt-16">
                <div className="grid grid-cols-3 gap-12 text-center text-sm text-slate-500 border-t border-slate-200 pt-8">
                    <div className="space-y-3">
                        <div className="font-bold text-slate-900 text-xs uppercase tracking-wider">المستلم (Receiver)</div>
                        <div className="h-20 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50 flex items-end justify-center pb-2">
                             <span className="text-[10px] text-slate-400">التوقيع / Signature</span>
                        </div>
                    </div>
                    <div className="space-y-2 pt-6 flex flex-col items-center justify-center">
                        <div className="w-8 h-1 bg-slate-800 rounded-full mb-2"></div>
                        <div className="font-black text-slate-900 text-lg">{systemName}</div>
                        <div className="text-[10px] font-medium tracking-wide text-slate-400">شكراً لتعاملكم معنا | Thank you for your business</div>
                    </div>
                    <div className="space-y-3">
                        <div className="font-bold text-slate-900 text-xs uppercase tracking-wider">البائع (Seller)</div>
                        <div className="h-20 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50 flex items-end justify-center pb-2">
                             <span className="text-[10px] text-slate-400">الختم / Stamp</span>
                        </div>
                    </div>
                </div>
                {/* Print Meta */}
                <div className="flex justify-between items-center mt-10 pt-4 border-t border-slate-100 text-[9px] text-slate-400 font-mono">
                    <span>System Ref: {invoiceOrder.id}</span>
                    <span>Printed: {new Date().toISOString()}</span>
                    <span>Page 1 of 1</span>
                </div>
            </div>
        </div>
    );
});

export default Invoice;
