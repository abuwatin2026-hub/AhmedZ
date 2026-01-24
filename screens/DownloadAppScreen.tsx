
import React, { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { AndroidIcon, AppleIcon, DownloadIcon, ShareIcon } from '../components/icons';
import Logo from '../components/Logo';
import { useSettings } from '../contexts/SettingsContext';

type LatestApkInfo = {
    version?: string;
    versionCode?: number;
    apkFilename?: string;
};

const compareVersionStrings = (a: string, b: string) => {
    const aParts = a.split('.').map(part => Number(part));
    const bParts = b.split('.').map(part => Number(part));
    const maxLen = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < maxLen; i += 1) {
        const aNum = Number.isFinite(aParts[i]) ? aParts[i] : 0;
        const bNum = Number.isFinite(bParts[i]) ? bParts[i] : 0;
        if (aNum > bNum) return 1;
        if (aNum < bNum) return -1;
    }
    return 0;
};

const DownloadAppScreen: React.FC = () => {
    const { settings, language } = useSettings();
    const storeName = settings.cafeteriaName?.[language] || settings.cafeteriaName?.ar || settings.cafeteriaName?.en;
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [latestInfo, setLatestInfo] = useState<LatestApkInfo | null>(null);
    const [currentVersion, setCurrentVersion] = useState<string | null>(null);
    const [currentVersionCode, setCurrentVersionCode] = useState<number | null>(null);
    const [isNativeApp, setIsNativeApp] = useState(false);
    const [shareFeedback, setShareFeedback] = useState<string | null>(null);
    const [shareErrorHint, setShareErrorHint] = useState<string | null>(null);
    const [apkSizeBytes, setApkSizeBytes] = useState<number | null>(null);
    const androidDownloadEnabled = false;

    const DEFAULT_APK_FILENAME = 'ahmed-zangah-latest.apk';
    // Use absolute URL for version check when in native app to reach the server
    const getBaseUrl = () => {
        if (Capacitor.isNativePlatform()) {
            return 'https://ahmed-zangah.pages.dev/'; // Production URL
        }
        return import.meta.env.BASE_URL;
    };

    const baseUrl = getBaseUrl();
    const versionJsonUrl = `${baseUrl}version.json`;

    useEffect(() => {
        const run = async () => {
            setLoading(true);
            try {
                const native = Capacitor.isNativePlatform();
                setIsNativeApp(native);
                if (native) {
                    const info = await App.getInfo();
                    setCurrentVersion(info.version ?? null);
                    const buildNumber = Number(info.build);
                    setCurrentVersionCode(Number.isFinite(buildNumber) ? buildNumber : null);
                }
            } catch {
                setIsNativeApp(false);
            }

            try {
                const response = await fetch(`${versionJsonUrl}?t=${Date.now()}`, { cache: 'no-store' });
                if (response.ok) {
                    const data = (await response.json()) as LatestApkInfo;
                    setLatestInfo(data);
                    const apkFilename = data.apkFilename || DEFAULT_APK_FILENAME;
                    setDownloadUrl(`${baseUrl}downloads/${apkFilename}`);
                } else {
                    setDownloadUrl(`${baseUrl}downloads/${DEFAULT_APK_FILENAME}`);
                }
            } catch {
                setDownloadUrl(`${baseUrl}downloads/${DEFAULT_APK_FILENAME}`);
            } finally {
                setLoading(false);
            }
        };

        void run();
    }, []);

    useEffect(() => {
        const fetchSize = async () => {
            setApkSizeBytes(null);
            if (!downloadUrl) return;
            try {
                const res = await fetch(`${downloadUrl}?t=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
                const len = res.headers.get('content-length');
                const n = len ? Number(len) : NaN;
                if (Number.isFinite(n) && n > 0) setApkSizeBytes(n);
            } catch {
            }
        };
        void fetchSize();
    }, [downloadUrl]);

    const handleDownload = async () => {
        if (!downloadUrl) return;

        if (isNativeApp) {
            try {
                setLoading(true);
                // 1. Download file using Filesystem
                const fileName = latestInfo?.apkFilename || DEFAULT_APK_FILENAME;
                const downloadResult = await Filesystem.downloadFile({
                    url: downloadUrl,
                    path: fileName,
                    directory: Directory.Cache, // Use Cache directory for temporary storage
                });

                // 2. Open the file to install
                await FileOpener.open({
                    filePath: downloadResult.path!,
                    contentType: 'application/vnd.android.package-archive',
                });
            } catch (error) {
                console.error('Download/Install failed:', error);
                alert('فشل تحميل التحديث. يرجى المحاولة لاحقاً أو التحميل من الموقع.');
                // Fallback to browser if native install fails
                window.open(downloadUrl, '_system');
            } finally {
                setLoading(false);
            }
        } else {
            const link = document.createElement('a');
            link.href = `${downloadUrl}?t=${Date.now()}`;
            link.download = latestInfo?.apkFilename || DEFAULT_APK_FILENAME;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const handleShareAppLink = async () => {
        const url = window.location.href;
        setShareErrorHint(null);

        try {
            if (navigator.share && window.isSecureContext) {
                await navigator.share({
                    title: `تطبيق ${storeName}`,
                    text: 'افتح الرابط في Safari ثم اختر "إضافة إلى الشاشة الرئيسية".',
                    url,
                });
                setShareFeedback('تم فتح المشاركة');
                window.setTimeout(() => setShareFeedback(null), 2500);
                return;
            }
        } catch {
        }

        try {
            if (navigator.clipboard?.writeText && window.isSecureContext) {
                await navigator.clipboard.writeText(url);
                setShareFeedback('تم نسخ الرابط');
                window.setTimeout(() => setShareFeedback(null), 2500);
                return;
            }
        } catch {
        }

        try {
            const textarea = document.createElement('textarea');
            textarea.value = url;
            textarea.setAttribute('readonly', 'true');
            textarea.style.position = 'fixed';
            textarea.style.top = '0';
            textarea.style.left = '0';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);
            const ok = document.execCommand('copy');
            document.body.removeChild(textarea);
            if (ok) {
                setShareFeedback('تم نسخ الرابط');
                window.setTimeout(() => setShareFeedback(null), 2500);
                return;
            }
        } catch {
        }

        setShareErrorHint('إذا لم يعمل زر المشاركة، انسخ الرابط وافتحه في Safari ثم اضغط زر المشاركة أسفل المتصفح.');
        window.prompt('انسخ الرابط:', url);
    };

    const latestVersion = latestInfo?.version || '—';
    const formatBytes = (n: number) => {
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(Math.floor(Math.log(n) / Math.log(k)), sizes.length - 1);
        const val = n / Math.pow(k, i);
        return `${val.toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
    };
    const shouldShowUpdate =
        isNativeApp &&
        ((latestInfo?.versionCode != null && currentVersionCode != null && latestInfo.versionCode > currentVersionCode) ||
            (latestInfo?.version != null && currentVersion != null && compareVersionStrings(latestInfo.version, currentVersion) > 0));
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;
    const isIOS =
        /iPad|iPhone|iPod/i.test(userAgent) ||
        (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(userAgent);

    return (
        <div className="min-h-[calc(100vh-theme(space.32))] flex flex-col items-center justify-center p-4 animate-fade-in">
            <div className="w-full max-w-5xl">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="mb-6 transform hover:scale-105 transition-transform duration-300 inline-block">
                        <Logo size="lg" variant="icon" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        {`حمل تطبيق ${storeName}`}
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        {'اختر المنصة المناسبة لجهازك'}
                    </p>
                </div>

                {/* Two Column Layout */}
                <div className="grid md:grid-cols-2 gap-6">
                    {/* Android APK Card */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 border-2 border-green-500/20 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-24 h-24 bg-green-500/10 rounded-br-full -translate-x-1/2 -translate-y-1/2"></div>
                        <div className="absolute bottom-0 right-0 w-32 h-32 bg-green-500/10 rounded-tl-full translate-x-1/2 translate-y-1/2"></div>

                        <div className="relative z-10">
                            <div className="flex items-center justify-center mb-6">
                                <div className="p-4 bg-green-100 dark:bg-green-900/30 rounded-full">
                                    <AndroidIcon className="w-12 h-12 text-green-600 dark:text-green-400" />
                                </div>
                            </div>

                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 text-center">
                                {'أندرويد'}
                            </h2>

                            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 mb-6">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm text-gray-500 dark:text-gray-400">
                                        {'آخر إصدار'}
                                    </span>
                                    <span className="font-mono font-bold text-gray-800 dark:text-gray-200">{latestVersion}</span>
                                </div>
                                {isNativeApp && (
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm text-gray-500 dark:text-gray-400">
                                            {'إصدار تطبيقك'}
                                        </span>
                                        <span className="font-mono font-bold text-gray-800 dark:text-gray-200">
                                            {currentVersion || '—'}
                                        </span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-500 dark:text-gray-400">
                                        {'نظام التشغيل'}
                                    </span>
                                    <span className="flex items-center text-green-600 dark:text-green-400 font-medium">
                                        <AndroidIcon className="w-4 h-4 mr-1 rtl:ml-1" /> Android
                                    </span>
                                </div>
                                {apkSizeBytes != null && (
                                    <div className="flex items-center justify-between mt-2">
                                        <span className="text-sm text-gray-500 dark:text-gray-400">
                                            {'حجم الملف'}
                                        </span>
                                        <span className="font-mono font-bold text-gray-800 dark:text-gray-200">
                                            {formatBytes(apkSizeBytes)}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {androidDownloadEnabled ? (
                                <button
                                    onClick={handleDownload}
                                    disabled={loading || !downloadUrl}
                                    className="w-full flex items-center justify-center gap-3 py-4 px-6 bg-gradient-to-r from-green-600 to-green-500 text-white rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                                >
                                    {loading ? (
                                        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    ) : (
                                        <>
                                            <DownloadIcon className="w-6 h-6 group-hover:animate-bounce" />
                                            <span className="text-lg font-bold">
                                                {shouldShowUpdate ? 'تحديث' : 'تحميل APK'}
                                            </span>
                                        </>
                                    )}
                                </button>
                            ) : (
                                <div className="w-full flex items-center justify-center gap-3 py-4 px-6 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl">
                                    <span className="text-sm font-bold">
                                        {'التحميل غير متاح حالياً'}
                                    </span>
                                </div>
                            )}

                            <p className="mt-4 text-xs text-gray-500 dark:text-gray-400 text-center">
                                {'تأكد من تفعيل "تثبيت من مصادر غير معروفة" في إعدادات هاتفك'}
                            </p>
                        </div>
                    </div>

                    {/* iPhone PWA Card */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 border-2 border-blue-500/20 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-24 h-24 bg-blue-500/10 rounded-br-full -translate-x-1/2 -translate-y-1/2"></div>
                        <div className="absolute bottom-0 right-0 w-32 h-32 bg-blue-500/10 rounded-tl-full translate-x-1/2 translate-y-1/2"></div>

                        <div className="relative z-10">
                            <div className="flex items-center justify-center mb-6">
                                <div className="p-4 bg-blue-100 dark:bg-blue-900/30 rounded-full">
                                    <AppleIcon className="w-12 h-12 text-blue-600 dark:text-blue-400" />
                                </div>
                            </div>

                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 text-center">
                                {'آيفون'}
                            </h2>

                            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 mb-6">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm text-gray-500 dark:text-gray-400">
                                        {'النوع'}
                                    </span>
                                    <span className="font-bold text-gray-800 dark:text-gray-200">PWA</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-500 dark:text-gray-400">
                                        {'نظام التشغيل'}
                                    </span>
                                    <span className="flex items-center text-blue-600 dark:text-blue-400 font-medium">
                                        <AppleIcon className="w-4 h-4 mr-1 rtl:ml-1" /> iOS
                                    </span>
                                </div>
                            </div>

                            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-5 mb-4 border border-blue-200 dark:border-blue-800">
                                <h3 className="font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                    <ShareIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                    {'طريقة التثبيت:'}
                                </h3>
                                <ol className="space-y-2 text-sm text-gray-700 dark:text-gray-300 list-decimal list-inside">
                                    <li className="leading-relaxed">افتح هذا الموقع في متصفح Safari</li>
                                    <li className="leading-relaxed">اضغط على زر المشاركة <ShareIcon className="w-4 h-4 inline mx-1" /> في الأسفل</li>
                                    <li className="leading-relaxed">اختر "إضافة إلى الشاشة الرئيسية"</li>
                                    <li className="leading-relaxed">اضغط "إضافة" للتأكيد</li>
                                </ol>
                            </div>

                            <button
                                type="button"
                                onClick={handleShareAppLink}
                                className="w-full flex items-center justify-center gap-3 py-3 px-6 bg-blue-600 text-white rounded-xl shadow hover:bg-blue-700 transition"
                            >
                                <ShareIcon className="w-5 h-5" />
                                <span className="font-bold">
                                    {isIOS ? 'مشاركة / نسخ رابط التطبيق' : 'مشاركة رابط التطبيق'}
                                </span>
                            </button>
                            {shareFeedback && (
                                <div className="mt-2 text-center text-xs text-gray-600 dark:text-gray-300">
                                    {shareFeedback}
                                </div>
                            )}
                            {shareErrorHint && (
                                <div className="mt-2 text-center text-xs text-gray-600 dark:text-gray-300">
                                    {shareErrorHint}
                                </div>
                            )}
                            {isIOS && !isSafari && (
                                <div className="mt-2 text-center text-xs text-amber-700 dark:text-amber-300">
                                    {'تنبيه: التثبيت على الآيفون يعمل من Safari فقط.'}
                                </div>
                            )}
                            {isIOS && !isSecureContext && (
                                <div className="mt-2 text-center text-xs text-amber-700 dark:text-amber-300">
                                    {'تنبيه: يجب أن يكون الرابط HTTPS حتى تعمل المشاركة والنسخ بشكل موثوق.'}
                                </div>
                            )}

                            <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-xl p-4 text-center">
                                <p className="text-sm font-medium">
                                    {'✨ ستظهر أيقونة التطبيق على الشاشة الرئيسية'}
                                </p>
                            </div>

                            <p className="mt-4 text-xs text-gray-500 dark:text-gray-400 text-center">
                                {'يجب استخدام متصفح Safari لتثبيت التطبيق'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DownloadAppScreen;
