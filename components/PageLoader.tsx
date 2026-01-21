// FIX: Add content to the empty PageLoader.tsx file so it becomes a valid module.
import React from 'react';

const PageLoader: React.FC = () => {
  return (
    <div className="flex justify-center items-center min-h-dvh bg-gray-100 dark:bg-gray-900">
      <div className="animate-spin rounded-full h-32 w-32 border-t-4 border-b-4 border-orange-500"></div>
    </div>
  );
};

export default PageLoader;
