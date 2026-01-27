import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from '../../contexts/ToastContext';
import type { Challenge, ItemCategoryDef } from '../../types';
import ConfirmationModal from '../../components/admin/ConfirmationModal';
import { EditIcon, TrashIcon } from '../../components/icons';
import {
    getAllChallenges,
    getChallengeStats,
    createChallenge,
    updateChallenge,
    deleteChallenge,
    toggleChallengeStatus,
    findDuplicateChallenges,
    removeDuplicateChallenges,
    getChallengeParticipantCount,
    type ChallengeStats,
} from '../../utils/challengeQueries';
import { getSupabaseClient } from '../../supabase';

const ManageChallengesScreen: React.FC = () => {
    const { showNotification } = useToast();
    const language = 'ar';
    const t = (key: string) => key;

    const [challenges, setChallenges] = useState<Challenge[]>([]);
    const [stats, setStats] = useState<ChallengeStats | null>(null);
    const [categories, setCategories] = useState<ItemCategoryDef[]>([]);
    const [loading, setLoading] = useState(true);
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [currentChallenge, setCurrentChallenge] = useState<Challenge | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive' | 'expired'>('all');
    const [filterType, setFilterType] = useState<'all' | 'category_count' | 'distinct_items'>('all');
    const [participantCounts, setParticipantCounts] = useState<Record<string, number>>({});

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const [challengesData, statsData, categoriesData] = await Promise.all([
                getAllChallenges(),
                getChallengeStats(),
                loadCategories(),
            ]);
            setChallenges(challengesData);
            setStats(statsData);
            setCategories(categoriesData);

            // Load participant counts
            const counts: Record<string, number> = {};
            for (const challenge of challengesData) {
                counts[challenge.id] = await getChallengeParticipantCount(challenge.id);
            }
            setParticipantCounts(counts);
        } catch (error) {
            console.error('Error loading challenges:', error);
            showNotification('فشل تحميل التحديات', 'error');
        } finally {
            setLoading(false);
        }
    };

    const loadCategories = async (): Promise<ItemCategoryDef[]> => {
        const supabase = getSupabaseClient();
        if (!supabase) return [];

        // Fetch using 'data' JSON column mostly, similar to MenuContext to be safe
        const { data, error } = await supabase
            .from('item_categories')
            .select('id, data');

        if (error) {
            console.error('Error loading categories:', error);
            return [];
        }

        return (data || [])
            .map((row: any) => {
                const d = row.data || {};
                // If 'key' column exists it might be in row, but safer to rely on data if that's the standard
                return {
                    id: row.id,
                    key: d.key || d.id || row.id,
                    name: d.name || { ar: 'Unknown', en: 'Unknown' },
                    isActive: d.is_active !== false && d.isActive !== false, // Default true
                    createdAt: '',
                    updatedAt: '',
                };
            })
            .filter(cat => cat.isActive);
    };

    const handleOpenFormModal = (challenge: Challenge | null = null) => {
        setCurrentChallenge(challenge);
        setIsFormModalOpen(true);
    };

    const handleOpenDeleteModal = (challenge: Challenge) => {
        setCurrentChallenge(challenge);
        setIsDeleteModalOpen(true);
    };

    const handleSaveChallenge = async (challengeData: Omit<Challenge, 'id'> | Challenge) => {
        setIsProcessing(true);
        try {
            if ('id' in challengeData && challengeData.id) {
                await updateChallenge(challengeData.id, challengeData);
                showNotification('تم تحديث التحدي بنجاح', 'success');
            } else {
                await createChallenge(challengeData);
                showNotification('تمت إضافة التحدي بنجاح', 'success');
            }
            await loadData();
            setIsFormModalOpen(false);
        } catch (error) {
            console.error('Error saving challenge:', error);
            showNotification('فشل حفظ التحدي', 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDeleteChallenge = async () => {
        if (!currentChallenge) return;
        setIsProcessing(true);
        try {
            await deleteChallenge(currentChallenge.id);
            showNotification('تم حذف التحدي بنجاح', 'success');
            await loadData();
            setIsDeleteModalOpen(false);
        } catch (error) {
            console.error('Error deleting challenge:', error);
            showNotification('فشل حذف التحدي', 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleToggleStatus = async (challenge: Challenge) => {
        try {
            await toggleChallengeStatus(challenge.id);
            showNotification('تم تغيير حالة التحدي', 'success');
            await loadData();
        } catch (error) {
            console.error('Error toggling status:', error);
            showNotification('فشل تغيير الحالة', 'error');
        }
    };

    const handleRemoveDuplicates = async () => {
        setIsProcessing(true);
        try {
            const duplicates = await findDuplicateChallenges();
            if (duplicates.length === 0) {
                showNotification('لا توجد تحديات مكررة', 'info');
                setIsProcessing(false);
                return;
            }

            const totalDuplicates = duplicates.reduce((sum, group) => sum + (group.count - 1), 0);
            const confirmed = window.confirm(
                `تم العثور على ${totalDuplicates} تحديات مكررة. هل تريد حذفها؟`
            );

            if (confirmed) {
                const deletedCount = await removeDuplicateChallenges('newest');
                showNotification(
                    `تم حذف ${deletedCount} تحدي مكرر`,
                    'success'
                );
                await loadData();
            }
        } catch (error) {
            console.error('Error removing duplicates:', error);
            showNotification('فشل حذف المتكرر', 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    const filteredChallenges = useMemo(() => {
        const nowMs = Date.now();
        return challenges.filter((challenge) => {
            // Search filter
            const titleAr = (challenge.title as any)?.ar ?? '';
            const titleEn = (challenge.title as any)?.en ?? '';
            const searchLower = searchTerm.toLowerCase();
            const matchesSearch =
                titleAr.toLowerCase().includes(searchLower) ||
                titleEn.toLowerCase().includes(searchLower);

            if (!matchesSearch) return false;

            // Status filter
            if (filterStatus !== 'all') {
                const endMs = Date.parse(String(challenge.endDate || ''));
                const isExpired = Number.isFinite(endMs) && endMs <= nowMs;

                if (filterStatus === 'expired' && !isExpired) return false;
                if (filterStatus === 'active' && (challenge.status !== 'active' || isExpired)) return false;
                if (filterStatus === 'inactive' && (challenge.status !== 'inactive' || isExpired)) return false;
            }

            // Type filter
            if (filterType !== 'all' && challenge.type !== filterType) return false;

            return true;
        });
    }, [challenges, searchTerm, filterStatus, filterType]);

    const getChallengeStatusBadge = (challenge: Challenge) => {
        const nowMs = Date.now();
        const endMs = Date.parse(String(challenge.endDate || ''));
        const isExpired = Number.isFinite(endMs) && endMs <= nowMs;

        if (isExpired) {
            return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">منتهي</span>;
        }
        if (challenge.status === 'active') {
            return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-200 dark:bg-green-900 text-green-800 dark:text-green-200">نشط</span>;
        }
        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">غير نشط</span>;
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <p className="text-gray-500 dark:text-gray-400">جاري التحميل...</p>
            </div>
        );
    }

    const getChallengeTypeLabel = (type: string) => {
        if (type === 'category_count') return 'عدد طلبات من فئة';
        if (type === 'distinct_items') return 'أصناف مختلفة';
        return type;
    };

    return (
        <div className="animate-fade-in">
            {/* Header with Stats */}
            <div className="mb-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
                    <h1 className="text-3xl font-bold dark:text-white">إدارة التحديات</h1>
                    <div className="flex gap-2">
                        <button
                            onClick={handleRemoveDuplicates}
                            disabled={isProcessing}
                            className="bg-yellow-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-yellow-600 transition-colors disabled:bg-yellow-400"
                        >
                            حذف المكرر
                        </button>
                        <button
                            onClick={() => handleOpenFormModal()}
                            className="bg-primary-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-primary-600 transition-colors"
                        >
                            إضافة تحدي
                        </button>
                    </div>
                </div>

                {/* Stats Cards */}
                {stats && (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                            <p className="text-sm text-gray-500 dark:text-gray-400">إجمالي التحديات</p>
                            <p className="text-2xl font-bold text-gray-800 dark:text-white">{stats.totalChallenges}</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                            <p className="text-sm text-gray-500 dark:text-gray-400">التحديات النشطة</p>
                            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.activeChallenges}</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                            <p className="text-sm text-gray-500 dark:text-gray-400">التحديات المنتهية</p>
                            <p className="text-2xl font-bold text-gray-600 dark:text-gray-400">{stats.expiredChallenges}</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                            <p className="text-sm text-gray-500 dark:text-gray-400">التحديات المكتملة</p>
                            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.completedCount}</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                            <p className="text-sm text-gray-500 dark:text-gray-400">المشاركين</p>
                            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.participantsCount}</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                            <p className="text-sm text-gray-500 dark:text-gray-400">إجمالي المكافآت</p>
                            <p className="text-2xl font-bold text-gold-600 dark:text-gold-400">{stats.totalRewardsGiven}</p>
                        </div>
                    </div>
                )}

                {/* Filters */}
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <input
                            type="text"
                            placeholder="بحث..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                        />
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value as any)}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                        >
                            <option value="all">الكل - الحالة</option>
                            <option value="active">نشط</option>
                            <option value="inactive">غير نشط</option>
                            <option value="expired">منتهي</option>
                        </select>
                        <select
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value as any)}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                        >
                            <option value="all">الكل - نوع التحدي</option>
                            <option value="category_count">عدد طلبات من فئة</option>
                            <option value="distinct_items">أصناف مختلفة</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Challenges Table */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">عنوان التحدي</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">نوع التحدي</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الهدف</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">المكافأة</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">تاريخ الانتهاء</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">المشاركين</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الحالة</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">إجراءات</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredChallenges.map((challenge) => (
                                <tr key={challenge.id}>
                                    <td className="px-6 py-4">
                                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                                            {challenge.title['ar'] || challenge.title['en']}
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">
                                            {challenge.description['ar'] || challenge.description['en']}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                        {getChallengeTypeLabel(challenge.type)}
                                        {challenge.targetCategory && (
                                            <div className="text-xs text-gray-400">({challenge.targetCategory})</div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-bold">
                                        {challenge.targetCount}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gold-600 dark:text-gold-400 font-bold">
                                        +{challenge.rewardValue} نقطة
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                        {new Date(challenge.endDate).toLocaleDateString('ar-SA-u-nu-latn')}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                        {participantCounts[challenge.id] || 0}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {getChallengeStatusBadge(challenge)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2 rtl:space-x-reverse">
                                        <button
                                            onClick={() => handleToggleStatus(challenge)}
                                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-200 p-1"
                                            title={challenge.status === 'active' ? 'تعطيل' : 'تفعيل'}
                                        >
                                            {challenge.status === 'active' ? '⏸' : '▶'}
                                        </button>
                                        <button
                                            onClick={() => handleOpenFormModal(challenge)}
                                            className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-200 p-1"
                                        >
                                            <EditIcon />
                                        </button>
                                        <button
                                            onClick={() => handleOpenDeleteModal(challenge)}
                                            className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200 p-1"
                                        >
                                            <TrashIcon />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Challenge Form Modal */}
            <ChallengeFormModal
                isOpen={isFormModalOpen}
                onClose={() => setIsFormModalOpen(false)}
                onSave={handleSaveChallenge}
                challengeToEdit={currentChallenge}
                isSaving={isProcessing}
                categories={categories}
            />

            {/* Delete Confirmation Modal */}
            <ConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDeleteChallenge}
                title={t('confirmDeleteChallenge')}
                message={`${currentChallenge?.title[language] || ''}\n\n${t('challengeDeleteWarning')}`}
                isConfirming={isProcessing}
            />
        </div>
    );
};

// Challenge Form Modal Component
interface ChallengeFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (challenge: Omit<Challenge, 'id'> | Challenge) => Promise<void>;
    challengeToEdit: Challenge | null;
    isSaving: boolean;
    categories: ItemCategoryDef[];
}

const ChallengeFormModal: React.FC<ChallengeFormModalProps> = ({
    isOpen,
    onClose,
    onSave,
    challengeToEdit,
    isSaving,
    categories,
}) => {
    const language = 'ar';
    const t = (key: string) => key;
    const [formData, setFormData] = useState<Partial<Challenge>>({
        title: { ar: '', en: '' },
        description: { ar: '', en: '' },
        type: 'category_count',
        targetCategory: '',
        targetCount: 10,
        rewardType: 'points',
        rewardValue: 100,
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: 'active',
    });

    useEffect(() => {
        if (challengeToEdit) {
            setFormData(challengeToEdit);
        } else {
            setFormData({
                title: { ar: '', en: '' },
                description: { ar: '', en: '' },
                type: 'category_count',
                targetCategory: categories[0]?.key || '',
                targetCount: 10,
                rewardType: 'points',
                rewardValue: 100,
                startDate: new Date().toISOString().split('T')[0],
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                status: 'active',
            });
        }
    }, [challengeToEdit, isOpen, categories]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await onSave(formData as any);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[min(90dvh,calc(100dvh-2rem))] overflow-y-auto">
                <div className="p-6">
                    <h2 className="text-2xl font-bold mb-4 dark:text-white">
                        {challengeToEdit ? t('editChallenge') : t('addChallenge')}
                    </h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Title */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {t('challengeTitle')} ({language === 'ar' ? 'عربي' : 'Arabic'})
                            </label>
                            <input
                                type="text"
                                required
                                value={(formData.title as any)?.ar || ''}
                                onChange={(e) => setFormData({ ...formData, title: { ...(formData.title as any), ar: e.target.value } })}
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {t('challengeTitle')} ({language === 'ar' ? 'إنجليزي' : 'English'})
                            </label>
                            <input
                                type="text"
                                value={(formData.title as any)?.en || ''}
                                onChange={(e) => setFormData({ ...formData, title: { ...(formData.title as any), en: e.target.value } })}
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {t('challengeDescription')} ({language === 'ar' ? 'عربي' : 'Arabic'})
                            </label>
                            <textarea
                                required
                                rows={2}
                                value={(formData.description as any)?.ar || ''}
                                onChange={(e) => setFormData({ ...formData, description: { ...(formData.description as any), ar: e.target.value } })}
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {t('challengeDescription')} ({language === 'ar' ? 'إنجليزي' : 'English'})
                            </label>
                            <textarea
                                rows={2}
                                value={(formData.description as any)?.en || ''}
                                onChange={(e) => setFormData({ ...formData, description: { ...(formData.description as any), en: e.target.value } })}
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                            />
                        </div>

                        {/* Type and Category */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    {t('challengeType')}
                                </label>
                                <select
                                    value={formData.type}
                                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                                >
                                    <option value="category_count">{t('category_count')}</option>
                                    <option value="distinct_items">{t('distinct_items')}</option>
                                </select>
                            </div>
                            {formData.type === 'category_count' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        {t('targetCategory')}
                                    </label>
                                    <select
                                        value={formData.targetCategory}
                                        onChange={(e) => setFormData({ ...formData, targetCategory: e.target.value })}
                                        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                                    >
                                        {categories.map((cat) => (
                                            <option key={cat.id} value={cat.key}>
                                                {cat.name[language]}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        {/* Target Count and Reward */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    {t('targetCount')}
                                </label>
                                <input
                                    type="number"
                                    required
                                    min="1"
                                    value={formData.targetCount}
                                    onChange={(e) => setFormData({ ...formData, targetCount: parseInt(e.target.value) })}
                                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    {t('rewardValue')} ({t('points')})
                                </label>
                                <input
                                    type="number"
                                    required
                                    min="1"
                                    value={formData.rewardValue}
                                    onChange={(e) => setFormData({ ...formData, rewardValue: parseInt(e.target.value) })}
                                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                                />
                            </div>
                        </div>

                        {/* Dates */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    {t('startDate')}
                                </label>
                                <input
                                    type="date"
                                    required
                                    value={formData.startDate?.split('T')[0]}
                                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    {t('endDate')}
                                </label>
                                <input
                                    type="date"
                                    required
                                    value={formData.endDate?.split('T')[0]}
                                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                                />
                            </div>
                        </div>

                        {/* Status */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {t('status')}
                            </label>
                            <select
                                value={formData.status}
                                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                            >
                                <option value="active">{t('active')}</option>
                                <option value="inactive">{t('inactive')}</option>
                            </select>
                        </div>

                        {/* Actions */}
                        <div className="flex justify-end gap-2 pt-4">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isSaving}
                                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={isSaving}
                                className="px-4 py-2 bg-primary-500 text-white rounded-md hover:bg-primary-600 disabled:bg-primary-400"
                            >
                                {isSaving ? t('saving') : t('save')}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ManageChallengesScreen;
