import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect, useRef } from 'react';
import type { MenuItem } from '../types';
import { getSupabaseClient } from '../supabase';
import { logger } from '../utils/logger';
import { isAbortLikeError, localizeSupabaseError } from '../utils/errorUtils';

const normalizeCategoryKey = (value: unknown) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.toLowerCase();
};

interface MenuContextType {
  menuItems: MenuItem[];
  loading: boolean;
  fetchMenuItems: () => Promise<void>;
  addMenuItem: (item: Omit<MenuItem, 'id'>) => Promise<MenuItem>;
  updateMenuItem: (item: MenuItem) => Promise<MenuItem>;
  deleteMenuItem: (itemId: string) => Promise<void>;
  getMenuItemById: (itemId: string) => MenuItem | undefined;
}

const MenuContext = createContext<MenuContextType | undefined>(undefined);

export const MenuProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const MAX_SNAPSHOT_AGE_MS = 5 * 60 * 1000;

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const didInitialFetchRef = useRef(false);
  const lastSnapshotRef = useRef<{ items: MenuItem[]; ts: number }>({ items: [], ts: 0 });

  const fetchMenuItems = useCallback(async () => {
    setLoading(true);
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('لا يوجد اتصال بالإنترنت');
      }
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase غير مهيأ');
      }
      const conn: any = (typeof navigator !== 'undefined' && (navigator as any).connection) ? (navigator as any).connection : null;
      const eff: string = typeof conn?.effectiveType === 'string' ? conn.effectiveType : '';
      const isSlow = eff === 'slow-2g' || eff === '2g';
      let isStaff = false;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session) {
          const { data: staffFlag } = await supabase.rpc('is_staff');
          isStaff = Boolean(staffFlag);
        }
      } catch {}

      const source = isStaff ? 'menu_items' : 'v_sellable_products';
      const selectCols = isStaff
        ? (isSlow
          ? 'id, name, barcode, price, base_unit, is_food, expiry_required, sellable, status, category, data'
          : 'id, name, barcode, price, base_unit, is_food, expiry_required, sellable, category, is_featured, freshness_level, status, cost_price, buying_price, transport_cost, supply_tax_cost, data')
        : (isSlow
          ? 'id, name, barcode, price, base_unit, is_food, expiry_required, sellable, status, category, data, available_quantity'
          : 'id, name, barcode, price, base_unit, is_food, expiry_required, sellable, category, is_featured, freshness_level, status, data, available_quantity');
      const { data: rows, error: rowsError } = await supabase
        .from(source)
        .select(selectCols);
      if (rowsError) throw rowsError;
      const ids = (rows || []).map((r: any) => (typeof r?.id === 'string' ? r.id : null)).filter(Boolean) as string[];
      let stockMap: Record<string, { available_quantity?: number; reserved_quantity?: number }> = {};
      if (isStaff && !isSlow && ids.length > 0) {
        try {
          const { data: stockRows } = await supabase
            .from('stock_management')
            .select('item_id, available_quantity, reserved_quantity')
            .in('item_id', ids);
          for (const r of stockRows || []) {
            const k = typeof (r as any)?.item_id === 'string' ? (r as any).item_id : '';
            if (k) stockMap[k] = { available_quantity: (r as any)?.available_quantity, reserved_quantity: (r as any)?.reserved_quantity };
          }
        } catch {}
      }
      const items = (rows || [])
        .map((row: any) => {
          const raw = row?.data as MenuItem;
          const remoteId: string | undefined = typeof row?.id === 'string' ? row.id : undefined;
          const item = raw && typeof raw === 'object' ? raw : undefined;
          if (!item || typeof item !== 'object') return undefined;
          const mergedId = remoteId || item.id;
          const nameObj: any = row?.name && typeof row.name === 'object'
            ? row.name
            : ((item as any).name && typeof (item as any).name === 'object' ? (item as any).name : {});
          const descObj: any = (item as any).description && typeof (item as any).description === 'object' ? (item as any).description : {};
          const safeName = {
            ar: typeof nameObj?.ar === 'string' ? nameObj.ar : '',
            en: typeof nameObj?.en === 'string' ? nameObj.en : '',
          };
          const safeDescription = {
            ar: typeof descObj?.ar === 'string' ? descObj.ar : '',
            en: typeof descObj?.en === 'string' ? descObj.en : '',
          };
          const smObj: any = mergedId ? stockMap[mergedId] || null : null;
          const availableStock = isStaff
            ? (Number.isFinite(Number(smObj?.available_quantity))
              ? Number(smObj.available_quantity)
              : Number(item.availableStock || 0))
            : (Number.isFinite(Number(row?.available_quantity))
              ? Number(row.available_quantity)
              : Number(item.availableStock || 0));
          const costPrice = Number.isFinite(Number(row?.cost_price)) ? Number(row.cost_price) : (Number(item.costPrice) || 0);
          const buyingPrice = Number.isFinite(Number(row?.buying_price)) ? Number(row.buying_price) : (Number(item.buyingPrice) || 0);
          const transportCost = Number.isFinite(Number(row?.transport_cost)) ? Number(row.transport_cost) : (Number(item.transportCost) || 0);
          const supplyTaxCost = Number.isFinite(Number(row?.supply_tax_cost)) ? Number(row.supply_tax_cost) : (Number(item.supplyTaxCost) || 0);
          const reservedQuantity = isStaff && Number.isFinite(Number(smObj?.reserved_quantity)) ? Number(smObj.reserved_quantity) : 0;

          const mergedCategory = typeof row?.category === 'string' ? row.category : item.category;
          const mergedStatus = typeof row?.status === 'string' ? row.status : item.status;
          const mergedUnitType = typeof row?.base_unit === 'string'
            ? row.base_unit
            : item.unitType;
          const mergedFreshness = typeof row?.freshness_level === 'string' ? row.freshness_level : item.freshnessLevel;
          const mergedIsFeatured = typeof row?.is_featured === 'boolean' ? row.is_featured : Boolean(item.isFeatured ?? false);
          const normalizedCategory = normalizeCategoryKey(mergedCategory) || String(mergedCategory || '');
          const normalizedPrice = Number.isFinite(Number(row?.price))
            ? Number(row.price)
            : (Number.isFinite(Number((item as any)?.price)) ? Number((item as any).price) : 0);
          const mergedBarcode = typeof row?.barcode === 'string' ? row.barcode : (typeof (item as any)?.barcode === 'string' ? (item as any).barcode : '');

          return {
            ...item,
            id: mergedId,
            category: normalizedCategory,
            status: mergedStatus,
            unitType: mergedUnitType,
            freshnessLevel: mergedFreshness,
            isFeatured: mergedIsFeatured,
            price: normalizedPrice,
            costPrice,
            buyingPrice,
            transportCost,
            supplyTaxCost,
            availableStock,
            reservedQuantity,
            barcode: mergedBarcode || undefined,
            name: safeName,
            description: safeDescription,
          };
        })
        .filter(Boolean) as MenuItem[];
      setMenuItems(items);
      lastSnapshotRef.current = { items, ts: Date.now() };
    } catch (error) {
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isOffline || isAbortLikeError(error)) {
        const snap = lastSnapshotRef.current;
        const fresh = snap.ts > 0 && (Date.now() - snap.ts <= MAX_SNAPSHOT_AGE_MS);
        setMenuItems(fresh ? snap.items : []);
        return;
      }
      const msg = localizeSupabaseError(error);
      if (msg) logger.error(msg);
      setMenuItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (didInitialFetchRef.current) return;
    didInitialFetchRef.current = true;
    fetchMenuItems();
  }, [fetchMenuItems]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      fetchMenuItems();
    });
    return () => {
      sub?.subscription?.unsubscribe();
    };
  }, [fetchMenuItems]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOffline = () => {
      const snap = lastSnapshotRef.current;
      const fresh = snap.ts > 0 && (Date.now() - snap.ts <= MAX_SNAPSHOT_AGE_MS);
      setMenuItems(fresh ? snap.items : []);
    };
    window.addEventListener('offline', onOffline);
    return () => window.removeEventListener('offline', onOffline);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const channel = supabase
      .channel('public:menu_items')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'menu_items' },
        async () => {
          await fetchMenuItems();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchMenuItems]);


  const addMenuItem = async (item: Omit<MenuItem, 'id'>): Promise<MenuItem> => {
    const ar = (item.name?.ar || '').trim().toLowerCase();
    const en = (item.name?.en || '').trim().toLowerCase();
    const exists = menuItems.some(m => {
      const mar = (m.name?.ar || '').trim().toLowerCase();
      const men = (m.name?.en || '').trim().toLowerCase();
      return (ar && mar === ar) || (en && men === en);
    });
    if (exists) {
      throw new Error('يوجد صنف بنفس الاسم');
    }
    const normalizedCategory = normalizeCategoryKey(item.category);
    const newItem = {
      ...item,
      id: crypto.randomUUID(),
      status: item.status || 'active',
      category: normalizedCategory || String(item.category || ''),
    };
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const baseUnit = typeof newItem.unitType === 'string' ? newItem.unitType : 'piece';
        const isFood = String(newItem.category || '').toLowerCase() === 'food';
        const explicitSellable = typeof (newItem as any).sellable === 'boolean' ? (newItem as any).sellable : true;
        const explicitExpiryRequired = typeof (newItem as any).expiryRequired === 'boolean' ? (newItem as any).expiryRequired : isFood;
        const explicitIsFood = typeof (newItem as any).isFood === 'boolean' ? (newItem as any).isFood : isFood;
        const { error } = await supabase.from('menu_items').insert({
          id: newItem.id,
          category: newItem.category,
          is_featured: Boolean(newItem.isFeatured ?? false),
          unit_type: typeof newItem.unitType === 'string' ? newItem.unitType : null,
          base_unit: baseUnit,
          name: newItem.name,
          barcode: (newItem as any).barcode || null,
          price: Number(newItem.price) || 0,
          is_food: explicitIsFood,
          expiry_required: explicitExpiryRequired,
          sellable: explicitSellable,
          freshness_level: typeof newItem.freshnessLevel === 'string' ? newItem.freshnessLevel : null,
          status: newItem.status,
          cost_price: Number(newItem.costPrice) || 0,
          buying_price: Number(newItem.buyingPrice) || 0,
          transport_cost: Number(newItem.transportCost) || 0,
          supply_tax_cost: Number(newItem.supplyTaxCost) || 0,
          data: newItem,
        });
        if (error) throw error;
      } catch (err) {
        throw new Error(localizeSupabaseError(err));
      }
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchMenuItems();
    return newItem;
  };

  const updateMenuItem = async (updatedItem: MenuItem): Promise<MenuItem> => {
    const normalizedCategory = normalizeCategoryKey(updatedItem.category);
    const normalizedItem: MenuItem = { ...updatedItem, category: normalizedCategory || String(updatedItem.category || '') };
    const ar = (updatedItem.name?.ar || '').trim().toLowerCase();
    const en = (updatedItem.name?.en || '').trim().toLowerCase();
    const exists = menuItems.some(m => {
      if (m.id === updatedItem.id) return false;
      const mar = (m.name?.ar || '').trim().toLowerCase();
      const men = (m.name?.en || '').trim().toLowerCase();
      return (ar && mar === ar) || (en && men === en);
    });
    if (exists) {
      throw new Error('يوجد صنف بنفس الاسم');
    }
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const baseUnit = typeof normalizedItem.unitType === 'string' ? normalizedItem.unitType : 'piece';
        const isFood = String(normalizedItem.category || '').toLowerCase() === 'food';
        const explicitSellable = typeof (normalizedItem as any).sellable === 'boolean' ? (normalizedItem as any).sellable : undefined;
        const explicitExpiryRequired = typeof (normalizedItem as any).expiryRequired === 'boolean' ? (normalizedItem as any).expiryRequired : undefined;
        const explicitIsFood = typeof (normalizedItem as any).isFood === 'boolean' ? (normalizedItem as any).isFood : undefined;
        const { error } = await supabase.from('menu_items').upsert(
          {
            id: normalizedItem.id,
            category: normalizedItem.category,
            is_featured: Boolean(normalizedItem.isFeatured ?? false),
            unit_type: typeof normalizedItem.unitType === 'string' ? normalizedItem.unitType : null,
            base_unit: baseUnit,
            name: normalizedItem.name,
            barcode: (normalizedItem as any).barcode || null,
            price: Number(normalizedItem.price) || 0,
            is_food: explicitIsFood ?? isFood,
            expiry_required: explicitExpiryRequired,
            sellable: explicitSellable,
            freshness_level: typeof normalizedItem.freshnessLevel === 'string' ? normalizedItem.freshnessLevel : null,
            status: normalizedItem.status,
            cost_price: Number(normalizedItem.costPrice) || 0,
            buying_price: Number(normalizedItem.buyingPrice) || 0,
            transport_cost: Number(normalizedItem.transportCost) || 0,
            supply_tax_cost: Number(normalizedItem.supplyTaxCost) || 0,
            data: normalizedItem,
          },
          { onConflict: 'id' }
        );
        if (error) throw error;
      } catch (err) {
        throw new Error(localizeSupabaseError(err));
      }
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchMenuItems();
    return normalizedItem;
  };

  const deleteMenuItem = async (itemId: string) => {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data: stockRows, error: stockErr } = await supabase
          .from('stock_management')
          .select('available_quantity, reserved_quantity')
          .eq('item_id', itemId)
          .limit(50);
        if (stockErr) throw stockErr;
        const hasAnyQty = (stockRows || []).some((r: any) => (Number(r?.available_quantity) || 0) > 0 || (Number(r?.reserved_quantity) || 0) > 0);
        if (hasAnyQty) {
          throw new Error('لا يمكن أرشفة الصنف: توجد كميات متاحة/محجوزة في المخزون.');
        }
        const { error } = await supabase
          .from('menu_items')
          .update({ status: 'archived' })
          .eq('id', itemId);
        if (error) throw error;
      } catch (err) {
        throw new Error(localizeSupabaseError(err));
      }
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchMenuItems();
  };

  const getMenuItemById = (itemId: string) => {
    return menuItems.find(item => item.id === itemId);
  };

  return (
    <MenuContext.Provider value={{ menuItems, loading, fetchMenuItems, addMenuItem, updateMenuItem, deleteMenuItem, getMenuItemById }}>
      {children}
    </MenuContext.Provider>
  );
};

export const useMenu = () => {
  const context = useContext(MenuContext);
  if (context === undefined) {
    throw new Error('useMenu must be used within a MenuProvider');
  }
  return context;
};
