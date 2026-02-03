import React, { useEffect, useState } from 'react';
import { usePurchases } from '../../contexts/PurchasesContext';
import * as Icons from '../../components/icons';
import { Supplier } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import CurrencyDualAmount from '../../components/common/CurrencyDualAmount';
import { getBaseCurrencyCode, getSupabaseClient } from '../../supabase';

const SuppliersScreen: React.FC = () => {
    const { suppliers, loading, addSupplier, updateSupplier, deleteSupplier, purchaseOrders } = usePurchases();
    const { user } = useAuth();
    const [baseCode, setBaseCode] = useState('—');
    const canManage = user?.role === 'owner' || user?.role === 'manager';
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [formData, setFormData] = useState<Partial<Supplier>>({});
    const [currencyOptions, setCurrencyOptions] = useState<string[]>([]);

    useEffect(() => {
        void getBaseCurrencyCode().then((c) => {
            if (!c) return;
            setBaseCode(c);
        });
    }, []);

    useEffect(() => {
        let active = true;
        const loadCurrencies = async () => {
            try {
                const supabase = getSupabaseClient();
                if (!supabase) return;
                const { data, error } = await supabase.from('currencies').select('code').order('code', { ascending: true });
                if (error) throw error;
                const codes = (Array.isArray(data) ? data : []).map((r: any) => String(r.code || '').toUpperCase()).filter(Boolean);
                if (active) setCurrencyOptions(codes);
            } catch {
                if (active) setCurrencyOptions([]);
            }
        };
        void loadCurrencies();
        return () => { active = false; };
    }, []);

    const supplierBalances = React.useMemo(() => {
        const map = new Map<string, Record<string, number>>();
        (purchaseOrders || []).forEach((po: any) => {
            const sid = String(po.supplierId || '');
            if (!sid) return;
            const c = String(po.currency || '').toUpperCase() || '—';
            const outstanding = (Number(po.totalAmount) || 0) - (Number(po.paidAmount) || 0);
            const prev = map.get(sid) || {};
            map.set(sid, { ...prev, [c]: (prev[c] || 0) + outstanding });
        });
        return map;
    }, [purchaseOrders]);

    const handleOpenModal = (supplier?: Supplier) => {
        if (supplier) {
            setEditingSupplier(supplier);
            setFormData(supplier);
        } else {
            setEditingSupplier(null);
            setFormData({});
        }
        setIsModalOpen(true);
    };

    const validate = (): string | null => {
        const name = (formData.name || '').trim();
        if (!name) return 'اسم المورد مطلوب';
        const email = (formData.email || '').trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'صيغة البريد الإلكتروني غير صحيحة';
        const phone = (formData.phone || '').trim();
        if (phone && !/^[0-9+\-()\s]{6,}$/.test(phone)) return 'رقم الهاتف غير صالح';
        const tax = (formData.taxNumber || '').trim();
        if (tax && !/^[0-9A-Za-z\-]+$/.test(tax)) return 'الرقم الضريبي غير صالح';
        const pref = String((formData as any).preferredCurrency || '').trim().toUpperCase();
        if (pref && currencyOptions.length > 0 && !currencyOptions.includes(pref)) return 'العملة المفضلة غير معرفة';
        return null;
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (!canManage) {
                alert('ليس لديك صلاحية لإضافة/تعديل الموردين.');
                return;
            }
            const validationError = validate();
            if (validationError) {
                alert(validationError);
                return;
            }
            if (editingSupplier) {
                await updateSupplier(editingSupplier.id, formData);
            } else {
                await addSupplier(formData as any);
            }
            setIsModalOpen(false);
        } catch (error) {
            console.error('Failed to save supplier:', error);
            alert('Failed to save supplier. Please try again.');
        }
    };

    const handleDelete = async (id: string) => {
        if (window.confirm('هل أنت متأكد من حذف هذا المورد؟')) {
            try {
                await deleteSupplier(id);
            } catch (error) {
                console.error('Failed to delete supplier:', error);
                alert('Failed to delete supplier.');
            }
        }
    };

    if (loading) return <div className="p-8 text-center text-gray-500">جاري التحميل...</div>;

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-l from-primary-600 to-gold-500">
                    إدارة الموردين
                </h1>
                {canManage && (
                    <button
                        onClick={() => handleOpenModal()}
                        className="bg-primary-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-primary-600 shadow-lg transition-transform transform hover:-translate-y-1"
                    >
                        <Icons.PlusIcon className="w-5 h-5" />
                        <span>إضافة مورد</span>
                    </button>
                )}
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-right">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">اسم المورد</th>
                                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الشخص المسؤول</th>
                                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الهاتف</th>
                                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">العنوان</th>
                                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">العملة المفضلة</th>
                                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الرصيد المستحق</th>
                                <th className="p-4 text-sm font-semibold text-gray-600 dark:text-gray-300">الإجراءات</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {suppliers.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center text-gray-500 dark:text-gray-400">
                                        لا يوجد موردين مضافين حالياً.
                                    </td>
                                </tr>
                            ) : (
                                suppliers.map((supplier) => (
                                    <tr key={supplier.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                                        <td className="p-4 font-medium dark:text-white border-r dark:border-gray-700">{supplier.name}</td>
                                        <td className="p-4 text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">{supplier.contactPerson || '-'}</td>
                                        <td className="p-4 text-gray-600 dark:text-gray-300 border-r dark:border-gray-700" dir="ltr">{supplier.phone || '-'}</td>
                                        <td className="p-4 text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">{supplier.address || '-'}</td>
                                        <td className="p-4 text-gray-600 dark:text-gray-300 border-r dark:border-gray-700 font-mono">{String((supplier as any).preferredCurrency || '') || '-'}</td>
                                        <td className="p-4 text-gray-800 dark:text-gray-200 border-r dark:border-gray-700">
                                            {(() => {
                                                const b = supplierBalances.get(supplier.id) || {};
                                                const entries = Object.entries(b).filter(([, v]) => Math.abs(Number(v || 0)) > 0.0000001);
                                                if (entries.length === 0) return <span dir="ltr" className="font-mono">0.00</span>;
                                                return (
                                                    <div className="space-y-1">
                                                        {entries.map(([c, amt]) => (
                                                            <CurrencyDualAmount key={c} amount={Number(amt || 0)} currencyCode={c} compact />
                                                        ))}
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                        <td className="p-4 flex gap-2">
                                            {canManage && (
                                                <>
                                                    <button
                                                        onClick={() => handleOpenModal(supplier)}
                                                        className="p-2 text-blue-600 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                                                        title="تعديل"
                                                    >
                                                        <Icons.EditIcon className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(supplier.id)}
                                                        className="p-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                                                        title="حذف"
                                                    >
                                                        <Icons.TrashIcon className="w-4 h-4" />
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 flex justify-between items-center">
                            <h2 className="text-xl font-bold dark:text-white">
                                {editingSupplier ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
                            </h2>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                            >
                                <Icons.XIcon className="w-6 h-6 text-gray-500" />
                            </button>
                        </div>
                        <form onSubmit={handleSave} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">اسم المورد <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    required
                                    value={formData.name || ''}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">الشخص المسؤول</label>
                                    <input
                                        type="text"
                                        value={formData.contactPerson || ''}
                                        onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                                        className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">رقم الهاتف</label>
                                    <input
                                        type="text"
                                        dir="ltr"
                                        value={formData.phone || ''}
                                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                        className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">البريد الإلكتروني</label>
                                <input
                                    type="email"
                                    dir="ltr"
                                    value={formData.email || ''}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">العملة المفضلة</label>
                                <select
                                    value={String((formData as any).preferredCurrency || '').toUpperCase()}
                                    onChange={(e) => setFormData({ ...formData, preferredCurrency: String(e.target.value || '').toUpperCase() } as any)}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                >
                                    <option value="">—</option>
                                    {currencyOptions.map((c) => (
                                        <option key={c} value={c}>{c}{baseCode && c === baseCode ? ' (أساسية)' : ''}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">الرقم الضريبي</label>
                                <input
                                    type="text"
                                    value={formData.taxNumber || ''}
                                    onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-gray-300">العنوان</label>
                                <textarea
                                    rows={3}
                                    value={formData.address || ''}
                                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white resize-none"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={!canManage}
                                className="w-full bg-primary-600 text-white font-bold py-3 rounded-xl shadow-lg hover:bg-primary-700 transition-transform transform active:scale-95 disabled:opacity-60"
                            >
                                حفظ
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SuppliersScreen;
