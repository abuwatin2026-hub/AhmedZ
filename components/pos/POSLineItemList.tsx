import React, { useState } from 'react';
import type { CartItem } from '../../types';
import NumericKeypadModal from './NumericKeypadModal';
import { useStock } from '../../contexts/StockContext';
import { useSettings } from '../../contexts/SettingsContext';

interface Props {
  items: CartItem[];
  currencyCode?: string;
  onUpdate: (cartItemId: string, next: { quantity?: number; weight?: number; uomCode?: string; uomQtyInBase?: number }) => void;
  onRemove: (cartItemId: string) => void;
  onEditAddons?: (cartItemId: string) => void;
  selectedCartItemId?: string | null;
  onSelect?: (cartItemId: string) => void;
  touchMode?: boolean;
  uomOptionsByItemId?: Record<string, Array<{ code: string; name?: string; qtyInBase: number }>>;
}

const fmt = (n: number) => {
  const v = Number(n || 0);
  try {
    return v.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return v.toFixed(2);
  }
};

const POSLineItemList: React.FC<Props> = ({ items, currencyCode, onUpdate, onRemove, onEditAddons, selectedCartItemId, onSelect, touchMode, uomOptionsByItemId }) => {
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [keypadTitle, setKeypadTitle] = useState('');
  const [keypadInitial, setKeypadInitial] = useState(0);
  const [keypadDecimal, setKeypadDecimal] = useState(true);
  const [keypadTarget, setKeypadTarget] = useState<{ id: string; kind: 'qty' | 'weight' } | null>(null);
  const { getStockByItemId } = useStock();
  const { language } = useSettings();
  const code = String(currencyCode || '').toUpperCase() || '—';

  const InlineMoney = ({ amount, className }: { amount: number; className?: string }) => (
    <span dir="ltr" className={className || ''}>
      <span className="font-mono">{fmt(amount)}</span> <span className="text-xs">{code}</span>
    </span>
  );

  const openKeypad = (id: string, kind: 'qty' | 'weight', current: number) => {
    setKeypadTarget({ id, kind });
    setKeypadTitle(kind === 'weight' ? 'الوزن' : 'الكمية');
    setKeypadInitial(current);
    setKeypadDecimal(kind === 'weight');
    setKeypadOpen(true);
  };

  const applyKeypad = (v: number) => {
    const tgt = keypadTarget;
    if (!tgt) return;
    if (tgt.kind === 'weight') onUpdate(tgt.id, { weight: v });
    else onUpdate(tgt.id, { quantity: Math.max(0, Math.floor(v)) });
    setKeypadOpen(false);
    setKeypadTarget(null);
  };

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <div className="text-center text-gray-500 dark:text-gray-300">لا توجد سطور بعد</div>
      )}
      {items.map((item, index) => {
        const isPromotionLine = (item as any)?.lineType === 'promotion' || Boolean((item as any)?.promotionId);
        const isWeight = item.unitType === 'kg' || item.unitType === 'gram';
        const qty = isWeight ? item.weight || 0 : item.quantity;
        const isSelected = !!selectedCartItemId && item.cartItemId === selectedCartItemId;
        const hasAddons = !isPromotionLine && Array.isArray((item as any).addons) && (item as any).addons.length > 0;
        const stock = !isPromotionLine ? getStockByItemId(String((item as any)?.id || (item as any)?.itemId || '')) : undefined;
        const availableToSell = stock ? (Number(stock.availableQuantity || 0) - Number(stock.reservedQuantity || 0)) : Number((item as any).availableStock || 0);
        const reserved = stock ? Number(stock.reservedQuantity || 0) : Number((item as any).reservedQuantity || 0);
        const selectedAddonsCount = Object.values(item.selectedAddons || {}).reduce((sum, entry) => sum + (Number((entry as any)?.quantity) || 0), 0);
        const addonsPrice = isPromotionLine ? 0 : Object.values(item.selectedAddons || {}).reduce((sum, entry: any) => {
          const unit = Number(entry?.addon?.price) || 0;
          const q = Number(entry?.quantity) || 0;
          return sum + (unit * q);
        }, 0);
        let unitPrice = Number(item.price) || 0;
        let effectiveQty = qty;
        if (item.unitType === 'gram' && item.pricePerUnit) {
          unitPrice = (Number(item.pricePerUnit) || 0) / 1000;
        } else {
          const factor = Number((item as any).uomQtyInBase || 1) || 1;
          effectiveQty = (Number(qty) || 0) * factor;
        }
        const lineTotal = (unitPrice + addonsPrice) * (Number(effectiveQty) || 0);
        const unitLabel = isPromotionLine ? 'باقة' : (item.unitType === 'kg' ? 'كغ' : item.unitType === 'gram' ? 'غ' : 'قطعة');
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
                {isPromotionLine && (
                  <div className="text-[11px] px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-200 dark:border-indigo-900">
                    عرض
                  </div>
                )}
                <div className="text-[11px] px-2 py-1 rounded-full border dark:border-gray-700 text-gray-600 dark:text-gray-300">
                  {isWeight ? 'وزن' : 'كمية'}: {Number(qty || 0)} {unitLabel}
                </div>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300 flex flex-wrap gap-x-3 gap-y-1">
                <InlineMoney amount={unitPrice} />
                {addonsPrice > 0 && (
                  <span>
                    + إضافات <InlineMoney amount={addonsPrice} />
                  </span>
                )}
                <span className="font-semibold text-indigo-600 dark:text-indigo-300">
                  = <InlineMoney amount={lineTotal} />
                </span>
                {!isPromotionLine && (
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">متاح: {Math.max(0, Number(availableToSell || 0))} • محجوز: {Math.max(0, Number(reserved || 0))}</span>
                )}
              </div>
              {!isPromotionLine && ((item as any)?._fefoBatchCode || (item as any)?._fefoExpiryDate) && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
                  <span className="px-2 py-1 rounded-full border border-gray-200 dark:border-gray-700">
                    دفعة: {String((item as any)._fefoBatchCode || '').trim() || String((item as any)._fefoBatchId || '').slice(-6).toUpperCase()}
                  </span>
                  {(item as any)?._fefoExpiryDate && (
                    <span className="px-2 py-1 rounded-full border border-gray-200 dark:border-gray-700" dir="ltr">
                      EXP: {String((item as any)._fefoExpiryDate)}
                    </span>
                  )}
                  {Number((item as any)?._fefoMinPrice) > 0 && (
                    <span className="px-2 py-1 rounded-full border border-gray-200 dark:border-gray-700">
                      Min: <InlineMoney amount={Number((item as any)._fefoMinPrice) || 0} />
                    </span>
                  )}
                  {Boolean((item as any)?._fefoWarningNextBatchPriceDiff) && (
                    <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-900">
                      تنبيه: الدفعة التالية بسعر مختلف
                    </span>
                  )}
                </div>
              )}
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
              {isWeight && !isPromotionLine ? (
                <input
                  type="number"
                  step="0.01"
                  value={qty}
                  onChange={e => onUpdate(item.cartItemId, { weight: Number(e.target.value) || 0 })}
                  className={`border rounded-xl dark:bg-gray-700 dark:border-gray-600 ${touchMode ? 'w-36 p-4 text-lg' : 'w-28 p-3 text-base'}`}
                />
                ) : null}
                {isWeight && !isPromotionLine ? (
                  <button
                    type="button"
                    onClick={() => openKeypad(item.cartItemId, 'weight', Number(qty || 0))}
                    className={`rounded-xl border dark:border-gray-600 text-sm font-semibold ${touchMode ? 'px-5 py-4' : 'px-4 py-3'}`}
                  >
                    لوحة
                  </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onUpdate(item.cartItemId, { quantity: Math.max(0, item.quantity - 1) })}
                    className={`rounded-xl border dark:border-gray-600 font-bold ${touchMode ? 'px-6 py-4 text-2xl' : 'px-4 py-3 text-lg'}`}
                    disabled={isPromotionLine}
                  >
                    -
                  </button>
                  <div className={`text-center font-bold ${touchMode ? 'w-16 text-2xl' : 'w-12 text-lg'}`}>{qty}</div>
                  <button
                    onClick={() => onUpdate(item.cartItemId, { quantity: item.quantity + 1 })}
                    className={`rounded-xl border dark:border-gray-600 font-bold ${touchMode ? 'px-6 py-4 text-2xl' : 'px-4 py-3 text-lg'}`}
                    disabled={isPromotionLine}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => openKeypad(item.cartItemId, 'qty', Number(qty || 0))}
                    className={`rounded-xl border dark:border-gray-600 text-sm font-semibold ${touchMode ? 'px-5 py-4' : 'px-4 py-3'}`}
                    disabled={isPromotionLine}
                  >
                    لوحة
                  </button>
                  <select
                    className={`rounded-xl border dark:border-gray-600 ${touchMode ? 'px-5 py-4' : 'px-4 py-3'}`}
                    disabled={isPromotionLine}
                    value={String((item as any).uomCode || '').trim() || (item.unitType || 'piece')}
                    onChange={(e) => {
                      const code = String(e.target.value || '').trim();
                      const options = (typeof ((uomOptionsByItemId || {})[String((item as any)?.id || (item as any)?.itemId || '')]) !== 'undefined'
                        ? (uomOptionsByItemId || {})[String((item as any)?.id || (item as any)?.itemId || '')]
                        : (Array.isArray((item as any)?.uomUnits) ? (item as any).uomUnits : [])) || [];
                      const baseLabel = (item.unitType || 'piece');
                      const found = options.find((o: any) => String(o?.code || '') === code);
                      const qtyBase = Number(found?.qtyInBase || (code === baseLabel ? 1 : 0)) || (code === baseLabel ? 1 : 0);
                      onUpdate(item.cartItemId, { uomCode: code, uomQtyInBase: qtyBase });
                    }}
                  >
                    {(() => {
                      const opts = (typeof ((uomOptionsByItemId || {})[String((item as any)?.id || (item as any)?.itemId || '')]) !== 'undefined'
                        ? (uomOptionsByItemId || {})[String((item as any)?.id || (item as any)?.itemId || '')]
                        : (Array.isArray((item as any)?.uomUnits) ? (item as any).uomUnits : [])) || [];
                      const baseLabel = (item.unitType || 'piece');
                      const baseDisplay = baseLabel === 'piece' ? 'قطعة' : baseLabel === 'kg' ? 'كغ' : baseLabel === 'gram' ? 'غ' : baseLabel;
                      const baseOpt = [{ code: baseLabel, name: baseDisplay, qtyInBase: 1 }];
                      const merged = [...baseOpt, ...opts.filter((o: any) => String(o?.code || '') !== baseLabel)];
                      return merged.map((o: any) => {
                        const codeLower = String(o.code || '').trim().toLowerCase();
                        const raw = o.name;
                        const nameObj = (raw && typeof raw === 'object') ? raw : null;
                        const nameRaw = nameObj ? String(nameObj?.[language] || nameObj?.ar || nameObj?.en || '').trim() : String(raw || '').trim();
                        const displayName = codeLower === 'pack'
                          ? 'باكت'
                          : codeLower === 'carton'
                            ? 'كرتون'
                            : (nameRaw || o.code);
                        const qtyText = Number(o.qtyInBase) > 1 ? ` (${Number(o.qtyInBase)} ${baseDisplay})` : '';
                        return (
                          <option key={o.code} value={o.code}>
                            {displayName}{qtyText}
                          </option>
                        );
                      });
                    })()}
                  </select>
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
      <NumericKeypadModal
        isOpen={keypadOpen}
        title={keypadTitle}
        initialValue={keypadInitial}
        allowDecimal={keypadDecimal}
        onClose={() => { setKeypadOpen(false); setKeypadTarget(null); }}
        onSubmit={applyKeypad}
      />
    </div>
  );
};

export default POSLineItemList;
