import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect, useRef } from 'react';
import { disableRealtime, getSupabaseClient, isRealtimeEnabled } from '../supabase';
import { useAuth } from './AuthContext';
import { useUserAuth } from './UserAuthContext';
import type { Notification } from '../types';
import { localizeSupabaseError } from '../utils/errorUtils';
import { useToast } from './ToastContext';
import { useNotificationSettings } from './NotificationSettingsContext';

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  fetchNotifications: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const isRefreshingRef = useRef(false);
  
  const { user: adminUser } = useAuth();
  const { currentUser } = useUserAuth();
  const { showNotification } = useToast();
  const { settings } = useNotificationSettings();
  const activeUserId = currentUser?.id || adminUser?.id || null;
  const supabase = getSupabaseClient();
  const idSetRef = useRef<Set<string>>(new Set());
  const playSound = useCallback((url: string) => {
    try {
      const audio = new Audio(url);
      audio.play().catch(() => {});
    } catch {
    }
  }, []);

  const cacheKey = activeUserId ? `notifications_cache_v1_${activeUserId}` : null;

  const fetchNotifications = useCallback(async () => {
    if (!activeUserId || !supabase) return;
    if (isRefreshingRef.current) return;
    
    try {
      isRefreshingRef.current = true;
      setLoading(true);
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', activeUserId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
          if (error.code === '42P01') return;
          throw error;
      }

      const notes = (data || []).map((n: any) => ({
        id: n.id,
        userId: n.user_id,
        title: n.title,
        message: n.message,
        type: n.type,
        link: n.link,
        isRead: n.is_read,
        createdAt: n.created_at
      }));

      notes.forEach(n => idSetRef.current.add(n.id));
      setNotifications(notes);
      setUnreadCount(notes.filter(n => !n.isRead).length);
      if (cacheKey) {
        try { localStorage.setItem(cacheKey, JSON.stringify(notes)); } catch {}
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
      showNotification(localizeSupabaseError(err), 'error');
    } finally {
      isRefreshingRef.current = false;
      setLoading(false);
    }
  }, [activeUserId, supabase, showNotification, cacheKey]);

  const markAsRead = async (id: string) => {
    try {
      const { error } = await supabase!
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);

      if (error) throw error;

      setNotifications(prev => {
        const next = prev.map(n => n.id === id ? { ...n, isRead: true } : n);
        if (cacheKey) {
          try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch {}
        }
        return next;
      });
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Error marking notification as read:', err);
      showNotification(localizeSupabaseError(err), 'error');
    }
  };

  const markAllAsRead = async () => {
    if (!activeUserId || !supabase) return;
    try {
      const { error } = await supabase!
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', activeUserId)
        .eq('is_read', false);

      if (error) throw error;

      setNotifications(prev => {
        const next = prev.map(n => ({ ...n, isRead: true }));
        if (cacheKey) {
          try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch {}
        }
        return next;
      });
      setUnreadCount(0);
    } catch (err) {
      console.error('Error marking all notifications as read:', err);
      showNotification(localizeSupabaseError(err), 'error');
    }
  };

  useEffect(() => {
    if (!activeUserId || !supabase) {
        idSetRef.current = new Set();
        setNotifications([]);
        setUnreadCount(0);
        return;
    }

    idSetRef.current = new Set();

    try {
      if (cacheKey) {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const cached = JSON.parse(raw) as Notification[];
          cached.forEach(n => idSetRef.current.add(n.id));
          setNotifications(cached);
          setUnreadCount(cached.filter(n => !n.isRead).length);
        }
      }
    } catch {}

    fetchNotifications();

    const scheduleRefetch = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchNotifications();
    };

    const onFocus = () => scheduleRefetch();
    const onVisibility = () => scheduleRefetch();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      window.addEventListener('visibilitychange', onVisibility);
    }

    const intervalId = typeof window !== 'undefined'
      ? window.setInterval(() => scheduleRefetch(), 15000)
      : undefined;

    if (!isRealtimeEnabled()) {
      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('focus', onFocus);
          window.removeEventListener('visibilitychange', onVisibility);
          if (typeof intervalId === 'number') window.clearInterval(intervalId);
        }
      };
    }

    const channel = supabase
      .channel('public:notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${activeUserId}`,
        },
        (payload) => {
          const newNote = payload.new as any;
          const mappedNote: Notification = {
              id: newNote.id,
              userId: newNote.user_id,
              title: newNote.title,
              message: newNote.message,
              type: newNote.type,
              link: newNote.link,
              isRead: newNote.is_read,
              createdAt: newNote.created_at
          };
          
          if (!idSetRef.current.has(mappedNote.id)) {
            idSetRef.current.add(mappedNote.id);
            setNotifications(prev => {
              const next = [mappedNote, ...prev];
              if (cacheKey) {
                try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch {}
              }
              return next;
            });
            setUnreadCount(prev => prev + 1);

            const isMuted = settings.mutedTypes.includes(String(mappedNote.type || ''));
            const toastAllowed = settings.allowToast && !isMuted;
            const soundAllowed = settings.allowSound && !isMuted;
            const browserAllowed = settings.allowBrowserNotification && !isMuted && 'Notification' in window && Notification.permission === 'granted';

            if (toastAllowed) {
              const msg = mappedNote.message ? `${mappedNote.title}: ${mappedNote.message}` : mappedNote.title;
              showNotification(msg, 'info');
            }
            if (soundAllowed) {
              playSound('/sounds/new_order.mp3');
            }
            if (browserAllowed) {
              try { new Notification(mappedNote.title, { body: mappedNote.message || '', tag: mappedNote.id }); } catch {}
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${activeUserId}`,
        },
        (payload) => {
          const row: any = payload.new;
          if (!row?.id) return;
          const mapped: Notification = {
            id: String(row.id),
            userId: String(row.user_id),
            title: String(row.title || ''),
            message: typeof row.message === 'string' ? row.message : '',
            type: row.type,
            link: typeof row.link === 'string' ? row.link : '',
            isRead: Boolean(row.is_read),
            createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
          };
          setNotifications(prev => {
            const next = prev.map(n => (n.id === mapped.id ? mapped : n));
            if (cacheKey) {
              try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch {}
            }
            setUnreadCount(next.filter(n => !n.isRead).length);
            return next;
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${activeUserId}`,
        },
        (payload) => {
          const deletedId = (payload.old as any)?.id;
          if (!deletedId) return;
          setNotifications(prev => {
            const next = prev.filter(n => n.id !== String(deletedId));
            if (cacheKey) {
              try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch {}
            }
            setUnreadCount(next.filter(n => !n.isRead).length);
            return next;
          });
        }
      )
      .subscribe((status: any) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          disableRealtime();
          supabase.removeChannel(channel);
        }
      });

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('visibilitychange', onVisibility);
        if (typeof intervalId === 'number') window.clearInterval(intervalId);
      }
      supabase?.removeChannel(channel);
    };
  }, [activeUserId, fetchNotifications, showNotification, supabase, settings, adminUser, cacheKey]);

  return (
    <NotificationContext.Provider value={{ 
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead,
        fetchNotifications
    }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};
