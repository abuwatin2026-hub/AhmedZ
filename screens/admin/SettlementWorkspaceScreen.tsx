import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getSupabaseClient } from '../../supabase';
import * as Icons from '../../components/icons';
import { useToast } from '../../contexts/ToastContext';
import { localizeSourceTableAr, shortId } from '../../utils/displayLabels';

type PartyRow = { id: string; name: string; currency_preference?: string | null };

type OpenItemRow = {
  id: string;
  party_id: string;
  journal_entry_id: string;
  journal_line_id: string;
  account_code: string;
  account_name: string;
  direction: 'debit' | 'credit';
  occurred_at: string;
  due_date: string | null;
  item_role: string | null;
  item_type: string;
  source_table: string | null;
  source_id: string | null;
  source_event: string | null;
  currency_code: string;
  foreign_amount: number | null;
  base_amount: number;
  open_foreign_amount: number | null;
  open_base_amount: number;
  status: string;
};

type AllocationDraft = {
  fromOpenItemId: string;
  toOpenItemId: string;
  allocatedForeignAmount?: number;
  allocatedBaseAmount?: number;
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

export default function SettlementWorkspaceScreen() {
  const location = useLocation();
  const { showNotification } = useToast();
  const [loading, setLoading] = useState(true);
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [partyId, setPartyId] = useState('');
  const [currency, setCurrency] = useState('');
  const [items, setItems] = useState<OpenItemRow[]>([]);
  const [currencyHint, setCurrencyHint] = useState<string>('');
  const [selectedDebit, setSelectedDebit] = useState<string>('');
  const [selectedCredit, setSelectedCredit] = useState<string>('');
  const [allocations, setAllocations] = useState<AllocationDraft[]>([]);
  const [notes, setNotes] = useState('');
  const [running, setRunning] = useState(false);
  const [recentSettlements, setRecentSettlements] = useState<any[]>([]);
  const [nextForeign, setNextForeign] = useState<string>('');
  const [nextBase, setNextBase] = useState<string>('');
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
    }
  };

  const loadRecentSettlements = async () => {
    if (!partyId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      const { data } = await withTimeout<any>(
        supabase
          .from('settlement_headers')
          .select('id,settlement_date,currency_code,settlement_type,reverses_settlement_id,created_at,notes')
          .eq('party_id', partyId)
          .order('settlement_date', { ascending: false })
          .limit(50),
        15000,
        'انتهت مهلة تحميل التسويات الأخيرة.'
      );
      setRecentSettlements(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setRecentSettlements([]);
      showNotification(String(e?.message || 'فشل تحميل التسويات الأخيرة.'), 'error');
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
    void loadRecentSettlements();
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
      await loadRecentSettlements();
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

  const debits = useMemo(() => filteredItems.filter((x) => x.direction === 'debit').sort((a, b) => String(a.due_date || a.occurred_at).localeCompare(String(b.due_date || b.occurred_at))), [filteredItems]);
  const credits = useMemo(() => filteredItems.filter((x) => x.direction === 'credit').sort((a, b) => String(a.due_date || a.occurred_at).localeCompare(String(b.due_date || b.occurred_at))), [filteredItems]);

  const debitById = useMemo(() => {
    const map: Record<string, OpenItemRow> = {};
    debits.forEach((d) => { map[d.id] = d; });
    return map;
  }, [debits]);
  const creditById = useMemo(() => {
    const map: Record<string, OpenItemRow> = {};
    credits.forEach((d) => { map[d.id] = d; });
    return map;
  }, [credits]);

  const suggestedAmount = useMemo(() => {
    const d = debitById[selectedDebit];
    const c = creditById[selectedCredit];
    if (!d || !c) return { kind: 'none' as const, value: 0 };
    if (d.currency_code !== c.currency_code) return { kind: 'none' as const, value: 0 };
    if (d.open_foreign_amount != null && c.open_foreign_amount != null) {
      return { kind: 'foreign' as const, value: Math.max(0, Math.min(Number(d.open_foreign_amount || 0), Number(c.open_foreign_amount || 0))) };
    }
    return { kind: 'base' as const, value: Math.max(0, Math.min(Number(d.open_base_amount || 0), Number(c.open_base_amount || 0))) };
  }, [creditById, debitById, selectedCredit, selectedDebit]);

  const addAllocation = () => {
    const d = debitById[selectedDebit];
    const c = creditById[selectedCredit];
    if (!d || !c) return;
    if (d.currency_code !== c.currency_code) {
      showNotification('العملة يجب أن تكون نفسها.', 'error');
      return;
    }
    const baseDraft: AllocationDraft = { fromOpenItemId: d.id, toOpenItemId: c.id };
    const useForeign = (d.open_foreign_amount != null && c.open_foreign_amount != null);
    if (useForeign) {
      const maxForeign = Math.max(0, Math.min(Number(d.open_foreign_amount || 0), Number(c.open_foreign_amount || 0)));
      const chosen = Number(nextForeign || '') || Number(suggestedAmount.value || 0);
      if (!(chosen > 0)) {
        showNotification('حدد مبلغ تخصيص صحيح.', 'error');
        return;
      }
      if (chosen - maxForeign > 1e-6) {
        showNotification(`المبلغ يتجاوز المتاح (${maxForeign.toFixed(2)})`, 'error');
        return;
      }
      baseDraft.allocatedForeignAmount = chosen;
    } else {
      const maxBase = Math.max(0, Math.min(Number(d.open_base_amount || 0), Number(c.open_base_amount || 0)));
      const chosen = Number(nextBase || '') || Number(suggestedAmount.value || 0);
      if (!(chosen > 0)) {
        showNotification('حدد مبلغ تخصيص صحيح.', 'error');
        return;
      }
      if (chosen - maxBase > 1e-6) {
        showNotification(`المبلغ يتجاوز المتاح (${maxBase.toFixed(2)})`, 'error');
        return;
      }
      baseDraft.allocatedBaseAmount = chosen;
    }
    if (!baseDraft.allocatedForeignAmount && !baseDraft.allocatedBaseAmount) {
      showNotification('حدد مبلغ تخصيص صحيح.', 'error');
      return;
    }
    setAllocations((prev) => [...prev, baseDraft]);
    setNextForeign('');
    setNextBase('');
  };

  const createSettlement = async () => {
    if (!partyId) return;
    if (allocations.length === 0) {
      showNotification('لا توجد تخصيصات.', 'info');
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setRunning(true);
    try {
      const payload = allocations.map((a) => ({
        fromOpenItemId: a.fromOpenItemId,
        toOpenItemId: a.toOpenItemId,
        allocatedForeignAmount: a.allocatedForeignAmount ?? undefined,
        allocatedBaseAmount: a.allocatedBaseAmount ?? undefined,
      }));
      const { data, error } = await supabase.rpc('create_settlement', {
        p_party_id: partyId,
        p_settlement_date: new Date().toISOString(),
        p_allocations: payload as any,
        p_notes: notes || null,
      } as any);
      if (error) throw error;
      setAllocations([]);
      setNotes('');
      await loadOpenItems();
      await loadRecentSettlements();
      showNotification(`تم إنشاء التسوية: ${String(data || '').slice(-8)}`, 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'فشل إنشاء التسوية'), 'error');
    } finally {
      setRunning(false);
    }
  };

  const autoSettle = async () => {
    if (!partyId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.rpc('auto_settle_party_items', { p_party_id: partyId } as any);
      if (error) throw error;
      await loadOpenItems();
      await loadRecentSettlements();
      showNotification(data ? `تمت التسوية التلقائية: ${String(data).slice(-8)}` : 'لا توجد عناصر قابلة للمطابقة.', data ? 'success' : 'info');
    } catch (e: any) {
      showNotification(String(e?.message || 'فشل التشغيل التلقائي'), 'error');
    } finally {
      setRunning(false);
    }
  };

  const reverseSettlement = async (id: string) => {
    const reason = window.prompt('سبب عكس التسوية؟');
    if (!reason) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setRunning(true);
    try {
      const { error } = await supabase.rpc('void_settlement', { p_settlement_id: id, p_reason: reason } as any);
      if (error) throw error;
      await loadOpenItems();
      await loadRecentSettlements();
      showNotification('تم عكس التسوية.', 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'فشل عكس التسوية'), 'error');
    } finally {
      setRunning(false);
    }
  };

  const onDragStart = (openItemId: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', openItemId);
  };

  const onDropToDebit = (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (debitById[id]) setSelectedDebit(id);
    if (creditById[id]) setSelectedCredit('');
  };

  const onDropToCredit = (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (creditById[id]) setSelectedCredit(id);
    if (debitById[id]) setSelectedDebit('');
  };

  if (loading) return <div className="p-8 text-center text-gray-500">جاري التحميل...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Settlement Workspace</h1>
          <div className="text-sm text-gray-500 dark:text-gray-400">تسوية/تخصيص عناصر الطرف (AR/AP/Advances)</div>
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
          <button
            disabled={running}
            onClick={() => void autoSettle()}
            className="w-full px-3 py-2 rounded-lg bg-primary-600 text-white text-sm disabled:opacity-60"
          >
            تشغيل Auto Match (FIFO)
          </button>
        </div>
      </div>

      {currencyHint ? (
        <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm">
          {currencyHint}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-hidden"
          onDrop={onDropToDebit}
          onDragOver={(e) => e.preventDefault()}
        >
          <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="font-semibold dark:text-white">عناصر مدينة (Debits)</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{debits.length}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-3 border-r dark:border-gray-700">التاريخ</th>
                  <th className="p-3 border-r dark:border-gray-700">النوع</th>
                  <th className="p-3 border-r dark:border-gray-700">الحساب</th>
                  <th className="p-3 border-r dark:border-gray-700">المتبقي</th>
                  <th className="p-3">المرجع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {debits.map((d) => (
                  <tr
                    key={d.id}
                    draggable
                    onDragStart={onDragStart(d.id)}
                    onClick={() => setSelectedDebit(d.id)}
                    className={`cursor-pointer ${selectedDebit === d.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''} hover:bg-gray-50 dark:hover:bg-gray-700/30`}
                  >
                    <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{formatTime(d.occurred_at)}</td>
                    <td className="p-3 border-r dark:border-gray-700">{d.item_type}</td>
                    <td className="p-3 border-r dark:border-gray-700">
                      <div className="font-mono">{d.account_code}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{d.account_name}</div>
                    </td>
                    <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">
                      {Number(d.open_base_amount || 0).toFixed(2)}
                      <div className="text-xs text-gray-500 dark:text-gray-400">{d.currency_code}{d.open_foreign_amount != null ? ` (${Number(d.open_foreign_amount).toFixed(2)})` : ''}</div>
                    </td>
                    <td className="p-3 text-xs">{`${localizeSourceTableAr(d.source_table)} • ${shortId(d.source_id)}`}</td>
                  </tr>
                ))}
                {debits.length === 0 ? (
                  <tr><td className="p-6 text-center text-gray-500" colSpan={5}>لا توجد عناصر.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div
          className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-hidden"
          onDrop={onDropToCredit}
          onDragOver={(e) => e.preventDefault()}
        >
          <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="font-semibold dark:text-white">عناصر دائنة (Credits)</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{credits.length}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-3 border-r dark:border-gray-700">التاريخ</th>
                  <th className="p-3 border-r dark:border-gray-700">النوع</th>
                  <th className="p-3 border-r dark:border-gray-700">الحساب</th>
                  <th className="p-3 border-r dark:border-gray-700">المتبقي</th>
                  <th className="p-3">المرجع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {credits.map((d) => (
                  <tr
                    key={d.id}
                    draggable
                    onDragStart={onDragStart(d.id)}
                    onClick={() => setSelectedCredit(d.id)}
                    className={`cursor-pointer ${selectedCredit === d.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''} hover:bg-gray-50 dark:hover:bg-gray-700/30`}
                  >
                    <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{formatTime(d.occurred_at)}</td>
                    <td className="p-3 border-r dark:border-gray-700">{d.item_type}</td>
                    <td className="p-3 border-r dark:border-gray-700">
                      <div className="font-mono">{d.account_code}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{d.account_name}</div>
                    </td>
                    <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">
                      {Number(d.open_base_amount || 0).toFixed(2)}
                      <div className="text-xs text-gray-500 dark:text-gray-400">{d.currency_code}{d.open_foreign_amount != null ? ` (${Number(d.open_foreign_amount).toFixed(2)})` : ''}</div>
                    </td>
                    <td className="p-3 text-xs">{`${localizeSourceTableAr(d.source_table)} • ${shortId(d.source_id)}`}</td>
                  </tr>
                ))}
                {credits.length === 0 ? (
                  <tr><td className="p-6 text-center text-gray-500" colSpan={5}>لا توجد عناصر.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold dark:text-white">تخصيص يدوي</div>
          <button
            disabled={!selectedDebit || !selectedCredit}
            onClick={addAllocation}
            className="px-3 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm disabled:opacity-50 flex items-center gap-2"
          >
            <Icons.PlusIcon className="w-4 h-4" />
            إضافة تخصيص
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="text-sm text-gray-700 dark:text-gray-200">
            من (مدين): <span className="font-mono">{shortId(selectedDebit)}</span>
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-200">
            إلى (دائن): <span className="font-mono">{shortId(selectedCredit)}</span>
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-200">
            مقترح: <span className="font-mono">{suggestedAmount.kind === 'foreign' || suggestedAmount.kind === 'base' ? suggestedAmount.value.toFixed(2) : '—'}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">مبلغ عملة أجنبية</div>
              <input
                type="number"
                value={nextForeign}
                onChange={(e) => setNextForeign(e.target.value)}
                placeholder="اختياري إذا كان العنصر بعملة أجنبية"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">مبلغ بالأساس</div>
              <input
                type="number"
                value={nextBase}
                onChange={(e) => setNextBase(e.target.value)}
                placeholder="اختياري عند عدم وجود أجنبي"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
              />
            </div>
          </div>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات (اختياري)"
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
          <div className="flex gap-2">
            <button
              disabled={running}
              onClick={() => void createSettlement()}
              className="flex-1 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm disabled:opacity-60"
            >
              إنشاء Settlement
            </button>
            <button
              disabled={running}
              onClick={() => setAllocations([])}
              className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm disabled:opacity-60"
            >
              مسح
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="p-3 border-r dark:border-gray-700">من</th>
                <th className="p-3 border-r dark:border-gray-700">إلى</th>
                <th className="p-3 border-r dark:border-gray-700">المبلغ</th>
                <th className="p-3">حذف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {allocations.map((a, idx) => (
                <tr key={`${a.fromOpenItemId}-${a.toOpenItemId}-${idx}`}>
                  <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{a.fromOpenItemId.slice(-8)}</td>
                  <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{a.toOpenItemId.slice(-8)}</td>
                  <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">
                    {a.allocatedForeignAmount != null ? `F:${Number(a.allocatedForeignAmount).toFixed(2)}` : `B:${Number(a.allocatedBaseAmount || 0).toFixed(2)}`}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => setAllocations((prev) => prev.filter((_, i) => i !== idx))}
                      className="px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-200"
                    >
                      <Icons.TrashIcon className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {allocations.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-gray-500">لا توجد تخصيصات.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
        <div className="font-semibold dark:text-white mb-3">Settlements الأخيرة</div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="p-3 border-r dark:border-gray-700">التاريخ</th>
                <th className="p-3 border-r dark:border-gray-700">النوع</th>
                <th className="p-3 border-r dark:border-gray-700">العملة</th>
                <th className="p-3 border-r dark:border-gray-700">المرجع</th>
                <th className="p-3">عكس</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {recentSettlements.map((s: any) => (
                <tr key={String(s.id)}>
                  <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{formatTime(String(s.settlement_date || s.created_at || ''))}</td>
                  <td className="p-3 border-r dark:border-gray-700">{String(s.settlement_type || 'normal')}</td>
                  <td className="p-3 border-r dark:border-gray-700 font-mono">{String(s.currency_code || '—')}</td>
                  <td className="p-3 border-r dark:border-gray-700 font-mono" dir="ltr">{String(s.id).slice(-8)}</td>
                  <td className="p-3">
                    {String(s.settlement_type) === 'normal' ? (
                      <button
                        disabled={running}
                        onClick={() => void reverseSettlement(String(s.id))}
                        className="px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-200 disabled:opacity-60"
                        title="عكس"
                      >
                        <Icons.ArrowLeft className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {recentSettlements.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-gray-500">لا توجد تسويات.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
