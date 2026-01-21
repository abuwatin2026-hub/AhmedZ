
import React, { useState, useEffect } from 'react';
import { Coupon } from '../../types';
import { useSettings } from '../../contexts/SettingsContext';

interface CouponFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (coupon: Omit<Coupon, 'id'> | Coupon) => void;
  couponToEdit: Coupon | null;
  isSaving: boolean;
}

const CouponFormModal: React.FC<CouponFormModalProps> = ({ isOpen, onClose, onSave, couponToEdit, isSaving }) => {
  const { t } = useSettings();

  const getInitialFormState = () => ({
    code: '',
    type: 'percentage' as 'percentage' | 'fixed',
    value: 0,
    minOrderAmount: 0,
    maxDiscount: 0,
    expiresAt: '',
    usageLimit: 0,
    isActive: true,
  });

  const [coupon, setCoupon] = useState(getInitialFormState());

  useEffect(() => {
    if (couponToEdit) {
      setCoupon({
        code: couponToEdit.code,
        type: couponToEdit.type,
        value: couponToEdit.value,
        minOrderAmount: couponToEdit.minOrderAmount || 0,
        maxDiscount: couponToEdit.maxDiscount || 0,
        expiresAt: couponToEdit.expiresAt ? couponToEdit.expiresAt.split('T')[0] : '',
        usageLimit: couponToEdit.usageLimit || 0,
        isActive: couponToEdit.isActive !== undefined ? couponToEdit.isActive : true,
      });
    } else {
      setCoupon(getInitialFormState());
    }
  }, [couponToEdit, isOpen]);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let finalValue: string | number | boolean = value;

    if (type === 'checkbox') {
        finalValue = (e.target as HTMLInputElement).checked;
    } else if (type === 'number' || name === 'value' || name === 'minOrderAmount' || name === 'maxDiscount' || name === 'usageLimit') {
        finalValue = parseFloat(value) || 0;
    } else if (name === 'code') {
        finalValue = value.toUpperCase();
    }

    setCoupon(prev => ({...prev, [name]: finalValue}));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalCoupon = {
        ...coupon,
        minOrderAmount: coupon.minOrderAmount || undefined,
        maxDiscount: coupon.maxDiscount || undefined,
        expiresAt: coupon.expiresAt ? new Date(coupon.expiresAt).toISOString() : undefined,
        usageLimit: coupon.usageLimit || undefined,
    };
    onSave(couponToEdit ? { ...finalCoupon, id: couponToEdit.id } : finalCoupon);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md animate-fade-in-up max-h-[min(90dvh,calc(100dvh-2rem))] overflow-hidden flex flex-col">
        <div className="p-6 border-b dark:border-gray-700">
          <h2 className="text-xl font-bold dark:text-white">{couponToEdit ? t('editCoupon') : t('addCoupon')}</h2>
        </div>
        <form onSubmit={handleSubmit} className="min-h-0 flex-1 flex flex-col">
          <div className="p-6 space-y-4 overflow-y-auto min-h-0 flex-1">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('couponCode')}</label>
              <input type="text" name="code" id="code" value={coupon.code} onChange={handleChange} required className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 font-mono uppercase"/>
            </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="type" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('couponType')}</label>
                  <select name="type" id="type" value={coupon.type} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600">
                    <option value="percentage">{t('percentage')}</option>
                    <option value="fixed">{t('fixed')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="value" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('couponValue')}</label>
                  <input type="number" name="value" id="value" value={coupon.value} onChange={handleChange} required min="0" className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
                   <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {coupon.type === 'percentage' ? 'أدخل النسبة (مثال: 20)' : `أدخل المبلغ بـ ${t('currency')}`}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="minOrderAmount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الحد الأدنى للطلب</label>
                  <input type="number" name="minOrderAmount" id="minOrderAmount" value={coupon.minOrderAmount} onChange={handleChange} min="0" className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
                </div>
                <div>
                  <label htmlFor="maxDiscount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">الحد الأقصى للخصم</label>
                  <input type="number" name="maxDiscount" id="maxDiscount" value={coupon.maxDiscount} onChange={handleChange} min="0" className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">اتركه 0 إذا لم يكن هناك حد أقصى</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="expiresAt" className="block text-sm font-medium text-gray-700 dark:text-gray-300">تاريخ الانتهاء</label>
                  <input type="date" name="expiresAt" id="expiresAt" value={coupon.expiresAt} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
                </div>
                <div>
                  <label htmlFor="usageLimit" className="block text-sm font-medium text-gray-700 dark:text-gray-300">عدد مرات الاستخدام</label>
                  <input type="number" name="usageLimit" id="usageLimit" value={coupon.usageLimit} onChange={handleChange} min="0" className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"/>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">اتركه 0 لعدد غير محدود</p>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <input 
                    type="checkbox" 
                    id="isActive" 
                    name="isActive" 
                    checked={coupon.isActive} 
                    onChange={handleChange}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="isActive" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    كوبون فعال
                </label>
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

export default CouponFormModal;
