import React from 'react';
import type { CartItem } from '../../types';

interface Props {
  items: CartItem[];
  onUpdate: (cartItemId: string, next: { quantity?: number; weight?: number }) => void;
  onRemove: (cartItemId: string) => void;
}

const POSLineItemList: React.FC<Props> = ({ items, onUpdate, onRemove }) => {
  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <div className="text-center text-gray-500 dark:text-gray-300">لا توجد سطور بعد</div>
      )}
      {items.map(item => {
        const isWeight = item.unitType === 'kg' || item.unitType === 'gram';
        const qty = isWeight ? item.weight || 0 : item.quantity;
        return (
          <div key={item.cartItemId} className="flex items-center justify-between p-3 border rounded-lg dark:bg-gray-800 dark:border-gray-700">
            <div className="flex-1">
              <div className="font-bold dark:text-white">{item.name?.ar || item.name?.en || item.id}</div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {(item.price || 0).toFixed(2)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isWeight ? (
                <input
                  type="number"
                  step="0.01"
                  value={qty}
                  onChange={e => onUpdate(item.cartItemId, { weight: Number(e.target.value) || 0 })}
                  className="w-24 p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                />
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onUpdate(item.cartItemId, { quantity: Math.max(0, item.quantity - 1) })}
                    className="px-3 py-2 rounded-lg border dark:border-gray-600"
                  >
                    -
                  </button>
                  <div className="w-10 text-center font-bold">{qty}</div>
                  <button
                    onClick={() => onUpdate(item.cartItemId, { quantity: item.quantity + 1 })}
                    className="px-3 py-2 rounded-lg border dark:border-gray-600"
                  >
                    +
                  </button>
                </div>
              )}
              <button
                onClick={() => onRemove(item.cartItemId)}
                className="px-3 py-2 rounded-lg bg-red-500 text-white"
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
