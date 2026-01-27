import React, { useState, useMemo } from 'react';
import { useReviews } from '../../contexts/ReviewContext';
import { useMenu } from '../../contexts/MenuContext';
import { useToast } from '../../contexts/ToastContext';
import { Review } from '../../types';
import StarRating from '../../components/StarRating';
import ConfirmationModal from '../../components/admin/ConfirmationModal';
import { TrashIcon } from '../../components/icons';
import Spinner from '../../components/Spinner';
import { exportToXlsx, sharePdf } from '../../utils/export';
import { buildPdfBrandOptions, buildXlsxBrandOptions } from '../../utils/branding';
import { useSettings } from '../../contexts/SettingsContext';

const ManageReviewsScreen: React.FC = () => {
    const { reviews, deleteReview, loading } = useReviews();
    const { menuItems, getMenuItemById } = useMenu();
    const { showNotification } = useToast();
    const { settings } = useSettings();
    
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [reviewToDelete, setReviewToDelete] = useState<Review | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    
    const [menuItemFilter, setMenuItemFilter] = useState('all');
    const [ratingFilter, setRatingFilter] = useState('all');
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

    const handleOpenDeleteModal = (review: Review) => {
        setReviewToDelete(review);
        setIsDeleteModalOpen(true);
    };

    const handleDeleteReview = async () => {
        if (reviewToDelete) {
            setIsProcessing(true);
            await deleteReview(reviewToDelete.id);
            showNotification('تم حذف التقييم بنجاح!', 'success');
            setIsProcessing(false);
        }
        setIsDeleteModalOpen(false);
    };
    
    const filteredAndSortedReviews = useMemo(() => {
        let processedReviews = [...reviews];

        if (menuItemFilter !== 'all') {
            processedReviews = processedReviews.filter(r => r.menuItemId === menuItemFilter);
        }
        if (ratingFilter !== 'all') {
            processedReviews = processedReviews.filter(r => r.rating === parseInt(ratingFilter, 10));
        }

        processedReviews.sort((a, b) => {
            const dateA = new Date(a.createdAt).getTime();
            const dateB = new Date(b.createdAt).getTime();
            return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
        });
        
        return processedReviews;
    }, [reviews, menuItemFilter, ratingFilter, sortOrder]);
    
    const handleExport = async () => {
        const headers = ['المنتج', 'العميل', 'التقييم', 'التعليق', 'التاريخ'];
        const rows = filteredAndSortedReviews.map(r => {
            const menuItem = getMenuItemById(r.menuItemId);
            const menuItemName = menuItem ? (menuItem.name.ar || '') : '';
            return [
                menuItemName || r.menuItemId,
                r.userName,
                r.rating,
                r.comment || '',
                new Date(r.createdAt).toLocaleDateString('ar-SA-u-nu-latn'),
            ];
        });
        const success = await exportToXlsx(
            headers, 
            rows, 
            `reviews_report_${new Date().toISOString().split('T')[0]}.xlsx`,
            { sheetName: 'Reviews', ...buildXlsxBrandOptions(settings, 'التقييمات', headers.length, { periodText: `التاريخ: ${new Date().toLocaleDateString('ar-SA-u-nu-latn')}` }) }
        );
        if(success) {
            showNotification(`تم حفظ التقرير في مجلد المستندات`, 'success');
        } else {
            showNotification('فشل تصدير الملف. تأكد من منح التطبيق صلاحيات الوصول للملفات.', 'error');
        }
    };
    
    const handleSharePdf = async () => {
        setIsSharing(true);
        const success = await sharePdf(
            'print-area',
            'إدارة التقييمات',
            `reviews_report_${new Date().toISOString().split('T')[0]}.pdf`,
            buildPdfBrandOptions(settings, 'إدارة التقييمات', { pageNumbers: true })
        );
        if (success) {
            showNotification('تم حفظ التقرير في مجلد المستندات', 'success');
        } else {
            showNotification('فشل مشاركة الملف. تأكد من منح التطبيق الصلاحيات اللازمة.', 'error');
        }
        setIsSharing(false);
    };

    const menuItemsWithReviews = useMemo(() => {
        const itemIdsWithReviews = new Set(reviews.map(r => r.menuItemId));
        return menuItems.filter(item => itemIdsWithReviews.has(item.id));
    }, [reviews, menuItems]);

    return (
        <div className="animate-fade-in">
             <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                <h1 className="text-3xl font-bold dark:text-white">إدارة التقييمات</h1>
                <div className="flex gap-2 flex-wrap justify-center">
                     <button onClick={handleSharePdf} disabled={isSharing} className="bg-red-600 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-red-700 transition disabled:bg-gray-400">
                        {isSharing ? 'جاري التحميل...' : 'مشاركة PDF'}
                    </button>
                    <button onClick={handleExport} className="bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-green-700 transition">تصدير Excel</button>
                </div>
            </div>

            <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label htmlFor="menuItemFilter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">فلترة حسب الصنف</label>
                        <select id="menuItemFilter" value={menuItemFilter} onChange={e => setMenuItemFilter(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition">
                            <option value="all">الكل</option>
                            {menuItemsWithReviews.map(item => <option key={item.id} value={item.id}>{item.name.ar || ''}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="ratingFilter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">فلترة حسب التقييم</label>
                        <select id="ratingFilter" value={ratingFilter} onChange={e => setRatingFilter(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition">
                            <option value="all">الكل</option>
                            {[5, 4, 3, 2, 1].map(star => <option key={star} value={star}>{star} نجوم</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="sortOrder" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ترتيب حسب</label>
                        <select id="sortOrder" value={sortOrder} onChange={e => setSortOrder(e.target.value as 'newest' | 'oldest')} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition">
                            <option value="newest">الأحدث أولاً</option>
                            <option value="oldest">الأقدم أولاً</option>
                        </select>
                    </div>
                </div>
            </div>
            
            <div id="print-area">
                <div className="print-only mb-4">
                    <div className="flex items-center gap-3 mb-2">
                        {settings.logoUrl ? <img src={settings.logoUrl} alt="" className="h-10 w-auto" /> : null}
                        <div className="leading-tight">
                            <div className="font-bold text-black">{settings.cafeteriaName?.ar || settings.cafeteriaName?.en || ''}</div>
                            <div className="text-xs text-black">{[settings.address || '', settings.contactNumber || ''].filter(Boolean).join(' • ')}</div>
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-black">إدارة التقييمات</h2>
                    <p className="text-base text-black mt-1">التاريخ: {new Date().toLocaleDateString('ar-SA-u-nu-latn')}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r dark:border-gray-700">المنتج</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r dark:border-gray-700">العميل</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r dark:border-gray-700">التقييم</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r dark:border-gray-700">التعليق</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">إجراءات</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                               {loading ? (
                                    <tr>
                                        <td colSpan={5} className="text-center py-16">
                                            <div className="flex justify-center items-center space-x-2 rtl:space-x-reverse text-gray-500 dark:text-gray-400">
                                                <Spinner /> 
                                                <span>جاري تحميل التقييمات...</span>
                                            </div>
                                        </td>
                                    </tr>
                               ) : filteredAndSortedReviews.length > 0 ? (
                                    filteredAndSortedReviews.map(review => {
                                        const menuItem = getMenuItemById(review.menuItemId);
                                        const menuItemName = menuItem ? (menuItem.name.ar || '') : '';
                                        return (
                                        <tr key={review.id}>
                                            <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                                <div className="flex items-center">
                                                    <img src={menuItem?.imageUrl || undefined} alt="" className="w-12 h-12 object-cover rounded-md flex-shrink-0" />
                                                    <div className="mx-3">
                                                        <div className="text-sm font-medium text-gray-900 dark:text-white">{menuItemName}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                                <div className="text-sm text-gray-900 dark:text-white">{review.userName}</div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{new Date(review.createdAt).toLocaleDateString('ar-SA-u-nu-latn')}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap border-r dark:border-gray-700">
                                                <StarRating rating={review.rating} />
                                            </td>
                                            <td className="px-6 py-4 border-r dark:border-gray-700">
                                                <p className="text-sm text-gray-600 dark:text-gray-400 max-w-xs break-words">{review.comment || '-'}</p>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                <button onClick={() => handleOpenDeleteModal(review)} title="حذف التقييم" className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200 p-1">
                                                    <TrashIcon />
                                                </button>
                                            </td>
                                        </tr>
                                        );
                                    })
                               ) : (
                                    <tr>
                                        <td colSpan={5} className="text-center py-16 text-gray-500 dark:text-gray-400">
                                            <p className="font-semibold text-lg">
                                                {reviews.length === 0 ? 'لا توجد أي تقييمات حتى الآن.' : 'لا توجد تقييمات تطابق الفلاتر المحددة.'}
                                            </p>
                                        </td>
                                    </tr>
                               )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            
             <ConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDeleteReview}
                title="حذف التقييم"
                message="هل أنت متأكد من رغبتك في حذف هذا التقييم؟"
                isConfirming={isProcessing}
            />
        </div>
    );
};

export default ManageReviewsScreen;
