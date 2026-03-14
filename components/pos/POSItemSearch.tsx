import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MenuItem } from '../../types';
import { useSettings } from '../../contexts/SettingsContext';
import { useSessionScope } from '../../contexts/SessionScopeContext';
import { useStock } from '../../contexts/StockContext';
import { useItemMeta } from '../../contexts/ItemMetaContext';
import { getSupabaseClient } from '../../supabase';

interface Props {
  onAddLine: (item: MenuItem, input: { quantity?: number; weight?: number }) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  touchMode?: boolean;
}

const POSItemSearch: React.FC<Props> = ({ onAddLine, inputRef, disabled, touchMode }) => {
  const { settings } = useSettings();
  const { getUnitLabel } = useItemMeta();
  const sessionScope = useSessionScope();
  const { getStockByItemId, getGlobalSellableByItemId } = useStock();
  const [baseItems, setBaseItems] = useState<MenuItem[]>([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [quantity, setQuantity] = useState<number>(1);
  const [weight, setWeight] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const qtyRef = useRef<HTMLInputElement | null>(null);
  const weightRef = useRef<HTMLInputElement | null>(null);
  const fetchSeqRef = useRef(0);

  const normalize = (value: unknown) => String(value || '')
    .toLowerCase()
    .replace(/[\s\-_]+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const toNum = (v: any) => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const esc = (v: string) => v.replace(/[%_,()]/g, '').trim();
    const run = async () => {
      const seq = ++fetchSeqRef.current;
      const qRaw = debouncedQuery.trim();
      const q = esc(qRaw);
      let req = supabase
        .from('v_sellable_products')
        .select('id, name, barcode, price, base_unit, data, available_quantity')
        .limit(q ? 120 : 300);
      if (q) {
        const pattern = `%${q}%`;
        req = req.or([
          `barcode.ilike.${pattern}`,
          `name->>ar.ilike.${pattern}`,
          `name->>en.ilike.${pattern}`,
          `data->>sku.ilike.${pattern}`,
          `data->>barcode.ilike.${pattern}`,
        ].join(','));
      }
      const { data, error } = await req;
      if (seq !== fetchSeqRef.current) return;
      if (error) {
        setBaseItems([]);
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
        const barcode = typeof row?.barcode === 'string' ? row.barcode : (raw as any).barcode;
        const id = String(row?.id || (raw as any).id || '');
        return {
          ...(raw as any),
          id,
          name: safeName,
          description: safeDescription,
          unitType: baseUnit,
          price,
          availableStock: toNum(row?.available_quantity),
          barcode: typeof barcode === 'string' ? barcode : undefined,
          status: 'active',
        } as MenuItem;
      });
      setBaseItems(items.filter(i => i && i.id));
    };
    void run();
  }, [debouncedQuery, sessionScope.scope?.warehouseId]);

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
    const withStock = (baseItems || []).map((m) => {
      const stock = getStockByItemId(String(m.id || ''));
      const globalAvailable = getGlobalSellableByItemId(String(m.id || ''));
      const sessionPhysical = stock ? Number(stock.availableQuantity || 0) : 0;
      const sessionReserved = stock ? Number(stock.reservedQuantity || 0) : 0;
      const sessionAvailable = Math.max(0, sessionPhysical - sessionReserved);
      const availableStock = stock ? sessionAvailable : globalAvailable;
      return {
        ...m,
        availableStock,
        reservedQuantity: stock ? sessionReserved : 0,
        sessionAvailableStock: sessionAvailable,
        sessionReservedQuantity: sessionReserved,
        globalAvailableStock: globalAvailable,
        stockFromSession: Boolean(stock),
      };
    }).filter((m) => Math.max(0, Number((m as any).globalAvailableStock ?? m.availableStock ?? 0)) > 0);
    return withStock.map((m) => {
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
  }, [baseItems, getStockByItemId, getGlobalSellableByItemId]);

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
          const sessionAvailable = Math.max(0, Number((item as any).sessionAvailableStock ?? item.availableStock ?? 0));
          const sessionReserved = Math.max(0, Number((item as any).sessionReservedQuantity ?? (item as any).reservedQuantity ?? 0));
          const globalAvailable = Math.max(0, Number((item as any).globalAvailableStock ?? item.availableStock ?? 0));
          const needed = Math.max(0, Number(isWeight ? weight : quantity) || 0);
          const sessionInsufficient = needed > 0 && sessionAvailable + 1e-9 < needed;
          const globalCanCover = needed > 0 && globalAvailable + 1e-9 >= needed;
          const stockBadge = sessionInsufficient
            ? (globalCanCover
              ? { label: 'يتطلب تبديل مستودع', cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800' }
              : { label: 'غير متوفر إجمالًا', cls: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800' })
            : { label: 'متوفر في الجلسة', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800' };
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
                  <div className="flex items-center gap-2">
                    <div className={`font-bold dark:text-white truncate ${touchMode ? 'text-lg' : ''}`}>{item.name?.ar || item.name?.en || item.id}</div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${stockBadge.cls}`}>{stockBadge.label}</span>
                  </div>
                  <div className={`text-gray-600 dark:text-gray-300 ${touchMode ? 'text-base' : 'text-sm'}`}>
                    {isWeight ? 'وزن' : 'كمية'} • سعر حسب العملة المختارة
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    مستودع الجلسة: {sessionAvailable} {getUnitLabel(String(item.unitType || 'piece') as any, 'ar') || 'وحدة'} • محجوز: {sessionReserved}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    إجمالي كل المستودعات: {globalAvailable}
                  </div>
                  {sessionInsufficient && globalCanCover && (
                    <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                      غير كافٍ في مستودع الجلسة لهذه الكمية، اختر مستودعًا مناسبًا داخل السطر بعد الإضافة.
                    </div>
                  )}
                  {sessionInsufficient && !globalCanCover && (
                    <div className="mt-1 text-[11px] text-red-700 dark:text-red-300">
                      الكمية المطلوبة غير متوفرة في إجمالي المستودعات حاليًا.
                    </div>
                  )}
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
