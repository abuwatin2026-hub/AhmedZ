import React, { useEffect, useMemo, useState } from 'react';
import { getBaseCurrencyCode, getSupabaseClient } from '../../supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { localizeSupabaseError } from '../../utils/errorUtils';
import { usePurchases } from '../../contexts/PurchasesContext';
import Spinner from '../../components/Spinner';
import ConfirmationModal from '../../components/admin/ConfirmationModal';
import * as Icons from '../../components/icons';

type SupplierCreditNoteRow = {
  id: string;
  supplier_id: string;
  reference_purchase_receipt_id: string;
  amount: number | null;
  reason: string | null;
  status: 'draft' | 'applied' | 'cancelled' | string;
  created_at: string;
  updated_at?: string;
  applied_at: string | null;
  journal_entry_id: string | null;
  supplier?: { name?: string | null } | null;
};

type AllocationRow = {
  id: string;
  credit_note_id: string;
  root_batch_id: string;
  affected_batch_id: string | null;
  receipt_id: string;
  amount_total: number | null;
  amount_to_inventory: number | null;
  amount_to_cogs: number | null;
  batch_qty_received: number | null;
  batch_qty_onhand: number | null;
  batch_qty_sold: number | null;
  unit_cost_before: number | null;
  unit_cost_after: number | null;
  created_at: string;
};

type BatchMini = { id: string; batch_code: string | null; expiry_date: string | null; item_id: string | null };

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());

const toMoney = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const SupplierCreditNotesScreen: React.FC = () => {
  const { user } = useAuth();
  const { suppliers } = usePurchases();
  const { showNotification } = useToast();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SupplierCreditNoteRow[]>([]);
  const [baseCode, setBaseCode] = useState('—');

  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'applied' | 'cancelled'>('all');
  const [q, setQ] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formSupplierId, setFormSupplierId] = useState('');
  const [formReceiptId, setFormReceiptId] = useState('');
  const [formAmount, setFormAmount] = useState<string>('');
  const [formReason, setFormReason] = useState('');
  const [receiptLookupBusy, setReceiptLookupBusy] = useState(false);

  const [confirmApplyId, setConfirmApplyId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [allocOpen, setAllocOpen] = useState(false);
  const [allocBusy, setAllocBusy] = useState(false);
  const [allocNote, setAllocNote] = useState<SupplierCreditNoteRow | null>(null);
  const [allocRows, setAllocRows] = useState<AllocationRow[]>([]);
  const [batchById, setBatchById] = useState<Record<string, BatchMini>>({});

  const resetCreate = () => {
    setFormSupplierId('');
    setFormReceiptId('');
    setFormAmount('');
    setFormReason('');
  };

  const fetchRows = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('supplier_credit_notes')
        .select('id,supplier_id,reference_purchase_receipt_id,amount,reason,status,created_at,applied_at,journal_entry_id,updated_at,supplier:suppliers(name)')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows((data as any[]) as SupplierCreditNoteRow[]);
    } catch (err) {
      setRows([]);
      showNotification(localizeSupabaseError(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, []);

  useEffect(() => {
    void getBaseCurrencyCode().then((c) => {
      if (!c) return;
      setBaseCode(c);
    });
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!query) return true;
      const supplierName = String(r.supplier?.name || '').toLowerCase();
      const receipt = String(r.reference_purchase_receipt_id || '').toLowerCase();
      const reason = String(r.reason || '').toLowerCase();
      return supplierName.includes(query) || receipt.includes(query) || reason.includes(query) || String(r.id).toLowerCase().includes(query);
    });
  }, [rows, statusFilter, q]);

  const openCreate = () => {
    resetCreate();
    setCreateOpen(true);
  };

  const tryResolveSupplierFromReceipt = async () => {
    const rid = formReceiptId.trim();
    if (!isUuid(rid)) {
      showNotification('رقم الاستلام غير صحيح.', 'error');
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setReceiptLookupBusy(true);
    try {
      const { data: receipt, error: rErr } = await supabase
        .from('purchase_receipts')
        .select('id,purchase_order_id')
        .eq('id', rid)
        .maybeSingle();
      if (rErr) throw rErr;
      const poId = String((receipt as any)?.purchase_order_id || '');
      if (!poId) throw new Error('لم يتم العثور على أمر الشراء المرتبط بالاستلام.');

      const { data: po, error: poErr } = await supabase
        .from('purchase_orders')
        .select('id,supplier_id')
        .eq('id', poId)
        .maybeSingle();
      if (poErr) throw poErr;
      const supplierId = String((po as any)?.supplier_id || '');
      if (!supplierId) throw new Error('لم يتم العثور على المورد المرتبط بأمر الشراء.');
      setFormSupplierId(supplierId);
      showNotification('تم تحديد المورد تلقائيًا من الاستلام.', 'success');
    } catch (err) {
      showNotification(localizeSupabaseError(err), 'error');
    } finally {
      setReceiptLookupBusy(false);
    }
  };

  const createNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;

    const supplierId = formSupplierId.trim();
    const receiptId = formReceiptId.trim();
    const amount = Number(formAmount);
    if (!isUuid(supplierId)) {
      showNotification('اختر المورد.', 'error');
      return;
    }
    if (!isUuid(receiptId)) {
      showNotification('رقم الاستلام غير صحيح.', 'error');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showNotification('المبلغ غير صحيح.', 'error');
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) return;
    setCreating(true);
    try {
      const payload: any = {
        supplier_id: supplierId,
        reference_purchase_receipt_id: receiptId,
        amount: amount,
        reason: formReason.trim() || null,
        status: 'draft',
        created_by: user?.id || null,
      };
      const { error } = await supabase.from('supplier_credit_notes').insert(payload);
      if (error) throw error;
      setCreateOpen(false);
      resetCreate();
      await fetchRows();
      showNotification('تم إنشاء خصم المورد (Draft).', 'success');
    } catch (err) {
      showNotification(localizeSupabaseError(err), 'error');
    } finally {
      setCreating(false);
    }
  };

  const applyNote = async (id: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setApplying(true);
    try {
      const { error } = await supabase.rpc('apply_supplier_credit_note', { p_credit_note_id: id } as any);
      if (error) throw error;
      setConfirmApplyId(null);
      await fetchRows();
      showNotification('تم اعتماد خصم المورد وترحيله.', 'success');
    } catch (err) {
      showNotification(localizeSupabaseError(err), 'error');
    } finally {
      setApplying(false);
    }
  };

  const cancelNote = async (id: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setCancelling(true);
    try {
      const { error } = await supabase.from('supplier_credit_notes').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
      setConfirmCancelId(null);
      await fetchRows();
      showNotification('تم إلغاء خصم المورد.', 'success');
    } catch (err) {
      showNotification(localizeSupabaseError(err), 'error');
    } finally {
      setCancelling(false);
    }
  };

  const openAllocations = async (note: SupplierCreditNoteRow) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setAllocOpen(true);
    setAllocBusy(true);
    setAllocNote(note);
    setAllocRows([]);
    setBatchById({});
    try {
      const { data, error } = await supabase
        .from('supplier_credit_note_allocations')
        .select('id,credit_note_id,root_batch_id,affected_batch_id,receipt_id,amount_total,amount_to_inventory,amount_to_cogs,batch_qty_received,batch_qty_onhand,batch_qty_sold,unit_cost_before,unit_cost_after,created_at')
        .eq('credit_note_id', note.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const list = ((data || []) as any[]) as AllocationRow[];
      setAllocRows(list);

      const ids = Array.from(new Set(list.flatMap(r => [r.root_batch_id, r.affected_batch_id].filter(Boolean) as string[])));
      if (ids.length > 0) {
        const { data: batches, error: bErr } = await supabase
          .from('batches')
          .select('id,batch_code,expiry_date,item_id')
          .in('id', ids)
          .limit(500);
        if (bErr) throw bErr;
        const map: Record<string, BatchMini> = {};
        (batches || []).forEach((b: any) => {
          const id = String(b?.id || '');
          if (!id) return;
          map[id] = {
            id,
            batch_code: typeof b?.batch_code === 'string' ? b.batch_code : null,
            expiry_date: typeof b?.expiry_date === 'string' ? b.expiry_date : null,
            item_id: typeof b?.item_id === 'string' ? b.item_id : null,
          };
        });
        setBatchById(map);
      }
    } catch (err) {
      showNotification(localizeSupabaseError(err), 'error');
    } finally {
      setAllocBusy(false);
    }
  };

  const badgeClass = (status: string) => {
    if (status === 'applied') return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-200 dark:border-emerald-900';
    if (status === 'cancelled') return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700/40 dark:text-gray-200 dark:border-gray-700';
    return 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-900';
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-l from-primary-600 to-gold-500">خصومات الموردين</h1>
          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">إنشاء خصم مورد وتوزيعه تلقائيًا على المخزون/COGS</div>
        </div>
        <button
          onClick={openCreate}
          className="bg-primary-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-primary-600 shadow-lg transition-transform transform hover:-translate-y-1"
        >
          <Icons.PlusIcon className="w-5 h-5" />
          <span>إضافة خصم</span>
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-300">الحالة:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="all">الكل</option>
              <option value="draft">Draft</option>
              <option value="applied">Applied</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="flex-1" />
          <div className="w-full md:w-96">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث: مورد / استلام / سبب / رقم"
              className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">المورد</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الاستلام</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">المبلغ</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الحالة</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">التاريخ</th>
                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500 dark:text-gray-400">لا توجد سجلات.</td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const supplierName = String(r.supplier?.name || '').trim() || '—';
                  const canApply = r.status === 'draft';
                  const canCancel = r.status === 'draft';
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="p-4 font-medium dark:text-white border-r dark:border-gray-700">
                        <div>{supplierName}</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400" dir="ltr">{r.supplier_id}</div>
                      </td>
                      <td className="p-4 text-gray-700 dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">
                        <div className="font-mono text-xs">{r.reference_purchase_receipt_id}</div>
                      </td>
                      <td className="p-4 text-gray-800 dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{toMoney(r.amount)} {baseCode || '—'}</td>
                      <td className="p-4 border-r dark:border-gray-700">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs border ${badgeClass(String(r.status || 'draft'))}`}>
                          {String(r.status || '').toUpperCase()}
                        </span>
                        {r.applied_at && (
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1" dir="ltr">
                            Applied: {new Date(r.applied_at).toLocaleString('en-US')}
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-300 border-r dark:border-gray-700" dir="ltr">
                        {new Date(r.created_at).toLocaleString('en-US')}
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openAllocations(r)}
                            className="px-3 py-2 rounded-lg text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                            title="عرض التوزيع"
                          >
                            <span className="inline-flex items-center gap-1">
                              <Icons.ListIcon className="w-4 h-4" />
                              توزيع
                            </span>
                          </button>
                          <button
                            disabled={!canApply}
                            onClick={() => setConfirmApplyId(r.id)}
                            className={`px-3 py-2 rounded-lg text-xs ${canApply ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed'}`}
                            title="اعتماد وترحيل"
                          >
                            <span className="inline-flex items-center gap-1">
                              <Icons.CheckIcon className="w-4 h-4" />
                              اعتماد
                            </span>
                          </button>
                          <button
                            disabled={!canCancel}
                            onClick={() => setConfirmCancelId(r.id)}
                            className={`px-3 py-2 rounded-lg text-xs ${canCancel ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed'}`}
                            title="إلغاء"
                          >
                            <span className="inline-flex items-center gap-1">
                              <Icons.XIcon className="w-4 h-4" />
                              إلغاء
                            </span>
                          </button>
                        </div>
                        {r.reason && (
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
                            سبب: {r.reason}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 flex justify-between items-center">
              <h2 className="text-xl font-bold dark:text-white">إضافة خصم مورد</h2>
              <button
                onClick={() => setCreateOpen(false)}
                className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <Icons.XIcon className="w-6 h-6 text-gray-500" />
              </button>
            </div>
            <form onSubmit={createNote} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">المورد <span className="text-red-500">*</span></label>
                <select
                  value={formSupplierId}
                  onChange={(e) => setFormSupplierId(e.target.value)}
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  required
                >
                  <option value="">اختر المورد...</option>
                  {(suppliers || []).map((s: any) => (
                    <option key={String(s.id)} value={String(s.id)}>
                      {String(s.name || '').trim() || String(s.id)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">رقم الاستلام (Purchase Receipt ID) <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <input
                    value={formReceiptId}
                    onChange={(e) => setFormReceiptId(e.target.value)}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono text-sm"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    required
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={tryResolveSupplierFromReceipt}
                    disabled={receiptLookupBusy}
                    className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 disabled:opacity-50"
                  >
                    {receiptLookupBusy ? '...' : 'تحقق'}
                  </button>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">يمكنك لصق رقم الاستلام مباشرة، ثم الضغط على تحقق لتحديد المورد تلقائيًا.</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">المبلغ <span className="text-red-500">*</span></label>
                <input
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="0.00"
                  required
                  dir="ltr"
                  inputMode="decimal"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">السبب</label>
                <textarea
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                >
                  إغلاق
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {creating ? 'جاري الحفظ...' : 'حفظ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={Boolean(confirmApplyId)}
        onClose={() => setConfirmApplyId(null)}
        onConfirm={() => confirmApplyId && applyNote(confirmApplyId)}
        title="تأكيد اعتماد خصم المورد"
        message=""
        isConfirming={applying}
        confirmText="اعتماد"
        confirmingText="جاري الاعتماد..."
        confirmButtonClassName="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400"
        maxWidthClassName="max-w-lg"
      >
        <div className="text-sm text-gray-700 dark:text-gray-200 space-y-2">
          <div>سيتم:</div>
          <ul className="list-disc pr-6 space-y-1 text-gray-600 dark:text-gray-300">
            <li>توزيع الخصم على دفعات الاستلام.</li>
            <li>تخفيض تكلفة المخزون المتبقي (cost_per_unit) تلقائيًا.</li>
            <li>تخفيض COGS للجزء المباع بقيد محاسبي.</li>
          </ul>
          <div className="text-xs text-gray-500 dark:text-gray-400">هذه العملية غير قابلة للتراجع من الواجهة.</div>
        </div>
      </ConfirmationModal>

      <ConfirmationModal
        isOpen={Boolean(confirmCancelId)}
        onClose={() => setConfirmCancelId(null)}
        onConfirm={() => confirmCancelId && cancelNote(confirmCancelId)}
        title="تأكيد إلغاء خصم المورد"
        message="سيتم إلغاء خصم المورد (Draft فقط)."
        isConfirming={cancelling}
        confirmText="إلغاء"
        confirmingText="جاري الإلغاء..."
        confirmButtonClassName="bg-red-600 hover:bg-red-700 disabled:bg-red-400"
      />

      <ConfirmationModal
        isOpen={allocOpen}
        onClose={() => setAllocOpen(false)}
        onConfirm={() => setAllocOpen(false)}
        title="توزيع خصم المورد"
        message=""
        confirmText="إغلاق"
        cancelText="إغلاق"
        hideConfirmButton
        maxWidthClassName="max-w-5xl"
      >
        {allocBusy ? (
          <div className="p-6 flex justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-gray-700 dark:text-gray-200">
              <div className="font-semibold">الخصم: <span className="font-mono" dir="ltr">{allocNote?.id}</span></div>
              <div className="text-xs text-gray-500 dark:text-gray-400">قد تتضمن السطور صفوفًا للدفعة الأصلية وصفوفًا لتعديل دفعات ناتجة عن تحويلات.</div>
            </div>

            <div className="overflow-x-auto border border-gray-100 dark:border-gray-700 rounded-lg">
              <table className="w-full text-right">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الدفعة</th>
                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الكمية</th>
                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">مخزون</th>
                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">COGS</th>
                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">قبل/بعد</th>
                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">وقت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {allocRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-gray-500 dark:text-gray-400">لا توجد تفاصيل توزيع.</td>
                    </tr>
                  ) : (
                    allocRows.map((a) => {
                      const bid = String(a.affected_batch_id || a.root_batch_id);
                      const b = batchById[bid];
                      const code = String(b?.batch_code || '').trim() || bid.slice(-6).toUpperCase();
                      return (
                        <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="p-3 border-r dark:border-gray-700">
                            <div className="font-medium dark:text-white">#{code}</div>
                            {b?.expiry_date && <div className="text-[11px] text-gray-500 dark:text-gray-400" dir="ltr">EXP: {b.expiry_date}</div>}
                            <div className="text-[11px] text-gray-500 dark:text-gray-400" dir="ltr">{bid}</div>
                          </td>
                          <td className="p-3 border-r dark:border-gray-700 text-xs text-gray-700 dark:text-gray-200" dir="ltr">
                            <div>Received: {toMoney(a.batch_qty_received)}</div>
                            <div>Onhand: {toMoney(a.batch_qty_onhand)}</div>
                            <div>Sold: {toMoney(a.batch_qty_sold)}</div>
                          </td>
                          <td className="p-3 border-r dark:border-gray-700 text-xs text-gray-700 dark:text-gray-200" dir="ltr">{toMoney(a.amount_to_inventory)} {baseCode || '—'}</td>
                          <td className="p-3 border-r dark:border-gray-700 text-xs text-gray-700 dark:text-gray-200" dir="ltr">{toMoney(a.amount_to_cogs)} {baseCode || '—'}</td>
                          <td className="p-3 border-r dark:border-gray-700 text-xs text-gray-700 dark:text-gray-200" dir="ltr">
                            <div>{toMoney(a.unit_cost_before)} {baseCode || '—'} → {toMoney(a.unit_cost_after)} {baseCode || '—'}</div>
                          </td>
                          <td className="p-3 text-xs text-gray-600 dark:text-gray-300" dir="ltr">{new Date(a.created_at).toLocaleString('en-US')}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </ConfirmationModal>
    </div>
  );
};

export default SupplierCreditNotesScreen;
