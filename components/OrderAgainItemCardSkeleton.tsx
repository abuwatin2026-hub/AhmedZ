import React from 'react';

const OrderAgainItemCardSkeleton: React.FC = () => {
  return (
    <div className="flex-shrink-0 w-40 animate-pulse">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden h-full flex flex-col border border-gray-200 dark:border-gray-700/50">
        <div className="w-full h-24 bg-gray-300 dark:bg-gray-600"></div>
        <div className="p-2 flex flex-col flex-grow">
          <div className="h-4 w-3/4 bg-gray-300 dark:bg-gray-600 rounded"></div>
          <div className="flex justify-between items-center mt-3">
            <div className="h-6 w-1/3 bg-gray-300 dark:bg-gray-600 rounded"></div>
            <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderAgainItemCardSkeleton;
