import React, { useState, useMemo } from 'react';
import { useWarehouses } from '../../contexts/WarehouseContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import * as Icons from '../../components/icons';
import type { Warehouse } from '../../types';

const WarehousesScreen: React.FC = () => {
    const { warehouses, loading, addWarehouse, updateWarehouse, deleteWarehouse } = useWarehouses();
    const { hasPermission } = useAuth();
    const { showNotification } = useToast();

    const [showModal, setShowModal] = useState(false);
    const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<string>('all');
    const [filterActive, setFilterActive] = useState<string>('all');

    // Form state
    const [formData, setFormData] = useState({
        code: '',
        name: '',
        type: 'branch' as 'main' | 'branch' | 'incoming' | 'cold_storage',
        location: '',
        address: '',
        phone: '',
        capacityLimit: '',
        notes: '',
        isActive: true,
    });

    const canManage = hasPermission('stock.manage');

    // Filter warehouses
    const filteredWarehouses = useMemo(() => {
        return warehouses.filter(warehouse => {
            const matchesSearch = warehouse.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                warehouse.code.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesType = filterType === 'all' || warehouse.type === filterType;
            const matchesActive = filterActive === 'all' ||
                (filterActive === 'active' && warehouse.isActive) ||
                (filterActive === 'inactive' && !warehouse.isActive);

            return matchesSearch && matchesType && matchesActive;
        });
    }, [warehouses, searchTerm, filterType, filterActive]);

    const openAddModal = () => {
        setEditingWarehouse(null);
        setFormData({
            code: '',
            name: '',
            type: 'branch',
            location: '',
            address: '',
            phone: '',
            capacityLimit: '',
            notes: '',
            isActive: true,
        });
        setShowModal(true);
    };

    const openEditModal = (warehouse: Warehouse) => {
        setEditingWarehouse(warehouse);
        setFormData({
            code: warehouse.code,
            name: warehouse.name,
            type: warehouse.type,
            location: warehouse.location || '',
            address: warehouse.address || '',
            phone: warehouse.phone || '',
            capacityLimit: warehouse.capacityLimit?.toString() || '',
            notes: warehouse.notes || '',
            isActive: warehouse.isActive,
        });
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.code.trim() || !formData.name.trim()) {
            showNotification('يرجى إدخال الكود والاسم', 'error');
            return;
        }

        try {
            const warehouseData = {
                code: formData.code.trim().toUpperCase(),
                name: formData.name.trim(),
                type: formData.type,
                location: formData.location.trim() || undefined,
                address: formData.address.trim() || undefined,
                phone: formData.phone.trim() || undefined,
                capacityLimit: formData.capacityLimit ? parseFloat(formData.capacityLimit) : undefined,
                notes: formData.notes.trim() || undefined,
                isActive: formData.isActive,
            };

            if (editingWarehouse) {
                await updateWarehouse(editingWarehouse.id, warehouseData);
                showNotification('تم تحديث المخزن بنجاح', 'success');
            } else {
                await addWarehouse(warehouseData);
                showNotification('تم إضافة المخزن بنجاح', 'success');
            }

            setShowModal(false);
        } catch (error: any) {
            showNotification(error.message || 'حدث خطأ', 'error');
        }
    };

    const handleDelete = async (warehouse: Warehouse) => {
        if (!confirm(`هل أنت متأكد من حذف المخزن "${warehouse.name}"؟`)) {
            return;
        }

        try {
            await deleteWarehouse(warehouse.id);
            showNotification('تم حذف المخزن بنجاح', 'success');
        } catch (error: any) {
            showNotification(error.message || 'حدث خطأ', 'error');
        }
    };

    const getTypeLabel = (type: string) => {
        const labels: Record<string, string> = {
            main: 'رئيسي',
            branch: 'فرع',
            incoming: 'بضائع واردة',
            cold_storage: 'تخزين بارد',
        };
        return labels[type] || type;
    };

    const getTypeColor = (type: string) => {
        const colors: Record<string, string> = {
            main: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
            branch: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
            incoming: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
            cold_storage: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
        };
        return colors[type] || 'bg-gray-100 text-gray-800';
    };

    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold mb-2">إدارة المخازن</h1>
                <p className="text-gray-600 dark:text-gray-400">
                    إدارة المخازن والفروع المختلفة
                </p>
            </div>

            {/* Filters and Actions */}
            <div className="mb-6 flex flex-col md:flex-row gap-4">
                {/* Search */}
                <div className="flex-1">
                    <div className="relative">
                        <Icons.Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="بحث بالاسم أو الكود..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pr-10 pl-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                        />
                    </div>
                </div>

                {/* Type Filter */}
                <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                >
                    <option value="all">جميع الأنواع</option>
                    <option value="main">رئيسي</option>
                    <option value="branch">فرع</option>
                    <option value="incoming">بضائع واردة</option>
                    <option value="cold_storage">تخزين بارد</option>
                </select>

                {/* Active Filter */}
                <select
                    value={filterActive}
                    onChange={(e) => setFilterActive(e.target.value)}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                >
                    <option value="all">الكل</option>
                    <option value="active">نشط</option>
                    <option value="inactive">غير نشط</option>
                </select>

                {/* Add Button */}
                {canManage && (
                    <button
                        onClick={openAddModal}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 whitespace-nowrap"
                    >
                        <Icons.Plus className="w-5 h-5" />
                        إضافة مخزن
                    </button>
                )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">إجمالي المخازن</div>
                    <div className="text-2xl font-bold">{warehouses.length}</div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">نشط</div>
                    <div className="text-2xl font-bold text-green-600">
                        {warehouses.filter(w => w.isActive).length}
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">فروع</div>
                    <div className="text-2xl font-bold text-blue-600">
                        {warehouses.filter(w => w.type === 'branch').length}
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">تخزين بارد</div>
                    <div className="text-2xl font-bold text-cyan-600">
                        {warehouses.filter(w => w.type === 'cold_storage').length}
                    </div>
                </div>
            </div>

            {/* Warehouses List */}
            {loading ? (
                <div className="text-center py-12">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <p className="mt-2 text-gray-600 dark:text-gray-400">جاري التحميل...</p>
                </div>
            ) : filteredWarehouses.length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <Icons.Package className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                    <p className="text-gray-600 dark:text-gray-400">لا توجد مخازن</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredWarehouses.map((warehouse) => (
                        <div
                            key={warehouse.id}
                            className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
                        >
                            {/* Header */}
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h3 className="text-lg font-bold">{warehouse.name}</h3>
                                        {!warehouse.isActive && (
                                            <span className="text-xs px-2 py-1 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded">
                                                غير نشط
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">
                                        الكود: {warehouse.code}
                                    </p>
                                </div>
                                <span className={`text-xs px-2 py-1 rounded ${getTypeColor(warehouse.type)}`}>
                                    {getTypeLabel(warehouse.type)}
                                </span>
                            </div>

                            {/* Details */}
                            <div className="space-y-2 mb-4 text-sm">
                                {warehouse.location && (
                                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                                        <Icons.MapPin className="w-4 h-4" />
                                        {warehouse.location}
                                    </div>
                                )}
                                {warehouse.phone && (
                                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                                        <Icons.Phone className="w-4 h-4" />
                                        {warehouse.phone}
                                    </div>
                                )}
                                {warehouse.capacityLimit && (
                                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                                        <Icons.Package className="w-4 h-4" />
                                        السعة: {warehouse.capacityLimit.toLocaleString('en-US')}
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            {canManage && (
                                <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                                    <button
                                        onClick={() => openEditModal(warehouse)}
                                        className="flex-1 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 flex items-center justify-center gap-2"
                                    >
                                        <Icons.Edit className="w-4 h-4" />
                                        تعديل
                                    </button>
                                    <button
                                        onClick={() => handleDelete(warehouse)}
                                        className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30"
                                    >
                                        <Icons.Trash className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <h2 className="text-xl font-bold mb-4">
                                {editingWarehouse ? 'تعديل مخزن' : 'إضافة مخزن جديد'}
                            </h2>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Code */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">
                                            الكود <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.code}
                                            onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            required
                                            disabled={!!editingWarehouse}
                                        />
                                    </div>

                                    {/* Name */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">
                                            الاسم <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            required
                                        />
                                    </div>

                                    {/* Type */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">
                                            النوع <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={formData.type}
                                            onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            required
                                        >
                                            <option value="main">رئيسي</option>
                                            <option value="branch">فرع</option>
                                            <option value="incoming">بضائع واردة</option>
                                            <option value="cold_storage">تخزين بارد</option>
                                        </select>
                                    </div>

                                    {/* Phone */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">رقم الهاتف</label>
                                        <input
                                            type="tel"
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                        />
                                    </div>

                                    {/* Location */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">الموقع</label>
                                        <input
                                            type="text"
                                            value={formData.location}
                                            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                        />
                                    </div>

                                    {/* Capacity */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">السعة القصوى</label>
                                        <input
                                            type="number"
                                            value={formData.capacityLimit}
                                            onChange={(e) => setFormData({ ...formData, capacityLimit: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            min="0"
                                            step="0.01"
                                        />
                                    </div>
                                </div>

                                {/* Address */}
                                <div>
                                    <label className="block text-sm font-medium mb-1">العنوان</label>
                                    <textarea
                                        value={formData.address}
                                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                        rows={2}
                                    />
                                </div>

                                {/* Notes */}
                                <div>
                                    <label className="block text-sm font-medium mb-1">ملاحظات</label>
                                    <textarea
                                        value={formData.notes}
                                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                        rows={3}
                                    />
                                </div>

                                {/* Active */}
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="is_active"
                                        checked={formData.isActive}
                                        onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                        className="w-4 h-4"
                                    />
                                    <label htmlFor="is_active" className="text-sm font-medium">
                                        مخزن نشط
                                    </label>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="submit"
                                        className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                    >
                                        {editingWarehouse ? 'حفظ التغييرات' : 'إضافة المخزن'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowModal(false)}
                                        className="px-6 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                                    >
                                        إلغاء
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WarehousesScreen;
