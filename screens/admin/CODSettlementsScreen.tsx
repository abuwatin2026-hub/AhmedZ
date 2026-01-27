import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useCashShift } from '../../contexts/CashShiftContext';
import { getSupabaseClient } from '../../supabase';
import Spinner from '../../components/Spinner';
import ConfirmationModal from '../../components/admin/ConfirmationModal';

type UnsettledRow = {
  order_id: string;
  driver_id: string | null;
  amount: number | null;
  paid_amount: number | null;
  remaining_amount: number | null;
  delivered_at: string | null;
  created_at: string;
};

const CODSettlementsScreen: React.FC = () => {
  const { hasPermission, listAdminUsers } = useAuth();
  const { currentShift } = useCashShift();
  const { showNotification } = useToast();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<UnsettledRow[]>([]);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [settlingDriverId, setSettlingDriverId] = useState<string | null>(null);
  const [confirmBatch, setConfirmBatch] = useState<null | { driverId: string; orderIds: string[]; total: number; name: string }>(null);

  const canSettle = hasPermission('accounting.manage');

  const driverNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of adminUsers) {
      if (u?.id) {
        map.set(String(u.id), String(u.fullName || u.username || u.email || u.id));
      }
    }
    return map;
  }, [adminUsers]);

  const refresh = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    try {
      const [users, unsettled] = await Promise.all([
        listAdminUsers(),
        supabase
          .from('v_cod_unsettled_orders')
          .select('order_id,driver_id,amount,paid_amount,remaining_amount,delivered_at,created_at')
          .order('delivered_at', { ascending: true })
          .limit(2000),
      ]);
      if (Array.isArray(users)) setAdminUsers(users as any[]);
      if (unsettled.error) throw unsettled.error;
      setRows((unsettled.data as any[]) || []);
    } catch (err: any) {
      showNotification('تعذر تحميل طلبات COD غير المسوّاة', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const groups = useMemo(() => {
    const byDriver: Record<string, { driverId: string; orderIds: string[]; total: number; oldestAt: string | null }> = {};
    const missing: { orderIds: string[]; total: number } = { orderIds: [], total: 0 };

    for (const r of rows) {
      const amount = Number(r.remaining_amount ?? r.amount) || 0;
      const driverId = r.driver_id ? String(r.driver_id) : '';
      if (!driverId) {
        missing.orderIds.push(r.order_id);
        missing.total += amount;
        continue;
      }
      if (!byDriver[driverId]) {
        byDriver[driverId] = { driverId, orderIds: [], total: 0, oldestAt: r.delivered_at || r.created_at || null };
      }
      byDriver[driverId].orderIds.push(r.order_id);
      byDriver[driverId].total += amount;
      const candidate = r.delivered_at || r.created_at || null;
      if (candidate && byDriver[driverId].oldestAt && new Date(candidate) < new Date(byDriver[driverId].oldestAt as any)) {
        byDriver[driverId].oldestAt = candidate;
      } else if (candidate && !byDriver[driverId].oldestAt) {
        byDriver[driverId].oldestAt = candidate;
      }
    }

    const list = Object.values(byDriver).sort((a, b) => (b.total || 0) - (a.total || 0));
    return { list, missing };
  }, [rows]);

  const performSettleDriver = async (driverId: string, orderIds: string[]) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!currentShift?.id) {
      showNotification('يجب فتح وردية نقدية قبل التسوية', 'error');
      return;
    }
    if (!canSettle) {
      showNotification('ليس لديك صلاحية التسوية', 'error');
      return;
    }
    setSettlingDriverId(driverId);
    try {
      const { error } = await supabase.rpc('cod_settle_orders', {
        p_driver_id: driverId,
        p_order_ids: orderIds,
        p_occurred_at: new Date().toISOString(),
      });
      if (error) throw error;
      showNotification('تمت التسوية بنجاح', 'success');
      await refresh();
    } catch (err: any) {
      showNotification('تعذر تنفيذ التسوية', 'error');
    } finally {
      setSettlingDriverId(null);
    }
  };

  const requestSettleDriver = (driverId: string, orderIds: string[], total: number) => {
    const name = driverNameById.get(driverId) || driverId;
    setConfirmBatch({ driverId, orderIds, total, name });
  };

  if (!canSettle) {
    return <div className="p-6">غير مصرح</div>;
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">تسوية COD</h1>
          <div className="text-sm text-gray-500 dark:text-gray-300">
            تظهر الطلبات المسلّمة (COD) غير المسوّاة حتى يتم القبض داخل وردية الكاشير.
          </div>
        </div>
        <button
          onClick={refresh}
          className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-400"
          disabled={loading}
        >
          تحديث
        </button>
      </div>

      {!currentShift?.id && (
        <div className="mb-4 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
          يجب فتح وردية نقدية قبل تنفيذ أي تسوية.
        </div>
      )}

      {loading ? (
        <div className="p-10 flex items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <>
          {groups.missing.orderIds.length > 0 && (
            <div className="mb-6 p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200">
              توجد طلبات COD بدون مندوب محدد: {groups.missing.orderIds.length} (إجمالي: {groups.missing.total.toFixed(2)})
            </div>
          )}

          {groups.list.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-300 p-10">لا توجد طلبات COD غير مسوّاة.</div>
          ) : (
            <div className="space-y-4">
              {groups.list.map(g => {
                const name = driverNameById.get(g.driverId) || g.driverId;
                return (
                  <div key={g.driverId} className="p-4 rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-bold text-gray-900 dark:text-white truncate">{name}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-300">
                          عدد الطلبات: {g.orderIds.length} — الإجمالي: <span className="font-mono">{g.total.toFixed(2)}</span>
                        </div>
                        {g.oldestAt && (
                          <div className="text-xs text-gray-400 mt-1">
                            الأقدم: {new Date(g.oldestAt).toLocaleString('ar-SA-u-nu-latn')}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => requestSettleDriver(g.driverId, g.orderIds, g.total)}
                        disabled={!currentShift?.id || settlingDriverId === g.driverId}
                        className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-400"
                      >
                        {settlingDriverId === g.driverId ? 'جاري التسوية...' : 'تسوية جماعية'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <ConfirmationModal
        isOpen={Boolean(confirmBatch)}
        onClose={() => {
          if (settlingDriverId) return;
          setConfirmBatch(null);
        }}
        onConfirm={() => {
          if (!confirmBatch) return;
          performSettleDriver(confirmBatch.driverId, confirmBatch.orderIds).finally(() => setConfirmBatch(null));
        }}
        title="تأكيد تسوية COD"
        message=""
        cancelText="إلغاء"
        confirmText="تسوية"
        confirmingText="جاري التسوية..."
        isConfirming={Boolean(settlingDriverId)}
        confirmButtonClassName="bg-green-600 hover:bg-green-700 disabled:bg-green-400"
        maxWidthClassName="max-w-lg"
      >
        {confirmBatch && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                <div className="text-gray-500 dark:text-gray-300">المندوب</div>
                <div className="font-semibold text-gray-900 dark:text-white truncate">{confirmBatch.name}</div>
              </div>
              <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                <div className="text-gray-500 dark:text-gray-300">عدد الطلبات</div>
                <div className="font-mono text-gray-900 dark:text-white" dir="ltr">{confirmBatch.orderIds.length}</div>
              </div>
              <div className="p-2 rounded bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                <div className="text-gray-500 dark:text-gray-300">الإجمالي</div>
                <div className="font-mono text-gray-900 dark:text-white" dir="ltr">{confirmBatch.total.toFixed(2)}</div>
              </div>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-300">
              سيتم إنشاء قيود التسوية وتسجيل المدفوعات داخل وردية الكاشير الحالية.
            </div>
          </div>
        )}
      </ConfirmationModal>
    </div>
  );
};

export default CODSettlementsScreen;
