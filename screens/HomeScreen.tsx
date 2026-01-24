import React, { useMemo, useState } from 'react';
import { useMenu } from '../contexts/MenuContext';
import MenuItemCard from '../components/MenuItemCard';
import FeaturedMenuItemCard from '../components/FeaturedMenuItemCard';
import { useItemMeta } from '../contexts/ItemMetaContext';
import SearchBar from '../components/SearchBar';
import MenuItemCardSkeleton from '../components/MenuItemCardSkeleton';
import FeaturedMenuItemCardSkeleton from '../components/FeaturedMenuItemCardSkeleton';
import { useUserAuth } from '../contexts/UserAuthContext';
import { useOrders } from '../contexts/OrderContext';
import OrderAgainItemCard from '../components/OrderAgainItemCard';
import OrderAgainItemCardSkeleton from '../components/OrderAgainItemCardSkeleton';
import AdCarousel from '../components/AdCarousel';
import YemeniPattern from '../components/YemeniPattern';

const normalizeCategoryKey = (value: unknown) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  if (raw === 'all') return 'all';
  return raw.toLowerCase();
};

const HomeScreen: React.FC = () => {
  const { menuItems, loading: menuLoading } = useMenu();
  const { userOrders, loading: ordersLoading } = useOrders();
  const { isAuthenticated } = useUserAuth();
  const { categories: categoryDefs, getCategoryLabel } = useItemMeta();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const activeMenuItems = useMemo(() => {
    return menuItems.filter(item => item.status !== 'archived');
  }, [menuItems]);

  const featuredItems = useMemo(() => {
    return activeMenuItems.filter(item => item.isFeatured).slice(0, 4);
  }, [activeMenuItems]);

  const orderAgainItems = useMemo(() => {
    if (!userOrders.length) return [];

    // Get items from the last 5 orders
    const recentItems = userOrders.slice(0, 5).flatMap(order => order.items);

    // Get unique items, preferring the most recent appearance
    const uniqueItemsMap = new Map();
    recentItems.forEach(item => {
      if (!uniqueItemsMap.has(item.id)) {
        uniqueItemsMap.set(item.id, item);
      }
    });

    return Array.from(uniqueItemsMap.values()).slice(0, 8); // Limit to 8 items
  }, [userOrders]);


  const categories = useMemo(() => {
    const activeKeys = categoryDefs
      .filter(c => c.isActive)
      .map(c => normalizeCategoryKey(c.key))
      .filter(Boolean);
    const usedKeys = [...new Set(activeMenuItems.map(item => normalizeCategoryKey(item.category)))]
      .filter(Boolean)
      .filter(k => k !== 'all');
    const merged = Array.from(new Set([...activeKeys, ...usedKeys])).sort((a, b) => a.localeCompare(b));
    return ['all', ...merged];
  }, [activeMenuItems, categoryDefs]);

  const filteredItems = useMemo(() => {
    const byCategory = selectedCategory === 'all'
      ? activeMenuItems
      : activeMenuItems.filter(item => item.category === selectedCategory);

    if (!searchTerm.trim()) {
      return byCategory;
    }

    const lowercasedSearchTerm = searchTerm.toLowerCase();
    return byCategory.filter(item =>
      (item.name?.ar || item.name?.en || '').toLowerCase().includes(lowercasedSearchTerm)
    );
  }, [activeMenuItems, selectedCategory, searchTerm]);

  return (
    <div className="space-y-12">
      <div className="relative w-full mt-0 md:-mt-12 animate-fade-in z-0">
        <AdCarousel onCategorySelect={(category) => setSelectedCategory(normalizeCategoryKey(category) || 'all')} />
      </div>

      {/* Search and Filter Section */}
      <section className="container mx-auto max-w-screen-2xl px-3 sm:px-6 lg:px-8 mt-2 md:-mt-28 relative z-10 animate-fade-in-up">
        <div className="bg-white dark:bg-gray-900 p-3 sm:p-6 rounded-2xl shadow-2xl border-2 border-gold-500/30 relative overflow-hidden">
          {/* Decorative corners */}
          <div className="hidden md:block absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-gold-500"></div>
          <div className="hidden md:block absolute top-0 right-0 w-16 h-16 border-t-2 border-r-2 border-gold-500"></div>
          <div className="hidden md:block absolute bottom-0 left-0 w-16 h-16 border-b-2 border-l-2 border-gold-500"></div>
          <div className="hidden md:block absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 border-gold-500"></div>

          {/* Top zigzag pattern */}
          <div className="hidden md:block absolute top-0 left-0 right-0">
            <YemeniPattern type="zigzag" color="gold" />
          </div>

          <div className="space-y-4 relative z-10">
            <SearchBar searchTerm={searchTerm} onSearchChange={setSearchTerm} />
            <div className="sm:overflow-visible overflow-x-auto no-scrollbar mx-0">
              <div className="flex justify-start sm:justify-center gap-2 sm:gap-3 pt-2 px-1">
                {categories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-4 sm:px-6 py-2 sm:py-2.5 rounded-full font-bold text-sm transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gold-500 dark:focus:ring-offset-gray-900 ${selectedCategory === category
                        ? 'bg-red-gradient text-white shadow-red scale-105 animate-glow'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gold-50 dark:hover:bg-gray-700 border-2 border-gold-500/20 hover:border-gold-500/50'
                      }`}
                  >
                    {category === 'all' ? 'الكل' : getCategoryLabel(category, 'ar')}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom zigzag pattern */}
          <div className="hidden md:block absolute bottom-0 left-0 right-0">
            <YemeniPattern type="zigzag" color="gold" />
          </div>
        </div>
      </section>

      {/* Order Again Section */}
      {isAuthenticated && (ordersLoading || orderAgainItems.length > 0) && (
        <section className="container mx-auto max-w-screen-2xl animate-fade-in-up" style={{ animationDelay: '50ms' }}>
          <h2 className="text-3xl font-bold bg-gold-gradient bg-clip-text text-transparent mb-6 border-r-4 rtl:border-r-0 rtl:border-l-4 border-gold-500 pr-3 rtl:pr-0 rtl:pl-3 px-4 sm:px-6 lg:px-8">{'اطلبها مجددًا'}</h2>
          <div className="flex gap-4 overflow-x-auto pb-4 px-4 no-scrollbar">
            {ordersLoading ? (
              Array.from({ length: 4 }).map((_, index) => <OrderAgainItemCardSkeleton key={index} />)
            ) : (
              orderAgainItems.map(item => (
                <OrderAgainItemCard key={`${item.id}-reorder`} item={item} />
              ))
            )}
          </div>
          <style>{`
                    .no-scrollbar::-webkit-scrollbar {
                        display: none;
                    }
                    .no-scrollbar {
                        -ms-overflow-style: none;
                        scrollbar-width: none;
                    }
                `}</style>
        </section>
      )}

      {(menuLoading || featuredItems.length > 0) && (
        <section id="featured-items-section" className="animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <div className="container mx-auto max-w-screen-2xl px-3 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold bg-gold-gradient bg-clip-text text-transparent mb-6 border-r-4 rtl:border-r-0 rtl:border-l-4 border-gold-500 pr-3 rtl:pr-0 rtl:pl-3">{'الأصناف المميزة'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {menuLoading ? (
                <>
                  <FeaturedMenuItemCardSkeleton />
                  <FeaturedMenuItemCardSkeleton />
                  <FeaturedMenuItemCardSkeleton />
                  <FeaturedMenuItemCardSkeleton />
                </>
              ) : (
                featuredItems.map(item => (
                  <FeaturedMenuItemCard key={item.id} item={item} />
                ))
              )}
            </div>
          </div>
        </section>
      )}

      <section className="animate-fade-in-up" style={{ animationDelay: '200ms' }}>
        <div className="container mx-auto max-w-screen-2xl px-3 sm:px-6 lg:px-8">
          <div className="text-center relative">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold bg-red-gradient bg-clip-text text-transparent">
              منتجاتنا الغذائية
            </h2>
            <div className="flex items-center justify-center gap-4 mt-2">
              <div className="h-1 w-20 bg-gold-gradient"></div>
              <span className="text-gold-500 text-2xl">✦</span>
              <div className="h-1 w-20 bg-gold-gradient"></div>
            </div>
            <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
              {'اكتشف أفضل المواد الغذائية'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6 mt-6 sm:mt-8">
            {menuLoading ? (
              Array.from({ length: 8 }).map((_, index) => <MenuItemCardSkeleton key={index} />)
            ) : (
              filteredItems.map((item) => (
                <MenuItemCard key={item.id} item={item} />
              ))
            )}
          </div>

          {!menuLoading && filteredItems.length === 0 && (
            <div className="text-center py-12 sm:py-16 col-span-full">
              <p className="text-xl font-semibold text-gray-700 dark:text-gray-300">{'لا توجد أصناف تطابق بحثك.'}</p>
              <p className="text-gray-500 dark:text-gray-400 mt-2">{'جرب البحث بكلمة أخرى أو تغيير الفئة.'}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default HomeScreen;
