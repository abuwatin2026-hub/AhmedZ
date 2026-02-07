import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import * as Icons from '../../components/icons';

type PartyRow = { id: string; name: string };

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

const formatTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('ar-SA-u-nu-latn');
  } catch {
    return iso;
  }
};

export default function AdvanceManagementScreen() {
  const [loading, setLoading] = useState(true);
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [partyId, setPartyId] = useState('');
  const [currency, setCurrency] = useState('');
  const [items, setItems] = useState<OpenItemRow[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState('');
  const [selectedAdvance, setSelectedAdvance] = useState('');
  const [running, setRunning] = useState(false);

  const loadParties = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data, error } = await supabase
      .from('financial_parties')
      .select('id,name')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []).map((r: any) => ({ id: String(r.id), name: String(r.name || '—') }));
    setParties(rows);
    if (!partyId && rows.length > 0) setPartyId(rows[0].id);
  };

  const loadOpenItems = async () => {
    if (!partyId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_party_open_items', {
        p_party_id: partyId,
        p_currency: currency.trim().toUpperCase() || null,
        p_status: 'open_active',
      } as any);
      if (error) throw error;
      setItems((Array.isArray(data) ? data : []) as any);
    } finally {
      setLoading(false);
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

  const invoices = useMemo(
    () =>
      items
        .filter((x) => x.direction === 'debit' && x.item_type === 'invoice')
        .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at))),
    [items],
  );

  const advances = useMemo(
    () =>
      items
        .filter((x) => x.direction === 'credit' && x.item_type === 'advance')
        .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at))),
    [items],
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
      alert('العملة يجب أن تكون نفسها.');
      return;
    }
    if (suggested.value <= 0) {
      alert('لا يوجد مبلغ قابل للتطبيق.');
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setRunning(true);
    try {
      const alloc =
        suggested.kind === 'foreign'
          ? [{ fromOpenItemId: inv.id, toOpenItemId: adv.id, allocatedForeignAmount: suggested.value }]
          : [{ fromOpenItemId: inv.id, toOpenItemId: adv.id, allocatedBaseAmount: suggested.value }];
      const { error } = await supabase.rpc('create_settlement', {
        p_party_id: partyId,
        p_settlement_date: new Date().toISOString(),
        p_allocations: alloc as any,
        p_notes: 'advance application',
      } as any);
      if (error) throw error;
      await loadOpenItems();
      alert('تم تطبيق الدفعة المقدمة.');
    } catch (e: any) {
      alert(String(e?.message || 'فشل تطبيق الدفعة'));
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">جاري التحميل...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Advance Management</h1>
          <div className="text-sm text-gray-500 dark:text-gray-400">ربط الدفعات المسبقة بالفواتير لاحقاً</div>
        </div>
        <button
          onClick={() => void loadOpenItems()}
          className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
        >
          تحديث
        </button>
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
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder="USD"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
          />
        </div>
        <div className="flex items-end">
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
