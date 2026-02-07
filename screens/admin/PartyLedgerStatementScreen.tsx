import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getSupabaseClient } from '../../supabase';
import * as Icons from '../../components/icons';

type StatementRow = {
  occurred_at: string;
  journal_entry_id: string;
  journal_line_id: string;
  account_code: string;
  account_name: string;
  direction: 'debit' | 'credit';
  foreign_amount: number | null;
  base_amount: number;
  currency_code: string;
  fx_rate: number | null;
  memo: string | null;
  source_table: string | null;
  source_id: string | null;
  source_event: string | null;
  running_balance: number;
};

const PartyLedgerStatementScreen: React.FC = () => {
  const { partyId } = useParams();
  const [loading, setLoading] = useState(true);
  const [partyName, setPartyName] = useState<string>('—');
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [accountCode, setAccountCode] = useState<string>('');
  const [currency, setCurrency] = useState<string>('');
  const [start, setStart] = useState<string>('');
  const [end, setEnd] = useState<string>('');

  const load = async () => {
    if (!partyId) return;
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('supabase not available');

      const { data: partyRow } = await supabase
        .from('financial_parties')
        .select('name')
        .eq('id', partyId)
        .maybeSingle();
      setPartyName(String((partyRow as any)?.name || '—'));

      const { data, error } = await supabase.rpc('party_ledger_statement', {
        p_party_id: partyId,
        p_account_code: accountCode.trim() || null,
        p_currency: currency.trim().toUpperCase() || null,
        p_start: start.trim() || null,
        p_end: end.trim() || null,
      } as any);
      if (error) throw error;
      setRows((Array.isArray(data) ? data : []) as any);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [partyId]);

  const totals = useMemo(() => {
    const debit = rows.reduce((s, r) => s + (r.direction === 'debit' ? Number(r.base_amount || 0) : 0), 0);
    const credit = rows.reduce((s, r) => s + (r.direction === 'credit' ? Number(r.base_amount || 0) : 0), 0);
    const last = rows.length ? rows[rows.length - 1].running_balance : 0;
    return { debit, credit, last };
  }, [rows]);

  if (loading) return <div className="p-8 text-center text-gray-500">جاري التحميل...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-l from-primary-600 to-gold-500">
            كشف حساب الطرف
          </h1>
          <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            <span className="font-mono">{partyId}</span>
            <span className="mx-2">—</span>
            <span className="font-semibold">{partyName}</span>
          </div>
        </div>
        <Link
          to="/admin/financial-parties"
          className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-lg border border-gray-100 dark:border-gray-700"
        >
          <Icons.ListIcon className="w-5 h-5" />
          <span>عودة</span>
        </Link>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-4 mb-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <input
          value={accountCode}
          onChange={(e) => setAccountCode(e.target.value)}
          placeholder="كود الحساب (اختياري)"
          className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
        />
        <input
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          placeholder="العملة (اختياري)"
          className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
        />
        <input
          value={start}
          onChange={(e) => setStart(e.target.value)}
          placeholder="من (YYYY-MM-DD)"
          className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
        />
        <input
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          placeholder="إلى (YYYY-MM-DD)"
          className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
        />
        <button
          onClick={() => void load()}
          className="bg-primary-600 text-white px-4 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-primary-700"
        >
          <Icons.Search className="w-5 h-5" />
          <span>تطبيق</span>
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
        <div className="text-gray-700 dark:text-gray-200">إجمالي مدين: <span className="font-mono">{totals.debit.toFixed(2)}</span></div>
        <div className="text-gray-700 dark:text-gray-200">إجمالي دائن: <span className="font-mono">{totals.credit.toFixed(2)}</span></div>
        <div className="text-gray-700 dark:text-gray-200">الرصيد الحالي: <span className="font-mono">{totals.last.toFixed(2)}</span></div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">التاريخ</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الحساب</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">مدين</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">دائن</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">العملة</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الرصيد</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">المصدر</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500 dark:text-gray-400">
                    لا توجد حركات.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.journal_line_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="p-4 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">
                      {new Date(r.occurred_at).toLocaleString('ar-SA-u-nu-latn')}
                    </td>
                    <td className="p-4 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">
                      <div className="font-mono">{r.account_code}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{r.account_name}</div>
                    </td>
                    <td className="p-4 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">
                      {r.direction === 'debit' ? Number(r.base_amount || 0).toFixed(2) : '—'}
                    </td>
                    <td className="p-4 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">
                      {r.direction === 'credit' ? Number(r.base_amount || 0).toFixed(2) : '—'}
                    </td>
                    <td className="p-4 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono">
                      {r.currency_code}
                      {r.foreign_amount != null ? <span className="text-xs text-gray-500 dark:text-gray-400"> ({Number(r.foreign_amount).toFixed(2)})</span> : null}
                    </td>
                    <td className="p-4 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">
                      {Number(r.running_balance || 0).toFixed(2)}
                    </td>
                    <td className="p-4 text-gray-700 dark:text-gray-200">
                      <div className="font-mono text-xs">{r.source_table}:{r.source_event}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">
                        {r.source_id || '—'}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PartyLedgerStatementScreen;
