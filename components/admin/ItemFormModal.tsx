import React, { useState, useEffect } from 'react';
import { MenuItem, Addon, UnitType, FreshnessLevel } from '../../types';
import { useMenu } from '../../contexts/MenuContext';
import { useAddons } from '../../contexts/AddonContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import { useItemMeta } from '../../contexts/ItemMetaContext';
import ImageUploader from '../ImageUploader';
import NumberInput from '../NumberInput';
import { getSupabaseClient } from '../../supabase';

interface ItemFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: Omit<MenuItem, 'id'> | MenuItem) => void;
  itemToEdit: MenuItem | null;
  isSaving: boolean;
  onManageMeta?: (kind: 'category' | 'unit' | 'freshness') => void;
}

const ItemFormModal: React.FC<ItemFormModalProps> = ({ isOpen, onClose, onSave, itemToEdit, isSaving, onManageMeta }) => {
  const { menuItems } = useMenu();
  const { addons: availableAddons } = useAddons();
  const { t, language } = useSettings();
  const { hasPermission } = useAuth();
  const { categories, unitTypes, freshnessLevels, getCategoryLabel, getUnitLabel, getFreshnessLabel } = useItemMeta();

  const getInitialFormState = (): Omit<MenuItem, 'id' | 'rating'> => ({
    ...((): Pick<MenuItem, 'category' | 'unitType' | 'freshnessLevel' | 'minWeight'> => {
      const activeCategoryKeys = categories.filter(c => c.isActive).map(c => c.key);
      const fallbackCategoryKeys = [...new Set(menuItems.map(i => i.category))].filter(Boolean);
      const category = activeCategoryKeys[0] || fallbackCategoryKeys[0] || 'grocery';

      const activeUnitKeys = unitTypes.filter(u => u.isActive).map(u => String(u.key) as UnitType);
      const unitType = activeUnitKeys[0] || ('kg' as UnitType);

      const activeFreshnessKeys = freshnessLevels.filter(f => f.isActive).map(f => String(f.key) as FreshnessLevel);
      const freshnessLevel = activeFreshnessKeys[0] || ('fresh' as FreshnessLevel);

      const minWeight = unitType === 'kg' || unitType === 'gram' ? 0.5 : 1;

      return { category, unitType, freshnessLevel, minWeight };
    })(),
    name: { ar: '', en: '' },
    description: { ar: '', en: '' },
    price: 0,
    costPrice: 0,
    imageUrl: 'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22800%22 height=%22800%22><defs><linearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22><stop offset=%220%22 stop-color=%22%237FA99B%22/><stop offset=%221%22 stop-color=%22%232F5D62%22/></linearGradient></defs><rect width=%22100%%22 height=%22100%%22 fill=%22url(%23g)%22/></svg>',
    status: 'active',
    addons: [],
    isFeatured: false,
    availableStock: 0,
    buyingPrice: 0,
    transportCost: 0,
    supplyTaxCost: 0,
  });

  const [item, setItem] = useState(getInitialFormState());
  const [hasReceipts, setHasReceipts] = useState(false);
  const [dateError, setDateError] = useState<string>('');
  const [formError, setFormError] = useState<string>('');

  useEffect(() => {
    if (itemToEdit) {
      setItem({
        name: itemToEdit.name,
        description: itemToEdit.description,
        price: itemToEdit.price,
        costPrice: itemToEdit.costPrice || 0,
        imageUrl: itemToEdit.imageUrl,
        category: itemToEdit.category,
        status: itemToEdit.status || 'active',
        addons: itemToEdit.addons || [],
        isFeatured: itemToEdit.isFeatured || false,
        unitType: itemToEdit.unitType || 'kg',
        availableStock: itemToEdit.availableStock || 0,
        freshnessLevel: itemToEdit.freshnessLevel || 'fresh',
        productionDate: itemToEdit.productionDate || (itemToEdit as any).harvestDate,
        expiryDate: itemToEdit.expiryDate,
        minWeight: itemToEdit.minWeight || 0.5,
        pricePerUnit: itemToEdit.pricePerUnit,
        buyingPrice: itemToEdit.buyingPrice || 0,
        transportCost: itemToEdit.transportCost || 0,
        supplyTaxCost: itemToEdit.supplyTaxCost || 0,
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
    const h = (item as any).productionDate || '';
    const e = item.expiryDate || '';
    if (h && e && h > e) {
      setDateError(language === 'ar' ? 'تاريخ الإنتاج يجب أن يسبق تاريخ الانتهاء' : 'Production date must be before expiry');
    } else {
      setDateError('');
    }
  }, [(item as any).productionDate, item.expiryDate, language]);

  useEffect(() => {
    const nameAr = (item.name?.ar || '').trim();
    const descAr = (item.description?.ar || '').trim();
    const price = Number(item.price);
    const availableStock = Number(item.availableStock ?? 0);
    const minWeight = Number(item.minWeight ?? 0);
    const category = String(item.category || '').trim();
    const unitType = String(item.unitType || '').trim();

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
    if (unitType !== 'kg' && unitType !== 'gram' && !Number.isInteger(minWeight)) {
      setFormError(language === 'ar' ? 'أقل كمية للطلب يجب أن تكون رقم صحيح للوحدات غير الوزنية' : 'Minimum order must be an integer for non-weight units');
      return;
    }

    setFormError('');
  }, [item, language]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setItem(prev => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      if (name === 'buyingPrice' || name === 'transportCost' || name === 'supplyTaxCost') {
        const val = parseFloat(value) || 0;
        setItem(prev => {
          const newState = { ...prev, [name]: val };
          // Auto-calculate total cost
          const b = name === 'buyingPrice' ? val : (newState.buyingPrice || 0);
          const t = name === 'transportCost' ? val : (newState.transportCost || 0);
          const s = name === 'supplyTaxCost' ? val : (newState.supplyTaxCost || 0);
          return { ...newState, costPrice: b + t + s };
        });
        return;
      }
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
      const next = { ...prev, [name]: numeric } as typeof prev;
      if (name === 'buyingPrice' || name === 'transportCost' || name === 'supplyTaxCost') {
        const buyingPrice = name === 'buyingPrice' ? numeric : (Number(next.buyingPrice) || 0);
        const transportCost = name === 'transportCost' ? numeric : (Number(next.transportCost) || 0);
        const supplyTaxCost = name === 'supplyTaxCost' ? numeric : (Number(next.supplyTaxCost) || 0);
        return { ...next, costPrice: buyingPrice + transportCost + supplyTaxCost };
      }
      return next;
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
    const safeItem = itemToEdit && !canEditPrice ? { ...item, price: itemToEdit.price } : item;
    onSave(itemToEdit ? { ...safeItem, id: itemToEdit.id } : safeItem);
  };

  const categoryOptions = React.useMemo(() => {
    const active = categories.filter(c => c.isActive).map(c => c.key);
    const existing = itemToEdit?.category;
    if (existing && !active.includes(existing)) return [existing, ...active];
    if (active.length > 0) return active;
    const fallback = [...new Set(menuItems.map(i => i.category))].filter(Boolean);
    return fallback.length > 0 ? fallback : ['grocery'];
  }, [categories, itemToEdit?.category, menuItems]);

  const unitOptions = React.useMemo(() => {
    const active = unitTypes.filter(u => u.isActive).map(u => String(u.key));
    const existing = itemToEdit?.unitType ? String(itemToEdit.unitType) : undefined;
    if (existing && !active.includes(existing)) return [existing, ...active];
    if (active.length > 0) return active;
    return ['kg', 'gram', 'piece', 'bundle'];
  }, [unitTypes, itemToEdit?.unitType]);

  const freshnessOptions = React.useMemo(() => {
    const active = freshnessLevels.filter(f => f.isActive).map(f => String(f.key));
    const existing = itemToEdit?.freshnessLevel ? String(itemToEdit.freshnessLevel) : undefined;
    if (existing && !active.includes(existing)) return [existing, ...active];
    if (active.length > 0) return active;
    return ['fresh', 'good', 'acceptable'];
  }, [freshnessLevels, itemToEdit?.freshnessLevel]);

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

            <div className="mb-4 flex flex-col items-center">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">صورة الصنف</label>
              <ImageUploader value={item.imageUrl} onChange={handleImageChange} />
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

            <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg border border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">تفاصيل التكلفة</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">سعر الشراء (الأساسي)</label>
                  <NumberInput
                    id="buyingPrice"
                    name="buyingPrice"
                    value={item.buyingPrice || 0}
                    onChange={handleNumberChange}
                    min={0}
                    step={0.5}
                    placeholder="0"
                    disabled={hasReceipts || !hasPermission('stock.manage')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">تكلفة النقل</label>
                  <NumberInput
                    id="transportCost"
                    name="transportCost"
                    value={item.transportCost || 0}
                    onChange={handleNumberChange}
                    min={0}
                    step={0.5}
                    placeholder="0"
                    disabled={hasReceipts || !hasPermission('stock.manage')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">قيمة الضريبة</label>
                  <NumberInput
                    id="supplyTaxCost"
                    name="supplyTaxCost"
                    value={item.supplyTaxCost || 0}
                    onChange={handleNumberChange}
                    min={0}
                    step={0.5}
                    placeholder="0"
                    disabled={hasReceipts || !hasPermission('stock.manage')}
                  />
                </div>
              </div>
              <div className="mt-3 pt-3 border-t dark:border-gray-600">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">إجمالي التكلفة (تلقائي)</label>
                <div className="w-full p-3 border rounded-md bg-gray-100 dark:bg-gray-600 text-gray-500 font-bold text-center">
                  {item.costPrice}
                </div>
              </div>
            </div>

          <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
            <div>
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الفئة</label>
                  {onManageMeta && (
                    <button type="button" onClick={() => onManageMeta('category')} className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                      إدارة
                    </button>
                  )}
                </div>
                <select name="category" id="category" value={item.category} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600">
                  {categoryOptions.map(cat => (
                    <option key={cat} value={cat}>
                      {getCategoryLabel(cat, language as 'ar' | 'en')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* New Fields for Weight-Based Products */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="unitType" className="block text-sm font-medium text-gray-700 dark:text-gray-300">نوع الوحدة</label>
                  {onManageMeta && (
                    <button type="button" onClick={() => onManageMeta('unit')} className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                      إدارة
                    </button>
                  )}
                </div>
                <select
                  name="unitType"
                  id="unitType"
                  value={item.unitType || 'kg'}
                  onChange={handleChange}
                  className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                  disabled={Boolean(itemToEdit) && hasReceipts}
                >
                  {unitOptions.map(unit => (
                    <option key={unit} value={unit}>
                      {getUnitLabel(unit as UnitType, language as 'ar' | 'en')}
                    </option>
                  ))}
                </select>
              </div>
              {/* Stock and Weight */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">الكمية المتوفرة</label>
                  <NumberInput
                    id="availableStock"
                    name="availableStock"
                    value={item.availableStock || 0}
                    onChange={handleNumberChange}
                    min={0}
                    step={item.unitType === 'kg' || item.unitType === 'gram' ? 0.5 : 1}
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
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="freshnessLevel" className="block text-sm font-medium text-gray-700 dark:text-gray-300">مستوى الطازجية</label>
                  {onManageMeta && (
                    <button type="button" onClick={() => onManageMeta('freshness')} className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                      إدارة
                    </button>
                  )}
                </div>
                <select name="freshnessLevel" id="freshnessLevel" value={item.freshnessLevel || 'fresh'} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600">
                  {freshnessOptions.map(level => (
                    <option key={level} value={level}>
                      {getFreshnessLabel(level as FreshnessLevel, language as 'ar' | 'en')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="productionDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300">تاريخ الإنتاج</label>
              <input type="date" name="productionDate" id="productionDate" value={(item as any).productionDate || ''} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600" />
            </div>
            <div>
              <label htmlFor="expiryDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300">تاريخ الانتهاء</label>
              <input type="date" name="expiryDate" id="expiryDate" value={item.expiryDate || ''} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600" />
            </div>
            {dateError && (
              <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{dateError}</p>
              </div>
            )}
            {formError && (
              <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
              </div>
            )}
          </div>

          {/* Addons Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('addons')}</label>
            <div className="p-2 border rounded-md dark:border-gray-600 max-h-48 overflow-y-auto space-y-2">
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
                <input type="checkbox" name="isFeatured" id="isFeatured" checked={item.isFeatured} onChange={handleChange} className="form-checkbox h-5 w-5 text-orange-600 rounded focus:ring-orange-500" />
                <span className="font-semibold text-gray-700 dark:text-gray-300">{t('markAsFeatured')}</span>
              </label>
            </div>
          </div>
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
              disabled={isSaving || Boolean(dateError) || Boolean(formError)}
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
