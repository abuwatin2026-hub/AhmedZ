import React, { useEffect, useState } from 'react';
import { useAddons } from '../../contexts/AddonContext';
import { useToast } from '../../contexts/ToastContext';
// import { useSettings } from '../../contexts/SettingsContext';
import { Addon } from '../../types';
import ConfirmationModal from '../../components/admin/ConfirmationModal';
import AddonFormModal from '../../components/admin/AddonFormModal';
import { EditIcon, TrashIcon } from '../../components/icons';
import { getBaseCurrencyCode } from '../../supabase';

const ManageAddonsScreen: React.FC = () => {
  const { addons, addAddon, updateAddon, deleteAddon } = useAddons();
  const { showNotification } = useToast();
  // const { t, language } = useSettings();
  const [baseCode, setBaseCode] = useState('—');

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentAddon, setCurrentAddon] = useState<Addon | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    void getBaseCurrencyCode().then((c) => {
      if (!c) return;
      setBaseCode(c);
    });
  }, []);

  const handleOpenFormModal = (addon: Addon | null = null) => {
    setCurrentAddon(addon);
    setIsFormModalOpen(true);
  };
  
  const handleOpenDeleteModal = (addon: Addon) => {
    setCurrentAddon(addon);
    setIsDeleteModalOpen(true);
  };

  const handleSaveAddon = async (addon: Omit<Addon, 'id'> | Addon) => {
    setIsProcessing(true);
    if ('id' in addon && addon.id) {
        await updateAddon(addon);
        showNotification('تم تحديث الإضافة بنجاح!', 'success');
    } else {
        await addAddon(addon);
        showNotification('تمت إضافة الإضافة بنجاح!', 'success');
    }
    setIsProcessing(false);
    setIsFormModalOpen(false);
  };

  const handleDeleteAddon = async () => {
    if (currentAddon) {
        setIsProcessing(true);
        await deleteAddon(currentAddon.id);
        showNotification('تم حذف الإضافة بنجاح!', 'success');
        setIsProcessing(false);
    }
    setIsDeleteModalOpen(false);
  };

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <h1 className="text-3xl font-bold dark:text-white">إدارة الإضافات</h1>
        <button
          onClick={() => handleOpenFormModal()}
          className="bg-primary-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-primary-600 transition-colors"
        >
          إضافة جديدة
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">اسم الإضافة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الحجم</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">السعر</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {addons.map((addon) => (
                <tr key={addon.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                    {addon.name['ar'] || addon.name['en'] || ''}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {addon.size ? (addon.size['ar'] || addon.size['en'] || '-') : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-bold">
                    {addon.price.toFixed(2)} {baseCode || '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2 rtl:space-x-reverse">
                    <button onClick={() => handleOpenFormModal(addon)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-200 p-1"><EditIcon /></button>
                    <button onClick={() => handleOpenDeleteModal(addon)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200 p-1"><TrashIcon /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      <AddonFormModal 
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        onSave={handleSaveAddon}
        addonToEdit={currentAddon}
        isSaving={isProcessing}
      />
      
       <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteAddon}
        title="تأكيد الحذف"
        message={`هل أنت متأكد من رغبتك في حذف الإضافة "${currentAddon?.name['ar'] || currentAddon?.name['en']}"؟`}
        isConfirming={isProcessing}
      />

    </div>
  );
};

export default ManageAddonsScreen;
