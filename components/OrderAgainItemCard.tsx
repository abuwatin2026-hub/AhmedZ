import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CartItem } from '../types';
import { useCart } from '../contexts/CartContext';
import { CheckIcon, PlusIcon } from './icons';
import CurrencyDualAmount from './common/CurrencyDualAmount';

interface OrderAgainItemCardProps {
  item: CartItem;
  baseCurrencyCode?: string;
  displayCurrencyCode?: string;
  displayFxRate?: number | null;
}

const OrderAgainItemCard: React.FC<OrderAgainItemCardProps> = ({ item, baseCurrencyCode, displayCurrencyCode, displayFxRate }) => {
  const { addToCart } = useCart();
  const [isAdded, setIsAdded] = useState(false);
  const baseCode = String(baseCurrencyCode || '').trim().toUpperCase();
  const displayCode = String(displayCurrencyCode || '').trim().toUpperCase();
  const fxRate = typeof displayFxRate === 'number' && Number.isFinite(displayFxRate) ? displayFxRate : null;
  const basePrice = Number(item.price || 0);
  const useFx = Boolean(displayCode && baseCode && displayCode !== baseCode && fxRate && fxRate > 0);
  const shownAmount = useFx ? (basePrice / (fxRate as number)) : basePrice;
  const shownCurrency = useFx ? displayCode : (baseCode || displayCode || '—');

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Re-add the item with its exact previous customizations
    addToCart({
      ...item,
      quantity: 1, // Reset quantity to 1 for a new addition
      cartItemId: `${item.id}-${Date.now()}`
    });
    setIsAdded(true);
    setTimeout(() => setIsAdded(false), 1500);
  };

  const isCustomized = Object.keys(item.selectedAddons || {}).length > 0;

  return (
    <div className="flex-shrink-0 w-40 group">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-md overflow-hidden transform group-hover:scale-105 transition-all duration-300 h-full flex flex-col relative border-2 border-gold-500/20 group-hover:border-gold-500/50 group-hover:shadow-gold">
        {/* Decorative top corner */}
        <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-gold-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"></div>

        {isCustomized && <span className="absolute top-1 left-1 rtl:left-auto rtl:right-1 z-10 text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full font-bold shadow-md">معدل</span>}

        <Link to={`/item/${item.id}`} className="block relative overflow-hidden">
          <img className="w-full h-24 object-cover group-hover:scale-110 transition-transform duration-500" src={item.imageUrl || undefined} alt={item.name?.ar || item.name?.en || ''} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
        </Link>

        <div className="p-2 flex flex-col flex-grow">
          <Link to={`/item/${item.id}`} className="block">
            <h3 className="text-sm font-bold text-gray-800 dark:text-white truncate group-hover:text-primary-600 dark:group-hover:text-gold-400 transition-colors">{item.name?.ar || item.name?.en || ''}</h3>
          </Link>
          <div className="flex justify-between items-center mt-2">
            <span className="text-md font-bold bg-red-gradient bg-clip-text text-transparent">
              <CurrencyDualAmount
                amount={shownAmount}
                currencyCode={shownCurrency}
                baseAmount={useFx ? basePrice : undefined}
                fxRate={useFx ? (fxRate as number) : undefined}
                compact
              />
            </span>
            <button
              onClick={handleQuickAdd}
              title="إضافة سريعة"
              disabled={isAdded}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-white shadow-sm transition-all duration-300 ${isAdded ? 'bg-green-500 scale-110' : 'bg-red-gradient hover:shadow-red scale-100 hover:scale-110'
                }`}
            >
              {isAdded ? <CheckIcon /> : <PlusIcon />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderAgainItemCard;
