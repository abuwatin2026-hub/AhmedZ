import React from 'react';

const MenuItemCardSkeleton: React.FC = () => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden h-full flex flex-col border border-gray-200 dark:border-gray-700/50 animate-pulse">
      <div className="w-full h-48 bg-gray-300 dark:bg-gray-600"></div>
      <div className="p-4 flex flex-col flex-grow">
        <div className="h-6 w-3/4 bg-gray-300 dark:bg-gray-600 rounded"></div>
        <div className="mt-3 space-y-2 flex-grow">
            <div className="h-4 w-full bg-gray-300 dark:bg-gray-600 rounded"></div>
            <div className="h-4 w-1/2 bg-gray-300 dark:bg-gray-600 rounded"></div>
        </div>
        <div className="flex justify-between items-center mt-4">
          <div className="h-8 w-1/3 bg-gray-300 dark:bg-gray-600 rounded"></div>
          <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600"></div>
        </div>
      </div>
    </div>
  );
};

export default MenuItemCardSkeleton;
