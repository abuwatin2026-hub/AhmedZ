import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import * as Icons from '../../components/icons';
import { getSupabaseClient } from '../../supabase';
import { localizeSupabaseError } from '../../utils/errorUtils';

type PaletteAction =
    | { kind: 'nav'; id: string; label: string; to: string; keywords?: string[]; enabled?: boolean }
    | { kind: 'searchShipment'; id: string; label: string; keywords?: string[]; enabled?: boolean };

const isUuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? '').trim());

const AdminCommandPalette: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { hasPermission } = useAuth();
    const { showNotification } = useToast();
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        const t = window.setTimeout(() => inputRef.current?.focus(), 50);
        return () => window.clearTimeout(t);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    const baseActions: PaletteAction[] = useMemo(() => {
        const canOrders = hasPermission('orders.view');
        const canPurchases = hasPermission('stock.manage');
        const canShipments = hasPermission('shipments.view') || hasPermission('stock.manage');
        const canStock = hasPermission('inventory.view') || hasPermission('stock.manage');
        const canReports = hasPermission('reports.view');
        const canPos = hasPermission('orders.createInStore') || hasPermission('orders.updateStatus.all');

        return [
            { kind: 'nav', id: 'nav-workspace', label: 'مركز العمل', to: '/admin/workspace', keywords: ['workspace', 'home', 'مركز', 'عمل'] },
            { kind: 'nav', id: 'nav-orders', label: 'إدارة الطلبات', to: '/admin/orders', enabled: canOrders, keywords: ['orders', 'sales', 'طلبات', 'مبيعات'] },
            { kind: 'nav', id: 'nav-pos', label: 'نقطة البيع (POS)', to: '/pos', enabled: canPos, keywords: ['pos', 'بيع', 'كاشير'] },
            { kind: 'nav', id: 'nav-purchases', label: 'المشتريات', to: '/admin/purchases', enabled: canPurchases, keywords: ['purchases', 'po', 'مشتريات', 'أوامر شراء'] },
            { kind: 'nav', id: 'nav-shipments', label: 'الشحنات', to: '/admin/import-shipments', enabled: canShipments, keywords: ['shipments', 'imports', 'شحنات', 'استيراد'] },
            { kind: 'nav', id: 'nav-stock', label: 'المخزون', to: '/admin/stock', enabled: canStock, keywords: ['stock', 'inventory', 'مخزون'] },
            { kind: 'nav', id: 'nav-reports', label: 'التقارير', to: '/admin/reports', enabled: canReports, keywords: ['reports', 'تقارير'] },
            { kind: 'nav', id: 'nav-help', label: 'دليل الاستخدام', to: '/help', keywords: ['help', 'guide', 'مساعدة', 'دليل'] },
            { kind: 'searchShipment', id: 'search-shipment', label: 'بحث عن شحنة بالمرجع', enabled: canShipments, keywords: ['shipment', 'search', 'شحنة', 'مرجع'] },
        ];
    }, [hasPermission]);

    const dynamicActions: PaletteAction[] = useMemo(() => {
        const q = query.trim();
        if (!q) return [];
        const list: PaletteAction[] = [];
        if (isUuid(q) && hasPermission('orders.view')) {
            list.push({ kind: 'nav', id: 'nav-invoice', label: `فتح فاتورة الطلب: ${q.slice(-8)}`, to: `/admin/invoice/${q}`, keywords: ['invoice', 'فاتورة'] });
        }
        if (isUuid(q) && (hasPermission('shipments.view') || hasPermission('stock.manage'))) {
            list.push({ kind: 'nav', id: 'nav-shipment-id', label: `فتح الشحنة بالمعرف: ${q.slice(-8)}`, to: `/admin/import-shipments/${q}`, keywords: ['shipment', 'شحنة'] });
        }
        return list;
    }, [query, hasPermission]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const all = [...dynamicActions, ...baseActions].filter((a) => (a as any).enabled !== false);
        if (!q) return all.slice(0, 10);
        const scored = all
            .map((a) => {
                const label = a.label.toLowerCase();
                const kws = Array.isArray((a as any).keywords) ? ((a as any).keywords as string[]).join(' ').toLowerCase() : '';
                const hit = label.includes(q) || kws.includes(q);
                const prefix = label.startsWith(q) || kws.startsWith(q);
                const score = prefix ? 2 : hit ? 1 : 0;
                return { a, score };
            })
            .filter((x) => x.score > 0)
            .sort((x, y) => y.score - x.score)
            .map((x) => x.a);
        return scored.slice(0, 10);
    }, [query, baseActions, dynamicActions]);

    const runAction = async (action: PaletteAction) => {
        if (busy) return;
        if (action.kind === 'nav') {
            if (action.to === location.pathname) {
                onClose();
                return;
            }
            navigate(action.to);
            onClose();
            return;
        }
        if (action.kind === 'searchShipment') {
            const q = query.trim();
            if (!q) {
                showNotification('اكتب رقم الشحنة/المرجع ثم أعد المحاولة.', 'info');
                return;
            }
            const supabase = getSupabaseClient();
            if (!supabase) return;
            setBusy(true);
            try {
                const { data, error } = await supabase
                    .from('import_shipments')
                    .select('id,reference_number')
                    .ilike('reference_number', `%${q}%`)
                    .order('created_at', { ascending: false })
                    .limit(1);
                if (error) throw error;
                const row = Array.isArray(data) ? data[0] : null;
                if (!row?.id) {
                    showNotification('لم يتم العثور على شحنة بهذا المرجع.', 'info');
                    return;
                }
                navigate(`/admin/import-shipments/${row.id}`);
                onClose();
            } catch (e: any) {
                showNotification(localizeSupabaseError(e) || 'فشل البحث عن الشحنة.', 'error');
            } finally {
                setBusy(false);
            }
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[100] bg-black/40 flex items-start justify-center px-4 pt-16"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="flex items-center gap-2 p-3 border-b border-gray-200 dark:border-gray-700">
                    <Icons.Search className="h-5 w-5 text-gray-500 dark:text-gray-300" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="ابحث أو اكتب رقم شحنة/معرف طلب..."
                        className="w-full bg-transparent outline-none text-gray-900 dark:text-white placeholder:text-gray-400"
                    />
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">Esc</div>
                </div>

                <div className="max-h-[60vh] overflow-auto">
                    {filtered.length === 0 ? (
                        <div className="p-4 text-sm text-gray-600 dark:text-gray-300">لا توجد نتائج</div>
                    ) : (
                        filtered.map((a) => (
                            <button
                                key={a.id}
                                type="button"
                                onClick={() => { void runAction(a); }}
                                disabled={busy}
                                className="w-full text-right px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 border-b border-gray-100 dark:border-gray-700 last:border-0 disabled:opacity-60"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="font-semibold text-gray-900 dark:text-white">{a.label}</div>
                                    {a.kind === 'searchShipment' ? (
                                        <span className="text-xs text-gray-500 dark:text-gray-400">بحث</span>
                                    ) : (
                                        <span className="text-xs text-gray-500 dark:text-gray-400">فتح</span>
                                    )}
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdminCommandPalette;
