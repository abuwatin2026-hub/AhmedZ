import React, { useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CartIcon, HomeIcon, ReceiptIcon, UserIcon } from './icons';
import YemeniPattern from './YemeniPattern';

const BottomNavBar: React.FC = () => {
    const location = useLocation();
    const navRef = useRef<HTMLElement | null>(null);

    useLayoutEffect(() => {
        const updateHeight = () => {
            const height = navRef.current?.offsetHeight ?? 0;
            document.documentElement.style.setProperty('--bottom-nav-height', `${height}px`);
        };

        updateHeight();

        const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeight) : null;
        if (resizeObserver && navRef.current) {
            resizeObserver.observe(navRef.current);
        }

        window.addEventListener('resize', updateHeight);
        return () => {
            window.removeEventListener('resize', updateHeight);
            resizeObserver?.disconnect();
        };
    }, []);

    const navItems = [
        { path: '/', icon: HomeIcon, label: 'الرئيسية' },
        { path: '/my-orders', icon: ReceiptIcon, label: 'طلباتي' },
        { path: '/cart', icon: CartIcon, label: 'السلة' },
        { path: '/profile', icon: UserIcon, label: 'ملفي' },
    ];

    return (
        <nav ref={navRef} className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t-2 border-gold-500/30 shadow-lg z-10 pb-[env(safe-area-inset-bottom)]">
            <div className="absolute top-0 left-0 right-0">
                <YemeniPattern type="zigzag" color="gold" />
            </div>

            <div className="flex justify-around items-center py-2 px-2">
                {navItems.map(({ path, icon: Icon, label }) => {
                    const isActive = location.pathname === path;
                    return (
                        <Link
                            key={path}
                            to={path}
                            className={`flex flex-col items-center justify-center px-3 py-2 rounded-lg transition-all ${isActive
                                    ? 'text-primary-500 dark:text-gold-400 bg-gold-50 dark:bg-gray-800 scale-110'
                                    : 'text-gray-600 dark:text-gray-400 hover:text-primary-500 dark:hover:text-gold-400'
                                }`}
                        >
                            <Icon isActive={isActive} className={isActive ? 'animate-bounce' : ''} />
                            <span className={`text-xs mt-1 font-semibold ${isActive ? 'text-primary-600 dark:text-gold-400' : ''}`}>
                                {label}
                            </span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
};

export default BottomNavBar;
