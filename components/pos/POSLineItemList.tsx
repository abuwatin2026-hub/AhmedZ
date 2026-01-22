import React from 'react';
import type { CartItem } from '../../types';

interface Props {
  items: CartItem[];
  onUpdate: (cartItemId: string, next: { quantity?: number; weight?: number }) => void;
  onRemove: (cartItemId: string) => void;
  onEditAddons?: (cartItemId: string) => void;
  selectedCartItemId?: string | null;
  onSelect?: (cartItemId: string) => void;
  touchMode?: boolean;
}

const POSLineItemList: React.FC<Props> = ({ items, onUpdate, onRemove, onEditAddons, selectedCartItemId, onSelect, touchMode }) => {
  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <div className="text-center text-gray-500 dark:text-gray-300">لا توجد سطور بعد</div>
      )}
      {items.map((item, index) => {
        const isWeight = item.unitType === 'kg' || item.unitType === 'gram';
        const qty = isWeight ? item.weight || 0 : item.quantity;
        const isSelected = !!selectedCartItemId && item.cartItemId === selectedCartItemId;
        const hasAddons = Array.isArray((item as any).addons) && (item as any).addons.length > 0;
        const selectedAddonsCount = Object.values(item.selectedAddons || {}).reduce((sum, entry) => sum + (Number((entry as any)?.quantity) || 0), 0);
        const addonsPrice = Object.values(item.selectedAddons || {}).reduce((sum, entry: any) => {
          const unit = Number(entry?.addon?.price) || 0;
          const q = Number(entry?.quantity) || 0;
          return sum + (unit * q);
        }, 0);
        let unitPrice = Number(item.price) || 0;
        let effectiveQty = qty;
        if (item.unitType === 'gram' && item.pricePerUnit) {
          unitPrice = (Number(item.pricePerUnit) || 0) / 1000;
        }
        const lineTotal = (unitPrice + addonsPrice) * (Number(effectiveQty) || 0);
        const unitLabel = item.unitType === 'kg' ? 'كغ' : item.unitType === 'gram' ? 'غ' : 'قطعة';
        const rowNo = index + 1;
        return (
          <div
            key={item.cartItemId}
            onClick={() => onSelect?.(item.cartItemId)}
            className={`flex items-center justify-between border rounded-xl dark:bg-gray-800 dark:border-gray-700 cursor-pointer ${touchMode ? 'p-6' : 'p-4'} ${isSelected ? 'ring-2 ring-primary-500 border-primary-500' : ''}`}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div className="text-xs font-mono text-gray-400">{rowNo}</div>
                <div className={`font-bold dark:text-white truncate ${touchMode ? 'text-lg' : ''}`}>{item.name?.ar || item.name?.en || item.id}</div>
                <div className="text-[11px] px-2 py-1 rounded-full border dark:border-gray-700 text-gray-600 dark:text-gray-300">
                  {isWeight ? 'وزن' : 'كمية'}: {Number(qty || 0)} {unitLabel}
                </div>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300 flex flex-wrap gap-x-3 gap-y-1">
                <span>{unitPrice.toFixed(2)}</span>
                {addonsPrice > 0 && <span>+ إضافات {addonsPrice.toFixed(2)}</span>}
                <span className="font-semibold text-indigo-600 dark:text-indigo-300">= {lineTotal.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasAddons && (
                <button
                  type="button"
                  onClick={() => onEditAddons?.(item.cartItemId)}
                  className={`rounded-xl border dark:border-gray-600 text-sm font-semibold ${touchMode ? 'px-5 py-4' : 'px-4 py-3'}`}
                >
                  إضافات{selectedAddonsCount > 0 ? ` (${selectedAddonsCount})` : ''}
                </button>
              )}
              {isWeight ? (
                <input
                  type="number"
                  step="0.01"
                  value={qty}
                  onChange={e => onUpdate(item.cartItemId, { weight: Number(e.target.value) || 0 })}
                  className={`border rounded-xl dark:bg-gray-700 dark:border-gray-600 ${touchMode ? 'w-36 p-4 text-lg' : 'w-28 p-3 text-base'}`}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onUpdate(item.cartItemId, { quantity: Math.max(0, item.quantity - 1) })}
                    className={`rounded-xl border dark:border-gray-600 font-bold ${touchMode ? 'px-6 py-4 text-2xl' : 'px-4 py-3 text-lg'}`}
                  >
                    -
                  </button>
                  <div className={`text-center font-bold ${touchMode ? 'w-16 text-2xl' : 'w-12 text-lg'}`}>{qty}</div>
                  <button
                    onClick={() => onUpdate(item.cartItemId, { quantity: item.quantity + 1 })}
                    className={`rounded-xl border dark:border-gray-600 font-bold ${touchMode ? 'px-6 py-4 text-2xl' : 'px-4 py-3 text-lg'}`}
                  >
                    +
                  </button>
                </div>
              )}
              <button
                onClick={() => onRemove(item.cartItemId)}
                className={`rounded-xl bg-red-500 text-white font-semibold ${touchMode ? 'px-5 py-4' : 'px-4 py-3'}`}
              >
                إزالة
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default POSLineItemList;
