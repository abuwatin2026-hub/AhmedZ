import React, { useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useOrders } from '../contexts/OrderContext';
import { useToast } from '../contexts/ToastContext';
import Invoice from '../components/Invoice';
import { sharePdf } from '../utils/export';
import { BackArrowIcon, ShareIcon, PrinterIcon } from '../components/icons';
import { printContent } from '../utils/printUtils';
import { renderToString } from 'react-dom/server';
import PrintableInvoice from '../components/admin/PrintableInvoice';
import { Capacitor } from '@capacitor/core';
import PageLoader from '../components/PageLoader';
import { useSettings } from '../contexts/SettingsContext';


const InvoiceScreen: React.FC = () => {
    const { orderId } = useParams<{ orderId: string }>();
    const { getOrderById, incrementInvoicePrintCount, loading } = useOrders();
  const { showNotification } = useToast();
    const navigate = useNavigate();
    const order = getOrderById(orderId || '');
    const invoiceRef = useRef<HTMLDivElement>(null);
    const [isSharing, setIsSharing] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);
    const { settings, language } = useSettings();
    const storeName = (settings.cafeteriaName?.[language] || settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '').trim();
    const safeStoreSlug = storeName.replace(/\s+/g, '-');

    const handleSharePdf = async () => {
        if (!order) return;
        setIsSharing(true);
        const isMobile = Capacitor.isNativePlatform() || /Mobi|Android/i.test(navigator.userAgent);
        let success = false;
        if (isMobile) {
            const containerId = 'thermal-print-area';
            const container = document.createElement('div');
            container.id = containerId;
            container.style.position = 'fixed';
            container.style.top = '-10000px';
            container.style.left = '0';
            container.style.width = '576px';
            container.style.background = '#ffffff';
            const currentCount = typeof order.invoicePrintCount === 'number' ? order.invoicePrintCount : 0;
            const thermalHtml = renderToString(
                <PrintableInvoice
                    order={order}
                    language="ar"
                    cafeteriaName={storeName}
                    cafeteriaPhone={settings.contactNumber || ''}
                    cafeteriaAddress={settings.address || ''}
                    logoUrl={settings.logoUrl || ''}
                    vatNumber={settings.taxSettings?.taxNumber}
                    thermal
                    isCopy={currentCount > 0}
                    copyNumber={currentCount > 0 ? currentCount + 1 : undefined}
                />
            );
            container.innerHTML = thermalHtml;
            document.body.appendChild(container);
            success = await sharePdf(
                containerId,
                `${'فاتورة'} ${order.id.slice(-6).toUpperCase()}`,
                `Invoice-${safeStoreSlug}-${order.id.slice(-6).toUpperCase()}.pdf`,
                { unit: 'px', scale: 1.5 }
            );
            document.body.removeChild(container);
        } else {
            success = await sharePdf(
                'print-area',
                `${'فاتورة'} ${order.id.slice(-6).toUpperCase()}`,
                `Invoice-${safeStoreSlug}-${order.id.slice(-6).toUpperCase()}.pdf`,
                {
                    headerTitle: storeName,
                    headerSubtitle: `فاتورة #${order.id.slice(-6).toUpperCase()}`,
                    footerText: [
                        settings.address || '',
                        settings.contactNumber || '',
                        settings.taxSettings?.taxNumber ? `الرقم الضريبي: ${settings.taxSettings.taxNumber}` : ''
                    ].filter(Boolean).join(' • '),
                    headerHeight: 40,
                    footerHeight: 24,
                    logoUrl: settings.logoUrl || ''
                }
            );
        }
        if (success) {
            showNotification('تم حفظ الفاتورة في مجلد المستندات', 'success');
        } else {
            showNotification('لا يمكن مشاركة الفاتورة. يرجى التأكد من منح التطبيق الصلاحيات اللازمة.', 'error');
        }
        setIsSharing(false);
    };

    const handlePrint = () => {
        if (!order) return;

        const currentCount = typeof order.invoicePrintCount === 'number' ? order.invoicePrintCount : 0;
        if (currentCount > 0) {
            const ok = window.confirm('هذه إعادة طباعة وسيتم وضع علامة "نسخة" على الفاتورة. المتابعة؟');
            if (!ok) return;
        }

        if (Capacitor.isNativePlatform()) {
            setIsPrinting(true);
            sharePdf(
                'print-area',
                `${'فاتورة'} ${order.id.slice(-6).toUpperCase()}`,
                `Invoice-${safeStoreSlug}-${order.id.slice(-6).toUpperCase()}.pdf`,
                {
                    headerTitle: storeName,
                    headerSubtitle: `فاتورة #${order.id.slice(-6).toUpperCase()}`,
                    footerText: [
                        settings.address || '',
                        settings.contactNumber || '',
                        settings.taxSettings?.taxNumber ? `الرقم الضريبي: ${settings.taxSettings.taxNumber}` : ''
                    ].filter(Boolean).join(' • '),
                    headerHeight: 40,
                    footerHeight: 24,
                    logoUrl: settings.logoUrl || ''
                }
            ).then((success) => {
                if (success) {
                    showNotification('اختر "طباعة" من خيارات المشاركة إذا كانت متاحة', 'success');
                    incrementInvoicePrintCount(order.id);
                } else {
                    showNotification('تعذر إنشاء ملف PDF للطباعة', 'error');
                }
            }).finally(() => setIsPrinting(false));
            return;
        }

        const content = renderToString(
            <PrintableInvoice
                order={order}
                language="ar"
                cafeteriaName={storeName}
                cafeteriaPhone={settings.contactNumber || ''}
                cafeteriaAddress={settings.address || ''}
                logoUrl={settings.logoUrl || ''}
                vatNumber={settings.taxSettings?.taxNumber}
                thermal
                isCopy={currentCount > 0}
                copyNumber={currentCount > 0 ? currentCount + 1 : undefined}
            />
        );
        printContent(content, `فاتورة #${order.id.slice(-6).toUpperCase()}`);
        incrementInvoicePrintCount(order.id);
    };

    if (!order && loading) {
        return <PageLoader />;
    }

    if (!order) {
        return (
            <div className="text-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                <h2 className="text-2xl font-bold dark:text-white">الطلب غير موجود</h2>
                <Link to="/my-orders" className="mt-6 inline-block bg-orange-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-orange-600">
                    طلباتي
                </Link>
            </div>
        );
    }

    if (!order.invoiceIssuedAt) {
        return (
            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="my-6">
                    <button onClick={() => navigate(-1)} className="flex items-center text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-orange-500 dark:hover:text-orange-400 transition-colors">
                        <BackArrowIcon />
                        {'رجوع'}
                    </button>
                </div>
                <div className="text-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                    <h2 className="text-2xl font-bold dark:text-white">الفاتورة غير متاحة بعد</h2>
                    <p className="text-gray-500 dark:text-gray-400 mt-3">تظهر الفاتورة بعد تسليم الطلب وإغلاقه.</p>
                    <Link to={`/order/${order.id}`} className="mt-6 inline-block bg-orange-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-orange-600">
                        {'تتبع الطلب'}
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="my-6 flex justify-between items-center gap-4">
                <button onClick={() => navigate(-1)} className="flex items-center text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-orange-500 dark:hover:text-orange-400 transition-colors">
                    <BackArrowIcon />
                    رجوع
                </button>
                <div className="flex gap-2">
                    <button
                        onClick={handlePrint}
                        disabled={isPrinting}
                        className="inline-flex items-center justify-center bg-blue-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg hover:bg-blue-700 transition-colors disabled:bg-blue-400 disabled:cursor-wait gap-2"
                    >
                        <PrinterIcon />
                        {isPrinting ? 'جاري التحميل...' : 'طباعة'}
                    </button>
                    <button
                        onClick={handleSharePdf}
                        disabled={isSharing}
                        className="inline-flex items-center justify-center bg-green-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg hover:bg-green-700 transition-colors disabled:bg-green-400 disabled:cursor-wait gap-2"
                    >
                        <ShareIcon />
                        {isSharing ? 'جاري التحميل...' : 'مشاركة PDF'}
                    </button>
                </div>
            </div>

            <Invoice ref={invoiceRef} order={order} settings={settings as any} />
        </div>
    );
};

export default InvoiceScreen;
