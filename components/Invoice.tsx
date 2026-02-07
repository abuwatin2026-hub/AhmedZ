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
  audit?: any;
  branding?: {
    name?: string;
    address?: string;
    contactNumber?: string;
    logoUrl?: string;
  };
}

const Invoice = forwardRef<HTMLDivElement, InvoiceProps>(({ order, settings, audit, branding }, ref) => {
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
                const dataUrl = await QRCode.toDataURL(qrValue, { width: 140, margin: 1 });
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
        <div ref={ref} className="bg-white p-6 md:p-10 shadow-lg print:shadow-none relative overflow-hidden" id="print-area" dir="rtl">
            {isCopy ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="text-gray-300 font-black text-7xl md:text-8xl opacity-25 -rotate-12 select-none">نسخة</div>
                </div>
            ) : null}

            {isCopy ? (
                <div className="mb-4 flex items-center justify-between gap-4">
                    <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-sm font-bold text-red-700">
                        نسخة
                    </div>
                    <div className="text-xs text-gray-500">
                        {invoiceOrder.invoiceLastPrintedAt ? `آخر طباعة: ${new Date(invoiceOrder.invoiceLastPrintedAt).toLocaleString('ar-EG-u-nu-latn')}` : ''}
                    </div>
                </div>
            ) : null}

            <div className="rounded-2xl border border-gray-200 overflow-hidden mb-8">
                <div className="bg-teal-gradient text-white px-6 py-5 print:bg-white print:text-gray-900">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                        <div className="flex items-start gap-4">
                            {storeLogoUrl ? (
                                <div className="shrink-0 rounded-xl bg-white/15 p-2 print:bg-transparent print:p-0">
                                    <img src={storeLogoUrl} alt={systemName || systemKey} className="h-10 w-auto object-contain" />
                                </div>
                            ) : null}
                            <div className="min-w-0">
                                <div className="text-xs font-black tracking-widest text-white/85 print:text-gray-600" dir="ltr">{systemKey}</div>
                                <div className="text-2xl font-black leading-tight">{systemName}</div>
                                {showBranchName ? (
                                    <div className="mt-1 text-sm text-white/90 print:text-gray-700">
                                        <span className="font-semibold">{'المخزن:'}</span> {branchName}
                                    </div>
                                ) : null}
                                {storeAddress ? <div className="mt-1 text-sm text-white/90 print:text-gray-700">{storeAddress}</div> : null}
                                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/90 print:text-gray-700">
                                    {storeContactNumber ? <span dir="ltr">{storeContactNumber}</span> : null}
                                    {vatNumber ? <span dir="ltr">TRN: {vatNumber}</span> : null}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-xl bg-white/15 px-4 py-3 text-sm print:bg-transparent print:border print:border-gray-200 print:text-gray-900">
                            <div className="flex items-baseline justify-between gap-6">
                                <div className="text-lg font-black">فاتورة</div>
                                <div className="text-xs text-white/85 print:text-gray-600">Invoice</div>
                            </div>
                            <div className="mt-2 space-y-1 text-white/95 print:text-gray-800">
                                <div className="flex items-center justify-between gap-6">
                                    <span className="text-white/80 print:text-gray-600">رقم الفاتورة</span>
                                    <span className="font-mono tabular-nums" dir="ltr">{invoiceOrder.invoiceNumber || `INV-${invoiceOrder.id.slice(-6).toUpperCase()}`}</span>
                                </div>
                                <div className="flex items-center justify-between gap-6">
                                    <span className="text-white/80 print:text-gray-600">التاريخ</span>
                                    <span className="font-mono tabular-nums" dir="ltr">{new Date(invoiceDate).toLocaleString('ar-EG-u-nu-latn')}</span>
                                </div>
                                <div className="flex items-center justify-between gap-6">
                                    <span className="text-white/80 print:text-gray-600">طريقة الدفع</span>
                                    <span>{getPaymentMethodName(invoiceOrder.paymentMethod)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-6">
                                    <span className="text-white/80 print:text-gray-600">نوع الفاتورة</span>
                                    <span>{invoiceTermsLabel}</span>
                                </div>
                                {invoiceTerms === 'credit' && invoiceDueDate ? (
                                    <div className="flex items-center justify-between gap-6">
                                        <span className="text-white/80 print:text-gray-600">الاستحقاق</span>
                                        <span className="font-mono tabular-nums" dir="ltr">{new Date(`${invoiceDueDate}T00:00:00`).toLocaleDateString('ar-EG-u-nu-latn')}</span>
                                    </div>
                                ) : null}
                                {invoiceOrder.orderSource ? (
                                    <div className="flex items-center justify-between gap-6">
                                        <span className="text-white/80 print:text-gray-600">مصدر الطلب</span>
                                        <span>{invoiceOrder.orderSource === 'in_store' ? 'حضوري' : 'أونلاين'}</span>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="rounded-xl border border-gray-200 p-4">
                            <div className="flex items-baseline justify-between gap-4">
                                <div className="text-sm font-bold text-gray-900">فاتورة إلى</div>
                                <div className="text-xs text-gray-500">Bill To</div>
                            </div>
                            <div className="mt-2 text-lg font-black text-gray-900">{invoiceOrder.customerName}</div>
                            {invoiceOrder.phoneNumber ? <div className="mt-1 text-sm text-gray-700" dir="ltr">{invoiceOrder.phoneNumber}</div> : null}
                            {invoiceOrder.address ? <div className="mt-2 text-sm text-gray-700">{invoiceOrder.address}</div> : null}
                            {invoiceOrder.deliveryZoneId ? (
                                <div className="mt-2 text-sm text-gray-700">
                                    <span className="font-semibold text-gray-600">منطقة التوصيل:</span>{' '}
                                    {(deliveryZone?.name?.[lang] || deliveryZone?.name?.ar || deliveryZone?.name?.en) || invoiceOrder.deliveryZoneId.slice(-6).toUpperCase()}
                                </div>
                            ) : null}
                        </div>

                        <div className="rounded-xl border border-gray-200 p-4">
                            <div className="flex items-baseline justify-between gap-4">
                                <div className="text-sm font-bold text-gray-900">ملخص</div>
                                <div className="text-xs text-gray-500">Summary</div>
                            </div>
                            <div className="mt-3 space-y-2 text-sm text-gray-800">
                                <div className="flex items-center justify-between gap-6">
                                    <span className="text-gray-600">رقم الطلب</span>
                                    <span className="font-mono tabular-nums" dir="ltr">ORD-{invoiceOrder.id.slice(-8).toUpperCase()}</span>
                                </div>
                                {vatNumber ? (
                                    <div className="flex items-center justify-between gap-6">
                                        <span className="text-gray-600">الرقم الضريبي</span>
                                        <span className="font-mono tabular-nums" dir="ltr">{vatNumber}</span>
                                    </div>
                                ) : null}
                                {typeof (invoiceOrder as any).netDays === 'number' && invoiceTerms === 'credit' ? (
                                    <div className="flex items-center justify-between gap-6">
                                        <span className="text-gray-600">أيام الائتمان</span>
                                        <span className="font-mono tabular-nums" dir="ltr">{String((invoiceOrder as any).netDays)}</span>
                                    </div>
                                ) : null}
                                {(invoiceOrder as any).invoiceLastPrintedBy ? (
                                    <div className="flex items-center justify-between gap-6">
                                        <span className="text-gray-600">آخر طباعة بواسطة</span>
                                        <span className="font-mono tabular-nums" dir="ltr">{String((invoiceOrder as any).invoiceLastPrintedBy)}</span>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 rounded-xl border border-gray-200 overflow-hidden">
                        <div className="bg-gray-50 px-4 py-3 flex items-baseline justify-between gap-4">
                            <div className="text-sm font-bold text-gray-900">تفاصيل الأصناف</div>
                            <div className="text-xs text-gray-500">Items</div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-right">
                                <thead className="bg-white">
                                    <tr className="text-xs font-bold text-gray-600">
                                        <th className="py-3 px-4 whitespace-nowrap">#</th>
                                        <th className="py-3 px-4">الصنف</th>
                                        <th className="py-3 px-4 whitespace-nowrap text-center">الكمية</th>
                                        <th className="py-3 px-4 whitespace-nowrap text-left" dir="ltr">سعر الوحدة</th>
                                        <th className="py-3 px-4 whitespace-nowrap text-left" dir="ltr">المجموع</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm text-gray-800">
                                    {invoiceOrder.items.map((item: CartItem, idx: number) => {
                                        const pricing = computeCartItemPricing(item);
                                        const displayQty = pricing.isWeightBased ? `${pricing.quantity} ${getUnitTypeName(pricing.unitType)}` : String(item.quantity);
                                        return (
                                            <tr key={item.cartItemId} className="border-t border-gray-200">
                                                <td className="py-3 px-4 font-mono tabular-nums text-gray-500" dir="ltr">{idx + 1}</td>
                                                <td className="py-3 px-4">
                                                    <div className="font-semibold">{item.name?.[lang] || item.name?.ar || item.name?.en || item.id}</div>
                                                    {pricing.addonsArray.length > 0 ? (
                                                        <div className="mt-1 space-y-0.5 text-xs text-gray-500">
                                                            {pricing.addonsArray.map(({ addon, quantity }) => (
                                                                <div key={addon.id} className="flex items-center justify-between gap-4">
                                                                    <span className="truncate">+ {addon.name?.[lang] || addon.name?.ar || addon.name?.en || addon.id}</span>
                                                                    <span className="font-mono tabular-nums" dir="ltr">{quantity > 1 ? `x${quantity}` : ''}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : null}
                                                </td>
                                                <td className="py-3 px-4 text-center font-mono tabular-nums" dir="ltr">{displayQty}</td>
                                                <td className="py-3 px-4 text-left font-mono tabular-nums" dir="ltr">
                                                    <CurrencyDualAmount amount={pricing.unitPrice} currencyCode={currencyCode} compact />
                                                </td>
                                                <td className="py-3 px-4 text-left font-mono tabular-nums" dir="ltr">
                                                    <CurrencyDualAmount amount={pricing.lineTotal} currencyCode={currencyCode} compact />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="rounded-xl border border-gray-200 p-4">
                            <div className="flex items-baseline justify-between gap-4">
                                <div className="text-sm font-bold text-gray-900">معلومات الدفع</div>
                                <div className="text-xs text-gray-500">Payments</div>
                            </div>
                            {(invoiceOrder as any).paymentBreakdown?.methods && Array.isArray((invoiceOrder as any).paymentBreakdown.methods) && (invoiceOrder as any).paymentBreakdown.methods.length > 0 ? (
                                <div className="mt-3 space-y-2 text-sm text-gray-800">
                                    {(invoiceOrder as any).paymentBreakdown.methods.map((m: any, idx: number) => (
                                        <div key={`${m?.method || 'method'}-${idx}`} className="flex items-center justify-between gap-6">
                                            <span className="text-gray-600">{getPaymentMethodName(String(m?.method || ''))}</span>
                                            <span className="font-mono tabular-nums" dir="ltr">
                                                <CurrencyDualAmount amount={Number(m?.amount) || 0} currencyCode={currencyCode} compact />
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="mt-3 text-sm text-gray-700">طريقة الدفع: {getPaymentMethodName(invoiceOrder.paymentMethod)}</div>
                            )}

                            {audit && (audit.discountType || audit.journalEntryId || (Array.isArray(audit.promotions) && audit.promotions.length > 0)) ? (
                                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 space-y-1">
                                    {audit.discountType ? (
                                        <div className="flex justify-between gap-2">
                                            <span className="font-semibold">نوع الخصم</span>
                                            <span className="font-mono tabular-nums" dir="ltr">{String(audit.discountType)}</span>
                                        </div>
                                    ) : null}
                                    {Array.isArray(audit.promotions) && audit.promotions.length > 0 ? (
                                        <div className="space-y-1">
                                            <div className="font-semibold">العروض</div>
                                            {audit.promotions.map((p: any, idx: number) => (
                                                <div key={`${p?.promotionId || idx}`} className="flex justify-between gap-2">
                                                    <span className="truncate">{String(p?.promotionName || '—')}</span>
                                                    <span className="font-mono tabular-nums" dir="ltr">
                                                        {String(p?.promotionId || '').slice(-8)}
                                                        {p?.approvalRequestId ? ` • APR-${String(p.approvalRequestId).slice(-8)}` : ''}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}
                                    {audit.discountType === 'Manual Discount' && audit.manualDiscountApprovalRequestId ? (
                                        <div className="flex justify-between gap-2">
                                            <span className="font-semibold">موافقة الخصم</span>
                                            <span className="font-mono tabular-nums" dir="ltr">
                                                APR-{String(audit.manualDiscountApprovalRequestId).slice(-8)}
                                                {audit.manualDiscountApprovalStatus ? ` • ${String(audit.manualDiscountApprovalStatus)}` : ''}
                                            </span>
                                        </div>
                                    ) : null}
                                    {audit.journalEntryId ? (
                                        <div className="flex justify-between gap-2">
                                            <span className="font-semibold">قيد اليومية</span>
                                            <span className="font-mono tabular-nums" dir="ltr">JE-{String(audit.journalEntryId).slice(-8)}</span>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>

                        <div className="rounded-xl border border-gray-200 overflow-hidden">
                            <div className="bg-gray-50 px-4 py-3 flex items-baseline justify-between gap-4">
                                <div className="text-sm font-bold text-gray-900">الإجمالي</div>
                                <div className="text-xs text-gray-500">Totals</div>
                            </div>
                            <div className="p-4 space-y-2 text-sm text-gray-800">
                                <div className="flex items-center justify-between gap-6">
                                    <span className="text-gray-600">المجموع الفرعي</span>
                                    <span className="font-mono tabular-nums" dir="ltr">
                                        <CurrencyDualAmount amount={Number(invoiceOrder.subtotal) || 0} currencyCode={currencyCode} compact />
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-6">
                                    <span className="text-gray-600">رسوم التوصيل</span>
                                    <span className="font-mono tabular-nums" dir="ltr">
                                        <CurrencyDualAmount amount={Number(invoiceOrder.deliveryFee) || 0} currencyCode={currencyCode} compact />
                                    </span>
                                </div>
                                {(invoiceOrder.discountAmount || 0) > 0 ? (
                                    <div className="flex items-center justify-between gap-6 text-emerald-700">
                                        <span className="font-semibold">الخصم</span>
                                        <span className="font-mono tabular-nums" dir="ltr">
                                            <CurrencyDualAmount amount={-Math.abs(Number(invoiceOrder.discountAmount) || 0)} currencyCode={currencyCode} compact />
                                        </span>
                                    </div>
                                ) : null}
                                {taxAmount > 0 || Boolean(vatNumber) ? (
                                    <div className="flex items-center justify-between gap-6">
                                        <span className="text-gray-600">
                                            ضريبة القيمة المضافة{typeof (invoiceOrder as any).taxRate === 'number' ? ` (${Number((invoiceOrder as any).taxRate)}%)` : ''}
                                        </span>
                                        <span className="font-mono tabular-nums" dir="ltr">
                                            <CurrencyDualAmount amount={taxAmount} currencyCode={currencyCode} compact />
                                        </span>
                                    </div>
                                ) : null}

                                <div className="pt-3 border-t border-gray-200 flex items-center justify-between gap-6">
                                    <span className="text-base font-black text-gray-900">الإجمالي الكلي</span>
                                    <span className="text-base font-black text-gray-900 font-mono tabular-nums" dir="ltr">
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

                    {qrUrl ? (
                        <div className="mt-6 flex items-center justify-between gap-6 rounded-xl border border-gray-200 p-4">
                            <div className="min-w-0">
                                <div className="text-sm font-bold text-gray-900">رمز الاستجابة السريعة للفاتورة</div>
                                <div className="mt-1 text-xs text-gray-500">ZATCA QR</div>
                            </div>
                            <img src={qrUrl} alt="QR" className="h-[140px] w-[140px] shrink-0" />
                        </div>
                    ) : null}
                </div>
            </div>

            <div className="mt-10 text-center text-gray-600 text-sm">
                <div className="font-semibold text-gray-800">شكراً لتسوقكم من {systemName}</div>
                <div className="mt-1 text-xs text-gray-500" dir="ltr">{new Date().toLocaleString('ar-EG-u-nu-latn')}</div>
            </div>

            <div className="mt-8 pt-6 border-t border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-gray-700">
                <div className="flex items-center justify-between md:justify-start md:gap-2">
                    <span className="font-semibold text-gray-600">التاريخ:</span>
                    <span className="font-mono tabular-nums" dir="ltr">{new Date(invoiceDate).toLocaleDateString('ar-EG-u-nu-latn')}</span>
                </div>
                <div className="space-y-2">
                    <div className="font-semibold text-gray-600">التوقيع</div>
                    <div className="h-10 border-b border-gray-300"></div>
                </div>
                <div className="space-y-2">
                    <div className="font-semibold text-gray-600">الختم</div>
                    <div className="h-10 border border-gray-300 rounded"></div>
                </div>
            </div>
        </div>
    );
});

export default Invoice;
