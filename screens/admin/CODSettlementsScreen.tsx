import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useCashShift } from '../../contexts/CashShiftContext';
import { getBaseCurrencyCode, getSupabaseClient } from '../../supabase';
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
  const [baseCode, setBaseCode] = useState('—');
  const [helpOpen, setHelpOpen] = useState(false);

  const canSettle = hasPermission('accounting.manage');

  useEffect(() => {
    void getBaseCurrencyCode().then((c) => {
      if (!c) return;
      setBaseCode(c);
    });
  }, []);

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
          <h1 className="text-2xl font-bold dark:text-white">تسوية الدفع عند التسليم (COD)</h1>
          <div className="text-sm text-gray-500 dark:text-gray-300">
            تظهر الطلبات المسلّمة بالدفع عند التسليم غير المُسوَّاة حتى يتم القبض داخل وردية الكاشير.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHelpOpen(v => !v)}
            className="px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-700 dark:text-blue-200 flex items-center gap-1"
            title="دليل الاستخدام"
          >
            ℹ️ {helpOpen ? 'إخفاء الدليل' : 'دليل الاستخدام'}
          </button>
          <button
            onClick={refresh}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-400"
            disabled={loading}
          >
            تحديث
          </button>
        </div>
      </div>

      {/* ═══════════ مركز المساعدة ═══════════ */}
      {helpOpen && (
        <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-2xl p-5 space-y-4 text-sm text-gray-800 dark:text-gray-200 mb-6" dir="rtl">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-blue-800 dark:text-blue-200">ℹ️ دليل تسوية الدفع عند التسليم (COD)</span>
          </div>

          {/* ما هو */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-blue-100 dark:border-blue-800 space-y-2">
            <div className="font-bold text-blue-700 dark:text-blue-300">📌 ما هو COD وما هدف هذا القسم؟</div>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              <strong>COD = Cash On Delivery = الدفع عند التسليم.</strong>{' '}
              المندوب يتسلم المبلغ نقداً من العميل، لكن هذا المبلغ لم يُآدَّ إلى وردية الكاشير بعد.
              هذا القسم يُظهر قائمة المبالغ المتبقية مع كل مندوب، ويُمكّنك من تسويتها دفعةً واحدةً.
            </p>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 text-amber-800 dark:text-amber-200 text-xs">
              ⚠️ يجب فتح وردية نقدية أولاً قبل تنفيذ أي تسوية.
            </div>
          </div>

          {/* متى */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-blue-100 dark:border-blue-800">
            <div className="font-bold text-blue-700 dark:text-blue-300 mb-3">📅 متى تستخدمه؟</div>
            <div className="space-y-2">
              {[
                ['📦 بعد نهاية كل وردية', 'سوِّ جميع مبالغ COD التي غطّاها المندوب قبل إغلاق الوردية.'],
                ['🗓️ يومياً عند بداية الدوام', 'اضبط حساب كل مندوب من اليوم السابق.'],
                ['⚠️ إذا ظهرت طلبات بدون مندوب', 'راجع التنبيه الأحمر أعلى الصفحة وتحقق من تخصيص المندوب للطلب.'],
              ].map(([t, d]) => (
                <div key={t} className="flex gap-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2">
                  <div className="font-semibold text-gray-800 dark:text-gray-100 text-xs min-w-[140px]">{t}</div>
                  <div className="text-gray-600 dark:text-gray-300 text-xs leading-relaxed">{d}</div>
                </div>
              ))}
            </div>
          </div>

          {/* كيفية */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-blue-100 dark:border-blue-800 space-y-2">
            <div className="font-bold text-blue-700 dark:text-blue-300">🔧 كيف تنفذ التسوية؟</div>
            {[
              { step: '١', title: 'تأكد من فتح الوردية', desc: 'يجب أن تكون وردية نقدية مفتوحة — سترى تنبيه باللون الأصفر إذا لم تكن مفتوحة.' },
              { step: '٢', title: 'اعرض بطاقة المندوب', desc: 'كل بطاقة تمثل مندوباً بمبلغ محدد وعدد طلبات غير مُسوَّاة.' },
              { step: '٣', title: 'اضغط «تسوية جماعية»', desc: 'يظهر مربع تأكيد بالمبلغ وعدد الطلبات. تحقق منه ثم اضغط «تسوية».' },
              { step: '٤', title: 'نتيجة التسوية', desc: 'تُسجّل المبالغ داخل وردية الكاشير، وينتقل المبلغ من حساب المندوب إلى حساب الصندوق.' },
            ].map(({ step, title, desc }) => (
              <div key={step} className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded-full bg-blue-600 dark:bg-blue-500 text-white text-xs flex items-center justify-center flex-shrink-0 font-bold">{step}</div>
                <div>
                  <div className="font-semibold text-gray-800 dark:text-gray-100 text-xs">{title}</div>
                  <div className="text-gray-600 dark:text-gray-300 text-xs leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl p-3">
            <div className="font-bold text-emerald-700 dark:text-emerald-300 mb-1">💡 الفرق بين تسوية COD والتسوية المالية</div>
            <p className="text-emerald-800 dark:text-emerald-200 text-xs leading-relaxed">
              تسوية COD = تحصيل مبالغ المندوبين وإضافتها للصندوق.
              التسوية المالية (مساحة التسويات) = مطابقة الدفعات مع الفواتير وإغلاق العناصر المفتوحة.
            </p>
          </div>
        </div>
      )}

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
              توجد طلبات COD بدون مندوب محدد: {groups.missing.orderIds.length} (إجمالي: {groups.missing.total.toFixed(2)} {baseCode || '—'})
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
                          عدد الطلبات: {g.orderIds.length} — الإجمالي: <span className="font-mono">{g.total.toFixed(2)} {baseCode || '—'}</span>
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
                <div className="font-mono text-gray-900 dark:text-white" dir="ltr">{confirmBatch.total.toFixed(2)} {baseCode || '—'}</div>
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
