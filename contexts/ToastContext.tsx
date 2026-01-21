import React, { createContext, useContext, useState, ReactNode, useCallback, useRef, useEffect } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastState {
  message: string;
  type: ToastType;
  visible: boolean;
}

interface ToastContextType {
  showNotification: (message: string, type?: ToastType, duration?: number) => void;
  notification: ToastState;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<ToastState>({ message: '', type: 'info', visible: false });
  const queueRef = useRef<Array<{ message: string; type: ToastType; duration: number }>>([]);
  const timerRef = useRef<number | null>(null);

  const processQueue = useCallback(() => {
    if (toast.visible) return;
    const next = queueRef.current.shift();
    if (!next) return;
    setToast({ message: next.message, type: next.type, visible: true });
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setToast(prev => ({ ...prev, visible: false }));
      timerRef.current = null;
      // process next after small gap to avoid flicker
      window.setTimeout(processQueue, 100);
    }, next.duration);
  }, [toast.visible]);

  useEffect(() => {
    if (!toast.visible) processQueue();
  }, [toast.visible, processQueue]);

  const showNotification = useCallback((message: string, type: ToastType = 'info', duration: number = 3000) => {
    queueRef.current.push({ message, type, duration });
    processQueue();
  }, [processQueue]);

  return (
    <ToastContext.Provider value={{ showNotification, notification: toast }}>
      {children}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
