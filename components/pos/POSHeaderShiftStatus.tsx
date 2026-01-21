import React, { useState } from 'react';
import { useCashShift } from '../../contexts/CashShiftContext';
import ShiftManagementModal from '../admin/ShiftManagementModal';

const POSHeaderShiftStatus: React.FC = () => {
  const { currentShift, expectedCash, loading } = useCashShift();
  const [openModal, setOpenModal] = useState(false);
  const isOpen = Boolean(currentShift);

  return (
    <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-xl shadow p-3">
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${isOpen ? 'bg-green-500' : 'bg-red-500'}`} />
        <div className="text-sm dark:text-gray-200">
          {loading ? 'جاري التحميل...' : isOpen ? 'وردية مفتوحة' : 'لا توجد وردية مفتوحة'}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-sm font-bold text-indigo-600">
          {isOpen ? `المتوقع: ${expectedCash.toFixed(2)}` : ''}
        </div>
        <button
          onClick={() => setOpenModal(true)}
          className="px-3 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600"
        >
          إدارة الوردية
        </button>
      </div>
      {openModal && (
        <ShiftManagementModal isOpen={openModal} onClose={() => setOpenModal(false)} />
      )}
    </div>
  );
};

export default POSHeaderShiftStatus;
