import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import PageLoader from '../../components/PageLoader';
import { useToast } from '../../contexts/ToastContext';

type DeptRow = { id: string; code: string; name: string; is_active: boolean; };
type ProjectRow = { id: string; code: string; name: string; is_active: boolean; };

export default function FinancialDimensionsScreen() {
  const { showNotification } = useToast();
  const [loading, setLoading] = useState(true);
  const [depts, setDepts] = useState<DeptRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [newDept, setNewDept] = useState({ code: '', name: '' });
  const [newProject, setNewProject] = useState({ code: '', name: '' });

  const supabase = getSupabaseClient();

  const loadAll = useCallback(async () => {
    if (!supabase) return;
    const [r1, r2] = await Promise.all([
      supabase.from('departments').select('id,code,name,is_active').order('created_at', { ascending: true }),
      supabase.from('projects').select('id,code,name,is_active').order('created_at', { ascending: true }),
    ]);
    if (r1.error) throw r1.error;
    if (r2.error) throw r2.error;
    setDepts((Array.isArray(r1.data) ? r1.data : []).map((x: any) => ({ id: String(x.id), code: String(x.code), name: String(x.name), is_active: Boolean(x.is_active) })));
    setProjects((Array.isArray(r2.data) ? r2.data : []).map((x: any) => ({ id: String(x.id), code: String(x.code), name: String(x.name), is_active: Boolean(x.is_active) })));
  }, [supabase]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadAll();
      } catch (e: any) {
        showNotification(String(e?.message || 'تعذر تحميل الأبعاد المالية'), 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAll, showNotification]);

  const addDept = async () => {
    try {
      if (!supabase) return;
      if (!newDept.code.trim() || !newDept.name.trim()) {
        showNotification('كود واسم القسم مطلوبان', 'error');
        return;
      }
      const { error } = await supabase.from('departments').insert({ code: newDept.code.trim(), name: newDept.name.trim() });
      if (error) throw error;
      showNotification('تم إضافة القسم.', 'success');
      setNewDept({ code: '', name: '' });
      await loadAll();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر إضافة القسم'), 'error');
    }
  };

  const addProject = async () => {
    try {
      if (!supabase) return;
      if (!newProject.code.trim() || !newProject.name.trim()) {
        showNotification('كود واسم المشروع مطلوبان', 'error');
        return;
      }
      const { error } = await supabase.from('projects').insert({ code: newProject.code.trim(), name: newProject.name.trim() });
      if (error) throw error;
      showNotification('تم إضافة المشروع.', 'success');
      setNewProject({ code: '', name: '' });
      await loadAll();
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر إضافة المشروع'), 'error');
    }
  };

  if (loading) return <PageLoader />;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold dark:text-white">الأبعاد المالية (الأقسام/المشاريع)</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
          <div className="font-semibold mb-3 text-gray-700 dark:text-gray-200">الأقسام</div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <input value={newDept.code} onChange={e => setNewDept({ ...newDept, code: e.target.value })} placeholder="الكود" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
            <input value={newDept.name} onChange={e => setNewDept({ ...newDept, name: e.target.value })} placeholder="الاسم" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
            <button type="button" onClick={() => void addDept()} className="px-4 py-2 rounded bg-emerald-600 text-white font-semibold">إضافة قسم</button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[620px] w-full text-right">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">الكود</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">الاسم</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {depts.map(d => (
                  <tr key={d.id} className="border-t dark:border-gray-700">
                    <td className="p-2 text-sm">{d.code}</td>
                    <td className="p-2 text-sm">{d.name}</td>
                    <td className="p-2 text-xs">{d.is_active ? 'فعّال' : 'موقّف'}</td>
                  </tr>
                ))}
                {depts.length === 0 && <tr><td colSpan={3} className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">لا توجد أقسام.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
          <div className="font-semibold mb-3 text-gray-700 dark:text-gray-200">المشاريع</div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <input value={newProject.code} onChange={e => setNewProject({ ...newProject, code: e.target.value })} placeholder="الكود" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
            <input value={newProject.name} onChange={e => setNewProject({ ...newProject, name: e.target.value })} placeholder="الاسم" className="px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
            <button type="button" onClick={() => void addProject()} className="px-4 py-2 rounded bg-emerald-600 text-white font-semibold">إضافة مشروع</button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[620px] w-full text-right">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">الكود</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">الاسم</th>
                  <th className="p-2 text-xs font-semibold text-gray-600 dark:text-gray-300">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(p => (
                  <tr key={p.id} className="border-t dark:border-gray-700">
                    <td className="p-2 text-sm">{p.code}</td>
                    <td className="p-2 text-sm">{p.name}</td>
                    <td className="p-2 text-xs">{p.is_active ? 'فعّال' : 'موقّف'}</td>
                  </tr>
                ))}
                {projects.length === 0 && <tr><td colSpan={3} className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">لا توجد مشاريع.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

