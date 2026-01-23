import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MenuItem } from '../../types';
import { useSettings } from '../../contexts/SettingsContext';
import { getSupabaseClient } from '../../supabase';

interface Props {
  onAddLine: (item: MenuItem, input: { quantity?: number; weight?: number }) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  touchMode?: boolean;
}

const POSItemSearch: React.FC<Props> = ({ onAddLine, inputRef, disabled, touchMode }) => {
  const { settings } = useSettings();
  const [sellableItems, setSellableItems] = useState<MenuItem[]>([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [quantity, setQuantity] = useState<number>(1);
  const [weight, setWeight] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const qtyRef = useRef<HTMLInputElement | null>(null);
  const weightRef = useRef<HTMLInputElement | null>(null);

  const normalize = (value: unknown) => String(value || '')
    .toLowerCase()
    .replace(/[\s\-_]+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let mounted = true;
    const run = async () => {
      const { data, error } = await supabase
        .from('v_sellable_products')
        .select('id, name, barcode, price, base_unit, data, available_quantity');
      if (!mounted) return;
      if (error) {
        setSellableItems([]);
        return;
      }
      const items = (data || []).map((row: any) => {
        const raw = row?.data && typeof row.data === 'object' ? row.data : {};
        const nameObj = row?.name && typeof row.name === 'object' ? row.name : (raw as any).name;
        const safeName = {
          ar: typeof nameObj?.ar === 'string' ? nameObj.ar : '',
          en: typeof nameObj?.en === 'string' ? nameObj.en : '',
        };
        const descObj: any = (raw as any).description && typeof (raw as any).description === 'object' ? (raw as any).description : {};
        const safeDescription = {
          ar: typeof descObj?.ar === 'string' ? descObj.ar : '',
          en: typeof descObj?.en === 'string' ? descObj.en : '',
        };
        const baseUnit = typeof row?.base_unit === 'string' ? row.base_unit : (raw as any).unitType;
        const price = Number.isFinite(Number(row?.price)) ? Number(row.price) : Number((raw as any).price || 0);
        const availableStock = Number.isFinite(Number(row?.available_quantity)) ? Number(row.available_quantity) : 0;
        const barcode = typeof row?.barcode === 'string' ? row.barcode : (raw as any).barcode;
        return {
          ...(raw as any),
          id: String(row?.id || (raw as any).id || ''),
          name: safeName,
          description: safeDescription,
          unitType: baseUnit,
          price,
          availableStock,
          barcode: typeof barcode === 'string' ? barcode : undefined,
          status: 'active',
        } as MenuItem;
      });
      setSellableItems(items.filter(i => i && i.id));
    };
    void run();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const h = window.setTimeout(() => setDebouncedQuery(query), 120);
    return () => {
      window.clearTimeout(h);
    };
  }, [query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [debouncedQuery]);

  const indexedItems = useMemo(() => {
    return (sellableItems || []).map((m) => {
      const ar = String(m.name?.ar || '');
      const en = String(m.name?.en || '');
      const id = String(m.id || '');
      const barcode = String((m as any)?.barcode || (m as any)?.data?.barcode || '');
      const sku = String((m as any)?.sku || (m as any)?.data?.sku || '');
      return {
        item: m,
        idRaw: id,
        id: normalize(id),
        barcode: normalize(barcode),
        sku: normalize(sku),
        ar: normalize(ar),
        en: normalize(en),
        label: ar || en || id,
      };
    });
  }, [sellableItems]);

  const results = useMemo(() => {
    const qRaw = debouncedQuery.trim();
    const q = normalize(qRaw);
    if (!q) {
      return (indexedItems || [])
        .slice(0, 16)
        .map(r => r.item);
    }

    const scored = (indexedItems || [])
      .map((row) => {
        const id = row.id;
        const barcode = row.barcode;
        const sku = row.sku;
        const ar = row.ar;
        const en = row.en;

        let score = 999;
        if (barcode && barcode === q) score = 0;
        else if (sku && sku === q) score = 1;
        else if (id === q) score = 2;
        else if (barcode && barcode.startsWith(q)) score = 3;
        else if (id.startsWith(q)) score = 4;
        else if (ar.startsWith(q)) score = 5;
        else if (en.startsWith(q)) score = 6;
        else if (barcode && barcode.includes(q)) score = 7;
        else if (id.includes(q)) score = 8;
        else if (ar.includes(q)) score = 9;
        else if (en.includes(q)) score = 10;

        return { row, score };
      })
      .filter(s => s.score < 999)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return String(a.row.label).localeCompare(String(b.row.label), 'ar');
      })
      .slice(0, 16);

    return scored.map(s => s.row.item);
  }, [indexedItems, debouncedQuery]);

  useEffect(() => {
    setSelectedIndex((idx) => {
      if (results.length === 0) return 0;
      if (idx < 0) return 0;
      if (idx >= results.length) return results.length - 1;
      return idx;
    });
  }, [results.length]);

  const addSelected = (idx: number) => {
    const item = results[idx];
    if (!item) return;
    const isWeight = item.unitType === 'kg' || item.unitType === 'gram';
    onAddLine(item, isWeight ? { weight } : { quantity });
    setQuery('');
    setDebouncedQuery('');
    setSelectedIndex(0);
    if (inputRef?.current) {
      try {
        inputRef.current.focus();
        inputRef.current.select?.();
      } catch {}
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="text"
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelectedIndex((idx) => Math.min(results.length - 1, idx + 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelectedIndex((idx) => Math.max(0, idx - 1));
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
          const enableBarcode = Boolean(settings?.posFlags?.barcodeScanEnabled);
          if (enableBarcode) {
            const q = normalize(query.trim());
            if (q) {
              const exact = indexedItems.find(row => (row.barcode && row.barcode === q) || (row.sku && row.sku === q));
              if (exact) {
                const item = exact.item;
                const isWeight = item.unitType === 'kg' || item.unitType === 'gram';
                onAddLine(item, isWeight ? { weight } : { quantity });
                setQuery('');
                setDebouncedQuery('');
                setSelectedIndex(0);
                if (inputRef?.current) {
                  try {
                    inputRef.current.focus();
                    inputRef.current.select?.();
                  } catch {}
                }
                return;
              }
            }
          }
          addSelected(selectedIndex);
              return;
            }
            if (e.key === 'Tab') {
              const item = results[selectedIndex];
              if (!item) return;
              const isWeight = item.unitType === 'kg' || item.unitType === 'gram';
              if (isWeight) {
                e.preventDefault();
                weightRef.current?.focus();
                weightRef.current?.select?.();
                return;
              }
              e.preventDefault();
              qtyRef.current?.focus();
              qtyRef.current?.select?.();
              return;
            }
          }}
          placeholder="ابحث عن صنف..."
          className={`flex-1 border rounded-xl dark:bg-gray-700 dark:border-gray-600 ${touchMode ? 'p-6 text-lg' : 'p-4 text-base'}`}
          disabled={Boolean(disabled)}
        />
        <input
          type="number"
          ref={qtyRef}
          value={quantity}
          onChange={e => setQuantity(Number(e.target.value) || 0)}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              addSelected(selectedIndex);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              inputRef?.current?.focus();
              inputRef?.current?.select?.();
            }
          }}
          className={`border rounded-xl dark:bg-gray-700 dark:border-gray-600 ${touchMode ? 'w-32 p-6 text-lg' : 'w-28 p-4 text-base'}`}
          placeholder="الكمية"
          min={0}
          disabled={Boolean(disabled)}
        />
        <input
          type="number"
          ref={weightRef}
          value={weight}
          onChange={e => setWeight(Number(e.target.value) || 0)}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              addSelected(selectedIndex);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              inputRef?.current?.focus();
              inputRef?.current?.select?.();
            }
          }}
          className={`border rounded-xl dark:bg-gray-700 dark:border-gray-600 ${touchMode ? 'w-40 p-6 text-lg' : 'w-36 p-4 text-base'}`}
          placeholder="الوزن"
          min={0}
          step="0.01"
          disabled={Boolean(disabled)}
        />
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400">
        Enter لإضافة المحدد • ↑↓ للتنقل • Tab للكمية/الوزن • Ctrl+K للتركيز على البحث
      </div>
      <div className={`grid grid-cols-1 ${touchMode ? 'sm:grid-cols-2 gap-4' : 'sm:grid-cols-2 gap-3'}`}>
        {results.map((item, idx) => {
          const isWeight = item.unitType === 'kg' || item.unitType === 'gram';
          const isSelected = idx === selectedIndex;
          const shortId = String(item.id || '').slice(-6).toUpperCase();
          return (
            <button
              key={item.id}
              onClick={() =>
                onAddLine(item, isWeight ? { weight } : { quantity })
              }
              onMouseEnter={() => setSelectedIndex(idx)}
              disabled={Boolean(disabled)}
              className={`text-left rtl:text-right border rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-800 dark:border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed ${touchMode ? 'p-6' : 'p-4'} ${isSelected ? 'ring-2 ring-primary-500 border-primary-500' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className={`font-bold dark:text-white truncate ${touchMode ? 'text-lg' : ''}`}>{item.name?.ar || item.name?.en || item.id}</div>
                  <div className={`text-gray-600 dark:text-gray-300 ${touchMode ? 'text-base' : 'text-sm'}`}>
                    {isWeight ? 'وزن' : 'كمية'} • {item.price.toFixed(2)}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    متاح: {Number(item.availableStock || 0)} {item.unitType === 'gram' ? 'غ' : item.unitType === 'kg' ? 'كغ' : 'ق'} • محجوز: {Number((item as any).reservedQuantity || 0)}
                  </div>
                </div>
                <div className="text-xs font-mono text-gray-400 shrink-0">#{shortId}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default POSItemSearch;
