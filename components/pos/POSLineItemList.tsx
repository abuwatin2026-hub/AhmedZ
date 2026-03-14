import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CartItem } from '../../types';
import NumericKeypadModal from './NumericKeypadModal';
import { useStock } from '../../contexts/StockContext';
import { useSettings } from '../../contexts/SettingsContext';
import { localizeUomCodeAr } from '../../utils/displayLabels';
import { useItemMeta } from '../../contexts/ItemMetaContext';
import { getSupabaseClient } from '../../supabase';
import { useSessionScope } from '../../contexts/SessionScopeContext';
import { useWarehouses } from '../../contexts/WarehouseContext';

interface Props {
  items: CartItem[];
  currencyCode?: string;
  onUpdate: (cartItemId: string, next: { quantity?: number; weight?: number; uomCode?: string; uomQtyInBase?: number; forcedBatchId?: string | null; warehouseId?: string }) => void;
  onRemove: (cartItemId: string) => void;
  onEditAddons?: (cartItemId: string) => void;
  selectedCartItemId?: string | null;
  onSelect?: (cartItemId: string) => void;
  touchMode?: boolean;
  uomOptionsByItemId?: Record<string, Array<{ code: string; name?: string; qtyInBase: number }>>;
  costSummaryByItemId?: Record<string, { distinctCosts: number; layersCount: number }>;
}

const fmt = (n: number) => {
  const v = Number(n || 0);
  try {
    return v.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return v.toFixed(2);
  }
};

const POSLineItemList: React.FC<Props> = ({ items, currencyCode, onUpdate, onRemove, onEditAddons, selectedCartItemId, onSelect, touchMode, uomOptionsByItemId, costSummaryByItemId }) => {
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [keypadTitle, setKeypadTitle] = useState('');
  const [keypadInitial, setKeypadInitial] = useState(0);
  const [keypadDecimal, setKeypadDecimal] = useState(true);
  const [keypadTarget, setKeypadTarget] = useState<{ id: string; kind: 'qty' | 'weight' } | null>(null);
  const { getStockByItemId } = useStock();
  const { language } = useSettings();
  const { getUnitLabel } = useItemMeta();
  const sessionScope = useSessionScope();
  const [openBreakdownFor, setOpenBreakdownFor] = useState<string>('');
  const [batchRowsByItemId, setBatchRowsByItemId] = useState<Record<string, Array<{ batchId: string; remaining: number; unitCost: number; occurredAt?: string }>>>({});
  const [batchLoadingByItemId, setBatchLoadingByItemId] = useState<Record<string, boolean>>({});
  const [batchPickerCartItemId, setBatchPickerCartItemId] = useState<string>('');
  const [batchPickerItemId, setBatchPickerItemId] = useState<string>('');
  const code = String(currencyCode || '').toUpperCase() || '—';

  // ── Warehouse FEFO alerts ──
  type WarehouseAlert = { type: string; severity: 'error' | 'warning' | 'info' | 'success'; message: string; other_warehouse_id?: string; other_warehouse?: string;[k: string]: any };
  const [alertsByCartItemId, setAlertsByCartItemId] = useState<Record<string, WarehouseAlert[]>>({});
  const [alertsLoadingByCartItemId, setAlertsLoadingByCartItemId] = useState<Record<string, boolean>>({});
  const lastAlertRequestKeyByCartItemIdRef = useRef<Record<string, string>>({});

  const { warehouses } = useWarehouses();
  const warehouseId = useMemo(() => String(sessionScope.scope?.warehouseId || '').trim(), [sessionScope.scope?.warehouseId]);
  const warehouseOptionNodes = useMemo(
    () => (warehouses || [])
      .filter(w => w.isActive)
      .map(w => ({ id: w.id, name: w.name })),
    [warehouses]
  );

  const fetchAlerts = useCallback(async (cartItemId: string, itemId: string, whId: string, qty: number) => {
    const supabase = getSupabaseClient();
    if (!supabase || !itemId || !whId) return;
    const requestKey = `${itemId}|${whId}|${Number(qty || 0).toFixed(3)}`;
    if (lastAlertRequestKeyByCartItemIdRef.current[cartItemId] === requestKey) return;
    lastAlertRequestKeyByCartItemIdRef.current[cartItemId] = requestKey;
    setAlertsLoadingByCartItemId(prev => ({ ...prev, [cartItemId]: true }));
    try {
      const { data, error } = await supabase.rpc('get_warehouse_item_alerts', {
        p_item_id: itemId, p_warehouse_id: whId, p_requested_qty: qty,
      } as any);
      if (error) throw error;
      setAlertsByCartItemId(prev => ({ ...prev, [cartItemId]: Array.isArray(data) ? data : [] }));
    } catch {
      delete lastAlertRequestKeyByCartItemIdRef.current[cartItemId];
      setAlertsByCartItemId(prev => ({ ...prev, [cartItemId]: [] }));
    } finally {
      setAlertsLoadingByCartItemId(prev => ({ ...prev, [cartItemId]: false }));
    }
  }, []);

  // Auto-fetch alerts for all items on mount and when warehouseId changes
  useEffect(() => {
    items.forEach(item => {
      const iid = String((item as any)?.id || (item as any)?.itemId || '').trim();
      const wh = String(item.warehouseId || warehouseId || '').trim();
      const isPromo = (item as any)?.lineType === 'promotion' || Boolean((item as any)?.promotionId);
      if (!iid || !wh || isPromo) return;
      const isWeight = item.unitType === 'kg' || item.unitType === 'gram';
      const qty = isWeight ? Number(item.weight || 0) : Number(item.quantity || 0);
      const factor = Number((item as any).uomQtyInBase || 1) || 1;
      void fetchAlerts(item.cartItemId, iid, wh, qty * factor);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId]);

  const InlineMoney = ({ amount, className }: { amount: number; className?: string }) => (
    <span dir="ltr" className={className || ''}>
      <span className="font-mono">{fmt(amount)}</span> <span className="text-xs">{code}</span>
    </span>
  );


  const toggleBreakdown = async (itemId: string) => {
    const id = String(itemId || '').trim();
    if (!id) return;
    if (openBreakdownFor === id) {
      setOpenBreakdownFor('');
      return;
    }
    setOpenBreakdownFor(id);
    if (batchRowsByItemId[id]) return;
    const supabase = getSupabaseClient();
    if (!supabase || !warehouseId) return;
    setBatchLoadingByItemId(prev => ({ ...prev, [id]: true }));
    try {
      const { data, error } = await supabase.rpc('get_item_batches', { p_item_id: id, p_warehouse_id: warehouseId } as any);
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []).map((r: any) => {
        const batchId = String((r?.batch_id || r?.id || '')).trim();
        const remaining = Number(r?.remaining_quantity ?? r?.remaining ?? 0) || 0;
        const unitCost = Number(r?.unit_cost ?? r?.cost_per_unit ?? 0) || 0;
        const occurredAt = r?.occurred_at ? String(r.occurred_at) : undefined;
        return batchId ? { batchId, remaining, unitCost, occurredAt } : null;
      }).filter(Boolean) as Array<{ batchId: string; remaining: number; unitCost: number; occurredAt?: string }>;
      setBatchRowsByItemId(prev => ({ ...prev, [id]: rows }));
    } catch {
      setBatchRowsByItemId(prev => ({ ...prev, [id]: [] }));
    } finally {
      setBatchLoadingByItemId(prev => ({ ...prev, [id]: false }));
    }
  };

  const openBatchPicker = async (cartItemId: string, itemId: string) => {
    const cid = String(cartItemId || '').trim();
    const iid = String(itemId || '').trim();
    if (!cid || !iid) return;
    setBatchPickerCartItemId(cid);
    setBatchPickerItemId(iid);
    if (batchRowsByItemId[iid] || batchLoadingByItemId[iid]) return;
    await toggleBreakdown(iid);
  };

  const closeBatchPicker = () => {
    setBatchPickerCartItemId('');
    setBatchPickerItemId('');
  };

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
      {Boolean(batchPickerCartItemId && batchPickerItemId) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeBatchPicker}>
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="font-bold dark:text-white">اختيار الدفعة</div>
              <button type="button" onClick={closeBatchPicker} className="px-3 py-1 rounded-lg border dark:border-gray-600">
                إغلاق
              </button>
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300 mb-3">
              سيتم تسعير السطر وربط خصم المخزون بهذه الدفعة.
            </div>
            <div className="space-y-2 max-h-[60dvh] overflow-auto">
              {Boolean(batchLoadingByItemId[batchPickerItemId]) ? (
                <div className="text-sm text-gray-600 dark:text-gray-300">جاري التحميل...</div>
              ) : (batchRowsByItemId[batchPickerItemId] || []).length === 0 ? (
                <div className="text-sm text-gray-600 dark:text-gray-300">لا توجد دفعات متاحة.</div>
              ) : (
                (batchRowsByItemId[batchPickerItemId] || []).map((r) => (
                  <button
                    key={r.batchId}
                    type="button"
                    onClick={() => {
                      onUpdate(batchPickerCartItemId, { forcedBatchId: r.batchId });
                      closeBatchPicker();
                    }}
                    className="w-full text-right p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold dark:text-white" dir="ltr">{r.batchId.slice(0, 8)}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        متبقٍ {Number(r.remaining || 0).toLocaleString('ar-EG-u-nu-latn')}
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      كلفة أساس: {fmt(Number(r.unitCost || 0))}
                      {r.occurredAt ? ` • ${new Date(r.occurredAt).toLocaleString('ar-EG-u-nu-latn')}` : ''}
                    </div>
                  </button>
                ))
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  onUpdate(batchPickerCartItemId, { forcedBatchId: null });
                  closeBatchPicker();
                }}
                className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700"
              >
                إلغاء التحديد
              </button>
              <button type="button" onClick={closeBatchPicker} className="px-3 py-2 rounded-xl bg-gray-800 text-white dark:bg-gray-700">
                تم
              </button>
            </div>
          </div>
        </div>
      )}
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
        const factor = Number((item as any).uomQtyInBase || 1) || 1;
        const displayUnitPrice = item.unitType === 'gram' ? unitPrice : (unitPrice * factor);
        const lineTotal = (unitPrice + addonsPrice) * (Number(effectiveQty) || 0);
        const unitLabel = (() => {
          if (isPromotionLine) return 'باقة';
          const resolved = String((item as any)?.uomCode || item.unitType || 'piece');
          return getUnitLabel(resolved as any, 'ar') || localizeUomCodeAr(resolved);
        })();
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
                <InlineMoney amount={displayUnitPrice} />
                {addonsPrice > 0 && (
                  <span>
                    + إضافات <InlineMoney amount={addonsPrice} />
                  </span>
                )}
                <span className="font-semibold text-indigo-600 dark:text-indigo-300">
                  = <InlineMoney amount={lineTotal} />
                </span>
                {!isPromotionLine && (() => {
                  const f = Number((item as any).uomQtyInBase || 1) || 1;
                  const availBase = Math.max(0, Number(availableToSell || 0));
                  const reservedBase = Math.max(0, Number(reserved || 0));
                  const availUom = (f > 0 && item.unitType !== 'kg' && item.unitType !== 'gram') ? Math.floor((availBase / f) + 1e-9) : availBase;
                  const reservedUom = (f > 0 && item.unitType !== 'kg' && item.unitType !== 'gram') ? Math.floor((reservedBase / f) + 1e-9) : reservedBase;
                  const baseLabel = getUnitLabel(String(item.unitType || 'piece') as any, 'ar') || localizeUomCodeAr(String(item.unitType || 'piece'));
                  const uomLabel = localizeUomCodeAr(String((item as any).uomCode || item.unitType || 'piece'));
                  const id = String((item as any)?.id || (item as any)?.itemId || '').trim();
                  const expanded = openBreakdownFor === id;
                  const rows = (batchRowsByItemId[id] || []);
                  const loading = Boolean(batchLoadingByItemId[id]);
                  return (
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                      متاح: {availUom} {uomLabel} <span className="text-gray-400">({availBase} {baseLabel})</span> • محجوز: {reservedUom}
                      {' '}
                      <button
                        type="button"
                        onClick={() => toggleBreakdown(id)}
                        className="underline decoration-dotted hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        تفصيل
                      </button>
                      {expanded && (
                        <span className="block mt-1 text-[11px]">
                          {loading ? 'جاري التحميل...' : (
                            rows.length > 0
                              ? rows.slice(0, 4).map((r, i) => (
                                <span key={r.batchId} className="inline-block mr-2">
                                  {r.remaining} من دفعة {r.batchId.slice(0, 6)}
                                  {i < Math.min(rows.length, 4) - 1 ? ' • ' : ''}
                                </span>
                              ))
                              : 'لا يوجد تفصيل دفعات.'
                          )}
                        </span>
                      )}
                    </span>
                  );
                })()}
              </div>
              {!isPromotionLine && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
                  <span className="px-2 py-1 rounded-full border border-gray-200 dark:border-gray-700">
                    دفعة: {String((item as any)._fefoBatchCode || '').trim() || String((item as any)._fefoBatchId || '').slice(-6).toUpperCase() || 'تلقائي'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openBatchPicker(item.cartItemId, String((item as any)?.id || (item as any)?.itemId || ''))}
                    className="px-2 py-1 rounded-full border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                  >
                    اختيار
                  </button>
                  {String((item as any).forcedBatchId || '').trim() && (
                    <span className="px-2 py-1 rounded-full bg-slate-50 text-slate-800 border border-slate-200 dark:bg-slate-900/20 dark:text-slate-200 dark:border-slate-900">
                      محددة
                    </span>
                  )}
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
                  {!isPromotionLine && (() => {
                    const id = String((item as any)?.id || (item as any)?.itemId || '').trim();
                    const info = id ? (costSummaryByItemId || {})[id] : undefined;
                    const n = Number(info?.distinctCosts || 0);
                    if (!(n > 1)) return null;
                    return (
                      <span className="px-2 py-1 rounded-full bg-slate-50 text-slate-800 border border-slate-200 dark:bg-slate-900/20 dark:text-slate-200 dark:border-slate-900">
                        تكاليف متعددة: {n}
                      </span>
                    );
                  })()}
                </div>
              )}
              {!isPromotionLine && (
                <div className="mt-2 flex items-center gap-2 text-xs border-t border-gray-100 dark:border-gray-700 pt-2">
                  <span className="text-gray-500 dark:text-gray-400 min-w-16 font-medium">{language === 'ar' ? 'المستودع:' : 'Warehouse:'}</span>
                  <select
                    value={item.warehouseId || sessionScope.scope?.warehouseId || ''}
                    onChange={(e) => {
                      const newWh = e.target.value;
                      onUpdate(item.cartItemId, { warehouseId: newWh });
                      const iid = String((item as any)?.id || (item as any)?.itemId || '').trim();
                      const isW = item.unitType === 'kg' || item.unitType === 'gram';
                      const q = isW ? Number(item.weight || 0) : Number(item.quantity || 0);
                      const f = Number((item as any).uomQtyInBase || 1) || 1;
                      void fetchAlerts(item.cartItemId, iid, newWh, q * f);
                    }}
                    className="flex-1 border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 text-xs py-1 px-2 dark:bg-gray-700 dark:text-gray-200"
                  >
                    {warehouseOptionNodes.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* ── Warehouse FEFO Alerts ── */}
              {!isPromotionLine && (() => {
                const alerts = alertsByCartItemId[item.cartItemId] || [];
                const loading = alertsLoadingByCartItemId[item.cartItemId];
                if (loading) return <div className="mt-1 text-[11px] text-gray-400 animate-pulse">جارِ فحص المستودع...</div>;
                if (alerts.length === 0) return null;
                return (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {alerts.map((a: WarehouseAlert, i: number) => {
                      const colors = {
                        error: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800',
                        warning: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
                        info: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800',
                        success: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
                      };
                      const cls = colors[a.severity] || colors.info;
                      return (
                        <div key={i} className={`text-[11px] px-2 py-1 rounded-lg border font-medium ${cls}`}
                          onClick={() => {
                            if (a.other_warehouse_id) {
                              if (window.confirm(`هل تريد التبديل إلى مستودع "${a.other_warehouse || ''}"؟`)) {
                                onUpdate(item.cartItemId, { warehouseId: a.other_warehouse_id });
                                const iid = String((item as any)?.id || (item as any)?.itemId || '').trim();
                                const isW = item.unitType === 'kg' || item.unitType === 'gram';
                                const q = isW ? Number(item.weight || 0) : Number(item.quantity || 0);
                                const f = Number((item as any).uomQtyInBase || 1) || 1;
                                void fetchAlerts(item.cartItemId, iid, a.other_warehouse_id, q * f);
                              }
                            }
                          }}
                          style={{ cursor: a.other_warehouse_id ? 'pointer' : 'default' }}
                        >
                          {a.message}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
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
                      const baseDisplay = getUnitLabel(String(baseLabel || 'piece') as any, 'ar') || localizeUomCodeAr(String(baseLabel || 'piece'));
                      const baseOpt = [{ code: baseLabel, name: baseDisplay, qtyInBase: 1 }];
                      const merged = [...baseOpt, ...opts.filter((o: any) => String(o?.code || '') !== baseLabel)];
                      return merged.map((o: any) => {
                        const raw = o.name;
                        const nameObj = (raw && typeof raw === 'object') ? raw : null;
                        const nameRaw = nameObj ? String(nameObj?.[language] || nameObj?.ar || nameObj?.en || '').trim() : String(raw || '').trim();
                        const displayName = nameRaw || getUnitLabel(String(o.code || '') as any, 'ar') || localizeUomCodeAr(String(o.code || ''));
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
