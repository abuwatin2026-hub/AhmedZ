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
      const selectCols = isSlow
        ? 'id,data'
        : 'id, category, is_featured, unit_type, freshness_level, status, cost_price, buying_price, transport_cost, supply_tax_cost, data';
      const { data: rows, error: rowsError } = await supabase
        .from('menu_items')
        .select(selectCols);
      if (rowsError) throw rowsError;
      const ids = (rows || []).map((r: any) => (typeof r?.id === 'string' ? r.id : null)).filter(Boolean) as string[];
      let stockMap: Record<string, { available_quantity?: number; reserved_quantity?: number }> = {};
      if (!isSlow && ids.length > 0) {
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
          const smObj: any = mergedId ? stockMap[mergedId] || null : null;
          const availableStock = Number.isFinite(Number(smObj?.available_quantity))
            ? Number(smObj.available_quantity)
            : Number(item.availableStock || 0);
          const costPrice = Number.isFinite(Number(row?.cost_price)) ? Number(row.cost_price) : (Number(item.costPrice) || 0);
          const buyingPrice = Number.isFinite(Number(row?.buying_price)) ? Number(row.buying_price) : (Number(item.buyingPrice) || 0);
          const transportCost = Number.isFinite(Number(row?.transport_cost)) ? Number(row.transport_cost) : (Number(item.transportCost) || 0);
          const supplyTaxCost = Number.isFinite(Number(row?.supply_tax_cost)) ? Number(row.supply_tax_cost) : (Number(item.supplyTaxCost) || 0);
          const reservedQuantity = Number.isFinite(Number(smObj?.reserved_quantity)) ? Number(smObj.reserved_quantity) : 0;

          const mergedCategory = typeof row?.category === 'string' ? row.category : item.category;
          const mergedStatus = typeof row?.status === 'string' ? row.status : item.status;
          const mergedUnitType = typeof row?.unit_type === 'string' ? row.unit_type : item.unitType;
          const mergedFreshness = typeof row?.freshness_level === 'string' ? row.freshness_level : item.freshnessLevel;
          const mergedIsFeatured = typeof row?.is_featured === 'boolean' ? row.is_featured : Boolean(item.isFeatured ?? false);
          const normalizedCategory = normalizeCategoryKey(mergedCategory) || String(mergedCategory || '');
          const normalizedPrice = Number.isFinite(Number((item as any)?.price)) ? Number((item as any).price) : 0;

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
        const { error } = await supabase.from('menu_items').insert({
          id: newItem.id,
          category: newItem.category,
          is_featured: Boolean(newItem.isFeatured ?? false),
          unit_type: typeof newItem.unitType === 'string' ? newItem.unitType : null,
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
        const { error } = await supabase.from('menu_items').upsert(
          {
            id: normalizedItem.id,
            category: normalizedItem.category,
            is_featured: Boolean(normalizedItem.isFeatured ?? false),
            unit_type: typeof normalizedItem.unitType === 'string' ? normalizedItem.unitType : null,
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
