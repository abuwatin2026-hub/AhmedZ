import React from 'react';

interface Props {
  subtotal: number;
  discountAmount: number;
  total: number;
}

const POSTotals: React.FC<Props> = ({ subtotal, discountAmount, total }) => {
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <span className="text-gray-700 dark:text-gray-300">المجموع الفرعي</span>
        <span className="font-mono">{subtotal.toFixed(2)}</span>
      </div>
      {discountAmount > 0 && (
        <div className="flex justify-between text-green-600 dark:text-green-400">
          <span>الخصم</span>
          <span className="font-mono">- {discountAmount.toFixed(2)}</span>
        </div>
      )}
      <div className="border-t dark:border-gray-700 my-2" />
      <div className="flex justify-between font-bold text-lg">
        <span className="dark:text-white">الإجمالي</span>
        <span className="text-primary-600">{total.toFixed(2)}</span>
      </div>
    </div>
  );
};

export default POSTotals;
