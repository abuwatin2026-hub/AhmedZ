import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useOrders } from '../contexts/OrderContext';
import { useToast } from '../contexts/ToastContext';
import Invoice from '../components/Invoice';
import { printPdfFromElement, sharePdf } from '../utils/export';
import { buildPdfBrandOptions } from '../utils/branding';
import { BackArrowIcon, ShareIcon, PrinterIcon } from '../components/icons';
import { buildPrintHtml, printContent } from '../utils/printUtils';
import { renderToString } from 'react-dom/server';
import PrintableInvoice from '../components/admin/PrintableInvoice';
import PrintableOrder from '../components/admin/PrintableOrder';
import { Capacitor } from '@capacitor/core';
import PageLoader from '../components/PageLoader';
import { useSettings } from '../contexts/SettingsContext';
import { getSupabaseClient } from '../supabase';
import ConfirmationModal from '../components/admin/ConfirmationModal';
import { useAuth } from '../contexts/AuthContext';
import { useSessionScope } from '../contexts/SessionScopeContext';
import { useWarehouses } from '../contexts/WarehouseContext';


const InvoiceScreen: React.FC = () => {
    const { orderId } = useParams<{ orderId: string }>();
    const { getOrderById, incrementInvoicePrintCount, loading } = useOrders();
  const { showNotification } = useToast();
    const navigate = useNavigate();
    const location = useLocation();
    const order = getOrderById(orderId || '');
    const invoiceRef = useRef<HTMLDivElement>(null);
    const [isSharing, setIsSharing] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);
    const [isPrintingA4, setIsPrintingA4] = useState(false);
    const [isPrintingA4Pdf, setIsPrintingA4Pdf] = useState(false);
    const [invoiceAudit, setInvoiceAudit] = useState<any>(null);
    const { settings, language } = useSettings();
    const storeName = (settings.cafeteriaName?.[language] || settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '').trim();
    const safeStoreSlug = storeName.replace(/\s+/g, '-');
    const thermalPaperWidth: '58mm' | '80mm' = settings.posFlags?.thermalPaperWidth === '80mm' ? '80mm' : '58mm';
    const isAdminInvoice = (location.pathname || '').startsWith('/admin/');
    const { user: adminUser } = useAuth();
    const sessionScope = useSessionScope();
    const { getWarehouseById } = useWarehouses();
    const [selectedTemplate, setSelectedTemplate] = useState<'thermal' | 'a4'>(() => {
        if (adminUser?.role === 'cashier') {
            return settings.defaultInvoiceTemplateByRole?.pos === 'a4' ? 'a4' : 'thermal';
        }
        if (isAdminInvoice) {
            return settings.defaultInvoiceTemplateByRole?.admin === 'thermal' ? 'thermal' : 'a4';
        }
        return 'a4';
    });
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewKind, setPreviewKind] = useState<'thermal' | 'a4'>('thermal');
    const [previewHtml, setPreviewHtml] = useState<string>('');
    const [previewTitle, setPreviewTitle] = useState<string>('معاينة الطباعة');

    const resolveBranding = () => {
        const fallback = {
            name: storeName,
            address: settings.address || '',
            contactNumber: settings.contactNumber || '',
            logoUrl: settings.logoUrl || '',
        };
        const warehouseId = (order as any)?.warehouseId || sessionScope.scope?.warehouseId || '';
        const wh = warehouseId ? getWarehouseById(String(warehouseId)) : undefined;
        const key = warehouseId ? String(warehouseId) : '';
        const override = key ? settings.branchBranding?.[key] : undefined;
        return {
            name: (override?.name || wh?.name || fallback.name || '').trim(),
            address: (override?.address || wh?.address || wh?.location || fallback.address || '').trim(),
            contactNumber: (override?.contactNumber || wh?.phone || fallback.contactNumber || '').trim(),
            logoUrl: (override?.logoUrl || fallback.logoUrl || '').trim(),
        };
    };

    useEffect(() => {
        if (!order?.id) {
            setInvoiceAudit(null);
            return;
        }
        const supabase = getSupabaseClient();
        if (!supabase) {
            setInvoiceAudit(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const { data, error } = await supabase.rpc('get_invoice_audit', { p_order_id: order.id });
                if (error) throw error;
                if (!cancelled) setInvoiceAudit(data || null);
            } catch {
                if (!cancelled) setInvoiceAudit(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [order?.id]);

    const handleSharePdf = async () => {
        if (!order) return;
        setIsSharing(true);
        const isMobile = Capacitor.isNativePlatform() || /Mobi|Android/i.test(navigator.userAgent);
        let success = false;
        const brand = resolveBranding();
        const brandSettings: any = {
            ...settings,
            cafeteriaName: { ...(settings as any).cafeteriaName, ar: brand.name, en: brand.name },
            logoUrl: brand.logoUrl,
            address: brand.address,
            contactNumber: brand.contactNumber,
        };
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
                    audit={invoiceAudit}
                    language="ar"
                    cafeteriaName={storeName}
                    cafeteriaPhone={settings.contactNumber || ''}
                    cafeteriaAddress={settings.address || ''}
                    logoUrl={settings.logoUrl || ''}
                    vatNumber={settings.taxSettings?.taxNumber}
                    thermal
                    thermalPaperWidth={thermalPaperWidth}
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
                { unit: 'px', scale: 1.5, ...buildPdfBrandOptions(brandSettings, `فاتورة #${order.id.slice(-6).toUpperCase()}`, { pageNumbers: false }) }
            );
            document.body.removeChild(container);
        } else {
            success = await sharePdf(
                'print-area',
                `${'فاتورة'} ${order.id.slice(-6).toUpperCase()}`,
                `Invoice-${safeStoreSlug}-${order.id.slice(-6).toUpperCase()}.pdf`,
                { ...buildPdfBrandOptions(brandSettings, `فاتورة #${order.id.slice(-6).toUpperCase()}`, { pageNumbers: false }) }
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
                { ...buildPdfBrandOptions(settings, `فاتورة #${order.id.slice(-6).toUpperCase()}`, { pageNumbers: false }) }
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
                audit={invoiceAudit}
                language="ar"
                cafeteriaName={resolveBranding().name}
                cafeteriaPhone={resolveBranding().contactNumber}
                cafeteriaAddress={resolveBranding().address}
                logoUrl={resolveBranding().logoUrl}
                vatNumber={settings.taxSettings?.taxNumber}
                thermal
                thermalPaperWidth={thermalPaperWidth}
                isCopy={currentCount > 0}
                copyNumber={currentCount > 0 ? currentCount + 1 : undefined}
            />
        );
        printContent(content, `فاتورة #${order.id.slice(-6).toUpperCase()}`, { page: 'auto' });
        incrementInvoicePrintCount(order.id);
    };

    const handlePrintA4 = () => {
        if (!order) return;

        const currentCount = typeof order.invoicePrintCount === 'number' ? order.invoicePrintCount : 0;
        if (currentCount > 0) {
            const ok = window.confirm('هذه إعادة طباعة وسيتم وضع علامة "نسخة" على الفاتورة. المتابعة؟');
            if (!ok) return;
        }

        const brand = resolveBranding();
        const brandSettings: any = {
            ...settings,
            cafeteriaName: { ...(settings as any).cafeteriaName, ar: brand.name, en: brand.name },
            logoUrl: brand.logoUrl,
            address: brand.address,
            contactNumber: brand.contactNumber,
        };

        if (Capacitor.isNativePlatform()) {
            setIsPrintingA4(true);
            sharePdf(
                'print-area',
                `${'فاتورة'} ${order.id.slice(-6).toUpperCase()}`,
                `Invoice-${safeStoreSlug}-${order.id.slice(-6).toUpperCase()}.pdf`,
                { ...buildPdfBrandOptions(brandSettings, `فاتورة #${order.id.slice(-6).toUpperCase()}`, { pageNumbers: false }) }
            ).then((success) => {
                if (success) {
                    showNotification('اختر "طباعة" من خيارات المشاركة إذا كانت متاحة', 'success');
                    incrementInvoicePrintCount(order.id);
                } else {
                    showNotification('تعذر إنشاء ملف PDF للطباعة', 'error');
                }
            }).finally(() => setIsPrintingA4(false));
            return;
        }

        try {
            window.print();
            incrementInvoicePrintCount(order.id);
        } catch {
        }
    };

    const handlePrintA4WithPageNumbers = () => {
        if (!order) return;
        setIsPrintingA4Pdf(true);
        const brand = resolveBranding();
        const brandSettings: any = {
            ...settings,
            cafeteriaName: { ...(settings as any).cafeteriaName, ar: brand.name, en: brand.name },
            logoUrl: brand.logoUrl,
            address: brand.address,
            contactNumber: brand.contactNumber,
        };
        printPdfFromElement(
            'print-area',
            `${'فاتورة'} ${order.id.slice(-6).toUpperCase()}`,
            { ...buildPdfBrandOptions(brandSettings, `فاتورة #${order.id.slice(-6).toUpperCase()}`, { pageNumbers: true }) }
        ).then((success) => {
            if (success) {
                incrementInvoicePrintCount(order.id);
            }
        }).finally(() => setIsPrintingA4Pdf(false));
    };

    const handlePrintDeliveryNote = () => {
        if (!order) return;
        const brand = resolveBranding();
        const content = renderToString(
            <PrintableOrder
                order={order}
                language="ar"
                cafeteriaName={brand.name}
                cafeteriaAddress={brand.address}
                cafeteriaPhone={brand.contactNumber}
                logoUrl={brand.logoUrl}
            />
        );
        printContent(content, `سند تسليم #${order.id.slice(-6).toUpperCase()}`);
    };

    const handlePrintDefault = () => {
        if (selectedTemplate === 'thermal') {
            handlePrint();
        } else {
            handlePrintA4();
        }
    };

    const openPreviewDefault = () => {
        openPreview(selectedTemplate);
    };

    const openPreview = (kind: 'thermal' | 'a4') => {
        if (!order) return;
        setPreviewKind(kind);
        if (kind === 'thermal') {
            const currentCount = typeof order.invoicePrintCount === 'number' ? order.invoicePrintCount : 0;
            const content = renderToString(
                <PrintableInvoice
                    order={order}
                    audit={invoiceAudit}
                    language="ar"
                    cafeteriaName={resolveBranding().name}
                    cafeteriaPhone={resolveBranding().contactNumber}
                    cafeteriaAddress={resolveBranding().address}
                    logoUrl={resolveBranding().logoUrl}
                    vatNumber={settings.taxSettings?.taxNumber}
                    thermal
                    thermalPaperWidth={thermalPaperWidth}
                    isCopy={currentCount > 0}
                    copyNumber={currentCount > 0 ? currentCount + 1 : undefined}
                />
            );
            setPreviewHtml(buildPrintHtml(content, `فاتورة #${order.id.slice(-6).toUpperCase()}`, { page: 'auto' }));
            setPreviewTitle('معاينة الطباعة الحرارية');
        } else {
            setPreviewHtml('');
            setPreviewTitle('معاينة طباعة A4');
        }
        setPreviewOpen(true);
    };

    useEffect(() => {
        const params = new URLSearchParams(location.search || '');
        const autoprint = params.get('autoprint') === '1';
        const thermal = params.get('thermal') === '1';
        const copies = Math.max(1, Number(params.get('copies') || 1));
        if (order && order.invoiceIssuedAt && autoprint && thermal) {
            let printed = 0;
            const run = () => {
                if (!order) return;
                handlePrint();
                printed += 1;
                if (printed < copies) {
                    window.setTimeout(run, 300);
                }
            };
            window.setTimeout(run, 100);
        }
    }, [location.search, order]);

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
                    {isAdminInvoice && (
                        <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">القالب:</span>
                            <select
                                value={selectedTemplate}
                                onChange={(e) => setSelectedTemplate(e.target.value === 'thermal' ? 'thermal' : 'a4')}
                                className="text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-gray-800 dark:text-gray-200"
                            >
                                <option value="thermal">حراري</option>
                                <option value="a4">A4</option>
                            </select>
                        </div>
                    )}
                    {isAdminInvoice && (
                        <button
                            onClick={handlePrintDefault}
                            className="inline-flex items-center justify-center bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg hover:bg-indigo-700 transition-colors gap-2"
                        >
                            <PrinterIcon />
                            طباعة ({selectedTemplate === 'thermal' ? 'حراري' : 'A4'})
                        </button>
                    )}
                    {isAdminInvoice && (
                        <button
                            onClick={openPreviewDefault}
                            className="inline-flex items-center justify-center bg-indigo-50 text-indigo-700 font-bold py-2 px-4 rounded-lg shadow-lg hover:bg-indigo-100 transition-colors gap-2 dark:bg-indigo-900/20 dark:text-indigo-200 dark:hover:bg-indigo-900/30"
                        >
                            معاينة
                        </button>
                    )}
                    <button
                        onClick={handlePrint}
                        disabled={isPrinting}
                        className="inline-flex items-center justify-center bg-blue-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg hover:bg-blue-700 transition-colors disabled:bg-blue-400 disabled:cursor-wait gap-2"
                    >
                        <PrinterIcon />
                        {isPrinting ? 'جاري التحميل...' : 'طباعة حرارية'}
                    </button>
                    {isAdminInvoice && (
                        <button
                            onClick={() => openPreview('thermal')}
                            className="inline-flex items-center justify-center bg-blue-50 text-blue-700 font-bold py-2 px-4 rounded-lg shadow-lg hover:bg-blue-100 transition-colors gap-2 dark:bg-blue-900/20 dark:text-blue-200 dark:hover:bg-blue-900/30"
                        >
                            معاينة
                        </button>
                    )}
                    <button
                        onClick={handlePrintA4}
                        disabled={isPrintingA4}
                        className="inline-flex items-center justify-center bg-gray-800 text-white font-bold py-2 px-4 rounded-lg shadow-lg hover:bg-gray-900 transition-colors disabled:bg-gray-500 disabled:cursor-wait gap-2"
                    >
                        <PrinterIcon />
                        {isPrintingA4 ? 'جاري التحميل...' : 'طباعة A4'}
                    </button>
                    {isAdminInvoice && (
                        <button
                            onClick={handlePrintA4WithPageNumbers}
                            disabled={isPrintingA4Pdf}
                            className="inline-flex items-center justify-center bg-gray-50 text-gray-900 font-bold py-2 px-4 rounded-lg shadow-lg hover:bg-gray-100 transition-colors disabled:bg-gray-200 disabled:cursor-wait gap-2 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                        >
                            <PrinterIcon />
                            {isPrintingA4Pdf ? 'جاري التحضير...' : 'A4 (ترقيم صفحات)'}
                        </button>
                    )}
                    {isAdminInvoice && (
                        <button
                            onClick={() => openPreview('a4')}
                            className="inline-flex items-center justify-center bg-gray-100 text-gray-900 font-bold py-2 px-4 rounded-lg shadow-lg hover:bg-gray-200 transition-colors gap-2 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                        >
                            معاينة
                        </button>
                    )}
                    {isAdminInvoice && (
                        <button
                            onClick={handlePrintDeliveryNote}
                            className="inline-flex items-center justify-center bg-gray-200 text-gray-900 font-bold py-2 px-4 rounded-lg shadow-lg hover:bg-gray-300 transition-colors gap-2 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                        >
                            طباعة سند تسليم
                        </button>
                    )}
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

            <ConfirmationModal
                isOpen={previewOpen}
                onClose={() => setPreviewOpen(false)}
                onConfirm={() => {
                    setPreviewOpen(false);
                    if (previewKind === 'thermal') {
                        handlePrint();
                    } else {
                        handlePrintA4();
                    }
                }}
                title={previewTitle}
                message=""
                confirmText="طباعة"
                cancelText="إغلاق"
                confirmButtonClassName="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400"
                maxWidthClassName="max-w-5xl"
            >
                {previewKind === 'thermal' ? (
                    <iframe
                        title="print-preview"
                        className="w-full h-[70dvh] bg-white rounded border border-gray-200"
                        srcDoc={previewHtml}
                    />
                ) : (
                    <div className="bg-white p-4 rounded border border-gray-200">
                        <div className="text-xs text-gray-500 mb-3">هذه معاينة A4 ضمن الواجهة. عند الطباعة قد تُطبّق قواعد @media print.</div>
                        <Invoice ref={invoiceRef} order={order} settings={settings as any} audit={invoiceAudit} branding={resolveBranding()} />
                    </div>
                )}
            </ConfirmationModal>

            <Invoice ref={invoiceRef} order={order} settings={settings as any} audit={invoiceAudit} branding={resolveBranding()} />
        </div>
    );
};

export default InvoiceScreen;
