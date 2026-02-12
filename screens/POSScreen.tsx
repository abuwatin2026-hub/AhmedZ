import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CartItem, Customer, MenuItem } from '../types';
import { useToast } from '../contexts/ToastContext';
import { useOrders } from '../contexts/OrderContext';
import { useCashShift } from '../contexts/CashShiftContext';
import { useUserAuth } from '../contexts/UserAuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useStock } from '../contexts/StockContext';
import CurrencyDualAmount from '../components/common/CurrencyDualAmount';
import { getBaseCurrencyCode } from '../supabase';
import { getSupabaseClient, reloadPostgrestSchema } from '../supabase';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';
import POSHeaderShiftStatus from '../components/pos/POSHeaderShiftStatus';
import POSItemSearch from '../components/pos/POSItemSearch';
import POSLineItemList from '../components/pos/POSLineItemList';
import POSTotals from '../components/pos/POSTotals';
import POSPaymentPanel from '../components/pos/POSPaymentPanel';
import ConfirmationModal from '../components/admin/ConfirmationModal';
import { usePromotions } from '../contexts/PromotionContext';
import { useSessionScope } from '../contexts/SessionScopeContext';

const POSScreen: React.FC = () => {
  const { showNotification } = useToast();
  const navigate = useNavigate();
  const { orders, createInStoreSale, createInStorePendingOrder, resumeInStorePendingOrder, cancelInStorePendingOrder, fetchRemoteOrderById } = useOrders();
  const { currentShift } = useCashShift();
  const { customers, fetchCustomers } = useUserAuth();
  const { settings } = useSettings();
  const { fetchStock } = useStock();
  const { activePromotions, refreshActivePromotions, applyPromotionToCart } = usePromotions();
  const sessionScope = useSessionScope();
  const [items, setItems] = useState<CartItem[]>([]);
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [autoOpenInvoice, setAutoOpenInvoice] = useState(true);
  const [addonsCartItemId, setAddonsCartItemId] = useState<string | null>(null);
  const [addonsDraft, setAddonsDraft] = useState<Record<string, number>>({});
  const [promotionPickerOpen, setPromotionPickerOpen] = useState(false);
  const [promotionBundleQty, setPromotionBundleQty] = useState<number>(1);
  const [promotionBusy, setPromotionBusy] = useState(false);
  const [pendingFilter, setPendingFilter] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingFilterRef = useRef<HTMLInputElement>(null);
  const [selectedCartItemId, setSelectedCartItemId] = useState<string | null>(null);
  const [pendingSelectedId, setPendingSelectedId] = useState<string | null>(null);
  const [touchMode, setTouchMode] = useState<boolean>(false);
  const [baseCode, setBaseCode] = useState<string>('');
  const [currencyOptions, setCurrencyOptions] = useState<string[]>([]);
  const [transactionFxRate, setTransactionFxRate] = useState<number>(1);
  const fxRateRef = useRef<number>(1);
  const prevFxRateRef = useRef<number>(1);
  const prevCurrencyRef = useRef<string>('');
  const [transactionCurrency, setTransactionCurrency] = useState<string>(() => {
    const ops = (settings as any)?.operationalCurrencies;
    const first = Array.isArray(ops) ? String(ops[0] || '').trim().toUpperCase() : '';
    return first || '';
  });
  const pricingCacheRef = useRef<Map<string, {
    baseUnitPrice?: number;
    unitPrice: number;
    baseUnitPricePerKg?: number;
    unitPricePerKg?: number;
    batchId?: string;
    batchCode?: string;
    expiryDate?: string;
    unitCost?: number;
    baseMinPrice?: number;
    minPrice?: number;
    baseNextBatchMinPrice?: number;
    nextBatchMinPrice?: number;
    warningNextBatchPriceDiff?: boolean;
    reasonCode?: string;
  }>>(new Map());
  const fefoPricingDisabledRef = useRef(false);
  const pricingRunIdRef = useRef(0);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [pricingReady, setPricingReady] = useState(true);
  const [costSummaryByItemId, setCostSummaryByItemId] = useState<Record<string, { distinctCosts: number; layersCount: number }>>({});
  const [isPortrait, setIsPortrait] = useState<boolean>(() => {
    try {
      return window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
    } catch {
      return false;
    }
  });

  const [itemUomRowsByItemId, setItemUomRowsByItemId] = useState<Record<string, Array<{ code: string; name?: string; qtyInBase: number }>>>({});
  const itemUomLoadingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    void getBaseCurrencyCode().then((c) => {
      if (!c) return;
      setBaseCode(c);
    });
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { data, error } = await supabase.from('currencies').select('code').order('code', { ascending: true });
        if (error) throw error;
        const codes = (Array.isArray(data) ? data : [])
          .map((r: any) => String(r?.code || '').trim().toUpperCase())
          .filter(Boolean);
        if (active) setCurrencyOptions(Array.from(new Set(codes)));
      } catch {
        if (active) setCurrencyOptions([]);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const ids = Array.from(new Set(items.map((r) => String((r as any)?.id || (r as any)?.itemId || '').trim()).filter(Boolean)));
    if (!ids.length) return;
    for (const id of ids) {
      if (itemUomRowsByItemId[id]) continue;
      if (itemUomLoadingRef.current.has(id)) continue;
      itemUomLoadingRef.current.add(id);
      (async () => {
        try {
          const { data, error } = await supabase.rpc('list_item_uom_units', { p_item_id: id } as any);
          if (error) throw error;
          const rows = Array.isArray(data) ? data : [];
          const normalized: Array<{ code: string; name?: string; qtyInBase: number }> = rows
            .filter((r: any) => Boolean(r?.is_active))
            .map((r: any) => ({
              code: String(r?.uom_code || '').trim(),
              name: String(r?.uom_name || '').trim() || undefined,
              qtyInBase: Number(r?.qty_in_base || 0) || 0,
            }))
            .filter((r) => r.code && r.qtyInBase > 0);
          setItemUomRowsByItemId((prev) => ({ ...prev, [id]: normalized }));
        } catch {
          setItemUomRowsByItemId((prev) => ({ ...prev, [id]: [] }));
        } finally {
          itemUomLoadingRef.current.delete(id);
        }
      })();
    }
  }, [items]);

  const operationalCurrencies = useMemo(() => {
    const fromSettings = Array.isArray(settings.operationalCurrencies) && settings.operationalCurrencies.length
      ? settings.operationalCurrencies
      : [];
    const list = fromSettings.length > 0
      ? fromSettings
      : (currencyOptions.length > 0 ? currencyOptions : []);
    const normalized = list.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean);
    const unique = Array.from(new Set(normalized));
    if (unique.length > 0) return unique;
    const fallback = String(baseCode || transactionCurrency || '').trim().toUpperCase();
    return fallback ? [fallback] : [];
  }, [baseCode, currencyOptions, settings.operationalCurrencies, transactionCurrency]);

  const roundMoney = (v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  };

  const convertBaseToTxn = (baseAmount: number, rate: number) => {
    const r = Number(rate) || 0;
    if (!(r > 0)) return roundMoney(baseAmount);
    return roundMoney((Number(baseAmount) || 0) / r);
  };

  const fetchOperationalFxRate = async (currencyCode: string): Promise<number | null> => {
    const code = String(currencyCode || '').trim().toUpperCase();
    if (!code) return null;
    const base = String(baseCode || '').trim().toUpperCase();
    if (base && code === base) return 1;
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    const d = new Date().toISOString().slice(0, 10);
    try {
      const { data, error } = await supabase
        .from('fx_rates')
        .select('rate,rate_date')
        .eq('currency_code', code)
        .eq('rate_type', 'operational')
        .lte('rate_date', d)
        .order('rate_date', { ascending: false })
        .limit(1);
      if (error) return null;
      const n = Number((Array.isArray(data) && data.length > 0 ? (data[0] as any)?.rate : null));
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const nextCode = String(transactionCurrency || '').trim().toUpperCase();
    const base = String(baseCode || '').trim().toUpperCase();
    if (!nextCode) return;
    let cancelled = false;
    const run = async () => {
      const currentFx = fxRateRef.current;
      prevFxRateRef.current = currentFx;
      prevCurrencyRef.current = nextCode;
      if (base && nextCode === base) {
        if (!cancelled) {
          fxRateRef.current = 1;
          setTransactionFxRate(1);
        }
        return;
      }
      const rate = await fetchOperationalFxRate(nextCode);
      if (cancelled) return;
      if (!rate) {
        showNotification('لا يوجد سعر صرف تشغيلي لهذه العملة اليوم. أضف السعر من شاشة أسعار الصرف.', 'error');
        const fallback = base || operationalCurrencies[0] || '';
        if (fallback) setTransactionCurrency(fallback);
        return;
      }
      fxRateRef.current = rate;
      setTransactionFxRate(rate);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [baseCode, operationalCurrencies, showNotification, transactionCurrency]);

  useEffect(() => {
    const newRate = Number(transactionFxRate) || 1;
    if (!(newRate > 0)) return;
    const oldRate = Number(prevFxRateRef.current) || 1;
    if (discountType === 'amount' && (Number(discountValue) || 0) > 0 && !pendingOrderId && oldRate > 0) {
      const baseAmt = (Number(discountValue) || 0) * oldRate;
      const nextDiscount = roundMoney(baseAmt / newRate);
      if (Math.abs(nextDiscount - (Number(discountValue) || 0)) > 0.0001) {
        setDiscountValue(nextDiscount);
      }
    }
    setItems((prev) => {
      const next = prev.map((item: any) => {
        if ((item as any)?.lineType === 'promotion' || Boolean((item as any)?.promotionId)) return item;
        const basePrice = Number(item._basePrice != null ? item._basePrice : item.price) || 0;
        const basePerUnit = Number(item._basePricePerUnit != null ? item._basePricePerUnit : (item.pricePerUnit != null ? item.pricePerUnit : 0)) || 0;
        const addonsList = Array.isArray(item.addons) ? item.addons : [];
        const nextAddonsList = addonsList.map((a: any) => {
          const aBase = Number(a?._basePrice != null ? a._basePrice : a?.price) || 0;
          return { ...a, _basePrice: aBase, price: convertBaseToTxn(aBase, newRate) };
        });
        const selected = item.selectedAddons && typeof item.selectedAddons === 'object' ? item.selectedAddons : {};
        const nextSelected: any = {};
        for (const [id, entry] of Object.entries(selected)) {
          const e: any = entry as any;
          const addon = e?.addon;
          const aBase = Number(addon?._basePrice != null ? addon._basePrice : addon?.price) || 0;
          nextSelected[id] = {
            ...e,
            addon: addon ? { ...addon, _basePrice: aBase, price: convertBaseToTxn(aBase, newRate) } : addon,
          };
        }
        return {
          ...item,
          _basePrice: basePrice,
          _basePricePerUnit: basePerUnit,
          price: convertBaseToTxn(basePrice, newRate),
          ...(item.unitType === 'gram' ? { pricePerUnit: convertBaseToTxn(basePerUnit, newRate) } : {}),
          addons: nextAddonsList,
          selectedAddons: nextSelected,
          _fefoMinPrice: item._fefoMinPriceBase != null ? convertBaseToTxn(Number(item._fefoMinPriceBase) || 0, newRate) : item._fefoMinPrice,
          _fefoNextBatchMinPrice: item._fefoNextBatchMinPriceBase != null ? convertBaseToTxn(Number(item._fefoNextBatchMinPriceBase) || 0, newRate) : item._fefoNextBatchMinPrice,
        };
      });
      return next;
    });
  }, [discountType, discountValue, pendingOrderId, transactionFxRate]);

  useEffect(() => {
    const current = String(transactionCurrency || '').trim().toUpperCase();
    if (current && operationalCurrencies.includes(current)) return;
    const next = operationalCurrencies[0] || '';
    if (next) setTransactionCurrency(next);
  }, [operationalCurrencies, transactionCurrency]);

  type DraftInvoice = {
    items: CartItem[];
    discountType: 'amount' | 'percent';
    discountValue: number;
    currency: string;
    customerName: string;
    phoneNumber: string;
    notes: string;
    selectedCartItemId: string | null;
  };

  const [draftInvoice, setDraftInvoice] = useState<DraftInvoice | null>(null);

  const isPromotionLine = useCallback((item: CartItem) => {
    return (item as any)?.lineType === 'promotion' || Boolean((item as any)?.promotionId);
  }, []);

  const hasPromotionLines = useMemo(() => {
    return items.some((i) => isPromotionLine(i));
  }, [isPromotionLine, items]);

  useEffect(() => {
    if (!hasPromotionLines) return;
    if (Number(discountValue) > 0) setDiscountValue(0);
  }, [discountValue, hasPromotionLines]);


  useEffect(() => {
    void fetchCustomers();
  }, [fetchCustomers]);

  useEffect(() => {
    let mql: MediaQueryList | null = null;
    try {
      mql = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
    } catch {
      mql = null;
    }
    if (!mql) return;
    const onChange = () => setIsPortrait(mql?.matches || false);
    onChange();
    try {
      mql.addEventListener('change', onChange);
      return () => mql?.removeEventListener('change', onChange);
    } catch {
      mql.addListener(onChange);
      return () => mql?.removeListener(onChange);
    }
  }, []);

  const focusSearch = () => {
    try {
      searchInputRef.current?.focus();
      searchInputRef.current?.select?.();
    } catch {}
  };

  const resetCustomerFields = () => {
    setCustomerName('');
    setPhoneNumber('');
    setCustomerQuery('');
    setSelectedCustomerId(null);
  };

  const applyCustomerDraft = (name: string, phone: string) => {
    setCustomerName(name);
    setPhoneNumber(phone);
    setCustomerQuery(name || phone);
    setSelectedCustomerId(null);
  };

  const handleCustomerSelect = (customer: Customer) => {
    const label = customer.fullName || customer.phoneNumber || customer.email || customer.loginIdentifier || '';
    setCustomerName(customer.fullName || '');
    setPhoneNumber(customer.phoneNumber || '');
    setCustomerQuery(label);
    setSelectedCustomerId(customer.id);
    setCustomerDropdownOpen(false);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || '').toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';

      if (e.key === 'Escape' && addonsCartItemId) {
        e.preventDefault();
        setAddonsCartItemId(null);
        setAddonsDraft({});
        focusSearch();
        return;
      }

      if (isTyping) return;

      if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        pendingFilterRef.current?.focus();
        pendingFilterRef.current?.select?.();
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [addonsCartItemId]);

  useEffect(() => {
    setSelectedCartItemId((current) => {
      if (!items.length) return null;
      if (current && items.some(i => i.cartItemId === current)) return current;
      return items[0].cartItemId;
    });
  }, [items]);

  const getPricingQty = (item: CartItem) => {
    if (isPromotionLine(item)) return Number(item.quantity) || 0;
    const isWeight = item.unitType === 'kg' || item.unitType === 'gram';
    if (isWeight) return (Number(item.weight) || Number(item.quantity) || 0);
    const factor = Number((item as any)?.uomQtyInBase || 1) || 1;
    return (Number(item.quantity) || 0) * factor;
  };

  const pricingSignature = useMemo(() => {
    if (!items.length) return '';
    const base = items
      .map((i) => {
        if (isPromotionLine(i)) return `promo:${(i as any).promotionId || i.id}:${getPricingQty(i)}`;
        const factor = Number((i as any)?.uomQtyInBase || 1) || 1;
        const priceSig = `${Number((i as any)?.price) || 0}:${Number((i as any)?.pricePerUnit) || 0}`;
        return `${i.id}:${i.unitType || ''}:${getPricingQty(i)}:u${factor}:p${priceSig}`;
      })
      .sort()
      .join('|');
    return `${base}|cust:${selectedCustomerId || ''}`;
  }, [getPricingQty, isPromotionLine, items, selectedCustomerId]);

  useEffect(() => {
    if (pendingOrderId) return;
    if (!items.length) {
      setPricingBusy(false);
      setPricingReady(true);
      return;
    }
    const runId = pricingRunIdRef.current + 1;
    pricingRunIdRef.current = runId;

    const isOnline = typeof navigator !== 'undefined' && navigator.onLine !== false;
    const supabase = isOnline ? getSupabaseClient() : null;

    if (!supabase) {
      let missing = false;
      let warehouseId = '';
      try {
        warehouseId = sessionScope.requireScope().warehouseId;
      } catch {
        warehouseId = '';
      }
      const next = items.map((item) => {
        if (isPromotionLine(item)) {
          missing = true;
          return item;
        }
        const pricingQty = getPricingQty(item);
        const key = `${transactionCurrency}:${warehouseId}:${item.id}:${item.unitType || ''}:${pricingQty}:${selectedCustomerId || ''}`;
        const cached = pricingCacheRef.current.get(key);
        if (!cached) {
          return item;
        }
        const nextItem: any = { ...item, price: cached.unitPrice, _pricedByRpc: true, _pricingKey: key };
        if (item.unitType === 'gram') {
          nextItem.pricePerUnit = cached.unitPricePerKg ?? (cached.unitPrice * 1000);
        }
        return nextItem as CartItem;
      });
      setPricingReady(!missing);
      setPricingBusy(false);
      setItems((prev) => {
        if (prev.length !== next.length) return next;
        for (let i = 0; i < prev.length; i++) {
          if (prev[i].cartItemId !== next[i].cartItemId) return next;
          if (prev[i].price !== next[i].price) return next;
          if ((prev[i] as any)._pricedByRpc !== (next[i] as any)._pricedByRpc) return next;
          if ((prev[i] as any)._pricingKey !== (next[i] as any)._pricingKey) return next;
          if (prev[i].pricePerUnit !== next[i].pricePerUnit) return next;
        }
        return prev;
      });
      return;
    }

    const isRpcNotFoundError = (err: any) => {
      const code = String(err?.code || '');
      const msg = String(err?.message || '');
      const details = String(err?.details || '');
      const status = (err as any)?.status;
      return (
        code === 'PGRST202' ||
        status === 404 ||
        /Could not find the function/i.test(msg) ||
        /PGRST202/i.test(details)
      );
    };

    const run = async () => {
      setPricingBusy(true);
      try {
        const pricingItems = items.filter((it) => !isPromotionLine(it));
        const warehouseId = sessionScope.requireScope().warehouseId;
        const sessionData = await supabase.auth.getSession();
        const hasSession = Boolean(sessionData.data.session);
        if (!hasSession) {
          fefoPricingDisabledRef.current = true;
        }
        // force local pricing for in-store POS
        fefoPricingDisabledRef.current = true;
        const results = await Promise.all(pricingItems.map(async (item) => {
          const pricingQty = getPricingQty(item);
          const key = `${transactionCurrency}:${warehouseId}:${item.id}:${item.unitType || ''}:${pricingQty}:${selectedCustomerId || ''}`;
          const cached = pricingCacheRef.current.get(key);
          if (cached) {
            const hasFefoSignal = Boolean((cached as any)?.batchId) || (cached as any)?.baseMinPrice != null || (cached as any)?.minPrice != null;
            if (!hasSession || fefoPricingDisabledRef.current || hasFefoSignal) {
              return { key, itemId: item.id, unitType: item.unitType, ...cached };
            }
          }
          const customerId = (selectedCustomerId && selectedCustomerId.trim() !== '') ? selectedCustomerId : null;
          const resolveLocal = async () => {
            const baseUnitPrice = Number((item as any)?._basePrice != null ? (item as any)._basePrice : (item as any).price) || 0;
            const unitPrice = convertBaseToTxn(baseUnitPrice, fxRateRef.current);
            const baseUnitPricePerKg = item.unitType === 'gram' ? baseUnitPrice * 1000 : undefined;
            const unitPricePerKg = item.unitType === 'gram' ? convertBaseToTxn(baseUnitPricePerKg || 0, fxRateRef.current) : undefined;
            return { baseUnitPrice, unitPrice, baseUnitPricePerKg, unitPricePerKg };
          };
          // server fallback disabled: use local price only
          const call = async () => {
            return await supabase.rpc('get_fefo_pricing', {
              p_item_id: item.id,
              p_warehouse_id: warehouseId,
              p_quantity: pricingQty,
              p_customer_id: customerId,
            });
          };
          const resolveViaFallback = async () => {
            return await resolveLocal();
          };

          let entry: any;
          if (!hasSession || fefoPricingDisabledRef.current) {
            entry = await resolveViaFallback();
          } else {
            let { data, error } = await call();
            if (error && isRpcNotFoundError(error)) {
              const reloaded = await reloadPostgrestSchema();
              if (reloaded) {
                const retry = await call();
                data = retry.data;
                error = retry.error;
              }
            }
            if (error && isRpcNotFoundError(error)) {
              fefoPricingDisabledRef.current = true;
              entry = await resolveViaFallback();
            } else if (error) {
              entry = await resolveViaFallback();
            } else {
              const row = (Array.isArray(data) ? data[0] : data) as any;
              const baseUnitPrice = Number(row?.suggested_price);
              if (!Number.isFinite(baseUnitPrice) || baseUnitPrice < 0) {
                entry = await resolveViaFallback();
              } else {
                const unitPrice = convertBaseToTxn(baseUnitPrice, fxRateRef.current);
                const baseUnitPricePerKg = item.unitType === 'gram' ? baseUnitPrice * 1000 : undefined;
                const unitPricePerKg = item.unitType === 'gram' ? convertBaseToTxn(baseUnitPricePerKg || 0, fxRateRef.current) : undefined;
                entry = {
                  baseUnitPrice,
                  unitPrice,
                  baseUnitPricePerKg,
                  unitPricePerKg,
                  batchId: row?.batch_id ? String(row.batch_id) : undefined,
                  batchCode: row?.batch_code ? String(row.batch_code) : undefined,
                  expiryDate: row?.expiry_date ? String(row.expiry_date) : undefined,
                  unitCost: Number(row?.unit_cost) || 0,
                  baseMinPrice: Number(row?.min_price) || 0,
                  minPrice: convertBaseToTxn(Number(row?.min_price) || 0, fxRateRef.current),
                  baseNextBatchMinPrice: row?.next_batch_min_price != null ? (Number(row.next_batch_min_price) || 0) : undefined,
                  nextBatchMinPrice: row?.next_batch_min_price != null ? convertBaseToTxn((Number(row.next_batch_min_price) || 0), fxRateRef.current) : undefined,
                  warningNextBatchPriceDiff: Boolean(row?.warning_next_batch_price_diff),
                  reasonCode: row?.reason_code ? String(row.reason_code) : undefined,
                };
              }
            }
          }
          pricingCacheRef.current.set(key, entry);
          return { key, itemId: item.id, unitType: item.unitType, ...entry };
        }));
        if (pricingRunIdRef.current !== runId) return;
        const next = items.map((item) => {
          if (isPromotionLine(item)) return item;
          const pricingQty = getPricingQty(item);
          const warehouseId = sessionScope.requireScope().warehouseId;
          const key = `${transactionCurrency}:${warehouseId}:${item.id}:${item.unitType || ''}:${pricingQty}:${selectedCustomerId || ''}`;
          const priced = results.find((r) => r.key === key);
          if (!priced) return item;
          const nextItem: any = {
            ...item,
            price: priced.unitPrice,
            _pricedByRpc: true,
            _pricingKey: key,
            _basePrice: priced.baseUnitPrice != null ? Number(priced.baseUnitPrice) || 0 : (Number((item as any)._basePrice) || 0),
            _fefoBatchId: priced.batchId,
            _fefoBatchCode: priced.batchCode,
            _fefoExpiryDate: priced.expiryDate,
            _fefoUnitCost: priced.unitCost,
            _fefoMinPriceBase: priced.baseMinPrice != null ? Number(priced.baseMinPrice) || 0 : undefined,
            _fefoMinPrice: priced.minPrice,
            _fefoNextBatchMinPriceBase: priced.baseNextBatchMinPrice != null ? Number(priced.baseNextBatchMinPrice) || 0 : undefined,
            _fefoNextBatchMinPrice: priced.nextBatchMinPrice,
            _fefoWarningNextBatchPriceDiff: priced.warningNextBatchPriceDiff,
            _fefoReasonCode: priced.reasonCode,
          };
          if (item.unitType === 'gram') {
            nextItem.pricePerUnit = priced.unitPricePerKg;
            nextItem._basePricePerUnit = priced.baseUnitPricePerKg != null ? Number(priced.baseUnitPricePerKg) || 0 : (Number((item as any)._basePricePerUnit) || 0);
          }
          return nextItem as CartItem;
        });
        setItems((prev) => {
          if (prev.length !== next.length) return next;
          for (let i = 0; i < prev.length; i++) {
            if (prev[i].cartItemId !== next[i].cartItemId) return next;
            if (prev[i].price !== next[i].price) return next;
            if ((prev[i] as any)._pricedByRpc !== (next[i] as any)._pricedByRpc) return next;
            if ((prev[i] as any)._pricingKey !== (next[i] as any)._pricingKey) return next;
            if (prev[i].pricePerUnit !== next[i].pricePerUnit) return next;
          }
          return prev;
        });
        setPricingReady(true);
      } catch (e) {
        if (pricingRunIdRef.current !== runId) return;
        if (isAbortLikeError(e)) return;
        setPricingReady(false);
        showNotification(localizeSupabaseError(e) || 'تعذر تسعير الأصناف من الخادم.', 'error');
      } finally {
        if (pricingRunIdRef.current === runId) setPricingBusy(false);
      }
    };

    void run();
  }, [pendingOrderId, pricingSignature, sessionScope, showNotification]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const warehouseId = sessionScope.requireScope().warehouseId;
    const ids = Array.from(new Set(items
      .filter((it: any) => !((it as any)?.lineType === 'promotion' || Boolean((it as any)?.promotionId)))
      .map((it: any) => String(it?.id || it?.itemId || '').trim())
      .filter(Boolean)));
    if (!warehouseId || ids.length === 0) {
      setCostSummaryByItemId({});
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const { data, error } = await supabase.rpc('get_item_cost_layers_summaries', {
          p_warehouse_id: warehouseId,
          p_item_ids: ids,
        } as any);
        if (cancelled) return;
        if (error) return;
        const map: Record<string, { distinctCosts: number; layersCount: number }> = {};
        for (const row of (Array.isArray(data) ? data : [])) {
          const itemId = String((row as any)?.item_id || '').trim();
          if (!itemId) continue;
          map[itemId] = {
            distinctCosts: Number((row as any)?.distinct_costs || 0) || 0,
            layersCount: Number((row as any)?.layers_count || 0) || 0,
          };
        }
        setCostSummaryByItemId(map);
      } catch {
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [items, sessionScope]);

  const pricingBlockReason = useMemo(() => {
    if (!items.length) return '';
    if (pricingBusy) return 'جارٍ تسعير الأصناف من الخادم...';
    if (!pricingReady) return 'تعذر تسعير الأصناف من الخادم. تحقق من الاتصال ثم أعد المحاولة.';
    return '';
  }, [items.length, pricingBusy, pricingReady]);

  const addLine = (item: MenuItem, input: { quantity?: number; weight?: number }) => {
    if (pendingOrderId) return;
    const fx = fxRateRef.current > 0 ? fxRateRef.current : 1;
    const isWeight = item.unitType === 'kg' || item.unitType === 'gram';
    const qty = isWeight ? 1 : Number(input.quantity || 0);
    const wt = isWeight ? Number(input.weight || 0) : undefined;
    if (!isWeight && !(qty > 0)) return;
    if (isWeight && !(wt && wt > 0)) return;
    const basePrice = Number((item as any)?._basePrice != null ? (item as any)._basePrice : (item as any).price) || 0;
    const addons = Array.isArray((item as any).addons) ? (item as any).addons : [];
    const nextAddons = addons.map((a: any) => {
      const aBase = Number(a?._basePrice != null ? a._basePrice : a?.price) || 0;
      return { ...a, _basePrice: aBase, price: convertBaseToTxn(aBase, fx) };
    });
    const cartItem: CartItem = {
      ...item,
      quantity: qty,
      weight: wt,
      selectedAddons: {},
      cartItemId: crypto.randomUUID(),
      unit: item.unitType || 'piece',
      lineType: 'menu',
      price: convertBaseToTxn(basePrice, fx),
      uomCode: String(item.unitType || 'piece'),
      uomQtyInBase: 1,
    };
    (cartItem as any)._basePrice = basePrice;
    if (String(item.unitType || '') === 'gram') {
      const basePerUnit = basePrice * 1000;
      (cartItem as any)._basePricePerUnit = basePerUnit;
      (cartItem as any).pricePerUnit = convertBaseToTxn(basePerUnit, fx);
    }
    (cartItem as any).addons = nextAddons;
    setItems(prev => [cartItem, ...prev]);
    setSelectedCartItemId(cartItem.cartItemId);
  };

  const updateLine = (cartItemId: string, next: { quantity?: number; weight?: number; uomCode?: string; uomQtyInBase?: number }) => {
    if (pendingOrderId) return;
    setItems(prev => {
      const updated = prev.map(i => {
        if (i.cartItemId !== cartItemId) return i;
        if (isPromotionLine(i)) return i;
        const isWeight = i.unitType === 'kg' || i.unitType === 'gram';
        const nextQty = isWeight ? 1 : Number(next.quantity ?? i.quantity);
        const nextWeight = isWeight ? Number(next.weight ?? i.weight) : undefined;
        return {
          ...i,
          quantity: isWeight ? 1 : nextQty,
          weight: isWeight ? nextWeight : undefined,
          uomCode: next.uomCode != null ? next.uomCode : i.uomCode,
          uomQtyInBase: next.uomQtyInBase != null ? next.uomQtyInBase : i.uomQtyInBase,
        };
      });

      const removedIds = new Set<string>();
      const filtered = updated.filter(i => {
        const isWeight = i.unitType === 'kg' || i.unitType === 'gram';
        const ok = isWeight ? (Number(i.weight) || 0) > 0 : (Number(i.quantity) || 0) > 0;
        if (!ok) removedIds.add(i.cartItemId);
        return ok;
      });

      if (selectedCartItemId && removedIds.has(selectedCartItemId)) {
        setSelectedCartItemId(filtered[0]?.cartItemId || null);
      }

      return filtered;
    });
  };

  const removeLine = (cartItemId: string) => {
    if (pendingOrderId) return;
    setItems(prev => {
      const next = prev.filter(i => i.cartItemId !== cartItemId);
      if (selectedCartItemId === cartItemId) {
        setSelectedCartItemId(next[0]?.cartItemId || null);
      }
      return next;
    });
  };

  const openAddons = (cartItemId: string) => {
    if (pendingOrderId) return;
    const target = items.find(i => i.cartItemId === cartItemId);
    if (!target) return;
    const defs = ((target as any).addons || []) as Array<{ id: string }>;
    if (!Array.isArray(defs) || defs.length === 0) return;
    const nextDraft: Record<string, number> = {};
    for (const def of defs) {
      const existingQty = Number((target.selectedAddons as any)?.[def.id]?.quantity) || 0;
      nextDraft[def.id] = existingQty;
    }
    setAddonsDraft(nextDraft);
    setAddonsCartItemId(cartItemId);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || '').toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (isTyping) return;
      if (addonsCartItemId) return;
      if (pendingOrderId) return;
      if (!items.length) return;

      const idx = selectedCartItemId ? items.findIndex(i => i.cartItemId === selectedCartItemId) : -1;
      const currentIndex = idx >= 0 ? idx : 0;
      const current = items[currentIndex];
      if (!current) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = Math.min(items.length - 1, currentIndex + 1);
        setSelectedCartItemId(items[nextIndex].cartItemId);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const nextIndex = Math.max(0, currentIndex - 1);
        setSelectedCartItemId(items[nextIndex].cartItemId);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeLine(current.cartItemId);
        return;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        if (current.unitType === 'kg' || current.unitType === 'gram') {
          updateLine(current.cartItemId, { weight: Number(((Number(current.weight) || 0) + 0.1).toFixed(2)) });
          return;
        }
        updateLine(current.cartItemId, { quantity: (Number(current.quantity) || 0) + 1 });
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        if (current.unitType === 'kg' || current.unitType === 'gram') {
          updateLine(current.cartItemId, { weight: Math.max(0, Number(((Number(current.weight) || 0) - 0.1).toFixed(2))) });
          return;
        }
        updateLine(current.cartItemId, { quantity: Math.max(0, (Number(current.quantity) || 0) - 1) });
        return;
      }
      if (e.key === 'a' || e.key === 'A') {
        const defs = ((current as any).addons || []) as any[];
        if (!Array.isArray(defs) || defs.length === 0) return;
        e.preventDefault();
        openAddons(current.cartItemId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [addonsCartItemId, items, openAddons, pendingOrderId, removeLine, selectedCartItemId, updateLine]);

  const openPromotionPicker = () => {
    if (pendingOrderId) return;
    const online = typeof navigator !== 'undefined' && navigator.onLine !== false;
    if (!online) {
      showNotification('لا يمكن إضافة عروض بدون اتصال بالخادم.', 'error');
      return;
    }
    let warehouseId: string;
    try {
      warehouseId = sessionScope.requireScope().warehouseId;
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'تعذر تحديد مستودع الجلسة.', 'error');
      return;
    }
    setPromotionBundleQty(1);
    setPromotionPickerOpen(true);
    void refreshActivePromotions({ customerId: selectedCustomerId, warehouseId });
  };

  const addPromotionLine = async (promotionId: string) => {
    if (pendingOrderId) return;
    const online = typeof navigator !== 'undefined' && navigator.onLine !== false;
    if (!online) {
      showNotification('لا يمكن إضافة عروض بدون اتصال بالخادم.', 'error');
      return;
    }
    let warehouseId: string;
    try {
      warehouseId = sessionScope.requireScope().warehouseId;
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'تعذر تحديد مستودع الجلسة.', 'error');
      return;
    }
    setPromotionBusy(true);
    try {
      const bundleQty = Math.max(1, Math.floor(Number(promotionBundleQty) || 1));
      const snapshot = await applyPromotionToCart({
        promotionId,
        bundleQty,
        customerId: selectedCustomerId,
        warehouseId,
        couponCode: null,
      });
      const perBundle = bundleQty > 0 ? Number(snapshot.finalTotal || 0) / bundleQty : Number(snapshot.finalTotal || 0);
      const promoLine: CartItem = {
        id: String(snapshot.promotionId),
        name: { ar: `عرض: ${String(snapshot.name || '')}`, en: `Promotion: ${String(snapshot.name || '')}` },
        description: { ar: '', en: '' },
        imageUrl: '',
        category: 'promotion',
        price: perBundle,
        unitType: 'bundle',
        quantity: bundleQty,
        selectedAddons: {},
        cartItemId: crypto.randomUUID(),
        unit: 'bundle',
        lineType: 'promotion',
        promotionId: String(snapshot.promotionId),
        promotionLineId: crypto.randomUUID(),
        promotionSnapshot: snapshot,
      };
      (promoLine as any)._pricedByRpc = true;
      setItems((prev) => [promoLine, ...prev]);
      setSelectedCartItemId(promoLine.cartItemId);
      setDiscountType('amount');
      setDiscountValue(0);
      setPromotionPickerOpen(false);
      focusSearch();
    } catch (e) {
      const msg = localizeSupabaseError(e) || (e instanceof Error ? e.message : 'تعذر إضافة العرض.');
      showNotification(msg, 'error');
    } finally {
      setPromotionBusy(false);
    }
  };

  const confirmAddons = () => {
    if (!addonsCartItemId) return;
    setItems(prev => prev.map(it => {
      if (it.cartItemId !== addonsCartItemId) return it;
      const defs = ((it as any).addons || []) as Array<{ id: string; name: any; price: number }>;
      const selected: any = {};
      for (const def of defs) {
        const qty = Math.max(0, Math.floor(Number(addonsDraft[def.id]) || 0));
        if (qty > 0) {
          selected[def.id] = { addon: def, quantity: qty };
        }
      }
      return { ...it, selectedAddons: selected };
    }));
    setAddonsCartItemId(null);
    setAddonsDraft({});
    focusSearch();
  };

  const subtotal = useMemo(() => {
    return items.reduce((total, item) => {
      const addonsPrice = Object.values(item.selectedAddons || {}).reduce(
        (sum: number, entry: any) => sum + (Number(entry.addon?.price) || 0) * (Number(entry.quantity) || 0),
        0
      );
      let itemPrice = item.price;
      let itemQuantity = item.quantity;
      if (item.unitType === 'kg' || item.unitType === 'gram') {
        itemQuantity = item.weight || item.quantity;
        if (item.unitType === 'gram' && item.pricePerUnit) {
          itemPrice = item.pricePerUnit / 1000;
        }
      }
      return total + (itemPrice + addonsPrice) * itemQuantity;
    }, 0);
  }, [items]);

  const discountAmount = useMemo(() => {
    if (subtotal <= 0) return 0;
    if (discountType === 'percent') {
      const pct = Math.max(0, Math.min(100, Number(discountValue) || 0));
      return (pct * subtotal) / 100;
    }
    const amt = Math.max(0, Math.min(subtotal, Number(discountValue) || 0));
    return amt;
  }, [discountType, discountValue, subtotal]);

  const total = useMemo(() => {
    const base = Math.max(0, subtotal - discountAmount);
    return base;
  }, [subtotal, discountAmount]);

  const handleHold = () => {
    if (items.length === 0) return;
    if (pendingOrderId) return;
    if (hasPromotionLines) {
      showNotification('لا يمكن تعليق فاتورة تحتوي عروض.', 'error');
      return;
    }
    if (pricingBusy || !pricingReady) {
      showNotification('لا يمكن تعليق الفاتورة قبل تأكيد التسعير من الخادم.', 'error');
      return;
    }
    const lines = items.map(i => {
      const isWeight = i.unitType === 'kg' || i.unitType === 'gram';
      const addons: Record<string, number> = {};
      Object.entries(i.selectedAddons || {}).forEach(([id, entry]) => {
        const quantity = Number((entry as any)?.quantity) || 0;
        if (quantity > 0) addons[id] = quantity;
      });
      return {
        menuItemId: i.id,
        quantity: isWeight ? undefined : i.quantity,
        weight: isWeight ? (i.weight || 0) : undefined,
        selectedAddons: addons
      };
    });
    createInStorePendingOrder({
      lines,
      currency: transactionCurrency,
      discountType,
      discountValue,
      customerName: customerName.trim() || undefined,
      phoneNumber: phoneNumber.trim() || undefined,
      notes: notes.trim() || undefined,
    }).then(order => {
      setItems([]);
      setDiscountType('amount');
      setDiscountValue(0);
      resetCustomerFields();
      setNotes('');
      setSelectedCartItemId(null);
      setDraftInvoice(null);
      setPendingSelectedId(order.id);
      showNotification('تم تعليق الفاتورة وبدء فاتورة جديدة', 'info');
      void fetchStock();
      focusSearch();
    }).catch(err => {
      const msg = err instanceof Error ? err.message : 'فشل تعليق الفاتورة';
      showNotification(msg, 'error');
    });
  };

  const handleCancelHold = () => {
    if (!pendingOrderId) return;
    cancelInStorePendingOrder(pendingOrderId).then(() => {
      showNotification('تم إلغاء التعليق وإفراج الحجز', 'info');
      void fetchStock();
      if (draftInvoice) {
        const d = draftInvoice;
        setPendingOrderId(null);
        setItems(d.items);
        setDiscountType(d.discountType);
        setDiscountValue(d.discountValue);
        const restoredCurrency = String(d.currency || '').trim().toUpperCase();
        if (restoredCurrency) setTransactionCurrency(restoredCurrency);
        applyCustomerDraft(d.customerName, d.phoneNumber);
        setNotes(d.notes);
        setSelectedCartItemId(d.selectedCartItemId || d.items[0]?.cartItemId || null);
        setDraftInvoice(null);
        setPendingSelectedId(null);
        focusSearch();
        return;
      }
      setPendingOrderId(null);
      setItems([]);
      resetCustomerFields();
      setNotes('');
      setSelectedCartItemId(null);
      setPendingSelectedId(null);
      focusSearch();
    }).catch(err => {
      const msg = err instanceof Error ? err.message : 'فشل إلغاء التعليق';
      showNotification(msg, 'error');
    });
  };

  const pendingTickets = useMemo(() => {
    const list = (orders || [])
      .filter(o => {
        if (!o || o.status !== 'pending' || (o as any).orderSource !== 'in_store') return false;
        const promoLines = (o as any).promotionLines;
        return !(Array.isArray(promoLines) && promoLines.length > 0);
      })
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return list;
  }, [orders]);

  const filteredCustomers = useMemo(() => {
    const qRaw = customerQuery.trim();
    const q = qRaw.toLowerCase();
    if (!q) return [];
    const qCompact = q.replace(/\s+/g, '');
    const qDigits = qRaw.replace(/\D/g, '');
    return customers
      .filter(customer => {
        const name = String(customer.fullName || '').toLowerCase();
        const nameCompact = name.replace(/\s+/g, '');
        const phone = String(customer.phoneNumber || '');
        const phoneLower = phone.toLowerCase();
        const phoneDigits = phone.replace(/\D/g, '');
        const email = String(customer.email || '').toLowerCase();
        const login = String(customer.loginIdentifier || '').toLowerCase();
        const phoneMatches = qDigits
          ? (
            (phoneDigits && phoneDigits.includes(qDigits)) ||
            (qDigits.length >= 6 && phoneDigits && phoneDigits.endsWith(qDigits)) ||
            (qDigits.length >= 6 && phoneDigits && phoneDigits.endsWith(qDigits.slice(-9)))
          )
          : phoneLower.includes(q);
        return (
          name.includes(q) ||
          (qCompact.length >= 2 && nameCompact.includes(qCompact)) ||
          phoneMatches ||
          email.includes(q) ||
          login.includes(q)
        );
      })
      .slice(0, 8);
  }, [customerQuery, customers]);

  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customers.find(customer => customer.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  const filteredPendingTickets = useMemo(() => {
    const q = pendingFilter.trim().toLowerCase();
    if (!q) return pendingTickets;
    return pendingTickets.filter(t => {
      const id = String(t.id || '').toLowerCase();
      const suffix = id.slice(-6);
      const name = String((t as any).customerName || '').toLowerCase();
      const phone = String((t as any).phoneNumber || '').toLowerCase();
      return id.includes(q) || suffix.includes(q) || name.includes(q) || phone.includes(q);
    });
  }, [pendingFilter, pendingTickets]);

  useEffect(() => {
    if (filteredPendingTickets.length === 0) {
      setPendingSelectedId(null);
      return;
    }
    setPendingSelectedId((current) => {
      if (current && filteredPendingTickets.some(t => t.id === current)) return current;
      return filteredPendingTickets[0].id;
    });
  }, [filteredPendingTickets]);

  const openPendingTicket = async (orderId: string) => {
    try {
      const fetcher = typeof fetchRemoteOrderById === 'function' ? fetchRemoteOrderById : null;
      const fresh = fetcher ? await fetcher(orderId).catch(() => undefined) : undefined;
      const ticket = fresh || pendingTickets.find(o => o.id === orderId);
      if (!ticket) {
        showNotification('الطلب غير موجود.', 'error');
        return;
      }
      const st = String((ticket as any)?.status || '');
      if (st && st !== 'pending') {
        if (st === 'delivered') {
          showNotification('هذه الفاتورة ليست معلّقة (تم إتمامها). سيتم فتح الفاتورة.', 'info');
          navigate(`/admin/invoice/${ticket.id}`);
          return;
        }
        if (st === 'cancelled') {
          showNotification('هذه الفاتورة ليست معلّقة (ملغية).', 'info');
          return;
        }
        showNotification('هذه الفاتورة ليست في حالة تعليق.', 'info');
        return;
      }
      if (!pendingOrderId) {
        const hasDraftContent =
          items.length > 0 ||
          Boolean(customerName.trim()) ||
          Boolean(phoneNumber.trim()) ||
          Boolean(notes.trim()) ||
          (Number(discountValue) || 0) > 0;
        if (hasDraftContent) {
          setDraftInvoice({
            items,
            discountType,
            discountValue,
            currency: transactionCurrency,
            customerName,
            phoneNumber,
            notes,
            selectedCartItemId,
          });
        }
      }
      const normalizedItems = ((ticket.items || []) as any[]).map((it: any) => {
        const id = String(it?.id || it?.itemId || it?.menuItemId || '');
        if (!id) return null;
        const cartItemId = String(it?.cartItemId || crypto.randomUUID());
        const selectedAddons = (it?.selectedAddons && typeof it.selectedAddons === 'object') ? it.selectedAddons : {};
        return { ...it, id, cartItemId, selectedAddons } as CartItem;
      }).filter(Boolean) as CartItem[];
      if (normalizedItems.length === 0) {
        showNotification('تعذر فتح الفاتورة: لا توجد أصناف في هذه الفاتورة.', 'error');
        return;
      }
      setPendingOrderId(ticket.id);
      setItems(normalizedItems);
      setDiscountType('amount');
      setDiscountValue(Number((ticket as any).discountAmount) || 0);
      const ticketCurrency = String((ticket as any).currency || '').trim().toUpperCase();
      if (ticketCurrency) setTransactionCurrency(ticketCurrency);
      applyCustomerDraft(String((ticket as any).customerName || ''), String((ticket as any).phoneNumber || ''));
      setNotes(String((ticket as any).notes || ''));
      setSelectedCartItemId(normalizedItems[0]?.cartItemId || null);
      setPendingSelectedId(ticket.id);
      showNotification(`تم تحميل الفاتورة المعلّقة #${ticket.id.slice(-6).toUpperCase()}`, 'info');
      void fetchStock();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'تعذر فتح الفاتورة.', 'error');
    }
  };

  const restoreDraft = () => {
    if (!draftInvoice) return;
    setPendingOrderId(null);
    setItems(draftInvoice.items);
    setDiscountType(draftInvoice.discountType);
    setDiscountValue(draftInvoice.discountValue);
    const restoredCurrency = String(draftInvoice.currency || '').trim().toUpperCase();
    if (restoredCurrency) setTransactionCurrency(restoredCurrency);
    applyCustomerDraft(draftInvoice.customerName, draftInvoice.phoneNumber);
    setNotes(draftInvoice.notes);
    setSelectedCartItemId(draftInvoice.selectedCartItemId || draftInvoice.items[0]?.cartItemId || null);
    setDraftInvoice(null);
    setPendingSelectedId(null);
    showNotification('تمت استعادة الفاتورة السابقة', 'info');
    focusSearch();
  };

  const handleFinalize = (payload: { paymentMethod: string; paymentBreakdown: Array<{ method: string; amount: number; referenceNumber?: string; senderName?: string; senderPhone?: string; declaredAmount?: number; amountConfirmed?: boolean; cashReceived?: number; }> }) => {
    if (items.length === 0) return;
    const breakdown = (payload.paymentBreakdown || []).filter(p => (Number(p.amount) || 0) > 0);
    const hasCash = breakdown.some(p => p.method === 'cash');
    if (!(total > 0)) return;
    if (hasCash && !currentShift) {
      showNotification('لا توجد وردية مفتوحة: الدفع النقدي غير مسموح.', 'error');
      return;
    }
    if (!hasCash && !currentShift) {
      showNotification('تحذير: لا توجد وردية مفتوحة. الدفع غير النقدي مسموح.', 'info');
    }
    const lines = items.map((i: any) => {
      if (isPromotionLine(i)) {
        return {
          promotionId: String(i.promotionId || i.id),
          bundleQty: Number(i.quantity) || 1,
          promotionLineId: i.promotionLineId,
          promotionSnapshot: i.promotionSnapshot,
        };
      }
      const isWeight = i.unitType === 'kg' || i.unitType === 'gram';
      const addons: Record<string, number> = {};
      Object.entries(i.selectedAddons || {}).forEach(([id, entry]) => {
        const quantity = Number((entry as any)?.quantity) || 0;
        if (quantity > 0) addons[id] = quantity;
      });
      return {
        menuItemId: i.id,
        quantity: isWeight ? undefined : i.quantity,
        weight: isWeight ? (i.weight || 0) : undefined,
        selectedAddons: addons
      };
    });
    if (pendingOrderId) {
      resumeInStorePendingOrder(pendingOrderId, {
        paymentMethod: payload.paymentMethod,
        paymentBreakdown: breakdown.map(p => ({
          method: p.method,
          amount: Number(p.amount) || 0,
          referenceNumber: p.referenceNumber,
          senderName: p.senderName,
          senderPhone: p.senderPhone,
          declaredAmount: p.declaredAmount,
          amountConfirmed: p.amountConfirmed,
          cashReceived: p.cashReceived,
        })),
      }).then((order) => {
        setPendingOrderId(null);
        setItems([]);
        resetCustomerFields();
        setNotes('');
        setDraftInvoice(null);
        setPendingSelectedId(null);
        showNotification('تم إتمام الطلب المستأنف', 'success');
        void fetchStock();
        if (autoOpenInvoice && order?.id) {
          const autoThermal = Boolean(settings?.posFlags?.autoPrintThermalEnabled);
          const copies = Number(settings?.posFlags?.thermalCopies) || 1;
          const q = autoThermal ? `?thermal=1&autoprint=1&copies=${copies}` : '';
          navigate(`/admin/invoice/${order.id}${q}`);
        }
        focusSearch();
      }).catch(err => {
        const msg = err instanceof Error ? err.message : 'فشل إتمام الطلب المستأنف';
        showNotification(msg, 'error');
      });
    } else {
      if (discountAmount > 0) {
        if (hasPromotionLines) {
          showNotification('لا يمكن طلب موافقة خصم لفاتورة تحتوي عروض.', 'error');
          return;
        }
        createInStorePendingOrder({
          lines,
          currency: transactionCurrency,
          discountType,
          discountValue,
          customerName: customerName.trim() || undefined,
          phoneNumber: phoneNumber.trim() || undefined,
          notes: notes.trim() || undefined,
        }).then(async (order) => {
          const supabase = getSupabaseClient();
          if (!supabase) throw new Error('Supabase غير مهيأ.');
          const { data: reqId, error: reqErr } = await supabase.rpc('create_approval_request', {
            p_target_table: 'orders',
            p_target_id: order.id,
            p_request_type: 'discount',
            p_amount: discountAmount,
            p_payload: {
              discountType,
              discountValue,
              subtotal,
              discountAmount,
              total,
            },
          });
          if (reqErr) throw reqErr;
          const approvalId = typeof reqId === 'string' ? reqId : String(reqId || '');
          if (!approvalId) throw new Error('تعذر إنشاء طلب موافقة الخصم.');
          const { error: updateErr } = await supabase
            .from('orders')
            .update({
              discount_requires_approval: true,
              discount_approval_status: 'pending',
              discount_approval_request_id: approvalId,
            })
            .eq('id', order.id);
          if (updateErr) throw updateErr;
          setPendingOrderId(order.id);
          setPendingSelectedId(order.id);
          showNotification('تم تعليق الفاتورة وطلب موافقة الخصم. اعتمد الطلب من شاشة الموافقات ثم أكمل الدفع.', 'info');
          focusSearch();
        }).catch(err => {
          const msg = err instanceof Error ? err.message : 'فشل طلب موافقة الخصم';
          showNotification(msg, 'error');
        });
        return;
      }
      createInStoreSale({
        lines,
        currency: transactionCurrency,
        discountType,
        discountValue,
        customerName: customerName.trim() || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        paymentMethod: payload.paymentMethod,
        paymentAmountConfirmed: true, // Auto confirm for POS
        paymentBreakdown: breakdown.map(p => ({
          method: p.method,
          amount: Number(p.amount) || 0,
          referenceNumber: p.referenceNumber,
          senderName: p.senderName,
          senderPhone: p.senderPhone,
          declaredAmount: p.declaredAmount,
          amountConfirmed: p.amountConfirmed,
          cashReceived: p.cashReceived,
        })),
      }).then((order) => {
        const isQueuedOffline = Boolean((order as any)?.offlineState === 'CREATED_OFFLINE');
        const isDelivered = String((order as any)?.status || '') === 'delivered';
        const isPaid = Boolean((order as any)?.paidAt);
        const shouldAutoOpen = Boolean(autoOpenInvoice && order?.id && isDelivered && isPaid && !isQueuedOffline);

        setItems([]);
        resetCustomerFields();
        setNotes('');
        setDraftInvoice(null);
        setPendingSelectedId(null);

        if (isQueuedOffline) {
          showNotification('تم تسجيل البيع بدون اتصال وسيتم خصم المخزون وتحديث التقارير بعد إرسال التحديثات.', 'info');
          if (order?.id) setPendingSelectedId(order.id);
          focusSearch();
          return;
        }

        if (isDelivered && isPaid) {
          showNotification('تم إتمام الطلب مباشرة', 'success');
          if (shouldAutoOpen) {
            const autoThermal = Boolean(settings?.posFlags?.autoPrintThermalEnabled);
            const copies = Number(settings?.posFlags?.thermalCopies) || 1;
            const q = autoThermal ? `?thermal=1&autoprint=1&copies=${copies}` : '';
            navigate(`/admin/invoice/${order.id}${q}`);
          }
          focusSearch();
          return;
        }

        if (isDelivered && !isPaid) {
          showNotification('تم تسجيل البيع لكن التحصيل لم يُسجل بالكامل. افتح إدارة الطلبات لاستكمال التحصيل.', 'info');
          navigate(`/admin/orders?orderId=${order.id}`);
          return;
        }

        showNotification('تم إنشاء الطلب وبانتظار التحصيل.', 'info');
        if (order?.id) setPendingSelectedId(order.id);
        focusSearch();
      }).catch(err => {
        const msg = err instanceof Error ? err.message : 'فشل إتمام الطلب';
        showNotification(msg, 'error');
      });
    }
  };

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="py-4">
        <POSHeaderShiftStatus />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/admin/orders')}
          className="px-4 py-3 rounded-xl border dark:border-gray-700 font-semibold"
        >
          إدارة الطلبات
        </button>
        <button
          type="button"
          onClick={() => {
            if (pendingOrderId) return;
            setItems([]);
            resetCustomerFields();
            setNotes('');
            setDiscountType('amount');
            setDiscountValue(0);
            setDraftInvoice(null);
            setPendingSelectedId(null);
            showNotification('تم بدء فاتورة جديدة', 'info');
            searchInputRef.current?.focus();
          }}
          disabled={Boolean(pendingOrderId)}
          className="px-4 py-3 rounded-xl border dark:border-gray-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          فاتورة جديدة
        </button>
        <button
          type="button"
          onClick={openPromotionPicker}
          disabled={Boolean(pendingOrderId)}
          className="px-4 py-3 rounded-xl border dark:border-gray-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          العروض
        </button>
        {pendingOrderId && draftInvoice && (
          <button
            type="button"
            onClick={restoreDraft}
            className="px-4 py-3 rounded-xl border dark:border-gray-700 font-semibold"
          >
            عودة للفاتورة السابقة
          </button>
        )}
        <div className={`px-3 py-2 rounded-xl border dark:border-gray-700 text-sm font-semibold ${pendingOrderId ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-900' : 'bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-900'}`}>
          {pendingOrderId ? `وضع معلّق: #${pendingOrderId.slice(-6).toUpperCase()}` : 'وضع جديد'}
        </div>
        <label className="flex items-center gap-2 px-3 py-2 rounded-xl border dark:border-gray-700 text-sm font-semibold">
          <input
            type="checkbox"
            checked={touchMode}
            onChange={(e) => setTouchMode(e.target.checked)}
          />
          وضع لمس
        </label>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          Ctrl+K بحث • Ctrl+P معلّق • F8 تعليق • F9 إتمام
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-gray-600 dark:text-gray-300">عملة المعاملة</label>
          <select
            value={transactionCurrency}
            onChange={(e) => setTransactionCurrency(String(e.target.value || '').trim().toUpperCase())}
            disabled={Boolean(pendingOrderId) || pricingBusy}
            className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {operationalCurrencies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div className={`grid grid-cols-1 gap-6 ${touchMode ? 'xl:grid-cols-3 xl:gap-8' : 'lg:grid-cols-3'}`}>
        <div className={`${touchMode ? 'xl:col-span-2' : 'lg:col-span-2'} space-y-6`}>
          <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg ${touchMode ? 'p-6' : 'p-4'}`}>
            <POSItemSearch onAddLine={addLine} inputRef={searchInputRef} disabled={Boolean(pendingOrderId)} touchMode={touchMode} />
          </div>
          <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg ${touchMode ? 'p-6' : 'p-4'}`}>
            <POSLineItemList
              items={items}
              currencyCode={transactionCurrency}
              onUpdate={updateLine}
              onRemove={removeLine}
              onEditAddons={openAddons}
              selectedCartItemId={selectedCartItemId}
              onSelect={setSelectedCartItemId}
              touchMode={touchMode}
              uomOptionsByItemId={itemUomRowsByItemId}
              costSummaryByItemId={costSummaryByItemId}
            />
          </div>
        </div>
        <div className={`${touchMode ? 'xl:col-span-1' : 'lg:col-span-1'} space-y-6`}>
          <div className={`${touchMode ? (isPortrait ? '' : 'xl:sticky xl:top-4') : 'lg:sticky lg:top-4'} space-y-6`}>
            <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg ${touchMode ? 'p-6' : 'p-4'}`}>
              <div className="flex items-center gap-3 mb-3">
                <select
                  value={discountType}
                  onChange={e => setDiscountType(e.target.value as 'amount' | 'percent')}
                  className={`${touchMode ? 'p-4 text-lg' : 'p-2'} border rounded-lg dark:bg-gray-700 dark:border-gray-600`}
                  disabled={Boolean(pendingOrderId) || hasPromotionLines}
                >
                  <option value="amount">خصم مبلغ</option>
                  <option value="percent">خصم نسبة</option>
                </select>
                <input
                  type="number"
                  step={discountType === 'percent' ? '1' : '0.01'}
                  value={discountValue}
                  onChange={e => setDiscountValue(Number(e.target.value) || 0)}
                  className={`flex-1 border rounded-lg dark:bg-gray-700 dark:border-gray-600 ${touchMode ? 'p-4 text-lg' : 'p-2'}`}
                  placeholder={discountType === 'percent' ? '0 - 100' : '0.00'}
                  disabled={Boolean(pendingOrderId) || hasPromotionLines}
                />
              </div>
              <POSTotals subtotal={subtotal} discountAmount={discountAmount} total={total} currencyCode={transactionCurrency} />
            </div>
            <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg ${touchMode ? 'p-6' : 'p-4'}`}>
              <POSPaymentPanel
                key={`pay:${transactionCurrency}:${transactionFxRate}`}
                total={total}
                currencyCode={transactionCurrency}
                canFinalize={items.length > 0 && pricingReady && !pricingBusy}
                blockReason={pricingBlockReason}
                onHold={handleHold}
                onFinalize={handleFinalize}
                pendingOrderId={pendingOrderId}
                onCancelHold={handleCancelHold}
                touchMode={touchMode}
              />
            </div>
          </div>
          <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg ${touchMode ? 'p-6' : 'p-4'}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-bold dark:text-white">الفواتير المعلّقة</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{pendingTickets.length}</div>
            </div>
            <input
              ref={pendingFilterRef}
              value={pendingFilter}
              onChange={(e) => setPendingFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (filteredPendingTickets.length === 0) return;
                  const idx = pendingSelectedId ? filteredPendingTickets.findIndex(t => t.id === pendingSelectedId) : -1;
                  const next = Math.min(filteredPendingTickets.length - 1, (idx >= 0 ? idx : 0) + 1);
                  setPendingSelectedId(filteredPendingTickets[next].id);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (filteredPendingTickets.length === 0) return;
                  const idx = pendingSelectedId ? filteredPendingTickets.findIndex(t => t.id === pendingSelectedId) : -1;
                  const next = Math.max(0, (idx >= 0 ? idx : 0) - 1);
                  setPendingSelectedId(filteredPendingTickets[next].id);
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const targetId = pendingSelectedId || filteredPendingTickets[0]?.id;
                  if (targetId) void openPendingTicket(targetId);
                }
              }}
              className={`w-full border rounded-lg dark:bg-gray-700 dark:border-gray-600 mb-2 ${touchMode ? 'p-4 text-lg' : 'p-2'}`}
              placeholder="بحث: رقم / اسم / هاتف"
            />
            {pendingTickets.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-300">لا توجد فواتير معلّقة.</div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {filteredPendingTickets.slice(0, 25).map(t => (
                  <div
                    key={t.id}
                    onClick={() => setPendingSelectedId(t.id)}
                    className={`p-2 border rounded-lg dark:border-gray-700 flex items-center justify-between gap-2 cursor-pointer ${pendingSelectedId === t.id ? 'ring-2 ring-primary-500 border-primary-500' : ''}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold dark:text-white truncate">#{t.id.slice(-6).toUpperCase()}</div>
                        {pendingOrderId === t.id && (
                          <div className="text-[11px] px-2 py-1 rounded-full bg-primary-500 text-white">مفتوحة</div>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        <CurrencyDualAmount
                          amount={Number(t.total || 0)}
                          currencyCode={String((t as any)?.currency || '')}
                          baseAmount={undefined}
                          fxRate={undefined}
                          compact
                        />
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {String((t as any).customerName || 'زبون حضوري')}
                        {String((t as any).phoneNumber || '') ? ` • ${String((t as any).phoneNumber)}` : ''}
                        {t.createdAt ? ` • ${new Date(t.createdAt).toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openPendingTicket(t.id);
                        }}
                        className={`${touchMode ? 'px-5 py-4 text-base' : 'px-3 py-2 text-sm'} rounded-lg border dark:border-gray-700 font-semibold ${pendingOrderId === t.id ? 'bg-primary-500 text-white border-primary-500' : ''}`}
                      >
                        فتح
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void (async () => {
                            try {
                              const fetcher = typeof fetchRemoteOrderById === 'function' ? fetchRemoteOrderById : null;
                              const fresh = fetcher ? await fetcher(t.id).catch(() => undefined) : undefined;
                              const st = String((fresh as any)?.status || '');
                              if (fresh && st && st !== 'pending') {
                                if (st === 'delivered') {
                                  showNotification('لا يمكن إلغاء فاتورة تم إتمامها. سيتم فتح الفاتورة.', 'info');
                                  navigate(`/admin/invoice/${t.id}`);
                                  return;
                                }
                                showNotification('لا يمكن إلغاء هذه الفاتورة لأنها ليست معلّقة.', 'error');
                                return;
                              }
                              await cancelInStorePendingOrder(t.id);
                              showNotification('تم إلغاء التعليق وإفراج الحجز', 'info');
                              void fetchStock();
                              if (pendingOrderId === t.id) {
                                if (draftInvoice) {
                                  restoreDraft();
                                } else {
                                  setPendingOrderId(null);
                                  setItems([]);
                                  resetCustomerFields();
                                  setNotes('');
                                  setSelectedCartItemId(null);
                                  setPendingSelectedId(null);
                                  focusSearch();
                                }
                              }
                            } catch (err) {
                              showNotification(err instanceof Error ? err.message : 'فشل إلغاء التعليق', 'error');
                            }
                          })();
                        }}
                        className={`${touchMode ? 'px-5 py-4 text-base' : 'px-3 py-2 text-sm'} rounded-lg bg-red-500 text-white font-semibold`}
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {filteredPendingTickets.length > 25 && (
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">يتم عرض أول 25 فاتورة.</div>
            )}
          </div>
          <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg space-y-3 ${touchMode ? 'p-6' : 'p-4'}`}>
            <div className="flex items-center justify-between">
              <div className="font-bold dark:text-white">بيانات الفاتورة</div>
              <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={autoOpenInvoice}
                  onChange={(e) => setAutoOpenInvoice(e.target.checked)}
                />
                فتح بعد الإتمام
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="sm:col-span-2">
                <div className="relative">
                  <input
                    value={customerQuery}
                    onChange={(e) => {
                      setCustomerQuery(e.target.value);
                      setSelectedCustomerId(null);
                    }}
                    onFocus={() => setCustomerDropdownOpen(true)}
                    onBlur={() => window.setTimeout(() => setCustomerDropdownOpen(false), 150)}
                    className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                    placeholder="بحث عميل بالاسم أو الهاتف"
                    disabled={Boolean(pendingOrderId)}
                  />
                  {customerDropdownOpen && customerQuery.trim() !== '' && (
                    <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-600 shadow-lg">
                      {filteredCustomers.length > 0 ? (
                        filteredCustomers.map(customer => {
                          const title = customer.fullName || customer.phoneNumber || 'غير معروف';
                          const meta = [customer.phoneNumber, customer.email].filter(Boolean).join(' • ');
                          return (
                            <button
                              key={customer.id}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleCustomerSelect(customer)}
                              className="w-full px-3 py-2 text-right hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              <div className="font-semibold truncate dark:text-white">{title}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{meta}</div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">لا نتائج</div>
                      )}
                    </div>
                  )}
                  {selectedCustomer && (
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      عميل مختار: {selectedCustomer.fullName || selectedCustomer.phoneNumber || selectedCustomer.email || selectedCustomer.loginIdentifier || ''}
                    </div>
                  )}
                </div>
              </div>
              <input
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setSelectedCustomerId(null);
                }}
                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                placeholder="اسم العميل"
                disabled={Boolean(pendingOrderId)}
              />
              <input
                value={phoneNumber}
                onChange={(e) => {
                  setPhoneNumber(e.target.value);
                  setSelectedCustomerId(null);
                }}
                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                placeholder="الهاتف"
                disabled={Boolean(pendingOrderId)}
              />
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              placeholder="ملاحظات"
              rows={2}
              disabled={Boolean(pendingOrderId)}
            />
          </div>
        </div>
      </div>
      <ConfirmationModal
        isOpen={Boolean(addonsCartItemId)}
        onClose={() => {
          setAddonsCartItemId(null);
          setAddonsDraft({});
        }}
        onConfirm={confirmAddons}
        title="إضافات الصنف"
        message=""
        confirmText="حفظ"
        confirmingText="جاري الحفظ..."
        confirmButtonClassName="bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300"
      >
        {(() => {
          const target = items.find(i => i.cartItemId === addonsCartItemId);
          const defs = ((target as any)?.addons || []) as Array<{ id: string; name?: any; price: number }>;
          if (!target || !Array.isArray(defs) || defs.length === 0) {
            return <div className="text-sm text-gray-600 dark:text-gray-300">لا توجد إضافات لهذا الصنف.</div>;
          }
          return (
            <div className="space-y-2">
              {defs.map(def => {
                const label = (def as any)?.name?.ar || (def as any)?.name?.en || def.id;
                const qty = Number(addonsDraft[def.id]) || 0;
                return (
                  <div key={def.id} className="flex items-center justify-between gap-3 p-2 border rounded-lg dark:border-gray-700">
                    <div className="min-w-0">
                      <div className="font-semibold dark:text-white truncate">{label}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        <CurrencyDualAmount amount={Number(def.price) || 0} currencyCode={transactionCurrency} compact />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAddonsDraft(prev => ({ ...prev, [def.id]: Math.max(0, (Number(prev[def.id]) || 0) - 1) }))}
                        className="px-3 py-2 rounded-lg border dark:border-gray-700"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={qty}
                        onChange={(e) => setAddonsDraft(prev => ({ ...prev, [def.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
                        className="w-20 p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-center"
                      />
                      <button
                        type="button"
                        onClick={() => setAddonsDraft(prev => ({ ...prev, [def.id]: (Number(prev[def.id]) || 0) + 1 }))}
                        className="px-3 py-2 rounded-lg border dark:border-gray-700"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </ConfirmationModal>
      {promotionPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-gray-800 shadow-xl border dark:border-gray-700 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="font-bold dark:text-white">العروض المتاحة</div>
              <button
                type="button"
                onClick={() => setPromotionPickerOpen(false)}
                className="px-3 py-2 rounded-lg border dark:border-gray-700 font-semibold"
                disabled={promotionBusy}
              >
                إغلاق
              </button>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <div className="text-sm text-gray-600 dark:text-gray-300">عدد الباقات</div>
              <input
                type="number"
                min={1}
                step={1}
                value={promotionBundleQty}
                onChange={(e) => setPromotionBundleQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className="w-32 p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                disabled={promotionBusy}
              />
              <button
                type="button"
                onClick={() => {
                  let warehouseId: string;
                  try {
                    warehouseId = sessionScope.requireScope().warehouseId;
                  } catch (e) {
                    showNotification(e instanceof Error ? e.message : 'تعذر تحديد مستودع الجلسة.', 'error');
                    return;
                  }
                  void refreshActivePromotions({ customerId: selectedCustomerId, warehouseId });
                }}
                className="px-3 py-2 rounded-lg border dark:border-gray-700 font-semibold"
                disabled={promotionBusy}
              >
                تحديث
              </button>
            </div>
            {activePromotions.length === 0 ? (
              <div className="text-sm text-gray-600 dark:text-gray-300">لا توجد عروض نشطة حالياً.</div>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {activePromotions.map((p) => (
                  <div key={p.promotionId} className="p-3 border rounded-xl dark:border-gray-700 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold truncate dark:text-white">{p.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        <CurrencyDualAmount
                          amount={Number(p.finalTotal || 0)}
                          currencyCode={String((p as any)?.currency || '')}
                          baseAmount={undefined}
                          fxRate={undefined}
                          compact
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void addPromotionLine(p.promotionId)}
                      disabled={promotionBusy}
                      className="px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      إضافة
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default POSScreen;
