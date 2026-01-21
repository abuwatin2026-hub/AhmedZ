import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';

type NotificationChannel = 'in_app' | 'browser';

interface NotificationSettings {
  allowToast: boolean;
  allowSound: boolean;
  allowBrowserNotification: boolean;
  mutedTypes: string[];
}

interface NotificationSettingsContextType {
  settings: NotificationSettings;
  toggleChannel: (channel: NotificationChannel, enabled: boolean) => void;
  setMutedTypes: (types: string[]) => void;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  allowToast: true,
  allowSound: true,
  allowBrowserNotification: false,
  mutedTypes: [],
};

const STORAGE_KEY = 'notification_settings_v1';

const NotificationSettingsContext = createContext<NotificationSettingsContextType | undefined>(undefined);

export const NotificationSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<NotificationSettings>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed } as NotificationSettings;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  useEffect(() => {
    if (settings.allowBrowserNotification && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }
  }, [settings.allowBrowserNotification]);

  const toggleChannel = (channel: NotificationChannel, enabled: boolean) => {
    setSettings(prev => {
      if (channel === 'in_app') return { ...prev, allowToast: enabled };
      if (channel === 'browser') return { ...prev, allowBrowserNotification: enabled };
      return prev;
    });
  };

  const setMutedTypes = (types: string[]) => {
    setSettings(prev => ({ ...prev, mutedTypes: Array.from(new Set(types)) }));
  };

  const value = useMemo<NotificationSettingsContextType>(() => ({ settings, toggleChannel, setMutedTypes }), [settings]);

  return (
    <NotificationSettingsContext.Provider value={value}>
      {children}
    </NotificationSettingsContext.Provider>
  );
};

export const useNotificationSettings = () => {
  const ctx = useContext(NotificationSettingsContext);
  if (!ctx) throw new Error('useNotificationSettings must be used within NotificationSettingsProvider');
  return ctx;
};

