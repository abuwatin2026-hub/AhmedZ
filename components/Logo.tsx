import React from 'react';
import { useSettings } from '../contexts/SettingsContext';

interface LogoProps {
    size?: 'sm' | 'md' | 'lg' | 'xl';
    variant?: 'full' | 'icon' | 'text';
    className?: string;
}

const Logo: React.FC<LogoProps> = ({
    size = 'md',
    variant = 'full',
    className = ''
}) => {
    const { settings, language } = useSettings();
    const storeName = settings.cafeteriaName?.[language] || settings.cafeteriaName?.ar || settings.cafeteriaName?.en;
    const storeNameEn = settings.cafeteriaName?.en;

    const sizeClasses = {
        sm: 'h-8',
        md: 'h-12',
        lg: 'h-16',
        xl: 'h-24',
    };

    const textSizeClasses = {
        sm: 'text-lg',
        md: 'text-2xl',
        lg: 'text-3xl',
        xl: 'text-5xl',
    };

    const LogoIcon: React.FC<{ extraClassName?: string }> = ({ extraClassName = '' }) => {
        if (settings.logoUrl) {
            return (
                <img
                    src={settings.logoUrl}
                    alt={storeName}
                    className={`${sizeClasses[size]} w-auto ${extraClassName}`}
                />
            );
        }

        return (
            <svg
                viewBox="0 0 100 100"
                className={`${sizeClasses[size]} ${extraClassName}`}
                fill="none"
            >
                <circle cx="50" cy="50" r="46" fill="#FFFFFF" stroke="#2F2B7C" strokeWidth="6" />
                <circle cx="50" cy="50" r="34" fill="#FFFFFF" stroke="#2F2B7C" strokeWidth="2" opacity="0.9" />
                <text x="50" y="60" textAnchor="middle" fill="#2F2B7C" fontSize="32" fontWeight="800" fontFamily="Inter, Arial, sans-serif">
                    AZT
                </text>
            </svg>
        );
    };

    if (variant === 'icon') {
        return <LogoIcon extraClassName={className} />;
    }

    if (variant === 'text') {
        return (
            <div className={`font-bold ${textSizeClasses[size]} ${className}`}>
                <span className="text-primary-500">{storeName}</span>
            </div>
        );
    }

    return (
        <div className={`flex items-center gap-3 ${className}`}>
            <LogoIcon />
            <div className="flex flex-col">
                <div className={`font-bold ${textSizeClasses[size]} leading-tight`}>
                    <span className="text-primary-500">{storeName}</span>
                </div>
                {storeNameEn && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 font-english">
                        {storeNameEn}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Logo;
