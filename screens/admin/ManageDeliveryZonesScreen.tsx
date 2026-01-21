import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DeliveryZone } from '../../types';
import { useDeliveryZones } from '../../contexts/DeliveryZoneContext';
import { useToast } from '../../contexts/ToastContext';
// import { useSettings } from '../../contexts/SettingsContext';
import ConfirmationModal from '../../components/admin/ConfirmationModal';
import { EditIcon, TrashIcon } from '../../components/icons';
import { translateArToEn } from '../../utils/translations';
import DeliveryZoneMapPicker from '../../components/admin/DeliveryZoneMapPicker';
import { updateAllZoneStatistics } from '../../utils/deliveryZoneStats';

type ZoneDraft = Omit<DeliveryZone, 'id'>;

const emptyDraft: ZoneDraft = {
  name: { ar: '', en: '' },
  deliveryFee: 0,
  estimatedTime: 45,
  isActive: true,
};

const DeliveryZoneFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSave: (draft: ZoneDraft | DeliveryZone) => Promise<void>;
  zoneToEdit: DeliveryZone | null;
  isSaving: boolean;
}> = ({ isOpen, onClose, onSave, zoneToEdit, isSaving }) => {
  // const { t } = useSettings();
  const [draft, setDraft] = useState<ZoneDraft>(emptyDraft);
  const [nameEnTouched, setNameEnTouched] = useState(false);
  const translateTimer = useRef<number | null>(null);
  const lastTranslateId = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    if (zoneToEdit) {
      const { id: _id, ...rest } = zoneToEdit;
      setDraft(rest);
      setNameEnTouched(false);
      return;
    }
    setDraft(emptyDraft);
    setNameEnTouched(false);
  }, [isOpen, zoneToEdit]);

  if (!isOpen) return null;

  const canSave = draft.name.ar.trim().length > 0;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex justify-center items-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[calc(100vh-2rem)] animate-fade-in-up flex flex-col overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            {zoneToEdit ? 'تعديل منطقة التوصيل' : 'إضافة منطقة توصيل'}
          </h3>
        </div>
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                اسم المنطقة (بالعربية)
              </label>
              <input
                value={draft.name.ar}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft(prev => ({ ...prev, name: { ...prev.name, ar: value } }));
                  if (translateTimer.current) window.clearTimeout(translateTimer.current);
                  if (!value.trim() || nameEnTouched) return;
                  const translateId = ++lastTranslateId.current;
                  translateTimer.current = window.setTimeout(async () => {
                    const translated = await translateArToEn(value);
                    if (!translated) return;
                    if (translateId !== lastTranslateId.current) return;
                    setDraft(prev => ({ ...prev, name: { ...prev.name, en: prev.name.en?.trim() ? prev.name.en : translated } }));
                  }, 500);
                }}
                className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                اسم المنطقة (بالإنجليزية)
              </label>
              <input
                value={draft.name.en || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.trim()) setNameEnTouched(true);
                  setDraft(prev => ({ ...prev, name: { ...prev.name, en: value } }));
                }}
                className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                رسوم التوصيل (ر.ي)
              </label>
              <input
                type="number"
                step="0.01"
                value={Number.isFinite(draft.deliveryFee) ? draft.deliveryFee : 0}
                onChange={(e) => setDraft(prev => ({ ...prev, deliveryFee: parseFloat(e.target.value) || 0 }))}
                className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                وقت التوصيل المتوقع (دقيقة)
              </label>
              <input
                type="number"
                step="1"
                value={Number.isFinite(draft.estimatedTime) ? draft.estimatedTime : 0}
                onChange={(e) => setDraft(prev => ({ ...prev, estimatedTime: Math.max(0, parseInt(e.target.value || '0', 10) || 0) }))}
                className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              />
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">
              خريطة المنطقة ونطاق التوصيل
            </h4>
            <DeliveryZoneMapPicker
              center={draft.coordinates}
              radius={draft.coordinates?.radius}
              onChange={(center, radius) => setDraft(prev => ({ ...prev, coordinates: { ...center, radius } }))}
            />
          </div>

          <label className="flex items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => setDraft(prev => ({ ...prev, isActive: e.target.checked }))}
              className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500"
            />
            <span className="mx-3 text-gray-700 dark:text-gray-300">نشط</span>
          </label>
        </div>

        <div className="p-4 bg-gray-50 dark:bg-gray-700 flex flex-col sm:flex-row justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="w-full sm:w-auto py-2 px-4 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500 disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            onClick={() => onSave(zoneToEdit ? { ...zoneToEdit, ...draft } : draft)}
            disabled={!canSave || isSaving}
            className="w-full sm:w-auto py-2 px-4 bg-primary-500 text-white rounded-md hover:bg-primary-600 disabled:opacity-50 disabled:cursor-wait"
          >
            {isSaving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>

  );
};

const ManageDeliveryZonesScreen: React.FC = () => {
  const { deliveryZones, loading, addDeliveryZone, updateDeliveryZone, deleteDeliveryZone, fetchDeliveryZones } = useDeliveryZones();
  const { showNotification } = useToast();
  // const { t, language } = useSettings();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [currentZone, setCurrentZone] = useState<DeliveryZone | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const sortedZones = useMemo(() => {
    return [...deliveryZones].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return (a.name?.['ar'] || '').localeCompare(b.name?.['ar'] || '');
    });
  }, [deliveryZones]);

  const openCreate = () => {
    setCurrentZone(null);
    setIsFormOpen(true);
  };

  const openEdit = (zone: DeliveryZone) => {
    setCurrentZone(zone);
    setIsFormOpen(true);
  };

  const openDelete = (zone: DeliveryZone) => {
    setCurrentZone(zone);
    setIsDeleteOpen(true);
  };

  const handleSave = async (payload: ZoneDraft | DeliveryZone) => {
    setIsProcessing(true);
    try {
      if ('id' in payload) {
        await updateDeliveryZone(payload);
        showNotification('تم تحديث منطقة التوصيل بنجاح', 'success');
      } else {
        await addDeliveryZone(payload);
        showNotification('تم إضافة منطقة التوصيل بنجاح', 'success');
      }
      setIsFormOpen(false);
      setCurrentZone(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (!currentZone) return;
    setIsProcessing(true);
    try {
      await deleteDeliveryZone(currentZone.id);
      showNotification('تم حذف منطقة التوصيل بنجاح', 'success');
    } finally {
      setIsProcessing(false);
      setIsDeleteOpen(false);
      setCurrentZone(null);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <h1 className="text-3xl font-bold dark:text-white">إدارة مناطق التوصيل</h1>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              setIsProcessing(true);
              await updateAllZoneStatistics();
              await fetchDeliveryZones();
              setIsProcessing(false);
              showNotification('تم تحديث الإحصائيات بنجاح', 'success');
            }}
            disabled={isProcessing}
            className="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            تحديث الإحصائيات
          </button>
          <button
            onClick={openCreate}
            className="bg-primary-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-primary-600 transition-colors"
          >
            إضافة منطقة توصيل
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  اسم المنطقة
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  رسوم التوصيل
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  وقت التوصيل
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  الإحصائيات
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  الحالة
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  الإجراءات
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-gray-500 dark:text-gray-400">
                    جاري التحميل...
                  </td>
                </tr>
              ) : sortedZones.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-gray-500 dark:text-gray-400">
                    لا توجد مناطق توصيل
                  </td>
                </tr>
              ) : (
                sortedZones.map(zone => (
                  <tr key={zone.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-gray-900 dark:text-white">{zone.name['ar']}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{zone.name.en}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-bold">
                      {zone.deliveryFee.toFixed(2)} ر.ي
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                      {zone.estimatedTime} دقيقة
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                      {zone.statistics ? (
                        <div className="flex flex-col gap-1">
                          <span title='إجمالي الطلبات'>📦 {zone.statistics.totalOrders}</span>
                          <span title='متوسط وقت التوصيل'>⏱️ {zone.statistics.averageDeliveryTime} دقيقة</span>
                          <span title='إجمالي الإيرادات' className="text-green-600 dark:text-green-400 font-bold">💰 {zone.statistics.totalRevenue.toLocaleString()} ر.ي</span>
                        </div>
                      ) : (
                        <span className="italic text-gray-400">لا توجد بيانات</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${zone.isActive ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300'}`}>
                        {zone.isActive ? 'نشط' : 'غير نشط'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2 rtl:space-x-reverse">
                      <button onClick={() => openEdit(zone)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-200 p-1">
                        <EditIcon />
                      </button>
                      <button onClick={() => openDelete(zone)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200 p-1">
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DeliveryZoneFormModal
        isOpen={isFormOpen}
        onClose={() => {
          if (isProcessing) return;
          setIsFormOpen(false);
          setCurrentZone(null);
        }}
        onSave={handleSave}
        zoneToEdit={currentZone}
        isSaving={isProcessing}
      />

      <ConfirmationModal
        isOpen={isDeleteOpen}
        onClose={() => {
          if (isProcessing) return;
          setIsDeleteOpen(false);
          setCurrentZone(null);
        }}
        onConfirm={handleDelete}
        title="تأكيد الحذف"
        message={
          currentZone
            ? `هل أنت متأكد أنك تريد حذف منطقة التوصيل "${currentZone.name['ar']}"؟`
            : 'هل أنت متأكد أنك تريد حذف منطقة التوصيل؟'
        }
        isConfirming={isProcessing}
      />
    </div>
  );
};

export default ManageDeliveryZonesScreen;
