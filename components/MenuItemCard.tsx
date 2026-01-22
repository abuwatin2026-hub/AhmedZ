import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { MenuItem, Addon } from '../types';
import { useCart } from '../contexts/CartContext';
import { useStock } from '../contexts/StockContext';
import { useItemMeta } from '../contexts/ItemMetaContext';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { CheckIcon, PlusIcon } from './icons';


interface MenuItemCardProps {
  item: MenuItem;
}

const MenuItemCard: React.FC<MenuItemCardProps> = ({ item }) => {
  const { addToCart } = useCart();
  const { getStockByItemId } = useStock();
  const { getUnitLabel, getFreshnessLabel, getFreshnessTone, isWeightBasedUnit } = useItemMeta();
  const [isAdded, setIsAdded] = useState(false);

  const stock = getStockByItemId(item.id);
  const isInStock = stock ? stock.availableQuantity - stock.reservedQuantity > 0 : true;
  const stockQuantity = stock ? stock.availableQuantity - stock.reservedQuantity : item.availableStock || 0;

  const handleQuickAdd = async (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent navigating to details page
    e.stopPropagation();

    if (!isInStock) return;

    await Haptics.impact({ style: ImpactStyle.Medium });

    const defaultAddons = item.addons?.filter(a => a.isDefault) || [];
    const selectedAddons = defaultAddons.reduce((acc, addon) => {
      acc[addon.id] = { addon, quantity: 1 };
      return acc;
    }, {} as Record<string, { addon: Addon; quantity: number }>);

    addToCart({
      ...item,
      quantity: 1,
      selectedAddons,
      cartItemId: `${item.id}-${Date.now()}`,
      unit: item.unitType || 'piece',
      weight: isWeightBasedUnit(item.unitType) ? 1 : undefined,
    });
    setIsAdded(true);
    setTimeout(() => setIsAdded(false), 1500);
  };

  // Get freshness badge
  const getFreshnessBadge = () => {
    if (!item.freshnessLevel) return null;
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
      <span className={`absolute top-2 right-2 ${color} text-white text-xs font-bold px-2 py-1 rounded-full z-10`}>
        {getFreshnessLabel(item.freshnessLevel, 'ar')}
      </span>
    );
  };

  return (
    <Link to={`/item/${item.id}`} className="block group">
      <div className={`bg-white dark:bg-gray-900 rounded-xl shadow-lg overflow-hidden transform group-hover:scale-105 transition-all duration-300 h-full flex flex-col relative border-2 ${!isInStock ? 'opacity-60 border-gray-300' : 'border-gold-500/20 group-hover:border-gold-500/50 group-hover:shadow-gold'}`}>
        {/* Decorative corners */}
        {isInStock && (
          <>
            <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-gold-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"></div>
            <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-gold-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"></div>
          </>
        )}

        <div className="relative overflow-hidden">
          <img className="w-full h-48 object-cover group-hover:scale-110 transition-transform duration-500" src={item.imageUrl || undefined} alt={item.name?.ar || item.name?.en || ''} />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

          {/* Freshness badge */}
          {getFreshnessBadge()}

          {/* Out of stock overlay */}
          {!isInStock && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <span className="bg-red-500 text-white font-bold px-4 py-2 rounded-lg">
                {'نفذت الكمية'}
              </span>
            </div>
          )}
        </div>

        <div className="p-4 flex flex-col flex-grow relative">
          {/* Top decorative line */}
          <div className="absolute top-0 left-4 right-4 h-0.5 bg-gold-gradient"></div>

          <h3 className="text-lg font-bold text-gray-800 dark:text-white mt-2 group-hover:text-primary-600 dark:group-hover:text-gold-400 transition-colors">{item.name?.ar || item.name?.en || ''}</h3>
          <p className="text-gray-600 dark:text-gray-400 text-sm mt-1 h-10 overflow-hidden flex-grow">{item.description?.ar || item.description?.en || ''}</p>

          {/* Stock indicator */}
          {isInStock && stockQuantity > 0 && stockQuantity <= 10 && (
            <p className="text-orange-500 text-xs font-semibold mt-1">
              {`متبقي ${stockQuantity} ${getUnitLabel(item.unitType, 'ar')}`}
            </p>
          )}

          <div className="flex justify-between items-center mt-4">
            <div className="flex flex-col">
              <span className="text-xl font-bold bg-red-gradient bg-clip-text text-transparent">
                {Number(item.price || 0).toFixed(2)} {'ر.ي'}
              </span>
              {item.unitType && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {`لكل ${getUnitLabel(item.unitType, 'ar')}`}
                </span>
              )}
            </div>
            <button
              onClick={handleQuickAdd}
              title={'إضافة سريعة'}
              disabled={isAdded || !isInStock}
              className={`w-10 h-10 rounded-full flex items-center justify-center text-white shadow-md transition-all duration-300 ${isAdded ? 'bg-green-500 scale-110 animate-bounce' :
                !isInStock ? 'bg-gray-400 cursor-not-allowed' :
                  'bg-red-gradient hover:shadow-red scale-100 hover:scale-110'
                }`}
            >
              {isAdded ? <CheckIcon /> : <PlusIcon />}
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
};

export default MenuItemCard;
