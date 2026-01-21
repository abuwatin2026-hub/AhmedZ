import React from 'react';
import { useOrders } from '../contexts/OrderContext';
import { useToast } from '../contexts/ToastContext';
import type { Order, OrderStatus, CartItem } from '../types';
// import { useSettings } from '../contexts/SettingsContext';
import { adminStatusColors } from '../utils/orderUtils';

const statusLabels: Record<OrderStatus, string> = {
    pending: 'قيد الانتظار',
    preparing: 'قيد التجهيز',
    out_for_delivery: 'جاري التوصيل',
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
            showNotification(`تم تحديث حالة الطلب #${order.id.split('-')[0].slice(-4)} إلى "${statusLabels[newStatus]}"`, 'success');
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
                    <p className="text-sm text-gray-500 dark:text-gray-400">{createdAtDate.toLocaleString('ar-SA')}</p>
                </div>
                <div className={`px-3 py-1 text-sm font-semibold rounded-full ${adminStatusColors[order.status]}`}>
                    {statusLabels[order.status]}
                </div>
            </div>
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h4 className="font-semibold dark:text-gray-200 mb-2">تفاصيل الطلب:</h4>
                <ul className="space-y-1 text-sm">
                    {order.items.map((item: CartItem, idx: number) => (
                        <li key={item.cartItemId || `${item.id}:${idx}`} className="flex justify-between">
                            <span className="text-gray-700 dark:text-gray-300">{item.name.ar} x{item.quantity}</span>
                            <span className="text-gray-600 dark:text-gray-400 font-mono">{(item.price * item.quantity).toFixed(2)} ر.ي</span>
                        </li>
                    ))}
                </ul>
                <div className="flex justify-between font-bold mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                    <span className="dark:text-white">الإجمالي:</span>
                    <span className="text-orange-500">{order.total.toFixed(2)} ر.ي</span>
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
                        <option key={status} value={status}>{statusLabels[status as OrderStatus] || status}</option>
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
            <h1 className="text-3xl font-bold mb-6 dark:text-white">لوحة التحكم</h1>
            
            {orders.length === 0 ? (
                <p className="text-center text-gray-500 dark:text-gray-400 py-8">لا توجد طلبات حالية.</p>
            ) : (
                <div className="space-y-6">
                    {orders.map(order => (
                        <OrderCard key={order.id} order={order} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default AdminDashboardScreen;
