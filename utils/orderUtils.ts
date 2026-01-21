import { CartItem, Order, OrderStatus } from '../types';

export const statusColors: Record<OrderStatus, string> = {
    pending: 'border-yellow-500 text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/50',
    preparing: 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/50',
    out_for_delivery: 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/50',
    delivered: 'border-green-500 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/50',
    scheduled: 'border-purple-500 text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/50',
    cancelled: 'border-red-500 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/50',
};

export const adminStatusColors: Record<OrderStatus, string> = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
    preparing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    out_for_delivery: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300',
    delivered: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    scheduled: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

export const generateInvoiceNumber = (orderId: string, issuedAtIso: string) => {
    const date = new Date(issuedAtIso);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const short = orderId.replace(/-/g, '').slice(-6).toUpperCase();
    return `INV-${y}${m}${d}-${short}`;
};

export const computeCartItemPricing = (item: CartItem) => {
    const addonsArray = Object.values(item.selectedAddons || {});
    const addonsPrice = addonsArray.reduce((sum, { addon, quantity }) => sum + addon.price * quantity, 0);

    let itemPrice = item.price;
    let itemQuantity = item.quantity;
    const unitType = item.unitType || item.unit || 'piece';
    const isWeightBased = unitType === 'kg' || unitType === 'gram';

    if (isWeightBased) {
        itemQuantity = typeof item.weight === 'number' ? item.weight : item.quantity;
        if (unitType === 'gram' && item.pricePerUnit) {
            itemPrice = item.pricePerUnit / 1000;
        }
    }

    const unitPrice = itemPrice + addonsPrice;
    const lineTotal = unitPrice * itemQuantity;

    return {
        unitType,
        isWeightBased,
        quantity: itemQuantity,
        unitPrice,
        lineTotal,
        addonsArray,
    };
};

export const getInvoiceOrderView = (order: Order): Order => {
    const invoiceSnapshot = order.invoiceSnapshot;
    if (!invoiceSnapshot) return order;

    return {
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
    };
};
