import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useOrders } from '../contexts/OrderContext';
import { Order, type OrderStatus } from '../types';
import { useCart } from '../contexts/CartContext';
import { useToast } from '../contexts/ToastContext';
import RatingModal from '../components/RatingModal';
import LoyaltyTierCard from '../components/LoyaltyTierCard';
import { statusColors } from '../utils/orderUtils';


const OrderHistoryCard: React.FC<{ 
    order: Order,
    onReorder: (order: Order) => void,
    onRate: (order: Order) => void,
}> = ({ order, onReorder, onRate }) => {
    const hasPointsToEarn = order.pointsEarned && order.pointsEarned > 0;

    const statusText: Record<string, string> = {
        pending: 'قيد الانتظار',
        confirmed: 'تم التأكيد',
        preparing: 'جاري التحضير',
        out_for_delivery: 'خرج للتوصيل',
        delivered: 'تم التوصيل',
        cancelled: 'ملغي'
    };

    const colorClasses = statusColors[order.status as OrderStatus] || 'border-gray-300 text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50';
    return (
        <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md p-5 border-l-4 dark:border-gray-700 transition-all duration-300 ${colorClasses}`}>
            <div className="flex justify-between items-center">
                <div>
                    <p className="font-bold text-lg text-gray-800 dark:text-white">
                        طلب #{order.id.split('-')[1]}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date(order.createdAt).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                </div>
                <div className={`text-sm font-semibold px-3 py-1 rounded-full ${colorClasses}`}>
                    {statusText[order.status] || order.status || 'قيد الانتظار'}
                </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex flex-wrap justify-between items-center gap-4">
                <p className="text-gray-600 dark:text-gray-300">الإجمالي: <span className="font-bold text-gold-500">{order.total.toFixed(2)} ر.ي</span></p>
                <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => onReorder(order)} className="text-sm font-semibold text-green-600 hover:text-green-800 bg-green-50 hover:bg-green-100 dark:bg-green-900/50 dark:hover:bg-green-900/80 px-3 py-1 rounded-md transition-colors">اطلب مرة أخرى</button>
                    {order.status === 'delivered' && !order.reviewPointsAwarded && (
                       <div className="flex flex-col items-start sm:items-end">
                          <button onClick={() => onRate(order)} className="text-sm font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/50 dark:hover:bg-blue-900/80 px-3 py-1 rounded-md transition-colors">قيم الطلب</button>
                          {hasPointsToEarn && <span className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">قيم الطلب لتحصل على نقاط</span>}
                       </div>
                    )}
                    {order.invoiceIssuedAt ? (
                        <Link to={`/invoice/${order.id}`} className="text-sm font-semibold text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1 rounded-md transition-colors">الفاتورة</Link>
                    ) : (
                        <span className="text-sm font-semibold text-gray-400 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-md cursor-not-allowed">الفاتورة</span>
                    )}
                     <Link to={`/order/${order.id}`} className="text-sm font-semibold text-gold-500 hover:underline">
                        تتبع الطلب &rarr;
                    </Link>
                </div>
            </div>
        </div>
    );
};


const MyOrdersScreen: React.FC = () => {
    const { userOrders, loading } = useOrders();
    const { addToCart } = useCart();
    const { showNotification } = useToast();
    const navigate = useNavigate();

    const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
    const [orderToRate, setOrderToRate] = useState<Order | null>(null);

    const handleReorder = (order: Order) => {
        order.items.forEach((item, index) => {
            addToCart({
                ...item,
                cartItemId: `${item.id}-${Date.now()}-${index}`
            });
        });
        showNotification('تمت إضافة الطلب إلى السلة بنجاح', 'success');
        navigate('/cart');
    };
    
    const handleOpenRatingModal = (order: Order) => {
        setOrderToRate(order);
        setIsRatingModalOpen(true);
    };

    const handleCloseRatingModal = () => {
        setIsRatingModalOpen(false);
        setOrderToRate(null);
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-gold-500"></div>
            </div>
        );
    }
    
    return (
        <>
            <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <div className="animate-fade-in space-y-6">
                    <div className="flex justify-between items-center">
                        <h1 className="text-3xl font-bold dark:text-white">{'طلباتي'}</h1>
                    </div>
                    
                    <LoyaltyTierCard />

                    {userOrders.length === 0 ? (
                        <div className="text-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                            <h2 className="text-2xl font-bold dark:text-white">{'لا توجد طلبات سابقة'}</h2>
                            <p className="text-gray-500 dark:text-gray-400 mt-2">{'لم تقم بأي طلبات بعد. ابدأ بطلب طعامك المفضل الآن!'}</p>
                            <Link to="/" className="mt-6 inline-block bg-primary-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-primary-600 transition-colors">
                                {'ابدأ الطلب'}
                            </Link>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {userOrders.map(order => (
                                <OrderHistoryCard 
                                    key={order.id} 
                                    order={order}
                                    onReorder={handleReorder}
                                    onRate={handleOpenRatingModal}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {orderToRate && (
                <RatingModal
                    isOpen={isRatingModalOpen}
                    onClose={handleCloseRatingModal}
                    order={orderToRate}
                />
            )}
        </>
    );
};

export default MyOrdersScreen;
