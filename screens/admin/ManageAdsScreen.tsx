import React, { useState } from 'react';
import { useAds } from '../../contexts/AdContext';
import { useToast } from '../../contexts/ToastContext';
// import { useSettings } from '../../contexts/SettingsContext';
import { Ad } from '../../types';
import ConfirmationModal from '../../components/admin/ConfirmationModal';
import AdFormModal from '../../components/admin/AdFormModal';
import { EditIcon, TrashIcon } from '../../components/icons';
import Spinner from '../../components/Spinner';

const ManageAdsScreen: React.FC = () => {
  const { ads, addAd, updateAd, deleteAd, loading } = useAds();
  const { showNotification } = useToast();

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentAd, setCurrentAd] = useState<Ad | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleOpenFormModal = (ad: Ad | null = null) => {
    setCurrentAd(ad);
    setIsFormModalOpen(true);
  };
  
  const handleOpenDeleteModal = (ad: Ad) => {
    setCurrentAd(ad);
    setIsDeleteModalOpen(true);
  };

  const handleSaveAd = async (ad: Omit<Ad, 'id' | 'order'> | Ad) => {
    setIsProcessing(true);
    if ('id' in ad && ad.id) {
        await updateAd(ad);
        showNotification('تم تحديث الإعلان بنجاح!', 'success');
    } else {
        await addAd(ad);
        showNotification('تمت إضافة الإعلان بنجاح!', 'success');
    }
    setIsProcessing(false);
    setIsFormModalOpen(false);
  };

  const handleDeleteAd = async () => {
    if (currentAd) {
        setIsProcessing(true);
        await deleteAd(currentAd.id);
        showNotification('تم حذف الإعلان بنجاح!', 'success');
        setIsProcessing(false);
    }
    setIsDeleteModalOpen(false);
  };

  const getActionTypeLabel = (type: string) => {
    switch (type) {
      case 'link': return 'رابط خارجي';
      case 'category': return 'فئة';
      case 'item': return 'منتج';
      default: return type;
    }
  };

  const getStatusLabel = (status: string) => {
      return status === 'active' ? 'نشط' : 'غير نشط';
  };

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <h1 className="text-3xl font-bold dark:text-white">إدارة الإعلانات</h1>
        <button
          onClick={() => handleOpenFormModal()}
          className="bg-primary-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-primary-600 transition-colors"
        >
          إعلان جديد
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الصورة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">العنوان</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الإجراء</th>
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
                        <span>جاري تحميل الإعلانات...</span>
                     </div>
                  </td>
                </tr>
              ) : ads.length > 0 ? (
                ads.map((ad) => (
                  <tr key={ad.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <img src={ad.imageUrl} alt={ad.title['ar'] || ''} className="w-24 h-16 object-cover rounded-md"/>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{ad.title['ar'] || ''}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{ad.subtitle['ar'] || ''}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{getActionTypeLabel(ad.actionType)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        ad.status === 'inactive'
                          ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                          : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                      }`}>
                        {getStatusLabel(ad.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2 rtl:space-x-reverse">
                      <button onClick={() => handleOpenFormModal(ad)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-200 p-1"><EditIcon /></button>
                      <button onClick={() => handleOpenDeleteModal(ad)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200 p-1"><TrashIcon /></button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="text-center py-16 text-gray-500 dark:text-gray-400">
                    <p className="font-semibold text-lg">لا توجد إعلانات</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      <AdFormModal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        onSave={handleSaveAd}
        adToEdit={currentAd}
        isSaving={isProcessing}
      />

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteAd}
        title="تأكيد الحذف"
        message="هل أنت متأكد من حذف هذا الإعلان؟"
        isConfirming={isProcessing}
      />
    </div>
  );
};

export default ManageAdsScreen;
