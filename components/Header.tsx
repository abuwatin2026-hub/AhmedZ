import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCart } from '../contexts/CartContext';
import { useOrders } from '../contexts/OrderContext';
import { useUserAuth } from '../contexts/UserAuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNotification } from '../contexts/NotificationContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { AdminIcon, CartIcon, InfoIcon, LogoutIcon, MoonIcon, ProfileIcon, ReceiptIcon, SunIcon, UserIcon, DownloadIcon } from './icons';
import Logo from './Logo';
import YemeniPattern from './YemeniPattern';
import { MenuIcon } from './icons';

const NotificationMenu: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotification();
    const { user: adminUser } = useAuth();
    const navigate = useNavigate();
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
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

    const handleNotificationClick = async (id: string, link?: string) => {
        await markAsRead(id);
        setIsOpen(false);
        const to = resolveLink(link);
        if (to && to !== '#') {
            navigate(to);
        }
    };

    return (
        <div className="relative" ref={menuRef}>
            <button 
                onClick={() => setIsOpen(!isOpen)} 
                title="الإشعارات"
                className="relative p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:text-primary-500 dark:hover:text-gold-400 hover:bg-gold-50 dark:hover:bg-gray-800 transition-all"
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
                <div className="absolute end-0 mt-2 w-[min(20rem,calc(100vw-2rem))] bg-white dark:bg-gray-800 rounded-md shadow-lg border-2 border-gold-500/20 py-1 z-20 animate-fade-in-up max-h-96 overflow-y-auto">
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
                                onClick={() => handleNotificationClick(note.id, note.link)}
                                className={`block px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 last:border-0 ${!note.isRead ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <p className={`text-sm font-semibold ${!note.isRead ? 'text-blue-800 dark:text-blue-300' : 'text-gray-800 dark:text-gray-300'}`}>
                                        {note.title}
                                    </p>
                                    <span className="text-[10px] text-gray-400">
                                        {new Date(note.createdAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
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

const UserMenu: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const { currentUser, logout } = useUserAuth();
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    if (!currentUser) return null;

    return (
        <div className="relative" ref={menuRef}>
            <button onClick={() => setIsOpen(!isOpen)} className="w-10 h-10 rounded-full overflow-hidden border-2 border-gold-500 hover:border-gold-400 shadow-gold transition-all">
                <img src={currentUser.avatarUrl || `https://i.pravatar.cc/150?u=${currentUser.id}`} alt="User Avatar" className="w-full h-full object-cover" />
            </button>
            {isOpen && (
                <div className="absolute left-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg border-2 border-gold-500/20 py-1 z-20 animate-fade-in-up">
                    <div className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 border-b border-gold-500/20">
                        <p className="font-bold truncate">{currentUser.fullName}</p>
                        <p className="text-xs text-gray-500 truncate">{currentUser.phoneNumber || currentUser.email}</p>
                    </div>
                    <Link to="/profile" onClick={() => setIsOpen(false)} className="flex items-center w-full text-start px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gold-50 dark:hover:bg-gray-700">
                        <ProfileIcon /> <span className="mx-2">{'ملفي الشخصي'}</span>
                    </Link>
                    <Link to="/my-orders" onClick={() => setIsOpen(false)} className="flex items-center w-full text-start px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gold-50 dark:hover:bg-gray-700">
                        <ReceiptIcon /> <span className="mx-2">{'طلباتي'}</span>
                    </Link>
                    <button onClick={async () => { await logout(); setIsOpen(false); }} className="flex items-center w-full text-start px-4 py-2 text-sm text-primary-600 dark:text-primary-400 hover:bg-gold-50 dark:hover:bg-gray-700">
                        <LogoutIcon /> <span className="mx-2">{'تسجيل الخروج'}</span>
                    </button>
                </div>
            )}
        </div>
    );
};

const HeaderMenu: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const { getCartCount } = useCart();
    const { theme, toggleTheme } = useTheme();
    const { isAuthenticated: isUserAuthenticated, logout } = useUserAuth();
    const { userOrders } = useOrders();
    const location = useLocation();
    const hasActiveOrders = userOrders.some(o => o.status !== 'delivered');
    const cartCount = getCartCount();
    const menuRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);
    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setIsOpen(v => !v)}
                className="p-2 rounded-lg border-2 border-gold-500/40 text-gray-700 dark:text-gray-200 hover:bg-gold-50 dark:hover:bg-gray-800 transition"
                aria-label="menu"
            >
                <MenuIcon />
            </button>
            {isOpen && (
                <div className="absolute mt-2 left-1/2 -translate-x-1/2 w-[min(14rem,calc(100vw-2rem))] bg-white dark:bg-gray-800 rounded-md shadow-lg border-2 border-gold-500/20 py-2 z-20 animate-fade-in-up max-h-[calc(100vh-8rem)] overflow-auto">
                    <Link to="/admin" className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gold-50 dark:hover:bg-gray-700">
                        <AdminIcon /> <span className="mx-2">{'لوحة التحكم'}</span>
                    </Link>
                    <button onClick={toggleTheme} className="flex items-center w-full text-start px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gold-50 dark:hover:bg-gray-700">
                        {theme === 'light' ? <MoonIcon /> : <SunIcon />} <span className="mx-2">{theme === 'light' ? 'الوضع الليلي' : 'الوضع النهاري'}</span>
                    </button>
                    <Link
                        to="/help"
                        state={{ from: location.pathname }}
                        className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gold-50 dark:hover:bg-gray-700"
                    >
                        <InfoIcon /> <span className="mx-2">{'مساعدة'}</span>
                    </Link>
                    {isUserAuthenticated ? (
                        <>
                            <Link to="/profile" className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gold-50 dark:hover:bg-gray-700">
                                <ProfileIcon /> <span className="mx-2">{'ملفي الشخصي'}</span>
                            </Link>
                            <Link to="/my-orders" className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gold-50 dark:hover:bg-gray-700">
                                <ReceiptIcon /> <span className="mx-2">{'طلباتي'}</span>
                                {hasActiveOrders && <span className="ml-auto rtl:mr-auto bg-primary-500 rounded-full h-2 w-2"></span>}
                            </Link>
                            <button onClick={async () => { await logout(); setIsOpen(false); }} className="flex items-center w-full text-start px-4 py-2 text-sm text-primary-600 dark:text-primary-400 hover:bg-gold-50 dark:hover:bg-gray-700">
                                <LogoutIcon /> <span className="mx-2">{'تسجيل الخروج'}</span>
                            </button>
                        </>
                    ) : (
                        <Link to="/login" className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gold-50 dark:hover:bg-gray-700">
                            <UserIcon /> <span className="mx-2">{'تسجيل الدخول'}</span>
                        </Link>
                    )}
                    <Link to="/cart" className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gold-50 dark:hover:bg-gray-700">
                        <CartIcon /> <span className="mx-2">{'السلة'}</span>
                        {cartCount > 0 && <span className="ml-auto rtl:mr-auto bg-red-gradient text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-bold shadow-red">{cartCount}</span>}
                    </Link>
                    <Link to="/download-app" className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gold-50 dark:hover:bg-gray-700 border-t border-gray-100 dark:border-gray-700 mt-1 pt-2">
                        <DownloadIcon /> <span className="mx-2">{'حمل التطبيق'}</span>
                    </Link>
                </div>
            )}
        </div>
    );
};

const Header: React.FC = () => {
    const { getCartCount } = useCart();
    const { userOrders } = useOrders();
    const { isAuthenticated: isUserAuthenticated } = useUserAuth();
    const { theme, toggleTheme } = useTheme();
    const location = useLocation();
    const cartCount = getCartCount();

    const isHomePage = location.pathname === '/';
    const hasActiveOrders = userOrders.some(o => o.status !== 'delivered');


    return (
        <header className="bg-white/95 dark:bg-gray-900/95 shadow-lg sticky top-0 z-50 backdrop-blur-md border-b-2 border-gold-500/20 pt-[env(safe-area-inset-top)]">
            {/* Decorative Top Border */}
            <div className="absolute top-0 left-0 right-0">
                <YemeniPattern type="zigzag" color="gold" />
            </div>

            <div className="container mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
                <Link to="/" className="hover:scale-105 transition-transform flex-shrink-0">
                    <Logo size="md" variant="full" />
                </Link>

                <div className="flex items-center space-x-3 rtl:space-x-reverse">

                    <div className="md:hidden flex items-center gap-2">
                        <NotificationMenu />
                        <HeaderMenu />
                    </div>

                    <div className="hidden md:flex items-center space-x-3 rtl:space-x-reverse">
                        <Link
                            to="/download-app"
                            className="text-gray-600 dark:text-gray-300 hover:text-green-600 dark:hover:text-green-400 font-medium text-sm flex items-center gap-1 p-2 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
                        >
                            <span className="hidden lg:inline">{'حمل التطبيق'}</span>
                            <DownloadIcon className="w-5 h-5" />
                        </Link>

                        {isHomePage && (
                            <Link
                                to="/admin"
                                title={'لوحة التحكم'}
                                className="text-gray-600 dark:text-gray-300 hover:text-primary-500 dark:hover:text-gold-400 p-2 rounded-lg hover:bg-gold-50 dark:hover:bg-gray-800 transition-all"
                            >
                                <AdminIcon />
                            </Link>
                        )}

                        <button
                            onClick={toggleTheme}
                            title={theme === 'light' ? 'الوضع الليلي' : 'الوضع النهاري'}
                            className="text-gray-600 dark:text-gray-300 hover:text-primary-500 dark:hover:text-gold-400 p-2 rounded-lg hover:bg-gold-50 dark:hover:bg-gray-800 transition-all"
                        >
                            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
                        </button>

                        {/* Language Switcher Removed */}
                        
                        <NotificationMenu />

                        <Link
                            to="/help"
                            state={{ from: location.pathname }}
                            title={'مساعدة'}
                            className="text-gray-600 dark:text-gray-300 hover:text-primary-500 dark:hover:text-gold-400 p-2 rounded-lg hover:bg-gold-50 dark:hover:bg-gray-800 transition-all"
                        >
                            <InfoIcon />
                        </Link>

                        <div className="h-6 border-l-2 border-gold-500/30 mx-2"></div>

                        <div className="flex items-center space-x-3 rtl:space-x-reverse">
                            {isUserAuthenticated ? (
                                <UserMenu />
                            ) : (
                                <Link
                                    to="/login"
                                    title={'تسجيل الدخول'}
                                    className="text-gray-600 dark:text-gray-300 hover:text-primary-500 dark:hover:text-gold-400 p-2 rounded-lg hover:bg-gold-50 dark:hover:bg-gray-800 transition-all"
                                >
                                    <span className="md:hidden"><UserIcon /></span>
                                    <span className="hidden md:inline font-semibold text-sm">{'تسجيل الدخول'}</span>
                                </Link>
                            )}

                            <div className="hidden md:inline-flex">
                                {hasActiveOrders && isUserAuthenticated && (
                                    <Link
                                        to="/my-orders"
                                        title={'طلباتي'}
                                        className="relative text-gray-600 dark:text-gray-300 hover:text-primary-500 dark:hover:text-gold-400 p-2 rounded-lg hover:bg-gold-50 dark:hover:bg-gray-800 transition-all"
                                    >
                                        <ReceiptIcon />
                                        <span className="absolute -top-1 -right-1 bg-primary-500 rounded-full h-3 w-3 border-2 border-white dark:border-gray-900 animate-ping"></span>
                                    </Link>
                                )}
                            </div>

                            <Link
                                to="/cart"
                                className="relative text-gray-600 dark:text-gray-300 hover:text-primary-500 dark:hover:text-gold-400 p-2 rounded-lg hover:bg-gold-50 dark:hover:bg-gray-800 transition-all"
                            >
                                <CartIcon />
                                {cartCount > 0 && (
                                    <span className="absolute -top-2 -right-2 bg-red-gradient text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-bold shadow-red animate-bounce">
                                        {cartCount}
                                    </span>
                                )}
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* Decorative Bottom Border */}
            <div className="absolute bottom-0 left-0 right-0">
                <YemeniPattern type="zigzag" color="gold" />
            </div>
        </header>
    );
};

export default Header;
