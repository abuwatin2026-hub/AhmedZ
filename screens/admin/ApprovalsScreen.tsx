import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import Spinner from '../../components/Spinner';
import { useToast } from '../../contexts/ToastContext';
import { localizeSupabaseError } from '../../utils/errorUtils';

type ApprovalRequestRow = {
  id: string;
  target_table: string;
  target_id: string;
  request_type: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  created_at: string | null;
};

type ApprovalStepRow = {
  id: string;
  request_id: string;
  step_no: number;
  approver_role: string;
  status: 'pending' | 'approved' | 'rejected';
  action_by: string | null;
  action_at: string | null;
};

const ApprovalsScreen: React.FC = () => {
  const { showNotification } = useToast();
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [requests, setRequests] = useState<ApprovalRequestRow[]>([]);
  const [steps, setSteps] = useState<ApprovalStepRow[]>([]);

  const load = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setRequests([]);
      setSteps([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: reqRows, error: reqErr } = await supabase.rpc('list_approval_requests', {
        p_status: statusFilter,
        p_limit: 200,
      } as any);

      if (reqErr) throw reqErr;
      const list = (reqRows || []) as any[];
      setRequests(list.map((r) => ({
        id: String(r.id),
        target_table: String(r.target_table || ''),
        target_id: String(r.target_id || ''),
        request_type: String(r.request_type || ''),
        status: (String(r.status || 'pending') as any),
        requested_by: String(r.requested_by || ''),
        approved_by: r.approved_by ? String(r.approved_by) : null,
        approved_at: r.approved_at ? String(r.approved_at) : null,
        rejected_by: r.rejected_by ? String(r.rejected_by) : null,
        rejected_at: r.rejected_at ? String(r.rejected_at) : null,
        created_at: r.created_at ? String(r.created_at) : null,
      })));

      const requestIds = list.map((r) => String(r.id)).filter(Boolean);
      if (requestIds.length === 0) {
        setSteps([]);
        return;
      }
      const { data: stepRows, error: stepErr } = await supabase.rpc('list_approval_steps', {
        p_request_ids: requestIds,
      } as any);

      if (stepErr) throw stepErr;
      setSteps(((stepRows || []) as any[]).map((s) => ({
        id: String(s.id),
        request_id: String(s.request_id),
        step_no: Number(s.step_no) || 0,
        approver_role: String(s.approver_role || ''),
        status: (String(s.status || 'pending') as any),
        action_by: s.action_by ? String(s.action_by) : null,
        action_at: s.action_at ? String(s.action_at) : null,
      })));
    } catch (e) {
      setRequests([]);
      setSteps([]);
      showNotification(localizeSupabaseError(e) || 'تعذر تحميل الموافقات.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const stepsByRequestId = useMemo(() => {
    const map = new Map<string, ApprovalStepRow[]>();
    for (const s of steps) {
      const list = map.get(s.request_id) || [];
      list.push(s);
      map.set(s.request_id, list);
    }
    return map;
  }, [steps]);

  const shortId = (id: string | null | undefined) => {
    const s = String(id || '');
    return s ? s.slice(0, 8) : '';
  };

  const approveStep = async (requestId: string, stepNo: number) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setActionBusy(`${requestId}:${stepNo}:approve`);
    try {
      const { error } = await supabase.rpc('approve_approval_step', { p_request_id: requestId, p_step_no: stepNo });
      if (error) throw error;
      showNotification('تم اعتماد الخطوة.', 'success');
      await load();
    } catch (e) {
      const localized = localizeSupabaseError(e) || '';
      const rawMessage = String((e as any)?.message || '');
      const raw = String(rawMessage || localized || '').toLowerCase();
      const isSelfApproval =
        raw.includes('self_approval_forbidden') ||
        raw.includes('not authorized') ||
        localized.includes('ليس لديك صلاحية تنفيذ هذا الإجراء');

      if (isSelfApproval) {
        try {
          const { error: ownerErr } = await supabase.rpc('owner_finalize_approval_request', { p_request_id: requestId });
          if (ownerErr) throw ownerErr;
          showNotification('تم اعتماد الطلب بصلاحية المالك.', 'success');
          await load();
        } catch (ee) {
          showNotification(localizeSupabaseError(ee) || (localized || 'تعذر اعتماد الخطوة.'), 'error');
        }
      } else {
        showNotification(localized || 'تعذر اعتماد الخطوة.', 'error');
      }
    } finally {
      setActionBusy(null);
    }
  };

  const rejectRequest = async (requestId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setActionBusy(`${requestId}:reject`);
    try {
      const { error } = await supabase.rpc('reject_approval_request', { p_request_id: requestId });
      if (error) throw error;
      showNotification('تم رفض الطلب.', 'info');
      await load();
    } catch (e) {
      showNotification(localizeSupabaseError(e) || 'تعذر رفض الطلب.', 'error');
    } finally {
      setActionBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">الموافقات</h1>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="border rounded-lg px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
          >
            <option value="pending">معلّقة</option>
            <option value="approved">معتمدة</option>
            <option value="rejected">مرفوضة</option>
            <option value="all">الكل</option>
          </select>
          <button
            onClick={() => void load()}
            className="px-3 py-2 rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
          >
            تحديث
          </button>
        </div>
      </div>

      {requests.length === 0 ? (
        <div className="text-center text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-lg p-6">
          لا توجد طلبات موافقة.
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => {
            const reqSteps = stepsByRequestId.get(r.id) || [];
            const pendingStep = reqSteps.find((s) => s.status === 'pending');
            return (
              <div key={r.id} className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <div className="text-sm text-gray-700 dark:text-gray-200">
                      <span className="font-semibold">{r.request_type}</span>
                      <span className="mx-2 text-gray-400">•</span>
                      <span className="text-gray-600 dark:text-gray-300">{r.target_table}:{shortId(r.target_id)}</span>
                      <span className="mx-2 text-gray-400">•</span>
                      <span className="text-gray-600 dark:text-gray-300">طلب #{shortId(r.id)}</span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      الحالة: {r.status} • طالب: {shortId(r.requested_by)} • وقت: {r.created_at ? new Date(r.created_at).toLocaleString('ar-EG-u-nu-latn') : '-'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.status === 'pending' && pendingStep ? (
                      <>
                        <button
                          onClick={() => void approveStep(r.id, pendingStep.step_no)}
                          disabled={actionBusy !== null}
                          className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-60"
                        >
                          اعتماد (خطوة {pendingStep.step_no})
                        </button>
                        <button
                          onClick={() => void rejectRequest(r.id)}
                          disabled={actionBusy !== null}
                          className="px-3 py-2 rounded-lg bg-rose-600 text-white disabled:opacity-60"
                        >
                          رفض
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {reqSteps.length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-600 dark:text-gray-300">
                          <th className="py-2">الخطوة</th>
                          <th className="py-2">الدور</th>
                          <th className="py-2">الحالة</th>
                          <th className="py-2">المُنفّذ</th>
                          <th className="py-2">الوقت</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reqSteps.map((s) => (
                          <tr key={s.id} className="border-t border-gray-100 dark:border-gray-700 text-gray-700 dark:text-gray-200">
                            <td className="py-2">{s.step_no}</td>
                            <td className="py-2">{s.approver_role}</td>
                            <td className="py-2">{s.status}</td>
                            <td className="py-2">{s.action_by ? shortId(s.action_by) : '-'}</td>
                            <td className="py-2">{s.action_at ? new Date(s.action_at).toLocaleString('ar-EG-u-nu-latn') : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ApprovalsScreen;
