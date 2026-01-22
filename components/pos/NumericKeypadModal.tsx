import React, { useEffect, useMemo, useState } from 'react';
import ConfirmationModal from '../admin/ConfirmationModal';

type Props = {
  isOpen: boolean;
  title: string;
  initialValue: number;
  allowDecimal?: boolean;
  onClose: () => void;
  onSubmit: (value: number) => void;
};

const NumericKeypadModal: React.FC<Props> = ({ isOpen, title, initialValue, allowDecimal = true, onClose, onSubmit }) => {
  const [raw, setRaw] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const v = Number(initialValue) || 0;
    setRaw(allowDecimal ? v.toFixed(2) : String(Math.floor(v)));
  }, [allowDecimal, initialValue, isOpen]);

  const value = useMemo(() => {
    const normalized = raw.replace(/,/g, '.').trim();
    const parsed = Number(normalized);
    if (!normalized) return 0;
    if (Number.isNaN(parsed)) return 0;
    return parsed;
  }, [raw]);

  const canSubmit = useMemo(() => {
    if (!raw.trim()) return true;
    const normalized = raw.replace(/,/g, '.').trim();
    const parsed = Number(normalized);
    return !Number.isNaN(parsed);
  }, [raw]);

  const append = (token: string) => {
    setRaw(prev => {
      const next = `${prev}${token}`;
      if (!allowDecimal && next.includes('.')) return prev;
      if (allowDecimal) {
        const dots = (next.match(/[.]/g) || []).length;
        if (dots > 1) return prev;
      }
      return next;
    });
  };

  const backspace = () => setRaw(prev => prev.slice(0, -1));
  const clear = () => setRaw('');

  return (
    <ConfirmationModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={() => onSubmit(Math.max(0, allowDecimal ? Number(value.toFixed(2)) : Math.floor(value)))}
      title={title}
      message=""
      confirmText="تم"
      confirmingText="..."
      cancelText="إغلاق"
      confirmButtonClassName="bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300"
      maxWidthClassName="max-w-lg"
      hideConfirmButton={!canSubmit}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
          <div className="text-xs text-gray-600 dark:text-gray-300">القيمة</div>
          <div className="text-2xl font-mono font-bold text-gray-900 dark:text-white">{(allowDecimal ? value.toFixed(2) : String(Math.floor(value)))}</div>
        </div>
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          inputMode={allowDecimal ? 'decimal' : 'numeric'}
          className="w-full p-4 border rounded-xl dark:bg-gray-700 dark:border-gray-600 text-lg font-mono"
        />
        <div className="grid grid-cols-3 gap-3">
          {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map(d => (
            <button
              key={d}
              type="button"
              onClick={() => append(d)}
              className="p-5 rounded-xl border dark:border-gray-700 text-xl font-bold"
            >
              {d}
            </button>
          ))}
          <button type="button" onClick={clear} className="p-5 rounded-xl border dark:border-gray-700 text-sm font-semibold">مسح</button>
          <button type="button" onClick={() => append('0')} className="p-5 rounded-xl border dark:border-gray-700 text-xl font-bold">0</button>
          <button type="button" onClick={backspace} className="p-5 rounded-xl border dark:border-gray-700 text-sm font-semibold">حذف</button>
          {allowDecimal && (
            <>
              <button type="button" onClick={() => append('00')} className="p-5 rounded-xl border dark:border-gray-700 text-sm font-semibold">00</button>
              <button type="button" onClick={() => append('.')} className="p-5 rounded-xl border dark:border-gray-700 text-xl font-bold">.</button>
              <button type="button" onClick={() => setRaw(String(Math.max(0, Math.floor(value))))} className="p-5 rounded-xl border dark:border-gray-700 text-sm font-semibold">تقريب</button>
            </>
          )}
        </div>
      </div>
    </ConfirmationModal>
  );
};

export default NumericKeypadModal;
