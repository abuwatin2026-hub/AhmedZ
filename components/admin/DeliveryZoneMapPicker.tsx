import React, { useState, useEffect } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { logger } from '../../utils/logger';

import InteractiveMap from '../InteractiveMap';

interface DeliveryZoneMapPickerProps {
    center?: { lat: number; lng: number };
    radius?: number; // In meters
    onChange: (center: { lat: number; lng: number }, radius: number) => void;
}

const DeliveryZoneMapPicker: React.FC<DeliveryZoneMapPickerProps> = ({ center, radius, onChange }) => {
    const { language } = useSettings();
    const [lat, setLat] = useState<string>(center?.lat.toString() || '');
    const [lng, setLng] = useState<string>(center?.lng.toString() || '');
    const [rad, setRad] = useState<string>(radius?.toString() || '1000');
    const [isLocating, setIsLocating] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (center) {
            setLat(center.lat.toString());
            setLng(center.lng.toString());
        }
    }, [center]);

    useEffect(() => {
        if (radius) {
            setRad(radius.toString());
        }
    }, [radius]);

    const handleCoordinateChange = (newLat: string, newLng: string, newRad: string) => {
        setLat(newLat);
        setLng(newLng);
        setRad(newRad);

        const l = parseFloat(newLat);
        const lg = parseFloat(newLng);
        const r = parseFloat(newRad);

        if (!isNaN(l) && !isNaN(lg) && !isNaN(r)) {
            onChange({ lat: l, lng: lg }, r);
        }
    };

    const handleGetCurrentLocation = () => {
        if (!navigator.geolocation) {
            setError(language === 'ar' ? 'الموقع الجغرافي غير مدعوم' : 'Geolocation not supported');
            return;
        }

        setIsLocating(true);
        setError('');

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const newLat = position.coords.latitude.toFixed(6);
                const newLng = position.coords.longitude.toFixed(6);
                handleCoordinateChange(newLat, newLng, rad);
                setIsLocating(false);
            },
            (err) => {
                logger.error('Geolocation error:', err);
                setError(language === 'ar' ? 'تعذر تحديد الموقع. تأكد من تفعيل GPS.' : 'Unable to retrieve location. Enable GPS.');
                setIsLocating(false);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    };

    const openGoogleMaps = () => {
        const bl = lat || '15.369445'; // Default fallback
        const blg = lng || '44.191006';
        window.open(`https://www.google.com/maps/search/?api=1&query=${bl},${blg}`, '_blank');
    };

    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    const isValidCoords = !isNaN(parsedLat) && !isNaN(parsedLng);

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {language === 'ar' ? 'خط العرض (Latitude)' : 'Latitude'}
                            </label>
                            <input
                                type="number"
                                step="any"
                                value={lat}
                                onChange={(e) => handleCoordinateChange(e.target.value, lng, rad)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white ltr"
                                placeholder="15.XXXXXX"
                                dir="ltr"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {language === 'ar' ? 'خط الطول (Longitude)' : 'Longitude'}
                            </label>
                            <input
                                type="number"
                                step="any"
                                value={lng}
                                onChange={(e) => handleCoordinateChange(lat, e.target.value, rad)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white ltr"
                                placeholder="44.XXXXXX"
                                dir="ltr"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {language === 'ar' ? 'نصف القطر (متر)' : 'Radius (meters)'}
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="number"
                                value={rad}
                                onChange={(e) => handleCoordinateChange(lat, lng, e.target.value)}
                                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                min="100"
                                step="100"
                            />
                            <div className="text-sm self-center text-gray-500">
                                {language === 'ar'
                                    ? `(${(parseFloat(rad || '0') / 1000).toFixed(1)} كم)`
                                    : `(${(parseFloat(rad || '0') / 1000).toFixed(1)} km)`}
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={handleGetCurrentLocation}
                            disabled={isLocating}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-md transition dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                        >
                            {isLocating ? (
                                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            )}
                            {language === 'ar' ? 'موقعي الحالي' : 'My Location'}
                        </button>
                        <button
                            type="button"
                            onClick={openGoogleMaps}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md transition dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                        >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                            </svg>
                            {language === 'ar' ? 'فتح في خرائط جوجل' : 'Open Google Maps'}
                        </button>
                    </div>

                    {error && <p className="text-xs text-red-500">{error}</p>}

                    <div className="text-xs text-gray-500">
                        {language === 'ar'
                            ? 'نصيحة: يمكنك استخدام خرائط جوجل لنسخ الإحداثيات ثم لصقها هنا.'
                            : 'Tip: You can copy coordinates from Google Maps and paste them here.'}
                    </div>
                </div>

                <div className="w-full md:w-1/2 h-64 md:h-auto min-h-[250px] bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 relative">
                    {isValidCoords ? (
                        <>
                            <InteractiveMap
                                center={{ lat: parsedLat, lng: parsedLng }}
                                radius={parseFloat(rad || '0')}
                                onCenterChange={(center) => handleCoordinateChange(center.lat.toFixed(6), center.lng.toFixed(6), rad)}
                                title={language === 'ar' ? 'معاينة المنطقة' : 'Zone Preview'}
                                heightClassName="h-full"
                            />
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 p-4 text-center">
                            <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-sm">
                                {language === 'ar'
                                    ? 'أدخل الإحداثيات لعرض الخريطة'
                                    : 'Enter coordinates to preview map'}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DeliveryZoneMapPicker;
