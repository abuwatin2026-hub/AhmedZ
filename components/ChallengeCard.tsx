import React, { useMemo } from 'react';
import { Challenge, UserChallengeProgress } from '../types';

interface ChallengeCardProps {
    challenge: Challenge;
    progress: UserChallengeProgress | undefined;
    onClaim: (progress: UserChallengeProgress) => void;
}

const ChallengeCard: React.FC<ChallengeCardProps> = ({ challenge, progress, onClaim }) => {
    const [isClaiming, setIsClaiming] = React.useState(false);

    const currentProgress = progress?.currentProgress || 0;
    const progressPercentage = useMemo(() => {
        return Math.min((currentProgress / challenge.targetCount) * 100, 100);
    }, [currentProgress, challenge.targetCount]);

    const handleClaim = async () => {
        if (!progress) return;
        setIsClaiming(true);
        await onClaim(progress);
        setIsClaiming(false);
    };

    const isCompleted = progress?.isCompleted || false;
    const isClaimed = progress?.rewardClaimed || false;

    return (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md border-l-4 border-yellow-500">
            <h4 className="font-bold text-lg text-gray-800 dark:text-white">{challenge.title.ar}</h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{challenge.description.ar}</p>
            
            <div className="mt-4">
                <div className="flex justify-between items-center mb-1 text-sm font-semibold">
                    <span className="text-gray-500 dark:text-gray-400">التقدم</span>
                    <span className="text-yellow-600 dark:text-yellow-400">{currentProgress} / {challenge.targetCount}</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                    <div 
                        className="bg-yellow-500 h-2.5 rounded-full transition-all duration-500 ease-out" 
                        style={{ width: `${progressPercentage}%` }}
                    ></div>
                </div>
            </div>

            <div className="mt-4 text-right">
                {isCompleted && !isClaimed && (
                    <button 
                        onClick={handleClaim}
                        disabled={isClaiming}
                        className="bg-green-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-green-600 transition-colors disabled:bg-green-400"
                    >
                        {isClaiming ? 'جاري...' : `استلام المكافأة (+${challenge.rewardValue} نقاط)`}
                    </button>
                )}
                {isClaimed && (
                    <span className="font-bold text-green-600 bg-green-100 dark:bg-green-900/50 py-2 px-4 rounded-lg">
                        ✅ مكتمل
                    </span>
                )}
            </div>
        </div>
    );
};

export default ChallengeCard;
