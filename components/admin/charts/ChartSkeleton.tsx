import React from 'react';

const ChartSkeleton: React.FC = () => {
  return (
    <div className="animate-pulse h-full flex flex-col">
      <div className="h-6 w-3/5 bg-gray-300 dark:bg-gray-600 rounded-md mb-6"></div>
      <div className="flex-grow space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-4 w-16 bg-gray-300 dark:bg-gray-600 rounded-md"></div>
          <div className="h-4 flex-grow bg-gray-200 dark:bg-gray-700 rounded-full"></div>
        </div>
         <div className="flex items-center gap-4">
          <div className="h-4 w-20 bg-gray-300 dark:bg-gray-600 rounded-md"></div>
          <div className="h-4 flex-grow bg-gray-200 dark:bg-gray-700 rounded-full"></div>
        </div>
         <div className="flex items-center gap-4">
          <div className="h-4 w-12 bg-gray-300 dark:bg-gray-600 rounded-md"></div>
          <div className="h-4 flex-grow bg-gray-200 dark:bg-gray-700 rounded-full"></div>
        </div>
        <div className="flex items-center gap-4">
          <div className="h-4 w-24 bg-gray-300 dark:bg-gray-600 rounded-md"></div>
          <div className="h-4 flex-grow bg-gray-200 dark:bg-gray-700 rounded-full"></div>
        </div>
         <div className="flex items-center gap-4">
          <div className="h-4 w-16 bg-gray-300 dark:bg-gray-600 rounded-md"></div>
          <div className="h-4 flex-grow bg-gray-200 dark:bg-gray-700 rounded-full"></div>
        </div>
      </div>
    </div>
  );
};

export default ChartSkeleton;