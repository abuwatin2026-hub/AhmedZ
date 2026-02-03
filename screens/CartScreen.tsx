import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../contexts/CartContext';
import type { CartItem } from '../types';
import { useItemMeta } from '../contexts/ItemMetaContext';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { MinusIcon, PlusIcon, TagIcon, TrashIcon } from '../components/icons';
import CurrencyDualAmount from '../components/common/CurrencyDualAmount';
import { getBaseCurrencyCode } from '../supabase';

const CartItemCard: React.FC<{ item: CartItem; currencyCode: string }> = ({ item, currencyCode }) => {
    const { updateQuantity, removeFromCart } = useCart();
    const { getUnitLabel, isWeightBasedUnit } = useItemMeta();

    const selectedAddonsArray = Object.values(item.selectedAddons);
    const addonsPrice = selectedAddonsArray.reduce((sum: number, { addon, quantity }) => sum + addon.price * quantity, 0);

    // Calculate item subtotal based on weight or quantity
    const isWeightBased = isWeightBasedUnit(item.unitType);
    let itemPrice = item.price;

    const itemQuantity = isWeightBased ? (item.weight || 1) : item.quantity;
    const itemSubtotal = (itemPrice * itemQuantity) + (addonsPrice * (isWeightBased ? 1 : item.quantity));

    const unitLabel = getUnitLabel(item.unitType, 'ar');

    return (
        <div className="flex items-start bg-white dark:bg-gray-900 p-4 rounded-xl shadow-md gap-4 animate-fade-in-up border-2 border-gold-500/20 hover:border-gold-500/40 transition-all">
            <img src={item.imageUrl || undefined} alt={item.name['ar'] || item.name['en']} className="w-24 h-24 object-cover rounded-md" />
            <div className="flex-grow">
                <h3 className="font-bold text-lg dark:text-white">{item.name['ar'] || item.name['en']}</h3>

                {/* Display weight/quantity info */}
                {isWeightBased ? (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {item.weight?.toFixed(1)} {unitLabel}
                    </p>
                ) : (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {`الكمية: ${item.quantity}`}
                        {item.unitType && ` ${unitLabel}`}
                    </p>
                )}

                {selectedAddonsArray.length > 0 && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
                        {selectedAddonsArray.map(({ addon, quantity }) => (
                            <p key={addon.id} className="text-green-600 dark:text-green-400">
                                + {addon.name.ar}
                                {addon.size && ` (${addon.size.ar})`}
                                {quantity > 1 && ` x${quantity}`}
                            </p>
                        ))}
                    </div>
                )}

                {/* Only show quantity controls for non-weight-based items */}
                {!isWeightBased && (
                    <div className="flex items-center gap-3 mt-4">
                        <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg">
                            <button onClick={async () => {
                                await Haptics.impact({ style: ImpactStyle.Light });
                                updateQuantity(item.cartItemId, item.quantity - 1);
                            }} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-r-lg rtl:rounded-l-lg rtl:rounded-r-none"><MinusIcon /></button>
                            <span className="px-3 font-bold">{item.quantity}</span>
                            <button onClick={async () => {
                                await Haptics.impact({ style: ImpactStyle.Light });
                                updateQuantity(item.cartItemId, item.quantity + 1);
                            }} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-l-lg rtl:rounded-r-lg rtl:rounded-l-none"><PlusIcon /></button>
                        </div>
                    </div>
                )}
            </div>
            <div className="text-right flex flex-col items-end h-full">
                <p className="font-bold text-lg bg-red-gradient bg-clip-text text-transparent">
                  <CurrencyDualAmount amount={Number(itemSubtotal) || 0} currencyCode={currencyCode} compact />
                </p>
                {item.unitType && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        <CurrencyDualAmount amount={Number(itemPrice) || 0} currencyCode={currencyCode} compact />/{unitLabel}
                    </p>
                )}
                <div className="flex-grow"></div>
                <button onClick={async () => {
                    await Haptics.impact({ style: ImpactStyle.Medium });
                    removeFromCart(item.cartItemId);
                }} title={'إزالة من السلة'} className="text-red-500 hover:text-red-700 mt-2 p-1"><TrashIcon /></button>
            </div>
        </div>
    );
};


const CartScreen: React.FC = () => {
    const { cartItems, getCartSubtotal, getCartTotal, applyCoupon, appliedCoupon, removeCoupon, discountAmount, deliveryFee } = useCart();
    const navigate = useNavigate();
    const [promoCode, setPromoCode] = useState('');
    const [baseCode, setBaseCode] = useState('');

    useEffect(() => {
      void getBaseCurrencyCode().then((c) => {
        if (!c) return;
        setBaseCode(c);
      });
    }, []);

    const handleApplyCoupon = () => {
        if (promoCode.trim()) {
            applyCoupon(promoCode.trim().toUpperCase());
            // result is void, applyCoupon handles notifications usually.
            // If we want to show specific error messages here, applyCoupon should throw or return status.
            // Assuming CartContext handles the logic and notifications.
            setPromoCode('');
        }
    };


    if (cartItems.length === 0) {
        return (
            <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <div className="max-w-xl mx-auto text-center p-8 bg-white dark:bg-gray-900 rounded-xl shadow-xl animate-fade-in-up border-2 border-gold-500/30 relative">
                    <div className="absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-gold-500"></div>
                    <div className="absolute top-0 right-0 w-16 h-16 border-t-2 border-r-2 border-gold-500"></div>
                    <h2 className="text-2xl font-bold bg-gold-gradient bg-clip-text text-transparent">{'سلتك فارغة'}</h2>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">{'لم تقم بإضافة أي أصناف للسلة بعد.'}</p>
                    <Link to="/" className="mt-6 inline-block bg-red-gradient text-white font-bold py-3 px-8 rounded-lg shadow-red hover:shadow-red-lg transition-all transform hover:scale-105">
                        {'تصفح القائمة'}
                    </Link>
                </div>
            </div>
        );
    }

    const subtotal = getCartSubtotal();
    const total = getCartTotal();

    return (
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="animate-fade-in-up">
                <h1 className="text-3xl font-bold mb-6 dark:text-white">{'سلة المشتريات'}</h1>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-4">
                        {cartItems.map(item => (
                            <CartItemCard key={item.cartItemId} item={item} currencyCode={baseCode} />
                        ))}
                    </div>
                    <div className="lg:col-span-1">
                        <div className="lg:sticky lg:top-24 space-y-6">
                            <div className="p-6 bg-white dark:bg-gray-900 rounded-xl shadow-lg border-2 border-gold-500/30">
                                <h2 className="text-lg font-semibold mb-4 bg-gold-gradient bg-clip-text text-transparent">{'كوبون الخصم'}</h2>
                                <div className="flex gap-2">
                                    <div className="relative flex-grow">
                                        <span className="absolute inset-y-0 right-0 flex items-center pr-3 rtl:right-auto rtl:left-0 rtl:pr-0 rtl:pl-3 pointer-events-none text-gold-500">
                                            <TagIcon />
                                        </span>
                                        <input
                                            type="text"
                                            placeholder={'أدخل كود الخصم'}
                                            value={promoCode}
                                            onChange={(e) => setPromoCode(e.target.value)}
                                            className="w-full p-3 pr-10 rtl:pl-10 rtl:pr-3 border-2 border-gold-500/30 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                                            disabled={!!appliedCoupon}
                                        />
                                    </div>
                                    <button
                                        onClick={handleApplyCoupon}
                                        className="bg-red-gradient text-white font-bold py-3 px-4 rounded-lg shadow-red hover:shadow-red-lg transition-all disabled:opacity-50"
                                        disabled={!!appliedCoupon}
                                    >
                                        {'تطبيق'}
                                    </button>
                                </div>
                            </div>

                            <div className="p-6 bg-white dark:bg-gray-900 rounded-xl shadow-lg border-2 border-gold-500/30 relative">
                                <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-gold-500"></div>
                                <div className="absolute top-0 right-0 w-12 h-12 border-t-2 border-r-2 border-gold-500"></div>
                                <h2 className="text-xl font-bold mb-4 bg-gold-gradient bg-clip-text text-transparent">{'ملخص الطلب'}</h2>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center text-gray-700 dark:text-gray-300">
                                        <span>{'المجموع الفرعي'}:</span>
                                        <CurrencyDualAmount amount={Number(subtotal) || 0} currencyCode={baseCode} compact />
                                    </div>
                                    {appliedCoupon && (
                                        <div className="flex justify-between items-center text-green-600 dark:text-green-400">
                                            <span>{'خصم'} ({appliedCoupon.code}):</span>
                                            <div className="flex items-center gap-2">
                                                <CurrencyDualAmount amount={-Math.abs(Number(discountAmount) || 0)} currencyCode={baseCode} compact />
                                                <button onClick={removeCoupon} title={'إزالة الكوبون'} className="text-red-500 hover:text-red-700 text-xs">
                                                    [{'إزالة الكوبون'}]
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    <div className="flex justify-between items-center text-gray-700 dark:text-gray-300">
                                        <span>{'رسوم التوصيل'}:</span>
                                        <CurrencyDualAmount amount={Number(deliveryFee) || 0} currencyCode={baseCode} compact />
                                    </div>
                                    <div className="border-t border-gray-200 dark:border-gray-700"></div>
                                    <div className="flex justify-between items-center text-xl font-bold">
                                        <span className="dark:text-gray-200">{'الإجمالي'}:</span>
                                        <span className="text-2xl bg-red-gradient bg-clip-text text-transparent font-extrabold">
                                          <CurrencyDualAmount amount={Number(total) || 0} currencyCode={baseCode} compact />
                                        </span>
                                    </div>
                                </div>

                                <div className="mt-6 flex flex-col gap-4">
                                    <button
                                        onClick={() => navigate('/checkout')}
                                        className="w-full bg-red-gradient text-white font-bold py-3 px-6 rounded-lg shadow-red hover:shadow-red-lg transition-all transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-gold-500/50"
                                    >
                                        {'المتابعة لإتمام الطلب'}
                                    </button>
                                    <Link
                                        to="/"
                                        className="w-full text-center border-2 border-gold-500 text-primary-600 dark:text-gold-400 font-bold py-3 px-6 rounded-lg hover:bg-gold-50 dark:hover:bg-gray-800 transition-all"
                                    >
                                        {'متابعة التسوق'}
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CartScreen;
