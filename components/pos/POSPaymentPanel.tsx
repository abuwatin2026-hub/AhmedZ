import React, { useMemo, useState } from 'react';
import { useSettings } from '../../contexts/SettingsContext';

interface Props {
  total: number;
  canFinalize: boolean;
  onHold: () => void;
  onFinalize: (payload: { method: string; amount: number; cashReceived?: number }) => void;
  pendingOrderId: string | null;
  onCancelHold?: () => void;
}

const POSPaymentPanel: React.FC<Props> = ({ total, canFinalize, onHold, onFinalize, pendingOrderId, onCancelHold }) => {
  const { settings } = useSettings();
  const availableMethods = useMemo(() => {
    const enabled = Object.entries(settings.paymentMethods)
      .filter(([, isEnabled]) => isEnabled)
      .map(([key]) => key);
    return enabled;
  }, [settings.paymentMethods]);

  const [method, setMethod] = useState<string>(availableMethods[0] || '');
  const [cashReceived, setCashReceived] = useState<number>(0);

  const canSubmit = canFinalize && total > 0 && method;

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600 dark:text-gray-300">
        {pendingOrderId ? `معلّق: ${pendingOrderId.slice(0, 8)}...` : ''}
      </div>
      <div className="space-y-2">
        {availableMethods.length === 0 ? (
          <div className="text-red-500">لا توجد طرق دفع مفعلة</div>
        ) : (
          availableMethods.map(m => (
            <label key={m} className="flex items-center gap-3 p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700">
              <input
                type="radio"
                name="paymentMethod"
                value={m}
                checked={method === m}
                onChange={e => setMethod(e.target.value)}
              />
              <span className="font-semibold dark:text-white">
                {m === 'cash' ? 'نقد' : m === 'kuraimi' ? 'كريمي' : 'شبكة'}
              </span>
            </label>
          ))
        )}
      </div>
      {method === 'cash' && (
        <div className="flex items-center gap-3">
          <input
            type="number"
            step="0.01"
            value={cashReceived}
            onChange={e => setCashReceived(Number(e.target.value) || 0)}
            className="flex-1 p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            placeholder="المبلغ المستلم"
          />
          <div className="text-sm font-mono text-indigo-600">
            {cashReceived > 0 ? `الباقي: ${(Math.max(0, cashReceived - total)).toFixed(2)}` : ''}
          </div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={onHold}
          disabled={!canFinalize}
          className="flex-1 px-4 py-3 rounded-lg border dark:border-gray-700 disabled:opacity-50"
        >
          تعليق
        </button>
        {pendingOrderId && (
          <button
            onClick={onCancelHold}
            className="px-4 py-3 rounded-lg border dark:border-gray-700"
          >
            إلغاء التعليق
          </button>
        )}
        <button
          onClick={() => onFinalize({ method, amount: total, cashReceived: method === 'cash' ? cashReceived : undefined })}
          disabled={!canSubmit}
          className="flex-1 px-4 py-3 rounded-lg bg-primary-500 text-white disabled:opacity-50"
        >
          إتمام
        </button>
      </div>
    </div>
  );
};

export default POSPaymentPanel;
