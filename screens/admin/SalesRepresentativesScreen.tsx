import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

/* =====================================================================
   شاشة مناديب المبيعات والعمولات
   ===================================================================== */

type SalesRep = {
  id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  commission_type: string;
  commission_rate: number;
  currency: string;
  territory?: string | null;
  target_monthly: number;
  is_active: boolean;
};

type Commission = {
  id: string;
  order_id?: string | null;
  period_ym: string;
  order_net_amount: number;
  commission_amount: number;
  currency: string;
  status: string;
};

const commTypeLabel: Record<string,string> = {
  percentage: 'نسبة مئوية', fixed_per_order: 'مبلغ ثابت/طلب', fixed_per_item: 'مبلغ ثابت/صنف',
};
const commStatusColor: Record<string,string> = {
  pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700', voided: 'bg-gray-200 text-gray-500',
};
const commStatusLabel: Record<string,string> = { pending:'معلق', approved:'معتمد', paid:'مدفوع', voided:'ملغى' };

export default function SalesRepresentativesScreen() {
  const { showNotification } = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission?.('orders.view') || hasPermission?.('hr.contracts.manage');

  const [reps, setReps] = useState<SalesRep[]>([]);
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [perf, setPerf] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0,7));
  const [computing, setComputing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Omit<SalesRep,'id'>>({
    full_name:'',phone:'',email:'',commission_type:'percentage',commission_rate:0,
    currency:'YER',territory:'',target_monthly:0,is_active:true,
  });

  const loadReps = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('sales_representatives').select('*').order('full_name');
      if (error) throw error;
      setReps(data || []);
    } catch(e:any){ showNotification(e.message,'error'); }
    finally { setLoading(false); }
  }, [showNotification]);

  const loadCommissions = useCallback(async (repId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data } = await supabase
      .from('sales_rep_commissions')
      .select('*')
      .eq('rep_id', repId)
      .order('period_ym', { ascending: false })
      .limit(100);
    setCommissions(data || []);
  }, []);

  const loadPerf = useCallback(async (repId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data } = await supabase.rpc('get_rep_performance', { p_rep_id: repId, p_period_ym: period });
    if (data && Array.isArray(data) && data.length > 0) setPerf(data[0]);
  }, [period]);

  useEffect(() => { void loadReps(); }, [loadReps]);
  useEffect(() => {
    if (selectedId) { void loadCommissions(selectedId); void loadPerf(selectedId); }
  }, [selectedId, loadCommissions, loadPerf]);

  const saveRep = async () => {
    if (!canManage) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!form.full_name.trim()) { showNotification('الاسم مطلوب','error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('sales_representatives').insert({ ...form });
      if (error) throw error;
      showNotification('تم إضافة المندوب','success');
      setShowForm(false);
      setForm({full_name:'',phone:'',email:'',commission_type:'percentage',commission_rate:0,currency:'YER',territory:'',target_monthly:0,is_active:true});
      await loadReps();
    } catch(e:any){ showNotification(e.message,'error'); }
    finally { setSaving(false); }
  };

  const computeCommissions = async () => {
    if (!canManage) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setComputing(true);
    try {
      const { data, error } = await supabase.rpc('compute_rep_commissions', { p_period_ym: period });
      if (error) throw error;
      const count = Array.isArray(data) ? data.length : 0;
      showNotification(`تم احتساب عمولات ${count} مندوب`,'success');
      if (selectedId) await loadCommissions(selectedId);
    } catch(e:any){ showNotification(e.message,'error'); }
    finally { setComputing(false); }
  };

  const selectedRep = reps.find(r => r.id === selectedId);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">مناديب المبيعات</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">إدارة المناديب ومتابعة عمولاتهم وأدائهم</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input type="month" value={period} onChange={e=>setPeriod(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
          {canManage && (
            <>
              <button onClick={()=>void computeCommissions()} disabled={computing}
                className="px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm disabled:opacity-60">
                {computing?'احتساب...':'احتساب عمولات الشهر'}
              </button>
              <button onClick={()=>setShowForm(true)} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm">+ مندوب جديد</button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Reps list */}
        <div className="space-y-2">
          <div className="text-sm font-semibold dark:text-white text-gray-600 dark:text-gray-300 px-1">المناديب ({reps.length})</div>
          {loading ? <div className="text-center py-6 text-gray-400">جاري التحميل...</div>
          : reps.map(rep=>(
            <div key={rep.id} onClick={()=>setSelectedId(rep.id)}
              className={`bg-white dark:bg-gray-800 rounded-xl border p-3 cursor-pointer ${selectedId===rep.id?'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900':'border-gray-100 dark:border-gray-700'}`}>
              <div className="flex items-center justify-between">
                <div className="font-semibold dark:text-white">{rep.full_name}</div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${rep.is_active?'bg-emerald-100 text-emerald-700':'bg-gray-100 text-gray-500'}`}>
                  {rep.is_active?'نشط':'غير نشط'}
                </span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {commTypeLabel[rep.commission_type]} — {rep.commission_type==='percentage'?`${rep.commission_rate}%`:rep.commission_rate.toLocaleString()}
              </div>
              {rep.territory && <div className="text-xs text-gray-400">{rep.territory}</div>}
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-2">
          {selectedRep ? (
            <div className="space-y-4">
              {/* Performance */}
              {perf && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label:'الطلبات المنجزة', value: perf.total_orders || 0 },
                    { label:'الإيراد الكلي', value: Number(perf.total_revenue||0).toLocaleString('ar-YE',{minimumFractionDigits:0}) },
                    { label:'نسبة الهدف', value: `${perf.achievement_pct||0}%` },
                    { label:'إجمالي العمولة', value: Number(perf.total_commission||0).toLocaleString('ar-YE',{minimumFractionDigits:0}) },
                  ].map((item,i)=>(
                    <div key={i} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-3 text-center">
                      <div className="text-xs text-gray-400 mb-1">{item.label}</div>
                      <div className="font-bold dark:text-white">{item.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Commissions table */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="p-3 border-b border-gray-100 dark:border-gray-700 font-semibold dark:text-white">
                  عمولات {selectedRep.full_name}
                </div>
                <table className="w-full text-right text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500">
                    <tr>
                      <th className="px-3 py-2">الفترة</th>
                      <th className="px-3 py-2 text-center">قيمة الطلب</th>
                      <th className="px-3 py-2 text-center">العمولة</th>
                      <th className="px-3 py-2 text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {commissions.map(c=>(
                      <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="px-3 py-2 font-mono">{c.period_ym}</td>
                        <td className="px-3 py-2 text-center font-mono">{Number(c.order_net_amount).toLocaleString('ar-YE',{minimumFractionDigits:0})}</td>
                        <td className="px-3 py-2 text-center font-mono text-emerald-700 dark:text-emerald-300 font-bold">{Number(c.commission_amount).toLocaleString('ar-YE',{minimumFractionDigits:2})}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${commStatusColor[c.status]||'bg-gray-100 text-gray-500'}`}>
                            {commStatusLabel[c.status]||c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {commissions.length===0 && <tr><td colSpan={4} className="py-6 text-center text-gray-400">لا توجد عمولات.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-12 text-center text-gray-400">
              اختر مندوباً من القائمة
            </div>
          )}
        </div>
      </div>

      {/* New Rep Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" dir="rtl">
            <h2 className="text-lg font-bold dark:text-white">إضافة مندوب مبيعات</h2>
            {[
              {label:'الاسم الكامل *', field:'full_name', type:'text'},
              {label:'الهاتف', field:'phone', type:'tel'},
              {label:'البريد الإلكتروني', field:'email', type:'email'},
              {label:'المنطقة الجغرافية', field:'territory', type:'text'},
            ].map(item=>(
              <div key={item.field}>
                <label className="block text-xs text-gray-500 mb-1">{item.label}</label>
                <input type={item.type} value={(form as any)[item.field]||''}
                  onChange={e=>setForm(f=>({...f,[item.field]:e.target.value}))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">نوع العمولة</label>
                <select value={form.commission_type} onChange={e=>setForm(f=>({...f,commission_type:e.target.value}))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                  {Object.entries(commTypeLabel).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">معدل العمولة {form.commission_type==='percentage'?'(%)':'(مبلغ)'}</label>
                <input type="number" min="0" step="0.01" value={form.commission_rate}
                  onChange={e=>setForm(f=>({...f,commission_rate:Number(e.target.value)}))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">الهدف الشهري</label>
              <input type="number" min="0" value={form.target_monthly}
                onChange={e=>setForm(f=>({...f,target_monthly:Number(e.target.value)}))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={()=>setShowForm(false)} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm">إلغاء</button>
              <button onClick={()=>void saveRep()} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60">
                {saving?'جاري...':'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
