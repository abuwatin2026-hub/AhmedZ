import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FreshnessLevel, FreshnessLevelDef, ItemCategoryDef, LocalizedString, UnitType, UnitTypeDef } from '../types';
import { useAuth } from './AuthContext';
import { getSupabaseClient } from '../supabase';
import { localizeSupabaseError } from '../utils/errorUtils';

type MetaLoadingState = {
  categories: boolean;
  unitTypes: boolean;
  freshnessLevels: boolean;
};

interface ItemMetaContextType {
  categories: ItemCategoryDef[];
  unitTypes: UnitTypeDef[];
  freshnessLevels: FreshnessLevelDef[];
  loading: boolean;
  fetchAll: () => Promise<void>;

  addCategory: (data: { key: string; name: LocalizedString; isActive?: boolean }) => Promise<void>;
  updateCategory: (data: ItemCategoryDef) => Promise<void>;
  deleteCategory: (categoryId: string) => Promise<void>;

  addUnitType: (data: { key: UnitType; label: LocalizedString; isActive?: boolean; isWeightBased?: boolean }) => Promise<void>;
  updateUnitType: (data: UnitTypeDef) => Promise<void>;
  deleteUnitType: (unitTypeId: string) => Promise<void>;

  addFreshnessLevel: (data: { key: FreshnessLevel; label: LocalizedString; isActive?: boolean; tone?: FreshnessLevelDef['tone'] }) => Promise<void>;
  updateFreshnessLevel: (data: FreshnessLevelDef) => Promise<void>;
  deleteFreshnessLevel: (freshnessLevelId: string) => Promise<void>;

  getCategoryLabel: (categoryKey: string, language: 'ar' | 'en') => string;
  getUnitLabel: (unitKey: UnitType | undefined, language: 'ar' | 'en') => string;
  getFreshnessLabel: (freshnessKey: FreshnessLevel | undefined, language: 'ar' | 'en') => string;
  getFreshnessTone: (freshnessKey: FreshnessLevel | undefined) => FreshnessLevelDef['tone'] | undefined;
  isWeightBasedUnit: (unitKey: UnitType | undefined) => boolean;
}

const ItemMetaContext = createContext<ItemMetaContextType | undefined>(undefined);

const normalizeKey = (value: string) => value.trim();

const normalizeLookupKey = (value: string) => {
  const raw = value.trim();
  if (!raw) return '';
  return raw.toLowerCase();
};

const nowIso = () => new Date().toISOString();

export const ItemMetaProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [categories, setCategories] = useState<ItemCategoryDef[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitTypeDef[]>([]);
  const [freshnessLevels, setFreshnessLevels] = useState<FreshnessLevelDef[]>([]);
  const [loadingState, setLoadingState] = useState<MetaLoadingState>({ categories: true, unitTypes: true, freshnessLevels: true });
  const { hasPermission } = useAuth();

  const loading = loadingState.categories || loadingState.unitTypes || loadingState.freshnessLevels;

  const isInvalidJwt = (error: unknown) => {
    const msg = String((error as any)?.message || '');
    const raw = msg.toLowerCase();
    return raw.includes('invalid jwt') || raw.includes('jwt expired') || raw.includes('refresh token not found');
  };

  const ensureCanManage = () => {
    if (!hasPermission('items.manage')) {
      throw new Error('ليس لديك صلاحية تنفيذ هذا الإجراء.');
    }
  };

  const fetchAll = useCallback(async () => {
    setLoadingState({ categories: true, unitTypes: true, freshnessLevels: true });
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setCategories([]);
        setUnitTypes([]);
        setFreshnessLevels([]);
        return;
      }
      const [
        { data: rowsCategories, error: rowsCategoryError },
        { data: rowsUnitTypes, error: rowsUnitError },
        { data: rowsFreshness, error: rowsFreshnessError },
      ] = await Promise.all([
        supabase.from('item_categories').select('id,data'),
        supabase.from('unit_types').select('id,data'),
        supabase.from('freshness_levels').select('id,data'),
      ]);
      if (rowsCategoryError) throw rowsCategoryError;
      if (rowsUnitError) throw rowsUnitError;
      if (rowsFreshnessError) throw rowsFreshnessError;

      const allCategories = (rowsCategories || []).map(row => row.data as ItemCategoryDef).filter(Boolean);
      const allUnitTypes = (rowsUnitTypes || []).map(row => row.data as UnitTypeDef).filter(Boolean);
      const allFreshnessLevels = (rowsFreshness || []).map(row => row.data as FreshnessLevelDef).filter(Boolean);

      setCategories(allCategories.sort((a, b) => a.key.localeCompare(b.key)));
      setUnitTypes(allUnitTypes.sort((a, b) => String(a.key).localeCompare(String(b.key))));
      setFreshnessLevels(allFreshnessLevels.sort((a, b) => String(a.key).localeCompare(String(b.key))));
    } catch (err) {
      const supabase = getSupabaseClient();
      if (supabase && isInvalidJwt(err)) {
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch {}
      }
      setCategories([]);
      setUnitTypes([]);
      setFreshnessLevels([]);
    } finally {
      setLoadingState({ categories: false, unitTypes: false, freshnessLevels: false });
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const addCategory = async (data: { key: string; name: LocalizedString; isActive?: boolean }) => {
    ensureCanManage();
    const key = normalizeKey(data.key);
    if (!key) throw new Error('الفئة مطلوبة.');
    const now = nowIso();
    const existing = categories.find(c => c.key === key);
    if (existing) throw new Error('هذه الفئة موجودة مسبقًا.');
    const record: ItemCategoryDef = { id: crypto.randomUUID(), key, name: data.name, isActive: data.isActive ?? true, createdAt: now, updatedAt: now };
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('item_categories').insert({ id: record.id, key: record.key, is_active: record.isActive, data: record });
      if (error) throw new Error(localizeSupabaseError(error));
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchAll();
  };

  const updateCategory = async (data: ItemCategoryDef) => {
    ensureCanManage();
    const nextKey = normalizeKey(data.key);
    if (!nextKey) throw new Error('الفئة مطلوبة.');
    const existing = categories.find(c => c.key === nextKey);
    if (existing && existing.id !== data.id) throw new Error('هذه الفئة موجودة مسبقًا.');
    const next = { ...data, key: nextKey, updatedAt: nowIso() };
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase
        .from('item_categories')
        .upsert({ id: next.id, key: next.key, is_active: next.isActive, data: next }, { onConflict: 'id' });
      if (error) throw new Error(localizeSupabaseError(error));
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchAll();
  };

  const deleteCategory = async (categoryId: string) => {
    ensureCanManage();
    const target = categories.find(c => c.id === categoryId);
    if (!target) return;
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');

    const { data: usedRows, count: usedCount, error: usedError } = await supabase
      .from('menu_items')
      .select('id', { count: 'exact' })
      .eq('category', target.key)
      .limit(1);
    if (usedError) throw new Error(localizeSupabaseError(usedError));
    const usedAny = (typeof usedCount === 'number' ? usedCount : (usedRows?.length || 0)) > 0;
    if (usedAny) throw new Error('لا يمكن حذف الفئة لأنها مستخدمة في أصناف موجودة.');

    const { error } = await supabase.from('item_categories').delete().eq('id', categoryId);
    if (error) throw new Error(localizeSupabaseError(error));
    await fetchAll();
  };

  const addUnitType = async (data: { key: UnitType; label: LocalizedString; isActive?: boolean; isWeightBased?: boolean }) => {
    ensureCanManage();
    const key = normalizeKey(String(data.key)) as UnitType;
    if (!key) throw new Error('نوع الوحدة مطلوب.');
    const existing = unitTypes.find(u => u.key === key);
    if (existing) throw new Error('نوع الوحدة موجود مسبقًا.');
    const now = nowIso();
    const record: UnitTypeDef = {
      id: crypto.randomUUID(),
      key,
      label: data.label,
      isActive: data.isActive ?? true,
      isWeightBased: data.isWeightBased ?? (key === 'kg' || key === 'gram'),
      createdAt: now,
      updatedAt: now,
    };
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase
        .from('unit_types')
        .insert({ id: record.id, key: record.key, is_active: record.isActive, is_weight_based: record.isWeightBased, data: record });
      if (error) throw new Error(localizeSupabaseError(error));
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchAll();
  };

  const updateUnitType = async (data: UnitTypeDef) => {
    ensureCanManage();
    const nextKey = normalizeKey(String(data.key)) as UnitType;
    if (!nextKey) throw new Error('نوع الوحدة مطلوب.');
    const existing = unitTypes.find(u => u.key === nextKey);
    if (existing && existing.id !== data.id) throw new Error('نوع الوحدة موجود مسبقًا.');
    const next = { ...data, key: nextKey, updatedAt: nowIso() };
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase
        .from('unit_types')
        .upsert({ id: next.id, key: next.key, is_active: next.isActive, is_weight_based: next.isWeightBased, data: next }, { onConflict: 'id' });
      if (error) throw new Error(localizeSupabaseError(error));
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchAll();
  };

  const deleteUnitType = async (unitTypeId: string) => {
    ensureCanManage();
    const target = unitTypes.find(u => u.id === unitTypeId);
    if (!target) return;
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');

    const { data: usedRows, count: usedCount, error: usedError } = await supabase
      .from('menu_items')
      .select('id', { count: 'exact' })
      .eq('unit_type', String(target.key))
      .limit(1);
    if (usedError) throw new Error(localizeSupabaseError(usedError));
    const usedAny = (typeof usedCount === 'number' ? usedCount : (usedRows?.length || 0)) > 0;
    if (usedAny) throw new Error('لا يمكن حذف نوع الوحدة لأنه مستخدم في أصناف موجودة.');

    const { error } = await supabase.from('unit_types').delete().eq('id', unitTypeId);
    if (error) throw new Error(localizeSupabaseError(error));
    await fetchAll();
  };

  const addFreshnessLevel = async (data: { key: FreshnessLevel; label: LocalizedString; isActive?: boolean; tone?: FreshnessLevelDef['tone'] }) => {
    ensureCanManage();
    const key = normalizeKey(String(data.key)) as FreshnessLevel;
    if (!key) throw new Error('مستوى النضارة مطلوب.');
    const existing = freshnessLevels.find(f => f.key === key);
    if (existing) throw new Error('مستوى النضارة موجود مسبقًا.');
    const now = nowIso();
    const record: FreshnessLevelDef = {
      id: crypto.randomUUID(),
      key,
      label: data.label,
      isActive: data.isActive ?? true,
      tone: data.tone,
      createdAt: now,
      updatedAt: now,
    };
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('freshness_levels').insert({ id: record.id, key: record.key, is_active: record.isActive, data: record });
      if (error) throw new Error(localizeSupabaseError(error));
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchAll();
  };

  const updateFreshnessLevel = async (data: FreshnessLevelDef) => {
    ensureCanManage();
    const nextKey = normalizeKey(String(data.key)) as FreshnessLevel;
    if (!nextKey) throw new Error('مستوى النضارة مطلوب.');
    const existing = freshnessLevels.find(f => f.key === nextKey);
    if (existing && existing.id !== data.id) throw new Error('مستوى النضارة موجود مسبقًا.');
    const next = { ...data, key: nextKey, updatedAt: nowIso() };
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase
        .from('freshness_levels')
        .upsert({ id: next.id, key: next.key, is_active: next.isActive, data: next }, { onConflict: 'id' });
      if (error) throw new Error(localizeSupabaseError(error));
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchAll();
  };

  const deleteFreshnessLevel = async (freshnessLevelId: string) => {
    ensureCanManage();
    const target = freshnessLevels.find(f => f.id === freshnessLevelId);
    if (!target) return;
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');

    const { data: usedRows, count: usedCount, error: usedError } = await supabase
      .from('menu_items')
      .select('id', { count: 'exact' })
      .eq('freshness_level', String(target.key))
      .limit(1);
    if (usedError) throw new Error(localizeSupabaseError(usedError));
    const usedAny = (typeof usedCount === 'number' ? usedCount : (usedRows?.length || 0)) > 0;
    if (usedAny) throw new Error('لا يمكن حذف مستوى النضارة لأنه مستخدم في أصناف موجودة.');

    const { error } = await supabase.from('freshness_levels').delete().eq('id', freshnessLevelId);
    if (error) throw new Error(localizeSupabaseError(error));
    await fetchAll();
  };

  const categoryMap = useMemo(() => new Map(categories.map(c => [c.key, c])), [categories]);
  const categoryMapNormalized = useMemo(
    () => new Map(categories.map(c => [normalizeLookupKey(c.key), c])),
    [categories]
  );
  const unitMap = useMemo(() => new Map(unitTypes.map(u => [String(u.key), u])), [unitTypes]);
  const freshnessMap = useMemo(() => new Map(freshnessLevels.map(f => [String(f.key), f])), [freshnessLevels]);

  const getCategoryLabel = (categoryKey: string, language: 'ar' | 'en') => {
    const def = categoryMap.get(categoryKey) || categoryMapNormalized.get(normalizeLookupKey(categoryKey));
    if (def) return def.name[language] || def.name.ar || def.name.en || categoryKey;
    const normalized = normalizeLookupKey(categoryKey);
    if (normalized === 'grocery') return language === 'ar' ? 'مواد غذائية' : 'Groceries';
    return categoryKey;
  };

  const getUnitLabel = (unitKey: UnitType | undefined, language: 'ar' | 'en') => {
    if (!unitKey) return '';
    const def = unitMap.get(String(unitKey));
    if (def) return def.label[language] || def.label.ar || def.label.en || String(unitKey);
    return String(unitKey);
  };

  const getFreshnessLabel = (freshnessKey: FreshnessLevel | undefined, language: 'ar' | 'en') => {
    if (!freshnessKey) return '';
    const def = freshnessMap.get(String(freshnessKey));
    if (def) return def.label[language] || def.label.ar || def.label.en || String(freshnessKey);
    return String(freshnessKey);
  };

  const getFreshnessTone = (freshnessKey: FreshnessLevel | undefined) => {
    if (!freshnessKey) return undefined;
    const def = freshnessMap.get(String(freshnessKey));
    return def?.tone;
  };

  const isWeightBasedUnit = (unitKey: UnitType | undefined) => {
    if (!unitKey) return false;
    const def = unitMap.get(String(unitKey));
    if (def) return Boolean(def.isWeightBased);
    return unitKey === 'kg' || unitKey === 'gram';
  };

  return (
    <ItemMetaContext.Provider
      value={{
        categories,
        unitTypes,
        freshnessLevels,
        loading,
        fetchAll,
        addCategory,
        updateCategory,
        deleteCategory,
        addUnitType,
        updateUnitType,
        deleteUnitType,
        addFreshnessLevel,
        updateFreshnessLevel,
        deleteFreshnessLevel,
        getCategoryLabel,
        getUnitLabel,
        getFreshnessLabel,
        getFreshnessTone,
        isWeightBasedUnit,
      }}
    >
      {children}
    </ItemMetaContext.Provider>
  );
};

export const useItemMeta = () => {
  const ctx = useContext(ItemMetaContext);
  if (!ctx) throw new Error('useItemMeta must be used within an ItemMetaProvider');
  return ctx;
};
