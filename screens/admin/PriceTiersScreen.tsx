import React, { useState, useMemo } from 'react';
import { usePricing } from '../../contexts/PricingContext';
import { useMenu } from '../../contexts/MenuContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import * as Icons from '../../components/icons';
import type { PriceTier, CustomerType } from '../../types';

const PriceTiersScreen: React.FC = () => {
    const { priceTiers, addPriceTier, updatePriceTier, deletePriceTier } = usePricing();
    const { menuItems } = useMenu();
    const { hasPermission } = useAuth();
    const { showNotification } = useToast();

    const [showModal, setShowModal] = useState(false);
    const [editingTier, setEditingTier] = useState<PriceTier | null>(null);
    const [selectedItem, setSelectedItem] = useState<string>('all');
    const [selectedType, setSelectedType] = useState<string>('all');

    // Form state
    const [formData, setFormData] = useState({
        itemId: '',
        customerType: 'wholesale' as CustomerType,
        minQuantity: '',
        maxQuantity: '',
        price: '',
        discountPercentage: '',
        isActive: true,
        validFrom: '',
        validTo: '',
        notes: '',
    });

    const canManage = hasPermission('prices.manage');

    // Filter tiers
    const filteredTiers = useMemo(() => {
        return priceTiers.filter(tier => {
            const matchesItem = selectedItem === 'all' || tier.itemId === selectedItem;
            const matchesType = selectedType === 'all' || tier.customerType === selectedType;
            return matchesItem && matchesType;
        });
    }, [priceTiers, selectedItem, selectedType]);

    // Group tiers by item
    const tiersByItem = useMemo(() => {
        const grouped: Record<string, PriceTier[]> = {};
        filteredTiers.forEach(tier => {
            if (!grouped[tier.itemId]) {
                grouped[tier.itemId] = [];
            }
            grouped[tier.itemId].push(tier);
        });
        return grouped;
    }, [filteredTiers]);

    const openAddModal = (itemId?: string) => {
        setEditingTier(null);
        setFormData({
            itemId: itemId || '',
            customerType: 'wholesale',
            minQuantity: '',
            maxQuantity: '',
            price: '',
            discountPercentage: '',
            isActive: true,
            validFrom: '',
            validTo: '',
            notes: '',
        });
        setShowModal(true);
    };

    const openEditModal = (tier: PriceTier) => {
        setEditingTier(tier);
        setFormData({
            itemId: tier.itemId,
            customerType: tier.customerType,
            minQuantity: tier.minQuantity.toString(),
            maxQuantity: tier.maxQuantity?.toString() || '',
            price: tier.price.toString(),
            discountPercentage: tier.discountPercentage?.toString() || '',
            isActive: tier.isActive,
            validFrom: tier.validFrom || '',
            validTo: tier.validTo || '',
            notes: tier.notes || '',
        });
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.itemId || !formData.minQuantity || !formData.price) {
            showNotification('يرجى إدخال البيانات المطلوبة', 'error');
            return;
        }

        try {
            const tierData = {
                itemId: formData.itemId,
                customerType: formData.customerType,
                minQuantity: parseFloat(formData.minQuantity),
                maxQuantity: formData.maxQuantity ? parseFloat(formData.maxQuantity) : undefined,
                price: parseFloat(formData.price),
                discountPercentage: formData.discountPercentage ? parseFloat(formData.discountPercentage) : undefined,
                isActive: formData.isActive,
                validFrom: formData.validFrom || undefined,
                validTo: formData.validTo || undefined,
                notes: formData.notes || undefined,
            };

            if (editingTier) {
                await updatePriceTier(editingTier.id, tierData);
                showNotification('تم تحديث الشريحة بنجاح', 'success');
            } else {
                await addPriceTier(tierData);
                showNotification('تم إضافة الشريحة بنجاح', 'success');
            }

            setShowModal(false);
        } catch (error: any) {
            showNotification(error.message || 'حدث خطأ', 'error');
        }
    };

    const handleDelete = async (tier: PriceTier) => {
        if (!confirm('هل أنت متأكد من حذف هذه الشريحة؟')) {
            return;
        }

        try {
            await deletePriceTier(tier.id);
            showNotification('تم حذف الشريحة بنجاح', 'success');
        } catch (error: any) {
            showNotification(error.message || 'حدث خطأ', 'error');
        }
    };

    const getTypeLabel = (type: CustomerType) => {
        const labels: Record<CustomerType, string> = {
            retail: 'تجزئة',
            wholesale: 'جملة',
            distributor: 'موزع',
            vip: 'VIP',
        };
        return labels[type];
    };

    const getTypeColor = (type: CustomerType) => {
        const colors: Record<CustomerType, string> = {
            retail: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
            wholesale: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
            distributor: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
            vip: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        };
        return colors[type];
    };

    const getItemName = (itemId: string) => {
        const item = menuItems.find(i => i.id === itemId);
        return item?.name.ar || itemId;
    };

    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold mb-2">شرائح الأسعار</h1>
                <p className="text-gray-600 dark:text-gray-400">
                    إدارة الأسعار حسب نوع العميل والكمية
                </p>
            </div>

            {/* Filters and Actions */}
            <div className="mb-6 flex flex-col md:flex-row gap-4">
                {/* Item Filter */}
                <select
                    value={selectedItem}
                    onChange={(e) => setSelectedItem(e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                >
                    <option value="all">جميع الأصناف</option>
                    {menuItems.map(item => (
                        <option key={item.id} value={item.id}>{item.name.ar}</option>
                    ))}
                </select>

                {/* Type Filter */}
                <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                >
                    <option value="all">جميع الأنواع</option>
                    <option value="retail">تجزئة</option>
                    <option value="wholesale">جملة</option>
                    <option value="distributor">موزع</option>
                    <option value="vip">VIP</option>
                </select>

                {/* Add Button */}
                {canManage && (
                    <button
                        onClick={() => openAddModal()}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 whitespace-nowrap"
                    >
                        <Icons.Plus className="w-5 h-5" />
                        إضافة شريحة
                    </button>
                )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">إجمالي الشرائح</div>
                    <div className="text-2xl font-bold">{priceTiers.length}</div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">جملة</div>
                    <div className="text-2xl font-bold text-green-600">
                        {priceTiers.filter(t => t.customerType === 'wholesale').length}
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">موزع</div>
                    <div className="text-2xl font-bold text-purple-600">
                        {priceTiers.filter(t => t.customerType === 'distributor').length}
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">نشط</div>
                    <div className="text-2xl font-bold text-blue-600">
                        {priceTiers.filter(t => t.isActive).length}
                    </div>
                </div>
            </div>

            {/* Tiers List */}
            {Object.keys(tiersByItem).length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <Icons.DollarSign className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                    <p className="text-gray-600 dark:text-gray-400">لا توجد شرائح أسعار</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {Object.entries(tiersByItem).map(([itemId, tiers]) => (
                        <div key={itemId} className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
                            {/* Item Header */}
                            <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                                <h3 className="text-lg font-bold">{getItemName(itemId)}</h3>
                                {canManage && (
                                    <button
                                        onClick={() => openAddModal(itemId)}
                                        className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                    >
                                        <Icons.Plus className="w-4 h-4" />
                                        إضافة شريحة
                                    </button>
                                )}
                            </div>

                            {/* Tiers Table */}
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="text-right text-sm text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                                            <th className="pb-2">النوع</th>
                                            <th className="pb-2">من</th>
                                            <th className="pb-2">إلى</th>
                                            <th className="pb-2">السعر</th>
                                            <th className="pb-2">الخصم</th>
                                            <th className="pb-2">الحالة</th>
                                            {canManage && <th className="pb-2">إجراءات</th>}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tiers.sort((a, b) => {
                                            if (a.customerType !== b.customerType) {
                                                return a.customerType.localeCompare(b.customerType);
                                            }
                                            return a.minQuantity - b.minQuantity;
                                        }).map(tier => (
                                            <tr key={tier.id} className="border-b border-gray-100 dark:border-gray-700/50">
                                                <td className="py-3">
                                                    <span className={`text-xs px-2 py-1 rounded ${getTypeColor(tier.customerType)}`}>
                                                        {getTypeLabel(tier.customerType)}
                                                    </span>
                                                </td>
                                                <td className="py-3">{tier.minQuantity}</td>
                                                <td className="py-3">{tier.maxQuantity || '∞'}</td>
                                                <td className="py-3 font-medium">{tier.price.toLocaleString()} ر.ي</td>
                                                <td className="py-3">{tier.discountPercentage ? `${tier.discountPercentage}%` : '-'}</td>
                                                <td className="py-3">
                                                    {tier.isActive ? (
                                                        <span className="text-xs px-2 py-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded">
                                                            نشط
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs px-2 py-1 bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200 rounded">
                                                            غير نشط
                                                        </span>
                                                    )}
                                                </td>
                                                {canManage && (
                                                    <td className="py-3">
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => openEditModal(tier)}
                                                                className="text-blue-600 hover:text-blue-700"
                                                            >
                                                                <Icons.Edit className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(tier)}
                                                                className="text-red-600 hover:text-red-700"
                                                            >
                                                                <Icons.Trash className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
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
                                {editingTier ? 'تعديل شريحة سعر' : 'إضافة شريحة سعر'}
                            </h2>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Item */}
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-medium mb-1">
                                            الصنف <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={formData.itemId}
                                            onChange={(e) => setFormData({ ...formData, itemId: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            required
                                            disabled={!!editingTier}
                                        >
                                            <option value="">اختر الصنف</option>
                                            {menuItems.map(item => (
                                                <option key={item.id} value={item.id}>{item.name.ar}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Customer Type */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">
                                            نوع العميل <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={formData.customerType}
                                            onChange={(e) => setFormData({ ...formData, customerType: e.target.value as CustomerType })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            required
                                        >
                                            <option value="retail">تجزئة</option>
                                            <option value="wholesale">جملة</option>
                                            <option value="distributor">موزع</option>
                                            <option value="vip">VIP</option>
                                        </select>
                                    </div>

                                    {/* Price */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">
                                            السعر <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="number"
                                            value={formData.price}
                                            onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            min="0"
                                            step="0.01"
                                            required
                                        />
                                    </div>

                                    {/* Min Quantity */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">
                                            الكمية من <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="number"
                                            value={formData.minQuantity}
                                            onChange={(e) => setFormData({ ...formData, minQuantity: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            min="0"
                                            step="0.01"
                                            required
                                        />
                                    </div>

                                    {/* Max Quantity */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">الكمية إلى</label>
                                        <input
                                            type="number"
                                            value={formData.maxQuantity}
                                            onChange={(e) => setFormData({ ...formData, maxQuantity: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            min="0"
                                            step="0.01"
                                            placeholder="غير محدود"
                                        />
                                    </div>

                                    {/* Discount */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">نسبة الخصم %</label>
                                        <input
                                            type="number"
                                            value={formData.discountPercentage}
                                            onChange={(e) => setFormData({ ...formData, discountPercentage: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                            min="0"
                                            max="100"
                                            step="0.01"
                                        />
                                    </div>

                                    {/* Valid From */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">صالح من</label>
                                        <input
                                            type="date"
                                            value={formData.validFrom}
                                            onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                        />
                                    </div>

                                    {/* Valid To */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">صالح إلى</label>
                                        <input
                                            type="date"
                                            value={formData.validTo}
                                            onChange={(e) => setFormData({ ...formData, validTo: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                        />
                                    </div>
                                </div>

                                {/* Notes */}
                                <div>
                                    <label className="block text-sm font-medium mb-1">ملاحظات</label>
                                    <textarea
                                        value={formData.notes}
                                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                                        rows={2}
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
                                        شريحة نشطة
                                    </label>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="submit"
                                        className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                    >
                                        {editingTier ? 'حفظ التغييرات' : 'إضافة الشريحة'}
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

export default PriceTiersScreen;
