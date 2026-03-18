import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

/* =====================================================================
   شاشة طلبات صرف المخزون
   ===================================================================== */

type WithdrawalRequest = {
  id: string;
  reference_number: string;
  request_number?: string;
  warehouse_name: string;
  warehouse_id?: string;
  purpose?: string | null;
  department?: string | null;
  status: string;
  required_date?: string | null;
  created_at: string;
  items_count?: number;
};

type WithdrawalItem = {
  id: string;
  item_name: string;
  requested_qty: number;
  approved_qty?: number | null;
  fulfilled_qty: number;
  uom_code?: string | null;
};

const statusLabel: Record<string,string> = {
  draft: 'مسودة', pending_approval: 'في انتظار الاعتماد', approved: 'معتمد',
  rejected: 'مرفوض', fulfilled: 'منفَّذ', cancelled: 'ملغى',
};
const statusColor: Record<string,string> = {
  draft: 'bg-gray-100 text-gray-600', pending_approval: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700', rejected: 'bg-red-100 text-red-700',
  fulfilled: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-gray-200 text-gray-500',
};

export default function InventoryWithdrawalScreen() {
  const { showNotification } = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission?.('inventory.manage') || hasPermission?.('stock.manage');
  const canApprove = hasPermission?.('accounting.manage') || canManage;

  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);
  const [warehouses, setWarehouses] = useState<{id:string;name:string}[]>([]);
  const [items, setItems] = useState<{id:string;name:string}[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [requestItems, setRequestItems] = useState<WithdrawalItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showNewForm, setShowNewForm] = useState(false);
  const [acting, setActing] = useState(false);

  const [newForm, setNewForm] = useState({
    warehouse_id: '', purpose: '', department: '', required_date: '',
  });
  const [newLines, setNewLines] = useState<{item_id:string;requested_qty:string;uom_code:string}[]>([
    {item_id:'',requested_qty:'1',uom_code:''},
  ]);

  const loadWarehouses = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data } = await supabase.from('warehouses').select('id,name').order('name');
    setWarehouses((data || []).map((r:any) => ({ id: r.id, name: typeof r.name === 'object' ? (r.name?.ar || r.name?.en || '') : r.name })));
  }, []);

  const loadItems = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data } = await supabase.from('menu_items').select('id,name').eq('is_active', true).order('name').limit(300);
    setItems((data || []).map((r:any) => ({ id: r.id, name: typeof r.name === 'object' ? (r.name?.ar || r.name?.en || '') : r.name })));
  }, []);

  const loadRequests = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    try {
      const modern = await supabase
        .from('inventory_withdrawal_requests')
        .select('id,reference_number,purpose,department,status,required_date,created_at,warehouse_id,warehouses(name)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (modern.error) {
        const legacy = await supabase
          .from('inventory_withdrawal_requests')
          .select('id,request_number,purpose,department,status,created_at,warehouse_id,warehouses(name)')
          .order('created_at', { ascending: false })
          .limit(100);
        if (legacy.error) throw legacy.error;
        setRequests((legacy.data || []).map((r: any) => ({
          id: r.id,
          reference_number: String(r.request_number || r.id),
          request_number: r.request_number ?? null,
          warehouse_id: r.warehouse_id ?? null,
          warehouse_name: typeof r.warehouses?.name === 'object' ? (r.warehouses.name?.ar || r.warehouses.name?.en || '') : (r.warehouses?.name || '—'),
          purpose: r.purpose,
          department: r.department,
          status: r.status,
          required_date: null,
          created_at: r.created_at,
        })));
      } else {
        setRequests((modern.data || []).map((r: any) => ({
          id: r.id,
          reference_number: String(r.reference_number || r.request_number || r.id),
          request_number: r.request_number ?? null,
          warehouse_id: r.warehouse_id ?? null,
          warehouse_name: typeof r.warehouses?.name === 'object' ? (r.warehouses.name?.ar || r.warehouses.name?.en || '') : (r.warehouses?.name || '—'),
          purpose: r.purpose,
          department: r.department,
          status: r.status,
          required_date: r.required_date,
          created_at: r.created_at,
        })));
      }
    } catch(e:any){ showNotification(e.message,'error'); }
    finally{ setLoading(false); }
  }, [showNotification]);

  const loadRequestItems = useCallback(async (reqId:string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data, error } = await supabase
      .from('inventory_withdrawal_items')
      .select('id,requested_qty,approved_qty,fulfilled_qty,uom_code,menu_items(name)')
      .eq('request_id', reqId);
    if (error) return;
    setRequestItems((data||[]).map((r:any)=>({
      id: r.id,
      item_name: typeof r.menu_items?.name === 'object'?(r.menu_items.name?.ar||r.menu_items.name?.en||'—'):(r.menu_items?.name||'—'),
      requested_qty: Number(r.requested_qty),
      approved_qty: r.approved_qty != null ? Number(r.approved_qty) : null,
      fulfilled_qty: Number(r.fulfilled_qty),
      uom_code: r.uom_code,
    })));
  }, []);

  useEffect(() => { void loadRequests(); void loadWarehouses(); void loadItems(); }, [loadRequests, loadWarehouses, loadItems]);
  useEffect(() => { if (selectedId) void loadRequestItems(selectedId); }, [selectedId, loadRequestItems]);

  const createRequest = async () => {
    if (!canManage) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!newForm.warehouse_id) { showNotification('اختر المستودع','error'); return; }
    const validLines = newLines.filter(l => l.item_id && Number(l.requested_qty)>0);
    if (validLines.length === 0) { showNotification('أضف صنفاً واحداً على الأقل','error'); return; }
    setActing(true);
    try {
      let req: any = null;
      const modernInsert = await supabase
        .from('inventory_withdrawal_requests')
        .insert({ warehouse_id: newForm.warehouse_id, purpose: newForm.purpose || null, department: newForm.department || null, required_date: newForm.required_date || null })
        .select('id').single();
      if (modernInsert.error) {
        const legacyInsert = await supabase
          .from('inventory_withdrawal_requests')
          .insert({ warehouse_id: newForm.warehouse_id, purpose: newForm.purpose || null, department: newForm.department || null })
          .select('id').single();
        if (legacyInsert.error) throw legacyInsert.error;
        req = legacyInsert.data;
      } else {
        req = modernInsert.data;
      }
      const reqId = req.id;
      for (const line of validLines) {
        await supabase.from('inventory_withdrawal_items').insert({
          request_id: reqId, item_id: line.item_id, requested_qty: Number(line.requested_qty), uom_code: line.uom_code||null,
        });
      }
      showNotification('تم إنشاء طلب الصرف','success');
      setShowNewForm(false);
      setNewForm({warehouse_id:'',purpose:'',department:'',required_date:''});
      setNewLines([{item_id:'',requested_qty:'1',uom_code:''}]);
      await loadRequests();
    } catch(e:any){ showNotification(e.message,'error'); }
    finally { setActing(false); }
  };

  const doAction = async (action: 'submit'|'approve'|'reject'|'fulfill') => {
    if (!selectedId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setActing(true);
    try {
      const fnMap = {
        submit: 'submit_withdrawal_request',
        approve: 'approve_withdrawal_request',
        reject: 'reject_withdrawal_request',
        fulfill: 'fulfill_withdrawal_request',
      };
      if (action === 'approve') {
        const r1 = await supabase.rpc(fnMap[action], { p_request_id: selectedId, p_approved_by: null } as any);
        if (r1.error) {
          const r2 = await supabase.rpc(fnMap[action], { p_request_id: selectedId, p_approver_id: null } as any);
          if (r2.error) throw r2.error;
        }
      } else if (action === 'reject') {
        const r1 = await supabase.rpc(fnMap[action], { p_request_id: selectedId, p_reason: 'Rejected', p_rejected_by: null } as any);
        if (r1.error) {
          const r2 = await supabase.rpc(fnMap[action], { p_request_id: selectedId, p_rejector_id: null } as any);
          if (r2.error) throw r2.error;
        }
      } else {
        const { error } = await supabase.rpc(fnMap[action], { p_request_id: selectedId } as any);
        if (error) throw error;
      }
      const labels = { submit:'تقديم للاعتماد', approve:'اعتماد', reject:'رفض', fulfill:'تنفيذ الصرف' };
      showNotification(`تم ${labels[action]} بنجاح`,'success');
      await loadRequests();
    } catch(e:any){ showNotification(e.message,'error'); }
    finally{ setActing(false); }
  };

  const filteredReqs = statusFilter === 'all' ? requests : requests.filter(r=>r.status===statusFilter);
  const selectedReq = requests.find(r=>r.id===selectedId);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">طلبات صرف المخزون</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">مراقبة وإدارة طلبات صرف المخزون مع الاعتماد المسبق</p>
        </div>
        {canManage && <button onClick={()=>setShowNewForm(true)} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm">+ طلب جديد</button>}
      </div>

      <div className="flex gap-2 flex-wrap">
        {['all','draft','pending_approval','approved','fulfilled'].map(s=>(
          <button key={s} onClick={()=>setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-sm ${statusFilter===s?'bg-blue-600 text-white':'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>
            {s==='all'?'الكل':statusLabel[s]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* List */}
        <div className="space-y-3">
          {loading ? <div className="text-center py-8 text-gray-400">جاري التحميل...</div>
          : filteredReqs.map(req=>(
            <div key={req.id} onClick={()=>setSelectedId(req.id)}
              className={`bg-white dark:bg-gray-800 rounded-xl border p-4 cursor-pointer ${selectedId===req.id?'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900':'border-gray-100 dark:border-gray-700'}`}>
              <div className="flex items-center justify-between">
                <div className="font-mono text-sm font-bold dark:text-white">{req.reference_number}</div>
                <span className={`px-2 py-0.5 rounded-full text-xs ${statusColor[req.status]||'bg-gray-100 text-gray-600'}`}>{statusLabel[req.status]||req.status}</span>
              </div>
              <div className="text-sm text-gray-500 mt-1">{req.warehouse_name} {req.department ? `— ${req.department}` : ''}</div>
              {req.purpose && <div className="text-xs text-gray-400 mt-0.5">{req.purpose}</div>}
            </div>
          ))}
          {!loading && filteredReqs.length===0 && <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400">لا توجد طلبات.</div>}
        </div>

        {/* Detail */}
        {selectedReq ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-bold dark:text-white">{selectedReq.reference_number}</div>
              <span className={`px-2 py-0.5 rounded-full text-xs ${statusColor[selectedReq.status]}`}>{statusLabel[selectedReq.status]}</span>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              <div>المستودع: {selectedReq.warehouse_name}</div>
              {selectedReq.department && <div>الإدارة: {selectedReq.department}</div>}
              {selectedReq.purpose && <div>الغرض: {selectedReq.purpose}</div>}
            </div>

            {/* Items */}
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">الصنف</th>
                  <th className="px-3 py-2 text-center">مطلوب</th>
                  <th className="px-3 py-2 text-center">معتمد</th>
                  <th className="px-3 py-2 text-center">منفَّذ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {requestItems.map(it=>(
                  <tr key={it.id}>
                    <td className="px-3 py-2 dark:text-white">{it.item_name}</td>
                    <td className="px-3 py-2 text-center font-mono">{it.requested_qty} {it.uom_code||''}</td>
                    <td className="px-3 py-2 text-center font-mono">{it.approved_qty ?? '—'}</td>
                    <td className="px-3 py-2 text-center font-mono text-emerald-600">{it.fulfilled_qty}</td>
                  </tr>
                ))}
                {requestItems.length===0 && <tr><td colSpan={4} className="py-4 text-center text-gray-400">لا توجد أصناف.</td></tr>}
              </tbody>
            </table>

            {/* Actions */}
            <div className="flex gap-2 flex-wrap pt-2">
              {selectedReq.status==='draft' && canManage && (
                <button disabled={acting} onClick={()=>void doAction('submit')} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60">تقديم للاعتماد</button>
              )}
              {selectedReq.status==='pending_approval' && canApprove && (
                <>
                  <button disabled={acting} onClick={()=>void doAction('approve')} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-60">اعتماد</button>
                  <button disabled={acting} onClick={()=>void doAction('reject')} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm disabled:opacity-60">رفض</button>
                </>
              )}
              {selectedReq.status==='approved' && canManage && (
                <button disabled={acting} onClick={()=>void doAction('fulfill')} className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm disabled:opacity-60">تنفيذ الصرف</button>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400">اختر طلباً من القائمة</div>
        )}
      </div>

      {/* New Request Modal */}
      {showNewForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-xl p-6 space-y-4" dir="rtl">
            <h2 className="text-lg font-bold dark:text-white">طلب صرف مخزون جديد</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">المستودع *</label>
                <select value={newForm.warehouse_id} onChange={e=>setNewForm(f=>({...f,warehouse_id:e.target.value}))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                  <option value="">-- اختر --</option>
                  {warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">الإدارة</label>
                <input value={newForm.department} onChange={e=>setNewForm(f=>({...f,department:e.target.value}))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">الغرض</label>
              <input value={newForm.purpose} onChange={e=>setNewForm(f=>({...f,purpose:e.target.value}))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
            </div>

            {/* Lines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold dark:text-white">الأصناف</div>
                <button onClick={()=>setNewLines(l=>[...l,{item_id:'',requested_qty:'1',uom_code:''}])}
                  className="text-xs text-blue-600 hover:underline">+ إضافة صنف</button>
              </div>
              <div className="space-y-2">
                {newLines.map((line,i)=>(
                  <div key={i} className="grid grid-cols-5 gap-2 items-center">
                    <div className="col-span-3">
                      <select value={line.item_id} onChange={e=>setNewLines(ls=>ls.map((l,j)=>j===i?{...l,item_id:e.target.value}:l))}
                        className="w-full px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs">
                        <option value="">-- الصنف --</option>
                        {items.map(it=><option key={it.id} value={it.id}>{it.name}</option>)}
                      </select>
                    </div>
                    <input type="number" min="0.001" value={line.requested_qty} onChange={e=>setNewLines(ls=>ls.map((l,j)=>j===i?{...l,requested_qty:e.target.value}:l))}
                      placeholder="الكمية"
                      className="px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-mono" />
                    <button onClick={()=>setNewLines(ls=>ls.filter((_,j)=>j!==i))} className="text-red-500 text-xs">حذف</button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={()=>setShowNewForm(false)} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm">إلغاء</button>
              <button onClick={()=>void createRequest()} disabled={acting} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60">
                {acting?'جاري...':'إنشاء الطلب'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
