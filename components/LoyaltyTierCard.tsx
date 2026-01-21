import React from 'react';
import { useUserAuth } from '../contexts/UserAuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { LoyaltyTier } from '../types';

const tierIcons: Record<LoyaltyTier, string> = {
    regular: '👋',
    bronze: '🥉',
    silver: '🥈',
    gold: '🥇',
};

const tierColors: Record<LoyaltyTier, { bg: string, text: string, progress: string }> = {
    regular: { bg: 'bg-gray-400', text: 'text-gray-100', progress: 'bg-gray-200' },
    bronze: { bg: 'bg-yellow-600', text: 'text-yellow-100', progress: 'bg-yellow-400' },
    silver: { bg: 'bg-gray-500', text: 'text-gray-100', progress: 'bg-gray-300' },
    gold: { bg: 'bg-amber-500', text: 'text-amber-100', progress: 'bg-amber-300' },
};

const LoyaltyTierCard: React.FC = () => {
    const { currentUser } = useUserAuth();
    const { settings } = useSettings();

    if (!currentUser) return null;

    const { loyaltyTier, totalSpent, loyaltyPoints } = currentUser;
    const { tiers } = settings.loyaltySettings;

    const currentTierDetails = tiers[loyaltyTier];
    const nextTierKey: LoyaltyTier | null = 
        loyaltyTier === 'regular' ? 'bronze' : 
        loyaltyTier === 'bronze' ? 'silver' : 
        loyaltyTier === 'silver' ? 'gold' : 
        null;
    const nextTierDetails = nextTierKey ? tiers[nextTierKey] : null;

    const progressPercentage = nextTierDetails 
        ? Math.min((totalSpent / nextTierDetails.threshold) * 100, 100)
        : 100;
        
    const amountToNextTier = nextTierDetails ? nextTierDetails.threshold - totalSpent : 0;
    const currentTierName = currentTierDetails.name.ar || '';
    const nextTierName = nextTierDetails ? (nextTierDetails.name.ar || '') : '';

    return (
        <div className={`p-5 rounded-xl shadow-lg ${tierColors[loyaltyTier].bg} text-white`}>
            <div className="flex justify-between items-start">
                <div>
                    <p className={`text-sm font-medium ${tierColors[loyaltyTier].text} opacity-80`}>المستوى الحالي</p>
                    <p className="text-2xl font-bold flex items-center gap-2">
                        <span>{tierIcons[loyaltyTier]}</span>
                        <span>{currentTierName}</span>
                    </p>
                </div>
                 <div className="text-right">
                     <p className={`text-sm font-medium ${tierColors[loyaltyTier].text} opacity-80`}>نقاطي</p>
                    <p className="text-2xl font-bold">{loyaltyPoints}</p>
                </div>
            </div>

            {nextTierDetails && (
                <div className="mt-4">
                    <div className="flex justify-between items-center mb-1 text-xs font-semibold">
                        <span className={`${tierColors[loyaltyTier].text}`}>متبقي {amountToNextTier.toFixed(0)} للوصول إلى {nextTierName}</span>
                        <span className={`${tierColors[loyaltyTier].text}`}>{nextTierName}</span>
                    </div>
                    <div className="w-full bg-black/20 rounded-full h-2.5">
                        <div 
                            className={`${tierColors[loyaltyTier].progress} h-2.5 rounded-full transition-all duration-500 ease-out`} 
                            style={{ width: `${progressPercentage}%` }}
                        ></div>
                    </div>
                </div>
            )}
            
            <div className="mt-5 pt-3 border-t border-white/20">
                <h4 className={`font-semibold text-sm ${tierColors[loyaltyTier].text}`}>المزايا:</h4>
                <ul className="text-xs list-disc list-inside mt-2 space-y-1">
                    {currentTierDetails.discountPercentage > 0 ? (
                        <li>خصم دائم {currentTierDetails.discountPercentage}%</li>
                    ) : (
                        <li className="opacity-80">احصل على مزايا جديدة عند تحقيق المستوى التالي</li>
                    )}
                     {nextTierDetails && (
                        <li className="opacity-60">المستوى التالي: خصم دائم {nextTierDetails.discountPercentage}%</li>
                     )}
                </ul>
            </div>
        </div>
    );
};

export default LoyaltyTierCard;
