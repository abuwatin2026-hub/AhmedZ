import React, { useEffect, useMemo, useState } from 'react';
import { getBaseCurrencyCode } from '../../supabase';

type Props = {
  amount: number;
  currencyCode?: string;
  baseAmount?: number;
  fxRate?: number;
  label?: string;
  compact?: boolean;
};

const fmt = (n: number) => {
  const v = Number(n || 0);
  try {
    return v.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return v.toFixed(2);
  }
};

const CurrencyDualAmount: React.FC<Props> = ({ amount, currencyCode, baseAmount, fxRate, label, compact }) => {
  const [baseCode, setBaseCode] = useState<string | null>(null);
  const code = useMemo(() => String(currencyCode || '').toUpperCase(), [currencyCode]);
  const sym = code || '—';
  const baseSym = (baseCode || '').toUpperCase() || '—';
  const showBase = typeof baseAmount === 'number' && Number.isFinite(baseAmount);
  const showFx = showBase && typeof fxRate === 'number' && Number.isFinite(fxRate);

  useEffect(() => {
    if (!showBase) return;
    if (baseCode) return;
    void getBaseCurrencyCode().then((c) => {
      if (!c) return;
      setBaseCode(c);
    });
  }, [baseCode, showBase]);

  return (
    <div className={compact ? '' : 'space-y-0.5'}>
      <div className={compact ? 'text-sm font-bold' : 'text-base font-bold'}>
        {label ? <span className="text-gray-600 dark:text-gray-300 mr-1">{label}:</span> : null}
        <span dir="ltr">{fmt(amount)} <span className="text-xs">{sym}</span></span>
      </div>
      {showBase && (
        <div className="text-xs text-gray-600 dark:text-gray-300" dir="ltr">
          {`بالعملة الأساسية: ${fmt(baseAmount as number)} ${baseSym}`}{showFx ? ` • FX=${Number(fxRate).toFixed(6)}` : ''}
        </div>
      )}
    </div>
  );
};

export default CurrencyDualAmount;
