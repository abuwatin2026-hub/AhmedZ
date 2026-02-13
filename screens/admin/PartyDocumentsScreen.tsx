import React, { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import * as Icons from '../../components/icons';
import { useAuth } from '../../contexts/AuthContext';

type PartyRow = { id: string; name: string };

type DocRow = {
  id: string;
  doc_type: string;
  doc_number: string;
  occurred_at: string;
  memo: string | null;
  party_id: string;
  status: string;
  journal_entry_id: string | null;
};

type DocType = 'ar_invoice' | 'ap_bill' | 'ar_receipt' | 'ap_payment' | 'advance' | 'custodian';

const docTypeLabel: Record<DocType, string> = {
  ar_invoice: 'فاتورة عميل (AR)',
  ap_bill: 'فاتورة مورد (AP)',
  ar_receipt: 'سند قبض (AR)',
  ap_payment: 'سند صرف (AP)',
  advance: 'دفعة مقدمة',
  custodian: 'عهدة',
};

const defaultAccounts: Record<DocType, { partyAccount: string; counterAccount: string; cashAccount?: string }> = {
  ar_invoice: { partyAccount: '1200', counterAccount: '4010' },
  ap_bill: { partyAccount: '2010', counterAccount: '6100' },
  ar_receipt: { partyAccount: '1200', counterAccount: '1010', cashAccount: '1010' },
  ap_payment: { partyAccount: '2010', counterAccount: '1010', cashAccount: '1010' },
  advance: { partyAccount: '1210', counterAccount: '1010', cashAccount: '1010' },
  custodian: { partyAccount: '1035', counterAccount: '1010', cashAccount: '1010' },
};

export default function PartyDocumentsScreen() {
  const { user } = useAuth();
  const canManage = user?.role === 'owner' || user?.role === 'manager';
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [partyMap, setPartyMap] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'posted' | 'voided'>('all');

  const [parties, setParties] = useState<PartyRow[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [docType, setDocType] = useState<DocType>('ar_invoice');
  const [partyId, setPartyId] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [memo, setMemo] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [partyAccountCode, setPartyAccountCode] = useState(defaultAccounts.ar_invoice.partyAccount);
  const [counterAccountCode, setCounterAccountCode] = useState(defaultAccounts.ar_invoice.counterAccount);
  const [currencyCode, setCurrencyCode] = useState('');
  const [fxRate, setFxRate] = useState<string>('');
  const [foreignAmount, setForeignAmount] = useState<string>('');

  const load = async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('supabase not available');

      const { data, error } = await supabase
        .from('party_documents')
        .select('id,doc_type,doc_number,occurred_at,memo,party_id,status,journal_entry_id')
        .order('occurred_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []) as any as DocRow[];
      setDocs(rows);

      const ids = Array.from(new Set(rows.map((r) => String(r.party_id || '')).filter(Boolean)));
      if (ids.length > 0) {
        const { data: pData } = await supabase.from('financial_parties').select('id,name').in('id', ids);
        const map: Record<string, string> = {};
        (Array.isArray(pData) ? pData : []).forEach((r: any) => {
          map[String(r.id)] = String(r.name || '—');
        });
        setPartyMap(map);
      } else {
        setPartyMap({});
      }
    } finally {
      setLoading(false);
    }
  };

  const loadParties = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data } = await supabase.from('financial_parties').select('id,name').eq('is_active', true).order('created_at', { ascending: false }).limit(500);
    const rows = (Array.isArray(data) ? data : []).map((r: any) => ({ id: String(r.id), name: String(r.name || '—') }));
    setParties(rows);
    if (!partyId && rows.length > 0) setPartyId(rows[0].id);
  };

  useEffect(() => {
    void load();
    void loadParties();
  }, []);

  useEffect(() => {
    setPartyAccountCode(defaultAccounts[docType].partyAccount);
    setCounterAccountCode(defaultAccounts[docType].counterAccount);
  }, [docType]);

  const filtered = useMemo(() => {
    const needle = String(q || '').trim().toLowerCase();
    return docs.filter((d) => {
      if (statusFilter !== 'all' && String(d.status || '') !== statusFilter) return false;
      if (!needle) return true;
      const hay = [
        d.doc_number,
        d.doc_type,
        d.status,
        d.memo || '',
        partyMap[d.party_id] || '',
        d.party_id,
        d.journal_entry_id || '',
      ].join(' | ').toLowerCase();
      return hay.includes(needle);
    });
  }, [docs, q, statusFilter, partyMap]);

  const openCreate = () => {
    setDocType('ar_invoice');
    setMemo('');
    setAmount(0);
    setCurrencyCode('');
    setFxRate('');
    setForeignAmount('');
    setOccurredAt(new Date().toISOString().slice(0, 16));
    setIsModalOpen(true);
  };

  const buildLines = () => {
    const amt = Number(amount || 0);
    if (!(amt > 0)) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
    const cur = String(currencyCode || '').trim().toUpperCase();
    const fx = String(fxRate || '').trim();
    const fa = String(foreignAmount || '').trim();

    const partyLine: any = {
      accountCode: partyAccountCode,
      debit: 0,
      credit: 0,
      memo: memo ? `Party: ${memo}` : null,
      partyId,
    };
    const counterLine: any = {
      accountCode: counterAccountCode,
      debit: 0,
      credit: 0,
      memo: memo ? `Counter: ${memo}` : null,
    };

    if (docType === 'ar_invoice') {
      partyLine.debit = amt;
      counterLine.credit = amt;
    } else if (docType === 'ap_bill') {
      counterLine.debit = amt;
      partyLine.credit = amt;
    } else if (docType === 'ar_receipt') {
      counterLine.debit = amt;
      partyLine.credit = amt;
    } else if (docType === 'ap_payment') {
      partyLine.debit = amt;
      counterLine.credit = amt;
    } else if (docType === 'advance') {
      partyLine.debit = amt;
      counterLine.credit = amt;
    } else if (docType === 'custodian') {
      partyLine.debit = amt;
      counterLine.credit = amt;
    }

    if (cur) {
      partyLine.currencyCode = cur;
      if (fx) partyLine.fxRate = Number(fx);
      if (fa) partyLine.foreignAmount = Number(fa);
    }

    return [partyLine, counterLine];
  };

  const createDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      alert('ليس لديك صلاحية لإنشاء المستندات.');
      return;
    }
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const lines = buildLines();
      const occurred = new Date(occurredAt).toISOString();
      const { data, error } = await supabase.rpc('create_party_document', {
        p_doc_type: docType,
        p_occurred_at: occurred,
        p_party_id: partyId,
        p_memo: memo || null,
        p_lines: lines as any,
      } as any);
      if (error) throw error;
      if (!data) throw new Error('تعذر إنشاء المستند');
      setIsModalOpen(false);
      await load();
    } catch (err: any) {
      alert(String(err?.message || 'فشل إنشاء المستند'));
    }
  };

  const approveDoc = async (id: string) => {
    if (!window.confirm('هل تريد اعتماد هذا المستند؟')) return;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase.rpc('approve_party_document', { p_document_id: id } as any);
      if (error) throw error;
      await load();
    } catch (err: any) {
      alert(String(err?.message || 'فشل الاعتماد'));
    }
  };

  const voidDoc = async (id: string) => {
    const reason = window.prompt('سبب الإلغاء/الإبطال؟');
    if (!reason) return;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase.rpc('void_party_document', { p_document_id: id, p_reason: reason } as any);
      if (error) throw error;
      await load();
    } catch (err: any) {
      alert(String(err?.message || 'فشل الإبطال'));
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">جاري التحميل...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-l from-primary-600 to-gold-500">
          مستندات الأطراف
        </h1>
        {canManage && (
          <button
            onClick={openCreate}
            className="bg-primary-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-primary-600 shadow-lg transition-transform transform hover:-translate-y-1"
          >
            <Icons.PlusIcon className="w-5 h-5" />
            <span>مستند جديد</span>
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-4 mb-4 flex flex-col md:flex-row gap-2 items-stretch md:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="بحث: رقم/نوع/طرف/حالة..."
          className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
        >
          <option value="all">كل الحالات</option>
          <option value="draft">مسودة</option>
          <option value="posted">معتمد</option>
          <option value="voided">مبطل</option>
        </select>
        <button
          onClick={() => void load()}
          className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700"
        >
          <Icons.ReportIcon className="w-5 h-5" />
          <span>تحديث</span>
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right min-w-[1100px]">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">التاريخ</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">النوع</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">رقم</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الطرف</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الحالة</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">القيد</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500 dark:text-gray-400">
                    لا توجد بيانات.
                  </td>
                </tr>
              ) : (
                filtered.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="p-4 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">
                      {new Date(d.occurred_at).toLocaleString('ar-SA-u-nu-latn')}
                    </td>
                    <td className="p-4 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">
                      {docTypeLabel[d.doc_type as DocType] || d.doc_type}
                    </td>
                    <td className="p-4 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">
                      {d.doc_number}
                    </td>
                    <td className="p-4 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700">
                      <div className="font-medium">{partyMap[d.party_id] || '—'}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">{d.party_id}</div>
                    </td>
                    <td className="p-4 border-r dark:border-gray-700">
                      <span className={`px-2 py-1 rounded-full text-xs ${d.status === 'posted' ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-200' : d.status === 'draft' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}>
                        {d.status === 'posted' ? 'معتمد' : d.status === 'draft' ? 'مسودة' : 'مبطل'}
                      </span>
                    </td>
                    <td className="p-4 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700 font-mono" dir="ltr">
                      {d.journal_entry_id ? String(d.journal_entry_id).slice(-8) : '—'}
                    </td>
                    <td className="p-4 flex gap-2">
                      {d.status === 'draft' && (
                        <button
                          onClick={() => void approveDoc(d.id)}
                          className="p-2 text-green-700 bg-green-50 dark:bg-green-900/20 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
                          title="اعتماد"
                        >
                          <Icons.CheckIcon className="w-4 h-4" />
                        </button>
                      )}
                      {d.status !== 'voided' && (
                        <button
                          onClick={() => void voidDoc(d.id)}
                          className="p-2 text-red-700 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                          title="إبطال"
                        >
                          <Icons.TrashIcon className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl border border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-center p-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold dark:text-white">مستند طرف جديد</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-300">
                <Icons.XIcon className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={createDoc} className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">النوع</label>
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value as DocType)}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
                  >
                    {Object.entries(docTypeLabel).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">التاريخ</label>
                  <input
                    type="datetime-local"
                    value={occurredAt}
                    onChange={(e) => setOccurredAt(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">الطرف</label>
                <select
                  value={partyId}
                  onChange={(e) => setPartyId(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
                >
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.id.slice(-6)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">المبلغ (عملة الأساس)</label>
                  <input
                    type="number"
                    value={String(amount)}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">حساب الطرف</label>
                  <input
                    value={partyAccountCode}
                    onChange={(e) => setPartyAccountCode(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">الحساب المقابل</label>
                  <input
                    value={counterAccountCode}
                    onChange={(e) => setCounterAccountCode(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">العملة (اختياري)</label>
                  <input
                    value={currencyCode}
                    onChange={(e) => setCurrencyCode(e.target.value)}
                    placeholder="USD"
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">FX Rate (اختياري)</label>
                  <input
                    value={fxRate}
                    onChange={(e) => setFxRate(e.target.value)}
                    placeholder="250"
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">المبلغ الأجنبي (اختياري)</label>
                  <input
                    value={foreignAmount}
                    onChange={(e) => setForeignAmount(e.target.value)}
                    placeholder="100"
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">مذكرة</label>
                <input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                  إلغاء
                </button>
                <button type="submit" className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700">
                  إنشاء مسودة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
