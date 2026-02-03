import React, { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../supabase';

type Props = {
  amount: number;
  currencyCode?: string;
  baseAmount?: number;
  fxRate?: number;
  label?: string;
  compact?: boolean;
};

let cachedBaseCode: string | null = null;
let baseCodePromise: Promise<string | null> | null = null;

const fmt = (n: number) => {
  const v = Number(n || 0);
  try {
    return v.toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return v.toFixed(2);
  }
};

const CurrencyDualAmount: React.FC<Props> = ({ amount, currencyCode, baseAmount, fxRate, label, compact }) => {
  const [baseCode, setBaseCode] = useState<string | null>(() => cachedBaseCode);
  const code = useMemo(() => String(currencyCode || '').toUpperCase(), [currencyCode]);
  const sym = code || '—';
  const baseSym = (baseCode || '').toUpperCase() || '—';
  const showFx = typeof fxRate === 'number' && Number.isFinite(fxRate);
  const showBase = typeof baseAmount === 'number' && Number.isFinite(baseAmount);

  useEffect(() => {
    if (baseCode) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!baseCodePromise) {
      baseCodePromise = (async () => {
        try {
          const { data, error } = await supabase.from('currencies').select('code').eq('is_base', true).limit(1).maybeSingle();
          if (error) return null;
          const c = String((data as any)?.code || '').toUpperCase();
          return c || null;
        } catch {
          return null;
        } finally {
          baseCodePromise = null;
        }
      })();
    }
    const p = baseCodePromise;
    if (!p) return;
    void p.then((c) => {
      if (!c) return;
      cachedBaseCode = c;
      setBaseCode(c);
    });
  }, [baseCode]);

  return (
    <div className={compact ? '' : 'space-y-0.5'}>
      <div className={compact ? 'text-sm font-bold' : 'text-base font-bold'}>
        {label ? <span className="text-gray-600 dark:text-gray-300 mr-1">{label}:</span> : null}
        <span dir="ltr">{fmt(amount)} <span className="text-xs">{sym}</span></span>
      </div>
      {(showBase || showFx) && (
        <div className="text-xs text-gray-600 dark:text-gray-300" dir="ltr">
          {showBase ? `≈ ${fmt(baseAmount as number)} ${baseSym}` : baseSym}{showFx ? ` • FX=${Number(fxRate).toFixed(6)}` : ''}
        </div>
      )}
    </div>
  );
};

export default CurrencyDualAmount;
