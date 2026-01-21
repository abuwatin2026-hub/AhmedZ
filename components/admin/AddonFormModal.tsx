
import React, { useRef, useState, useEffect } from 'react';
import { Addon, LocalizedString } from '../../types';
import { useSettings } from '../../contexts/SettingsContext';
import { translateArToEn } from '../../utils/translations';

interface AddonFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (addon: Omit<Addon, 'id'> | Addon) => void;
  addonToEdit: Addon | null;
  isSaving: boolean;
}

const AddonFormModal: React.FC<AddonFormModalProps> = ({ isOpen, onClose, onSave, addonToEdit, isSaving }) => {
  const { t } = useSettings();

  type AddonDraft = { name: LocalizedString; price: number; size: LocalizedString };

  const getInitialFormState = (): AddonDraft => ({
    name: { ar: '', en: '' },
    price: 0,
    size: { ar: '', en: '' },
  });

  const [addon, setAddon] = useState<AddonDraft>(getInitialFormState());
  const [touchedEn, setTouchedEn] = useState({ name: false, size: false });

  const nameTranslateTimer = useRef<number | null>(null);
  const sizeTranslateTimer = useRef<number | null>(null);
  const lastNameTranslateId = useRef(0);
  const lastSizeTranslateId = useRef(0);

  useEffect(() => {
    if (addonToEdit) {
      setAddon({
        name: addonToEdit.name,
        price: addonToEdit.price,
        size: addonToEdit.size || { ar: '', en: '' },
      });
    } else {
      setAddon(getInitialFormState());
    }
    setTouchedEn({ name: false, size: false });
  }, [addonToEdit, isOpen]);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setAddon(prev => ({...prev, [name]: name === 'price' ? parseFloat(value) : value }));
  };

  const handleLocalizedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const [field, lang] = name.split('.');

    if (lang === 'en' && value.trim()) {
      setTouchedEn(prev => ({ ...prev, [field]: true }));
    }

    setAddon(prev => ({
      ...prev,
      [field]: {
        ...(prev[field as keyof typeof prev] as object),
        [lang]: value,
      },
    }));

    if (lang === 'ar' && value.trim()) {
      if (field === 'name' && !touchedEn.name) {
        if (nameTranslateTimer.current) window.clearTimeout(nameTranslateTimer.current);
        const translateId = ++lastNameTranslateId.current;
        nameTranslateTimer.current = window.setTimeout(async () => {
          const translated = await translateArToEn(value);
          if (!translated) return;
          if (translateId !== lastNameTranslateId.current) return;
          setAddon(prev => ({ ...prev, name: { ...prev.name, en: prev.name.en?.trim() ? prev.name.en : translated } }));
        }, 450);
      }
      if (field === 'size' && !touchedEn.size) {
        if (sizeTranslateTimer.current) window.clearTimeout(sizeTranslateTimer.current);
        const translateId = ++lastSizeTranslateId.current;
        sizeTranslateTimer.current = window.setTimeout(async () => {
          const translated = await translateArToEn(value);
          if (!translated) return;
          if (translateId !== lastSizeTranslateId.current) return;
          setAddon(prev => ({ ...prev, size: { ...prev.size, en: prev.size.en?.trim() ? prev.size.en : translated } }));
        }, 450);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalAddon = { ...addon, size: (addon.size?.ar || addon.size?.en) ? addon.size : undefined };
    onSave(addonToEdit ? { ...finalAddon, id: addonToEdit.id } : finalAddon);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md animate-fade-in-up max-h-[min(90dvh,calc(100dvh-2rem))] overflow-hidden flex flex-col">
        <div className="p-6 border-b dark:border-gray-700">
          <h2 className="text-xl font-bold dark:text-white">{addonToEdit ? t('editAddon') : t('addAddon')}</h2>
        </div>
        <form onSubmit={handleSubmit} className="min-h-0 flex-1 flex flex-col">
          <div className="p-6 space-y-4 overflow-y-auto min-h-0 flex-1">
            <div>
              <label htmlFor="name.ar" className="block text-sm font-medium text-gray-700 dark:text-gray-300">اسم الإضافة (بالعربية)</label>
              <input type="text" name="name.ar" id="name.ar" value={addon.name.ar} onChange={handleLocalizedChange} required className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
            </div>
            <div>
              <label htmlFor="name.en" className="block text-sm font-medium text-gray-700 dark:text-gray-300">اسم الإضافة (بالإنجليزية)</label>
              <input type="text" name="name.en" id="name.en" value={addon.name.en || ''} onChange={handleLocalizedChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
            </div>
             <div>
              <label htmlFor="size.ar" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الحجم (بالعربية - اختياري)</label>
              <input type="text" name="size.ar" id="size.ar" value={addon.size.ar} onChange={handleLocalizedChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
            </div>
            <div>
              <label htmlFor="size.en" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الحجم (بالإنجليزية - اختياري)</label>
              <input type="text" name="size.en" id="size.en" value={addon.size.en || ''} onChange={handleLocalizedChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
            </div>
            <div>
              <label htmlFor="price" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('price')}</label>
              <input type="number" name="price" id="price" value={addon.price} onChange={handleChange} required min="0" step="0.01" className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
            </div>
          </div>
          <div className="p-6 bg-gray-50 dark:bg-gray-700 flex justify-end space-x-3 rtl:space-x-reverse shrink-0">
            <button type="button" onClick={onClose} disabled={isSaving} className="py-2 px-4 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:opacity-50">إلغاء</button>
            <button type="submit" disabled={isSaving} className="py-2 px-4 bg-primary-500 text-white rounded-md hover:bg-primary-600 w-24 disabled:bg-primary-400 disabled:cursor-wait">
                {isSaving ? 'جاري...' : 'حفظ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddonFormModal;
