import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import * as Icons from '../../components/icons';

/* =====================================================================
   شاشة التوظيف — Recruitment Screen
   ===================================================================== */
type RecruitRequest = {
  id: string;
  job_title: string;
  department?: string | null;
  required_count: number;
  filled_count: number;
  priority: string;
  status: string;
  description?: string | null;
  requirements?: string | null;
  salary_range_min?: number | null;
  salary_range_max?: number | null;
  target_date?: string | null;
  created_at: string;
};

type Applicant = {
  id: string;
  request_id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  source: string;
  status: string;
  interview_date?: string | null;
  interview_score?: number | null;
  offer_salary?: number | null;
  notes?: string | null;
  created_at: string;
};

const priorityLabel: Record<string,string> = { low: 'منخفضة', normal: 'عادية', high: 'عالية', urgent: 'عاجلة' };
const statusLabel: Record<string,string> = {
  open: 'مفتوح', in_progress: 'جاري', on_hold: 'موقوف', closed: 'مغلق', cancelled: 'ملغى',
};
const applicantStatusLabel: Record<string,string> = {
  applied: 'تقدّم', screening: 'مراجعة', interview_scheduled: 'مقابلة مجدولة',
  interviewed: 'اجتمع', offer_sent: 'عرض مرسل', hired: 'تم التعيين',
  rejected: 'مرفوض', withdrawn: 'انسحب',
};
const sourceLabel: Record<string,string> = { referral:'توصية', online:'إنترنت', walk_in:'زيارة مباشرة', agency:'وكالة', other:'أخرى' };
const priorityColor: Record<string,string> = {
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  normal: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};
const applicantStatusColor: Record<string,string> = {
  applied: 'bg-gray-100 text-gray-600',
  screening: 'bg-blue-100 text-blue-700',
  interview_scheduled: 'bg-purple-100 text-purple-700',
  interviewed: 'bg-indigo-100 text-indigo-700',
  offer_sent: 'bg-yellow-100 text-yellow-700',
  hired: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  withdrawn: 'bg-gray-200 text-gray-500',
};

const EMPTY_REQ: Omit<RecruitRequest, 'id' | 'filled_count' | 'created_at'> = {
  job_title: '', department: '', required_count: 1, priority: 'normal', status: 'open',
  description: '', requirements: '', salary_range_min: null, salary_range_max: null, target_date: null,
};

export default function RecruitmentScreen() {
  const { showNotification } = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission?.('hr.manage');

  const [requests, setRequests] = useState<RecruitRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loadingApplicants, setLoadingApplicants] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showReqForm, setShowReqForm] = useState(false);
  const [showApplicantForm, setShowApplicantForm] = useState(false);
  const [reqForm, setReqForm] = useState<typeof EMPTY_REQ>({ ...EMPTY_REQ });
  const [saving, setSaving] = useState(false);
  const [applicantForm, setApplicantForm] = useState({
    full_name: '', phone: '', email: '', source: 'other', notes: '',
  });

  const loadRequests = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    try {
      const q = supabase.from('recruitment_requests').select('*').order('created_at', { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      setRequests(data || []);
    } catch (e: any) { showNotification(e.message, 'error'); }
    finally { setLoading(false); }
  }, [showNotification]);

  const loadApplicants = useCallback(async (requestId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoadingApplicants(true);
    try {
      const { data, error } = await supabase
        .from('recruitment_applicants')
        .select('*')
        .eq('request_id', requestId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setApplicants(data || []);
    } catch (e: any) { showNotification(e.message, 'error'); }
    finally { setLoadingApplicants(false); }
  }, [showNotification]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);
  useEffect(() => { if (selectedId) void loadApplicants(selectedId); }, [selectedId, loadApplicants]);

  const filteredRequests = useMemo(() =>
    statusFilter === 'all' ? requests : requests.filter(r => r.status === statusFilter),
    [requests, statusFilter]
  );

  const saveRequest = async () => {
    if (!canManage) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!reqForm.job_title.trim()) { showNotification('المسمى الوظيفي مطلوب', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('recruitment_requests').insert({ ...reqForm });
      if (error) throw error;
      showNotification('تم إنشاء طلب التوظيف', 'success');
      setShowReqForm(false);
      setReqForm({ ...EMPTY_REQ });
      await loadRequests();
    } catch (e: any) { showNotification(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const addApplicant = async () => {
    if (!selectedId || !canManage) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!applicantForm.full_name.trim()) { showNotification('اسم المتقدم مطلوب', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('recruitment_applicants').insert({
        request_id: selectedId, ...applicantForm,
      });
      if (error) throw error;
      showNotification('تمت إضافة المتقدم', 'success');
      setShowApplicantForm(false);
      setApplicantForm({ full_name: '', phone: '', email: '', source: 'other', notes: '' });
      await loadApplicants(selectedId);
    } catch (e: any) { showNotification(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const updateApplicantStatus = async (applicantId: string, newStatus: string) => {
    if (!canManage) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.from('recruitment_applicants').update({ status: newStatus }).eq('id', applicantId);
    if (error) { showNotification(error.message, 'error'); return; }
    if (selectedId) await loadApplicants(selectedId);
    await loadRequests();
  };

  const selectedReq = requests.find(r => r.id === selectedId);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">طلبات التوظيف</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">إدارة طلبات استقطاب الكفاءات والمتقدمين</p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <button
              onClick={() => { setShowReqForm(true); setReqForm({ ...EMPTY_REQ }); }}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm flex items-center gap-2"
            >
              <Icons.PlusIcon className="w-4 h-4" /> طلب توظيف جديد
            </button>
          )}
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'open', 'in_progress', 'on_hold', 'closed'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50'}`}
          >
            {s === 'all' ? 'الكل' : statusLabel[s]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Requests list */}
        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-6 text-gray-400">جاري التحميل...</div>
          ) : filteredRequests.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400">
              لا توجد طلبات توظيف.
            </div>
          ) : (
            filteredRequests.map(req => (
              <div
                key={req.id}
                onClick={() => setSelectedId(req.id)}
                className={`bg-white dark:bg-gray-800 rounded-xl border p-4 cursor-pointer transition-all ${selectedId === req.id ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900' : 'border-gray-100 dark:border-gray-700 hover:border-blue-300'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="font-bold dark:text-white">{req.job_title}</div>
                    {req.department && <div className="text-xs text-gray-400 mt-0.5">{req.department}</div>}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityColor[req.priority]}`}>
                    {priorityLabel[req.priority]}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
                  <span>المطلوب: <b className="text-gray-700 dark:text-gray-200">{req.required_count}</b> | المعيّن: <b className="text-emerald-600">{req.filled_count}</b></span>
                  <span className={`px-2 py-0.5 rounded-full ${statusLabel[req.status] ? 'bg-gray-100 dark:bg-gray-700' : ''}`}>{statusLabel[req.status] || req.status}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Applicants panel */}
        {selectedId && selectedReq ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <div>
                <div className="font-bold dark:text-white">{selectedReq.job_title}</div>
                <div className="text-xs text-gray-400 mt-0.5">المتقدمون ({applicants.length})</div>
              </div>
              {canManage && (
                <button
                  onClick={() => setShowApplicantForm(true)}
                  className="px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg flex items-center gap-1"
                >
                  <Icons.PlusIcon className="w-3 h-3" /> إضافة متقدم
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-100 dark:divide-gray-700">
              {loadingApplicants ? (
                <div className="p-6 text-center text-gray-400">جاري التحميل...</div>
              ) : applicants.length === 0 ? (
                <div className="p-6 text-center text-gray-400">لا يوجد متقدمون.</div>
              ) : (
                applicants.map(app => (
                  <div key={app.id} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-sm dark:text-white">{app.full_name}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {app.phone && <span className="ml-2">{app.phone}</span>}
                          <span>{sourceLabel[app.source] || app.source}</span>
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${applicantStatusColor[app.status] || 'bg-gray-100 text-gray-600'}`}>
                        {applicantStatusLabel[app.status] || app.status}
                      </span>
                    </div>
                    {canManage && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {['screening','interview_scheduled','interviewed','offer_sent','hired','rejected'].map(s => (
                          <button
                            key={s}
                            disabled={app.status === s}
                            onClick={() => void updateApplicantStatus(app.id, s)}
                            className="px-2 py-0.5 rounded text-xs border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            {applicantStatusLabel[s]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400 flex items-center justify-center">
            اختر طلب توظيف من القائمة لعرض المتقدمين
          </div>
        )}
      </div>

      {/* New Request Modal */}
      {showReqForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg space-y-4 p-6" dir="rtl">
            <h2 className="text-lg font-bold dark:text-white">طلب توظيف جديد</h2>
            {[
              { label: 'المسمى الوظيفي *', field: 'job_title' as const },
              { label: 'الإدارة/القسم', field: 'department' as const },
            ].map(item => (
              <div key={item.field}>
                <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">{item.label}</label>
                <input
                  type="text"
                  value={(reqForm as any)[item.field] || ''}
                  onChange={e => setReqForm(f => ({ ...f, [item.field]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">العدد المطلوب</label>
                <input type="number" min="1" value={reqForm.required_count}
                  onChange={e => setReqForm(f => ({ ...f, required_count: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">الأولوية</label>
                <select value={reqForm.priority} onChange={e => setReqForm(f => ({ ...f, priority: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                  {Object.entries(priorityLabel).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">وصف الوظيفة</label>
              <textarea rows={3} value={reqForm.description || ''}
                onChange={e => setReqForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowReqForm(false)} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm">إلغاء</button>
              <button onClick={() => void saveRequest()} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60">
                {saving ? 'جاري...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Applicant Modal */}
      {showApplicantForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md space-y-4 p-6" dir="rtl">
            <h2 className="text-lg font-bold dark:text-white">إضافة متقدم</h2>
            {[
              { label: 'الاسم الكامل *', field: 'full_name' as const, type: 'text' },
              { label: 'الهاتف', field: 'phone' as const, type: 'tel' },
              { label: 'البريد الإلكتروني', field: 'email' as const, type: 'email' },
            ].map(item => (
              <div key={item.field}>
                <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">{item.label}</label>
                <input type={item.type} value={(applicantForm as any)[item.field]}
                  onChange={e => setApplicantForm(f => ({ ...f, [item.field]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                />
              </div>
            ))}
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">مصدر التقدم</label>
              <select value={applicantForm.source} onChange={e => setApplicantForm(f => ({ ...f, source: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                {Object.entries(sourceLabel).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowApplicantForm(false)} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm">إلغاء</button>
              <button onClick={() => void addApplicant()} disabled={saving} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-60">
                {saving ? 'جاري...' : 'إضافة'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
