import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

/* =====================================================================
   شاشة الاعتمادات المستندية (Letters of Credit)
   ===================================================================== */

type LC = {
  id: string;
  reference_number: string;
  supplier_name?: string;
  bank_name: string;
  currency: string;
  lc_amount: number;
  utilized_amount: number;
  open_date: string;
  expiry_date: string;
  status: string;
  lc_type: string;
};

type LCDrawdown = {
  id: string;
  drawdown_date: string;
  drawdown_amount: number;
  currency: string;
  bl_number?: string | null;
  commercial_invoice_number?: string | null;
  notes?: string | null;
};

type LCExpense = {
  id: string;
  expense_type: string;
  description?: string | null;
  amount: number;
  currency: string;
  expense_date: string;
};

const statusLabel: Record<string,string> = {
  draft:'مسودة', opened:'مفتوح', partially_drawn:'مسحوب جزئياً',
  fully_drawn:'مسحوب بالكامل', expired:'منتهي', cancelled:'ملغى',
};
const statusColor: Record<string,string> = {
  draft:'bg-gray-100 text-gray-600', opened:'bg-blue-100 text-blue-700',
  partially_drawn:'bg-yellow-100 text-yellow-700', fully_drawn:'bg-emerald-100 text-emerald-700',
  expired:'bg-red-100 text-red-700', cancelled:'bg-gray-200 text-gray-500',
};
const lcTypeLabel: Record<string,string> = { sight:'لدى الاطلاع', usance:'آجلة', revolving:'متجددة', standby:'ضمان' };
const expenseTypeLabel: Record<string,string> = {
  opening_commission:'عمولة فتح', amendment_fee:'رسوم تعديل', bank_charges:'رسوم بنكية',
  insurance:'تأمين', freight:'شحن', customs:'جمارك', inspection:'فحص', other:'أخرى',
};

const EMPTY_LC = { reference_number:'', supplier_id:'', bank_name:'', beneficiary_bank:'', currency:'USD',
  lc_amount:'', open_date:'', expiry_date:'', lc_type:'sight', payment_terms:'', incoterms:'', notes:'' };

export default function LettersOfCreditScreen() {
  const { showNotification } = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission?.('accounting.manage') || hasPermission?.('procurement.manage');

  const [lcs, setLcs] = useState<LC[]>([]);
  const [suppliers, setSuppliers] = useState<{id:string;name:string}[]>([]);
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [drawdowns, setDrawdowns] = useState<LCDrawdown[]>([]);
  const [expenses, setExpenses] = useState<LCExpense[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'drawdowns'|'expenses'|'pos'>('drawdowns');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lcForm, setLcForm] = useState({ ...EMPTY_LC });
  const [showDrawdownForm, setShowDrawdownForm] = useState(false);
  const [ddForm, setDdForm] = useState({ drawdown_date:'', drawdown_amount:'', bl_number:'', notes:'' });
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expForm, setExpForm] = useState({ expense_type:'bank_charges', description:'', amount:'', expense_date:'', currency:'USD' });
  const [statusFilter, setStatusFilter] = useState('all');

  const loadSuppliers = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      const modern = await supabase.from('suppliers').select('id,name').eq('is_active', true).order('name');
      if (modern.error) {
        const legacy = await supabase.from('suppliers').select('id,name').order('name');
        if (legacy.error) throw legacy.error;
        setSuppliers((legacy.data || []).map((r: any) => ({
          id: String(r.id),
          name: typeof r.name === 'object' ? String(r.name?.ar || r.name?.en || '') : String(r.name || ''),
        })));
      } else {
        setSuppliers((modern.data || []).map((r: any) => ({
          id: String(r.id),
          name: typeof r.name === 'object' ? String(r.name?.ar || r.name?.en || '') : String(r.name || ''),
        })));
      }
    } catch (e: any) {
      showNotification(e.message || 'تعذر تحميل الموردين', 'error');
      setSuppliers([]);
    }
  }, [showNotification]);

  const loadLCs = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('letters_of_credit')
        .select('id,reference_number,bank_name,currency,lc_amount,utilized_amount,open_date,expiry_date,status,lc_type,suppliers(name)')
        .order('created_at',{ ascending: false });
      if (error) throw error;
      setLcs((data||[]).map((r:any)=>({
        id:r.id, reference_number:r.reference_number,
        supplier_name:r.suppliers?.name||'—',
        bank_name:r.bank_name, currency:r.currency,
        lc_amount:Number(r.lc_amount), utilized_amount:Number(r.utilized_amount),
        open_date:r.open_date, expiry_date:r.expiry_date,
        status:r.status, lc_type:r.lc_type,
      })));
    } catch(e:any){ showNotification(e.message,'error'); }
    finally{ setLoading(false); }
  }, [showNotification]);

  const loadDetail = useCallback(async (lcId:string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const [ddRes, expRes, sumRes] = await Promise.all([
      supabase.from('lc_drawdowns').select('*').eq('lc_id',lcId).order('drawdown_date', { ascending: false }),
      supabase.from('lc_expenses').select('*').eq('lc_id',lcId).order('expense_date', { ascending: false }),
      supabase.rpc('get_lc_summary',{ p_lc_id:lcId }),
    ]);
    setDrawdowns(ddRes.data||[]);
    setExpenses(expRes.data||[]);
    if (Array.isArray(sumRes.data) && sumRes.data.length>0) setSummary(sumRes.data[0]);
    else setSummary(null);
  }, []);

  useEffect(() => { void loadLCs(); void loadSuppliers(); }, [loadLCs, loadSuppliers]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [selectedId, loadDetail]);

  const createLC = async () => {
    if (!canManage) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!lcForm.reference_number || !lcForm.bank_name || !lcForm.lc_amount || !lcForm.open_date || !lcForm.expiry_date) {
      showNotification('يرجى إكمال الحقول الإلزامية','error'); return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('letters_of_credit').insert({
        reference_number:lcForm.reference_number, supplier_id:lcForm.supplier_id||null,
        bank_name:lcForm.bank_name, beneficiary_bank:lcForm.beneficiary_bank||null,
        currency:lcForm.currency, lc_amount:Number(lcForm.lc_amount),
        open_date:lcForm.open_date, expiry_date:lcForm.expiry_date,
        lc_type:lcForm.lc_type, payment_terms:lcForm.payment_terms||null,
        incoterms:lcForm.incoterms||null, notes:lcForm.notes||null, status:'opened',
      });
      if (error) throw error;
      showNotification('تم إنشاء الاعتماد المستندي','success');
      setShowForm(false);
      setLcForm({...EMPTY_LC});
      await loadLCs();
    } catch(e:any){ showNotification(e.message,'error'); }
    finally{ setSaving(false); }
  };

  const addDrawdown = async () => {
    if (!selectedId || !canManage) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!ddForm.drawdown_date || !ddForm.drawdown_amount) { showNotification('التاريخ والمبلغ مطلوبان','error'); return; }
    setSaving(true);
    try {
      const lc = lcs.find(l=>l.id===selectedId);
      const { error } = await supabase.from('lc_drawdowns').insert({
        lc_id:selectedId, drawdown_date:ddForm.drawdown_date,
        drawdown_amount:Number(ddForm.drawdown_amount),
        currency: lc?.currency||'USD',
        bl_number:ddForm.bl_number||null, notes:ddForm.notes||null,
      });
      if (error) throw error;
      showNotification('تم تسجيل السحبة','success');
      setShowDrawdownForm(false);
      setDdForm({drawdown_date:'',drawdown_amount:'',bl_number:'',notes:''});
      await loadDetail(selectedId); await loadLCs();
    } catch(e:any){ showNotification(e.message,'error'); }
    finally{ setSaving(false); }
  };

  const addExpense = async () => {
    if (!selectedId || !canManage) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!expForm.amount || !expForm.expense_date) { showNotification('المبلغ والتاريخ مطلوبان','error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('lc_expenses').insert({
        lc_id:selectedId, expense_type:expForm.expense_type,
        description:expForm.description||null, amount:Number(expForm.amount),
        currency:expForm.currency, expense_date:expForm.expense_date,
      });
      if (error) throw error;
      showNotification('تم تسجيل المصروف','success');
      setShowExpenseForm(false);
      setExpForm({expense_type:'bank_charges',description:'',amount:'',expense_date:'',currency:'USD'});
      await loadDetail(selectedId);
    } catch(e:any){ showNotification(e.message,'error'); }
    finally{ setSaving(false); }
  };

  const filteredLCs = statusFilter==='all' ? lcs : lcs.filter(l=>l.status===statusFilter);
  const selectedLC = lcs.find(l=>l.id===selectedId);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">الاعتمادات المستندية (LC)</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">إدارة اعتمادات الاستيراد والتتبع الكامل للسحبات والمصاريف</p>
        </div>
        {canManage && <button onClick={()=>setShowForm(true)} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm">+ اعتماد جديد</button>}
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {['all','opened','partially_drawn','fully_drawn','expired'].map(s=>(
          <button key={s} onClick={()=>setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-sm ${statusFilter===s?'bg-blue-600 text-white':'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>
            {s==='all'?'الكل':statusLabel[s]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LC list */}
        <div className="space-y-3">
          {loading ? <div className="text-center py-8 text-gray-400">جاري التحميل...</div>
          : filteredLCs.map(lc=>{
            const remaining = lc.lc_amount - lc.utilized_amount;
            const pct = lc.lc_amount>0 ? (lc.utilized_amount/lc.lc_amount*100).toFixed(0) : 0;
            return (
              <div key={lc.id} onClick={()=>setSelectedId(lc.id)}
                className={`bg-white dark:bg-gray-800 rounded-xl border p-4 cursor-pointer ${selectedId===lc.id?'border-blue-500 ring-2 ring-blue-200':'border-gray-100 dark:border-gray-700'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold dark:text-white font-mono">{lc.reference_number}</div>
                    <div className="text-xs text-gray-400">{lc.bank_name} {lc.supplier_name!=='—'?`— ${lc.supplier_name}`:''}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${statusColor[lc.status]}`}>{statusLabel[lc.status]}</span>
                </div>
                <div className="mt-2 text-sm">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>المستخدم: {lc.utilized_amount.toLocaleString()} {lc.currency}</span>
                    <span>المتبقي: {remaining.toLocaleString()} {lc.currency}</span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{width:`${Math.min(Number(pct),100)}%`}} />
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>{lcTypeLabel[lc.lc_type]}</span>
                    <span>الانتهاء: {lc.expiry_date}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {!loading && filteredLCs.length===0 && <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400">لا توجد اعتمادات.</div>}
        </div>

        {/* Detail */}
        {selectedLC ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col">
            {/* Summary bar */}
            {summary && (
              <div className="grid grid-cols-3 divide-x divide-x-reverse divide-gray-100 dark:divide-gray-700 border-b border-gray-100 dark:border-gray-700">
                {[
                  {label:'الاعتماد الكلي', value:`${Number(summary.lc_amount).toLocaleString()} ${summary.currency}`},
                  {label:'المستخدم', value:`${Number(summary.utilized_amount).toLocaleString()} ${summary.currency}`},
                  {label:'المتبقي', value:`${Number(summary.remaining_amount).toLocaleString()} ${summary.currency}`},
                ].map((item,i)=>(
                  <div key={i} className="p-3 text-center">
                    <div className="text-xs text-gray-400">{item.label}</div>
                    <div className="font-bold text-sm dark:text-white font-mono">{item.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Sub-tabs */}
            <div className="flex border-b border-gray-100 dark:border-gray-700 px-3">
              {[
                {id:'drawdowns' as const, label:`سحبات (${drawdowns.length})`},
                {id:'expenses'  as const, label:`مصاريف (${expenses.length})`},
              ].map(t=>(
                <button key={t.id} onClick={()=>setActiveTab(t.id)}
                  className={`py-2 px-3 text-sm font-medium border-b-2 transition-colors ${activeTab===t.id?'border-blue-600 text-blue-600':'border-transparent text-gray-500'}`}>
                  {t.label}
                </button>
              ))}
              <div className="flex-1" />
              {canManage && (
                <button onClick={()=>activeTab==='drawdowns'?setShowDrawdownForm(true):setShowExpenseForm(true)}
                  className="my-1 px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs">
                  + إضافة
                </button>
              )}
            </div>

            <div className="overflow-y-auto flex-1">
              {activeTab==='drawdowns' && (
                <table className="w-full text-right text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 sticky top-0">
                    <tr>
                      <th className="px-3 py-2">التاريخ</th>
                      <th className="px-3 py-2 text-center">المبلغ</th>
                      <th className="px-3 py-2">رقم BL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {drawdowns.map(d=>(
                      <tr key={d.id}>
                        <td className="px-3 py-2 font-mono text-xs">{d.drawdown_date}</td>
                        <td className="px-3 py-2 text-center font-mono font-bold text-blue-700">{Number(d.drawdown_amount).toLocaleString()} {d.currency}</td>
                        <td className="px-3 py-2 text-xs text-gray-400">{d.bl_number||'—'}</td>
                      </tr>
                    ))}
                    {drawdowns.length===0 && <tr><td colSpan={3} className="py-6 text-center text-gray-400">لا توجد سحبات.</td></tr>}
                  </tbody>
                </table>
              )}
              {activeTab==='expenses' && (
                <table className="w-full text-right text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 sticky top-0">
                    <tr>
                      <th className="px-3 py-2">التاريخ</th>
                      <th className="px-3 py-2">النوع</th>
                      <th className="px-3 py-2 text-center">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {expenses.map(e=>(
                      <tr key={e.id}>
                        <td className="px-3 py-2 font-mono text-xs">{e.expense_date}</td>
                        <td className="px-3 py-2">{expenseTypeLabel[e.expense_type]||e.expense_type}</td>
                        <td className="px-3 py-2 text-center font-mono font-bold text-orange-700">{Number(e.amount).toLocaleString()} {e.currency}</td>
                      </tr>
                    ))}
                    {expenses.length===0 && <tr><td colSpan={3} className="py-6 text-center text-gray-400">لا توجد مصاريف.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-12 text-center text-gray-400">اختر اعتماداً من القائمة</div>
        )}
      </div>

      {/* New LC Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3 my-4" dir="rtl">
            <h2 className="text-lg font-bold dark:text-white">اعتماد مستندي جديد</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">رقم الاعتماد *</label>
                <input value={lcForm.reference_number} onChange={e=>setLcForm(f=>({...f,reference_number:e.target.value}))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">المورد</label>
                <select value={lcForm.supplier_id} onChange={e=>setLcForm(f=>({...f,supplier_id:e.target.value}))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                  <option value="">-- اختياري --</option>
                  {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">نوع الاعتماد</label>
                <select value={lcForm.lc_type} onChange={e=>setLcForm(f=>({...f,lc_type:e.target.value}))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                  {Object.entries(lcTypeLabel).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">البنك المصدر *</label>
                <input value={lcForm.bank_name} onChange={e=>setLcForm(f=>({...f,bank_name:e.target.value}))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">العملة</label>
                <input value={lcForm.currency} onChange={e=>setLcForm(f=>({...f,currency:e.target.value}))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono uppercase" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">قيمة الاعتماد *</label>
                <input type="number" min="0" value={lcForm.lc_amount} onChange={e=>setLcForm(f=>({...f,lc_amount:e.target.value}))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">تاريخ الفتح *</label>
                <input type="date" value={lcForm.open_date} onChange={e=>setLcForm(f=>({...f,open_date:e.target.value}))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">تاريخ الانتهاء *</label>
                <input type="date" value={lcForm.expiry_date} onChange={e=>setLcForm(f=>({...f,expiry_date:e.target.value}))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={()=>setShowForm(false)} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm">إلغاء</button>
              <button onClick={()=>void createLC()} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60">
                {saving?'جاري...':'إنشاء'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Drawdown Modal */}
      {showDrawdownForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-3" dir="rtl">
            <h2 className="text-lg font-bold dark:text-white">تسجيل سحبة</h2>
            <div>
              <label className="block text-xs text-gray-500 mb-1">التاريخ *</label>
              <input type="date" value={ddForm.drawdown_date} onChange={e=>setDdForm(f=>({...f,drawdown_date:e.target.value}))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">المبلغ *</label>
              <input type="number" value={ddForm.drawdown_amount} onChange={e=>setDdForm(f=>({...f,drawdown_amount:e.target.value}))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">رقم بوليصة الشحن (BL)</label>
              <input value={ddForm.bl_number} onChange={e=>setDdForm(f=>({...f,bl_number:e.target.value}))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={()=>setShowDrawdownForm(false)} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm">إلغاء</button>
              <button onClick={()=>void addDrawdown()} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60">
                {saving?'جاري...':'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Expense Modal */}
      {showExpenseForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-3" dir="rtl">
            <h2 className="text-lg font-bold dark:text-white">تسجيل مصروف</h2>
            <div>
              <label className="block text-xs text-gray-500 mb-1">نوع المصروف</label>
              <select value={expForm.expense_type} onChange={e=>setExpForm(f=>({...f,expense_type:e.target.value}))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                {Object.entries(expenseTypeLabel).map(([k,v])=><option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">المبلغ *</label>
              <input type="number" value={expForm.amount} onChange={e=>setExpForm(f=>({...f,amount:e.target.value}))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">التاريخ *</label>
              <input type="date" value={expForm.expense_date} onChange={e=>setExpForm(f=>({...f,expense_date:e.target.value}))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={()=>setShowExpenseForm(false)} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm">إلغاء</button>
              <button onClick={()=>void addExpense()} disabled={saving} className="px-4 py-2 rounded-lg bg-orange-600 text-white text-sm disabled:opacity-60">
                {saving?'جاري...':'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
