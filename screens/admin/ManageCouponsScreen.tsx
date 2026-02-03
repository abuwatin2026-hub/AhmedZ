import React, { useState } from 'react';
import { useCoupons } from '../../contexts/CouponContext';
import { useToast } from '../../contexts/ToastContext';
import { useSettings } from '../../contexts/SettingsContext';
import { Coupon } from '../../types';
import ConfirmationModal from '../../components/admin/ConfirmationModal';
import CouponFormModal from '../../components/admin/CouponFormModal';
import { EditIcon, TrashIcon } from '../../components/icons';

const ManageCouponsScreen: React.FC = () => {
  const { coupons, addCoupon, updateCoupon, deleteCoupon } = useCoupons();
  const { showNotification } = useToast();
  const { settings } = useSettings();
  const baseCode = String((settings as any)?.baseCurrency || '').toUpperCase() || '—';

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentCoupon, setCurrentCoupon] = useState<Coupon | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleOpenFormModal = (coupon: Coupon | null = null) => {
    setCurrentCoupon(coupon);
    setIsFormModalOpen(true);
  };
  
  const handleOpenDeleteModal = (coupon: Coupon) => {
    setCurrentCoupon(coupon);
    setIsDeleteModalOpen(true);
  };

  const handleSaveCoupon = async (coupon: Omit<Coupon, 'id'> | Coupon) => {
    setIsProcessing(true);
    if ('id' in coupon && coupon.id) {
        await updateCoupon(coupon);
        showNotification('تم تحديث الكوبون بنجاح!', 'success');
    } else {
        await addCoupon(coupon);
        showNotification('تمت إضافة الكوبون بنجاح!', 'success');
    }
    setIsProcessing(false);
    setIsFormModalOpen(false);
  };

  const handleDeleteCoupon = async () => {
    if (currentCoupon) {
        setIsProcessing(true);
        await deleteCoupon(currentCoupon.id);
        showNotification('تم حذف الكوبون بنجاح!', 'success');
        setIsProcessing(false);
    }
    setIsDeleteModalOpen(false);
  };

  const getCouponTypeLabel = (type: string) => {
    return type === 'percentage' ? 'نسبة مئوية' : 'مبلغ ثابت';
  };

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <h1 className="text-3xl font-bold dark:text-white">إدارة الكوبونات</h1>
        <button
          onClick={() => handleOpenFormModal()}
          className="bg-primary-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-primary-600 transition-colors"
        >
          إضافة كوبون
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">كود الكوبون</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">نوع الكوبون</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">قيمة الكوبون</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {coupons.map((coupon) => (
                <tr key={coupon.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-3 py-1 text-sm font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300 font-mono">
                      {coupon.code}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{getCouponTypeLabel(coupon.type)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-bold">
                    {coupon.type === 'percentage' ? `${coupon.value}%` : `${coupon.value.toFixed(2)} ${baseCode}`}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2 rtl:space-x-reverse">
                    <button onClick={() => handleOpenFormModal(coupon)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-200 p-1"><EditIcon /></button>
                    <button onClick={() => handleOpenDeleteModal(coupon)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200 p-1"><TrashIcon /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      <CouponFormModal 
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        onSave={handleSaveCoupon}
        couponToEdit={currentCoupon}
        isSaving={isProcessing}
      />
      
       <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteCoupon}
        title="تأكيد الحذف"
        message={`هل أنت متأكد من رغبتك في حذف الكوبون "${currentCoupon?.code}"؟`}
        isConfirming={isProcessing}
      />

    </div>
  );
};

export default ManageCouponsScreen;
