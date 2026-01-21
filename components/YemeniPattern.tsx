import React from 'react';

interface YemeniPatternProps {
    type?: 'zigzag' | 'border' | 'corner';
    color?: 'gold' | 'red';
    className?: string;
}

const YemeniPattern: React.FC<YemeniPatternProps> = ({
    type = 'zigzag',
    color = 'gold',
    className = ''
}) => {
    const colorClass = color === 'gold' ? 'text-gold-500' : 'text-primary-500';

    if (type === 'zigzag') {
        const gradient =
            color === 'gold'
                ? 'linear-gradient(90deg, #C8A947 0%, #FFD700 50%, #C8A947 100%)'
                : 'linear-gradient(90deg, #14532D 0%, #84CC16 50%, #14532D 100%)';
        return (
            <div
                className={`w-full ${className}`}
                style={{
                    height: '2px',
                    background: gradient,
                    boxShadow: color === 'gold' ? '0 0 6px rgba(212, 175, 55, 0.6)' : '0 0 6px rgba(21, 128, 61, 0.5)',
                }}
            />
        );
    }

    if (type === 'border') {
        return (
            <div className={`relative ${className}`}>
                {/* Top Border */}
                <div className="absolute top-0 left-0 right-0 h-1">
                    <svg width="100%" height="100%" viewBox="0 0 100 4" preserveAspectRatio="none" className={colorClass}>
                        <path d="M0,2 L5,0 L10,2 L15,0 L20,2 L25,0 L30,2 L35,0 L40,2 L45,0 L50,2 L55,0 L60,2 L65,0 L70,2 L75,0 L80,2 L85,0 L90,2 L95,0 L100,2" stroke="currentColor" strokeWidth="2" fill="none" />
                    </svg>
                </div>
                {/* Bottom Border */}
                <div className="absolute bottom-0 left-0 right-0 h-1">
                    <svg width="100%" height="100%" viewBox="0 0 100 4" preserveAspectRatio="none" className={colorClass}>
                        <path d="M0,2 L5,0 L10,2 L15,0 L20,2 L25,0 L30,2 L35,0 L40,2 L45,0 L50,2 L55,0 L60,2 L65,0 L70,2 L75,0 L80,2 L85,0 L90,2 L95,0 L100,2" stroke="currentColor" strokeWidth="2" fill="none" />
                    </svg>
                </div>
            </div>
        );
    }

    if (type === 'corner') {
        return (
            <div className={`absolute inset-0 pointer-events-none ${className}`}>
                {/* Top Left Corner */}
                <div className={`absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 ${color === 'gold' ? 'border-gold-500' : 'border-primary-500'}`}></div>
                {/* Top Right Corner */}
                <div className={`absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 ${color === 'gold' ? 'border-gold-500' : 'border-primary-500'}`}></div>
                {/* Bottom Left Corner */}
                <div className={`absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 ${color === 'gold' ? 'border-gold-500' : 'border-primary-500'}`}></div>
                {/* Bottom Right Corner */}
                <div className={`absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 ${color === 'gold' ? 'border-gold-500' : 'border-primary-500'}`}></div>
            </div>
        );
    }

    return null;
};

export default YemeniPattern;
