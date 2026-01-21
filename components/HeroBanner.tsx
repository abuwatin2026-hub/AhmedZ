
import React from 'react';
import { useSettings } from '../contexts/SettingsContext';

const HeroBanner: React.FC = () => {
  const { settings, language } = useSettings();
  const storeName = settings.cafeteriaName?.[language] || settings.cafeteriaName?.ar || settings.cafeteriaName?.en;
  
  const handleDiscoverOffers = () => {
    const featuredSection = document.getElementById('featured-items-section');
    if (featuredSection) {
      featuredSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="relative w-full animate-fade-in -mt-8 md:-mt-12">
      <div className="absolute inset-0 bg-dark-teal-gradient" aria-hidden="true"></div>
      <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-transparent rtl:from-transparent rtl:via-black/40 rtl:to-black/60" aria-hidden="true"></div>
      <div className="relative container mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8">
        <div className="min-h-[50vh] sm:min-h-[60vh] flex flex-col justify-center items-center text-center md:items-start md:text-start py-16">
          <h2 className="text-4xl sm:text-6xl font-black text-white leading-tight">
            <span className="block text-mint-300 drop-shadow-lg">{`أهلاً بك في ${storeName}!`}</span>
            <span className="block mt-2 drop-shadow-lg">{'منتجات غذائية بجودة مضمونة'}</span>
          </h2>
          <p className="mt-4 max-w-lg text-lg sm:text-xl text-gray-200 drop-shadow-lg">
            {'اطلب الآن واستمتع بأفضل المواد الغذائية.'}
          </p>
          <div className="mt-8">
            <button
              onClick={handleDiscoverOffers}
              className="inline-flex items-center justify-center px-8 py-4 border border-transparent text-base font-bold rounded-md text-white bg-primary-500 hover:bg-primary-600 transition-transform transform hover:scale-105 shadow-lg"
            >
              {'اكتشف العروض'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HeroBanner;
