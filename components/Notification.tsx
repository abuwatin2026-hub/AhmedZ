import React from 'react';
import { useToast } from '../contexts/ToastContext';
import { InfoIcon, SuccessIcon } from './icons';

const Notification: React.FC = () => {
  const { notification } = useToast();
  const { message, type, visible } = notification;

  const baseClasses =
    'fixed top-[calc(env(safe-area-inset-top)+1rem)] left-4 right-4 sm:left-auto sm:right-5 z-[1200] flex items-start gap-3 p-4 rounded-lg shadow-lg text-white transition-all duration-300 ease-in-out max-w-[calc(100vw-2rem)] sm:max-w-md';
  const typeClasses = {
    info: 'bg-blue-500',
    success: 'bg-green-500',
    error: 'bg-red-500',
  };

  const transformClass = visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0 pointer-events-none';

  return (
    <div className={`${baseClasses} ${typeClasses[type]} ${transformClass}`} role="alert">
      <div className="mt-0.5 flex-shrink-0">
        {type === 'success' ? <SuccessIcon /> : <InfoIcon />}
      </div>
      <span className="min-w-0 flex-1 font-medium break-words whitespace-pre-wrap">{message}</span>
    </div>
  );
};

export default Notification;
