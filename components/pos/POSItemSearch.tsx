import React, { useMemo, useState } from 'react';
import { useMenu } from '../../contexts/MenuContext';
import type { MenuItem } from '../../types';

interface Props {
  onAddLine: (item: MenuItem, input: { quantity?: number; weight?: number }) => void;
}

const POSItemSearch: React.FC<Props> = ({ onAddLine }) => {
  const { menuItems } = useMenu();
  const [query, setQuery] = useState('');
  const [quantity, setQuantity] = useState<number>(1);
  const [weight, setWeight] = useState<number>(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return menuItems.slice(0, 10);
    return menuItems
      .filter(m => (m.name?.ar || m.name?.en || '').toLowerCase().includes(q))
      .slice(0, 10);
  }, [menuItems, query]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="ابحث عن صنف..."
          className="flex-1 p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          type="number"
          value={quantity}
          onChange={e => setQuantity(Number(e.target.value) || 0)}
          className="w-24 p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          placeholder="الكمية"
          min={0}
        />
        <input
          type="number"
          value={weight}
          onChange={e => setWeight(Number(e.target.value) || 0)}
          className="w-32 p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          placeholder="الوزن"
          min={0}
          step="0.01"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {results.map(item => {
          const isWeight = item.unitType === 'kg' || item.unitType === 'gram';
          return (
            <button
              key={item.id}
              onClick={() =>
                onAddLine(item, isWeight ? { weight } : { quantity })
              }
              className="text-left rtl:text-right p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-800 dark:border-gray-700"
            >
              <div className="font-bold dark:text-white">{item.name?.ar || item.name?.en || item.id}</div>
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {isWeight ? 'وزن' : 'كمية'} • {item.price.toFixed(2)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default POSItemSearch;
