import { forwardRef } from 'react';
import { Order, AppSettings, CartItem } from '../types';
import { useDeliveryZones } from '../contexts/DeliveryZoneContext';
import { computeCartItemPricing } from '../utils/orderUtils';

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
            paymentMethod: invoiceSnapshot.paymentMethod,
            customerName: invoiceSnapshot.customerName,
            phoneNumber: invoiceSnapshot.phoneNumber,
            address: invoiceSnapshot.address,
            invoiceIssuedAt: invoiceSnapshot.issuedAt,
            invoiceNumber: invoiceSnapshot.invoiceNumber,
            orderSource: invoiceSnapshot.orderSource,
        }
        : order;
    const deliveryZone = invoiceOrder.deliveryZoneId ? getDeliveryZoneById(invoiceOrder.deliveryZoneId) : undefined;
    const storeName = branding?.name || settings.cafeteriaName?.[lang] || settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '';
    const storeAddress = branding?.address ?? settings.address;
    const storeContactNumber = branding?.contactNumber ?? settings.contactNumber;
    const storeLogoUrl = branding?.logoUrl ?? settings.logoUrl;
    const isCopy = (invoiceOrder.invoicePrintCount || 0) > 0;
    const invoiceDate = invoiceOrder.invoiceIssuedAt || invoiceOrder.createdAt;

    const getPaymentMethodName = (method: string) => {
        const methods: Record<string, string> = {
            'cash': 'نقدًا',
            'network': 'حوالات',
            'kuraimi': 'حسابات بنكية',
            'card': 'حوالات',
            'bank': 'حسابات بنكية',
            'bank_transfer': 'حسابات بنكية',
            'online': 'حوالات'
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
        <div ref={ref} className="bg-white p-8 md:p-12 shadow-lg relative overflow-hidden" id="print-area">
            {isCopy && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="text-gray-300 font-black text-7xl md:text-8xl opacity-25 -rotate-12 select-none">نسخة</div>
                </div>
            )}
            {isCopy && (
                <div className="mb-6 flex items-center justify-between">
                    <div className="font-bold text-red-700">نسخة</div>
                    <div className="text-xs text-gray-500">
                        {invoiceOrder.invoiceLastPrintedAt
                            ? `آخر طباعة: ${new Date(invoiceOrder.invoiceLastPrintedAt).toLocaleString('ar-EG-u-nu-latn')}`
                            : ''}
                    </div>
                </div>
            )}
            <div className="grid grid-cols-2 gap-8 mb-12">
                <div>
                    {storeLogoUrl ? <img src={storeLogoUrl} alt={storeName} className="h-12 mb-4" /> : null}
                    <h1 className="text-2xl font-bold text-gray-800">{storeName}</h1>
                    <p className="text-gray-500 text-sm">{storeAddress}</p>
                    <p className="text-gray-500 text-sm">{storeContactNumber}</p>
                </div>
                <div className="text-right">
                    <h2 className="text-3xl font-bold uppercase text-gray-700">فاتورة</h2>
                    <p className="text-gray-500 mt-2">
                        رقم الفاتورة{' '}
                        <span className="font-mono">{invoiceOrder.invoiceNumber || `INV-${invoiceOrder.id.slice(-6).toUpperCase()}`}</span>
                    </p>
                    <p className="text-gray-500">التاريخ: {new Date(invoiceDate).toLocaleDateString('ar-EG-u-nu-latn')}</p>
                </div>
            </div>

            <div className="mb-10 p-4 bg-gray-50 rounded-lg">
                <h3 className="font-semibold text-gray-600">فاتورة إلى:</h3>
                <p className="text-lg font-bold text-gray-800">{invoiceOrder.customerName}</p>
                {invoiceOrder.phoneNumber ? <p className="text-gray-600">{invoiceOrder.phoneNumber}</p> : null}
                <p className="text-gray-600">{invoiceOrder.address}</p>
                {invoiceOrder.deliveryZoneId && (
                    <p className="text-gray-600">
                        منطقة التوصيل: {(deliveryZone?.name?.[lang] || deliveryZone?.name?.ar || deliveryZone?.name?.en) || invoiceOrder.deliveryZoneId.slice(-6).toUpperCase()}
                    </p>
                )}
                <p className="text-gray-600">
                    طريقة الدفع: {getPaymentMethodName(invoiceOrder.paymentMethod)}
                </p>
                {invoiceOrder.orderSource && (
                    <p className="text-gray-600">
                        مصدر الطلب: {invoiceOrder.orderSource === 'in_store' ? 'حضوري' : 'أونلاين'}
                    </p>
                )}
            </div>

            <table className="w-full text-left">
                <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-sm leading-normal">
                        <th className="py-3 px-6">الصنف</th>
                        <th className="py-3 px-6 text-center">الكمية</th>
                        <th className="py-3 px-6 text-center">سعر الوحدة</th>
                        <th className="py-3 px-6 text-right">المجموع</th>
                    </tr>
                </thead>
                <tbody className="text-gray-700 text-sm font-light">
                    {invoiceOrder.items.map((item: CartItem) => {
                        const pricing = computeCartItemPricing(item);
                        const displayQty = pricing.isWeightBased
                            ? `${pricing.quantity} ${getUnitTypeName(pricing.unitType)}`
                            : String(item.quantity);
                        
                        return (
                            <tr key={item.cartItemId} className="border-b border-gray-200 hover:bg-gray-50">
                                <td className="py-3 px-6">
                                    <p className="font-semibold">{item.name?.[lang] || item.name?.ar || item.name?.en || item.id}</p>
                                    {pricing.addonsArray.length > 0 && (
                                        <div className="text-xs text-gray-500 mt-1 pl-2">
                                            {pricing.addonsArray.map(({ addon, quantity }) => (
                                                <p key={addon.id}>
                                                    + {addon.name?.[lang] || addon.name?.ar || addon.name?.en || addon.id} {quantity > 1 ? `(x${quantity})` : ''}
                                                </p>
                                            ))}
                                        </div>
                                    )}
                                </td>
                                <td className="py-3 px-6 text-center">{displayQty}</td>
                                <td className="py-3 px-6 text-center font-mono">{pricing.unitPrice.toFixed(2)}</td>
                                <td className="py-3 px-6 text-right font-mono">{pricing.lineTotal.toFixed(2)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            <div className="flex justify-end mt-10">
                <div className="w-full md:w-1/2">
                    <div className="space-y-3">
                         <div className="flex justify-between items-center text-gray-600">
                            <span>المجموع الفرعي</span>
                            <span className="font-mono">{invoiceOrder.subtotal.toFixed(2)} ج.م</span>
                        </div>
                        <div className="flex justify-between items-center text-gray-600">
                            <span>رسوم التوصيل</span>
                            <span className="font-mono">{(Number(invoiceOrder.deliveryFee) || 0).toFixed(2)} ج.م</span>
                        </div>
                        {(invoiceOrder.discountAmount || 0) > 0 && (
                             <div className="flex justify-between items-center text-green-600">
                                <span>الخصم</span>
                                <span className="font-mono">- {(invoiceOrder.discountAmount || 0).toFixed(2)} ج.م</span>
                            </div>
                        )}
                        {audit && (audit.discountType || audit.journalEntryId || (Array.isArray(audit.promotions) && audit.promotions.length > 0)) && (
                            <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-700 space-y-1">
                                {audit.discountType && (
                                    <div className="flex justify-between gap-2">
                                        <span className="font-semibold">نوع الخصم</span>
                                        <span dir="ltr">{String(audit.discountType)}</span>
                                    </div>
                                )}
                                {Array.isArray(audit.promotions) && audit.promotions.length > 0 && (
                                    <div className="space-y-1">
                                        <div className="font-semibold">العروض</div>
                                        {audit.promotions.map((p: any, idx: number) => (
                                            <div key={`${p?.promotionId || idx}`} className="flex justify-between gap-2">
                                                <span className="truncate">{String(p?.promotionName || '—')}</span>
                                                <span className="font-mono" dir="ltr">
                                                    {String(p?.promotionId || '').slice(-8)}
                                                    {p?.approvalRequestId ? ` • APR-${String(p.approvalRequestId).slice(-8)}` : ''}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {audit.discountType === 'Manual Discount' && audit.manualDiscountApprovalRequestId && (
                                    <div className="flex justify-between gap-2">
                                        <span className="font-semibold">موافقة الخصم</span>
                                        <span className="font-mono" dir="ltr">
                                            APR-{String(audit.manualDiscountApprovalRequestId).slice(-8)}
                                            {audit.manualDiscountApprovalStatus ? ` • ${String(audit.manualDiscountApprovalStatus)}` : ''}
                                        </span>
                                    </div>
                                )}
                                {audit.journalEntryId && (
                                    <div className="flex justify-between gap-2">
                                        <span className="font-semibold">قيد اليومية</span>
                                        <span className="font-mono" dir="ltr">JE-{String(audit.journalEntryId).slice(-8)}</span>
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="border-t-2 border-gray-200"></div>
                        <div className="flex justify-between items-center text-2xl font-bold text-gray-800">
                            <span>الإجمالي الكلي</span>
                            <span className="text-orange-500">{invoiceOrder.total.toFixed(2)} ج.م</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-16 text-center text-gray-500 text-sm">
                <p>شكراً لتسوقكم من {storeName}</p>
            </div>

            <div className="mt-12 pt-6 border-t border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-gray-700">
                <div className="flex items-center justify-between md:justify-start md:gap-2">
                    <span className="font-semibold text-gray-600">التاريخ:</span>
                    <span className="font-mono" dir="ltr">{new Date(invoiceDate).toLocaleDateString('ar-EG-u-nu-latn')}</span>
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
