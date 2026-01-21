import React, { useState, useMemo } from 'react';
import { Customer } from '../../types';
import { useUserAuth } from '../../contexts/UserAuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useToast } from '../../contexts/ToastContext';
import NumberInput from '../NumberInput';

interface ManagePointsModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer;
}

const ManagePointsModal: React.FC<ManagePointsModalProps> = ({ isOpen, onClose, customer }) => {
  const { updateCustomer } = useUserAuth();
  const { showNotification } = useToast();
  const { t } = useSettings();

  const [points, setPoints] = useState<number>(0);
  const [action, setAction] = useState<'add' | 'subtract'>('add');
  const [isSaving, setIsSaving] = useState(false);

  const newBalance = useMemo(() => {
    const currentPoints = customer.loyaltyPoints;
    if (action === 'add') {
      return currentPoints + points;
    } else {
      return Math.max(0, currentPoints - points);
    }
  }, [customer, points, action]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    await updateCustomer({ ...customer, loyaltyPoints: newBalance });
    setIsSaving(false);
    showNotification('تم تحديث نقاط العميل بنجاح!', 'success');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md animate-fade-in-up flex flex-col max-h-[min(90dvh,calc(100dvh-2rem))]">
        <div className="p-6 border-b dark:border-gray-700 shrink-0">
          <h2 className="text-xl font-bold dark:text-white">{t('managePoints')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{customer.fullName}</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('currentBalance')}</p>
                <p className="text-2xl font-bold text-gray-800 dark:text-white">{customer.loyaltyPoints}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('newBalance')}</p>
                <p className={`text-2xl font-bold ${newBalance > customer.loyaltyPoints ? 'text-green-500' : 'text-red-500'}`}>
                  {newBalance}
                </p>
              </div>
            </div>

            <hr className="dark:border-gray-600" />

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('pointsToModify')}</label>
              <NumberInput
                id="points"
                name="points"
                value={points}
                onChange={(e) => setPoints(Math.abs(parseInt(e.target.value, 10)) || 0)}
                min={0}
                step={10}
                className="w-full text-center"
              />
            </div>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setAction('add')}
                className={`flex-1 p-3 rounded-md font-semibold transition-colors ${action === 'add' ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-600'}`}
              >
                {t('addPoints')}
              </button>
              <button
                type="button"
                onClick={() => setAction('subtract')}
                className={`flex-1 p-3 rounded-md font-semibold transition-colors ${action === 'subtract' ? 'bg-red-500 text-white' : 'bg-gray-200 dark:bg-gray-600'}`}
              >
                {t('subtractPoints')}
              </button>
            </div>
          </div>
          <div className="p-6 bg-gray-50 dark:bg-gray-700 flex justify-end space-x-3 rtl:space-x-reverse rounded-b-lg shrink-0">
            <button type="button" onClick={onClose} disabled={isSaving} className="py-2 px-4 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:opacity-50">إلغاء</button>
            <button type="submit" disabled={isSaving || points === 0} className="py-2 px-4 bg-primary-500 text-white rounded-md hover:bg-primary-600 w-32 disabled:bg-gray-400 disabled:cursor-not-allowed">
              {isSaving ? 'جاري...' : t('updatePoints')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ManagePointsModal;
