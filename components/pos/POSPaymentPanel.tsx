import React, { useEffect, useMemo, useState } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import NumericKeypadModal from './NumericKeypadModal';

type PaymentLine = {
  method: string;
  amount: number;
  referenceNumber?: string;
  senderName?: string;
  senderPhone?: string;
  declaredAmount?: number;
  amountConfirmed?: boolean;
  cashReceived?: number;
};

interface Props {
  total: number;
  currencyCode?: string;
  canFinalize: boolean;
  blockReason?: string;
  onHold: () => void;
  onFinalize: (payload: { paymentMethod: string; paymentBreakdown: PaymentLine[] }) => void;
  pendingOrderId: string | null;
  onCancelHold?: () => void;
  touchMode?: boolean;
}

type KeypadTarget =
  | { kind: 'cash_single' }
  | { kind: 'declared_single' }
  | { kind: 'amount_multi'; index: number }
  | { kind: 'cash_multi'; index: number }
  | { kind: 'declared_multi'; index: number };

const fmt = (n: number) => {
  const v = Number(n || 0);
  try {
    return v.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return v.toFixed(2);
  }
};

const POSPaymentPanel: React.FC<Props> = ({ total, currencyCode, canFinalize, blockReason, onHold, onFinalize, pendingOrderId, onCancelHold, touchMode }) => {
  const { settings } = useSettings();
  const code = String(currencyCode || '').toUpperCase() || '—';
  const availableMethods = useMemo(() => {
    const enabled = Object.entries(settings.paymentMethods || {})
      .filter(([, isEnabled]) => isEnabled)
      .map(([key]) => key);
    return enabled;
  }, [settings.paymentMethods]);

  const [multiEnabled, setMultiEnabled] = useState(false);
  const [method, setMethod] = useState<string>(availableMethods[0] || '');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [declaredAmount, setDeclaredAmount] = useState<number>(0);
  const [amountConfirmed, setAmountConfirmed] = useState(false);
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [lines, setLines] = useState<PaymentLine[]>([]);
  const [keypadTarget, setKeypadTarget] = useState<KeypadTarget | null>(null);
  const [keypadTitle, setKeypadTitle] = useState('');
  const [keypadInitial, setKeypadInitial] = useState(0);

  const needsReference = method === 'kuraimi' || method === 'network';
  const totalRounded = useMemo(() => Number((Number(total) || 0).toFixed(2)), [total]);

  const normalizedLines = useMemo(() => {
    if (!multiEnabled) {
      const base: PaymentLine = {
        method,
        amount: Number(total) || 0,
      };
      if (method === 'cash') {
        base.cashReceived = cashReceived > 0 ? cashReceived : 0;
      }
      if (needsReference) {
        base.referenceNumber = referenceNumber.trim() || undefined;
        base.senderName = senderName.trim() || undefined;
        base.senderPhone = senderPhone.trim() || undefined;
        base.declaredAmount = Number(declaredAmount) || 0;
        base.amountConfirmed = Boolean(amountConfirmed);
      }
      return [base];
    }
    return (lines || []).map(l => ({
      ...l,
      method: (l.method || '').trim(),
      amount: Number(l.amount) || 0,
      referenceNumber: l.referenceNumber?.trim() || undefined,
      senderName: l.senderName?.trim() || undefined,
      senderPhone: l.senderPhone?.trim() || undefined,
      declaredAmount: Number(l.declaredAmount) || 0,
      amountConfirmed: Boolean(l.amountConfirmed),
      cashReceived: Number(l.cashReceived) || 0,
    }));
  }, [
    amountConfirmed,
    cashReceived,
    declaredAmount,
    lines,
    method,
    multiEnabled,
    needsReference,
    referenceNumber,
    senderName,
    senderPhone,
    total,
  ]);

  const validation = useMemo(() => {
    if (!canFinalize) return { ok: false, message: typeof blockReason === 'string' ? blockReason : '' };
    if (!(Number(total) > 0)) return { ok: false, message: 'الإجمالي يجب أن يكون أكبر من صفر.' };
    if (availableMethods.length === 0) return { ok: false, message: 'لا توجد طرق دفع مفعلة.' };

    const breakdown = normalizedLines.filter(l => l.method && (Number(l.amount) || 0) > 0);
    if (breakdown.length === 0) return { ok: false, message: 'يرجى اختيار طريقة الدفع.' };

    const sum = breakdown.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    if (Math.abs(sum - total) > 0.01) return { ok: false, message: 'مجموع الدفعات لا يطابق الإجمالي.' };

    let cashCount = 0;
    for (const l of breakdown) {
      if (!availableMethods.includes(l.method)) return { ok: false, message: 'توجد طريقة دفع غير مفعلة.' };
      const isCash = l.method === 'cash';
      const isRef = l.method === 'kuraimi' || l.method === 'network';
      if (isCash) {
        cashCount += 1;
        const received = Number(l.cashReceived) || 0;
        const amt = Number(l.amount) || 0;
        if (received > 0 && received + 1e-9 < amt) return { ok: false, message: 'المبلغ المستلم نقداً أقل من المطلوب.' };
      }
      if (isRef) {
        if (!l.referenceNumber) return { ok: false, message: l.method === 'kuraimi' ? 'يرجى إدخال رقم الإيداع.' : 'يرجى إدخال رقم الحوالة.' };
        if (!l.senderName) return { ok: false, message: l.method === 'kuraimi' ? 'يرجى إدخال اسم المودِع.' : 'يرجى إدخال اسم المرسل.' };
        if (!((Number(l.declaredAmount) || 0) > 0)) return { ok: false, message: 'يرجى إدخال مبلغ العملية.' };
        if (Math.abs((Number(l.declaredAmount) || 0) - (Number(l.amount) || 0)) > 0.0001) return { ok: false, message: 'مبلغ العملية لا يطابق مبلغ طريقة الدفع.' };
        if (!l.amountConfirmed) return { ok: false, message: 'يرجى تأكيد مطابقة المبلغ قبل الإتمام.' };
      }
    }
    if (cashCount > 1) return { ok: false, message: 'لا يمكن تكرار الدفع النقدي أكثر من مرة.' };

    return { ok: true, message: '' };
  }, [availableMethods, blockReason, canFinalize, normalizedLines, total]);

  const breakdown = useMemo(() => {
    return normalizedLines.filter(l => l.method && (Number(l.amount) || 0) > 0);
  }, [normalizedLines]);

  const breakdownSum = useMemo(() => {
    return Number(breakdown.reduce((s, l) => s + (Number(l.amount) || 0), 0).toFixed(2));
  }, [breakdown]);

  const remaining = useMemo(() => {
    return Number((totalRounded - breakdownSum).toFixed(2));
  }, [breakdownSum, totalRounded]);

  const summaryTone = remaining === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';

  const canSubmit = validation.ok;
  const finalize = () => {
    const payloadBreakdown = breakdown.map(l => ({
        method: l.method,
        amount: Number(l.amount) || 0,
        referenceNumber: l.referenceNumber,
        senderName: l.senderName,
        senderPhone: l.senderPhone,
        declaredAmount: Number(l.declaredAmount) || 0,
        amountConfirmed: Boolean(l.amountConfirmed),
        cashReceived: l.method === 'cash' ? (Number(l.cashReceived) || 0) : 0,
      }));
    const primary = payloadBreakdown[0]?.method || method;
    onFinalize({ paymentMethod: primary, paymentBreakdown: payloadBreakdown });
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || '').toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';

      if (e.key === 'Escape' && pendingOrderId && onCancelHold && !isTyping) {
        e.preventDefault();
        onCancelHold();
        return;
      }

      if (isTyping) return;

      if (e.key === 'F8') {
        e.preventDefault();
        onHold();
        return;
      }

      if (e.key === 'F9' || (e.ctrlKey && e.key === 'Enter')) {
        if (!canSubmit) return;
        e.preventDefault();
        finalize();
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [canSubmit, finalize, onCancelHold, onHold, pendingOrderId]);

  const openKeypad = (target: KeypadTarget, title: string, initial: number) => {
    setKeypadTarget(target);
    setKeypadTitle(title);
    setKeypadInitial(Number(initial) || 0);
  };

  const applyKeypad = (value: number) => {
    if (!keypadTarget) return;
    const v = Number(value) || 0;
    if (keypadTarget.kind === 'cash_single') {
      setCashReceived(v);
    } else if (keypadTarget.kind === 'declared_single') {
      setDeclaredAmount(v);
      setAmountConfirmed(false);
    } else if (keypadTarget.kind === 'amount_multi') {
      const idx = keypadTarget.index;
      setLines(prev => prev.map((row, i) => {
        if (i !== idx) return row;
        const needsRef = row.method === 'kuraimi' || row.method === 'network';
        const nextDeclared = needsRef ? (Number(row.declaredAmount) || 0) : 0;
        return { ...row, amount: v, declaredAmount: nextDeclared, amountConfirmed: needsRef ? Boolean(row.amountConfirmed) : true };
      }));
    } else if (keypadTarget.kind === 'cash_multi') {
      const idx = keypadTarget.index;
      setLines(prev => prev.map((row, i) => i === idx ? { ...row, cashReceived: v } : row));
    } else if (keypadTarget.kind === 'declared_multi') {
      const idx = keypadTarget.index;
      setLines(prev => prev.map((row, i) => i === idx ? { ...row, declaredAmount: v, amountConfirmed: false } : row));
    }
    setKeypadTarget(null);
  };

  const inputClass = touchMode ? 'p-4 text-lg' : 'p-2 text-base';
  const buttonClass = touchMode ? 'px-5 py-4 text-base' : 'px-3 py-2 text-xs';

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600 dark:text-gray-300">
        {pendingOrderId ? `معلّق: ${pendingOrderId.slice(0, 8)}...` : ''}
      </div>
      <div className="p-3 rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-600 dark:text-gray-300">الإجمالي</div>
          <div className="text-lg font-bold text-gray-900 dark:text-white" dir="ltr">
            <span className="font-mono">{fmt(totalRounded)}</span> <span className="text-xs">{code}</span>
          </div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <div className="text-xs text-gray-600 dark:text-gray-300">المجموع</div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white" dir="ltr">
            <span className="font-mono">{fmt(breakdownSum)}</span> <span className="text-xs">{code}</span>
          </div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <div className="text-xs text-gray-600 dark:text-gray-300">المتبقي</div>
          <div className={`text-sm font-bold ${summaryTone}`} dir="ltr">
            <span className="font-mono">{fmt(remaining)}</span> <span className="text-xs">{code}</span>
          </div>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={multiEnabled}
          onChange={(e) => {
            const checked = e.target.checked;
            setMultiEnabled(checked);
            if (checked) {
              const initMethod = method || availableMethods[0] || 'cash';
              const initNeedsRef = initMethod === 'kuraimi' || initMethod === 'network';
              setLines([{
                method: initMethod,
                amount: Number(total.toFixed(2)),
                declaredAmount: initNeedsRef ? Number(total.toFixed(2)) : 0,
                amountConfirmed: initNeedsRef ? false : true,
                cashReceived: initMethod === 'cash' ? Number(total.toFixed(2)) : 0,
              }]);
            } else {
              setLines([]);
            }
          }}
        />
        تعدد طرق الدفع
      </label>
      <div className="text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-1">
        <span>F8 تعليق</span>
        <span>F9 إتمام</span>
        <span>Ctrl+Enter إتمام</span>
        {pendingOrderId && <span>Esc إلغاء التعليق</span>}
      </div>
      <div className="space-y-2">
        {availableMethods.length === 0 ? (
          <div className="text-red-500">لا توجد طرق دفع مفعلة</div>
        ) : !multiEnabled ? (
          availableMethods.map(m => (
            <label key={m} className={`flex items-center gap-3 border rounded-lg dark:bg-gray-800 dark:border-gray-700 ${touchMode ? 'p-4' : 'p-2'}`}>
              <input
                type="radio"
                name="paymentMethod"
                value={m}
                checked={method === m}
                onChange={e => {
                  const nextMethod = e.target.value;
                  setMethod(nextMethod);
                  setReferenceNumber('');
                  setSenderName('');
                  setSenderPhone('');
                  setDeclaredAmount(totalRounded);
                  setAmountConfirmed(false);
                  setCashReceived(nextMethod === 'cash' ? totalRounded : 0);
                }}
              />
              <span className="font-semibold dark:text-white">
                {m === 'cash' ? 'نقد' : m === 'kuraimi' ? 'حسابات بنكية' : 'حوالات'}
              </span>
            </label>
          ))
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setLines(prev => {
                    if (!prev.length) return prev;
                    const sumOthers = prev.slice(1).reduce((s, l) => s + (Number(l.amount) || 0), 0);
                    const remaining = Math.max(0, Number((totalRounded - sumOthers).toFixed(2)));
                    const first = prev[0];
                    const needsRef = first.method === 'kuraimi' || first.method === 'network';
                    const nextFirst: PaymentLine = {
                      ...first,
                      amount: remaining,
                      declaredAmount: needsRef ? remaining : 0,
                      amountConfirmed: needsRef ? false : true,
                    };
                    return [nextFirst, ...prev.slice(1)];
                  });
                }}
                className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}
              >
                تسوية الإجمالي
              </button>
              <button
                type="button"
                onClick={() => {
                  setLines(prev => prev.map((row, i) => i === 0 ? { ...row, amount: totalRounded, declaredAmount: 0, amountConfirmed: row.method === 'cash', cashReceived: 0 } : { ...row, amount: 0, declaredAmount: 0, amountConfirmed: row.method === 'cash', cashReceived: 0 }));
                }}
                className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}
              >
                إفراغ الدفعات
              </button>
            </div>
            {lines.map((l, idx) => {
              const isCash = l.method === 'cash';
              const isRef = l.method === 'kuraimi' || l.method === 'network';
              const received = Number(l.cashReceived) || 0;
              const amt = Number(l.amount) || 0;
              const change = isCash && received > 0 ? Math.max(0, received - amt) : 0;
              const usedCashByOthers = l.method !== 'cash' && lines.some((o, oi) => oi !== idx && o.method === 'cash');
              const methodsForRow = availableMethods.filter(m => {
                if (m !== 'cash') return true;
                if (l.method === 'cash') return true;
                return !lines.some((o, oi) => oi !== idx && o.method === 'cash');
              });
              const sumOthers = lines.reduce((s, row, i) => i === idx ? s : s + (Number(row.amount) || 0), 0);
              const remainingForRow = Math.max(0, Number((totalRounded - sumOthers).toFixed(2)));

              const refMissing = isRef && !(String(l.referenceNumber || '').trim());
              const nameMissing = isRef && !(String(l.senderName || '').trim());
              const declaredMissing = isRef && !((Number(l.declaredAmount) || 0) > 0);
              const declaredMismatch = isRef && Math.abs((Number(l.declaredAmount) || 0) - (Number(l.amount) || 0)) > 0.0001;
              const confirmMissing = isRef && !Boolean(l.amountConfirmed);

              const rowStatus = isRef
                ? (refMissing || nameMissing || declaredMissing || declaredMismatch || confirmMissing ? 'غير مكتملة' : 'مكتملة')
                : 'جاهزة';
              const rowTone = isRef
                ? (rowStatus === 'مكتملة' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')
                : 'text-gray-600 dark:text-gray-300';

              return (
                <div key={`${idx}-${l.method}`} className="p-3 border rounded-lg dark:bg-gray-800 dark:border-gray-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-600 dark:text-gray-300">دفعة {idx + 1}</div>
                    <div className={`text-xs font-semibold ${rowTone}`}>{rowStatus}</div>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">الطريقة</div>
                      <select
                        value={l.method}
                        onChange={(e) => {
                          const nextMethod = e.target.value;
                          setLines(prev => prev.map((row, i) => i === idx ? {
                            ...row,
                            method: nextMethod,
                            referenceNumber: '',
                            senderName: '',
                            senderPhone: '',
                            declaredAmount: 0,
                            amountConfirmed: nextMethod === 'cash',
                            cashReceived: 0,
                          } : row));
                        }}
                        className={`w-full border rounded-lg dark:bg-gray-700 dark:border-gray-600 ${inputClass}`}
                      >
                        {methodsForRow.map(m => (
                          <option key={m} value={m}>{m === 'cash' ? 'نقد' : m === 'kuraimi' ? 'حسابات بنكية' : 'حوالات'}</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-40">
                      <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">المبلغ</div>
                      <input
                        type="number"
                        step="0.01"
                        value={Number(l.amount) || 0}
                        onChange={(e) => {
                          const nextAmount = Number(e.target.value) || 0;
                          setLines(prev => prev.map((row, i) => {
                            if (i !== idx) return row;
                            const needsRef = row.method === 'kuraimi' || row.method === 'network';
                            const nextDeclared = needsRef ? (Number(row.declaredAmount) || 0) : 0;
                            return { ...row, amount: nextAmount, declaredAmount: nextDeclared, amountConfirmed: needsRef ? Boolean(row.amountConfirmed) : true };
                          }));
                        }}
                        inputMode="decimal"
                        className={`w-full border rounded-lg dark:bg-gray-700 dark:border-gray-600 ${inputClass}`}
                        min={0}
                      />
                    </div>
                    {touchMode && (
                      <button
                        type="button"
                        onClick={() => openKeypad({ kind: 'amount_multi', index: idx }, `مبلغ الدفعة ${idx + 1}`, Number(l.amount) || 0)}
                        className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}
                      >
                        لوحة
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setLines(prev => prev.map((row, i) => {
                        if (i !== idx) return row;
                        const needsRef = row.method === 'kuraimi' || row.method === 'network';
                        return {
                          ...row,
                          amount: remainingForRow,
                          declaredAmount: needsRef ? remainingForRow : 0,
                          amountConfirmed: needsRef ? false : true,
                        };
                      }))}
                      className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}
                    >
                      المتبقي
                    </button>
                    <button
                      type="button"
                      onClick={() => setLines(prev => prev.filter((_, i) => i !== idx))}
                      disabled={lines.length <= 1}
                      className={`${buttonClass} rounded-lg border dark:border-gray-700 disabled:opacity-50 font-semibold`}
                    >
                      حذف
                    </button>
                  </div>

                  {isCash && (
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        step="0.01"
                        value={Number(l.cashReceived) || 0}
                        onChange={e => setLines(prev => prev.map((row, i) => i === idx ? { ...row, cashReceived: Number(e.target.value) || 0 } : row))}
                        inputMode="decimal"
                        className={`flex-1 border rounded-lg dark:bg-gray-700 dark:border-gray-600 ${inputClass}`}
                        placeholder="المبلغ المستلم"
                      />
                      <div className="text-sm font-mono text-indigo-600">
                        {received > 0 ? (
                          <span dir="ltr">
                            {`الباقي: ${fmt(change)} `}<span className="text-xs">{code}</span>
                          </span>
                        ) : ''}
                      </div>
                      {touchMode && (
                        <button
                          type="button"
                          onClick={() => openKeypad({ kind: 'cash_multi', index: idx }, `المبلغ المستلم (دفعة ${idx + 1})`, Number(l.cashReceived) || 0)}
                          className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}
                        >
                          لوحة
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setLines(prev => prev.map((row, i) => i === idx ? { ...row, cashReceived: totalRounded } : row))}
                        className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}
                      >
                        كامل
                      </button>
                    </div>
                  )}

                  {isRef && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">{l.method === 'kuraimi' ? 'رقم الإيداع' : 'رقم الحوالة'}</div>
                        <input
                          value={l.referenceNumber || ''}
                          onChange={e => setLines(prev => prev.map((row, i) => i === idx ? { ...row, referenceNumber: e.target.value } : row))}
                          className={`w-full border rounded-lg dark:bg-gray-700 dark:border-gray-600 ${inputClass} ${refMissing ? 'border-red-400' : ''}`}
                        />
                      </div>
                      <div>
                        <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">{l.method === 'kuraimi' ? 'اسم المودِع' : 'اسم المرسل'}</div>
                        <input
                          value={l.senderName || ''}
                          onChange={e => setLines(prev => prev.map((row, i) => i === idx ? { ...row, senderName: e.target.value } : row))}
                          className={`w-full border rounded-lg dark:bg-gray-700 dark:border-gray-600 ${inputClass} ${nameMissing ? 'border-red-400' : ''}`}
                        />
                      </div>
                      <div>
                        <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">رقم الهاتف (اختياري)</div>
                        <input
                          value={l.senderPhone || ''}
                          onChange={e => setLines(prev => prev.map((row, i) => i === idx ? { ...row, senderPhone: e.target.value } : row))}
                          className={`w-full border rounded-lg dark:bg-gray-700 dark:border-gray-600 ${inputClass}`}
                        />
                      </div>
                      <div>
                        <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">مبلغ العملية</div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.01"
                            value={Number(l.declaredAmount) || 0}
                            onChange={e => setLines(prev => prev.map((row, i) => i === idx ? { ...row, declaredAmount: Number(e.target.value) || 0, amountConfirmed: false } : row))}
                            inputMode="decimal"
                            className={`flex-1 border rounded-lg dark:bg-gray-700 dark:border-gray-600 ${inputClass} ${declaredMissing || declaredMismatch ? 'border-red-400' : ''}`}
                            min={0}
                          />
                          {touchMode && (
                            <button
                              type="button"
                              onClick={() => openKeypad({ kind: 'declared_multi', index: idx }, `مبلغ العملية (دفعة ${idx + 1})`, Number(l.declaredAmount) || 0)}
                              className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}
                            >
                              لوحة
                            </button>
                          )}
                        </div>
                      </div>
                      <label className="sm:col-span-2 flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={Boolean(l.amountConfirmed)}
                          onChange={e => setLines(prev => prev.map((row, i) => i === idx ? { ...row, amountConfirmed: e.target.checked } : row))}
                        />
                        تأكيد مطابقة المبلغ
                      </label>
                      {declaredMismatch && (
                        <div className="sm:col-span-2 text-[11px] text-red-600 dark:text-red-400">
                          مبلغ العملية يجب أن يساوي مبلغ الدفعة.
                        </div>
                      )}
                    </div>
                  )}
                  {usedCashByOthers && <div className="text-xs text-red-500">لا يمكن إضافة نقد مرتين.</div>}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => {
                const nextMethod = availableMethods.find(m => m !== 'cash') || availableMethods[0] || 'cash';
                const currentSum = (lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
                const nextAmount = Math.max(0, Number((totalRounded - currentSum).toFixed(2)));
                const nextNeedsRef = nextMethod === 'kuraimi' || nextMethod === 'network';
                setLines(prev => [...prev, {
                  method: nextMethod,
                  amount: nextAmount,
                  declaredAmount: nextNeedsRef ? nextAmount : 0,
                  amountConfirmed: nextNeedsRef ? false : true,
                  cashReceived: nextMethod === 'cash' ? nextAmount : 0
                }]);
              }}
              className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}
            >
              إضافة دفعة
            </button>
          </div>
        )}
      </div>
      {!multiEnabled && method === 'cash' && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <input
              type="number"
              step="0.01"
              value={cashReceived}
              onChange={e => setCashReceived(Number(e.target.value) || 0)}
              inputMode="decimal"
              className={`flex-1 border rounded-lg dark:bg-gray-700 dark:border-gray-600 ${touchMode ? 'p-5 text-lg' : 'p-3'}`}
              placeholder="المبلغ المستلم"
            />
            <div className="text-sm font-mono text-indigo-600">
              {cashReceived > 0 ? (
                <span dir="ltr">
                  {`الباقي: ${fmt(Math.max(0, cashReceived - totalRounded))} `}<span className="text-xs">{code}</span>
                </span>
              ) : ''}
            </div>
            {touchMode && (
              <button
                type="button"
                onClick={() => openKeypad({ kind: 'cash_single' }, 'المبلغ المستلم', cashReceived)}
                className={`${touchMode ? 'px-5 py-4 text-base' : 'px-3 py-2 text-xs'} rounded-lg border dark:border-gray-700 font-semibold`}
              >
                لوحة
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setCashReceived(totalRounded)} className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}>كامل</button>
            <button type="button" onClick={() => setCashReceived(prev => Number((Number(prev || 0) + 1000).toFixed(2)))} className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}>+1000</button>
            <button type="button" onClick={() => setCashReceived(prev => Number((Number(prev || 0) + 2000).toFixed(2)))} className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}>+2000</button>
            <button type="button" onClick={() => setCashReceived(prev => Number((Number(prev || 0) + 5000).toFixed(2)))} className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}>+5000</button>
            <button type="button" onClick={() => setCashReceived(0)} className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}>تصفير</button>
          </div>
        </div>
      )}
      {!multiEnabled && needsReference && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">{method === 'kuraimi' ? 'رقم الإيداع' : 'رقم الحوالة'}</div>
            <input
              value={referenceNumber}
              onChange={e => { setReferenceNumber(e.target.value); setAmountConfirmed(false); }}
              className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <div>
            <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">{method === 'kuraimi' ? 'اسم المودِع' : 'اسم المرسل'}</div>
            <input
              value={senderName}
              onChange={e => { setSenderName(e.target.value); setAmountConfirmed(false); }}
              className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <div>
            <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">رقم الهاتف (اختياري)</div>
            <input
              value={senderPhone}
              onChange={e => setSenderPhone(e.target.value)}
              className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <div>
            <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">مبلغ العملية</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                value={declaredAmount}
                onChange={e => { setDeclaredAmount(Number(e.target.value) || 0); setAmountConfirmed(false); }}
                inputMode="decimal"
                className={`flex-1 border rounded-lg dark:bg-gray-700 dark:border-gray-600 ${inputClass}`}
                min={0}
              />
              {touchMode && (
                <button
                  type="button"
                  onClick={() => openKeypad({ kind: 'declared_single' }, 'مبلغ العملية', declaredAmount)}
                  className={`${buttonClass} rounded-lg border dark:border-gray-700 font-semibold`}
                >
                  لوحة
                </button>
              )}
            </div>
          </div>
          <label className="sm:col-span-2 flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={amountConfirmed}
              onChange={e => setAmountConfirmed(e.target.checked)}
            />
            تأكيد مطابقة المبلغ
          </label>
        </div>
      )}
      {!validation.ok && validation.message && (
        <div className="text-xs text-red-600 dark:text-red-400">{validation.message}</div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={onHold}
          disabled={!canFinalize}
          className={`flex-1 rounded-lg border dark:border-gray-700 disabled:opacity-50 font-semibold ${touchMode ? 'px-5 py-4 text-lg' : 'px-4 py-3'}`}
        >
          تعليق
        </button>
        {pendingOrderId && (
          <button
            onClick={onCancelHold}
            className={`rounded-lg border dark:border-gray-700 font-semibold ${touchMode ? 'px-5 py-4 text-lg' : 'px-4 py-3'}`}
          >
            إلغاء التعليق
          </button>
        )}
        <button
          onClick={finalize}
          disabled={!canSubmit}
          className={`flex-1 rounded-lg bg-primary-500 text-white disabled:opacity-50 font-semibold ${touchMode ? 'px-5 py-4 text-lg' : 'px-4 py-3'}`}
        >
          إتمام
        </button>
      </div>
      <NumericKeypadModal
        isOpen={Boolean(keypadTarget)}
        title={keypadTitle}
        initialValue={keypadInitial}
        onClose={() => setKeypadTarget(null)}
        onSubmit={applyKeypad}
      />
    </div>
  );
};

export default POSPaymentPanel;
