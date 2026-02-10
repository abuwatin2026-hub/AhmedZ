import React, { useState, useEffect } from 'react';
import { MenuItem, Addon, UnitType, FreshnessLevel } from '../../types';
import { useAddons } from '../../contexts/AddonContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import { useItemMeta } from '../../contexts/ItemMetaContext';
import { useStock } from '../../contexts/StockContext';
import ImageUploader from '../ImageUploader';
import NumberInput from '../NumberInput';
import { getBaseCurrencyCode, getSupabaseClient } from '../../supabase';

interface ItemFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: Omit<MenuItem, 'id'> | MenuItem) => void;
  itemToEdit: MenuItem | null;
  isSaving: boolean;
  onManageMeta?: (kind: 'category' | 'group' | 'unit' | 'freshness') => void;
}

const ItemFormModal: React.FC<ItemFormModalProps> = ({ isOpen, onClose, onSave, itemToEdit, isSaving, onManageMeta }) => {
  const { addons: availableAddons } = useAddons();
  const { t, language } = useSettings();
  const { hasPermission } = useAuth();
  const { categories, groups, unitTypes, freshnessLevels, getCategoryLabel, getGroupLabel, getUnitLabel, getFreshnessLabel } = useItemMeta();
  const { getStockByItemId } = useStock();
  const [baseCode, setBaseCode] = useState('—');

  useEffect(() => {
    void getBaseCurrencyCode().then((c) => {
      if (!c) return;
      setBaseCode(c);
    });
  }, []);

  const getInitialFormState = (): Omit<MenuItem, 'id' | 'rating'> => ({
    ...((): Pick<MenuItem, 'category' | 'unitType' | 'freshnessLevel' | 'minWeight'> => {
      const activeCategoryKeys = categories.filter(c => c.isActive).map(c => c.key);
      const category = activeCategoryKeys[0] || '';
      const activeUnitKeys = unitTypes.filter(u => u.isActive).map(u => String(u.key) as UnitType);
      const unitType = activeUnitKeys[0] || undefined;
      const activeFreshnessKeys = freshnessLevels.filter(f => f.isActive).map(f => String(f.key) as FreshnessLevel);
      const freshnessLevel = activeFreshnessKeys[0] || undefined;
      const minWeight = unitType === 'kg' || unitType === 'gram' ? 0.5 : 1;
      return { category, unitType, freshnessLevel, minWeight };
    })(),
    name: { ar: '', en: '' },
    barcode: '',
    description: { ar: '', en: '' },
    price: 0,
    costPrice: 0,
    imageUrl: 'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22800%22 height=%22800%22><defs><linearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22><stop offset=%220%22 stop-color=%22%237FA99B%22/><stop offset=%221%22 stop-color=%22%232F5D62%22/></linearGradient></defs><rect width=%22100%%22 height=%22100%%22 fill=%22url(%23g)%22/></svg>',
    sellable: true,
    status: 'active',
    addons: [],
    isFeatured: false,
    availableStock: 0,
    buyingPrice: 0,
    transportCost: 0,
    supplyTaxCost: 0,
    packSize: 0,
    cartonSize: 0,
    uomUnits: [],
    group: '',
  });

  const [item, setItem] = useState(getInitialFormState());
  const [hasReceipts, setHasReceipts] = useState(false);
  const [formError, setFormError] = useState<string>('');

  useEffect(() => {
    if (itemToEdit) {
      const rawUomUnits = (itemToEdit as any)?.uomUnits ?? (itemToEdit as any)?.data?.uomUnits;
      const uomUnits = Array.isArray(rawUomUnits)
        ? rawUomUnits
          .map((u: any) => ({
            code: String(u?.code || '').trim(),
            name: typeof u?.name === 'string' ? u.name : undefined,
            qtyInBase: Number(u?.qtyInBase || 0) || 0,
          }))
          .filter((u: any) => u.code || u.qtyInBase > 0 || (u.name && String(u.name).trim()))
        : [];
      setItem({
        name: itemToEdit.name,
        barcode: itemToEdit.barcode || '',
        description: itemToEdit.description,
        price: itemToEdit.price,
        costPrice: itemToEdit.costPrice || 0,
        imageUrl: itemToEdit.imageUrl,
        category: itemToEdit.category,
        group: (itemToEdit as any).group || '',
        sellable: (itemToEdit as any).sellable ?? true,
        status: itemToEdit.status || 'active',
        addons: itemToEdit.addons || [],
        isFeatured: itemToEdit.isFeatured || false,
        unitType: itemToEdit.unitType,
        availableStock: itemToEdit.availableStock || 0,
        freshnessLevel: itemToEdit.freshnessLevel,
        minWeight: itemToEdit.minWeight || 0.5,
        pricePerUnit: itemToEdit.pricePerUnit,
        buyingPrice: itemToEdit.buyingPrice || 0,
        transportCost: itemToEdit.transportCost || 0,
        supplyTaxCost: itemToEdit.supplyTaxCost || 0,
        packSize: Number((itemToEdit as any).packSize ?? 0) || 0,
        cartonSize: Number((itemToEdit as any).cartonSize ?? 0) || 0,
        uomUnits,
      });
    } else {
      setItem(getInitialFormState());
    }
  }, [itemToEdit, isOpen]);

  useEffect(() => {
    let cancelled = false;
    const checkReceipts = async () => {
      try {
        if (!itemToEdit?.id) {
          if (!cancelled) setHasReceipts(false);
          return;
        }
        if (!hasPermission('stock.manage')) {
          if (!cancelled) setHasReceipts(false);
          return;
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          if (!cancelled) setHasReceipts(false);
          return;
        }
        const supabase = getSupabaseClient();
        if (!supabase) {
          if (!cancelled) setHasReceipts(false);
          return;
        }
        const { data, count, error } = await supabase
          .from('purchase_receipt_items')
          .select('id', { count: 'exact' })
          .eq('item_id', itemToEdit.id)
          .limit(1);
        if (error) throw error;
        const hasAny = (typeof count === 'number' ? count : (data?.length || 0)) > 0;
        if (!cancelled) setHasReceipts(hasAny);
      } catch {
        if (!cancelled) setHasReceipts(false);
      }
    };
    checkReceipts();
    return () => {
      cancelled = true;
    };
  }, [itemToEdit?.id, hasPermission]);
  
  useEffect(() => {
    const nameAr = (item.name?.ar || '').trim();
    const descAr = (item.description?.ar || '').trim();
    const price = Number(item.price);
    const availableStock = Number(item.availableStock ?? 0);
    const minWeight = Number(item.minWeight ?? 0);
    const category = String(item.category || '').trim();
    const unitType = String(item.unitType || '').trim();
    const packSize = Number((item as any).packSize ?? 0);
    const cartonSize = Number((item as any).cartonSize ?? 0);
    const rawUomUnits = Array.isArray((item as any).uomUnits) ? (item as any).uomUnits : [];
    const uomUnits = rawUomUnits.map((u: any) => ({
      code: String(u?.code || '').trim().toLowerCase(),
      name: typeof u?.name === 'string' ? String(u.name).trim() : '',
      qtyInBase: Number(u?.qtyInBase || 0),
    }));

    if (nameAr.length < 2) {
      setFormError(language === 'ar' ? 'اسم الصنف مطلوب (حرفين على الأقل)' : 'Item name is required');
      return;
    }
    if (descAr.length < 10) {
      setFormError(language === 'ar' ? 'وصف الصنف مطلوب (10 أحرف على الأقل)' : 'Item description is required');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setFormError(language === 'ar' ? 'سعر البيع غير صالح' : 'Invalid price');
      return;
    }
    if (!category) {
      setFormError(language === 'ar' ? 'الفئة مطلوبة' : 'Category is required');
      return;
    }
    if (!unitType) {
      setFormError(language === 'ar' ? 'نوع الوحدة مطلوب' : 'Unit type is required');
      return;
    }
    if (!Number.isFinite(availableStock) || availableStock < 0) {
      setFormError(language === 'ar' ? 'الكمية المتوفرة غير صالحة' : 'Invalid stock quantity');
      return;
    }
    if (!Number.isFinite(minWeight) || minWeight <= 0) {
      setFormError(language === 'ar' ? 'أقل كمية للطلب يجب أن تكون أكبر من صفر' : 'Minimum order quantity must be > 0');
      return;
    }
    if (!(unitType === 'kg' || unitType === 'gram') && !Number.isInteger(minWeight)) {
      setFormError(language === 'ar' ? 'أقل كمية للطلب يجب أن تكون رقم صحيح للوحدات غير الوزنية' : 'Minimum order must be an integer for non-weight units');
      return;
    }

    if ((unitType === 'kg' || unitType === 'gram') && (packSize > 0 || cartonSize > 0)) {
      setFormError(language === 'ar' ? 'وحدات الباكت/الكرتون غير متاحة للوحدات الوزنية' : 'Pack/Carton is not available for weight-based units');
      return;
    }
    if ((unitType === 'kg' || unitType === 'gram') && uomUnits.some((u: any) => u.code || u.qtyInBase > 0 || u.name)) {
      setFormError(language === 'ar' ? 'الوحدات الإضافية غير متاحة للوحدات الوزنية' : 'Additional units are not available for weight-based units');
      return;
    }
    if (packSize < 0 || cartonSize < 0) {
      setFormError(language === 'ar' ? 'قيم الباكت/الكرتون غير صالحة' : 'Invalid pack/carton values');
      return;
    }
    if (packSize > 0 && (!Number.isFinite(packSize) || !Number.isInteger(packSize) || packSize < 2)) {
      setFormError(language === 'ar' ? 'حجم الباكت يجب أن يكون رقم صحيح (2+) ' : 'Pack size must be an integer (2+)');
      return;
    }
    if (cartonSize > 0 && (!Number.isFinite(cartonSize) || !Number.isInteger(cartonSize) || cartonSize < 2)) {
      setFormError(language === 'ar' ? 'حجم الكرتون يجب أن يكون رقم صحيح (2+) ' : 'Carton size must be an integer (2+)');
      return;
    }
    if (packSize > 0 && cartonSize > 0 && cartonSize < packSize) {
      setFormError(language === 'ar' ? 'حجم الكرتون يجب أن يكون أكبر أو يساوي حجم الباكت' : 'Carton size must be >= pack size');
      return;
    }

    const baseLower = unitType.toLowerCase();
    const seen = new Set<string>();
    for (const u of uomUnits) {
      const hasAny = Boolean(u.code || u.qtyInBase > 0 || u.name);
      if (!hasAny) continue;
      if (!u.code) {
        setFormError(language === 'ar' ? 'رمز الوحدة الإضافية مطلوب' : 'Additional unit code is required');
        return;
      }
      if (u.code === baseLower) {
        setFormError(language === 'ar' ? 'لا يمكن إضافة وحدة مطابقة لوحدة الأساس' : 'Cannot add a unit equal to the base unit');
        return;
      }
      if (!Number.isFinite(u.qtyInBase) || !Number.isInteger(u.qtyInBase) || u.qtyInBase < 2) {
        setFormError(language === 'ar' ? 'معامل التحويل للوحدة الإضافية يجب أن يكون رقم صحيح (2+) ' : 'Additional unit factor must be an integer (2+)');
        return;
      }
      if ((u.code === 'pack' && packSize > 0) || (u.code === 'carton' && cartonSize > 0)) {
        setFormError(language === 'ar' ? 'لا يمكن تكرار باكت/كرتون ضمن الوحدات الإضافية' : 'Pack/Carton is already defined');
        return;
      }
      if (seen.has(u.code)) {
        setFormError(language === 'ar' ? 'يوجد تكرار في رموز الوحدات الإضافية' : 'Duplicate additional unit codes');
        return;
      }
      seen.add(u.code);
    }

    setFormError('');
  }, [item, language]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setItem(prev => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setItem(prev => ({ ...prev, [name]: (name === 'price' || name === 'costPrice') ? parseFloat(value) : value }));
    }
  };

  const handleLocalizedChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const [field, lang] = name.split('.');

    setItem(prev => ({
      ...prev,
      [field]: {
        ...(prev[field as keyof typeof prev] as object),
        [lang]: value,
      },
    }));
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const parsed = parseFloat(value);
    const numeric = Number.isFinite(parsed) ? parsed : 0;
    setItem((prev) => {
      return { ...prev, [name]: numeric } as typeof prev;
    });
  };

  const updateUomUnit = (index: number, patch: Partial<{ code: string; name?: string; qtyInBase: number }>) => {
    setItem((prev) => {
      const current = Array.isArray((prev as any).uomUnits) ? ([...(prev as any).uomUnits] as any[]) : [];
      const row = current[index] && typeof current[index] === 'object' ? current[index] : {};
      current[index] = { ...row, ...patch };
      return { ...(prev as any), uomUnits: current } as typeof prev;
    });
  };

  const addUomUnitRow = () => {
    setItem((prev) => {
      const current = Array.isArray((prev as any).uomUnits) ? ([...(prev as any).uomUnits] as any[]) : [];
      current.push({ code: '', name: '', qtyInBase: 0 });
      return { ...(prev as any), uomUnits: current } as typeof prev;
    });
  };

  const removeUomUnitRow = (index: number) => {
    setItem((prev) => {
      const current = Array.isArray((prev as any).uomUnits) ? ([...(prev as any).uomUnits] as any[]) : [];
      const next = current.filter((_, i) => i !== index);
      return { ...(prev as any), uomUnits: next } as typeof prev;
    });
  };

  const handleImageChange = (base64: string) => {
    setItem(prev => ({ ...prev, imageUrl: base64 }));
  };

  const handleAddonToggle = (addon: Addon) => {
    setItem(prev => {
      const currentAddons = prev.addons || [];
      const isSelected = currentAddons.some(a => a.id === addon.id);
      if (isSelected) {
        return { ...prev, addons: currentAddons.filter(a => a.id !== addon.id) };
      } else {
        // Add the addon without isDefault initially
        const newAddon = { ...addon, isDefault: false };
        delete (newAddon as any).size; // Remove size if it exists, not needed here.
        return { ...prev, addons: [...currentAddons, newAddon] };
      }
    });
  };

  const handleSetDefaultToggle = (addonId: string, isDefault: boolean) => {
    setItem(prev => ({
      ...prev,
      addons: (prev.addons || []).map(a => a.id === addonId ? { ...a, isDefault } : a),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const canEditPrice = !itemToEdit || hasPermission('prices.manage');
    const safeItemBase = itemToEdit && !canEditPrice ? { ...item, price: itemToEdit.price } : item;
    onSave(itemToEdit ? { ...safeItemBase, id: itemToEdit.id } : safeItemBase);
  };

  const categoryOptions = React.useMemo(() => {
    const active = categories.filter(c => c.isActive).map(c => c.key);
    const existing = itemToEdit?.category;
    if (existing && !active.includes(existing)) return [existing, ...active];
    return active;
  }, [categories, itemToEdit?.category]);

  const unitOptions = React.useMemo(() => {
    const active = unitTypes.filter(u => u.isActive).map(u => String(u.key));
    const existing = itemToEdit?.unitType ? String(itemToEdit.unitType) : undefined;
    if (existing && !active.includes(existing)) return [existing, ...active];
    return active;
  }, [unitTypes, itemToEdit?.unitType]);

  const freshnessOptions = React.useMemo(() => {
    const active = freshnessLevels.filter(f => f.isActive).map(f => String(f.key));
    const existing = itemToEdit?.freshnessLevel ? String(itemToEdit.freshnessLevel) : undefined;
    if (existing && !active.includes(existing)) return [existing, ...active];
    return active;
  }, [freshnessLevels, itemToEdit?.freshnessLevel]);

  const groupOptions = React.useMemo(() => {
    const category = String(item.category || '').trim();
    const active = groups.filter(g => g.isActive && g.categoryKey === category).map(g => String(g.key));
    const current = String((item as any).group || '').trim();
    if (current && !active.includes(current)) return [current, ...active];
    return active;
  }, [groups, item.category, item]);

  useEffect(() => {
    const category = String(item.category || '').trim();
    const current = String((item as any).group || '').trim();
    if (!category || !current) return;
    const allowed = new Set(groups.filter(g => g.isActive && g.categoryKey === category).map(g => String(g.key)));
    if (allowed.size > 0 && !allowed.has(current)) {
      setItem(prev => ({ ...prev, group: '' }));
    }
  }, [groups, item.category]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-2 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full sm:max-w-lg md:max-w-2xl max-h-[min(90dvh,calc(100dvh-1rem))] overflow-hidden animate-fade-in-up flex flex-col">
        <div className="p-6 border-b dark:border-gray-700">
          <h2 className="text-xl font-bold dark:text-white">{itemToEdit ? t('editItem') : t('addItem')}</h2>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-6 space-y-6 overflow-y-auto flex-1 min-h-0">

            <div className="mb-4">
              <label htmlFor="name.ar" className="block text-sm font-medium text-gray-700 dark:text-gray-300">اسم الصنف</label>
              <input type="text" name="name.ar" id="name.ar" value={item.name.ar} onChange={handleLocalizedChange} required className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600" />
            </div>

            <div className="mb-4">
              <label htmlFor="barcode" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Barcode</label>
              <div className="text-xs text-gray-500 dark:text-gray-400">يُستخدم للبحث السريع، POS، وأوامر الشراء</div>
              <input
                type="text"
                name="barcode"
                id="barcode"
                value={item.barcode || ''}
                onChange={handleChange}
                className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 font-mono"
              />
            </div>
            <div>
              <label htmlFor="description.ar" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الوصف</label>
              <textarea name="description.ar" id="description.ar" value={item.description.ar} onChange={handleLocalizedChange} required rows={2} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"></textarea>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">السعر (البيع)</label>
              <NumberInput
                id="price"
                name="price"
                value={item.price}
                onChange={handleNumberChange}
                min={0}
                step={0.5}
                disabled={Boolean(itemToEdit) && !hasPermission('prices.manage')}
              />
            </div>

            <div>
              <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الفئة</label>
              <select name="category" id="category" value={item.category} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600">
                <option value="">{language === 'ar' ? 'اختر فئة' : 'Select category'}</option>
                {categoryOptions.map(cat => (
                  <option key={cat} value={cat}>
                    {getCategoryLabel(cat, language as 'ar' | 'en')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="group" className="block text-sm font-medium text-gray-700 dark:text-gray-300">المجموعة</label>
              <select
                name="group"
                id="group"
                value={String((item as any).group || '')}
                onChange={handleChange}
                className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              >
                <option value="">{language === 'ar' ? 'بدون مجموعة' : 'No group'}</option>
                {groupOptions.map(gk => (
                  <option key={gk} value={gk}>
                    {getGroupLabel(gk, String(item.category || ''), language as 'ar' | 'en')}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="unitType" className="block text-sm font-medium text-gray-700 dark:text-gray-300">نوع الوحدة</label>
              <select
                name="unitType"
                id="unitType"
                value={item.unitType || ''}
                onChange={handleChange}
                className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                disabled={Boolean(itemToEdit) && hasReceipts}
              >
                <option value="">{language === 'ar' ? 'اختر نوع وحدة' : 'Select unit type'}</option>
                {unitOptions.map(unit => (
                  <option key={unit} value={unit}>
                    {getUnitLabel(unit as UnitType, language as 'ar' | 'en')}
                  </option>
                ))}
              </select>
            </div>

            <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 p-4">
              <summary className="cursor-pointer select-none font-semibold text-gray-900 dark:text-gray-100">
                إعدادات متقدمة (اختياري)
              </summary>

              <div className="mt-4 space-y-6">
                {onManageMeta && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <button type="button" onClick={() => onManageMeta('category')} className="px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-sm font-semibold text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                      إدارة الفئات
                    </button>
                    <button type="button" onClick={() => onManageMeta('group')} className="px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-sm font-semibold text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                      إدارة المجموعات
                    </button>
                    <button type="button" onClick={() => onManageMeta('unit')} className="px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-sm font-semibold text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                      إدارة الوحدات
                    </button>
                    <button type="button" onClick={() => onManageMeta('freshness')} className="px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-sm font-semibold text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                      إدارة النضارة
                    </button>
                  </div>
                )}

                <div className="flex flex-col items-center">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">صورة الصنف</label>
                  <ImageUploader value={item.imageUrl} onChange={handleImageChange} />
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-100 dark:border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">تفاصيل التكلفة</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">آخر سعر شراء</label>
                      <div className="w-full p-3 border rounded-md bg-gray-100 dark:bg-gray-600 text-gray-500 font-bold text-center">
                        {(Number(item.buyingPrice) || 0).toFixed(2)} {baseCode || '—'}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">تكلفة النقل</label>
                      <div className="w-full p-3 border rounded-md bg-gray-100 dark:bg-gray-600 text-gray-500 font-bold text-center">
                        {(Number(item.transportCost) || 0).toFixed(2)} {baseCode || '—'}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">ضريبة التوريد</label>
                      <div className="w-full p-3 border rounded-md bg-gray-100 dark:bg-gray-600 text-gray-500 font-bold text-center">
                        {(Number(item.supplyTaxCost) || 0).toFixed(2)} {baseCode || '—'}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">إجمالي التكلفة</label>
                      <div className="w-full p-3 border rounded-md bg-gray-100 dark:bg-gray-600 text-gray-500 font-bold text-center">
                        {(Number(item.costPrice) || 0).toFixed(2)} {baseCode || '—'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t dark:border-gray-600">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">متوسط تكلفة المخزون</label>
                    <div className="w-full p-3 border rounded-md bg-gray-100 dark:bg-gray-600 text-gray-500 font-bold text-center">
                      {(() => {
                        const stock = itemToEdit?.id ? getStockByItemId(itemToEdit.id) : undefined;
                        return `${(Number(stock?.avgCost) || 0).toFixed(2)} ${baseCode || '—'}`;
                      })()}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">الكمية المتوفرة</label>
                      <NumberInput
                      id="availableStock"
                      name="availableStock"
                      value={item.availableStock || 0}
                      onChange={handleNumberChange}
                      min={0}
                        step={(item.unitType === 'kg' || item.unitType === 'gram') ? 0.5 : 1}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">أقل كمية للطلب</label>
                    <NumberInput
                      id="minWeight"
                      name="minWeight"
                      value={item.minWeight || 0}
                      onChange={handleNumberChange}
                      min={0}
                      step={0.1}
                    />
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-100 dark:border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">وحدات العبوة</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">حجم الباكت (Pack)</label>
                      <NumberInput
                        id="packSize"
                        name="packSize"
                        value={(item as any).packSize || 0}
                        onChange={handleNumberChange}
                        min={0}
                        step={1}
                        disabled={item.unitType === 'kg' || item.unitType === 'gram'}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">حجم الكرتون (Carton)</label>
                      <NumberInput
                        id="cartonSize"
                        name="cartonSize"
                        value={(item as any).cartonSize || 0}
                        onChange={handleNumberChange}
                        min={0}
                        step={1}
                        disabled={item.unitType === 'kg' || item.unitType === 'gram'}
                      />
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t dark:border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">وحدات إضافية</h4>
                      <button
                        type="button"
                        onClick={addUomUnitRow}
                        disabled={item.unitType === 'kg' || item.unitType === 'gram'}
                        className="px-3 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200"
                      >
                        إضافة
                      </button>
                    </div>
                    {Array.isArray((item as any).uomUnits) && (item as any).uomUnits.length > 0 ? (
                      <div className="space-y-2">
                        {(item as any).uomUnits.map((u: any, idx: number) => (
                          <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                            <div className="md:col-span-4">
                              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">الرمز</label>
                              <input
                                type="text"
                                value={String(u?.code || '')}
                                disabled={item.unitType === 'kg' || item.unitType === 'gram'}
                                onChange={(e) => updateUomUnit(idx, { code: e.target.value })}
                                className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                                placeholder="box"
                              />
                            </div>
                            <div className="md:col-span-4">
                              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">الاسم</label>
                              <input
                                type="text"
                                value={String(u?.name || '')}
                                disabled={item.unitType === 'kg' || item.unitType === 'gram'}
                                onChange={(e) => updateUomUnit(idx, { name: e.target.value })}
                                className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                                placeholder="Box"
                              />
                            </div>
                            <div className="md:col-span-3">
                              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">كم حبة داخلها</label>
                              <NumberInput
                                id={`uomUnits.${idx}.qtyInBase`}
                                name={`uomUnits.${idx}.qtyInBase`}
                                value={Number(u?.qtyInBase || 0)}
                                disabled={item.unitType === 'kg' || item.unitType === 'gram'}
                                onChange={(e) => {
                                  const parsed = parseFloat(e.target.value);
                                  const numeric = Number.isFinite(parsed) ? parsed : 0;
                                  updateUomUnit(idx, { qtyInBase: numeric });
                                }}
                                min={0}
                                step={1}
                              />
                            </div>
                            <div className="md:col-span-1 flex md:justify-end">
                              <button
                                type="button"
                                onClick={() => removeUomUnitRow(idx)}
                                disabled={item.unitType === 'kg' || item.unitType === 'gram'}
                                className="px-3 py-2 text-xs rounded bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 text-red-700 dark:text-red-200"
                              >
                                حذف
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 dark:text-gray-400">لا توجد وحدات إضافية.</div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="freshnessLevel" className="block text-sm font-medium text-gray-700 dark:text-gray-300">مستوى الطازجية</label>
                    <select name="freshnessLevel" id="freshnessLevel" value={item.freshnessLevel || ''} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600">
                      <option value="">{language === 'ar' ? 'اختر مستوى' : 'Select freshness'}</option>
                      {freshnessOptions.map(level => (
                        <option key={level} value={level}>
                          {getFreshnessLabel(level as FreshnessLevel, language as 'ar' | 'en')}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('addons')}</label>
                  <div className="p-2 border rounded-md dark:border-gray-600 max-h-48 overflow-y-auto space-y-2 bg-white dark:bg-gray-800">
                    {availableAddons.map(addon => {
                      const isSelected = item.addons?.some(a => a.id === addon.id) || false;
                      const isDefault = item.addons?.find(a => a.id === addon.id)?.isDefault || false;

                      return (
                        <div key={addon.id} className={`p-2 rounded-md flex justify-between items-center ${isSelected ? 'bg-orange-50 dark:bg-gray-700' : 'hover:bg-gray-50 dark:hover:bg-gray-900/50'}`}>
                          <label className="flex items-center space-x-2 rtl:space-x-reverse cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleAddonToggle(addon)}
                              className="form-checkbox h-4 w-4 text-orange-600 rounded focus:ring-orange-500"
                            />
                            <span className="text-sm dark:text-gray-300">{addon.name[language]}</span>
                          </label>

                          {isSelected && (
                            <label className="flex items-center space-x-2 rtl:space-x-reverse text-xs cursor-pointer text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white">
                              <input
                                type="checkbox"
                                checked={isDefault}
                                onChange={(e) => handleSetDefaultToggle(addon.id, e.target.checked)}
                                className="form-checkbox h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                              />
                              <span>افتراضي</span>
                            </label>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                  <div>
                    <label htmlFor="status" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الحالة</label>
                    <select name="status" id="status" value={item.status} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600">
                      <option value="active">نشط</option>
                      <option value="archived">مؤرشف</option>
                    </select>
                  </div>
                  <div>
                    <label className="flex items-center space-x-2 rtl:space-x-reverse mt-6 p-3 bg-gray-50 dark:bg-gray-700 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600">
                      <input type="checkbox" name="sellable" id="sellable" checked={Boolean((item as any).sellable ?? true)} onChange={handleChange} className="form-checkbox h-5 w-5 text-orange-600 rounded focus:ring-orange-500" />
                      <span className="font-semibold text-gray-700 dark:text-gray-300">إتاحة البيع (Sellable)</span>
                    </label>
                  </div>
                  <div>
                    <label className="flex items-center space-x-2 rtl:space-x-reverse mt-6 p-3 bg-gray-50 dark:bg-gray-700 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600">
                      <input type="checkbox" name="isFeatured" id="isFeatured" checked={item.isFeatured} onChange={handleChange} className="form-checkbox h-5 w-5 text-orange-600 rounded focus:ring-orange-500" />
                      <span className="font-semibold text-gray-700 dark:text-gray-300">{t('markAsFeatured')}</span>
                    </label>
                  </div>
                </div>
              </div>
            </details>

            {formError && (
              <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
              </div>
            )}
          </div>
          {/* Footer */}
          <div className="p-6 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 disabled:opacity-50 font-medium transition-colors"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isSaving || Boolean(formError)}
              className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium shadow-md transition-colors w-32 flex justify-center"
            >
              {isSaving ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : t('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ItemFormModal;
