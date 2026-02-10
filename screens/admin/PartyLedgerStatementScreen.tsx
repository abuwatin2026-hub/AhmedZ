import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { renderToString } from 'react-dom/server';
import { getSupabaseClient } from '../../supabase';
import { useAuth } from '../../contexts/AuthContext';
import * as Icons from '../../components/icons';
import { useSettings } from '../../contexts/SettingsContext';
import { useToast } from '../../contexts/ToastContext';
import { printContent } from '../../utils/printUtils';
import PrintablePartyLedgerStatement from '../../components/admin/documents/PrintablePartyLedgerStatement';

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
  open_base_amount: number | null;
  open_foreign_amount: number | null;
  open_status: string | null;
  allocations?: any;
};

const PartyLedgerStatementScreen: React.FC = () => {
  const { partyId } = useParams();
  const location = useLocation();
  const { settings } = useSettings();
  const { showNotification } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [partyName, setPartyName] = useState<string>('—');
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [accountCode, setAccountCode] = useState<string>('');
  const [currency, setCurrency] = useState<string>('');
  const [start, setStart] = useState<string>('');
  const [end, setEnd] = useState<string>('');
  const [printing, setPrinting] = useState(false);
  const [didAutoPrint, setDidAutoPrint] = useState(false);
  const [currencyOptions, setCurrencyOptions] = useState<string[]>([]);
  const [accountOptions, setAccountOptions] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [lastBackfillCount, setLastBackfillCount] = useState<number | null>(null);
  const canManage = user?.role === 'owner' || user?.role === 'manager';

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

      const { data, error } = await supabase.rpc('party_ledger_statement_v2', {
        p_party_id: partyId,
        p_account_code: accountCode.trim() || null,
        p_currency: currency.trim().toUpperCase() || null,
        p_start: start.trim() || null,
        p_end: end.trim() || null,
      } as any);
      if (error) throw error;
      setRows((Array.isArray(data) ? data : []) as any);
    } catch (err: any) {
      showNotification(String(err?.message || 'تعذر تحميل كشف الحساب'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [partyId]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let cancelled = false;
    const runCurrencies = async () => {
      try {
        const { data, error } = await supabase
          .from('currencies')
          .select('code')
          .order('code', { ascending: true });
        if (error) throw error;
        const codes = (Array.isArray(data) ? data : [])
          .map((r: any) => String(r?.code || '').trim().toUpperCase())
          .filter(Boolean);
        const uniq = Array.from(new Set(codes));
        if (!cancelled) setCurrencyOptions(uniq);
      } catch {
        if (!cancelled) setCurrencyOptions([]);
      }
    };
    const runAccounts = async () => {
      try {
        const { data, error } = await supabase
          .from('party_subledger_accounts')
          .select('account_id')
          .eq('is_active', true);
        if (error) throw error;
        const ids = (Array.isArray(data) ? data : []).map((r: any) => String(r?.account_id || '')).filter(Boolean);
        if (ids.length === 0) {
          setAccountOptions([]);
          return;
        }
        const { data: coaRows, error: coaErr } = await supabase
          .from('chart_of_accounts')
          .select('code')
          .in('id', ids);
        if (coaErr) throw coaErr;
        const codes = (Array.isArray(coaRows) ? coaRows : []).map((r: any) => String(r?.code || '').trim()).filter(Boolean);
        const uniq = Array.from(new Set(codes));
        setAccountOptions(uniq);
      } catch {
        setAccountOptions([]);
      }
    };
    void runCurrencies();
    void runAccounts();
    return () => { cancelled = true; };
  }, []);
  const totals = useMemo(() => {
    const debit = rows.reduce((s, r) => s + (r.direction === 'debit' ? Number(r.base_amount || 0) : 0), 0);
    const credit = rows.reduce((s, r) => s + (r.direction === 'credit' ? Number(r.base_amount || 0) : 0), 0);
    const last = rows.length ? rows[rows.length - 1].running_balance : 0;
    return { debit, credit, last };
  }, [rows]);

  const handlePrint = async () => {
    if (!partyId) return;
    if (rows.length === 0) {
      showNotification('لا توجد حركات لطباعة كشف الحساب حسب المرشحات الحالية.', 'info');
      return;
    }
    setPrinting(true);
    try {
      const brand = {
        name: (settings as any)?.cafeteriaName?.ar || (settings as any)?.cafeteriaName?.en || '',
        address: String(settings?.address || ''),
        contactNumber: String(settings?.contactNumber || ''),
        logoUrl: String(settings?.logoUrl || ''),
      };
      const content = renderToString(
        <PrintablePartyLedgerStatement
          brand={brand}
          partyId={partyId}
          partyName={partyName}
          accountCode={accountCode.trim() || null}
          currency={currency.trim() || null}
          start={start.trim() || null}
          end={end.trim() || null}
          rows={rows}
        />
      );
      printContent(content, `كشف حساب طرف • ${partyName || partyId.slice(-8).toUpperCase()}`, { page: 'A4' });
      const supabase = getSupabaseClient();
      if (supabase) {
        try {
          await supabase.from('system_audit_logs').insert({
            action: 'print',
            module: 'documents',
            details: `Printed Party Statement ${partyName || partyId}`,
            metadata: {
              docType: 'party_statement',
              docNumber: partyName || null,
              status: null,
              sourceTable: 'financial_parties',
              sourceId: partyId,
              template: 'PrintablePartyLedgerStatement',
              accountCode: accountCode.trim() || null,
              currency: currency.trim().toUpperCase() || null,
              start: start.trim() || null,
              end: end.trim() || null,
            }
          } as any);
        } catch {
        }
      }
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر فتح نافذة الطباعة'), 'error');
    } finally {
      setPrinting(false);
    }
  };

  const handleBackfill = async () => {
    if (!partyId) return;
    const ok = window.confirm('سيتم تحديث دفتر الطرف لهذا الطرف اعتمادًا على القيود المرحّلة. المتابعة؟');
    if (!ok) return;
    setBackfilling(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('supabase not available');
      const { data, error } = await supabase.rpc('backfill_party_ledger_for_existing_entries', {
        p_batch: 5000,
        p_only_party_id: partyId,
      } as any);
      if (error) throw error;
      const count = Number(data) || 0;
      setLastBackfillCount(count);
      showNotification(`تم تحديث دفتر الطرف (${count} سطر/أسطر).`, 'success');
      await load();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر تحديث دفتر الطرف'), 'error');
    } finally {
      setBackfilling(false);
    }
  };

  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    const auto = qs.get('print') === '1';
    if (!auto) return;
    if (didAutoPrint) return;
    if (loading) return;
    if (rows.length === 0) return;
    setDidAutoPrint(true);
    void handlePrint();
  }, [didAutoPrint, loading, location.search, rows.length]);

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handlePrint()}
            className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-lg border border-gray-100 dark:border-gray-700 disabled:opacity-60"
            disabled={printing || rows.length === 0}
            title="طباعة كشف الحساب"
          >
            <Icons.PrinterIcon className="w-5 h-5" />
            <span>طباعة</span>
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => void handleBackfill()}
              className="bg-primary-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-primary-700 shadow-lg border border-primary-700 disabled:opacity-60"
              disabled={backfilling}
              title="تحديث دفتر الطرف لهذا الطرف"
            >
              <span>{backfilling ? 'جاري التحديث...' : 'تحديث دفتر الطرف'}</span>
            </button>
          )}
          {canManage && lastBackfillCount != null && (
            <span className="text-xs text-gray-600 dark:text-gray-300 px-2 py-1 border rounded-md bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              تم تحديث: {Number(lastBackfillCount || 0)}
            </span>
          )}
          <Link
            to="/admin/financial-parties"
            className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-lg border border-gray-100 dark:border-gray-700"
          >
            <Icons.ListIcon className="w-5 h-5" />
            <span>عودة</span>
          </Link>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-4 mb-4 grid grid-cols-1 md:grid-cols-6 gap-3">
        <div className="md:col-span-2">
          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">كود الحساب (اختياري)</label>
          <input
            list="account-codes"
            value={accountCode}
            onChange={(e) => setAccountCode(e.target.value)}
            placeholder="مثل 1200/2010"
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
            onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
          />
          <datalist id="account-codes">
            {accountOptions.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">العملة (اختياري)</label>
          <input
            list="currency-codes"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            placeholder="مثل YER/USD"
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
            onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
          />
          <datalist id="currency-codes">
            {currencyOptions.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">من</label>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
            onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">إلى</label>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
            onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
          />
        </div>
        <div className="flex items-end gap-2">
          <button
            onClick={async () => { setApplying(true); await load(); setApplying(false); }}
            className="bg-primary-600 text-white px-4 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-primary-700 disabled:opacity-60"
            disabled={applying}
            title="تطبيق المرشحات"
          >
            {applying ? 'جاري التطبيق...' : (
              <>
                <Icons.Search className="w-5 h-5" />
                <span>عرض</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              const s = new Date(); s.setDate(s.getDate() - 90);
              setStart(s.toISOString().slice(0, 10));
              setEnd(new Date().toISOString().slice(0, 10));
            }}
            className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 text-xs"
            title="آخر 90 يومًا"
          >
            آخر 90 يومًا
          </button>
        </div>
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
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">متبقي</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">المصدر</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-500 dark:text-gray-400">
                    لا توجد حركات. جرّب تعديل المرشحات (الفترة/العملة/الحساب) ثم اضغط "عرض".
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
                    <td className="p-4 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">
                      <div className="font-mono" dir="ltr">
                        {r.open_base_amount == null ? '—' : Number(r.open_base_amount || 0).toFixed(2)}
                      </div>
                      {r.open_status ? (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {r.open_status === 'open' ? 'مفتوح' : r.open_status === 'partially_settled' ? 'مجزأ' : 'مُسوّى'}
                        </div>
                      ) : null}
                      {Array.isArray(r.allocations) && r.allocations.length > 0 ? (
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">
                          settlements:{r.allocations.length}
                        </div>
                      ) : null}
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
