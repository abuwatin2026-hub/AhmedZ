import React, { useState, useEffect } from 'react';
import { getSupabaseClient } from '../../supabase';
import { CostCenter } from '../../types';
import { useToast } from '../../contexts/ToastContext';

const ManageCostCentersScreen: React.FC = () => {
    const { showNotification } = useToast();
    const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Form State
    const [formData, setFormData] = useState<Partial<CostCenter>>({
        name: '',
        code: '',
        description: '',
        isActive: true
    });

    useEffect(() => {
        fetchCostCenters();
    }, []);

    const fetchCostCenters = async () => {
        setLoading(true);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;

            const { data, error } = await supabase
                .from('cost_centers')
                .select('*')
                .order('name');

            if (error) throw error;
            setCostCenters(data || []);
        } catch (error) {
            console.error('Error fetching cost centers:', error);
            showNotification('فشل تحميل مراكز التكلفة', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (cc?: CostCenter) => {
        if (cc) {
            setEditingId(cc.id);
            setFormData({
                name: cc.name,
                code: cc.code,
                description: cc.description,
                isActive: cc.isActive
            });
        } else {
            setEditingId(null);
            setFormData({
                name: '',
                code: '',
                description: '',
                isActive: true
            });
        }
        setIsModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;

            if (!formData.name) {
                showNotification('يرجى إدخال اسم المركز', 'error');
                return;
            }

            const payload = {
                name: formData.name,
                code: formData.code,
                description: formData.description,
                is_active: formData.isActive
            };

            let error;
            if (editingId) {
                const { error: updateError } = await supabase
                    .from('cost_centers')
                    .update(payload)
                    .eq('id', editingId);
                error = updateError;
            } else {
                const { error: insertError } = await supabase
                    .from('cost_centers')
                    .insert(payload);
                error = insertError;
            }

            if (error) throw error;

            showNotification(editingId ? 'تم تحديث المركز بنجاح' : 'تم إضافة المركز بنجاح', 'success');
            setIsModalOpen(false);
            fetchCostCenters();
        } catch (error: any) {
            console.error('Error saving cost center:', error);
            showNotification(error.message || 'فشل حفظ المركز', 'error');
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('هل أنت متأكد من حذف هذا المركز؟ قد لا يتم الحذف إذا كان مستخدماً.')) return;
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;
            const { error } = await supabase.from('cost_centers').delete().eq('id', id);
            if (error) throw error;
            showNotification('تم حذف المركز', 'success');
            fetchCostCenters();
        } catch (error: any) {
            const msg = error?.message || 'فشل حذف المركز';
            showNotification(msg, 'error');
        }
    };

    return (
        <div className="animate-fade-in p-4">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold dark:text-white">إدارة مراكز التكلفة</h1>
                <button
                    onClick={() => handleOpenModal()}
                    className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                >
                    <span>+ إضافة مركز تكلفة</span>
                </button>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <table className="min-w-full text-right">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                            <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300">الاسم</th>
                            <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300">الكود</th>
                            <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300">الوصف</th>
                            <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300">الحالة</th>
                            <th className="p-3 text-sm font-semibold text-gray-600 dark:text-gray-300">الإجراءات</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {loading ? (
                            <tr><td colSpan={5} className="p-4 text-center dark:text-gray-300">جاري التحميل...</td></tr>
                        ) : costCenters.length === 0 ? (
                            <tr><td colSpan={5} className="p-4 text-center text-gray-500 dark:text-gray-400">لا توجد مراكز تكلفة.</td></tr>
                        ) : (
                            costCenters.map(cc => (
                                <tr key={cc.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                                    <td className="p-3 dark:text-gray-300 font-medium">{cc.name}</td>
                                    <td className="p-3 dark:text-gray-300 font-mono text-sm">{cc.code || '-'}</td>
                                    <td className="p-3 dark:text-gray-400 text-sm">{cc.description || '-'}</td>
                                    <td className="p-3">
                                        <span className={`px-2 py-1 rounded text-xs ${cc.isActive ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}>
                                            {cc.isActive ? 'نشط' : 'غير نشط'}
                                        </span>
                                    </td>
                                    <td className="p-3 flex gap-2">
                                        <button onClick={() => handleOpenModal(cc)} className="text-blue-600 hover:text-blue-800 text-sm">تعديل</button>
                                        <button onClick={() => handleDelete(cc.id)} className="text-red-600 hover:text-red-800 text-sm">حذف</button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6 animate-fade-in-up">
                        <h2 className="text-xl font-bold mb-4 dark:text-white">{editingId ? 'تعديل مركز تكلفة' : 'إضافة مركز تكلفة'}</h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">اسم المركز *</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="مثال: الفرع الرئيسي، المستودع"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">الكود (اختياري)</label>
                                <input
                                    type="text"
                                    value={formData.code || ''}
                                    onChange={e => setFormData({ ...formData, code: e.target.value })}
                                    className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="مثال: MAIN, KIT"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">الوصف (اختياري)</label>
                                <textarea
                                    value={formData.description || ''}
                                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                                    className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    rows={3}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    id="isActive"
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                                    className="w-4 h-4"
                                />
                                <label htmlFor="isActive" className="text-sm font-medium dark:text-gray-300">نشط</label>
                            </div>
                            <div className="flex justify-end gap-2 pt-4">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200">إلغاء</button>
                                <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700">حفظ</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManageCostCentersScreen;
