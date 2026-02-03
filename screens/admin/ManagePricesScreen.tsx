import React, { useState, useMemo } from 'react';
import { useMenu } from '../../contexts/MenuContext';
import { usePriceHistory } from '../../contexts/PriceContext';
import type { MenuItem, PriceHistory } from '../../types';
import { useItemMeta } from '../../contexts/ItemMetaContext';
import { useToast } from '../../contexts/ToastContext';
import { useSettings } from '../../contexts/SettingsContext';
import CurrencyDualAmount from '../../components/common/CurrencyDualAmount';

const ManagePricesScreen: React.FC = () => {
    const { menuItems } = useMenu();
    const { updatePrice, getPriceHistoryByItemId } = usePriceHistory();
    const { settings } = useSettings();
    const { categories: categoryDefs, getCategoryLabel, getUnitLabel } = useItemMeta();
    const { showNotification } = useToast();
    const baseCode = String((settings as any)?.baseCurrency || '').toUpperCase();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [selectedItem, setSelectedItem] = useState<string | null>(null);
    const [newPrice, setNewPrice] = useState('');
    const [reason, setReason] = useState('');

    // Get unique categories
    const categories = useMemo(() => {
        const activeKeys = categoryDefs.filter(c => c.isActive).map(c => c.key);
        const usedKeys = [...new Set(menuItems.map((item: MenuItem) => item.category))].filter(Boolean);
        const merged = Array.from(new Set([...activeKeys, ...usedKeys])).sort((a, b) => a.localeCompare(b));
        return ['all', ...merged];
    }, [categoryDefs, menuItems]);

    // Filter items
    const filteredItems = useMemo(() => {
        return menuItems.filter((item: MenuItem) => {
            const itemName = item.name['ar'] || '';
            const matchesSearch = itemName.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
            return matchesSearch && matchesCategory && item.status === 'active';
        });
    }, [menuItems, searchTerm, selectedCategory]);

    const handleUpdatePrice = async (itemId: string) => {
        const price = parseFloat(newPrice);
        if (!(price > 0)) return;
        if (!reason.trim()) {
            showNotification('سبب تعديل السعر مطلوب.', 'error');
            return;
        }
        try {
            await updatePrice(itemId, price, reason);
            setSelectedItem(null);
            setNewPrice('');
            setReason('');
            showNotification('تم تحديث السعر', 'success');
        } catch (error) {
            const raw = error instanceof Error ? error.message : '';
            const message = raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل تحديث السعر';
            showNotification(message, 'error');
        }
    };

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                    إدارة الأسعار
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                    تحديث أسعار المنتجات وعرض تاريخ التغييرات
                </p>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            البحث
                        </label>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="ابحث عن منتج..."
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-gold-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            الفئة
                        </label>
                        <select
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-gold-500"
                        >
                            <option value="all">الكل</option>
                            {categories.filter(c => c !== 'all').map((cat: string) => (
                                <option key={cat} value={cat}>{getCategoryLabel(cat, 'ar')}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Prices Table */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-900">
                            <tr>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    المنتج
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    السعر الحالي
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    الوحدة
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    آخر تحديث
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    إجراءات
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredItems.map((item: MenuItem) => {
                                const history = getPriceHistoryByItemId(item.id);
                                const lastUpdate = history[0];
                                const isEditing = selectedItem === item.id;
                                const itemName = item.name['ar'] || '';

                                return (
                                    <React.Fragment key={item.id}>
                                        <tr>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center">
                                                    <img src={item.imageUrl || undefined} alt={itemName} className="w-10 h-10 rounded-md object-cover" />
                                                    <div className="mr-4 rtl:mr-0 rtl:ml-4">
                                                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                                                            {itemName}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="text-gold-600 dark:text-gold-400">
                                                    <CurrencyDualAmount amount={Number(item.price || 0)} currencyCode={baseCode} compact />
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                                {getUnitLabel(item.unitType as any, 'ar')}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                                {lastUpdate ? new Date(lastUpdate.date).toLocaleDateString('ar-SA-u-nu-latn') : '-'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <button
                                                    onClick={() => {
                                                        setSelectedItem(item.id);
                                                        setNewPrice(item.price.toString());
                                                    }}
                                                    className="text-gold-600 hover:text-gold-800 dark:text-gold-400 dark:hover:text-gold-300 font-medium"
                                                >
                                                    تحديث السعر
                                                </button>
                                            </td>
                                        </tr>
                                        {isEditing && (
                                            <tr className="bg-gold-50 dark:bg-gold-900/10">
                                                <td colSpan={5} className="px-6 py-4">
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                        <div>
                                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                                السعر الجديد
                                                            </label>
                                                            <input
                                                                type="number"
                                                                value={newPrice}
                                                                onChange={(e) => setNewPrice(e.target.value)}
                                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                                step="0.01"
                                                                min="0"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                                سبب التغيير (اختياري)
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={reason}
                                                                onChange={(e) => setReason(e.target.value)}
                                                                placeholder="مثال: ارتفاع الأسعار"
                                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                            />
                                                        </div>
                                                        <div className="flex items-end gap-2">
                                                            <button
                                                                onClick={() => handleUpdatePrice(item.id)}
                                                                className="flex-1 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition"
                                                            >
                                                                حفظ
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    setSelectedItem(null);
                                                                    setNewPrice('');
                                                                    setReason('');
                                                                }}
                                                                className="flex-1 bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition"
                                                            >
                                                                إلغاء
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {history.length > 0 && (
                                                        <div className="mt-4">
                                                            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                                تاريخ التغييرات
                                                            </h4>
                                                            <div className="space-y-2">
                                                                {history.slice(0, 5).map((h: PriceHistory) => (
                                                                    <div key={h.id} className="flex items-center justify-between text-sm bg-white dark:bg-gray-800 p-2 rounded">
                                                                        <span className="text-gray-600 dark:text-gray-400">
                                                                            {new Date(h.date).toLocaleString('ar-SA-u-nu-latn')}
                                                                        </span>
                                                                        <span className="text-gray-900 dark:text-white">
                                                                            <CurrencyDualAmount amount={Number(h.price || 0)} currencyCode={baseCode} compact />
                                                                        </span>
                                                                        {h.reason && (
                                                                            <span className="text-gray-500 dark:text-gray-400 italic">
                                                                                {h.reason}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {filteredItems.length === 0 && (
                    <div className="text-center py-12">
                        <p className="text-gray-500 dark:text-gray-400">
                            لا توجد منتجات
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ManagePricesScreen;
