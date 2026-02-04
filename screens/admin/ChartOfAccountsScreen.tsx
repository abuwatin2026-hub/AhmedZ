import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { getSupabaseClient } from '../../supabase';
import { localizeSupabaseError } from '../../utils/errorUtils';

type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
type NormalBalance = 'debit' | 'credit';

type CoaRow = {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  normal_balance: NormalBalance;
  is_active: boolean;
  created_at?: string;
};

const accountTypeLabels: Record<AccountType, string> = {
  asset: 'أصل',
  liability: 'خصوم',
  equity: 'حقوق ملكية',
  income: 'إيراد',
  expense: 'مصروف',
};

const normalBalanceLabels: Record<NormalBalance, string> = {
  debit: 'مدين',
  credit: 'دائن',
};

const ChartOfAccountsScreen: React.FC = () => {
  const { user } = useAuth();
  const { showNotification } = useToast();

  const isOwner = user?.role === 'owner';

  const [rows, setRows] = useState<CoaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | AccountType>('all');
  const [showInactive, setShowInactive] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<CoaRow | null>(null);
  const [form, setForm] = useState({
    code: '',
    name: '',
    account_type: 'expense' as AccountType,
    normal_balance: 'debit' as NormalBalance,
  });

  const loadRows = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_chart_of_accounts', { p_include_inactive: true });
      if (error) throw error;
      const list = (Array.isArray(data) ? data : []).map((r: any) => ({
        id: String(r.id),
        code: String(r.code),
        name: String(r.name),
        account_type: String(r.account_type) as AccountType,
        normal_balance: String(r.normal_balance) as NormalBalance,
        is_active: Boolean(r.is_active),
        created_at: typeof r.created_at === 'string' ? r.created_at : undefined,
      })) as CoaRow[];
      setRows(list);
    } catch (e: any) {
      setRows([]);
      showNotification(localizeSupabaseError(e), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showInactive && !r.is_active) return false;
      if (typeFilter !== 'all' && r.account_type !== typeFilter) return false;
      if (!q) return true;
      return r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
    });
  }, [rows, search, showInactive, typeFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm({ code: '', name: '', account_type: 'expense', normal_balance: 'debit' });
    setIsModalOpen(true);
  };

  const openEdit = (row: CoaRow) => {
    setEditing(row);
    setForm({
      code: row.code,
      name: row.name,
      account_type: row.account_type,
      normal_balance: row.normal_balance,
    });
    setIsModalOpen(true);
  };

  const save = async () => {
    if (!isOwner) {
      showNotification('هذه العملية متاحة للمالك فقط.', 'error');
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      if (!form.code.trim() || !form.name.trim()) {
        showNotification('رقم الحساب واسم الحساب مطلوبان.', 'error');
        return;
      }
      if (editing) {
        const { error } = await supabase.rpc('update_chart_account', {
          p_account_id: editing.id,
          p_code: form.code.trim(),
          p_name: form.name.trim(),
          p_account_type: form.account_type,
          p_normal_balance: form.normal_balance,
        });
        if (error) throw error;
        showNotification('تم تحديث الحساب.', 'success');
      } else {
        const { error } = await supabase.rpc('create_chart_account', {
          p_code: form.code.trim(),
          p_name: form.name.trim(),
          p_account_type: form.account_type,
          p_normal_balance: form.normal_balance,
        });
        if (error) throw error;
        showNotification('تم إضافة الحساب.', 'success');
      }
      setIsModalOpen(false);
      setEditing(null);
      await loadRows();
    } catch (e: any) {
      showNotification(localizeSupabaseError(e), 'error');
    }
  };

  const toggleActive = async (row: CoaRow, nextActive: boolean) => {
    if (!isOwner) {
      showNotification('هذه العملية متاحة للمالك فقط.', 'error');
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      const { error } = await supabase.rpc('set_chart_account_active', {
        p_account_id: row.id,
        p_is_active: nextActive,
      });
      if (error) throw error;
      await loadRows();
      showNotification(nextActive ? 'تم تفعيل الحساب.' : 'تم تعطيل الحساب.', 'success');
    } catch (e: any) {
      showNotification(localizeSupabaseError(e), 'error');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">دليل الحسابات</h1>
          <p className="text-gray-600 dark:text-gray-400">إضافة وتعديل وتعطيل الحسابات المحاسبية</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openCreate}
            disabled={!isOwner}
            className="px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold hover:bg-primary-600 disabled:opacity-60"
          >
            إضافة حساب
          </button>
        </div>
      </div>

      {!isOwner && (
        <div className="mb-4 p-3 rounded-lg bg-yellow-50 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200">
          العرض متاح، لكن التعديل/الإضافة/التعطيل محصور بالمالك فقط.
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">بحث</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="رقم الحساب أو الاسم..."
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">نوع الحساب</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">الكل</option>
              {Object.keys(accountTypeLabels).map((k) => (
                <option key={k} value={k}>{accountTypeLabels[k as AccountType]}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              عرض الحسابات المعطلة
            </label>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الكود</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الاسم</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">النوع</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الرصيد الطبيعي</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الحالة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-6 text-center text-gray-500 dark:text-gray-400">جاري التحميل...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-6 text-center text-gray-500 dark:text-gray-400">لا توجد حسابات مطابقة</td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white">{r.code}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{r.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{accountTypeLabels[r.account_type]}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{normalBalanceLabels[r.normal_balance]}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${r.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300'}`}>
                        {r.is_active ? 'نشط' : 'معطل'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(r)}
                          className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
                          disabled={!isOwner}
                        >
                          تعديل
                        </button>
                        <button
                          onClick={() => toggleActive(r, !r.is_active)}
                          className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-900 text-white disabled:opacity-60"
                          disabled={!isOwner}
                        >
                          {r.is_active ? 'تعطيل' : 'تفعيل'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editing ? 'تعديل حساب' : 'إضافة حساب'}</h2>
              <button
                onClick={() => { setIsModalOpen(false); setEditing(null); }}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رقم الحساب</label>
                <input
                  value={form.code}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                  className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="مثال: 6101"
                  disabled={!isOwner}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اسم الحساب</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="مثال: إيجار"
                  disabled={!isOwner}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">النوع</label>
                  <select
                    value={form.account_type}
                    onChange={(e) => setForm((p) => ({ ...p, account_type: e.target.value as AccountType }))}
                    className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    disabled={!isOwner}
                  >
                    {Object.keys(accountTypeLabels).map((k) => (
                      <option key={k} value={k}>{accountTypeLabels[k as AccountType]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الرصيد الطبيعي</label>
                  <select
                    value={form.normal_balance}
                    onChange={(e) => setForm((p) => ({ ...p, normal_balance: e.target.value as NormalBalance }))}
                    className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    disabled={!isOwner}
                  >
                    {Object.keys(normalBalanceLabels).map((k) => (
                      <option key={k} value={k}>{normalBalanceLabels[k as NormalBalance]}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => { setIsModalOpen(false); setEditing(null); }}
                className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                إلغاء
              </button>
              <button
                onClick={save}
                disabled={!isOwner}
                className="px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold hover:bg-primary-600 disabled:opacity-60"
              >
                حفظ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChartOfAccountsScreen;
