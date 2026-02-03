import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMenu } from '../../contexts/MenuContext';
import { useToast } from '../../contexts/ToastContext';
import { FreshnessLevel, MenuItem, LocalizedString, UnitType } from '../../types';
import ItemFormModal from '../../components/admin/ItemFormModal';
import ConfirmationModal from '../../components/admin/ConfirmationModal';
import { EditIcon, TrashIcon } from '../../components/icons';
import Spinner from '../../components/Spinner';
import { exportToXlsx } from '../../utils/export';
import { buildXlsxBrandOptions } from '../../utils/branding';
import { useSettings } from '../../contexts/SettingsContext';
import { useItemMeta } from '../../contexts/ItemMetaContext';
import { useAuth } from '../../contexts/AuthContext';
import { useStock } from '../../contexts/StockContext';
import { parseYmdToLocalDate, toYmdLocal } from '../../utils/dateUtils';
import { getSupabaseClient } from '../../supabase';

const EXPIRY_SOON_DAYS = 1;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const formatDateOnly = (date: Date) => toYmdLocal(date);

const parseDateOnly = (value?: string): Date | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ymd = parseYmdToLocalDate(trimmed);
  if (ymd) return startOfDay(ymd);
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
};

const diffDays = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000);

type ExpiryStatus = 'expired' | 'expiring' | 'ok' | 'missing';

const ManageItemsScreen: React.FC = () => {
  const { menuItems, addMenuItem, updateMenuItem, deleteMenuItem, loading } = useMenu();
  const { showNotification } = useToast();
  const { hasPermission } = useAuth();
  const { settings } = useSettings();
  const { initializeStockForItem, updateStock } = useStock();
  const language = 'ar';
  const {
    categories: categoryDefs,
    unitTypes,
    freshnessLevels,
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
    isWeightBasedUnit,
  } = useItemMeta();

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState<MenuItem | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMetaModalOpen, setIsMetaModalOpen] = useState(false);
  const [metaTab, setMetaTab] = useState<'category' | 'unit' | 'freshness'>('category');
  const [metaDeleteConfirm, setMetaDeleteConfirm] = useState<null | { kind: 'category' | 'unit' | 'freshness'; id: string }>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [unitTypeFilter, setUnitTypeFilter] = useState<'all' | string>('all');
  const [freshnessFilter, setFreshnessFilter] = useState<'all' | string>('all');
  const [expiryFilter, setExpiryFilter] = useState<'all' | ExpiryStatus>('all');
  const [sortBy, setSortBy] = useState<'default' | 'expiry_soonest'>('default');
  const [showArchived, setShowArchived] = useState(false);
  const [statusAction, setStatusAction] = useState<'archive' | 'restore'>('archive');

  const [categoryDraft, setCategoryDraft] = useState<{ id?: string; key: string; ar: string; en: string; isActive: boolean }>({
    key: '',
    ar: '',
    en: '',
    isActive: true,
  });
  const [unitDraft, setUnitDraft] = useState<{ id?: string; key: string; ar: string; en: string; isActive: boolean; isWeightBased: boolean }>({
    key: '',
    ar: '',
    en: '',
    isActive: true,
    isWeightBased: false,
  });
  const [freshnessDraft, setFreshnessDraft] = useState<{ id?: string; key: string; ar: string; en: string; isActive: boolean; tone: string }>({
    key: '',
    ar: '',
    en: '',
    isActive: true,
    tone: '',
  });


  const expiryAlertLastShown = useRef<string>('');
  const [expiryMetaByItemId, setExpiryMetaByItemId] = useState<Record<string, { status: ExpiryStatus; closestExpiry: Date | null; daysToExpiry: number | null; hasMissingExpiryStock: boolean }>>({});

  const notifyError = (error: unknown) => {
    const raw = error instanceof Error ? error.message : '';
    const message = raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'حدث خطأ غير متوقع';
    showNotification(message, 'error');
  };

  const resetDrafts = (tab: 'category' | 'unit' | 'freshness') => {
    if (tab === 'category') setCategoryDraft({ key: '', ar: '', en: '', isActive: true });
    if (tab === 'unit') setUnitDraft({ key: '', ar: '', en: '', isActive: true, isWeightBased: false });
    if (tab === 'freshness') setFreshnessDraft({ key: '', ar: '', en: '', isActive: true, tone: '' });

  };


  const openMetaModal = (tab: 'category' | 'unit' | 'freshness') => {
    setMetaTab(tab);
    setIsMetaModalOpen(true);
    resetDrafts(tab);
  };

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setExpiryMetaByItemId({});
      return;
    }

    let cancelled = false;

    const load = async () => {
      const foodIds = Array.from(new Set(menuItems.filter(i => i.category === 'food' && i.status !== 'archived').map(i => i.id)));
      if (foodIds.length === 0) {
        if (!cancelled) setExpiryMetaByItemId({});
        return;
      }

      const today = startOfDay(new Date());
      const agg: Record<string, { hasExpired: boolean; hasExpiring: boolean; hasMissing: boolean; minDays: number | null; minDate: Date | null }> = {};

      const chunkSize = 200;
      for (let offset = 0; offset < foodIds.length; offset += chunkSize) {
        const chunk = foodIds.slice(offset, offset + chunkSize);
        const { data, error } = await supabase
          .from('v_food_batch_balances')
          .select('item_id, expiry_date, remaining_qty')
          .in('item_id', chunk)
          .gt('remaining_qty', 0);
        if (error) throw error;

        for (const row of (data || []) as any[]) {
          const itemId = typeof row?.item_id === 'string' ? row.item_id : '';
          if (!itemId) continue;
          const remaining = Number(row?.remaining_qty || 0);
          if (!(remaining > 0)) continue;

          const entry = agg[itemId] || (agg[itemId] = { hasExpired: false, hasExpiring: false, hasMissing: false, minDays: null, minDate: null });
          const expiry = row?.expiry_date ? parseDateOnly(String(row.expiry_date)) : null;
          if (!expiry) {
            entry.hasMissing = true;
            continue;
          }

          const days = diffDays(today, expiry);
          if (entry.minDays === null || days < entry.minDays) {
            entry.minDays = days;
            entry.minDate = expiry;
          }
          if (days < 0) entry.hasExpired = true;
          else if (days <= EXPIRY_SOON_DAYS) entry.hasExpiring = true;
        }
      }

      const next: Record<string, { status: ExpiryStatus; closestExpiry: Date | null; daysToExpiry: number | null; hasMissingExpiryStock: boolean }> = {};
      for (const itemId of foodIds) {
        const a = agg[itemId];
        if (!a) continue;
        const status: ExpiryStatus = a.hasExpired ? 'expired' : a.hasExpiring ? 'expiring' : a.hasMissing ? 'missing' : 'ok';
        next[itemId] = {
          status,
          closestExpiry: a.minDate,
          daysToExpiry: a.minDays,
          hasMissingExpiryStock: a.hasMissing,
        };
      }

      if (!cancelled) setExpiryMetaByItemId(next);
    };

    void load().catch(() => {
      if (!cancelled) setExpiryMetaByItemId({});
    });

    return () => {
      cancelled = true;
    };
  }, [menuItems]);

  const getItemMeta = React.useCallback((item: MenuItem) => {
    const available = Number(item.availableStock ?? 0);
    const hasStock = available > 0;

    if (item.category !== 'food') {
      return {
        freshnessLevel: item.freshnessLevel,
        hasFreshness: Boolean(item.freshnessLevel),
        expiryStatus: 'ok' as ExpiryStatus,
        effectiveExpiryDate: null as Date | null,
        daysToExpiry: null as number | null,
        hasExplicitExpiry: false,
        hasStock,
      };
    }

    const meta = expiryMetaByItemId[item.id];
    const expiryStatus: ExpiryStatus = meta ? meta.status : (hasStock ? 'missing' : 'ok');

    return {
      freshnessLevel: item.freshnessLevel,
      hasFreshness: Boolean(item.freshnessLevel),
      expiryStatus,
      effectiveExpiryDate: meta?.closestExpiry || null,
      daysToExpiry: typeof meta?.daysToExpiry === 'number' ? meta.daysToExpiry : null,
      hasExplicitExpiry: Boolean(meta?.closestExpiry),
      hasStock,
    };
  }, [expiryMetaByItemId]);

  const handleOpenFormModal = (item: MenuItem | null = null) => {
    setCurrentItem(item);
    setIsFormModalOpen(true);
  };

  const handleOpenDeleteModal = (item: MenuItem) => {
    setCurrentItem(item);
    setStatusAction(item.status === 'archived' ? 'restore' : 'archive');
    setIsDeleteModalOpen(true);
  };

  const handleSaveItem = async (item: Omit<MenuItem, 'id'> | MenuItem) => {
    setIsProcessing(true);
    try {
      if ('id' in item && item.id) {
        const saved = await updateMenuItem(item);
        try { await initializeStockForItem(saved as MenuItem); } catch {}
        if (hasPermission('stock.manage')) {
          try {
            const casted = saved as MenuItem;
            const qty = Number(casted.availableStock ?? 0);
            const prevQty = Number(currentItem?.availableStock ?? -1);
            const unit = String(casted.unitType || 'piece');
            if (prevQty !== qty) {
              await updateStock(casted.id, qty, unit, 'تعديل من شاشة الأصناف');
            }
          } catch {}
        }
        showNotification('تم تحديث الصنف بنجاح!', 'success');
      } else {
        const saved = await addMenuItem(item);
        try { await initializeStockForItem(saved as MenuItem); } catch {}
        if (hasPermission('stock.manage')) {
          try {
            const casted = saved as MenuItem;
            const qty = Number(casted.availableStock ?? 0);
            const unit = String(casted.unitType || 'piece');
            await updateStock(casted.id, qty, unit, 'إنشاء من شاشة الأصناف');
          } catch {}
        }
        showNotification('تمت إضافة الصنف بنجاح!', 'success');
      }
      setIsFormModalOpen(false);
    } catch (err: any) {
      const msg = err?.message || 'حدث خطأ أثناء حفظ الصنف';
      showNotification(msg, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!currentItem) {
      setIsDeleteModalOpen(false);
      return;
    }
    setIsProcessing(true);
    try {
      if (statusAction === 'restore') {
        await updateMenuItem({ ...currentItem, status: 'active' });
        showNotification('تمت استعادة الصنف بنجاح!', 'success');
      } else {
        await deleteMenuItem(currentItem.id);
        showNotification('تمت أرشفة الصنف بنجاح!', 'success');
      }
    } catch (err: any) {
      showNotification(err?.message || (statusAction === 'restore' ? 'حدث خطأ أثناء استعادة الصنف' : 'حدث خطأ أثناء أرشفة الصنف'), 'error');
    } finally {
      setIsProcessing(false);
      setIsDeleteModalOpen(false);
    }
  };

  const filteredItems = useMemo(() => {
    const filtered = menuItems.filter(item => {
      if (!showArchived && item.status === 'archived') return false;
      const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
      const matchesUnit = unitTypeFilter === 'all' || String(item.unitType || '') === unitTypeFilter;
      const name = (item.name as LocalizedString)['ar'] || item.name['ar'];
      const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase());

      if (!(matchesCategory && matchesUnit && matchesSearch)) return false;

      if (freshnessFilter !== 'all' && String(item.freshnessLevel || '') !== freshnessFilter) return false;

      const meta = getItemMeta(item);
      if (expiryFilter !== 'all' && meta.expiryStatus !== expiryFilter) return false;

      return true;
    });

    if (sortBy === 'default') return filtered;

    const score = (status: ExpiryStatus) => {
      if (status === 'expired') return 0;
      if (status === 'expiring') return 1;
      if (status === 'ok') return 2;
      return 3;
    };

    return [...filtered].sort((a, b) => {
      const metaA = getItemMeta(a);
      const metaB = getItemMeta(b);

      if (sortBy === 'expiry_soonest') {
        const byStatus = score(metaA.expiryStatus) - score(metaB.expiryStatus);
        if (byStatus !== 0) return byStatus;

        const daysA = metaA.daysToExpiry ?? Number.POSITIVE_INFINITY;
        const daysB = metaB.daysToExpiry ?? Number.POSITIVE_INFINITY;
        if (daysA !== daysB) return daysA - daysB;
      }
      const nameA = a.name['ar'] || a.name.ar || '';
      const nameB = b.name['ar'] || b.name.ar || '';
      return nameA.localeCompare(nameB);
    });
  }, [menuItems, searchTerm, categoryFilter, unitTypeFilter, freshnessFilter, expiryFilter, sortBy, showArchived, getItemMeta]);

  const expiryExportRows = useMemo(() => {
    return menuItems
      .filter(item => item.status !== 'archived')
      .map(item => {
        const meta = getItemMeta(item);
        return { item, meta };
      })
      .filter(({ meta }) => meta.expiryStatus === 'expired' || meta.expiryStatus === 'expiring')
      .sort((a, b) => {
        const daysA = a.meta.daysToExpiry ?? Number.POSITIVE_INFINITY;
        const daysB = b.meta.daysToExpiry ?? Number.POSITIVE_INFINITY;
        return daysA - daysB;
      });
  }, [menuItems, getItemMeta]);

  const expirySummary = useMemo(() => {
    const activeItems = menuItems.filter(item => item.status !== 'archived');
    const summary = {
      total: activeItems.length,
      expired: 0,
      expiring: 0,
      missing: 0,
    };

    activeItems.forEach(item => {
      const meta = getItemMeta(item);
      if (meta.expiryStatus === 'expired') summary.expired += 1;
      if (meta.expiryStatus === 'expiring') summary.expiring += 1;
      if (meta.expiryStatus === 'missing') summary.missing += 1;
    });

    return summary;
  }, [menuItems, getItemMeta]);

  useEffect(() => {
    if (expirySummary.total === 0) return;
    const todayKey = formatDateOnly(new Date());
    if (expiryAlertLastShown.current === todayKey) return;

    if (expirySummary.expired > 0) {
      showNotification(
        `⚠️ يوجد ${expirySummary.expired} صنف منتهي الصلاحية.`,
        'error'
      );
    } else if (expirySummary.expiring > 0) {
      showNotification(
        `⏳ يوجد ${expirySummary.expiring} صنف قريب الانتهاء.`,
        'info'
      );
    }

    expiryAlertLastShown.current = todayKey;
  }, [expirySummary.expired, expirySummary.expiring, expirySummary.total, showNotification]);

  const categories = useMemo(() => {
    const activeKeys = categoryDefs.filter(c => c.isActive).map(c => c.key);
    const usedKeys = [...new Set(menuItems.map(item => item.category))].filter(Boolean);
    return Array.from(new Set([...activeKeys, ...usedKeys])).sort((a, b) => a.localeCompare(b));
  }, [categoryDefs, menuItems]);

  const unitTypeOptions = useMemo(() => {
    const activeKeys = unitTypes.filter(u => u.isActive).map(u => String(u.key));
    const usedKeys = [...new Set(menuItems.map(item => String(item.unitType || '')))].filter(Boolean);
    return Array.from(new Set([...activeKeys, ...usedKeys])).sort((a, b) => a.localeCompare(b));
  }, [menuItems, unitTypes]);

  const freshnessOptions = useMemo(() => {
    const activeKeys = freshnessLevels.filter(f => f.isActive).map(f => String(f.key));
    const usedKeys = [...new Set(menuItems.map(item => String(item.freshnessLevel || '')))].filter(Boolean);
    return Array.from(new Set([...activeKeys, ...usedKeys])).sort((a, b) => a.localeCompare(b));
  }, [freshnessLevels, menuItems]);

  /* eslint-disable @typescript-eslint/no-base-to-string */
  const handleSubmitMeta = async () => {
    try {
      if (metaTab === 'category') {
        const generatedKey = categoryDraft.key || `cat_${Date.now()}`;
        const payload = {
          key: generatedKey,
          name: { ar: categoryDraft.ar, en: '' },
          isActive: categoryDraft.isActive,
        };
        if (categoryDraft.id) {
          await updateCategory({
            id: categoryDraft.id,
            key: categoryDraft.key, // Keep existing key on update
            name: { ar: categoryDraft.ar, en: '' },
            isActive: categoryDraft.isActive,
            createdAt: categoryDefs.find(c => c.id === categoryDraft.id)?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          showNotification('تم تحديث الفئة', 'success');
        } else {
          await addCategory(payload);
          showNotification('تمت إضافة الفئة', 'success');
        }
        resetDrafts('category');
      }

      if (metaTab === 'unit') {
        const generatedKey = unitDraft.key || `unit_${Date.now()}`;
        const payload = {
          key: generatedKey as UnitType,
          label: { ar: unitDraft.ar, en: '' },
          isActive: unitDraft.isActive,
          isWeightBased: unitDraft.isWeightBased,
        };
        if (unitDraft.id) {
          await updateUnitType({
            id: unitDraft.id,
            key: unitDraft.key as UnitType, // Keep existing key
            label: { ar: unitDraft.ar, en: '' },
            isActive: unitDraft.isActive,
            isWeightBased: unitDraft.isWeightBased,
            createdAt: unitTypes.find(u => u.id === unitDraft.id)?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          showNotification('تم تحديث نوع الوحدة', 'success');
        } else {
          await addUnitType(payload);
          showNotification('تمت إضافة نوع الوحدة', 'success');
        }
        resetDrafts('unit');
      }

      if (metaTab === 'freshness') {
        const generatedKey = freshnessDraft.key || `fresh_${Date.now()}`;
        const payload = {
          key: generatedKey as FreshnessLevel,
          label: { ar: freshnessDraft.ar, en: '' },
          isActive: freshnessDraft.isActive,
          tone: (freshnessDraft.tone || undefined) as any,
        };
        if (freshnessDraft.id) {
          await updateFreshnessLevel({
            id: freshnessDraft.id,
            key: freshnessDraft.key as FreshnessLevel,
            label: { ar: freshnessDraft.ar, en: '' },
            isActive: freshnessDraft.isActive,
            tone: (freshnessDraft.tone || undefined) as any,
            createdAt: freshnessLevels.find(f => f.id === freshnessDraft.id)?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          showNotification('تم تحديث مستوى النضارة', 'success');
        } else {
          await addFreshnessLevel(payload);
          showNotification('تمت إضافة مستوى النضارة', 'success');
        }
        resetDrafts('freshness');
      }
    } catch (error) {
      notifyError(error);
    }
  };

  const handleEditMeta = (kind: 'category' | 'unit' | 'freshness', id: string) => {
    if (kind === 'category') {
      const def = categoryDefs.find(c => c.id === id);
      if (!def) return;
      setMetaTab('category');
      setIsMetaModalOpen(true);
      setCategoryDraft({ id: def.id, key: def.key, ar: def.name.ar, en: def.name.en || '', isActive: def.isActive });

      return;
    }
    if (kind === 'unit') {
      const def = unitTypes.find(u => u.id === id);
      if (!def) return;
      setMetaTab('unit');
      setIsMetaModalOpen(true);
      setUnitDraft({ id: def.id, key: String(def.key), ar: def.label.ar, en: def.label.en || '', isActive: def.isActive, isWeightBased: Boolean(def.isWeightBased) });

      return;
    }
    const def = freshnessLevels.find(f => f.id === id);
    if (!def) return;
    setMetaTab('freshness');
    setIsMetaModalOpen(true);
    setFreshnessDraft({ id: def.id, key: String(def.key), ar: def.label.ar, en: def.label.en || '', isActive: def.isActive, tone: def.tone ? String(def.tone) : '' });

  };

  const handleToggleMetaActive = async (kind: 'category' | 'unit' | 'freshness', id: string) => {
    try {
      if (kind === 'category') {
        const def = categoryDefs.find(c => c.id === id);
        if (!def) return;
        await updateCategory({ ...def, isActive: !def.isActive });
      }
      if (kind === 'unit') {
        const def = unitTypes.find(u => u.id === id);
        if (!def) return;
        await updateUnitType({ ...def, isActive: !def.isActive });
      }
      if (kind === 'freshness') {
        const def = freshnessLevels.find(f => f.id === id);
        if (!def) return;
        await updateFreshnessLevel({ ...def, isActive: !def.isActive });
      }
    } catch (error) {
      notifyError(error);
    }
  };

  const handleConfirmDeleteMeta = (kind: 'category' | 'unit' | 'freshness', id: string) => {
    setMetaDeleteConfirm({ kind, id });
  };

  const handleDeleteMeta = async () => {
    if (!metaDeleteConfirm) return;
    try {
      if (metaDeleteConfirm.kind === 'category') await deleteCategory(metaDeleteConfirm.id);
      if (metaDeleteConfirm.kind === 'unit') await deleteUnitType(metaDeleteConfirm.id);
      if (metaDeleteConfirm.kind === 'freshness') await deleteFreshnessLevel(metaDeleteConfirm.id);
      setMetaDeleteConfirm(null);
      showNotification(language === 'ar' ? 'تم الحذف' : 'Deleted', 'success');
    } catch (error) {
      notifyError(error);
    }
  };

  const handleExportExpiryReport = async () => {
    const headers =
      language === 'ar'
        ? ['الصنف', 'تاريخ الانتهاء (أقرب دفعة)', 'حالة الانتهاء', 'متبقي (يوم)', 'المخزون']
        : ['Item', 'Expiry (nearest batch)', 'Expiry status', 'Days to expiry', 'Stock'];

    const rows = expiryExportRows.map(({ item, meta }) => {
      const expiry = meta.effectiveExpiryDate ? formatDateOnly(meta.effectiveExpiryDate) : '';

      const statusLabel =
        meta.expiryStatus === 'expired'
          ? (language === 'ar' ? 'منتهي' : 'Expired')
          : meta.expiryStatus === 'expiring'
            ? (language === 'ar' ? 'قريب الانتهاء' : 'Expiring')
            : meta.expiryStatus === 'ok'
              ? (language === 'ar' ? 'سليم' : 'OK')
              : (language === 'ar' ? 'بدون تاريخ' : 'Missing');

      return [
        item.name[language] || item.name.ar,
        expiry,
        statusLabel,
        meta.daysToExpiry ?? '',
        typeof item.availableStock === 'number' ? String(item.availableStock) : '',
      ];
    });

    const filename = `expiry_report_${formatDateOnly(new Date())}.xlsx`;
    const success = await exportToXlsx(
      headers, 
      rows, 
      filename,
      { sheetName: 'Expiry Report', ...buildXlsxBrandOptions(settings, 'صلاحية الأصناف', headers.length, { periodText: `التاريخ: ${new Date().toLocaleDateString('ar-SA-u-nu-latn')}` }) }
    );
    if (success) {
      showNotification(language === 'ar' ? 'تم حفظ التقرير في مجلد المستندات' : 'Report saved to Documents folder', 'success');
    } else {
      showNotification(language === 'ar' ? 'فشل تصدير التقرير. تأكد من صلاحيات الملفات.' : 'Export failed. Check file permissions.', 'error');
    }
  };


  return (
    <div className="animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <h1 className="text-3xl font-bold dark:text-white">إدارة الأصناف</h1>
        <div className="flex gap-2">
          <button
            onClick={() => handleOpenFormModal()}
            className="bg-primary-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-primary-600 transition-colors"
          >
            إضافة صنف جديد
          </button>
        </div>
      </div>

      <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="search" className="sr-only">بحث</label>
            <input
              id="search"
              type="text"
              placeholder="ابحث عن صنف بالاسم..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
            />
          </div>
          <div>
            <label htmlFor="category" className="sr-only">الفئة</label>
            <select
              id="category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
            >
              <option value="all">الكل</option>
              {categories.map(cat => <option key={cat} value={cat}>{getCategoryLabel(cat, language as 'ar' | 'en')}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="unitTypeFilter" className="sr-only">الوحدة</label>
            <select
              id="unitTypeFilter"
              value={unitTypeFilter}
              onChange={(e) => setUnitTypeFilter(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
            >
              <option value="all">{language === 'ar' ? 'كل الوحدات' : 'All units'}</option>
              {unitTypeOptions.map(u => (
                <option key={u} value={u}>
                  {getUnitLabel(u as UnitType, language as 'ar' | 'en')}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-4 w-4 text-orange-600 rounded border-gray-300 focus:ring-orange-500"
            />
            <span>إظهار الأصناف المؤرشفة</span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
          <div>
            <label htmlFor="freshnessFilter" className="sr-only">النضارة</label>
            <select
              id="freshnessFilter"
              value={freshnessFilter}
              onChange={(e) => setFreshnessFilter(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
            >
              <option value="all">{language === 'ar' ? 'كل مستويات النضارة' : 'All freshness levels'}</option>
              {freshnessOptions.map(f => (
                <option key={f} value={f}>
                  {getFreshnessLabel(f as FreshnessLevel, language as 'ar' | 'en')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="expiryFilter" className="sr-only">الانتهاء</label>
            <select
              id="expiryFilter"
              value={expiryFilter}
              onChange={(e) => setExpiryFilter(e.target.value as any)}
              className="w-full p-3 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
            >
              <option value="all">{language === 'ar' ? 'كل حالات الانتهاء' : 'All expiry statuses'}</option>
              <option value="expired">{language === 'ar' ? 'منتهي' : 'Expired'}</option>
              <option value="expiring">{language === 'ar' ? 'قريب الانتهاء' : 'Expiring soon'}</option>
              <option value="ok">{language === 'ar' ? 'سليم' : 'OK'}</option>
              <option value="missing">{language === 'ar' ? 'بدون تاريخ' : 'Missing date'}</option>
            </select>
          </div>

          <div>
            <label htmlFor="sortBy" className="sr-only">الترتيب</label>
            <select
              id="sortBy"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full p-3 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
            >
              <option value="default">{language === 'ar' ? 'الترتيب الافتراضي' : 'Default order'}</option>
              <option value="expiry_soonest">{language === 'ar' ? 'الأقرب انتهاءً' : 'Soonest expiry'}</option>
            </select>
          </div>

          <div className="flex items-center justify-end">
            <button
              onClick={() => openMetaModal('category')}
              className="bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 font-semibold py-2 px-4 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition"
            >
              {language === 'ar' ? 'إدارة الفئات/الوحدات/النضارة' : 'Manage categories/units/freshness'}
            </button>
          </div>
        </div>

        {expirySummary.total > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
              {language === 'ar' ? `الإجمالي: ${expirySummary.total}` : `Total: ${expirySummary.total}`}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
              {language === 'ar' ? `منتهي: ${expirySummary.expired}` : `Expired: ${expirySummary.expired}`}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
              {language === 'ar' ? `قريب الانتهاء: ${expirySummary.expiring}` : `Expiring: ${expirySummary.expiring}`}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              {language === 'ar' ? `بدون تاريخ: ${expirySummary.missing}` : `Missing: ${expirySummary.missing}`}
            </span>
          </div>
        )}

        {expiryExportRows.length > 0 && (
          <div className="mt-4">
            <button
              onClick={handleExportExpiryReport}
              className="bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-green-700 transition"
            >
              {language === 'ar' ? 'تصدير تقرير المنتهي/قريب الانتهاء' : 'Export expired/expiring report'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الصورة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الاسم</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">السعر</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الحالة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-16">
                    <div className="flex justify-center items-center space-x-2 rtl:space-x-reverse text-gray-500 dark:text-gray-400">
                      <Spinner />
                      <span>جاري تحميل الأصناف...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredItems.length > 0 ? (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <img src={item.imageUrl || undefined} alt={item.name[language]} className="w-16 h-16 object-cover rounded-md" />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{item.name[language]}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{getCategoryLabel(item.category, language as 'ar' | 'en')}</div>
                      {(item.unitType || item.freshnessLevel) && (
                        <div className="mt-1 flex flex-wrap gap-2">
                          {item.unitType && (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                              {language === 'ar'
                                ? `وحدة: ${getUnitLabel(item.unitType as UnitType, language as 'ar' | 'en')}`
                                : `Unit: ${getUnitLabel(item.unitType as UnitType, language as 'ar' | 'en')}`}
                            </span>
                          )}
                          {item.freshnessLevel && (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                              {language === 'ar'
                                ? `نضارة: ${getFreshnessLabel(item.freshnessLevel as FreshnessLevel, language as 'ar' | 'en')}`
                                : `Freshness: ${getFreshnessLabel(item.freshnessLevel as FreshnessLevel, language as 'ar' | 'en')}`}
                            </span>
                          )}
                        </div>
                      )}
                      {(() => {
                        const meta = getItemMeta(item);
                        const shouldShow = item.category === 'food' && (meta.expiryStatus !== 'ok' || meta.hasExplicitExpiry);
                        if (!shouldShow) return null;

                        const expiryLabel =
                          meta.expiryStatus === 'expired'
                            ? (language === 'ar' ? 'منتهي' : 'Expired')
                            : meta.expiryStatus === 'expiring'
                              ? (language === 'ar' ? 'قريب الانتهاء' : 'Expiring')
                              : meta.expiryStatus === 'ok'
                                ? (language === 'ar' ? 'سليم' : 'OK')
                                : (language === 'ar' ? 'بدون تاريخ' : 'Missing');

                        const expiryClass =
                          meta.expiryStatus === 'expired'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                            : meta.expiryStatus === 'expiring'
                              ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
                              : meta.expiryStatus === 'ok'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';

                        const expiryText = meta.effectiveExpiryDate
                          ? (language === 'ar'
                            ? `أقرب انتهاء: ${formatDateOnly(meta.effectiveExpiryDate)}`
                            : `Nearest expiry: ${formatDateOnly(meta.effectiveExpiryDate)}`)
                          : '';
                        const remainingText = typeof meta.daysToExpiry === 'number'
                          ? (language === 'ar' ? `متبقي: ${meta.daysToExpiry} يوم` : `Remaining: ${meta.daysToExpiry} days`)
                          : '';

                        return (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${expiryClass}`}>
                              {language === 'ar' ? `حالة الانتهاء: ${expiryLabel}` : `Expiry: ${expiryLabel}`}
                            </span>
                            {expiryText && (
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-50 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                                {expiryText}
                              </span>
                            )}
                            {remainingText && (
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-50 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                                {remainingText}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{item.price.toFixed(2)} {String((settings as any)?.baseCurrency || '').toUpperCase() || '—'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${item.status === 'archived'
                        ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                        : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                        }`}>
                        {item.status === 'archived' ? 'مؤرشف' : 'نشط'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2 rtl:space-x-reverse">
                      <button onClick={() => handleOpenFormModal(item)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-200 p-1"><EditIcon /></button>
                      {item.status === 'archived' ? (
                        <button
                          onClick={() => handleOpenDeleteModal(item)}
                          className="text-green-600 hover:text-green-900 dark:text-green-400 dark:hover:text-green-200 px-2 py-1 rounded"
                        >
                          استعادة
                        </button>
                      ) : (
                        <button onClick={() => handleOpenDeleteModal(item)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200 p-1"><TrashIcon /></button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="text-center py-16 text-gray-500 dark:text-gray-400">
                    <p className="font-semibold text-lg">لم يتم العثور على أصناف</p>
                    <p className="mt-1">حاول تغيير كلمات البحث أو الفلاتر.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ItemFormModal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        onSave={handleSaveItem}
        itemToEdit={currentItem}
        isSaving={isProcessing}
        onManageMeta={(kind) => openMetaModal(kind)}
      />

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteItem}
        title={statusAction === 'restore' ? 'تأكيد الاستعادة' : 'تأكيد الأرشفة'}
        message={statusAction === 'restore'
          ? `هل أنت متأكد من رغبتك في استعادة الصنف "${currentItem?.name[language]}"؟ سيعود للظهور في واجهة العملاء.`
          : `هل أنت متأكد من رغبتك في أرشفة الصنف "${currentItem?.name[language]}"؟ سيختفي من واجهة العملاء ويمكن استعادته بإرجاعه إلى نشط.`}
        isConfirming={isProcessing}
      />

      <ConfirmationModal
        isOpen={Boolean(metaDeleteConfirm)}
        onClose={() => setMetaDeleteConfirm(null)}
        onConfirm={handleDeleteMeta}
        title={language === 'ar' ? 'تأكيد الحذف' : 'Confirm delete'}
        message={language === 'ar' ? 'هل أنت متأكد؟ لا يمكن التراجع عن هذا الإجراء.' : 'Are you sure? This action cannot be undone.'}
        isConfirming={false}
      />

      {isMetaModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl animate-fade-in-up">
            <div className="p-6 border-b dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-xl font-bold dark:text-white">
                {language === 'ar' ? 'إدارة الفئات والوحدات ومستويات النضارة' : 'Manage categories, units, and freshness'}
              </h2>
              <button onClick={() => setIsMetaModalOpen(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white">
                {language === 'ar' ? 'إغلاق' : 'Close'}
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setMetaTab('category');
                    resetDrafts('category');
                  }}
                  className={`px-4 py-2 rounded-lg font-semibold ${metaTab === 'category' ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}
                >
                  الفئات
                </button>
                <button
                  onClick={() => {
                    setMetaTab('unit');
                    resetDrafts('unit');
                  }}
                  className={`px-4 py-2 rounded-lg font-semibold ${metaTab === 'unit' ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}
                >
                  الوحدات
                </button>
                <button
                  onClick={() => {
                    setMetaTab('freshness');
                    resetDrafts('freshness');
                  }}
                  className={`px-4 py-2 rounded-lg font-semibold ${metaTab === 'freshness' ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}
                >
                  مستويات النضارة
                </button>
              </div>

              {!hasPermission('items.manage') && (
                <div className="p-3 rounded-lg bg-yellow-50 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
                  {language === 'ar' ? 'ليس لديك صلاحية تعديل هذه التعريفات.' : 'You do not have permission to edit these definitions.'}
                </div>
              )}

              {metaTab === 'category' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">الاسم</label>
                      <input
                        value={categoryDraft.ar}
                        onChange={(e) => setCategoryDraft(prev => ({ ...prev, ar: e.target.value }))}
                        className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                        disabled={!hasPermission('items.manage')}
                        placeholder="أدخل اسم الفئة"
                      />
                    </div>

                    <div className="flex items-center gap-2 mt-6">
                      <input type="checkbox" checked={categoryDraft.isActive} onChange={(e) => setCategoryDraft(prev => ({ ...prev, isActive: e.target.checked }))} disabled={!hasPermission('items.manage')} />
                      <span className="text-sm text-gray-700 dark:text-gray-300">نشط</span>
                    </div>
                    <div>
                      <button onClick={handleSubmitMeta} disabled={!hasPermission('items.manage')} className="w-full bg-primary-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        {categoryDraft.id ? 'تحديث' : 'إضافة'}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                          {/* Key column hidden for better UX as requested */}
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-r dark:border-gray-700">الاسم</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-r dark:border-gray-700">الحالة</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {categoryDefs.map(def => (
                          <tr key={def.id}>
                            <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">{getCategoryLabel(def.key, language as 'ar' | 'en')}</td>
                            <td className="px-4 py-2 text-sm border-r dark:border-gray-700">
                              <button
                                onClick={() => handleToggleMetaActive('category', def.id)}
                                disabled={!hasPermission('items.manage')}
                                className={`px-3 py-1 rounded-full text-xs font-semibold ${def.isActive ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'} disabled:opacity-50`}
                              >
                                {def.isActive ? 'نشط' : 'غير نشط'}
                              </button>
                            </td>
                            <td className="px-4 py-2 text-sm font-medium space-x-2 rtl:space-x-reverse">
                              <button onClick={() => handleEditMeta('category', def.id)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-200 p-1"><EditIcon /></button>
                              <button onClick={() => handleConfirmDeleteMeta('category', def.id)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200 p-1"><TrashIcon /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {metaTab === 'unit' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">الاسم</label>
                      <input
                        value={unitDraft.ar}
                        onChange={(e) => setUnitDraft(prev => ({ ...prev, ar: e.target.value }))}
                        className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                        disabled={!hasPermission('items.manage')}
                        placeholder="أدخل اسم الوحدة"
                      />
                    </div>

                    <div className="flex items-center gap-2 mt-6">
                      <input type="checkbox" checked={unitDraft.isWeightBased} onChange={(e) => setUnitDraft(prev => ({ ...prev, isWeightBased: e.target.checked }))} disabled={!hasPermission('items.manage')} />
                      <span className="text-sm text-gray-700 dark:text-gray-300">وزني (يقبل كسور)</span>
                    </div>
                    <div className="flex items-center gap-2 mt-6">
                      <input type="checkbox" checked={unitDraft.isActive} onChange={(e) => setUnitDraft(prev => ({ ...prev, isActive: e.target.checked }))} disabled={!hasPermission('items.manage')} />
                      <span className="text-sm text-gray-700 dark:text-gray-300">نشط</span>
                    </div>
                    <div>
                      <button onClick={handleSubmitMeta} disabled={!hasPermission('items.manage')} className="w-full bg-primary-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        {unitDraft.id ? 'تحديث' : 'إضافة'}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-r dark:border-gray-700">الاسم</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-r dark:border-gray-700">النوع</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-r dark:border-gray-700">الحالة</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {unitTypes.map(def => (
                          <tr key={def.id}>
                            <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">{getUnitLabel(def.key as UnitType, language as 'ar' | 'en')}</td>
                            <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">
                              {isWeightBasedUnit(def.key as UnitType) ? 'وزني' : 'عددي'}
                            </td>
                            <td className="px-4 py-2 text-sm border-r dark:border-gray-700">
                              <button
                                onClick={() => handleToggleMetaActive('unit', def.id)}
                                disabled={!hasPermission('items.manage')}
                                className={`px-3 py-1 rounded-full text-xs font-semibold ${def.isActive ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'} disabled:opacity-50`}
                              >
                                {def.isActive ? 'نشط' : 'غير نشط'}
                              </button>
                            </td>
                            <td className="px-4 py-2 text-sm font-medium space-x-2 rtl:space-x-reverse">
                              <button onClick={() => handleEditMeta('unit', def.id)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-200 p-1"><EditIcon /></button>
                              <button onClick={() => handleConfirmDeleteMeta('unit', def.id)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200 p-1"><TrashIcon /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {metaTab === 'freshness' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">الاسم</label>
                      <input
                        value={freshnessDraft.ar}
                        onChange={(e) => setFreshnessDraft(prev => ({ ...prev, ar: e.target.value }))}
                        className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                        disabled={!hasPermission('items.manage')}
                        placeholder="أدخل اسم مستوى النضارة"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">اللون</label>
                      <select value={freshnessDraft.tone} onChange={(e) => setFreshnessDraft(prev => ({ ...prev, tone: e.target.value }))} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600" disabled={!hasPermission('items.manage')}>
                        <option value="">افتراضي</option>
                        <option value="green">أخضر</option>
                        <option value="blue">أزرق</option>
                        <option value="yellow">أصفر</option>
                        <option value="gray">رمادي</option>
                        <option value="red">أحمر</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2 mt-6">
                      <input type="checkbox" checked={freshnessDraft.isActive} onChange={(e) => setFreshnessDraft(prev => ({ ...prev, isActive: e.target.checked }))} disabled={!hasPermission('items.manage')} />
                      <span className="text-sm text-gray-700 dark:text-gray-300">نشط</span>
                    </div>
                    <div>
                      <button onClick={handleSubmitMeta} disabled={!hasPermission('items.manage')} className="w-full bg-primary-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        {freshnessDraft.id ? 'تحديث' : 'إضافة'}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">الاسم</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">الحالة</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {freshnessLevels.map(def => (
                          <tr key={def.id}>
                            <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200">{getFreshnessLabel(def.key as FreshnessLevel, language as 'ar' | 'en')}</td>
                            <td className="px-4 py-2 text-sm">
                              <button
                                onClick={() => handleToggleMetaActive('freshness', def.id)}
                                disabled={!hasPermission('items.manage')}
                                className={`px-3 py-1 rounded-full text-xs font-semibold ${def.isActive ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'} disabled:opacity-50`}
                              >
                                {def.isActive ? 'نشط' : 'غير نشط'}
                              </button>
                            </td>
                            <td className="px-4 py-2 text-sm font-medium space-x-2 rtl:space-x-reverse">
                              <button onClick={() => handleEditMeta('freshness', def.id)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-200 p-1"><EditIcon /></button>
                              <button onClick={() => handleConfirmDeleteMeta('freshness', def.id)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200 p-1"><TrashIcon /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageItemsScreen;
