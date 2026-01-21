import React from 'react';

const FeaturedMenuItemCardSkeleton: React.FC = () => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden h-full flex items-center border border-gray-200 dark:border-gray-700/50 animate-pulse">
      <div className="w-28 h-28 bg-gray-300 dark:bg-gray-600 flex-shrink-0"></div>
      <div className="p-4 flex flex-col flex-grow w-full space-y-2">
        <div className="h-5 w-3/5 bg-gray-300 dark:bg-gray-600 rounded"></div>
        <div className="h-3 w-full bg-gray-300 dark:bg-gray-600 rounded"></div>
        <div className="h-3 w-4/5 bg-gray-300 dark:bg-gray-600 rounded"></div>
        <div className="mt-1 h-6 w-1/4 bg-gray-300 dark:bg-gray-600 rounded"></div>
      </div>
    </div>
  );
};

export default FeaturedMenuItemCardSkeleton;
