import React, { useState, useRef } from 'react';
import {
    exportFullSystemBackup,
    exportSummaryAsExcel,
    importSystemBackup,
    downloadBlob,
    BackupProgress,
    BackupReadinessReport,
    checkBackupRestoreReadiness
} from '../../../utils/backupUtils';
import { useToast } from '../../../contexts/ToastContext';
import * as Icons from '../../../components/icons';

const BackupSettingsScreen: React.FC = () => {
    const { showNotification } = useToast();
    const [isBackingUp, setIsBackingUp] = useState(false);
    const [restoreMode, setRestoreMode] = useState<'safe' | 'wipe'>('safe');
    const [backupType, setBackupType] = useState<'json' | 'excel' | null>(null);
    const [isCheckingReadiness, setIsCheckingReadiness] = useState(false);
    const [readinessReport, setReadinessReport] = useState<BackupReadinessReport | null>(null);
    const [progress, setProgress] = useState<BackupProgress>({
        status: 'idle',
        currentTable: '',
        tableProgress: 0,
        tablesCompleted: 0,
        totalTables: 0,
        message: ''
    });

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleRestoreInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Reset file input so same file can be selected again if needed
        if (fileInputRef.current) fileInputRef.current.value = '';

        if (!file.name.endsWith('.abd') && !file.name.endsWith('.abdz') && !file.name.endsWith('.zip')) {
            showNotification('يرجى اختيار ملف متوافق (.abdz, .zip, .abd) فقط.', 'error');
            return;
        }

        const isWipe = restoreMode === 'wipe';
        const msg = isWipe
            ? 'تنبيه خطير جداً: هذه العملية ستقوم بمسح جميع بيانات النظام الحالية (فواتير، أصناف، عملاء...) واستبدالها بالكامل من الملف المرفوع. هل أنت متأكد 100% أنك تريد الاستمرار؟'
            : 'هل أنت متأكد من رغبتك في استرداد هذا الملف لملء النواقص في النظام؟';

        if (!window.confirm(msg)) {
            return;
        }

        try {
            setIsBackingUp(true);
            setBackupType('json'); // Reusing json UI for restore progress
            await importSystemBackup(file, isWipe, setProgress);
            showNotification('تم استرداد البيانات بنجاح!', 'success');
        } catch (error: any) {
            showNotification(error.message || 'حدث خطأ أثناء استرداد البيانات.', 'error');
            setProgress((p: BackupProgress) => ({ ...p, status: 'error', message: 'فشلت عملية الاسترداد' }));
        } finally {
            setIsBackingUp(false);
            setTimeout(() => setBackupType(null), 3000);
        }
    };

    const handleBackupJson = async () => {
        try {
            setIsBackingUp(true);
            setBackupType('json');
            const blob = await exportFullSystemBackup(setProgress);
            const filename = `AhmedZ_Full_Backup_${new Date().toISOString().replace(/[:.]/g, '-')}.abdz`;
            downloadBlob(blob, filename);
            showNotification('تم اكتمال النسخ الاحتياطي (النسخة الشاملة مع المرفقات) بنجاح!', 'success');
        } catch (error: any) {
            showNotification(error.message || 'حدث خطأ أثناء سحب البيانات.', 'error');
            setProgress((p: BackupProgress) => ({ ...p, status: 'error', message: 'فشلت العملية' }));
        } finally {
            setIsBackingUp(false);
            setTimeout(() => setBackupType(null), 3000); // clear after 3s
        }
    };

    const handleBackupExcel = async () => {
        try {
            setIsBackingUp(true);
            setBackupType('excel');
            const blob = await exportSummaryAsExcel(setProgress);
            const filename = `AhmedZ_Summary_${new Date().toISOString().split('T')[0]}.xlsx`;
            downloadBlob(blob, filename);
            showNotification('تم تصدير نسخة الإكسيل المقروءة بنجاح!', 'success');
        } catch (error: any) {
            showNotification(error.message || 'حدث خطأ أثناء تصدير الإكسيل.', 'error');
            setProgress((p: BackupProgress) => ({ ...p, status: 'error', message: 'فشلت العملية' }));
        } finally {
            setIsBackingUp(false);
            setTimeout(() => setBackupType(null), 3000);
        }
    };

    const calculateOverallProgress = () => {
        if (progress.totalTables === 0) return 0;
        // tablesCompleted is integer, tableProgress is 0-100 for current table
        const completedFraction = progress.tablesCompleted / progress.totalTables;
        const currentFraction = (progress.tableProgress / 100) / progress.totalTables;
        const totalPercentage = (completedFraction + currentFraction) * 100;
        return Math.min(100, Math.max(0, Math.round(totalPercentage)));
    };

    const handleReadinessCheck = async () => {
        try {
            setIsCheckingReadiness(true);
            const report = await checkBackupRestoreReadiness();
            setReadinessReport(report);
            if (report.ok) {
                showNotification('جاهزية النسخ والاستعادة ممتازة حالياً.', 'success');
            } else {
                showNotification('تم اكتشاف فجوات جاهزية في النسخ والاستعادة. راجع التقرير أدناه.', 'error');
            }
        } catch (error: any) {
            showNotification(error.message || 'فشل فحص الجاهزية.', 'error');
        } finally {
            setIsCheckingReadiness(false);
        }
    };

    return (
        <div className="animate-fade-in space-y-8 max-w-5xl mx-auto">
            <div>
                <h1 className="text-3xl font-bold dark:text-white mb-2">النسخ الاحتياطي وأمان البيانات</h1>
                <p className="text-gray-600 dark:text-gray-300">
                    احتفظ بنسخة من بيانات متجرك وحساباتك بأمان على جهازك الشخصي لتكون دائماً مطمئناً.
                </p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 p-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">فحص جاهزية الطوارئ</h2>
                        <p className="text-gray-600 dark:text-gray-400 text-sm">يفحص صلاحيات النسخ والاستعادة، ودوال الاسترجاع، وتوفر النسخ الآلية.</p>
                    </div>
                    <button
                        onClick={handleReadinessCheck}
                        disabled={isCheckingReadiness || isBackingUp}
                        className="px-5 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 transition-all flex items-center justify-center gap-2"
                    >
                        <Icons.ReportIcon className="h-5 w-5" />
                        {isCheckingReadiness ? 'جاري الفحص...' : 'تشغيل فحص الجاهزية'}
                    </button>
                </div>
                {readinessReport && (
                    <div className="mt-5 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                        <div className={`px-4 py-3 text-sm font-bold ${readinessReport.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                            {readinessReport.ok ? 'النتيجة: جاهز' : 'النتيجة: يوجد فجوات تحتاج إغلاق'}
                        </div>
                        <div className="divide-y divide-gray-200 dark:divide-gray-700">
                            {readinessReport.checks.map((c) => (
                                <div key={c.key} className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
                                    <span className="font-mono text-gray-700 dark:text-gray-300">{c.key}</span>
                                    <span className={c.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                        {c.ok ? `OK - ${c.message}` : `FAIL - ${c.message}`}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {isBackingUp && backupType && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-blue-200 dark:border-blue-700 p-8 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gray-200 dark:bg-gray-700">
                        <div
                            className="h-full bg-blue-600 transition-all duration-300 ease-out"
                            style={{ width: `${calculateOverallProgress()}%` }}
                        />
                    </div>

                    <div className="flex flex-col items-center justify-center space-y-6">
                        <div className={`p-4 rounded-full ${backupType === 'excel' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'} animate-pulse`}>
                            {backupType === 'excel' ? <Icons.ReportIcon className="h-10 w-10" /> : <Icons.DatabaseIcon className="h-10 w-10" />}
                        </div>

                        <div className="text-center">
                            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                                {backupType === 'excel' ? 'جاري تصدير الإكسيل...' : 'جاري سحب الهيكل الكامل...'}
                            </h3>
                            <p className="text-gray-600 dark:text-gray-300 text-lg font-mono" dir="rtl">
                                {progress.message}
                            </p>
                        </div>

                        <div className="w-full max-w-md bg-gray-100 dark:bg-gray-700 rounded-lg p-4">
                            <div className="flex justify-between text-sm mb-2 text-gray-700 dark:text-gray-300 font-semibold">
                                <span>التقدم الإجمالي</span>
                                <span>{calculateOverallProgress()}%</span>
                            </div>
                            <div className="w-full bg-gray-300 dark:bg-gray-600 rounded-full h-2.5">
                                <div className={`h-2.5 rounded-full ${backupType === 'excel' ? 'bg-green-500' : 'bg-blue-600'}`} style={{ width: `${calculateOverallProgress()}%` }}></div>
                            </div>
                            {progress.status === 'fetching_data' && (
                                <div className="mt-4 border-t dark:border-gray-600 pt-3 flex justify-between text-xs text-gray-500 dark:text-gray-400 font-mono">
                                    <span>الجدول الحالي: {progress.currentTable}</span>
                                    <span>({progress.tablesCompleted + 1} / {progress.totalTables})</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 ${isBackingUp ? 'opacity-50 pointer-events-none' : ''}`}>
                {/* Excel Backup Card */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 p-8 flex flex-col hover:shadow-xl transition relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 bg-green-50 dark:bg-green-900/10 w-32 h-32 rounded-full opacity-50 group-hover:scale-110 transition-transform"></div>
                    <div className="relative z-10 flex-1">
                        <div className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 w-14 h-14 rounded-2xl flex items-center justify-center mb-6">
                            <Icons.ReportIcon className="h-7 w-7" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">نسخة مقروءة (Excel)</h2>
                        <p className="text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">
                            تصدير الجداول الأساسية (الأصناف، فواتير المشتريات والمبيعات، الحسابات، والعملاء والموردين) في ملف إكسيل واحد مرتب ومبوب. مخصص ليتصفحه التاجر في أي وقت للطمأنينة أو لمشاركته مع المستشار المحاسبي.
                        </p>
                    </div>
                    <button
                        onClick={handleBackupExcel}
                        className="w-full py-4 rounded-xl font-bold text-white bg-green-600 hover:bg-green-700 shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
                    >
                        <Icons.DownloadIcon className="h-5 w-5" />
                        تحميل نسخة الإكسيل
                    </button>
                </div>

                {/* Database Backup Card */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 p-8 flex flex-col hover:shadow-xl transition relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 bg-blue-50 dark:bg-blue-900/10 w-32 h-32 rounded-full opacity-50 group-hover:scale-110 transition-transform"></div>
                    <div className="relative z-10 flex-1">
                        <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 w-14 h-14 rounded-2xl flex items-center justify-center mb-6">
                            <Icons.DatabaseIcon className="h-7 w-7" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">نسخة شاملة للنظام (.abdz)</h2>
                        <p className="text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">
                            سحب كامل 100% لكل صغيرة وكبيرة في قاعدة البيانات بما في ذلك <strong>الصور والمرفقات السحابية</strong>. هذا الملف يستخدم كنسخة أمان مطلقة للتعافي من الكوارث، ويمكن رفعه مستقبلاً عند الانتقال السيرفر.
                        </p>
                    </div>
                    <button
                        onClick={handleBackupJson}
                        className="w-full py-4 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
                    >
                        <Icons.DownloadIcon className="h-5 w-5" />
                        تحميل نسخة قاعدة البيانات الشاملة
                    </button>
                </div>
            </div>

            {/* Restore Section */}
            <div className={`mt-12 pt-8 border-t border-gray-200 dark:border-gray-800 ${isBackingUp ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="bg-red-50 dark:bg-red-900/10 rounded-2xl p-6 border border-red-100 dark:border-red-900/30 flex flex-col md:flex-row items-center gap-6 justify-between">
                    <div>
                        <h3 className="text-xl font-bold text-red-900 dark:text-red-400 mb-2 flex items-center gap-2">
                            <Icons.Trash className="w-6 h-6" /> {/* Using Trash temporarily or we can use Database */}
                            استرداد نظام متكامل (Restore)
                        </h3>
                        <p className="text-red-700 dark:text-red-300 text-sm max-w-2xl leading-relaxed mt-2">
                            اختر نوع الاستعادة المناسب لك: <br />
                            - <strong>استرداد آمن:</strong> يملأ النواقص ويصلح الجداول ولا يمسح البيانات الحديثة.<br />
                            - <strong>استرداد شامل:</strong> (Wipe & Restore) يقوم بفرمتة جميع جداول النظام وإعادة بناءها بالكامل من النسخة المرفوعة لضمان تطابق بنسبة 100٪.
                        </p>
                    </div>

                    <div className="w-full md:w-auto flex-shrink-0 flex flex-col gap-3">
                        <input
                            type="file"
                            accept=".abdz,.zip,.abd"
                            ref={fileInputRef}
                            onChange={handleRestoreInput}
                            className="hidden"
                            id="restore-file-input"
                        />
                        <button
                            onClick={() => { setRestoreMode('safe'); fileInputRef.current?.click(); }}
                            className="w-full px-6 py-3 rounded-xl font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 dark:text-blue-300 dark:bg-blue-900/40 dark:hover:bg-blue-900/60 transition-all flex items-center justify-center gap-2 border border-blue-200 dark:border-blue-800"
                        >
                            <Icons.UploadIcon className="h-5 w-5" />
                            استرداد آمن (ترقيع النواقص)
                        </button>

                        <button
                            onClick={() => { setRestoreMode('wipe'); fileInputRef.current?.click(); }}
                            className="w-full px-6 py-3 rounded-xl font-bold text-red-700 bg-red-100 hover:bg-red-200 dark:text-red-300 dark:bg-red-900/40 dark:hover:bg-red-900/60 transition-all flex items-center justify-center gap-2 border border-red-200 dark:border-red-800"
                        >
                            <Icons.Trash className="h-5 w-5" />
                            استرداد شامل (Wipe & Restore)
                        </button>
                    </div>
                </div>
            </div>

        </div>
    );
};

export default BackupSettingsScreen;
