import React from 'react';
import { Link } from 'react-router-dom';
import type { MenuItem } from '../types';
import { useSettings } from '../contexts/SettingsContext';

interface FeaturedMenuItemCardProps {
  item: MenuItem;
}

const FeaturedMenuItemCard: React.FC<FeaturedMenuItemCardProps> = ({ item }) => {
  const { settings } = useSettings();
  const baseCode = String((settings as any)?.baseCurrency || '').toUpperCase() || '—';

  return (
    <Link to={`/item/${item.id}`} className="block group">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg overflow-hidden transform group-hover:shadow-gold-lg group-hover:-translate-y-2 transition-all duration-300 h-full flex items-center border-2 border-gold-500/30 group-hover:border-gold-500 relative">
        {/* Decorative corner */}
        <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-gold-500 opacity-50 group-hover:opacity-100 transition-opacity"></div>

        {/* Featured badge */}
        <div className="absolute top-2 right-2 bg-red-gradient text-white text-xs font-bold px-2 py-1 rounded-full shadow-md z-10">
          ⭐ مميز
        </div>

        <div className="relative overflow-hidden flex-shrink-0">
          <img className="w-32 h-32 object-cover group-hover:scale-110 transition-transform duration-500" src={item.imageUrl || undefined} alt={item.name?.ar || item.name?.en || ''} />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/20"></div>
        </div>

        <div className="p-4 flex flex-col flex-grow">
          <h3 className="text-md font-bold text-gray-800 dark:text-white group-hover:bg-gold-gradient group-hover:bg-clip-text group-hover:text-transparent transition-all">
            {item.name?.ar || item.name?.en || ''}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 text-xs mt-1 h-8 overflow-hidden">
            {item.description?.ar || item.description?.en || ''}
          </p>
          <div className="mt-2">
            <span className="text-lg font-bold bg-red-gradient bg-clip-text text-transparent">{Number(item.price || 0).toFixed(2)} {baseCode}</span>
          </div>
        </div>

        <div className="pr-4 rtl:pr-0 rtl:pl-4 text-gold-500 group-hover:text-gold-400 transition-colors group-hover:scale-110">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
};

export default FeaturedMenuItemCard;
