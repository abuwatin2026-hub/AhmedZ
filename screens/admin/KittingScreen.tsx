import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import * as Icons from '../../components/icons';

/* =====================================================================
   شاشة الأصناف المركبة (Kitting / Assembly)
   ===================================================================== */

type ItemRow = { id: string; name: string };
type BOMLine = {
  id: string;
  parent_item_id: string;
  component_item_id: string;
  component_name: string;
  quantity: number;
  uom_code?: string | null;
  is_active: boolean;
};
type KitOp = {
  id: string;
  operation_type: string;
  kit_item_id: string;
  kit_name: string;
  warehouse_id: string;
  warehouse_name: string;
  quantity: number;
  status: string;
  created_at: string;
};

const opLabel: Record<string,string> = { assemble: 'تجميع', disassemble: 'تفكيك' };

export default function KittingScreen() {
  const { showNotification } = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission?.('inventory.manage');

  const [items, setItems] = useState<ItemRow[]>([]);
  const [warehouses, setWarehouses] = useState<ItemRow[]>([]);
  const [selectedKitId, setSelectedKitId] = useState('');
  const [bomLines, setBomLines] = useState<BOMLine[]>([]);
  const [operations, setOperations] = useState<KitOp[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'bom' | 'operations' | 'execute'>('bom');

  // BOM form
  const [bomForm, setBomForm] = useState({ component_item_id: '', quantity: '1', uom_code: '' });
  const [savingBom, setSavingBom] = useState(false);

  // Execute form
  const [execForm, setExecForm] = useState({ operation_type: 'assemble', warehouse_id: '', quantity: '1' });
  const [executing, setExecuting] = useState(false);

  const loadBase = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const [itemsRes, whRes] = await Promise.all([
      supabase.from('menu_items').select('id,name').eq('is_active', true).order('name').limit(200),
      supabase.from('warehouses').select('id,name').order('name'),
    ]);
    const mapItem = (r: any) => ({ id: r.id, name: typeof r.name === 'object' ? (r.name?.ar || r.name?.en || JSON.stringify(r.name)) : String(r.name) });
    setItems((itemsRes.data || []).map(mapItem));
    setWarehouses((whRes.data || []).map(mapItem));
  }, []);

  const loadBOM = useCallback(async (kitId: string) => {
    if (!kitId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('item_bom')
        .select('*, menu_items!item_bom_component_item_id_fkey(name)')
        .eq('parent_item_id', kitId)
        .order('created_at');
      if (error) throw error;
      const mapName = (n: any) => typeof n === 'object' ? (n?.ar || n?.en || JSON.stringify(n)) : String(n || '—');
      setBomLines((data || []).map((r: any) => ({
        id: r.id,
        parent_item_id: r.parent_item_id,
        component_item_id: r.component_item_id,
        component_name: mapName(r.menu_items?.name),
        quantity: Number(r.quantity),
        uom_code: r.uom_code,
        is_active: r.is_active,
      })));
    } catch (e: any) { showNotification(e.message, 'error'); }
    finally { setLoading(false); }
  }, [showNotification]);

  const loadOps = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data } = await supabase
      .from('kitting_operations')
      .select('*, menu_items!kitting_operations_kit_item_id_fkey(name), warehouses(name)')
      .order('created_at', { ascending: false })
      .limit(50);
    const mapName = (n: any) => typeof n === 'object' ? (n?.ar || n?.en || JSON.stringify(n)) : String(n || '—');
    setOperations((data || []).map((r: any) => ({
      id: r.id,
      operation_type: r.operation_type,
      kit_item_id: r.kit_item_id,
      kit_name: mapName(r.menu_items?.name),
      warehouse_id: r.warehouse_id,
      warehouse_name: mapName(r.warehouses?.name),
      quantity: Number(r.quantity),
      status: r.status,
      created_at: r.created_at,
    })));
  }, []);

  useEffect(() => { void loadBase(); void loadOps(); }, [loadBase, loadOps]);
  useEffect(() => { if (selectedKitId) void loadBOM(selectedKitId); }, [selectedKitId, loadBOM]);

  const addBOMLine = async () => {
    if (!canManage || !selectedKitId) return;
    if (!bomForm.component_item_id || Number(bomForm.quantity) <= 0) {
      showNotification('اختر المكوّن وأدخل الكمية', 'error'); return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSavingBom(true);
    try {
      const { error } = await supabase.from('item_bom').upsert({
        parent_item_id: selectedKitId,
        component_item_id: bomForm.component_item_id,
        quantity: Number(bomForm.quantity),
        uom_code: bomForm.uom_code || null,
      });
      if (error) throw error;
      // Mark kit as composite
      await supabase.from('menu_items').update({ is_composite: true }).eq('id', selectedKitId);
      showNotification('تمت إضافة المكوّن', 'success');
      setBomForm({ component_item_id: '', quantity: '1', uom_code: '' });
      await loadBOM(selectedKitId);
    } catch (e: any) { showNotification(e.message, 'error'); }
    finally { setSavingBom(false); }
  };

  const executeOperation = async () => {
    if (!canManage || !selectedKitId) return;
    if (!execForm.warehouse_id || Number(execForm.quantity) <= 0) {
      showNotification('اختر المستودع والكمية', 'error'); return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setExecuting(true);
    try {
      const fn = execForm.operation_type === 'assemble' ? 'assemble_kit' : 'disassemble_kit';
      const { error } = await supabase.rpc(fn, {
        p_kit_item_id: selectedKitId,
        p_quantity: Number(execForm.quantity),
        p_warehouse_id: execForm.warehouse_id,
      });
      if (error) throw error;
      showNotification(`تمت عملية ${opLabel[execForm.operation_type]} بنجاح`, 'success');
      await loadOps();
    } catch (e: any) { showNotification(e.message, 'error'); }
    finally { setExecuting(false); }
  };

  const kitName = items.find(i => i.id === selectedKitId)?.name || '—';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold dark:text-white">الأصناف المركبة (Kitting)</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">تعريف قوائم المكونات وعمليات التجميع والتفكيك</p>
      </div>

      {/* Kit selector */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-2">اختر الصنف المركب</label>
        <select
          value={selectedKitId}
          onChange={e => setSelectedKitId(e.target.value)}
          className="w-full max-w-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
        >
          <option value="">-- اختر صنفاً --</option>
          {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>

      {selectedKitId && (
        <>
          {/* Tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 gap-4">
            {[
              { id: 'bom' as const, label: 'قائمة المكونات (BOM)' },
              { id: 'execute' as const, label: 'تنفيذ عملية' },
              { id: 'operations' as const, label: 'سجل العمليات' },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === 'bom' && (
            <div className="space-y-4">
              {canManage && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
                  <h3 className="font-semibold dark:text-white mb-3">إضافة مكوّن لـ "{kitName}"</h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <select value={bomForm.component_item_id} onChange={e => setBomForm(f => ({ ...f, component_item_id: e.target.value }))}
                      className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm col-span-2">
                      <option value="">-- اختر المكوّن --</option>
                      {items.filter(i => i.id !== selectedKitId).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    <input type="number" min="0.001" step="0.001" value={bomForm.quantity}
                      onChange={e => setBomForm(f => ({ ...f, quantity: e.target.value }))}
                      placeholder="الكمية"
                      className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono" />
                    <button onClick={() => void addBOMLine()} disabled={savingBom}
                      className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-60">
                      {savingBom ? 'جاري...' : 'إضافة'}
                    </button>
                  </div>
                </div>
              )}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="p-3 border-b border-gray-100 dark:border-gray-700 font-semibold dark:text-white">
                  مكونات "{kitName}" ({bomLines.filter(b => b.is_active).length})
                </div>
                <table className="w-full text-right text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-3">المكوّن</th>
                      <th className="px-4 py-3 text-center">الكمية المطلوبة</th>
                      <th className="px-4 py-3 text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {loading ? <tr><td colSpan={3} className="py-6 text-center text-gray-400">جاري التحميل...</td></tr>
                    : bomLines.length === 0 ? <tr><td colSpan={3} className="py-6 text-center text-gray-400">لم تُعرَّف مكونات بعد.</td></tr>
                    : bomLines.map(b => (
                      <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="px-4 py-3 dark:text-white">{b.component_name}</td>
                        <td className="px-4 py-3 text-center font-mono">{b.quantity} {b.uom_code || ''}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${b.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {b.is_active ? 'نشط' : 'غير نشط'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'execute' && canManage && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-6 max-w-md space-y-4">
              <h3 className="font-bold dark:text-white">تنفيذ عملية على "{kitName}"</h3>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">نوع العملية</label>
                <select value={execForm.operation_type} onChange={e => setExecForm(f => ({ ...f, operation_type: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
                  <option value="assemble">تجميع (consumes components → creates kit units)</option>
                  <option value="disassemble">تفكيك (removes kit units → returns components)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">المستودع</label>
                <select value={execForm.warehouse_id} onChange={e => setExecForm(f => ({ ...f, warehouse_id: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
                  <option value="">-- اختر المستودع --</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">الكمية</label>
                <input type="number" min="0.001" step="0.001" value={execForm.quantity}
                  onChange={e => setExecForm(f => ({ ...f, quantity: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono" />
              </div>
              <button onClick={() => void executeOperation()} disabled={executing}
                className={`w-full px-4 py-2 rounded-lg text-white text-sm disabled:opacity-60 ${execForm.operation_type === 'assemble' ? 'bg-blue-600' : 'bg-orange-600'}`}>
                {executing ? 'جاري التنفيذ...' : `تنفيذ ${opLabel[execForm.operation_type]}`}
              </button>
            </div>
          )}

          {activeTab === 'operations' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-3">التاريخ</th>
                    <th className="px-4 py-3">الصنف</th>
                    <th className="px-4 py-3 text-center">النوع</th>
                    <th className="px-4 py-3 text-center">الكمية</th>
                    <th className="px-4 py-3">المستودع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {operations.map(op => (
                    <tr key={op.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-4 py-3 font-mono text-xs" dir="ltr">{new Date(op.created_at).toLocaleString('ar-SA-u-nu-latn')}</td>
                      <td className="px-4 py-3 dark:text-white">{op.kit_name}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${op.operation_type === 'assemble' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                          {opLabel[op.operation_type]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-mono">{op.quantity}</td>
                      <td className="px-4 py-3 dark:text-gray-200">{op.warehouse_name}</td>
                    </tr>
                  ))}
                  {operations.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-gray-400">لا توجد عمليات.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
