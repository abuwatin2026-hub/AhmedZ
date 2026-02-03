import React from 'react';
import { useOrders } from '../../contexts/OrderContext';
import { useToast } from '../../contexts/ToastContext';
import type { Order, OrderStatus, CartItem } from '../../types';
// import { useSettings } from '../../contexts/SettingsContext';
import { adminStatusColors } from '../../utils/orderUtils';

const statusTranslations: Record<OrderStatus, string> = {
    pending: 'قيد الانتظار',
    preparing: 'جاري التحضير',
    out_for_delivery: 'خرج للتوصيل',
    delivered: 'تم التوصيل',
    scheduled: 'مجدول',
    cancelled: 'ملغي',
};

const OrderCard: React.FC<{ order: Order }> = ({ order }) => {
    const { updateOrderStatus } = useOrders();
    const { showNotification } = useToast();

    const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newStatus = e.target.value as OrderStatus;
        try {
            await updateOrderStatus(order.id, newStatus);
            showNotification(`تم تحديث حالة الطلب #${order.id.split('-')[0].slice(-4)} إلى "${statusTranslations[newStatus]}"`, 'success');
        } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            const message = raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل تحديث حالة الطلب.';
            showNotification(message, 'error');
        }
    };

    // Ensure createdAt is a Date-compatible object
    const createdAtDate = new Date(order.createdAt as any);


    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 space-y-4">
            <div className="flex justify-between items-start">
                <div>
                    <p className="font-bold text-lg text-gray-800 dark:text-white">طلب #{order.id.split('-')[0].slice(-4)}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400" dir="ltr">{createdAtDate.toLocaleString('ar-EG-u-nu-latn')}</p>
                </div>
                <div className={`px-3 py-1 text-sm font-semibold rounded-full ${adminStatusColors[order.status]}`}>
                    {statusTranslations[order.status]}
                </div>
            </div>
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h4 className="font-semibold dark:text-gray-200 mb-2">تفاصيل الطلب:</h4>
                <ul className="space-y-1 text-sm">
                    {(order.items || []).map((item: CartItem, idx: number) => (
                        <li key={item.cartItemId || `${order.id}:${String(item.id)}:${idx}`} className="flex justify-between">
                            <span className="text-gray-700 dark:text-gray-300">
                                {String((item as any)?.name?.ar || (item as any)?.name?.en || (item as any)?.name || (item as any)?.itemName || (item as any)?.id || (item as any)?.itemId || 'منتج')}{' '}
                                x{Number((item as any)?.quantity || 0)}
                            </span>
                            <span className="text-gray-600 dark:text-gray-400 font-mono" dir="ltr">{Number(item.price * item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {String((order as any).currency || '').toUpperCase() || '—'}</span>
                        </li>
                    ))}
                </ul>
                <div className="flex justify-between font-bold mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                    <span className="dark:text-white">الإجمالي:</span>
                    <span className="text-orange-500" dir="ltr">{Number(order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {String((order as any).currency || '').toUpperCase() || '—'}</span>
                </div>
            </div>
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h4 className="font-semibold dark:text-gray-200 mb-1">العنوان:</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">{order.address}</p>
            </div>
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <label htmlFor={`status-${order.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">تغيير حالة الطلب:</label>
                <select
                    id={`status-${order.id}`}
                    value={order.status}
                    onChange={handleStatusChange}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition"
                >
                    {Object.keys(adminStatusColors).map(status => (
                        <option key={status} value={status}>{statusTranslations[status as OrderStatus]}</option>
                    ))}
                </select>
            </div>
        </div>
    );
};


const AdminDashboardScreen: React.FC = () => {
    const { orders } = useOrders();

    return (
        <div className="animate-fade-in">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold dark:text-white">{'لوحة التحكم'}</h1>
            </div>

            {orders.length === 0 ? (
                <p className="text-center text-gray-500 dark:text-gray-400 py-8">لا توجد طلبات حالية.</p>
            ) : (
                <div className="space-y-6">
                    {(orders || []).map(order => (
                        <OrderCard key={order.id} order={order} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default AdminDashboardScreen;
