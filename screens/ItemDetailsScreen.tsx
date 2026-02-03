import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useMenu } from '../contexts/MenuContext';
import { useCart } from '../contexts/CartContext';
import { useReviews } from '../contexts/ReviewContext';
import { useStock } from '../contexts/StockContext';
import type { Addon } from '../types';
import { useItemMeta } from '../contexts/ItemMetaContext';
import StarRating from '../components/StarRating';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { BackArrowIcon, MinusIcon, PlusIcon } from '../components/icons';
import CurrencyDualAmount from '../components/common/CurrencyDualAmount';
import { getBaseCurrencyCode } from '../supabase';

const ItemDetailsScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getMenuItemById } = useMenu();
  const { getReviewsByItemId } = useReviews();
  const { getStockByItemId } = useStock();
  const { getUnitLabel, getFreshnessLabel, getFreshnessTone, isWeightBasedUnit } = useItemMeta();
  const [baseCode, setBaseCode] = useState('');
  const item = getMenuItemById(id || '');
  const reviews = useMemo(() => getReviewsByItemId(id || ''), [id, getReviewsByItemId]);
  const stock = getStockByItemId(id || '');

  const [quantity, setQuantity] = useState(1);
  const [weight, setWeight] = useState(1);
  const [selectedAddons, setSelectedAddons] = useState<Record<string, { addon: Addon; quantity: number }>>({});
  const { addToCart } = useCart();
  const [isAdded, setIsAdded] = useState(false);

  const isWeightBased = isWeightBasedUnit(item?.unitType);
  const availableQuantity = stock ? stock.availableQuantity - stock.reservedQuantity : item?.availableStock || 999;
  const isExpired = false;
  const isInStock = availableQuantity > 0;

  useEffect(() => {
    void getBaseCurrencyCode().then((c) => {
      if (!c) return;
      setBaseCode(c);
    });
    setQuantity(1);
    // Ensure minWeight is a valid number
    setWeight(Number(item?.minWeight) || 1);

    const safeAddons = Array.isArray(item?.addons) ? item.addons : [];
    const defaultAddons = safeAddons.filter(a => a && a.isDefault);

    const initialAddons = defaultAddons.reduce((acc, addon) => {
      if (addon && addon.id) {
        acc[addon.id] = { addon, quantity: 1 };
      }
      return acc;
    }, {} as Record<string, { addon: Addon; quantity: number }>);

    setSelectedAddons(initialAddons);
  }, [id, item]);

  const { defaultIngredients, extras } = useMemo(() => {
    const allAddons = Array.isArray(item?.addons) ? item.addons : [];
    return {
      defaultIngredients: allAddons.filter(a => a && a.isDefault),
      extras: allAddons.filter(a => a && !a.isDefault),
    };
  }, [item]);

  const totalPrice = useMemo(() => {
    if (!item) return 0;

    const addonsPrice = Object.values(selectedAddons).reduce((sum: number, { addon, quantity }) => {
      // Ensure addon exists and has price
      if (!addon) return sum;
      return sum + ((Number(addon.price) || 0) * (Number(quantity) || 0));
    }, 0);

    let itemPrice = Number(item.price || 0);
    const itemQuantity = isWeightBased ? weight : quantity;

    return (itemPrice * itemQuantity) + (addonsPrice * (isWeightBased ? 1 : quantity));
  }, [item, quantity, weight, selectedAddons, isWeightBased]);

  const handleToggleDefaultAddon = (addon: Addon) => {
    setSelectedAddons(prev => {
      const newAddons = { ...prev };
      if (newAddons[addon.id]) {
        delete newAddons[addon.id];
      } else {
        newAddons[addon.id] = { addon, quantity: 1 };
      }
      return newAddons;
    });
  };

  const handleAddonQuantityChange = (addon: Addon, change: number) => {
    setSelectedAddons(prev => {
      const newAddons = { ...prev };
      const existing = newAddons[addon.id];
      const currentQuantity = existing ? existing.quantity : 0;
      const newQuantity = currentQuantity + change;

      if (newQuantity > 0) {
        newAddons[addon.id] = { addon, quantity: newQuantity };
      } else {
        delete newAddons[addon.id];
      }
      return newAddons;
    });
  };

  const getFreshnessBadge = () => {
    if (!item?.freshnessLevel) return null;
    const tone = getFreshnessTone(item.freshnessLevel);
    const color =
      tone === 'green'
        ? 'bg-green-500'
        : tone === 'blue'
          ? 'bg-blue-500'
          : tone === 'yellow'
            ? 'bg-yellow-500'
            : tone === 'red'
              ? 'bg-red-500'
              : 'bg-gray-500';
    return (
      <div className={`inline-flex items-center gap-2 ${color} text-white text-sm font-bold px-4 py-2 rounded-full`}>
        <span>{getFreshnessLabel(item.freshnessLevel, 'ar')}</span>
      </div>
    );
  };

  const handleAddToCart = async () => {
    if (!item || !isInStock) return;
    await Haptics.impact({ style: ImpactStyle.Medium });
    addToCart({
      ...item,
      quantity: isWeightBased ? 1 : quantity,
      weight: isWeightBased ? weight : undefined,
      unit: item.unitType || 'piece',
      selectedAddons,
      cartItemId: `${item.id}-${Date.now()}` // Ensure ID exists
    });
    setIsAdded(true);
    setTimeout(() => setIsAdded(false), 2000);
  };

  if (!item) {
    return (
      <div className="text-center p-8">
        <h2 className="text-2xl font-bold dark:text-white">الصنف غير موجود</h2>
        <Link to="/" className="text-gold-500 hover:underline mt-4 inline-block">
          العودة للقائمة
        </Link>
      </div>
    );
  }

  // Safe accessors
  const displayName = item.name?.['ar'] || item.name?.['en'] || 'Unknown Item';
  const displayDesc = item.description?.['ar'] || item.description?.['en'] || '';
  const displayPrice = Number(item.price || 0);
  const ratingAvg = item.rating?.average || 0;
  const ratingCount = item.rating?.count || 0;

  const isValidDate = (d: any) => d && !isNaN(new Date(d).getTime());

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 sm:p-6 lg:p-8 animate-fade-in-up space-y-8">
        <button onClick={() => navigate(-1)} className="text-gold-500 hover:text-primary-600 dark:hover:text-gold-400 font-semibold flex items-center space-x-2 rtl:space-x-reverse">
          <BackArrowIcon />
          <span>{'العودة للمنتجات'}</span>
        </button>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="md:col-span-1">
            <div className="relative">
              <img src={item.imageUrl || undefined} alt={displayName} className="w-full h-auto max-h-[500px] object-cover rounded-lg shadow-md" />
              {!isInStock && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-lg">
                  <span className="bg-red-500 text-white font-bold px-6 py-3 rounded-lg text-xl">
                    {isExpired ? 'منتهي الصلاحية' : 'نفذت الكمية'}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="md:col-span-1 flex flex-col">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 dark:text-white">{displayName}</h2>
                {item.rating && (
                  <div className="flex items-center gap-2 mt-2">
                    <StarRating rating={ratingAvg} />
                    <span className="text-sm text-gray-500 dark:text-gray-400">({ratingAvg.toFixed(1)} / {ratingCount} تقييمات)</span>
                  </div>
                )}
              </div>
              {getFreshnessBadge()}
            </div>
            <p className="text-gray-600 dark:text-gray-400 mt-2 text-base">{displayDesc}</p>

            <div className="my-4">
              <p className="text-2xl font-bold text-gold-500">
                <CurrencyDualAmount amount={displayPrice} currencyCode={baseCode} compact />
                {item.unitType && (
                  <span className="text-base text-gray-500 dark:text-gray-400 ml-2">
                    {`/ ${getUnitLabel(item.unitType, 'ar')}`}
                  </span>
                )}
              </p>
            </div>

            {isInStock && availableQuantity <= 10 && (
              <p className="text-orange-500 text-sm font-semibold mb-4">
                {`متبقي ${availableQuantity} ${getUnitLabel(item.unitType, 'ar')} فقط`}
              </p>
            )}

            {(isValidDate((item as any).productionDate) || isValidDate(item.expiryDate)) && (
              <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm">
                {isValidDate((item as any).productionDate) && (
                  <p className="text-green-700 dark:text-green-400">
                    {`تاريخ الإنتاج: ${new Date((item as any).productionDate!).toLocaleDateString('ar-EG-u-nu-latn')}`}
                  </p>
                )}
                {isValidDate(item.expiryDate) && (
                  <p className="text-orange-700 dark:text-orange-400">
                    {`ينتهي في: ${new Date(item.expiryDate!).toLocaleDateString('ar-EG-u-nu-latn')}`}
                  </p>
                )}
              </div>
            )}

            {defaultIngredients.length > 0 && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3 border-r-4 rtl:border-r-0 rtl:border-l-4 border-gold-500 pr-3 rtl:pr-0 rtl:pl-3">{'تخصيص المكونات'}</h3>
                <div className="space-y-3">
                  {defaultIngredients.map(addon => (
                    <label key={addon.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg cursor-pointer has-[:checked]:bg-gold-50 has-[:checked]:dark:bg-gray-600 has-[:checked]:ring-2 has-[:checked]:ring-gold-500 transition">
                      <span className="font-semibold text-gray-800 dark:text-gray-200">{addon.name?.['ar'] || addon.name?.ar}</span>
                      <input type="checkbox" checked={!!selectedAddons[addon.id]} onChange={() => handleToggleDefaultAddon(addon)} className="form-checkbox h-5 w-5 text-primary-600 rounded focus:ring-gold-500" />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {extras.length > 0 && (
              <div className="my-6">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3 border-r-4 rtl:border-r-0 rtl:border-l-4 border-gold-500 pr-3 rtl:pr-0 rtl:pl-3">{'إضافات'}</h3>
                <div className="space-y-3">
                  {extras.map(addon => (
                    <div key={addon.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div>
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{addon.name?.['ar'] || addon.name?.ar}</span>
                        {addon.size && <span className="text-xs text-gray-500 dark:text-gray-400 mx-2">{addon.size['ar']}</span>}
                        <span className="block text-sm text-gold-500">
                          + <CurrencyDualAmount amount={Number(addon.price || 0)} currencyCode={baseCode} compact />
                        </span>
                      </div>
                      <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg">
                        <button onClick={() => handleAddonQuantityChange(addon, -1)} className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-r-lg rtl:rounded-l-lg rtl:rounded-r-none"><MinusIcon /></button>
                        <span className="px-3 text-base font-bold w-12 text-center">{selectedAddons[addon.id]?.quantity || 0}</span>
                        <button onClick={() => handleAddonQuantityChange(addon, 1)} className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-l-lg rtl:rounded-r-lg rtl:rounded-l-none"><PlusIcon /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center space-x-4 rtl:space-x-reverse my-6">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                {isWeightBased
                  ? `الوزن (${getUnitLabel(item.unitType, 'ar')}):`
                  : `الكمية:`
                }
              </h3>
              <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg">
                <button
                  onClick={() => isWeightBased ? setWeight(w => Math.max(item.minWeight || 0.5, w - 0.5)) : setQuantity(q => Math.max(1, q - 1))}
                  className="p-3 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-r-lg rtl:rounded-l-lg rtl:rounded-r-none"
                  disabled={!isInStock}
                >
                  <MinusIcon />
                </button>
                <span className="px-4 py-1 text-lg font-bold w-16 text-center">
                  {isWeightBased ? weight.toFixed(1) : quantity}
                </span>
                <button
                  onClick={() => isWeightBased ? setWeight(w => Math.min(availableQuantity, w + 0.5)) : setQuantity(q => Math.min(availableQuantity, q + 1))}
                  className="p-3 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-l-lg rtl:rounded-r-lg rtl:rounded-l-none"
                  disabled={!isInStock}
                >
                  <PlusIcon />
                </button>
              </div>
            </div>

            <div className="mt-auto pt-6 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <span className="text-gray-600 dark:text-gray-400">{'الإجمالي'}</span>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">
                  <CurrencyDualAmount amount={Number(totalPrice) || 0} currencyCode={baseCode} compact />
                </p>
              </div>
              <button
                onClick={handleAddToCart}
                disabled={isAdded || !isInStock}
                className={`font-bold py-3 px-8 rounded-lg shadow-lg transition-transform transform focus:outline-none focus:ring-4 ${!isInStock
                  ? 'bg-gray-400 cursor-not-allowed'
                  : isAdded
                    ? 'bg-green-500 scale-100 cursor-not-allowed'
                    : 'bg-primary-500 text-white hover:bg-primary-600 hover:scale-105 focus:ring-orange-300'
                  }`}
              >
                {!isInStock
                  ? (isExpired ? 'منتهي الصلاحية' : 'نفذت الكمية')
                  : isAdded
                    ? 'تمت الإضافة بنجاح'
                    : 'أضف للسلة'
                }
              </button>
            </div>
          </div>
        </div>

        <section className="pt-8 border-t border-gray-200 dark:border-gray-700">
          <h3 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-6">{'تقييمات العملاء'}</h3>
          {reviews.length > 0 ? (
            <div className="space-y-6">
              {reviews.map(review => (
                <div key={review.id} className="flex items-start space-x-4 rtl:space-x-reverse">
                  <img src={review.userAvatarUrl || undefined} alt={review.userName} className="w-12 h-12 rounded-full object-cover" />
                  <div className="flex-grow">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-gray-800 dark:text-white">{review.userName}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{new Date(review.createdAt).toLocaleDateString()}</p>
                      </div>
                      <StarRating rating={review.rating} />
                    </div>
                    <p className="mt-2 text-gray-600 dark:text-gray-400">{review.comment}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-500 dark:text-gray-400 py-4">{'لا توجد تقييمات بعد'}</p>
          )}
        </section>

      </div>
    </div>
  );
};

export default ItemDetailsScreen;
