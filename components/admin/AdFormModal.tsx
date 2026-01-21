import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Ad } from '../../types';
import { useMenu } from '../../contexts/MenuContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useItemMeta } from '../../contexts/ItemMetaContext';
import { translateArToEn } from '../../utils/translations';

interface AdFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (ad: Omit<Ad, 'id' | 'order'> | Ad) => void;
  adToEdit: Ad | null;
  isSaving: boolean;
}

const AdFormModal: React.FC<AdFormModalProps> = ({ isOpen, onClose, onSave, adToEdit, isSaving }) => {
  const { menuItems } = useMenu();
  const { t, language } = useSettings();
  const { categories: categoryDefs, getCategoryLabel } = useItemMeta();

  const getInitialFormState = (): Omit<Ad, 'id' | 'order'> => ({
    title: { ar: '', en: '' },
    subtitle: { ar: '', en: '' },
    imageUrl: '',
    actionType: 'none',
    actionTarget: undefined,
    status: 'active',
  });

  const [ad, setAd] = useState(getInitialFormState());
  const [touchedEn, setTouchedEn] = useState({ title: false, subtitle: false });

  const titleTranslateTimer = useRef<number | null>(null);
  const subtitleTranslateTimer = useRef<number | null>(null);
  const lastTitleTranslateId = useRef(0);
  const lastSubtitleTranslateId = useRef(0);

  useEffect(() => {
    if (adToEdit) {
      setAd({
        title: adToEdit.title,
        subtitle: adToEdit.subtitle,
        imageUrl: adToEdit.imageUrl,
        actionType: adToEdit.actionType,
        actionTarget: adToEdit.actionTarget,
        status: adToEdit.status,
      });
    } else {
      setAd(getInitialFormState());
    }
    setTouchedEn({ title: false, subtitle: false });
  }, [adToEdit, isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'actionType') {
      setAd(prev => ({ ...prev, actionType: value as Ad['actionType'], actionTarget: undefined }));
    } else {
      setAd(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleLocalizedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const [field, lang] = name.split('.');
    
    if (lang === 'en' && value.trim()) {
      setTouchedEn(prev => ({ ...prev, [field]: true } as any));
    }

    setAd(prev => ({
      ...prev,
      [field]: {
        ...(prev[field as 'title' | 'subtitle']),
        [lang]: value,
      },
    }));

    if (lang === 'ar' && value.trim()) {
      if (field === 'title' && !touchedEn.title) {
        if (titleTranslateTimer.current) window.clearTimeout(titleTranslateTimer.current);
        const translateId = ++lastTitleTranslateId.current;
        titleTranslateTimer.current = window.setTimeout(async () => {
          const translated = await translateArToEn(value);
          if (!translated) return;
          if (translateId !== lastTitleTranslateId.current) return;
          setAd(prev => ({ ...prev, title: { ...prev.title, en: prev.title.en?.trim() ? prev.title.en : translated } }));
        }, 500);
      }
      if (field === 'subtitle' && !touchedEn.subtitle) {
        if (subtitleTranslateTimer.current) window.clearTimeout(subtitleTranslateTimer.current);
        const translateId = ++lastSubtitleTranslateId.current;
        subtitleTranslateTimer.current = window.setTimeout(async () => {
          const translated = await translateArToEn(value);
          if (!translated) return;
          if (translateId !== lastSubtitleTranslateId.current) return;
          setAd(prev => ({ ...prev, subtitle: { ...prev.subtitle, en: prev.subtitle.en?.trim() ? prev.subtitle.en : translated } }));
        }, 650);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(adToEdit ? { ...ad, id: adToEdit.id, order: adToEdit.order } : ad);
  };

  const categories = useMemo(() => {
    const activeKeys = categoryDefs.filter(c => c.isActive).map(c => c.key);
    const usedKeys = [...new Set(menuItems.map(item => item.category))].filter(Boolean);
    return Array.from(new Set([...activeKeys, ...usedKeys])).sort((a, b) => a.localeCompare(b));
  }, [categoryDefs, menuItems]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl animate-fade-in-up max-h-[min(90dvh,calc(100dvh-2rem))] overflow-hidden flex flex-col">
        <div className="p-6 border-b dark:border-gray-700">
          <h2 className="text-xl font-bold dark:text-white">{adToEdit ? t('editAd') : t('addAd')}</h2>
        </div>
        <form onSubmit={handleSubmit} className="min-h-0 flex-1 flex flex-col">
          <div className="p-6 space-y-4 overflow-y-auto min-h-0 flex-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="title.ar" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('adTitle')} (AR)</label>
                <input type="text" name="title.ar" id="title.ar" value={ad.title.ar} onChange={handleLocalizedChange} required className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
              </div>
              <div>
                <label htmlFor="title.en" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('adTitle')} (EN)</label>
                <input type="text" name="title.en" id="title.en" value={ad.title.en || ''} onChange={handleLocalizedChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
              </div>
            </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="subtitle.ar" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('adSubtitle')} (AR)</label>
                <input type="text" name="subtitle.ar" id="subtitle.ar" value={ad.subtitle.ar} onChange={handleLocalizedChange} required className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
              </div>
              <div>
                <label htmlFor="subtitle.en" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('adSubtitle')} (EN)</label>
                <input type="text" name="subtitle.en" id="subtitle.en" value={ad.subtitle.en || ''} onChange={handleLocalizedChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
              </div>
            </div>
            <div>
              <label htmlFor="imageUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('imageUrl')}</label>
              <input type="url" name="imageUrl" id="imageUrl" value={ad.imageUrl} onChange={handleChange} required className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
              {ad.imageUrl && <img src={ad.imageUrl} alt="Preview" className="mt-2 rounded-md max-h-32 object-cover" />}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label htmlFor="actionType" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('actionType')}</label>
                    <select name="actionType" id="actionType" value={ad.actionType} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600">
                        <option value="none">{t('none')}</option>
                        <option value="item">{t('navigateToItem')}</option>
                        <option value="category">{t('navigateToCategory')}</option>
                    </select>
                </div>
                <div>
                    <label htmlFor="actionTarget" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('actionTarget')}</label>
                    {ad.actionType === 'item' && (
                        <select name="actionTarget" id="actionTarget" value={ad.actionTarget || ''} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600">
                            <option value="">{t('selectAnItem')}</option>
                            {menuItems.map(item => <option key={item.id} value={item.id}>{item.name?.[language] || item.name?.ar || item.name?.en || item.id}</option>)}
                        </select>
                    )}
                    {ad.actionType === 'category' && (
                        <select name="actionTarget" id="actionTarget" value={ad.actionTarget || ''} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600">
                             <option value="">{t('selectACategory')}</option>
                            {categories.map(cat => <option key={cat} value={cat}>{getCategoryLabel(cat, language as 'ar' | 'en')}</option>)}
                        </select>
                    )}
                    {ad.actionType === 'none' && (
                         <input type="text" value="-" disabled className="mt-1 w-full p-2 border rounded-md bg-gray-100 dark:bg-gray-800 dark:border-gray-600"/>
                    )}
                </div>
            </div>
             <div>
                <label htmlFor="status" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('adStatus')}</label>
                <select name="status" id="status" value={ad.status} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600">
                    <option value="active">{t('active')}</option>
                    <option value="inactive">{t('inactive')}</option>
                </select>
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

export default AdFormModal;
