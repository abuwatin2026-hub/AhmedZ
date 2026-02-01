import React, { useEffect, useState, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useToast } from '../../contexts/ToastContext';
import * as Icons from '../../components/icons';
import Notification from '../../components/Notification';
import ConnectivityBanner from '../../components/ConnectivityBanner';
import type { AdminPermission } from '../../types';
import type { AdminRole } from '../../types';
import { useSettings } from '../../contexts/SettingsContext';
import ShiftManagementModal from '../../components/admin/ShiftManagementModal';
import { useCashShift } from '../../contexts/CashShiftContext';

const AdminNotificationMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotification();
  const { user: adminUser } = useAuth();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const resolveLink = (link?: string) => {
    const raw = typeof link === 'string' ? link : '';
    const m = /^\/order\/([0-9a-f-]+)/i.exec(raw);
    if (m && adminUser) {
      const targetOrderId = m[1];
      return `/admin/orders?orderId=${targetOrderId}`;
    }
    return raw || '#';
  };

  const handleNotificationClick = async (id: string) => {
    await markAsRead(id);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        title="الإشعارات"
        className="relative text-gray-600 dark:text-gray-300 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 bg-red-600 text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center font-bold">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed left-4 right-4 top-16 sm:absolute sm:left-auto sm:right-auto sm:top-auto sm:mt-2 sm:w-80 sm:ltr:right-0 sm:rtl:left-0 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 max-h-[calc(100dvh-6rem)] sm:max-h-96 overflow-y-auto">
          <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
            <h3 className="font-bold text-gray-800 dark:text-gray-200">الإشعارات</h3>
            {unreadCount > 0 && (
              <button onClick={markAllAsRead} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
                تحديد الكل كمقروء
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-500 dark:text-gray-400 text-sm">
              لا توجد إشعارات حالياً
            </div>
          ) : (
            notifications.map(note => (
              <Link
                key={note.id}
                to={resolveLink(note.link)}
                onClick={() => handleNotificationClick(note.id)}
                className={`block px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 last:border-0 ${!note.isRead ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
              >
                <div className="flex justify-between items-start mb-1">
                  <p className={`text-sm font-semibold ${!note.isRead ? 'text-blue-800 dark:text-blue-300' : 'text-gray-800 dark:text-gray-300'}`}>
                    {note.title}
                  </p>
                  <span className="text-[10px] text-gray-400">
                    {new Date(note.createdAt).toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                  {note.message}
                </p>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const navLinks: Array<{ to: string; label: string; icon: React.ReactNode; permission: AdminPermission }> = [
  { to: 'dashboard', label: 'لوحة التحكم', icon: <Icons.DashboardIcon />, permission: 'dashboard.view' },
  { to: 'stock', label: 'إدارة المخزون', icon: <Icons.ListIcon />, permission: 'inventory.view' },
  { to: 'wastage', label: 'تسجيل هدر', icon: <Icons.ReportIcon />, permission: 'stock.manage' },
  { to: 'expiry-batches', label: 'دفعات منتهية', icon: <Icons.ClockIcon />, permission: 'stock.manage' },
  { to: 'wastage-expiry-reports', label: 'تقارير الهدر/الانتهاء', icon: <Icons.ReportIcon />, permission: 'inventory.movements.view' },
  { to: 'suppliers', label: 'الموردين', icon: <Icons.TruckIcon />, permission: 'stock.manage' },
  { to: 'supplier-contracts', label: 'عقود الموردين', icon: <Icons.FileText />, permission: 'stock.manage' },
  { to: 'supplier-evaluations', label: 'تقييم الموردين', icon: <Icons.StarIcon />, permission: 'stock.manage' },
  { to: 'purchases', label: 'المشتريات', icon: <Icons.ReportIcon />, permission: 'stock.manage' },
  { to: 'import-shipments', label: 'الشحنات', icon: <Icons.Package />, permission: 'shipments.view' },
  { to: 'warehouses', label: 'المستودعات', icon: <Icons.Package />, permission: 'stock.manage' },
  { to: 'warehouse-transfers', label: 'تحويلات المستودعات', icon: <Icons.TruckIcon />, permission: 'stock.manage' },
  { to: 'orders', label: 'إدارة الطلبات', icon: <Icons.OrdersIcon />, permission: 'orders.view' },
  { to: 'cod-settlements', label: 'تسوية COD', icon: <Icons.MoneyIcon />, permission: 'accounting.manage' },
  { to: 'supplier-credit-notes', label: 'خصومات الموردين', icon: <Icons.MoneyIcon />, permission: 'accounting.manage' },
  { to: '/pos', label: 'نقطة البيع (POS)', icon: <Icons.CartIcon />, permission: 'orders.createInStore' },
  { to: 'my-shift', label: 'ورديتي', icon: <Icons.ClockIcon />, permission: 'cashShifts.viewOwn' },
  { to: 'delivery-zones', label: 'مناطق التوصيل', icon: <Icons.TruckIcon />, permission: 'deliveryZones.manage' },
  { to: 'items', label: 'إدارة الأصناف', icon: <Icons.ListIcon />, permission: 'items.manage' },
  { to: 'addons', label: 'إدارة الإضافات', icon: <Icons.AddonIcon />, permission: 'addons.manage' },
  { to: 'ads', label: 'إدارة الإعلانات', icon: <Icons.ImageIcon />, permission: 'ads.manage' },
  { to: 'customers', label: 'إدارة العملاء', icon: <Icons.CustomersIcon />, permission: 'customers.manage' },
  { to: 'challenges', label: 'إدارة التحديات', icon: <Icons.StarIcon />, permission: 'challenges.manage' },
  { to: 'coupons', label: 'إدارة الكوبونات', icon: <Icons.CouponIcon />, permission: 'coupons.manage' },
  { to: 'promotions', label: 'إدارة العروض', icon: <Icons.TagIcon />, permission: 'promotions.manage' },
  { to: 'reviews', label: 'إدارة التقييمات', icon: <Icons.StarIcon />, permission: 'reviews.manage' },
  { to: 'prices', label: 'إدارة الأسعار', icon: <Icons.TagIcon />, permission: 'prices.manage' },
  { to: 'price-tiers', label: 'شرائح الأسعار', icon: <Icons.TagIcon />, permission: 'prices.manage' },
  { to: 'cost-centers', label: 'مراكز التكلفة', icon: <Icons.ListIcon />, permission: 'expenses.manage' },
  { to: 'expenses', label: 'إدارة المصاريف', icon: <Icons.ReportIcon />, permission: 'expenses.manage' },
  { to: 'accounting', label: 'المحاسبة', icon: <Icons.ReportIcon />, permission: 'accounting.view' },
  { to: 'reports', label: 'التقارير', icon: <Icons.ReportIcon />, permission: 'reports.view' },
  { to: 'shift-reports', label: 'تقارير الورديات', icon: <Icons.ClockIcon />, permission: 'reports.view' },
  { to: 'profile', label: 'الملف الشخصي', icon: <Icons.ProfileIcon />, permission: 'profile.view' },
  { to: 'settings', label: 'الإعدادات', icon: <Icons.SettingsIcon />, permission: 'settings.manage' },
  { to: 'approvals', label: 'الموافقات', icon: <Icons.ListIcon />, permission: 'approvals.manage' },
  { to: 'audit', label: 'سجل النظام', icon: <Icons.ListIcon />, permission: 'settings.manage' },
  { to: 'database', label: 'قاعدة البيانات', icon: <Icons.ListIcon />, permission: 'settings.manage' },
];

const routePermissions: Record<string, AdminPermission> = {
  'dashboard': 'dashboard.view',
  'stock': 'inventory.view',
  'wastage': 'stock.manage',
  'expiry-batches': 'stock.manage',
  'wastage-expiry-reports': 'inventory.movements.view',
  'suppliers': 'stock.manage',
  'supplier-contracts': 'stock.manage',
  'supplier-evaluations': 'stock.manage',
  'purchases': 'stock.manage',
  'import-shipments': 'shipments.view',
  'warehouses': 'stock.manage',
  'warehouse-transfers': 'stock.manage',
  'orders': 'orders.view',
  'cod-settlements': 'accounting.manage',
  'supplier-credit-notes': 'accounting.manage',
  'my-shift': 'cashShifts.viewOwn',
  'delivery-zones': 'deliveryZones.manage',
  'items': 'items.manage',
  'addons': 'addons.manage',
  'ads': 'ads.manage',
  'customers': 'customers.manage',
  'challenges': 'challenges.manage',
  'coupons': 'coupons.manage',
  'promotions': 'promotions.manage',
  'reviews': 'reviews.manage',
  'prices': 'prices.manage',
  'price-tiers': 'prices.manage',
  'cost-centers': 'expenses.manage',
  'expenses': 'expenses.manage',
  'accounting': 'accounting.view',
  'reports': 'reports.view',
  'shift-reports': 'reports.view',
  'profile': 'profile.view',
  'settings': 'settings.manage',
  'approvals': 'approvals.manage',
  'audit': 'settings.manage',
  'database': 'settings.manage',
};

const AdminLayout: React.FC = () => {
  const { isAuthenticated, logout, user, loading, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useToast();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const { currentShift } = useCashShift();
  const { settings } = useSettings();

  const canAccessLink = (link: (typeof navLinks)[number]) => {
    if (link.to === 'my-shift') {
      return hasPermission('cashShifts.viewOwn') || hasPermission('cashShifts.manage');
    }
    if (link.to === '/pos') {
      return hasPermission('orders.createInStore') || hasPermission('orders.updateStatus.all');
    }
    if (link.to === 'stock') {
      return hasPermission('inventory.view') || hasPermission('stock.manage');
    }
    if (link.to === 'import-shipments') {
      return hasPermission('shipments.view') || hasPermission('stock.manage');
    }
    if (link.to === 'wastage-expiry-reports') {
      return hasPermission('inventory.movements.view') || hasPermission('reports.view') || hasPermission('stock.manage');
    }
    return hasPermission(link.permission);
  };

  const currentPage = navLinks.find(link => location.pathname.startsWith(`/admin/${link.to}`));
  const isSubPageRoute = location.pathname.split('/').filter(Boolean).length > 2;

  // Route Protection Logic
  useEffect(() => {
    if (loading) return;
    
    if (!isAuthenticated) {
      navigate('/admin/login', { replace: true });
      return;
    }

    // Extract the main route segment (e.g., 'stock' from '/admin/stock/add')
    const pathSegments = location.pathname.split('/').filter(Boolean);
    // pathSegments[0] is 'admin', [1] is the feature route
    const currentRoute = pathSegments[1];

    if (currentRoute && routePermissions[currentRoute]) {
        const requiredPermission = routePermissions[currentRoute];
        const ok =
          currentRoute === 'my-shift'
            ? hasPermission('cashShifts.viewOwn') || hasPermission('cashShifts.manage')
            : currentRoute === 'stock'
              ? (hasPermission('inventory.view') || hasPermission('stock.manage'))
              : currentRoute === 'import-shipments'
                ? (hasPermission('shipments.view') || hasPermission('stock.manage'))
                : currentRoute === 'wastage-expiry-reports'
                  ? (hasPermission('inventory.movements.view') || hasPermission('reports.view') || hasPermission('stock.manage'))
                  : hasPermission(requiredPermission);
        if (!ok) {
            // Redirect to dashboard or show unauthorized if already on dashboard (to avoid loop)
            if (currentRoute !== 'dashboard') {
                navigate('/admin/dashboard', { replace: true });
                // Optional: Show notification "Access Denied"
            }
        }
    }
  }, [isAuthenticated, loading, navigate, location.pathname, hasPermission]);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login', { replace: true });
  };

  if (loading || !isAuthenticated) {
    return null; // Or a loading spinner
  }

  const roleLabel: Record<AdminRole, string> = {
    owner: 'المالك',
    manager: 'مدير',
    employee: 'موظف',
    cashier: 'كاشير',
    delivery: 'مندوب',
    accountant: 'محاسب',
  };

  return (
    <div className="flex min-h-screen min-h-dvh bg-gray-100 dark:bg-gray-900 font-sans rtl:flex-row-reverse">
      {/* Overlay for mobile */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-20 md:hidden" onClick={() => setIsSidebarOpen(false)}></div>
      )}

      {/* Sidebar */}
      <aside className={`absolute md:sticky md:top-0 inset-y-0 rtl:right-0 ltr:left-0 transform ${isSidebarOpen ? 'rtl:-translate-x-0 ltr:translate-x-0' : 'rtl:translate-x-full ltr:-translate-x-full'} md:rtl:translate-x-0 md:ltr:translate-x-0 w-64 bg-white dark:bg-gray-800 shadow-lg flex flex-col transition-transform duration-300 ease-in-out z-30 h-screen md:h-screen overflow-y-auto`}>
        <div className="p-4 border-b dark:border-gray-700 text-center flex-shrink-0">
          <img src={user?.avatarUrl || undefined} alt="Admin" className="w-20 h-20 rounded-full mx-auto mb-2 border-4 border-gold-500/50 p-1" />
          <h2 className="text-lg font-bold text-gray-800 dark:text-white truncate">{user?.fullName}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{roleLabel[user?.role || 'employee']}</p>
        </div>
        <nav className="flex-grow p-4 space-y-2">
          {navLinks.map(link => {
            const canAccess = canAccessLink(link);
            if (canAccess) {
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  onClick={() => setIsSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center space-x-3 rtl:space-x-reverse p-3 rounded-lg transition-all duration-200 ${isActive
                      ? 'bg-primary-500 text-white shadow-md'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gold-500 dark:hover:text-gold-400'
                    }`
                  }
                >
                  {link.icon}
                  <span className="font-semibold">{link.label}</span>
                </NavLink>
              );
            }

            return (
              <button
                key={link.to}
                type="button"
                onClick={() => {
                  setIsSidebarOpen(false);
                  showNotification('ليس لديك صلاحية لفتح هذا القسم.', 'error');
                }}
                className="w-full flex items-center space-x-3 rtl:space-x-reverse p-3 rounded-lg transition-all duration-200 text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-75"
              >
                <Icons.LockIcon />
                <span className="font-semibold">{link.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t dark:border-gray-700 flex-shrink-0">
          <button
            onClick={handleLogout}
            className="w-full flex items-center space-x-3 rtl:space-x-reverse p-3 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors duration-200"
          >
            <Icons.LogoutIcon />
            <span className="font-semibold">{'تسجيل الخروج'}</span>
          </button>
        </div>

        {/* Shift Status Button (permission-based) */}
        {hasPermission('cashShifts.open') && (
          <div className="p-4 border-t dark:border-gray-700 flex-shrink-0">
            <button
              onClick={() => setIsShiftModalOpen(true)}
              className={`w-full flex items-center space-x-3 rtl:space-x-reverse p-3 rounded-lg transition-colors duration-200 border ${currentShift
                ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900'
                : 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
                }`}
            >
              <Icons.ClockIcon className={`w-5 h-5 ${currentShift ? 'text-green-500' : 'text-gray-400'}`} />
              <div className="flex flex-col items-start px-2">
                <span className="font-semibold text-sm">{currentShift ? 'الوردية مفتوحة' : 'بدء الوردية'}</span>
                {currentShift && <span className="text-xs opacity-75">منذ {new Date(currentShift.openedAt).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
            </button>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col min-w-0 min-h-0 transition-all duration-300 ${isSidebarOpen ? 'rtl:translate-x-0 ltr:translate-x-0' : ''}`}>
        <header className="bg-white dark:bg-gray-800 shadow-sm p-4 border-b dark:border-gray-700 flex items-center space-x-4 rtl:space-x-reverse">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="md:hidden text-gray-600 dark:text-gray-300 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">
            <Icons.MenuIcon />
          </button>
          {isSubPageRoute && (
            <button onClick={() => navigate(-1)} title="عودة" className="text-gray-600 dark:text-gray-300 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
              <Icons.BackArrowIcon />
            </button>
          )}
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">{currentPage ? currentPage.label : 'لوحة التحكم'}</h1>
          <div className="flex-1" />
          <Link
            to="/admin/settings"
            className={`hidden sm:inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${
              settings.maintenanceEnabled
                ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800'
                : 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800'
            }`}
            title={settings.maintenanceEnabled ? (settings.maintenanceMessage || 'وضع الصيانة مفعل') : 'النظام يعمل بشكل طبيعي'}
          >
            {settings.maintenanceEnabled ? 'الصيانة: مفعّلة' : 'الصيانة: موقفة'}
          </Link>
          <AdminNotificationMenu />
          {hasPermission('profile.view') && (
            <button
              type="button"
              onClick={() => navigate('/help', { state: { from: location.pathname, mode: 'adminGuide' } })}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <Icons.InfoIcon />
              <span className="hidden sm:inline font-semibold">دليل الاستخدام</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate('/help', { state: { from: location.pathname } })}
            title="مركز المساعدة"
            className="text-gray-600 dark:text-gray-300 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <Icons.InfoIcon />
          </button>
        </header>
        <ConnectivityBanner />
        <Notification />
        <main className="flex-1 min-h-0 overflow-x-auto overflow-y-auto bg-gray-100 dark:bg-gray-900 p-4 md:p-6">
          <Outlet />
        </main>
        <footer className="text-center p-2 text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border-t dark:border-gray-700">
          <p>نصر البكري للبرامج والتطبيقات</p>
          <p className="mt-1" dir="ltr">
            <a href="tel:+967772519054" className="hover:text-gold-500">772519054</a>
            <span className="mx-1">|</span>
            <a href="tel:+967718419380" className="hover:text-gold-500">718419380</a>
          </p>
        </footer>
      </div>

      <ShiftManagementModal isOpen={isShiftModalOpen} onClose={() => setIsShiftModalOpen(false)} />
    </div>
  );
};

export default AdminLayout;
