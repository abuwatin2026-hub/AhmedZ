import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FreshnessLevel, FreshnessLevelDef, ItemCategoryDef, ItemGroupDef, LocalizedString, UnitType, UnitTypeDef } from '../types';
import { useAuth } from './AuthContext';
import { getSupabaseClient } from '../supabase';
import { localizeSupabaseError } from '../utils/errorUtils';

type MetaLoadingState = {
  categories: boolean;
  groups: boolean;
  unitTypes: boolean;
  freshnessLevels: boolean;
};

interface ItemMetaContextType {
  categories: ItemCategoryDef[];
  groups: ItemGroupDef[];
  unitTypes: UnitTypeDef[];
  freshnessLevels: FreshnessLevelDef[];
  loading: boolean;
  fetchAll: () => Promise<void>;

  addCategory: (data: { key: string; name: LocalizedString; isActive?: boolean }) => Promise<void>;
  updateCategory: (data: ItemCategoryDef) => Promise<void>;
  deleteCategory: (categoryId: string) => Promise<void>;

  addGroup: (data: { categoryKey: string; key: string; name: LocalizedString; isActive?: boolean }) => Promise<void>;
  updateGroup: (data: ItemGroupDef) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;

  addUnitType: (data: { key: UnitType; label: LocalizedString; isActive?: boolean; isWeightBased?: boolean }) => Promise<void>;
  updateUnitType: (data: UnitTypeDef) => Promise<void>;
  deleteUnitType: (unitTypeId: string) => Promise<void>;

  addFreshnessLevel: (data: { key: FreshnessLevel; label: LocalizedString; isActive?: boolean; tone?: FreshnessLevelDef['tone'] }) => Promise<void>;
  updateFreshnessLevel: (data: FreshnessLevelDef) => Promise<void>;
  deleteFreshnessLevel: (freshnessLevelId: string) => Promise<void>;

  getCategoryLabel: (categoryKey: string, language: 'ar' | 'en') => string;
  getGroupLabel: (groupKey: string, categoryKey: string | undefined, language: 'ar' | 'en') => string;
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
  const [groups, setGroups] = useState<ItemGroupDef[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitTypeDef[]>([]);
  const [freshnessLevels, setFreshnessLevels] = useState<FreshnessLevelDef[]>([]);
  const [loadingState, setLoadingState] = useState<MetaLoadingState>({ categories: true, groups: true, unitTypes: true, freshnessLevels: true });
  const { hasPermission } = useAuth();

  const loading = loadingState.categories || loadingState.groups || loadingState.unitTypes || loadingState.freshnessLevels;

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
    setLoadingState({ categories: true, groups: true, unitTypes: true, freshnessLevels: true });
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setCategories([]);
        setGroups([]);
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

      let rowsGroups: any[] = [];
      try {
        const { data, error } = await supabase.from('item_groups').select('id,category_key,key,is_active,data');
        if (error) {
          const msg = String((error as any)?.message || '').toLowerCase();
          const details = String((error as any)?.details || '').toLowerCase();
          const code = String((error as any)?.code || '');
          const missing = code === '42P01' || msg.includes('does not exist') || details.includes('does not exist');
          if (!missing) throw error;
          rowsGroups = [];
        } else {
          rowsGroups = data || [];
        }
      } catch (err) {
        const msg = String((err as any)?.message || '').toLowerCase();
        const details = String((err as any)?.details || '').toLowerCase();
        const code = String((err as any)?.code || '');
        const missing = code === '42P01' || msg.includes('does not exist') || details.includes('does not exist');
        if (!missing) throw err;
        rowsGroups = [];
      }

      const allCategories = (rowsCategories || []).map(row => row.data as ItemCategoryDef).filter(Boolean);
      const allGroups = (rowsGroups || [])
        .map((row: any) => {
          const d: any = row?.data || {};
          const nameObj: any = d?.name && typeof d.name === 'object' ? d.name : {};
          const safeName: LocalizedString = {
            ar: typeof nameObj?.ar === 'string' ? nameObj.ar : '',
            en: typeof nameObj?.en === 'string' ? nameObj.en : '',
          };
          const id = typeof d?.id === 'string' ? d.id : (typeof row?.id === 'string' ? row.id : crypto.randomUUID());
          const categoryKey = typeof d?.categoryKey === 'string' ? d.categoryKey : (typeof row?.category_key === 'string' ? row.category_key : '');
          const key = typeof d?.key === 'string' ? d.key : (typeof row?.key === 'string' ? row.key : '');
          const isActive = typeof d?.isActive === 'boolean' ? d.isActive : (typeof row?.is_active === 'boolean' ? row.is_active : true);
          const createdAt = typeof d?.createdAt === 'string' ? d.createdAt : '';
          const updatedAt = typeof d?.updatedAt === 'string' ? d.updatedAt : '';
          if (!categoryKey || !key) return null;
          return { id, categoryKey, key, name: safeName, isActive, createdAt, updatedAt } as ItemGroupDef;
        })
        .filter(Boolean) as ItemGroupDef[];
      const allUnitTypes = (rowsUnitTypes || []).map(row => row.data as UnitTypeDef).filter(Boolean);
      const allFreshnessLevels = (rowsFreshness || []).map(row => row.data as FreshnessLevelDef).filter(Boolean);

      setCategories(allCategories.sort((a, b) => a.key.localeCompare(b.key)));
      setGroups(allGroups.sort((a, b) => `${a.categoryKey}::${a.key}`.localeCompare(`${b.categoryKey}::${b.key}`)));
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
      setGroups([]);
      setUnitTypes([]);
      setFreshnessLevels([]);
    } finally {
      setLoadingState({ categories: false, groups: false, unitTypes: false, freshnessLevels: false });
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const addCategory = async (data: { key: string; name: LocalizedString; isActive?: boolean }) => {
    ensureCanManage();
    const key = normalizeKey(data.key);
    if (!key) throw new Error('الفئة مطلوبة.');
    const nameAr = String(data?.name?.ar || '').trim();
    if (!nameAr) throw new Error('اسم الفئة مطلوب.');
    const now = nowIso();
    const existing = categories.find(c => c.key === key);
    if (existing) throw new Error('هذه الفئة موجودة مسبقًا.');
    const record: ItemCategoryDef = { id: crypto.randomUUID(), key, name: { ...data.name, ar: nameAr }, isActive: data.isActive ?? true, createdAt: now, updatedAt: now };
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
    const nameAr = String(data?.name?.ar || '').trim();
    if (!nameAr) throw new Error('اسم الفئة مطلوب.');
    const existing = categories.find(c => c.key === nextKey);
    if (existing && existing.id !== data.id) throw new Error('هذه الفئة موجودة مسبقًا.');
    const next = { ...data, key: nextKey, name: { ...data.name, ar: nameAr }, updatedAt: nowIso() };
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

  const addGroup = async (data: { categoryKey: string; key: string; name: LocalizedString; isActive?: boolean }) => {
    ensureCanManage();
    const categoryKey = normalizeKey(String(data.categoryKey || ''));
    if (!categoryKey) throw new Error('الفئة مطلوبة.');
    const key = normalizeKey(String(data.key || ''));
    if (!key) throw new Error('المجموعة مطلوبة.');
    const nameAr = String(data?.name?.ar || '').trim();
    if (!nameAr) throw new Error('اسم المجموعة مطلوب.');
    const now = nowIso();
    const existing = groups.find(g => g.categoryKey === categoryKey && g.key === key);
    if (existing) throw new Error('هذه المجموعة موجودة مسبقًا.');
    const record: ItemGroupDef = { id: crypto.randomUUID(), categoryKey, key, name: data.name, isActive: data.isActive ?? true, createdAt: now, updatedAt: now };
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase
        .from('item_groups')
        .insert({ id: record.id, category_key: record.categoryKey, key: record.key, is_active: record.isActive, data: record });
      if (error) throw new Error(localizeSupabaseError(error));
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchAll();
  };

  const updateGroup = async (data: ItemGroupDef) => {
    ensureCanManage();
    const categoryKey = normalizeKey(String(data.categoryKey || ''));
    if (!categoryKey) throw new Error('الفئة مطلوبة.');
    const nextKey = normalizeKey(String(data.key || ''));
    if (!nextKey) throw new Error('المجموعة مطلوبة.');
    const nameAr = String(data?.name?.ar || '').trim();
    if (!nameAr) throw new Error('اسم المجموعة مطلوب.');
    const existing = groups.find(g => g.categoryKey === categoryKey && g.key === nextKey);
    if (existing && existing.id !== data.id) throw new Error('هذه المجموعة موجودة مسبقًا.');
    const next: ItemGroupDef = { ...data, categoryKey, key: nextKey, updatedAt: nowIso() };
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase
        .from('item_groups')
        .upsert({ id: next.id, category_key: next.categoryKey, key: next.key, is_active: next.isActive, data: next }, { onConflict: 'id' });
      if (error) throw new Error(localizeSupabaseError(error));
    } else {
      throw new Error('Supabase غير مهيأ.');
    }
    await fetchAll();
  };

  const deleteGroup = async (groupId: string) => {
    ensureCanManage();
    const target = groups.find(g => g.id === groupId);
    if (!target) return;
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');

    const { data: usedRows, count: usedCount, error: usedError } = await supabase
      .from('menu_items')
      .select('id', { count: 'exact' })
      .eq('category', target.categoryKey)
      .eq('group_key', target.key.toUpperCase())
      .limit(1);
    if (usedError) throw new Error(localizeSupabaseError(usedError));
    const usedAny = (typeof usedCount === 'number' ? usedCount : (usedRows?.length || 0)) > 0;
    if (usedAny) throw new Error('لا يمكن حذف المجموعة لأنها مستخدمة في أصناف موجودة.');

    const { error } = await supabase.from('item_groups').delete().eq('id', groupId);
    if (error) throw new Error(localizeSupabaseError(error));
    await fetchAll();
  };

  const addUnitType = async (data: { key: UnitType; label: LocalizedString; isActive?: boolean; isWeightBased?: boolean }) => {
    ensureCanManage();
    const key = normalizeKey(String(data.key)) as UnitType;
    if (!key) throw new Error('نوع الوحدة مطلوب.');
    const labelAr = String(data?.label?.ar || '').trim();
    if (!labelAr) throw new Error('اسم الوحدة مطلوب.');
    const existing = unitTypes.find(u => u.key === key);
    if (existing) throw new Error('نوع الوحدة موجود مسبقًا.');
    const now = nowIso();
    const record: UnitTypeDef = {
      id: crypto.randomUUID(),
      key,
      label: { ...data.label, ar: labelAr },
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
    const labelAr = String(data?.label?.ar || '').trim();
    if (!labelAr) throw new Error('اسم الوحدة مطلوب.');
    const existing = unitTypes.find(u => u.key === nextKey);
    if (existing && existing.id !== data.id) throw new Error('نوع الوحدة موجود مسبقًا.');
    const next = { ...data, key: nextKey, label: { ...data.label, ar: labelAr }, updatedAt: nowIso() };
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
    const labelAr = String(data?.label?.ar || '').trim();
    if (!labelAr) throw new Error('اسم مستوى النضارة مطلوب.');
    const existing = freshnessLevels.find(f => f.key === key);
    if (existing) throw new Error('مستوى النضارة موجود مسبقًا.');
    const now = nowIso();
    const record: FreshnessLevelDef = {
      id: crypto.randomUUID(),
      key,
      label: { ...data.label, ar: labelAr },
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
    const labelAr = String(data?.label?.ar || '').trim();
    if (!labelAr) throw new Error('اسم مستوى النضارة مطلوب.');
    const existing = freshnessLevels.find(f => f.key === nextKey);
    if (existing && existing.id !== data.id) throw new Error('مستوى النضارة موجود مسبقًا.');
    const next = { ...data, key: nextKey, label: { ...data.label, ar: labelAr }, updatedAt: nowIso() };
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
  const groupMapByCategory = useMemo(() => {
    const map = new Map<string, Map<string, ItemGroupDef>>();
    for (const g of groups) {
      const cat = g.categoryKey;
      if (!cat) continue;
      let inner = map.get(cat);
      if (!inner) {
        inner = new Map<string, ItemGroupDef>();
        map.set(cat, inner);
      }
      inner.set(g.key, g);
    }
    return map;
  }, [groups]);
  const unitMap = useMemo(() => new Map(unitTypes.map(u => [String(u.key), u])), [unitTypes]);
  const freshnessMap = useMemo(() => new Map(freshnessLevels.map(f => [String(f.key), f])), [freshnessLevels]);

  const getCategoryLabel = (categoryKey: string, language: 'ar' | 'en') => {
    const def = categoryMap.get(categoryKey) || categoryMapNormalized.get(normalizeLookupKey(categoryKey));
    if (def) return def.name[language] || def.name.ar || def.name.en || categoryKey;
    const normalized = normalizeLookupKey(categoryKey);
    if (normalized === 'grocery') return language === 'ar' ? 'مواد غذائية' : 'Groceries';
    return categoryKey;
  };

  const getGroupLabel = (groupKey: string, categoryKey: string | undefined, language: 'ar' | 'en') => {
    const gk = String(groupKey || '').trim();
    if (!gk) return '';
    const ck = String(categoryKey || '').trim();
    if (ck) {
      const def = groupMapByCategory.get(ck)?.get(gk);
      if (def) return def.name[language] || def.name.ar || def.name.en || gk;
    }
    const matches = groups.filter(g => g.key === gk);
    if (matches.length === 1) {
      const def = matches[0];
      return def.name[language] || def.name.ar || def.name.en || gk;
    }
    return gk;
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
        groups,
        unitTypes,
        freshnessLevels,
        loading,
        fetchAll,
        addCategory,
        updateCategory,
        deleteCategory,
        addGroup,
        updateGroup,
        deleteGroup,
        addUnitType,
        updateUnitType,
        deleteUnitType,
        addFreshnessLevel,
        updateFreshnessLevel,
        deleteFreshnessLevel,
        getCategoryLabel,
        getGroupLabel,
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
