import React from 'react';
import CurrencyDualAmount from '../common/CurrencyDualAmount';

interface Props {
  subtotal: number;
  discountAmount: number;
  total: number;
  currencyCode?: string;
}

const POSTotals: React.FC<Props> = ({ subtotal, discountAmount, total, currencyCode }) => {
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <span className="text-gray-700 dark:text-gray-300">المجموع الفرعي</span>
        <CurrencyDualAmount amount={subtotal} currencyCode={currencyCode} compact />
      </div>
      {discountAmount > 0 && (
        <div className="flex justify-between text-green-600 dark:text-green-400">
          <span>الخصم</span>
          <CurrencyDualAmount amount={-Math.abs(discountAmount)} currencyCode={currencyCode} compact />
        </div>
      )}
      <div className="border-t dark:border-gray-700 my-2" />
      <div className="flex justify-between font-bold text-lg">
        <span className="dark:text-white">الإجمالي</span>
        <CurrencyDualAmount amount={total} currencyCode={currencyCode} compact />
      </div>
    </div>
  );
};

export default POSTotals;
