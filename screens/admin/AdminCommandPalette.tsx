import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import * as Icons from '../../components/icons';
import { getSupabaseClient } from '../../supabase';
import { printPaymentVoucherByPaymentId, printReceiptVoucherByPaymentId } from '../../utils/vouchers';
import { localizeSupabaseError } from '../../utils/errorUtils';

type PaletteAction =
    | { kind: 'nav'; id: string; label: string; to: string; keywords?: string[]; enabled?: boolean; tag?: string; description?: string }
    | { kind: 'searchShipment'; id: string; label: string; keywords?: string[]; enabled?: boolean }
    | { kind: 'searchPurchaseOrder'; id: string; label: string; keywords?: string[]; enabled?: boolean }
    | { kind: 'printPayment'; id: string; label: string; paymentId: string; direction: 'in' | 'out'; enabled?: boolean; tag?: string; description?: string };

const isUuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? '').trim());

const AdminCommandPalette: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { hasPermission } = useAuth();
    const { showNotification } = useToast();
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(false);
    const [remoteResults, setRemoteResults] = useState<PaletteAction[]>([]);
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
        const canCustomers = hasPermission('customers.manage') || hasPermission('orders.view');
        const canPos = hasPermission('orders.createInStore') || hasPermission('orders.updateStatus.all');
        const canAccounting = hasPermission('accounting.view') || hasPermission('accounting.manage');

        return [
            { kind: 'nav', id: 'nav-workspace', label: 'مركز العمل', to: '/admin/workspace', keywords: ['workspace', 'home', 'مركز', 'عمل'] },
            { kind: 'nav', id: 'nav-orders', label: 'إدارة الطلبات', to: '/admin/orders', enabled: canOrders, keywords: ['orders', 'sales', 'طلبات', 'مبيعات'] },
            { kind: 'nav', id: 'nav-pos', label: 'نقطة البيع (POS)', to: '/pos', enabled: canPos, keywords: ['pos', 'بيع', 'كاشير'] },
            { kind: 'nav', id: 'nav-purchases', label: 'المشتريات', to: '/admin/purchases', enabled: canPurchases, keywords: ['purchases', 'po', 'مشتريات', 'أوامر شراء'] },
            { kind: 'nav', id: 'nav-shipments', label: 'الشحنات', to: '/admin/import-shipments', enabled: canShipments, keywords: ['shipments', 'imports', 'شحنات', 'استيراد'] },
            { kind: 'nav', id: 'nav-stock', label: 'المخزون', to: '/admin/stock', enabled: canStock, keywords: ['stock', 'inventory', 'مخزون'] },
            { kind: 'nav', id: 'nav-customers', label: 'العملاء', to: '/admin/customers', enabled: canCustomers, keywords: ['customers', 'clients', 'عملاء', 'زبائن'] },
            { kind: 'nav', id: 'nav-reports', label: 'التقارير', to: '/admin/reports', enabled: canReports, keywords: ['reports', 'تقارير'] },
            { kind: 'nav', id: 'nav-help', label: 'دليل الاستخدام', to: '/help', keywords: ['help', 'guide', 'مساعدة', 'دليل'] },
            { kind: 'searchShipment', id: 'search-shipment', label: 'بحث عن شحنة بالمرجع', enabled: canShipments, keywords: ['shipment', 'search', 'شحنة', 'مرجع'] },
            { kind: 'searchPurchaseOrder', id: 'search-po', label: 'بحث عن أمر شراء (PO) بالرقم/الفاتورة', enabled: canPurchases, keywords: ['po', 'purchase', 'order', 'مشتريات', 'أمر شراء', 'فاتورة المورد'] },
            { kind: 'nav', id: 'nav-accounting', label: 'المحاسبة', to: '/admin/accounting', enabled: canAccounting, keywords: ['accounting', 'finance', 'محاسبة', 'قيود'] },
        ];
    }, [hasPermission]);

    const dynamicActions: PaletteAction[] = useMemo(() => {
        const q = query.trim();
        if (!q) return [];
        const list: PaletteAction[] = [];
        if (isUuid(q) && hasPermission('orders.view')) {
            list.push({ kind: 'nav', id: 'nav-order-focus', label: `فتح الطلب: ${q.slice(-8)}`, to: `/admin/orders?orderId=${q}`, keywords: ['order', 'طلب'] });
        }
        if (isUuid(q) && hasPermission('orders.view')) {
            list.push({ kind: 'nav', id: 'nav-invoice', label: `فتح فاتورة الطلب: ${q.slice(-8)}`, to: `/admin/invoice/${q}`, keywords: ['invoice', 'فاتورة'] });
        }
        if (isUuid(q) && (hasPermission('shipments.view') || hasPermission('stock.manage'))) {
            list.push({ kind: 'nav', id: 'nav-shipment-id', label: `فتح الشحنة بالمعرف: ${q.slice(-8)}`, to: `/admin/import-shipments/${q}`, keywords: ['shipment', 'شحنة'] });
        }
        if (isUuid(q) && hasPermission('stock.manage')) {
            list.push({ kind: 'nav', id: 'nav-po-focus', label: `فتح أمر الشراء: ${q.slice(-8)}`, to: `/admin/purchases?focusPoId=${q}`, keywords: ['po', 'purchase', 'أمر شراء'] });
        }
        return list;
    }, [query, hasPermission]);

    useEffect(() => {
        if (!isOpen) return;
        const q = query.trim();
        if (!q) {
            setRemoteResults([]);
            return;
        }

        const supabase = getSupabaseClient();
        if (!supabase) {
            setRemoteResults([]);
            return;
        }

        const canOrders = hasPermission('orders.view');
        const canPurchases = hasPermission('stock.manage');
        const canShipments = hasPermission('shipments.view') || hasPermission('stock.manage');
        const canCustomers = hasPermission('customers.manage') || hasPermission('orders.view');
        const canAccounting = hasPermission('accounting.view') || hasPermission('accounting.manage');

        let cancelled = false;
        const t = window.setTimeout(async () => {
            setBusy(true);
            try {
                const next: PaletteAction[] = [];

                if (canOrders) {
                    const { data, error } = await supabase
                        .from('orders')
                        .select('id,invoice_number,status,created_at,data')
                        .ilike('invoice_number', `%${q}%`)
                        .order('created_at', { ascending: false })
                        .limit(6);
                    if (error) throw error;
                    for (const row of (Array.isArray(data) ? data : [])) {
                        const id = String((row as any)?.id || '').trim();
                        const inv = String((row as any)?.invoice_number || '').trim();
                        const customerName = String((row as any)?.data?.customerName || (row as any)?.data?.invoiceSnapshot?.customerName || '').trim();
                        const status = String((row as any)?.status || '').trim();
                        if (!id) continue;
                        next.push({
                            kind: 'nav',
                            id: `order-${id}`,
                            label: inv ? `فاتورة: ${inv}` : `طلب: ${id.slice(-8)}`,
                            description: [customerName, status].filter(Boolean).join(' • ') || undefined,
                            to: `/admin/invoice/${id}`,
                            tag: 'طلب',
                        });
                    }
                }

                if (canCustomers) {
                    const { data, error } = await supabase
                        .from('customers')
                        .select('auth_user_id,full_name,phone_number,email')
                        .or(`phone_number.ilike.%${q}%,full_name.ilike.%${q}%,email.ilike.%${q}%`)
                        .limit(6);
                    if (error) throw error;
                    for (const row of (Array.isArray(data) ? data : [])) {
                        const id = String((row as any)?.auth_user_id || '').trim();
                        const name = String((row as any)?.full_name || '').trim();
                        const phone = String((row as any)?.phone_number || '').trim();
                        const email = String((row as any)?.email || '').trim();
                        if (!id) continue;
                        next.push({
                            kind: 'nav',
                            id: `customer-${id}`,
                            label: name ? `عميل: ${name}` : `عميل: ${id.slice(-8)}`,
                            description: (phone || email) ? [phone, email].filter(Boolean).join(' • ') : undefined,
                            to: `/admin/customers?focusCustomerId=${id}`,
                            tag: 'عميل',
                        });
                    }
                }

                if (canPurchases) {
                    const { data, error } = await supabase
                        .from('suppliers')
                        .select('id,name,phone,contact_person')
                        .or(`name.ilike.%${q}%,phone.ilike.%${q}%,contact_person.ilike.%${q}%`)
                        .order('created_at', { ascending: false })
                        .limit(6);
                    if (error) throw error;
                    for (const row of (Array.isArray(data) ? data : [])) {
                        const id = String((row as any)?.id || '').trim();
                        const name = String((row as any)?.name || '').trim();
                        const phone = String((row as any)?.phone || '').trim();
                        const person = String((row as any)?.contact_person || '').trim();
                        if (!id) continue;
                        next.push({
                            kind: 'nav',
                            id: `supplier-${id}`,
                            label: name ? `مورد: ${name}` : `مورد: ${id.slice(-8)}`,
                            description: [person, phone].filter(Boolean).join(' • ') || undefined,
                            to: `/admin/suppliers?focusSupplierId=${id}`,
                            tag: 'مورد',
                        });
                    }
                }

                if (canPurchases) {
                    const { data, error } = await supabase
                        .from('purchase_orders')
                        .select('id,po_number,reference_number,status,created_at')
                        .or(`po_number.ilike.%${q}%,reference_number.ilike.%${q}%`)
                        .order('created_at', { ascending: false })
                        .limit(6);
                    if (error) throw error;
                    for (const row of (Array.isArray(data) ? data : [])) {
                        const id = String((row as any)?.id || '').trim();
                        const po = String((row as any)?.po_number || '').trim();
                        const ref = String((row as any)?.reference_number || '').trim();
                        const status = String((row as any)?.status || '').trim();
                        if (!id) continue;
                        next.push({
                            kind: 'nav',
                            id: `po-${id}`,
                            label: po ? `أمر شراء: ${po}` : (ref ? `أمر شراء: ${ref}` : `أمر شراء: ${id.slice(-8)}`),
                            description: status || undefined,
                            to: `/admin/purchases?focusPoId=${id}`,
                            tag: 'مشتريات',
                        });
                    }
                }

                if (canShipments) {
                    const { data, error } = await supabase
                        .from('import_shipments')
                        .select('id,reference_number,status,created_at')
                        .ilike('reference_number', `%${q}%`)
                        .order('created_at', { ascending: false })
                        .limit(6);
                    if (error) throw error;
                    for (const row of (Array.isArray(data) ? data : [])) {
                        const id = String((row as any)?.id || '').trim();
                        const ref = String((row as any)?.reference_number || '').trim();
                        const status = String((row as any)?.status || '').trim();
                        if (!id) continue;
                        next.push({
                            kind: 'nav',
                            id: `shipment-${id}`,
                            label: ref ? `شحنة: ${ref}` : `شحنة: ${id.slice(-8)}`,
                            description: status || undefined,
                            to: `/admin/import-shipments/${id}`,
                            tag: 'شحنة',
                        });
                    }
                }

                if (canAccounting) {
                    const paymentOr = [
                        `reference_id.ilike.%${q}%`,
                        `method.ilike.%${q}%`,
                        `data->>referenceNumber.ilike.%${q}%`,
                        `data->>senderPhone.ilike.%${q}%`,
                        `data->>senderPhoneNumber.ilike.%${q}%`,
                    ].join(',');
                    const { data, error } = await supabase
                        .from('payments')
                        .select('id,direction,method,amount,currency,occurred_at,reference_table,reference_id,data')
                        .or(paymentOr)
                        .order('occurred_at', { ascending: false })
                        .limit(6);
                    if (error) throw error;
                    for (const row of (Array.isArray(data) ? data : [])) {
                        const id = String((row as any)?.id || '').trim();
                        const direction = (String((row as any)?.direction || '') === 'in' ? 'in' : 'out') as 'in' | 'out';
                        const method = String((row as any)?.method || '').trim();
                        const amount = Number((row as any)?.amount || 0);
                        const currency = String((row as any)?.currency || '').trim().toUpperCase();
                        const refNo = String((row as any)?.data?.referenceNumber || '').trim();
                        const refTable = String((row as any)?.reference_table || '').trim();
                        const refId = String((row as any)?.reference_id || '').trim();
                        if (!id) continue;
                        next.push({
                            kind: 'printPayment',
                            id: `pay-${id}`,
                            paymentId: id,
                            direction,
                            label: direction === 'in' ? `سند قبض: ${id.slice(-8)}` : `سند صرف: ${id.slice(-8)}`,
                            description: [`${amount.toLocaleString('ar-EG-u-nu-latn')} ${currency || ''}`.trim(), method, refNo || undefined, (refTable && refId) ? `${refTable}:${refId.slice(-8)}` : undefined].filter(Boolean).join(' • ') || undefined,
                            tag: 'دفعة',
                        });
                    }
                }

                const deduped = Array.from(new Map(next.map((x) => [x.id, x])).values());
                if (!cancelled) setRemoteResults(deduped);
            } catch (e: any) {
                if (!cancelled) setRemoteResults([]);
            } finally {
                if (!cancelled) setBusy(false);
            }
        }, 220);

        return () => {
            cancelled = true;
            window.clearTimeout(t);
        };
    }, [hasPermission, isOpen, query]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const all = [...dynamicActions, ...baseActions].filter((a) => (a as any).enabled !== false);
        if (!q) return all.slice(0, 10);

        const scoredBase = all
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
        const remote = Array.isArray(remoteResults) ? remoteResults : [];
        const merged = [...remote, ...scoredBase].slice(0, 20);
        return merged;
    }, [query, baseActions, dynamicActions, remoteResults]);

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
        if (action.kind === 'printPayment') {
            const pid = String(action.paymentId || '').trim();
            if (!pid) return;
            setBusy(true);
            try {
                if (action.direction === 'in') {
                    await printReceiptVoucherByPaymentId(pid);
                } else {
                    await printPaymentVoucherByPaymentId(pid);
                }
                onClose();
            } catch (e: any) {
                showNotification(localizeSupabaseError(e) || 'فشل طباعة السند.', 'error');
            } finally {
                setBusy(false);
            }
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
        if (action.kind === 'searchPurchaseOrder') {
            const q = query.trim();
            if (!q) {
                showNotification('اكتب رقم أمر الشراء/فاتورة المورد ثم أعد المحاولة.', 'info');
                return;
            }
            const supabase = getSupabaseClient();
            if (!supabase) return;
            setBusy(true);
            try {
                const { data, error } = await supabase
                    .from('purchase_orders')
                    .select('id,reference_number,po_number')
                    .or(`reference_number.ilike.%${q}%,po_number.ilike.%${q}%`)
                    .order('created_at', { ascending: false })
                    .limit(1);
                if (error) throw error;
                const row = Array.isArray(data) ? data[0] : null;
                const poId = String((row as any)?.id || '').trim();
                if (!poId) {
                    showNotification('لم يتم العثور على أمر شراء بهذا الرقم.', 'info');
                    return;
                }
                navigate(`/admin/purchases?focusPoId=${poId}`);
                onClose();
            } catch (e: any) {
                showNotification(localizeSupabaseError(e) || 'فشل البحث عن أمر الشراء.', 'error');
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
                        placeholder="ابحث: هاتف عميل • رقم فاتورة • PO • شحنة • مورد • دفعة..."
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
                                    <div className="min-w-0">
                                        <div className="font-semibold text-gray-900 dark:text-white truncate">{a.label}</div>
                                        {'description' in a && a.description ? (
                                            <div className="text-xs text-gray-600 dark:text-gray-300 truncate mt-1">{a.description}</div>
                                        ) : null}
                                    </div>
                                    <div className="shrink-0 flex items-center gap-2">
                                        {'tag' in a && a.tag ? (
                                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                                                {a.tag}
                                            </span>
                                        ) : null}
                                        {a.kind === 'searchShipment' || a.kind === 'searchPurchaseOrder' ? (
                                            <span className="text-xs text-gray-500 dark:text-gray-400">بحث</span>
                                        ) : a.kind === 'printPayment' ? (
                                            <span className="text-xs text-gray-500 dark:text-gray-400">طباعة</span>
                                        ) : (
                                            <span className="text-xs text-gray-500 dark:text-gray-400">فتح</span>
                                        )}
                                    </div>
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
