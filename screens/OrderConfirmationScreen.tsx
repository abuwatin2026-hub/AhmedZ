import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useOrders } from '../contexts/OrderContext';
import { useToast } from '../contexts/ToastContext';
import type { OrderStatus, CartItem } from '../types';
import { useDeliveryZones } from '../contexts/DeliveryZoneContext';
import { CheckCircleIcon, CheckIcon, ClockIcon, FireIcon, HomeIcon, InvoiceIcon, TruckIcon, CloseIcon } from '../components/icons';

const statusInfo: Record<OrderStatus, React.ReactNode> = {
    pending: <ClockIcon />,
    preparing: <FireIcon />,
    out_for_delivery: <TruckIcon />,
    delivered: <HomeIcon />,
    scheduled: <ClockIcon />,
    cancelled: <CloseIcon />,
};

const statusText: Record<OrderStatus, string> = {
    pending: 'قيد الانتظار',
    preparing: 'جاري التحضير',
    out_for_delivery: 'جاري التوصيل',
    delivered: 'تم التوصيل',
    scheduled: 'مجدولة',
    cancelled: 'ملغاة',
};

const statusDesc: Record<OrderStatus, string> = {
    pending: 'ننتظر تأكيد المتجر لطلبك.',
    preparing: 'يقوم المتجر بتجهيز طلبك الآن.',
    out_for_delivery: 'طلبك مع المندوب وفي الطريق إليك.',
    delivered: 'وصل طلبك بالسلامة. بالعافية!',
    scheduled: 'تم جدولة طلبك وسيتم تجهيزه في الوقت المحدد.',
    cancelled: 'تم إلغاء الطلب.',
};

const OrderTracker: React.FC<{ currentStatus: OrderStatus }> = ({ currentStatus }) => {
    if (currentStatus === 'cancelled') {
        return (
            <div className="mt-8 max-w-md mx-auto">
                <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-start">
                    <div className="flex items-center gap-2 text-red-700 dark:text-red-300 font-bold">
                        <CloseIcon />
                        <span>{statusText['cancelled']}</span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
                        {statusDesc['cancelled']}
                    </p>
                </div>
            </div>
        );
    }

    const statuses: OrderStatus[] = ['pending', 'preparing', 'out_for_delivery', 'delivered'];
    const currentStatusIndex = statuses.indexOf(currentStatus);

    const progressPercentage = currentStatusIndex > 0 ? (currentStatusIndex / (statuses.length - 1)) * 100 : 0;

    return (
        <div className="mt-8 text-start max-w-md mx-auto">
            <ol className="relative border-s-2 border-gray-200 dark:border-gray-600">
                {/* Animated Progress Bar */}
                <div 
                    className="absolute top-0 -start-px w-0.5 bg-green-500 transition-all duration-700 ease-out rounded-full"
                    style={{ height: `${progressPercentage}%` }}
                ></div>

                {statuses.map((status, index) => {
                    const isCompleted = index < currentStatusIndex;
                    const isActive = index === currentStatusIndex;

                    return (
                        <li key={status} className="mb-10 ms-8">
                            <span className={`absolute flex items-center justify-center w-8 h-8 rounded-full -start-[17px] ring-8 ring-white dark:ring-gray-800 transition-all duration-500
                                ${isCompleted ? 'bg-green-500' : isActive ? 'bg-primary-500 animate-pulse scale-110' : 'bg-gray-300 dark:bg-gray-500'}`}>
                                {isCompleted ? <CheckIcon /> : statusInfo[status]}
                            </span>
                            <div className="flex flex-col">
                                <h3 className={`font-semibold text-lg transition-colors duration-500 
                                    ${isActive ? 'text-gold-500 font-bold' : 'text-gray-900 dark:text-white'}`}>
                                    {statusText[status]}
                                </h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                    {statusDesc[status]}
                                </p>
                            </div>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
};


const OrderConfirmationScreen: React.FC = () => {
    const { orderId } = useParams<{ orderId: string }>();
    const { getOrderById } = useOrders();
    const { showNotification } = useToast();
    const { getDeliveryZoneById } = useDeliveryZones();
    const order = getOrderById(orderId || '');
    const prevStatusRef = useRef<OrderStatus | undefined>(undefined);
    const [timeLeft, setTimeLeft] = useState(1200); // 20 minutes in seconds

    useEffect(() => {
        if (order) {
            if (prevStatusRef.current && prevStatusRef.current !== order.status) {
                const message = `تم تحديث حالة الطلب: "${statusText[order.status]}"`;
                showNotification(message, 'info');
            }
            prevStatusRef.current = order.status;
        }
    }, [order, showNotification]);

    useEffect(() => {
        let timer: number | undefined;
        if (order?.status === 'out_for_delivery') {
            timer = window.setInterval(() => {
                setTimeLeft(prev => (prev > 0 ? prev - 1 : 0));
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [order?.status]);

    if (!order) {
        return (
            <div className="text-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                <h2 className="text-2xl font-bold dark:text-white">الطلب غير موجود</h2>
                <p className="text-gray-500 dark:text-gray-400 mt-2">عذراً، لم نتمكن من العثور على الطلب المطلوب.</p>
                <Link to="/" className="mt-6 inline-block bg-primary-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-primary-600 transition-colors">
                    العودة للرئيسية
                </Link>
            </div>
        );
    }
    
    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 sm:p-8 animate-fade-in text-center">
                <CheckCircleIcon />
                <h1 className="text-3xl font-bold mt-4 dark:text-white">شكراً لك، تم تأكيد طلبك!</h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    رقم الطلب: <span className="font-mono font-semibold text-gold-500">#{order.id.slice(-6).toUpperCase()}</span>
                </p>
                {order.deliveryPin && order.status !== 'cancelled' && (
                    <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/30 rounded-lg text-start">
                        <div className="text-sm font-bold text-yellow-800 dark:text-yellow-300">رمز التسليم</div>
                        <div className="mt-1 font-mono text-2xl font-bold text-yellow-700 dark:text-yellow-200">{order.deliveryPin}</div>
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            اعطه للمندوب عند استلام الطلب فقط.
                        </div>
                    </div>
                )}
                {order.deliveryZoneId && (
                    <p className="text-gray-500 dark:text-gray-400 mt-2">
                        منطقة التوصيل: <span className="font-semibold">{getDeliveryZoneById(order.deliveryZoneId)?.name.ar || order.deliveryZoneId.slice(-6).toUpperCase()}</span>
                    </p>
                )}

                {order.paymentProof && (
                    <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-start">
                        <div className="text-sm font-bold text-gray-800 dark:text-gray-200">إثبات الدفع</div>
                        <div className="mt-2 text-sm">
                            {order.paymentProofType === 'image' ? (
                                <a
                                    href={order.paymentProof}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                    عرض الصورة
                                </a>
                            ) : (
                                <span className="font-mono text-gray-700 dark:text-gray-300">{order.paymentProof}</span>
                            )}
                        </div>
                    </div>
                )}

                {order.status === 'scheduled' && order.scheduledAt && (
                     <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                        <h2 className="text-xl font-bold text-blue-800 dark:text-blue-300">مجدول لـ</h2>
                        <p className="text-lg font-semibold text-blue-700 dark:text-blue-200 mt-2">
                            {new Date(order.scheduledAt).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'full', timeStyle: 'short' })}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">تم جدولة طلبك وسيتم تجهيزه في الوقت المحدد.</p>
                    </div>
                )}

                {order.status !== 'scheduled' && (
                    <div className="mt-8 text-center border-t border-b border-gray-200 dark:border-gray-700 py-6">
                        <h2 className="text-xl font-semibold dark:text-gray-200 mb-2">متابعة الطلب</h2>
                        
                        {order.status === 'out_for_delivery' && (
                            <div className="my-4 p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg animate-pulse">
                                <p className="font-bold text-indigo-700 dark:text-indigo-300">الوقت المقدر للوصول</p>
                                <p className="text-2xl font-mono font-bold text-indigo-500">{Math.floor(timeLeft / 60)}:{('0' + (timeLeft % 60)).slice(-2)} دقيقة</p>
                            </div>
                        )}
                        
                        <OrderTracker currentStatus={order.status} />
                    </div>
                )}

                <div className="mt-8 text-start">
                    <h3 className="text-lg font-semibold mb-4 dark:text-gray-200 border-r-4 rtl:border-r-0 rtl:border-l-4 border-gold-500 pr-3 rtl:pr-0 rtl:pl-3">ملخص الطلب</h3>
                    <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg space-y-2">
                        {order.items.map((item: CartItem) => {
                            const addonsArray = Object.values(item.selectedAddons);
                            const itemName = item.name.ar;
                            return (
                                <div key={item.cartItemId} className="pb-2 mb-2 border-b border-gray-200 dark:border-gray-600 last:border-b-0">
                                    <div className="flex justify-between text-sm">
                                        <span className="dark:text-gray-300 font-semibold">{itemName} x{item.quantity}</span>
                                        <span className="dark:text-gray-400 font-mono">{Number(((item as any).total ?? (Number(item.price || 0) * Number(item.quantity || 0)))).toFixed(2)} {'ر.ي'}</span>
                                    </div>
                                    {addonsArray.length > 0 && (
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-y-0.5 pr-4 rtl:pr-0 rtl:pl-4">
                                            {addonsArray.map(({ addon, quantity }) => {
                                                const addonName = addon.name.ar;
                                                return (
                                                    <p key={`${item.cartItemId}-${addon.id}`}>+ {addonName} {quantity > 1 && `x${quantity}`}</p>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        <div className="border-t border-gray-200 dark:border-gray-600 my-2 pt-2"></div>
                        <div className="flex justify-between items-center font-bold text-lg">
                            <span className="dark:text-white">الإجمالي المدفوع:</span>
                            <span className="text-gold-500">{order.total.toFixed(2)} {'ر.ي'}</span>
                        </div>
                    </div>
                </div>

                 <div className="mt-8 flex flex-col sm:flex-row gap-4">
                    <Link to={`/invoice/${order.id}`} className="flex-1 inline-flex items-center justify-center bg-blue-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-blue-700 transition-transform transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-blue-300">
                        <InvoiceIcon />
                        عرض الفاتورة
                    </Link>
                    <Link to="/" className="flex-1 bg-primary-500 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-primary-600 transition-transform transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-orange-300">
                        العودة للقائمة
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default OrderConfirmationScreen;
