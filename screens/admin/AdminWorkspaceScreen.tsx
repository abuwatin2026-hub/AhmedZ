import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrders } from '../../contexts/OrderContext';
import { usePurchases } from '../../contexts/PurchasesContext';
import { useImport } from '../../contexts/ImportContext';
import { useAuth } from '../../contexts/AuthContext';
import * as Icons from '../../components/icons';

type RecentRoute = { path: string; label: string; at?: string };

const AdminWorkspaceScreen: React.FC = () => {
    const navigate = useNavigate();
    const { orders } = useOrders();
    const { purchaseOrders } = usePurchases();
    const { shipments } = useImport();
    const { hasPermission } = useAuth();
    const [recentRoutes, setRecentRoutes] = useState<RecentRoute[]>([]);

    useEffect(() => {
        const read = () => {
            try {
                const raw = localStorage.getItem('admin_recent_routes');
                const arr = JSON.parse(raw || '[]');
                const list = Array.isArray(arr) ? arr : [];
                const normalized = list
                    .map((x: any) => ({ path: String(x?.path || ''), label: String(x?.label || ''), at: typeof x?.at === 'string' ? x.at : undefined }))
                    .filter((x: RecentRoute) => x.path && x.label)
                    .slice(0, 6);
                setRecentRoutes(normalized);
            } catch {
                setRecentRoutes([]);
            }
        };
        read();
        const onStorage = (e: StorageEvent) => {
            if (e.key === 'admin_recent_routes') read();
        };
        const onCustom = () => read();
        window.addEventListener('storage', onStorage);
        window.addEventListener('admin:recentRoutesUpdated', onCustom as any);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('admin:recentRoutesUpdated', onCustom as any);
        };
    }, []);

    const quickStats = useMemo(() => {
        const list = Array.isArray(orders) ? orders : [];
        const pending = list.filter((o: any) => o?.status === 'pending').length;
        const preparing = list.filter((o: any) => o?.status === 'preparing').length;
        const outForDelivery = list.filter((o: any) => o?.status === 'out_for_delivery').length;
        const delivered = list.filter((o: any) => o?.status === 'delivered').length;
        return { pending, preparing, outForDelivery, delivered };
    }, [orders]);

    const purchaseStats = useMemo(() => {
        const list = Array.isArray(purchaseOrders) ? purchaseOrders : [];
        const draft = list.filter((o: any) => o?.status === 'draft').length;
        const partial = list.filter((o: any) => o?.status === 'partial').length;
        const completed = list.filter((o: any) => o?.status === 'completed').length;
        return { draft, partial, completed };
    }, [purchaseOrders]);

    const shipmentStats = useMemo(() => {
        const list = Array.isArray(shipments) ? shipments : [];
        const open = list.filter((s: any) => String(s?.status || '') !== 'closed' && String(s?.status || '') !== 'cancelled').length;
        const closed = list.filter((s: any) => String(s?.status || '') === 'closed').length;
        return { open, closed };
    }, [shipments]);

    const openPalette = () => {
        try {
            window.dispatchEvent(new CustomEvent('admin:commandPaletteOpen'));
        } catch {
        }
    };

    const cards: Array<{
        title: string;
        subtitle: string;
        to: string;
        visible: boolean;
        icon: React.ReactNode;
        accent: string;
    }> = [
        {
            title: 'بحث موحّد',
            subtitle: 'Ctrl+K للتنقل السريع والبحث بالمعرف/المرجع',
            to: '',
            visible: true,
            icon: <Icons.Search className="h-6 w-6" />,
            accent: 'bg-indigo-600',
        },
        {
            title: 'المبيعات والطلبات',
            subtitle: `قيد الانتظار: ${quickStats.pending} • التحضير: ${quickStats.preparing}`,
            to: '/admin/orders',
            visible: hasPermission('orders.view'),
            icon: <Icons.OrdersIcon className="h-6 w-6" />,
            accent: 'bg-blue-600',
        },
        {
            title: 'نقطة البيع (POS)',
            subtitle: 'بيع سريع في المتجر',
            to: '/pos',
            visible: hasPermission('orders.createInStore') || hasPermission('orders.updateStatus.all'),
            icon: <Icons.CartIcon className="h-6 w-6" />,
            accent: 'bg-emerald-600',
        },
        {
            title: 'المشتريات',
            subtitle: `مسودة: ${purchaseStats.draft} • استلام جزئي: ${purchaseStats.partial}`,
            to: '/admin/purchases',
            visible: hasPermission('stock.manage'),
            icon: <Icons.ReportIcon className="h-6 w-6" />,
            accent: 'bg-amber-600',
        },
        {
            title: 'الشحنات',
            subtitle: `مفتوحة: ${shipmentStats.open} • مغلقة: ${shipmentStats.closed}`,
            to: '/admin/import-shipments',
            visible: hasPermission('shipments.view') || hasPermission('stock.manage'),
            icon: <Icons.Package className="h-6 w-6" />,
            accent: 'bg-violet-600',
        },
        {
            title: 'المخزون',
            subtitle: 'رصيد الأصناف وحركات المخزون',
            to: '/admin/stock',
            visible: hasPermission('inventory.view') || hasPermission('stock.manage'),
            icon: <Icons.ListIcon className="h-6 w-6" />,
            accent: 'bg-slate-700',
        },
        {
            title: 'التقارير',
            subtitle: 'مبيعات • منتجات • مالية',
            to: '/admin/reports',
            visible: hasPermission('reports.view'),
            icon: <Icons.ReportIcon className="h-6 w-6" />,
            accent: 'bg-gray-900',
        },
    ];

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">مركز العمل</h2>
                        <div className="text-sm text-gray-600 dark:text-gray-300">كل المهام اليومية في مكان واحد</div>
                    </div>
                    <button
                        type="button"
                        onClick={openPalette}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                        <Icons.Search className="h-5 w-5" />
                        <span className="font-semibold">بحث موحّد (Ctrl+K)</span>
                    </button>
                </div>
            </div>

            {recentRoutes.length > 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between">
                        <div className="font-bold text-gray-900 dark:text-white">آخر الصفحات</div>
                        <button
                            type="button"
                            onClick={() => {
                                try {
                                    localStorage.removeItem('admin_recent_routes');
                                    window.dispatchEvent(new CustomEvent('admin:recentRoutesUpdated'));
                                } catch {
                                }
                            }}
                            className="text-xs text-gray-600 dark:text-gray-300 hover:underline"
                        >
                            مسح
                        </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {recentRoutes.map((r) => (
                            <button
                                key={r.path}
                                type="button"
                                onClick={() => navigate(r.path)}
                                className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-sm font-semibold text-gray-800 dark:text-gray-200"
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {cards.filter(c => c.visible).map((c) => (
                    <button
                        key={c.title}
                        type="button"
                        onClick={() => {
                            if (!c.to) {
                                openPalette();
                                return;
                            }
                            navigate(c.to);
                        }}
                        className="text-right bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:shadow-md transition-shadow"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-lg font-bold text-gray-900 dark:text-white">{c.title}</div>
                                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{c.subtitle}</div>
                            </div>
                            <div className={`shrink-0 text-white ${c.accent} rounded-lg p-3`}>
                                {c.icon}
                            </div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default AdminWorkspaceScreen;
