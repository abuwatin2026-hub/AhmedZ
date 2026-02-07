import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import PageLoader from '../../components/PageLoader';
import { useToast } from '../../contexts/ToastContext';

type BankAccount = {
  id: string;
  name: string;
  bank_name?: string | null;
  account_number?: string | null;
  currency: string;
  coa_account_id?: string | null;
  is_active: boolean;
};

type StatementBatch = {
  id: string;
  bank_account_id: string;
  period_start: string;
  period_end: string;
  status: 'open' | 'closed' | string;
  created_at: string;
};

type StatementLine = {
  id: string;
  batch_id: string;
  txn_date: string;
  amount: number;
  currency: string;
  description?: string | null;
  reference?: string | null;
  external_id?: string | null;
  matched: boolean;
};

export default function BankReconciliationScreen() {
  const { showNotification } = useToast();
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [batches, setBatches] = useState<StatementBatch[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string>('');
  const [searchAmount, setSearchAmount] = useState<number>(0);
  const [searchDateStart, setSearchDateStart] = useState<string>('');
  const [searchDateEnd, setSearchDateEnd] = useState<string>('');
  const [paymentCandidates, setPaymentCandidates] = useState<any[]>([]);
  const [importText, setImportText] = useState('');
  const [periodStart, setPeriodStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [newAccount, setNewAccount] = useState({ name: '', bank_name: '', account_number: '', currency: 'YER' });

  const supabase = getSupabaseClient();

  const loadAccounts = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('bank_accounts').select('id,name,bank_name,account_number,currency,coa_account_id,is_active').order('created_at', { ascending: true });
    if (error) throw error;
    setAccounts((Array.isArray(data) ? data : []).map((r: any) => ({
      id: String(r.id),
      name: String(r.name || ''),
      bank_name: r.bank_name ? String(r.bank_name) : null,
      account_number: r.account_number ? String(r.account_number) : null,
      currency: String(r.currency || 'YER'),
      coa_account_id: r.coa_account_id ? String(r.coa_account_id) : null,
      is_active: Boolean(r.is_active),
    })));
  }, [supabase]);

  const loadBatches = useCallback(async (accountId?: string) => {
    if (!supabase) return;
    const acc = String(accountId || selectedAccountId || '').trim();
    if (!acc) {
      setBatches([]);
      return;
    }
    const { data, error } = await supabase.from('bank_statement_batches').select('id,bank_account_id,period_start,period_end,status,created_at').eq('bank_account_id', acc).order('created_at', { ascending: false });
    if (error) throw error;
    setBatches((Array.isArray(data) ? data : []).map((r: any) => ({
      id: String(r.id),
      bank_account_id: String(r.bank_account_id),
      period_start: String(r.period_start || ''),
      period_end: String(r.period_end || ''),
      status: String(r.status || 'open'),
      created_at: String(r.created_at || ''),
    })));
  }, [supabase, selectedAccountId]);

  const loadLines = useCallback(async (batchId?: string) => {
    if (!supabase) return;
    const b = String(batchId || selectedBatchId || '').trim();
    if (!b) {
      setLines([]);
      return;
    }
    const { data, error } = await supabase.from('bank_statement_lines').select('id,batch_id,txn_date,amount,currency,description,reference,external_id,matched').eq('batch_id', b).order('txn_date', { ascending: true });
    if (error) throw error;
    setLines((Array.isArray(data) ? data : []).map((r: any) => ({
      id: String(r.id),
      batch_id: String(r.batch_id),
      txn_date: String(r.txn_date || ''),
      amount: Number(r.amount || 0),
      currency: String(r.currency || 'YER'),
      description: r.description ? String(r.description) : null,
      reference: r.reference ? String(r.reference) : null,
      external_id: r.external_id ? String(r.external_id) : null,
      matched: Boolean(r.matched),
    })));
    setSelectedLineId('');
    setPaymentCandidates([]);
  }, [supabase, selectedBatchId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadAccounts();
      } catch (e: any) {
        showNotification(String(e?.message || 'تعذر تحميل الحسابات البنكية'), 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAccounts, showNotification]);

  const createAccount = async () => {
    try {
      if (!supabase) return;
      if (!newAccount.name.trim()) {
        showNotification('اسم الحساب البنكي مطلوب', 'error');
        return;
      }
      const { error } = await supabase.from('bank_accounts').insert({
        name: newAccount.name.trim(),
        bank_name: newAccount.bank_name.trim() || null,
        account_number: newAccount.account_number.trim() || null,
        currency: newAccount.currency.trim() || 'YER',
      });
      if (error) throw error;
      showNotification('تم إنشاء الحساب البنكي.', 'success');
      setNewAccount({ name: '', bank_name: '', account_number: '', currency: 'YER' });
      await loadAccounts();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر إنشاء الحساب البنكي'), 'error');
    }
  };

  const selectAccount = async (accountId: string) => {
    setSelectedAccountId(accountId);
    setSelectedBatchId('');
    setLines([]);
    await loadBatches(accountId);
  };

  const createBatch = async () => {
    try {
      if (!supabase) return;
      const acc = String(selectedAccountId || '').trim();
      if (!acc) {
        showNotification('حدد حسابًا بنكيًا أولاً', 'error');
        return;
      }
      const { data, error } = await supabase.rpc('import_bank_statement', {
        p_bank_account_id: acc,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_lines: '[]',
      });
      if (error) throw error;
      const id = String(data || '');
      showNotification('تم إنشاء كشف بنكي (دفعة).', 'success');
      await loadBatches(selectedAccountId);
      setSelectedBatchId(id);
      await loadLines(id);
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر إنشاء الدفعة'), 'error');
    }
  };

  const importLines = async () => {
    try {
      if (!supabase) return;
      const acc = String(selectedAccountId || '').trim();
      const b = String(selectedBatchId || '').trim();
      if (!acc || !b) {
        showNotification('حدد حسابًا ودفعة أولاً', 'error');
        return;
      }
      let parsed: any[] = [];
      try {
        const j = JSON.parse(importText || '[]');
        parsed = Array.isArray(j) ? j : [];
      } catch {
        showNotification('صيغة JSON غير صالحة', 'error');
        return;
      }
      const { error } = await supabase.rpc('import_bank_statement', {
        p_bank_account_id: acc,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_lines: JSON.stringify(parsed),
      });
      if (error) throw error;
      showNotification(`تم استيراد ${parsed.length} سطر.`, 'success');
      await loadLines(b);
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر استيراد السطور'), 'error');
    }
  };

  const reconcile = async () => {
    try {
      if (!supabase) return;
      const b = String(selectedBatchId || '').trim();
      if (!b) {
        showNotification('حدد دفعة كشف بنكي أولاً', 'error');
        return;
      }
      const { error } = await supabase.rpc('reconcile_bank_batch', {
        p_batch_id: b,
      });
      if (error) throw error;
      showNotification('تمت المطابقة التلقائية.', 'success');
      await loadLines(b);
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر تنفيذ المطابقة'), 'error');
    }
  };

  const closeBatch = async () => {
    try {
      if (!supabase) return;
      const b = String(selectedBatchId || '').trim();
      if (!b) {
        showNotification('حدد دفعة أولاً', 'error');
        return;
      }
      const { error } = await supabase.rpc('close_bank_statement_batch', { p_batch_id: b });
      if (error) throw error;
      showNotification('تم إغلاق الدفعة.', 'success');
      await loadBatches(selectedAccountId);
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر إغلاق الدفعة'), 'error');
    }
  };

  const matchedCount = useMemo(() => lines.filter(l => l.matched).length, [lines]);

  const pickLine = (id: string) => {
    setSelectedLineId(id);
    setPaymentCandidates([]);
  };

  const searchPayments = async () => {
    try {
      if (!supabase) return;
      const amt = Number(searchAmount || 0);
      if (!Number.isFinite(amt) || amt <= 0) {
        showNotification('أدخل مبلغًا صحيحًا للبحث', 'error');
        return;
      }
      const start = String(searchDateStart || '').trim();
      const end = String(searchDateEnd || '').trim();
      const q = supabase.from('payments')
        .select('id,occurred_at,amount,base_amount,method,reference_table,reference_id,direction')
        .neq('method', 'cash')
        .order('occurred_at', { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []).filter((p: any) => {
        const val = Number(p?.base_amount || p?.amount || 0);
        const okAmt = Math.abs(val - amt) <= 0.01;
        const d = String(p?.occurred_at || '');
        const okDate = (!start || d >= start) && (!end || d <= end);
        return okAmt && okDate;
      });
      setPaymentCandidates(rows);
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر البحث'), 'error');
      setPaymentCandidates([]);
    }
  };

  const matchPayment = async (paymentId: string) => {
    try {
      if (!supabase) return;
      const lineId = String(selectedLineId || '').trim();
      if (!lineId) {
        showNotification('اختر سطر كشف أولاً', 'error');
        return;
      }
      const { error } = await supabase.from('bank_reconciliation_matches').insert({
        statement_line_id: lineId,
        payment_id: paymentId,
        status: 'matched',
      });
      if (error) throw error;
      const { error: uErr } = await supabase.from('bank_statement_lines').update({ matched: true }).eq('id', lineId);
      if (uErr) throw uErr;
      showNotification('تمت المطابقة اليدوية.', 'success');
      setPaymentCandidates([]);
      await loadLines(selectedBatchId);
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر المطابقة'), 'error');
    }
  };

  if (loading) return <PageLoader />;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold dark:text-white">التسويات البنكية</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
          <div className="font-semibold mb-3 text-gray-700 dark:text-gray-200">الحسابات البنكية</div>
          <div className="space-y-2">
            {accounts.map(acc => (
              <button
                key={acc.id}
                type="button"
                onClick={() => void selectAccount(acc.id)}
                className={`w-full text-right px-3 py-2 rounded border ${selectedAccountId === acc.id ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300' : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'}`}
              >
                <div className="text-sm font-semibold">{acc.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{acc.bank_name || ''} · {acc.account_number || ''} · {acc.currency}</div>
              </button>
            ))}
          </div>
          <div className="mt-4">
            <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">إضافة حساب جديد</div>
            <div className="space-y-2">
              <input value={newAccount.name} onChange={e => setNewAccount({ ...newAccount, name: e.target.value })} placeholder="اسم الحساب" className="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
              <input value={newAccount.bank_name} onChange={e => setNewAccount({ ...newAccount, bank_name: e.target.value })} placeholder="اسم البنك" className="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
              <input value={newAccount.account_number} onChange={e => setNewAccount({ ...newAccount, account_number: e.target.value })} placeholder="رقم الحساب" className="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
              <input value={newAccount.currency} onChange={e => setNewAccount({ ...newAccount, currency: e.target.value })} placeholder="العملة (YER)" className="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
              <button type="button" onClick={() => void createAccount()} className="px-4 py-2 rounded bg-emerald-600 text-white font-semibold">حفظ الحساب</button>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
          <div className="font-semibold mb-3 text-gray-700 dark:text-gray-200">دفعات كشف بنكي</div>
          <div className="flex items-center gap-2 mb-3">
            <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
            <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
            <button type="button" onClick={() => void createBatch()} className="px-4 py-2 rounded bg-blue-600 text-white font-semibold">إنشاء دفعة</button>
          </div>
          <div className="space-y-2">
            {batches.map(b => (
              <button
                key={b.id}
                type="button"
                onClick={() => { setSelectedBatchId(b.id); void loadLines(b.id); }}
                className={`w-full text-right px-3 py-2 rounded border ${selectedBatchId === b.id ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300' : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'}`}
              >
                <div className="text-sm font-semibold">{b.period_start} → {b.period_end}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">الحالة: {b.status}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
          <div className="font-semibold mb-3 text-gray-700 dark:text-gray-200">استيراد ومطابقة</div>
          <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={8} placeholder='JSON: [{"date":"2026-02-01","amount":1000,"currency":"YER","description":"Deposit","externalId":"A1"}]' className="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600 mb-2" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void importLines()} className="px-4 py-2 rounded bg-indigo-600 text-white font-semibold">استيراد</button>
            <button type="button" onClick={() => void reconcile()} className="px-4 py-2 rounded bg-emerald-600 text-white font-semibold">مطابقة تلقائية</button>
            <button type="button" onClick={() => void closeBatch()} className="px-4 py-2 rounded bg-red-600 text-white font-semibold">إغلاق الدفعة</button>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">المطابق: {matchedCount} / {lines.length}</div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
        <div className="font-semibold mb-3 text-gray-700 dark:text-gray-200">سطور كشف بنكي</div>
        <div className="overflow-x-auto">
          <table className="min-w-[880px] w-full text-right">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">التاريخ</th>
                <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">المبلغ</th>
                <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">العملة</th>
                <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">الوصف</th>
                <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">مرجع</th>
                <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">حالة المطابقة</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.id} className={`border-t dark:border-gray-700 ${selectedLineId === l.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`} onClick={() => pickLine(l.id)}>
                  <td className="p-2 text-sm">{l.txn_date}</td>
                  <td className="p-2 text-sm">{l.amount.toLocaleString('ar-EG-u-nu-latn')}</td>
                  <td className="p-2 text-sm">{l.currency}</td>
                  <td className="p-2 text-sm">{l.description || ''}</td>
                  <td className="p-2 text-sm">{l.external_id || ''}</td>
                  <td className="p-2 text-xs">
                    <span className={`px-2 py-1 rounded-full ${l.matched ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'}`}>
                      {l.matched ? 'مطابق' : 'غير مطابق'}
                    </span>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">لا توجد بيانات لهذه الدفعة.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-3 text-sm text-gray-600 dark:text-gray-300">مطابقة يدوية للسطر المحدد</div>
          <input type="number" value={searchAmount} onChange={e => setSearchAmount(Number(e.target.value || 0))} placeholder="المبلغ" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
          <input type="date" value={searchDateStart} onChange={e => setSearchDateStart(e.target.value)} placeholder="من تاريخ" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
          <input type="date" value={searchDateEnd} onChange={e => setSearchDateEnd(e.target.value)} placeholder="إلى تاريخ" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
          <div>
            <button type="button" onClick={() => void searchPayments()} className="px-4 py-2 rounded bg-gray-900 text-white font-semibold">بحث</button>
          </div>
        </div>

        {paymentCandidates.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[720px] w-full text-right">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">التاريخ</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">المبلغ</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">الطريقة</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">المرجع</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {paymentCandidates.map((p) => (
                  <tr key={p.id} className="border-t dark:border-gray-700">
                    <td className="p-2 text-sm">{String(p.occurred_at || '').slice(0, 10)}</td>
                    <td className="p-2 text-sm">{Number(p.base_amount || p.amount || 0).toLocaleString('ar-EG-u-nu-latn')}</td>
                    <td className="p-2 text-sm">{String(p.method || '')}</td>
                    <td className="p-2 text-xs">{`${p.reference_table || ''}:${p.reference_id || ''}`}</td>
                    <td className="p-2 text-sm">
                      <button type="button" onClick={() => void matchPayment(String(p.id))} className="px-3 py-1 rounded bg-emerald-600 text-white text-xs font-semibold">مطابقة</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
