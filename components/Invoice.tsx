import { forwardRef } from 'react';
import { Order, AppSettings, CartItem } from '../types';
import { useDeliveryZones } from '../contexts/DeliveryZoneContext';
import { computeCartItemPricing } from '../utils/orderUtils';

interface InvoiceProps {
  order: Order;
  settings: AppSettings;
}

const Invoice = forwardRef<HTMLDivElement, InvoiceProps>(({ order, settings }, ref) => {
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
    const storeName = settings.cafeteriaName?.[lang] || settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '';
    const isCopy = (invoiceOrder.invoicePrintCount || 0) > 0;
    const invoiceDate = invoiceOrder.invoiceIssuedAt || invoiceOrder.createdAt;

    const getPaymentMethodName = (method: string) => {
        const methods: Record<string, string> = {
            'cash': 'كاش',
            'network': 'شبكة/بطاقة',
            'kuraimi': 'تحويل كريمي',
            'card': 'شبكة/بطاقة',
            'bank': 'تحويل كريمي',
            'bank_transfer': 'تحويل كريمي',
            'online': 'شبكة/بطاقة'
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
        <div ref={ref} className="bg-white p-8 md:p-12 shadow-lg" id="print-area">
            {isCopy && (
                <div className="mb-6 flex items-center justify-between">
                    <div className="font-bold text-red-700">نسخة</div>
                    <div className="text-xs text-gray-500">
                        {invoiceOrder.invoiceLastPrintedAt
                            ? `آخر طباعة: ${new Date(invoiceOrder.invoiceLastPrintedAt).toLocaleString('ar-EG')}`
                            : ''}
                    </div>
                </div>
            )}
            <div className="grid grid-cols-2 gap-8 mb-12">
                <div>
                    {settings.logoUrl ? <img src={settings.logoUrl} alt={storeName} className="h-12 mb-4" /> : null}
                    <h1 className="text-2xl font-bold text-gray-800">{storeName}</h1>
                    <p className="text-gray-500 text-sm">{settings.address}</p>
                    <p className="text-gray-500 text-sm">{settings.contactNumber}</p>
                </div>
                <div className="text-right">
                    <h2 className="text-3xl font-bold uppercase text-gray-700">فاتورة</h2>
                    <p className="text-gray-500 mt-2">
                        رقم الفاتورة{' '}
                        <span className="font-mono">{invoiceOrder.invoiceNumber || `INV-${invoiceOrder.id.slice(-6).toUpperCase()}`}</span>
                    </p>
                    <p className="text-gray-500">التاريخ: {new Date(invoiceDate).toLocaleDateString('ar-EG')}</p>
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
        </div>
    );
});

export default Invoice;
