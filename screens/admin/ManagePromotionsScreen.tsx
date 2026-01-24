import React, { useEffect, useMemo, useState } from 'react';
import { usePromotions } from '../../contexts/PromotionContext';
import { useToast } from '../../contexts/ToastContext';
import type { Promotion } from '../../types';
import ConfirmationModal from '../../components/admin/ConfirmationModal';
import PromotionFormModal from '../../components/admin/PromotionFormModal';
import { EditIcon } from '../../components/icons';

const formatDateTime = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ar-SA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const ManagePromotionsScreen: React.FC = () => {
  const { adminPromotions, refreshAdminPromotions, savePromotion, deactivatePromotion } = usePromotions();
  const { showNotification } = useToast();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [current, setCurrent] = useState<Promotion | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    void refreshAdminPromotions();
  }, [refreshAdminPromotions]);

  const rows = useMemo(() => adminPromotions, [adminPromotions]);

  const openNew = () => {
    setCurrent(null);
    setIsFormOpen(true);
  };

  const openEdit = (p: Promotion) => {
    setCurrent(p);
    setIsFormOpen(true);
  };

  const openDeactivate = (p: Promotion) => {
    setCurrent(p);
    setIsDeactivateOpen(true);
  };

  const handleSave = async (input: { promotion: any; activate: boolean }) => {
    setIsProcessing(true);
    try {
      const res = await savePromotion({ promotion: input.promotion, items: input.promotion.items || [], activate: input.activate });
      if (res.approvalStatus === 'pending') {
        showNotification('تم إرسال طلب موافقة لتفعيل العرض.', 'info');
      } else {
        showNotification('تم حفظ العرض بنجاح.', 'success');
      }
      setIsFormOpen(false);
    } catch (err: any) {
      showNotification(err?.message || 'حدث خطأ أثناء الحفظ', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeactivate = async () => {
    if (!current) return;
    setIsProcessing(true);
    try {
      await deactivatePromotion(current.id);
      showNotification('تم إيقاف العرض.', 'success');
    } catch (err: any) {
      showNotification(err?.message || 'تعذر إيقاف العرض', 'error');
    } finally {
      setIsProcessing(false);
      setIsDeactivateOpen(false);
      setCurrent(null);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <h1 className="text-3xl font-bold dark:text-white">إدارة العروض</h1>
        <button
          onClick={openNew}
          className="bg-primary-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-primary-600 transition-colors"
        >
          إضافة عرض
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الاسم</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الفترة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الحالة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الموافقة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-semibold">{p.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                    <div>{formatDateTime(p.startAt)}</div>
                    <div>{formatDateTime(p.endAt)}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${p.isActive ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}>
                      {p.isActive ? 'مفعل' : 'موقوف'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                    {p.requiresApproval ? (
                      <span className={`px-2 py-1 rounded text-xs font-bold ${p.approvalStatus === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200' : p.approvalStatus === 'approved' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'}`}>
                        {p.approvalStatus === 'pending' ? 'بانتظار الموافقة' : p.approvalStatus === 'approved' ? 'معتمد' : 'مرفوض'}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500 dark:text-gray-400">لا</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2 rtl:space-x-reverse">
                    <button onClick={() => openEdit(p)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-200 p-1" title="تعديل"><EditIcon /></button>
                    {p.isActive && (
                      <button onClick={() => openDeactivate(p)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200 px-2 py-1 rounded" title="إيقاف">
                        إيقاف
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                    لا توجد عروض بعد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PromotionFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSave={handleSave}
        promotionToEdit={current}
        isSaving={isProcessing}
      />

      <ConfirmationModal
        isOpen={isDeactivateOpen}
        onClose={() => setIsDeactivateOpen(false)}
        onConfirm={handleDeactivate}
        title="إيقاف العرض"
        message={`هل أنت متأكد من إيقاف العرض "${current?.name}"؟`}
        isConfirming={isProcessing}
      />
    </div>
  );
};

export default ManagePromotionsScreen;

