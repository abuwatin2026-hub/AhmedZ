import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { getBaseCurrencyCode, getSupabaseClient } from '../../supabase';
import * as Icons from '../../components/icons';

type FinancialPartyRow = {
  id: string;
  name: string;
  party_type: string;
  linked_entity_type: string | null;
  linked_entity_id: string | null;
  currency_preference: string | null;
  is_active: boolean;
  credit_limit_base?: number;
  credit_net_days?: number;
  credit_hold?: boolean;
  created_at: string;
};

type CreditLimitRow = {
  id?: string;
  currency_code: string;
  credit_limit: number;
  credit_hold: boolean;
  net_days: number;
  _delete?: boolean;
};

const FinancialPartiesScreen: React.FC = () => {
  const { hasPermission } = useAuth();
  const { showNotification } = useToast();
  const canManage = Boolean(hasPermission?.('accounting.manage'));
  const canViewAccounting = Boolean(hasPermission?.('accounting.view'));
  const [baseCode, setBaseCode] = useState('—');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FinancialPartyRow[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [currencyOptions, setCurrencyOptions] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<FinancialPartyRow | null>(null);
  const [form, setForm] = useState<Partial<FinancialPartyRow>>({});
  const [backfillBusyId, setBackfillBusyId] = useState<string>('');
  const [creditLimitsRows, setCreditLimitsRows] = useState<CreditLimitRow[]>([]);
  const [creditLimitsLoading, setCreditLimitsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getBaseCurrencyCode().then((c) => {
      if (!c) return;
      setBaseCode(String(c).toUpperCase());
    });
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('supabase not available');
      const { data, error } = await supabase
        .from('financial_parties')
        .select('id,name,party_type,linked_entity_type,linked_entity_id,currency_preference,is_active,credit_limit_base,credit_net_days,credit_hold,created_at')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows((Array.isArray(data) ? data : []) as any);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    let active = true;
    const loadCurrencies = async () => {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { data, error } = await supabase.from('currencies').select('code').order('code', { ascending: true });
        if (error) throw error;
        const codes = (Array.isArray(data) ? data : []).map((r: any) => String(r.code || '').toUpperCase()).filter(Boolean);
        if (active) setCurrencyOptions(codes);
      } catch {
        if (active) setCurrencyOptions([]);
      }
    };
    void loadCurrencies();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeFilter === 'active' && !r.is_active) return false;
      if (activeFilter === 'inactive' && r.is_active) return false;
      if (typeFilter !== 'all' && String(r.party_type || '').toLowerCase() !== String(typeFilter).toLowerCase()) return false;
      if (!q) return true;
      const hay = [
        r.name,
        r.party_type,
        r.linked_entity_type || '',
        r.linked_entity_id || '',
        r.currency_preference || '',
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query, typeFilter, activeFilter]);

  const openModal = (row?: FinancialPartyRow) => {
    if (row) {
      setEditingRow(row);
      setForm(row);
      // Load per-currency credit limits
      (async () => {
        setCreditLimitsLoading(true);
        try {
          const supabase = getSupabaseClient();
          if (!supabase) return;
          const { data, error } = await supabase
            .from('party_credit_limits')
            .select('id,currency_code,credit_limit,credit_hold,net_days')
            .eq('party_id', row.id)
            .order('currency_code', { ascending: true });
          if (error) throw error;
          setCreditLimitsRows((Array.isArray(data) ? data : []).map((r: any) => ({
            id: r.id,
            currency_code: String(r.currency_code || '').toUpperCase(),
            credit_limit: Number(r.credit_limit) || 0,
            credit_hold: Boolean(r.credit_hold),
            net_days: Number(r.net_days) || 30,
          })));
        } catch {
          setCreditLimitsRows([]);
        } finally {
          setCreditLimitsLoading(false);
        }
      })();
    } else {
      setEditingRow(null);
      setForm({ is_active: true, party_type: 'generic', credit_limit_base: 0, credit_net_days: 30, credit_hold: false } as any);
      setCreditLimitsRows([]);
    }
    setIsModalOpen(true);
  };

  const validate = (): string | null => {
    const name = String(form.name || '').trim();
    if (!name) return 'اسم الطرف مطلوب';
    const t = String(form.party_type || '').trim().toLowerCase();
    if (!['customer', 'supplier', 'employee', 'staff_custodian', 'partner', 'generic'].includes(t)) return 'نوع الطرف غير صحيح';
    const cur = String(form.currency_preference || '').trim().toUpperCase();
    if (cur && currencyOptions.length > 0 && !currencyOptions.includes(cur)) return 'العملة المفضلة غير معرفة';
    const limit = Number((form as any).credit_limit_base ?? 0);
    if (!Number.isFinite(limit) || limit < 0) return 'سقف الائتمان غير صحيح';
    const days = Number((form as any).credit_net_days ?? 30);
    if (!Number.isFinite(days) || days < 0 || days > 3650) return 'أيام الأجل غير صحيحة';
    return null;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!canManage) {
      showNotification('ليس لديك صلاحية لإضافة/تعديل الأطراف.', 'error');
      return;
    }
    const v = validate();
    if (v) {
      showNotification(v, 'error');
      return;
    }
    setSaving(true);
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const payload: any = {
      name: String(form.name || '').trim(),
      party_type: String(form.party_type || 'generic').trim(),
      currency_preference: String(form.currency_preference || '').trim().toUpperCase() || null,
      is_active: form.is_active !== false,
      credit_limit_base: Math.max(0, Number((form as any).credit_limit_base) || 0),
      credit_net_days: Math.max(0, Math.floor(Number((form as any).credit_net_days) || 0)) || 30,
      credit_hold: Boolean((form as any).credit_hold),
      default_account_id: null,
    };

    let partyId = editingRow?.id;
    if (editingRow) {
      const { error } = await supabase.from('financial_parties').update(payload).eq('id', editingRow.id);
      if (error) throw error;
    } else {
      const { data: inserted, error } = await supabase.from('financial_parties').insert(payload).select('id').single();
      if (error) throw error;
      partyId = (inserted as any)?.id;
    }

    // Save per-currency credit limits
    if (partyId && creditLimitsRows.length > 0) {
      for (const cl of creditLimitsRows) {
        const code = String(cl.currency_code || '').trim().toUpperCase();
        if (!code) continue;
        if (cl._delete && cl.id) {
          await supabase.from('party_credit_limits').delete().eq('id', cl.id);
          continue;
        }
        if (cl._delete) continue;
        const clPayload = {
          party_id: partyId,
          currency_code: code,
          credit_limit: Math.max(0, Number(cl.credit_limit) || 0),
          credit_hold: Boolean(cl.credit_hold),
          net_days: Math.max(0, Math.floor(Number(cl.net_days) || 30)),
        };
        if (cl.id) {
          await supabase.from('party_credit_limits').update(clPayload).eq('id', cl.id);
        } else {
          await supabase.from('party_credit_limits').upsert(clPayload, { onConflict: 'party_id,currency_code' });
        }
      }
    }

    setIsModalOpen(false);
    setCreditLimitsRows([]);
    await load();
    showNotification('تم حفظ الطرف المالي.', 'success');
    setSaving(false);
  };

  const handleBackfillParty = async (partyId: string) => {
    if (!canViewAccounting) {
      showNotification('ليس لديك صلاحية عرض المحاسبة.', 'error');
      return;
    }
    const ok = window.confirm('سيتم تحديث دفتر الطرف لهذا الطرف اعتمادًا على القيود المرحّلة. المتابعة؟');
    if (!ok) return;
    setBackfillBusyId(partyId);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('supabase not available');
      const { data, error } = canManage
        ? await supabase.rpc('backfill_party_ledger_for_existing_entries', {
          p_batch: 5000,
          p_only_party_id: partyId,
        } as any)
        : await supabase.rpc('backfill_party_ledger_entries_for_party', {
          p_party_id: partyId,
          p_batch: 5000,
        } as any);
      if (error) throw error;
      const count = Number(data) || 0;
      showNotification(`تم تحديث دفتر الطرف (${count} سطر/أسطر).`, 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر تحديث دفتر الطرف'), 'error');
    } finally {
      setBackfillBusyId('');
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">جاري التحميل...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-l from-primary-600 to-gold-500">
          الأطراف المالية
        </h1>
        <div className="flex items-center gap-2">
          <Link
            to="/admin/reports/party-aging"
            className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-lg border border-gray-100 dark:border-gray-700"
          >
            <Icons.ReportIcon className="w-5 h-5" />
            <span>تقرير أعمار الديون</span>
          </Link>
          {canManage && (
            <button
              onClick={() => openModal()}
              className="bg-primary-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-primary-600 shadow-lg transition-transform transform hover:-translate-y-1"
            >
              <Icons.PlusIcon className="w-5 h-5" />
              <span>إضافة طرف</span>
            </button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث بالاسم/النوع/المعرف..."
          className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
        >
          <option value="all">كل الأنواع</option>
          <option value="customer">عميل</option>
          <option value="supplier">مورد</option>
          <option value="employee">موظف</option>
          <option value="staff_custodian">عهدة</option>
          <option value="partner">شريك</option>
          <option value="generic">عام</option>
        </select>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as any)}
          className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
        >
          <option value="active">نشط</option>
          <option value="inactive">غير نشط</option>
          <option value="all">الكل</option>
        </select>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الاسم</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">النوع</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">العملة</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الائتمان</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الربط</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الحالة</th>
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
                filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="p-4 font-medium dark:text-white border-r dark:border-gray-700">{r.name}</td>
                    <td className="p-4 text-gray-600 dark:text-gray-300 border-r dark:border-gray-700 font-mono">{r.party_type}</td>
                    <td className="p-4 text-gray-600 dark:text-gray-300 border-r dark:border-gray-700 font-mono">{r.currency_preference || '-'}</td>
                    <td className="p-4 text-gray-600 dark:text-gray-300 border-r dark:border-gray-700 font-mono">
                      <div className="flex items-center gap-2">
                        <span>{Number(r.credit_limit_base || 0).toFixed(2)} {baseCode}</span>
                        {Boolean(r.credit_hold) && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-200">HOLD</span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-gray-600 dark:text-gray-300 border-r dark:border-gray-700 font-mono">
                      {r.linked_entity_type ? `${r.linked_entity_type}:${r.linked_entity_id}` : '-'}
                    </td>
                    <td className="p-4 border-r dark:border-gray-700">
                      <span className={`px-2 py-1 rounded-full text-xs ${r.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}>
                        {r.is_active ? 'نشط' : 'غير نشط'}
                      </span>
                    </td>
                    <td className="p-4 flex gap-2">
                      <Link
                        to={`/admin/financial-parties/${r.id}`}
                        className="p-2 text-primary-700 bg-primary-50 dark:bg-primary-900/20 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors"
                        title="كشف الحساب"
                      >
                        <Icons.FileText className="w-4 h-4" />
                      </Link>
                      {canManage && (
                        <button
                          onClick={() => void handleBackfillParty(r.id)}
                          className="p-2 text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors disabled:opacity-60"
                          title="تحديث دفتر الطرف"
                          disabled={backfillBusyId === r.id}
                        >
                          {backfillBusyId === r.id ? <Icons.SettingsIcon className="w-4 h-4 animate-spin" /> : <Icons.SettingsIcon className="w-4 h-4" />}
                        </button>
                      )}
                      {canManage && (
                        <button
                          onClick={() => openModal(r)}
                          className="p-2 text-blue-600 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                          title="تعديل"
                        >
                          <Icons.EditIcon className="w-4 h-4" />
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
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg border border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-center p-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold dark:text-white">{editingRow ? 'تعديل طرف' : 'إضافة طرف'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-300">
                <Icons.XIcon className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={save} className="p-4 space-y-3">
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">الاسم</label>
                <input
                  value={String(form.name || '')}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">النوع</label>
                  <select
                    value={String(form.party_type || 'generic')}
                    onChange={(e) => setForm((p) => ({ ...p, party_type: e.target.value }))}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
                  >
                    <option value="customer">عميل</option>
                    <option value="supplier">مورد</option>
                    <option value="employee">موظف</option>
                    <option value="staff_custodian">عهدة</option>
                    <option value="partner">شريك</option>
                    <option value="generic">عام</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">العملة المفضلة</label>
                  <input
                    value={String(form.currency_preference || '')}
                    onChange={(e) => setForm((p) => ({ ...p, currency_preference: e.target.value }))}
                    placeholder="مثل: YER, USD"
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">سقف الائتمان الافتراضي ({baseCode})</label>
                  <input
                    type="number"
                    value={Number((form as any).credit_limit_base ?? 0)}
                    onChange={(e) => setForm((p) => ({ ...p, credit_limit_base: Number(e.target.value) || 0 }))}
                    min={0}
                    step={0.01}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">أيام الأجل الافتراضية</label>
                  <input
                    type="number"
                    value={Number((form as any).credit_net_days ?? 30)}
                    onChange={(e) => setForm((p) => ({ ...p, credit_net_days: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
                    min={0}
                    step={1}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={Boolean((form as any).credit_hold)}
                  onChange={(e) => setForm((p) => ({ ...p, credit_hold: e.target.checked }))}
                />
                <span>إيقاف ائتمان عام (Credit Hold)</span>
              </label>

              {/* Per-Currency Credit Limits */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 mt-2">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">حدود الائتمان حسب العملة</label>
                  <button
                    type="button"
                    onClick={() => setCreditLimitsRows(prev => [...prev, { currency_code: '', credit_limit: 0, credit_hold: false, net_days: 30 }])}
                    className="text-xs px-2 py-1 rounded bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200 hover:bg-primary-100"
                  >
                    + إضافة عملة
                  </button>
                </div>
                {creditLimitsLoading ? (
                  <div className="text-xs text-gray-400 text-center py-2">جاري التحميل...</div>
                ) : creditLimitsRows.filter(cl => !cl._delete).length === 0 ? (
                  <div className="text-xs text-gray-400 text-center py-2">لا توجد حدود ائتمان مخصصة — سيُستخدم الحد الافتراضي ({baseCode})</div>
                ) : (
                  <div className="space-y-2">
                    {creditLimitsRows.map((cl, idx) => cl._delete ? null : (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-3">
                          {idx === 0 && <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">العملة</label>}
                          <select
                            value={cl.currency_code}
                            onChange={(e) => setCreditLimitsRows(prev => prev.map((r, i) => i === idx ? { ...r, currency_code: e.target.value.toUpperCase() } : r))}
                            className="w-full border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
                          >
                            <option value="">اختر</option>
                            {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div className="col-span-3">
                          {idx === 0 && <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">الحد</label>}
                          <input
                            type="number"
                            value={cl.credit_limit}
                            onChange={(e) => setCreditLimitsRows(prev => prev.map((r, i) => i === idx ? { ...r, credit_limit: Number(e.target.value) || 0 } : r))}
                            min={0}
                            step={0.01}
                            className="w-full border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
                          />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">الأيام</label>}
                          <input
                            type="number"
                            value={cl.net_days}
                            onChange={(e) => setCreditLimitsRows(prev => prev.map((r, i) => i === idx ? { ...r, net_days: Math.max(0, Number(e.target.value) || 0) } : r))}
                            min={0}
                            className="w-full border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono"
                          />
                        </div>
                        <div className="col-span-2 flex items-center gap-1">
                          {idx === 0 && <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5 w-full">إيقاف</label>}
                          <input
                            type="checkbox"
                            checked={cl.credit_hold}
                            onChange={(e) => setCreditLimitsRows(prev => prev.map((r, i) => i === idx ? { ...r, credit_hold: e.target.checked } : r))}
                          />
                        </div>
                        <div className="col-span-2 flex justify-end">
                          {idx === 0 && <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5 w-full">&nbsp;</label>}
                          <button
                            type="button"
                            onClick={() => {
                              if (cl.id) {
                                setCreditLimitsRows(prev => prev.map((r, i) => i === idx ? { ...r, _delete: true } : r));
                              } else {
                                setCreditLimitsRows(prev => prev.filter((_, i) => i !== idx));
                              }
                            }}
                            className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                            title="حذف"
                          >
                            <Icons.XIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={form.is_active !== false}
                  onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
                />
                <span>نشط</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                  إلغاء
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed">
                  {saving ? 'جاري الحفظ...' : 'حفظ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialPartiesScreen;
