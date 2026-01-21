import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAds } from '../contexts/AdContext';
import { useSettings } from '../contexts/SettingsContext';

interface AdCarouselProps {
    onCategorySelect: (category: string) => void;
}

const AdCarousel: React.FC<AdCarouselProps> = ({ onCategorySelect }) => {
    const { ads, loading } = useAds();
    const { language, settings } = useSettings();
    const navigate = useNavigate();
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isTextVisible, setIsTextVisible] = useState(true);
    const timeoutRef = useRef<number | null>(null);

    const storeName = settings.cafeteriaName?.[language] || settings.cafeteriaName?.ar || settings.cafeteriaName?.en;
    const withBranding = (text: string) => text
        .replace(/\{storeName\}/g, String(storeName))
        .replace(/\bQati\b/g, String(storeName))
        .replace(/قاتي/g, String(storeName));

    const activeAds = useMemo(() => {
        return ads.filter(ad => ad.status === 'active').sort((a, b) => a.order - b.order);
    }, [ads]);

    const resetTimeout = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
    };

    useEffect(() => {
        if (activeAds.length <= 1) {
            return;
        }

        resetTimeout();
        setIsTextVisible(true); 

        timeoutRef.current = window.setTimeout(() => {
            setIsTextVisible(false);
            setTimeout(() => {
                 setCurrentIndex((prevIndex) => (prevIndex + 1) % activeAds.length);
            }, 300);
        }, 5000);

        return () => {
            resetTimeout();
        };
    }, [currentIndex, activeAds.length]);

    const goToSlide = (index: number) => {
        if (index === currentIndex) return;
        
        resetTimeout();
        setIsTextVisible(false);
        setTimeout(() => {
            setCurrentIndex(index);
        }, 300);
    };

    const handleAdClick = (ad: typeof activeAds[0]) => {
        if (ad.actionType === 'item' && ad.actionTarget) {
            navigate(`/item/${ad.actionTarget}`);
        } else if (ad.actionType === 'category' && ad.actionTarget) {
            onCategorySelect(ad.actionTarget);
            const menuSection = document.getElementById('featured-items-section');
            menuSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    if (loading) {
        return <div className="w-full aspect-[1/1] md:aspect-[16/9] bg-gray-300 dark:bg-gray-700 animate-pulse"></div>;
    }
    
    if (activeAds.length === 0) {
        return null;
    }

    return (
        <div className="relative w-full">
            <div className="relative aspect-[1/1] md:aspect-[16/9] overflow-hidden bg-gray-200 dark:bg-gray-800">
                {activeAds.map((ad, index) => (
                    <div 
                        key={ad.id} 
                        className="absolute top-0 left-0 w-full h-full transition-opacity duration-1000 ease-in-out"
                        style={{ opacity: index === currentIndex ? 1 : 0, zIndex: index === currentIndex ? 10 : 1 }}
                    >
                        <div 
                            className={`w-full h-full ${ad.actionType !== 'none' ? 'cursor-pointer group' : ''}`}
                            role={ad.actionType !== 'none' ? 'button' : undefined}
                            aria-label={withBranding(ad.title?.ar || ad.title?.en || '')}
                            onClick={() => handleAdClick(ad)}
                        >
                            <img src={ad.imageUrl} alt={withBranding(ad.title?.ar || ad.title?.en || '')} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                            <div className="absolute inset-0 bg-black/30"></div>
                            <div className="absolute inset-0 flex items-center justify-center p-6 md:p-12 text-white text-center">
                                {index === currentIndex && (
                                     <div className={`transition-all duration-500 ease-out ${isTextVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
                                        <h2 className="text-3xl sm:text-5xl font-black text-white leading-tight drop-shadow-lg">
                                            <span className="block">{withBranding(ad.title?.ar || ad.title?.en || '')}</span>
                                        </h2>
                                        <p className="mt-2 max-w-lg text-md sm:text-xl text-gray-200 drop-shadow-lg mx-auto md:mx-0">
                                            {withBranding(ad.subtitle?.ar || ad.subtitle?.en || '')}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}

                 {activeAds.length > 1 && (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2 z-20">
                        {activeAds.map((_, index) => (
                            <button
                                key={index}
                                onClick={() => goToSlide(index)}
                                className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                                    currentIndex === index ? 'bg-white scale-125 w-6' : 'bg-white/50 hover:bg-white'
                                }`}
                                aria-label={`Go to slide ${index + 1}`}
                            ></button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
export default AdCarousel;
