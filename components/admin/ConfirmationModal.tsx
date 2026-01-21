
import React from 'react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  children?: React.ReactNode;
  isConfirming?: boolean;
  cancelText?: string;
  confirmText?: string;
  confirmingText?: string;
  confirmButtonClassName?: string;
  maxWidthClassName?: string;
  hideConfirmButton?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  children,
  isConfirming = false,
  cancelText = 'إلغاء',
  confirmText = 'تأكيد الحذف',
  confirmingText = 'جاري الحذف...',
  confirmButtonClassName = 'bg-red-600 hover:bg-red-700 disabled:bg-red-400',
  maxWidthClassName = 'max-w-md',
  hideConfirmButton = false,
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4">
      <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full ${maxWidthClassName} animate-fade-in-up flex flex-col max-h-[min(90dvh,calc(100dvh-2rem))]`}>
        <div className="p-6 overflow-y-auto custom-scrollbar">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white sticky top-0 bg-white dark:bg-gray-800 z-10 pb-2 mb-2 border-b dark:border-gray-700">{title}</h3>
          {children ? (
            <div className="mt-3">{children}</div>
          ) : (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{message}</p>
          )}
        </div>
        <div className="p-4 bg-gray-50 dark:bg-gray-700 flex justify-end space-x-3 rtl:space-x-reverse rounded-b-lg shrink-0">
          <button
            onClick={onClose}
            disabled={isConfirming}
            className="py-2 px-4 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500 disabled:opacity-50"
          >
            {cancelText}
          </button>
          {!hideConfirmButton && (
            <button
              onClick={onConfirm}
              disabled={isConfirming}
              className={`py-2 px-4 text-white rounded-md w-32 disabled:cursor-wait ${confirmButtonClassName}`}
            >
              {isConfirming ? confirmingText : confirmText}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;
