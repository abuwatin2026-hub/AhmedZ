import * as xlsx from 'xlsx';
import { getSupabaseClient } from '../supabase';
import JSZip from 'jszip';

export interface BackupProgress {
    status: 'idle' | 'fetching_schema' | 'fetching_data' | 'generating_file' | 'completed' | 'error';
    currentTable: string;
    tableProgress: number; // 0 to 100 for current table
    tablesCompleted: number;
    totalTables: number;
    message: string;
}

export interface BackupReadinessReport {
    ok: boolean;
    checks: Array<{ key: string; ok: boolean; message: string }>;
}

type BackupManifest = {
    format_version: '2.0';
    generated_at: string;
    source: string;
    schema_migration_count: number;
    schema_migration_latest: string | null;
    table_count: number;
    row_counts: Record<string, number>;
    storage_files: Array<{ bucket: string; path: string; size?: number | null }>;
};

const chunkArray = <T,>(input: T[], chunkSize: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < input.length; i += chunkSize) out.push(input.slice(i, i + chunkSize));
    return out;
};

const listStorageFilesRecursively = async (supabase: any, bucket: string): Promise<Array<{ bucket: string; path: string; size?: number | null }>> => {
    const results: Array<{ bucket: string; path: string; size?: number | null }> = [];
    const walk = async (prefix: string) => {
        let offset = 0;
        const limit = 100;
        while (true) {
            const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit, offset, sortBy: { column: 'name', order: 'asc' } });
            if (error) throw error;
            const entries = Array.isArray(data) ? data : [];
            for (const entry of entries) {
                const name = String((entry as any)?.name || '');
                if (!name || name === '.emptyFolderPlaceholder') continue;
                const entryPath = prefix ? `${prefix}/${name}` : name;
                const isFolder = (entry as any)?.id == null;
                if (isFolder) await walk(entryPath);
                else {
                    results.push({
                        bucket,
                        path: entryPath,
                        size: typeof (entry as any)?.metadata?.size === 'number' ? (entry as any).metadata.size : null,
                    });
                }
            }
            if (entries.length < limit) break;
            offset += limit;
        }
    };
    await walk('');
    return results;
};

export const checkBackupRestoreReadiness = async (): Promise<BackupReadinessReport> => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not initialized');

    const checks: Array<{ key: string; ok: boolean; message: string }> = [];

    const deepHealth = await supabase.rpc('admin_backup_health_report');
    if (!deepHealth.error && deepHealth.data && typeof deepHealth.data === 'object') {
        const payload = deepHealth.data as any;
        if (Array.isArray(payload.checks)) {
            for (const c of payload.checks) {
                checks.push({
                    key: String(c?.key || 'unknown'),
                    ok: Boolean(c?.ok),
                    message: String(c?.message || ''),
                });
            }
            return {
                ok: checks.every(c => c.ok),
                checks,
            };
        }
    }

    const tableProbe = await supabase.rpc('admin_get_all_tables');
    checks.push({
        key: 'admin_get_all_tables',
        ok: !tableProbe.error && Array.isArray(tableProbe.data),
        message: tableProbe.error ? tableProbe.error.message : `tables: ${Array.isArray(tableProbe.data) ? tableProbe.data.length : 0}`,
    });

    const exportProbe = await supabase.rpc('admin_export_table_data', {
        p_table: 'warehouses',
        p_offset: 0,
        p_limit: 1,
    });
    checks.push({
        key: 'admin_export_table_data',
        ok: !exportProbe.error,
        message: exportProbe.error ? exportProbe.error.message : 'ok',
    });

    checks.push({
        key: 'destructive_restore_rpcs',
        ok: true,
        message: 'skipped in readiness check for safety',
    });

    // Note: listBuckets() requires service_role and returns empty with the anon key.
    // Instead, probe the bucket directly — succeeds even with 0 files if the bucket exists & is accessible.
    const bucketProbe = await supabase.storage.from('automated_backups').list('', { limit: 1 });
    const hasAutomatedBucket = !bucketProbe.error;
    checks.push({
        key: 'automated_backups_bucket',
        ok: hasAutomatedBucket,
        message: bucketProbe.error ? bucketProbe.error.message : 'ok',
    });

    if (hasAutomatedBucket) {
        const objects = Array.isArray(bucketProbe.data) ? bucketProbe.data.length : 0;
        checks.push({
            key: 'automated_backups_latest_object',
            ok: objects > 0,
            message: `objects: ${objects}`,
        });
    }

    return {
        ok: checks.every(c => c.ok),
        checks,
    };
};

export const exportFullSystemBackup = async (
    onProgress: (progress: BackupProgress) => void
): Promise<Blob> => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not initialized');

    onProgress({ status: 'fetching_schema', currentTable: '', tableProgress: 0, tablesCompleted: 0, totalTables: 0, message: 'جاري جلب هيكل قاعدة البيانات...' });

    const { data: tables, error: schemaError } = await supabase.rpc('admin_get_all_tables');
    if (schemaError) throw new Error(schemaError.message || 'فشل في قراءة الجداول، تأكد من الصلاحيات.');
    if (!tables || !Array.isArray(tables)) throw new Error('No tables found or invalid response');

    const totalTables = tables.length;
    const backupData: Record<string, any[]> = {};
    const rowCounts: Record<string, number> = {};

    for (let i = 0; i < totalTables; i++) {
        const table = tables[i];
        onProgress({ status: 'fetching_data', currentTable: table, tableProgress: 0, tablesCompleted: i, totalTables, message: `جاري سحب الجداول: ${table}` });

        const chunkSize = 5000;
        let offset = 0;
        let tableData: any[] = [];
        let hasMore = true;

        while (hasMore) {
            const { data: chunk, error: dataError } = await supabase.rpc('admin_export_table_data', {
                p_table: table,
                p_offset: offset,
                p_limit: chunkSize
            });

            if (dataError) throw new Error(`Failed to fetch data for ${table}: ${dataError.message}`);

            const chunkArray = Array.isArray(chunk) ? chunk : [];
            tableData = tableData.concat(chunkArray);

            if (chunkArray.length < chunkSize) {
                hasMore = false;
            } else {
                offset += chunkSize;
                onProgress({ status: 'fetching_data', currentTable: table, tableProgress: Math.min(99, offset / 1000), tablesCompleted: i, totalTables, message: `جاري سحب بيانات: ${table} (${tableData.length} سجل)` });
            }
        }

        backupData[table] = tableData;
        rowCounts[table] = tableData.length;
    }

    onProgress({ status: 'generating_file', currentTable: '', tableProgress: 100, tablesCompleted: totalTables, totalTables, message: 'جاري تشفير وتجميع الملف...' });

    const finalObject = {
        version: '2.0',
        timestamp: new Date().toISOString(),
        source: 'AhmedZ ERP System Backup',
        data: backupData
    };

    const jsonString = JSON.stringify(finalObject);

    onProgress({ status: 'fetching_data', currentTable: '', tableProgress: 50, tablesCompleted: totalTables, totalTables, message: 'جاري حزم المرفقات والصور السحابية...' });

    const zip = new JSZip();
    zip.file('database.json', jsonString);
    const storageManifest: Array<{ bucket: string; path: string; size?: number | null }> = [];

    try {
        const configuredBuckets = (() => {
            const appSettingsRows = Array.isArray(backupData.app_settings) ? backupData.app_settings : [];
            const row = appSettingsRows.find((r: any) => String(r?.id || '') === 'backup_storage_buckets');
            const list = Array.isArray(row?.data?.buckets) ? row.data.buckets : [];
            return list.map((x: any) => String(x || '').trim()).filter(Boolean);
        })();
        const fetchedBuckets = await supabase.storage.listBuckets();
        const directBuckets = !fetchedBuckets.error && Array.isArray(fetchedBuckets.data)
            ? fetchedBuckets.data.map((b: any) => String(b?.name || '').trim()).filter(Boolean)
            : [];
        const bucketSet = new Set<string>(['automated_backups', ...configuredBuckets, ...directBuckets]);
        for (const bucket of Array.from(bucketSet)) {
            try {
                const objects = await listStorageFilesRecursively(supabase, bucket);
                storageManifest.push(...objects);
            } catch {
            }
        }
        for (const group of chunkArray(storageManifest, 50)) {
            for (const obj of group) {
                const { data: fileData, error: downloadError } = await supabase.storage.from(obj.bucket).download(obj.path);
                if (fileData && !downloadError) {
                    zip.file(`storage/${obj.bucket}/${obj.path}`, fileData);
                }
            }
        }
    } catch (storageError) {
        console.warn('Failed to backup some storage files', storageError);
    }

    const schemaMigrations = Array.isArray(backupData.schema_migrations) ? backupData.schema_migrations : [];
    const migrationStrings = schemaMigrations
        .map((x: any) => String(x?.version || x?.name || x?.id || '').trim())
        .filter(Boolean)
        .sort();
    const manifest: BackupManifest = {
        format_version: '2.0',
        generated_at: new Date().toISOString(),
        source: 'AhmedZ ERP System Backup',
        schema_migration_count: migrationStrings.length,
        schema_migration_latest: migrationStrings.length > 0 ? migrationStrings[migrationStrings.length - 1] : null,
        table_count: Object.keys(backupData).length,
        row_counts: rowCounts,
        storage_files: storageManifest,
    };
    zip.file('manifest.json', JSON.stringify(manifest));

    onProgress({ status: 'generating_file', currentTable: '', tableProgress: 100, tablesCompleted: totalTables, totalTables, message: 'جاري ضغط الملف النهائي للنسخة الاحتياطية...' });

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

    onProgress({ status: 'completed', currentTable: '', tableProgress: 100, tablesCompleted: totalTables, totalTables, message: 'اكتملت عملية النسخ الاحتياطي الشامل بنجاح' });

    return blob;
};

export const exportSummaryAsExcel = async (
    onProgress: (progress: BackupProgress) => void
): Promise<Blob> => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not initialized');

    const tablesToExport = [
        { name: 'items', label: 'الأصناف' },
        { name: 'categories', label: 'الفئات' },
        { name: 'financial_parties', label: 'العملاء والجهات' },
        { name: 'suppliers', label: 'الموردين' },
        { name: 'chart_of_accounts', label: 'دليل الحسابات' },
        { name: 'invoices', label: 'فواتير المبيعات' },
        { name: 'purchases', label: 'فواتير المشتريات' },
        { name: 'inventory_movements', label: 'حركة المخزون' }
    ];

    const totalTables = tablesToExport.length;
    const workbook = xlsx.utils.book_new();

    for (let i = 0; i < totalTables; i++) {
        const tableDef = tablesToExport[i];
        onProgress({ status: 'fetching_data', currentTable: tableDef.label, tableProgress: 0, tablesCompleted: i, totalTables, message: `جاري سحب بيانات: ${tableDef.label}` });

        const { data: chunk, error: dataError } = await supabase.rpc('admin_export_table_data', {
            p_table: tableDef.name,
            p_offset: 0,
            p_limit: 50000
        });

        if (dataError) throw new Error(`Failed to fetch data for ${tableDef.label}: ${dataError.message}`);

        const chunkArray = Array.isArray(chunk) ? chunk : [];

        const flatData = chunkArray.map(row => {
            const flat: any = {};
            for (const key in row) {
                if (typeof row[key] === 'object' && row[key] !== null) {
                    flat[key] = JSON.stringify(row[key]);
                } else {
                    flat[key] = row[key];
                }
            }
            return flat;
        });

        const worksheet = xlsx.utils.json_to_sheet(flatData.length > 0 ? flatData : [{ 'فارغ': 'لا توجد بيانات' }]);

        if (!worksheet['!views']) worksheet['!views'] = [];
        worksheet['!views'].push({ rightToLeft: true });

        xlsx.utils.book_append_sheet(workbook, worksheet, tableDef.label.substring(0, 31));
    }

    onProgress({ status: 'generating_file', currentTable: '', tableProgress: 100, tablesCompleted: totalTables, totalTables, message: 'جاري إنشاء ملف الإكسيل...' });

    const excelBuffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    onProgress({ status: 'completed', currentTable: '', tableProgress: 100, tablesCompleted: totalTables, totalTables, message: 'تم إنشاء تقرير الإكسيل بنجاح' });

    return blob;
};

export const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

export const importSystemBackup = async (
    file: File,
    isWipeRestore: boolean,
    onProgress: (progress: BackupProgress) => void
): Promise<void> => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not initialized');

    onProgress({ status: 'idle', currentTable: '', tableProgress: 0, tablesCompleted: 0, totalTables: 0, message: 'جاري قراءة وفك ضغط الملف...' });

    try {
        let content = '';
        let zip: JSZip | null = null;

        if (file.name.endsWith('.abdz') || file.name.endsWith('.zip')) {
            zip = await JSZip.loadAsync(file);
            const dbFile = zip.file('database.json');
            if (!dbFile) throw new Error('الملف المضغوط لا يحتوي على قاعدة بيانات database.json صالحة.');
            content = await dbFile.async('string');
        } else {
            // Legacy JSON support fallback (.abd)
            content = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target?.result as string);
                reader.onerror = () => reject(new Error('فشل قراءة الملف النصي.'));
                reader.readAsText(file);
            });
        }

        const parsed = JSON.parse(content);

        if (!parsed.version || !parsed.data) {
            throw new Error('الملف غير صالح للاسترداد أو أنه تالف.');
        }
        let manifest: BackupManifest | null = null;
        if (zip && zip.file('manifest.json')) {
            manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as BackupManifest;
            if (manifest.format_version !== '2.0') {
                throw new Error('صيغة manifest غير مدعومة في هذه النسخة.');
            }
        }

        const criticalTables = ['warehouses', 'admin_users', 'menu_items', 'stock_management', 'batches', 'inventory_movements', 'orders', 'purchase_orders'];
        const missingCritical = criticalTables.filter(t => !Array.isArray(parsed.data?.[t]));
        if (missingCritical.length > 0) {
            throw new Error(`النسخة لا تحتوي جداول حرجة: ${missingCritical.join(', ')}`);
        }

        if (isWipeRestore) {
            const readiness = await checkBackupRestoreReadiness();
            const failed = readiness.checks.filter(c => !c.ok);
            if (failed.length > 0) {
                throw new Error(`فحص الجاهزية فشل قبل الاستعادة الشاملة: ${failed.map(f => `${f.key}: ${f.message}`).join(' | ')}`);
            }
            onProgress({ status: 'idle', currentTable: 'WIPE', tableProgress: 0, tablesCompleted: 0, totalTables: 0, message: 'جاري التهيئة والمسح الشامل لقاعدة البيانات...' });
            const { error: wipeError } = await supabase.rpc('admin_wipe_all_tables_for_restore');
            if (wipeError) {
                console.error("Wipe failed", wipeError);
                throw new Error('فشل عملية مسح قاعدة البيانات للتهيئة: ' + wipeError.message);
            }
        }

        const tablesData = parsed.data;

        // Dependency Order (Parent tables first, then children)
        // Comprehensive dependency-ordered list of ALL system tables
        // Parent tables MUST come before their children (FK dependencies)
        const priorityOrder = [
            // ── Tier 0: System config ──
            'app_settings',
            'organization_settings',
            'currencies',
            'fx_rates',
            // ── Tier 1: Core entities ──
            'roles',
            'branches',
            'companies',
            'cost_centers',
            'warehouses',
            'chart_of_accounts',
            // ── Tier 2: Parties & Items ──
            'admin_users',
            'employees',
            'financial_parties',
            'suppliers',
            'customers',
            'categories',
            'menu_items',
            'items',
            'uom',
            'item_uom',
            'item_warehouses',
            // ── Tier 3: Pricing ──
            'product_prices_multi_currency',
            'pricing_tiers',
            'customer_pricing',
            // ── Tier 4: Purchase flow ──
            'purchase_orders',
            'purchase_items',
            'purchase_receipts',
            'purchase_receipt_items',
            // ── Tier 5: Inventory ──
            'stock_management',
            'batches',
            'inventory_movements',
            'order_item_reservations',
            // ── Tier 6: Imports/Shipments ──
            'import_shipments',
            'import_shipments_items',
            'import_expenses',
            // ── Tier 7: Sales flow ──
            'cash_shifts',
            'orders',
            'order_items',
            'order_item_cogs',
            'sales_returns',
            // ── Tier 8: Transfers ──
            'warehouse_transfers',
            'warehouse_transfer_items',
            // ── Tier 9: Accounting ──
            'journal_entries',
            'journal_lines',
            'vouchers',
            'payments',
            'supplier_credit_notes',
            // ── Tier 10: HR/Payroll ──
            'payroll_employees',
            'payroll_runs',
            'payroll_lines',
            'allowance_types',
            'deduction_types',
            'employee_allowances',
            'employee_deductions',
            'attendance_records',
            'employee_contracts',
            'employee_guarantees',
            // ── Tier 10b: Attendance ──
            'attendance_config',
            'attendance_punches',
            'attendance_webauthn_challenges',
            'payroll_attendance',
            // ── Tier 11: Other ──
            'supplier_contracts',
            'supplier_evaluations',
            'notifications',
            'reviews',
            'system_audit_logs',
            'pos_sessions',
            'pos_terminals',
            'stocktaking_sessions',
            'stocktaking_items',
        ];

        const tables = Object.keys(tablesData);
        const sortedTables = tables.sort((a, b) => {
            const idxA = priorityOrder.indexOf(a);
            const idxB = priorityOrder.indexOf(b);
            if (idxA === -1 && idxB === -1) return 0;
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        });

        const totalTables = sortedTables.length;

        for (let i = 0; i < totalTables; i++) {
            const table = sortedTables[i];
            const dataArray = tablesData[table] || [];

            if (!Array.isArray(dataArray) || dataArray.length === 0) {
                onProgress({ status: 'fetching_data', currentTable: table, tableProgress: 100, tablesCompleted: i + 1, totalTables, message: `تجاوز جدول: ${table} (لا يحوي بيانات)` });
                continue;
            }

            onProgress({ status: 'fetching_data', currentTable: table, tableProgress: 0, tablesCompleted: i, totalTables, message: `جاري استرداد جدول: ${table} (${dataArray.length} سجل)` });

            const chunkSize = 2000;
            const chunks = chunkArray(dataArray, chunkSize);
            for (let j = 0; j < chunks.length; j++) {
                const chunk = chunks[j];

                const { data: res, error } = await supabase.rpc('admin_import_table_data', {
                    p_table: table,
                    p_data: chunk
                });

                if (error || (res && res.status === 'error')) {
                    console.error(`Restore error on table ${table}:`, error || res);
                    throw new Error(`تعذر استرداد جدول ${table}. التفاصيل: ${error?.message || res?.message}`);
                }

                const imported = Math.min(dataArray.length, (j + 1) * chunkSize);
                onProgress({ status: 'fetching_data', currentTable: table, tableProgress: Math.min(100, (imported / dataArray.length) * 100), tablesCompleted: i, totalTables, message: `جاري استرداد بيانات ${table} (${imported} / ${dataArray.length})` });
            }
        }

        if (zip) {
            onProgress({ status: 'fetching_data', currentTable: 'المرفقات', tableProgress: 0, tablesCompleted: totalTables, totalTables, message: 'جاري استرداد الملفات والمرفقات السحابية...' });
            const storageRegex = /^storage\/([^\/]+)\/(.*)$/;
            for (const relativePath of Object.keys(zip.files)) {
                const match = relativePath.match(storageRegex);
                if (match && !zip.files[relativePath].dir) {
                    const bucketName = match[1];
                    const fileName = match[2];
                    const fileData = await zip.files[relativePath].async('blob');
                    await supabase.storage.from(bucketName).upload(fileName, fileData, {
                        upsert: true
                    });
                }
            }
        }

        if (manifest && manifest.table_count > 0) {
            const restoredTables = Object.keys(parsed.data || {}).length;
            if (restoredTables < Math.min(manifest.table_count, 5)) {
                throw new Error('نتيجة الاستعادة أقل من المتوقع مقارنة ببيانات manifest.');
            }
        }

        onProgress({ status: 'generating_file', currentTable: '', tableProgress: 90, tablesCompleted: totalTables, totalTables, message: 'جاري إعادة حساب التكاليف والأرصدة...' });
        try {
            await supabase.rpc('admin_post_restore_resync');
        } catch (resyncErr) {
            console.warn('Post-restore resync warning (non-fatal):', resyncErr);
        }

        onProgress({ status: 'completed', currentTable: '', tableProgress: 100, tablesCompleted: totalTables, totalTables, message: 'تمت عملية الاسترداد الشامل بنجاح!' });
    } catch (error: any) {
        throw error;
    }
};
