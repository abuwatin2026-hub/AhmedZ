import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getSupabaseClient } from '../../supabase';
import * as Icons from '../../components/icons';
import { useToast } from '../../contexts/ToastContext';

type PartyRow = { id: string; name: string; currency_preference?: string | null };

type OpenItemRow = {
  id: string;
  party_id: string;
  account_code: string;
  account_name: string;
  direction: 'debit' | 'credit';
  occurred_at: string;
  item_type: string;
  currency_code: string;
  open_foreign_amount: number | null;
  open_base_amount: number;
  status: string;
};

const withTimeout = async <T,>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const formatTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('ar-SA-u-nu-latn');
  } catch {
    return iso;
  }
};

export default function AdvanceManagementScreen() {
  const location = useLocation();
  const { showNotification } = useToast();
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const loadingRef = useRef(false);
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [partyId, setPartyId] = useState('');
  const [currency, setCurrency] = useState('');
  const [items, setItems] = useState<OpenItemRow[]>([]);
  const [currencyHint, setCurrencyHint] = useState<string>('');
  const [selectedInvoice, setSelectedInvoice] = useState('');
  const [selectedAdvance, setSelectedAdvance] = useState('');
  const [running, setRunning] = useState(false);
  const [applyForeign, setApplyForeign] = useState<string>('');
  const [applyBase, setApplyBase] = useState<string>('');
  const [backfilling, setBackfilling] = useState(false);
  const [lastBackfillCount, setLastBackfillCount] = useState<number | null>(null);
  const [didAutoBackfill, setDidAutoBackfill] = useState(false);

  const loadParties = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data, error } = await supabase
      .from('financial_parties')
      .select('id,name,currency_preference')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []).map((r: any) => ({
      id: String(r.id),
      name: String(r.name || '—'),
      currency_preference: r.currency_preference ? String(r.currency_preference) : null,
    }));
    setParties(rows);
    const requestedPartyId = String(new URLSearchParams(location.search).get('partyId') || '').trim();
    if (requestedPartyId && rows.some((p: any) => String(p.id) === requestedPartyId)) {
      setPartyId(requestedPartyId);
      return;
    }
    if (!partyId && rows.length > 0) setPartyId(rows[0].id);
  };

  const loadOpenItems = async () => {
    if (!partyId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      setCurrencyHint('');
      const { data, error } = await withTimeout<any>(
        supabase.rpc('list_party_open_items', {
          p_party_id: partyId,
          p_currency: null,
          p_status: 'open_active',
        } as any),
        15000,
        'انتهت مهلة تحميل العناصر المفتوحة.'
      );
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []) as any[];
      setItems(rows as any);
      const currencies = Array.from(new Set(rows.map((x: any) => String(x?.currency_code || '').trim().toUpperCase()).filter(Boolean)));
      const current = currency.trim().toUpperCase();
      const pref = String(parties.find((p) => p.id === partyId)?.currency_preference || '').trim().toUpperCase();

      if (current && currencies.length > 0 && !currencies.includes(current)) {
        setCurrencyHint(`لا توجد عناصر بالعملة ${current}. العملات المتاحة: ${currencies.join('، ')}`);
      }

      if (!current) {
        if (pref && currencies.includes(pref)) {
          setCurrency(pref);
        } else if (currencies.length === 1) {
          setCurrency(currencies[0]);
        }
      }
      if (rows.length === 0 && !didAutoBackfill) {
        setDidAutoBackfill(true);
        void backfillOpenItems();
      }
    } catch (e: any) {
      setItems([]);
      showNotification(String(e?.message || 'فشل تحميل العناصر المفتوحة.'), 'error');
    } finally {
      setLoading(false);
      loadingRef.current = false;
      setInitialLoaded(true);
    }
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await loadParties();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    void loadOpenItems();
  }, [partyId]);

  const backfillOpenItems = async () => {
    if (!partyId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setBackfilling(true);
    try {
      const { data, error } = await withTimeout<any>(
        supabase.rpc('backfill_party_open_items_for_party', {
          p_party_id: partyId,
          p_batch: 5000,
        } as any),
        20000,
        'انتهت مهلة تحديث العناصر المفتوحة.'
      );
      if (error) throw error;
      const created = Number((data as any)?.openItemsCreated || 0);
      setLastBackfillCount(created);
      if (created > 0) {
        showNotification(`تم تحديث العناصر المفتوحة: ${created}`, 'success');
      }
      await loadOpenItems();
    } catch (e: any) {
      showNotification(String(e?.message || 'فشل تحديث العناصر المفتوحة.'), 'error');
    } finally {
      setBackfilling(false);
    }
  };

  const currencyFilter = useMemo(() => String(currency || '').trim().toUpperCase(), [currency]);
  const filteredItems = useMemo(() => {
    if (!currencyFilter) return items;
    return items.filter((x) => String(x.currency_code || '').toUpperCase() === currencyFilter);
  }, [items, currencyFilter]);

  const currencyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      const c = String(it.currency_code || '').trim().toUpperCase();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const invoices = useMemo(
    () =>
      filteredItems
        .filter((x) => x.direction === 'debit' && ['invoice', 'bill', 'debit_note'].includes(String(x.item_type || '')))
        .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at))),
    [filteredItems],
  );

  const advances = useMemo(
    () =>
      filteredItems
        .filter((x) => x.direction === 'credit' && ['advance', 'payment', 'receipt', 'credit_note'].includes(String(x.item_type || '')))
        .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at))),
    [filteredItems],
  );

  const invoiceById = useMemo(() => {
    const map: Record<string, OpenItemRow> = {};
    invoices.forEach((x) => { map[x.id] = x; });
    return map;
  }, [invoices]);
  const advanceById = useMemo(() => {
    const map: Record<string, OpenItemRow> = {};
    advances.forEach((x) => { map[x.id] = x; });
    return map;
  }, [advances]);

  const suggested = useMemo(() => {
    const inv = invoiceById[selectedInvoice];
    const adv = advanceById[selectedAdvance];
    if (!inv || !adv) return { kind: 'none' as const, value: 0 };
    if (inv.currency_code !== adv.currency_code) return { kind: 'none' as const, value: 0 };
    if (inv.open_foreign_amount != null && adv.open_foreign_amount != null) {
      return { kind: 'foreign' as const, value: Math.min(Number(inv.open_foreign_amount || 0), Number(adv.open_foreign_amount || 0)) };
    }
    return { kind: 'base' as const, value: Math.min(Number(inv.open_base_amount || 0), Number(adv.open_base_amount || 0)) };
  }, [advanceById, invoiceById, selectedAdvance, selectedInvoice]);

  const applyAdvance = async () => {
    const inv = invoiceById[selectedInvoice];
    const adv = advanceById[selectedAdvance];
    if (!inv || !adv) return;
    if (inv.currency_code !== adv.currency_code) {
      showNotification('العملة يجب أن تكون نفسها.', 'error');
      return;
    }
    const useForeign = (inv.open_foreign_amount != null && adv.open_foreign_amount != null);
    const maxForeign = useForeign ? Math.min(Number(inv.open_foreign_amount || 0), Number(adv.open_foreign_amount || 0)) : 0;
    const maxBase = Math.min(Number(inv.open_base_amount || 0), Number(adv.open_base_amount || 0));
    const chosen = useForeign ? (Number(applyForeign || '') || suggested.value) : (Number(applyBase || '') || suggested.value);
    if (!(chosen > 0)) {
      showNotification('لا يوجد مبلغ قابل للتطبيق.', 'error');
      return;
    }
    if (useForeign && chosen - maxForeign > 1e-6) {
      showNotification(`المبلغ يتجاوز المتاح (${maxForeign.toFixed(2)})`, 'error');
      return;
    }
    if (!useForeign && chosen - maxBase > 1e-6) {
      showNotification(`المبلغ يتجاوز المتاح (${maxBase.toFixed(2)})`, 'error');
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setRunning(true);
    try {
      const alloc =
        useForeign
          ? [{ fromOpenItemId: inv.id, toOpenItemId: adv.id, allocatedForeignAmount: chosen }]
          : [{ fromOpenItemId: inv.id, toOpenItemId: adv.id, allocatedBaseAmount: chosen }];
      const { error } = await supabase.rpc('create_settlement', {
        p_party_id: partyId,
        p_settlement_date: new Date().toISOString(),
        p_allocations: alloc as any,
        p_notes: 'advance application',
      } as any);
      if (error) throw error;
      await loadOpenItems();
      setApplyForeign('');
      setApplyBase('');
      showNotification('تم تطبيق الدفعة المقدمة.', 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'فشل تطبيق الدفعة'), 'error');
    } finally {
      setRunning(false);
    }
  };

  if (loading && !initialLoaded) return <div className="p-8 text-center text-gray-500">جاري التحميل...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Advance Management</h1>
          <div className="text-sm text-gray-500 dark:text-gray-400">ربط الدفعات المسبقة بالفواتير لاحقاً</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadOpenItems()}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          >
            تحديث
          </button>
          <button
            onClick={() => void backfillOpenItems()}
            disabled={backfilling}
            className="px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-sm text-emerald-700 dark:text-emerald-200 disabled:opacity-60"
          >
            {backfilling ? 'جاري التحديث...' : 'تحديث العناصر المفتوحة'}
          </button>
          {lastBackfillCount != null ? (
            <span className="text-xs text-gray-600 dark:text-gray-300 px-2 py-1 border rounded-md bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              تم تحديث: {Number(lastBackfillCount || 0)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">الطرف</div>
          <select
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          >
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.id.slice(-6)}</option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">العملة (اختياري)</div>
          <select
            value={currencyFilter}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
          >
            <option value="">كل العملات</option>
            {currencyOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">مبلغ أجنبي</div>
              <input
                type="number"
                value={applyForeign}
                onChange={(e) => setApplyForeign(e.target.value)}
                placeholder="اختياري إذا كانت هناك مبالغ أجنبية"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">مبلغ بالأساس</div>
              <input
                type="number"
                value={applyBase}
                onChange={(e) => setApplyBase(e.target.value)}
                placeholder="اختياري إذا لا يوجد أجنبي"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
              />
            </div>
          </div>
          <button
            disabled={running || !selectedInvoice || !selectedAdvance}
            onClick={() => void applyAdvance()}
            className="w-full px-3 py-2 rounded-lg bg-primary-600 text-white text-sm disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <Icons.CheckIcon className="w-4 h-4" />
            تطبيق على فاتورة
          </button>
        </div>
      </div>

      {currencyHint ? (
        <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm">
          {currencyHint}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="font-semibold dark:text-white">فواتير مفتوحة</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{invoices.length}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-3 border-r dark:border-gray-700">التاريخ</th>
                  <th className="p-3 border-r dark:border-gray-700">الحساب</th>
                  <th className="p-3 border-r dark:border-gray-700">المتبقي</th>
                  <th className="p-3">اختيار</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {invoices.map((x) => (
                  <tr key={x.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 ${selectedInvoice === x.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}>
                    <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{formatTime(x.occurred_at)}</td>
                    <td className="p-3 border-r dark:border-gray-700">
                      <div className="font-mono">{x.account_code}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{x.account_name}</div>
                    </td>
                    <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">
                      {Number(x.open_base_amount || 0).toFixed(2)}
                      <div className="text-xs text-gray-500 dark:text-gray-400">{x.currency_code}{x.open_foreign_amount != null ? ` (${Number(x.open_foreign_amount).toFixed(2)})` : ''}</div>
                    </td>
                    <td className="p-3">
                      <button onClick={() => setSelectedInvoice(x.id)} className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
                        اختيار
                      </button>
                    </td>
                  </tr>
                ))}
                {invoices.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-gray-500">لا توجد فواتير.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="font-semibold dark:text-white">دفعات مقدمة مفتوحة</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{advances.length}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-3 border-r dark:border-gray-700">التاريخ</th>
                  <th className="p-3 border-r dark:border-gray-700">الحساب</th>
                  <th className="p-3 border-r dark:border-gray-700">المتبقي</th>
                  <th className="p-3">اختيار</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {advances.map((x) => (
                  <tr key={x.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 ${selectedAdvance === x.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}>
                    <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{formatTime(x.occurred_at)}</td>
                    <td className="p-3 border-r dark:border-gray-700">
                      <div className="font-mono">{x.account_code}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{x.account_name}</div>
                    </td>
                    <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">
                      {Number(x.open_base_amount || 0).toFixed(2)}
                      <div className="text-xs text-gray-500 dark:text-gray-400">{x.currency_code}{x.open_foreign_amount != null ? ` (${Number(x.open_foreign_amount).toFixed(2)})` : ''}</div>
                    </td>
                    <td className="p-3">
                      <button onClick={() => setSelectedAdvance(x.id)} className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
                        اختيار
                      </button>
                    </td>
                  </tr>
                ))}
                {advances.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-gray-500">لا توجد دفعات.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
        <div className="text-sm text-gray-700 dark:text-gray-200">
          المقترح: <span className="font-mono" dir="ltr">{suggested.kind === 'none' ? '—' : suggested.value.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
