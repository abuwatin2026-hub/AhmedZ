
import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import type { AdminPermission, AdminRole, AdminUser } from '../types';
export type { AdminPermission, AdminRole, AdminUser }; // Re-export types
import { ADMIN_PERMISSION_DEFS, defaultAdminPermissionsForRole } from '../types';
import { useSettings } from './SettingsContext';
import { getSupabaseClient } from '../supabase';
import { validatePasswordStrength } from '../utils/passwordUtils';
import { createLogger } from '../utils/logger';
import { localizeSupabaseError } from '../utils/errorUtils';

const logger = createLogger('AuthContext');

interface AuthContextType {
  authProvider: 'supabase';
  isAuthenticated: boolean;
  userId: string | null;
  user: AdminUser | null;
  isConfigured: boolean;
  loading: boolean;
  login: (username: string, pass: string) => Promise<boolean>;
  setupAdmin: (username: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (updatedData: Partial<AdminUser>) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  listAdminUsers: () => Promise<AdminUser[]>;
  createAdminUser: (data: { username: string; fullName: string; role: AdminRole; password: string; permissions?: AdminPermission[] }) => Promise<void>;
  updateAdminUser: (userId: string, updates: Partial<Pick<AdminUser, 'username' | 'fullName' | 'email' | 'phoneNumber' | 'avatarUrl' | 'role' | 'permissions'>>) => Promise<void>;
  setAdminUserActive: (userId: string, isActive: boolean) => Promise<void>;
  resetAdminUserPassword: (userId: string, newPassword: string) => Promise<void>;
  deleteAdminUser: (userId: string) => Promise<void>;
  hasPermission: (permission: AdminPermission) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const { language } = useSettings();

  const normalizeUsername = (value: string) => value.trim();
  const makeServiceEmail = (value: string) => {
    const raw = (value || '').trim();
    if (!raw) return `user-${Date.now()}@azt-system.local`;
    if (raw.includes('@')) return raw.toLowerCase();
    const ascii = raw.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
    let slug = ascii.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').replace(/\.{2,}/g, '.').replace(/-+/g, '-').toLowerCase();
    if (!slug || slug === '.' || slug === '-') slug = `user-${Date.now()}`;
    if (slug.length > 64) slug = slug.slice(0, 64).replace(/[-.]+$/, '');
    if (!slug) slug = `user-${Date.now()}`;
    return `${slug}@azt-system.local`;
  };
  const supabase = useMemo(() => getSupabaseClient(), []);
  const authProvider: 'supabase' = 'supabase';

  const allPermissions: AdminPermission[] = ADMIN_PERMISSION_DEFS.map(def => def.key);
  const allPermissionsSet = useMemo(() => new Set(allPermissions), [allPermissions]);

  const defaultPermissionsForRole = (role: AdminRole): AdminPermission[] => defaultAdminPermissionsForRole(role);

  const getEffectivePermissions = (candidate: AdminUser): Set<AdminPermission> => {
    if (candidate.role === 'owner' || candidate.role === 'manager') return new Set(allPermissions);
    if (Array.isArray(candidate.permissions) && candidate.permissions.length) {
      return new Set(candidate.permissions);
    }
    return new Set(defaultPermissionsForRole(candidate.role));
  };

  const hasPermission = (permission: AdminPermission) => {
    if (!user) return false;
    return getEffectivePermissions(user).has(permission);
  };

  const ensurePermission = (permission: AdminPermission) => {
    if (!user) throw new Error('لم يتم تسجيل الدخول.');
    if (!hasPermission(permission)) throw new Error('ليس لديك صلاحية تنفيذ هذا الإجراء.');
  };

  const toRole = (value: unknown): AdminRole => {
    if (value === 'owner' || value === 'manager' || value === 'delivery' || value === 'employee' || value === 'cashier' || value === 'accountant') return value as AdminRole;
    return 'employee';
  };

  const toPermissions = (value: unknown): AdminPermission[] => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter(v => typeof v === 'string' && allPermissionsSet.has(v as AdminPermission)) as AdminPermission[]));
  };

  const mapRemoteAdminToUser = (authUser: { id: string; email?: string | null }, row: Record<string, unknown>): AdminUser => {
    const now = new Date().toISOString();
    return {
      id: String(row?.auth_user_id || authUser.id),
      username: String(row?.username || ''),
      fullName: String(row?.full_name || 'المالك'),
      email: typeof row?.email === 'string' ? row.email : (authUser.email || undefined),
      phoneNumber: typeof row?.phone_number === 'string' ? row.phone_number : undefined,
      avatarUrl: typeof row?.avatar_url === 'string' ? row.avatar_url : undefined,
      role: toRole(row?.role),
      permissions: toPermissions(row?.permissions),
      isActive: Boolean(row?.is_active ?? true),
      passwordSalt: '',
      passwordHash: '',
      createdAt: typeof row?.created_at === 'string' ? row.created_at : now,
      updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : now,
    };
  };

  const logAudit = async (action: string, details: string, userId: string, metadata?: any) => {
    if (!supabase) return;
    try {
      await supabase.from('system_audit_logs').insert({
        action,
        module: 'auth',
        details,
        performed_by: userId,
        performed_at: new Date().toISOString(),
        metadata
      });
    } catch (err) {
      console.error('Audit log failed:', err);
    }
  };

  const loadRemoteProfile = async (authUser: { id: string; email?: string | null }) => {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('admin_users')
      .select('auth_user_id, username, full_name, role, permissions, is_active, email, phone_number, avatar_url, created_at, updated_at')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();
    if (error) throw new Error(localizeSupabaseError(error));
    if (!data) return null;
    return mapRemoteAdminToUser(authUser, data);
  };

  const hydrateSession = async () => {
    if (!supabase) {
      setIsConfigured(false);
      setIsAuthenticated(false);
      setUser(null);
      return;
    }

    setIsConfigured(true);
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(localizeSupabaseError(error));
    const authUser = data.session?.user;
    if (!authUser) {
      setIsAuthenticated(false);
      setUser(null);
      return;
    }
    const profile = await loadRemoteProfile({ id: authUser.id, email: authUser.email });
    if (!profile || !profile.isActive) {
      setIsAuthenticated(false);
      setUser(null);
      return;
    }
    setUser(profile);
    setIsAuthenticated(true);
  };

  useEffect(() => {
    let cancelled = false;
    let timedOut = false;
    const timeoutMs = Number((import.meta.env as any)?.VITE_ADMIN_AUTH_INIT_TIMEOUT_MS || 8000);
    const timeoutId = typeof window !== 'undefined'
      ? window.setTimeout(() => {
        timedOut = true;
        if (!cancelled) setLoading(false);
      }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8000)
      : null;
    const run = async () => {
      try {
        await hydrateSession();
      } catch (err) {
        logger.warn('Admin auth hydrate failed', { error: err instanceof Error ? err.message : String(err) });
      } finally {
        if (timeoutId != null) window.clearTimeout(timeoutId);
        if (!cancelled && !timedOut) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, []);

  const login = async (username: string, pass: string): Promise<boolean> => {
    if (!supabase) return false;
    const email = normalizeUsername(username);
    if (!email) return false;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) {
      logger.warn('Supabase login failed', { email, error: localizeSupabaseError(error) });
      return false;
    }
    const authUser = data.user;
    if (!authUser) return false;
    const profile = await loadRemoteProfile({ id: authUser.id, email: authUser.email });
    if (!profile || !profile.isActive) {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
      }
      logger.warn('Admin login denied - inactive or no profile', { userId: authUser.id });
      throw new Error('هذا الحساب ليس لديه صلاحيات لوحة التحكم.');
    }
    setIsConfigured(true);
    setUser(profile);
    setIsAuthenticated(true);
    logger.info('Admin logged in successfully (Supabase)', { userId: profile.id });

    // Log Audit
    logAudit('login', 'User logged in', profile.id, { email: profile.email, role: profile.role });

    return true;
  };

  const setupAdmin = async (username: string, pass: string) => {
    void username;
    void pass;
    throw new Error('إعداد حساب المالك يتم عبر Supabase Auth ثم تعيينه كمالك داخل قاعدة البيانات.');
  };

  const logout = async () => {
    if (!supabase) return;
    if (user) {
      logAudit('logout', 'User logged out', user.id);
    }
    try {
      const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
      const { data: sessionData } = await supabase.auth.getSession();
      if (isOnline && sessionData.session) {
        let attempts = 0;
        const maxAttempts = 3;
        let lastError: any = null;
        while (attempts < maxAttempts) {
          try {
            await supabase.auth.signOut({ scope: 'local' });
            lastError = null;
            break;
          } catch (err: any) {
            const msg = String(err?.message || '');
            const aborted = /abort|ERR_ABORTED|Failed to fetch/i.test(msg);
            if (aborted) {
              lastError = null;
              break;
            }
            lastError = err;
            attempts += 1;
            if (attempts < maxAttempts) {
              await new Promise(res => setTimeout(res, attempts * 500));
            }
          }
        }
        if (lastError) {
          logger.warn('Logout failed', { error: lastError?.message || String(lastError) });
        }
      }
    } catch {
    }
    setIsAuthenticated(false);
    setUser(null);
  };

  const updateProfile = async (updatedData: Partial<AdminUser>) => {
    if (!user) return;
    if (!supabase) throw new Error(language === 'ar' ? 'Supabase غير مهيأ.' : 'Supabase not initialized.');

    const nextUsername = typeof updatedData.username === 'string' ? normalizeUsername(updatedData.username) : user.username;
    if (!nextUsername) throw new Error(language === 'ar' ? 'اسم المستخدم مطلوب.' : 'Username is required.');

    const updates: Record<string, any> = {
      username: nextUsername,
      full_name: typeof updatedData.fullName === 'string' ? updatedData.fullName.trim() : user.fullName,
      phone_number: typeof updatedData.phoneNumber === 'string' ? updatedData.phoneNumber.trim() : user.phoneNumber,
      avatar_url: typeof updatedData.avatarUrl === 'string' ? updatedData.avatarUrl.trim() : user.avatarUrl,
      updated_at: new Date().toISOString(), // Ensure updated_at is refreshed
    };

    const email = typeof updatedData.email === 'string' ? updatedData.email.trim() : undefined;

    // 1. If email is changing, update Supabase Auth first
    if (email && email !== user.email) {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) {
        logger.error(localizeSupabaseError(error));
        throw new Error(localizeSupabaseError(error));
      }
      updates.email = email;
    } else if (typeof updatedData.email === 'string') {
      updates.email = updatedData.email.trim();
    }

    // 2. Update the admin_users table
    // Important: The RLS 'Self update profile' must allow this.
    const { error: dbError } = await supabase
      .from('admin_users')
      .update(updates)
      .eq('auth_user_id', user.id);

    if (dbError) {
      logger.error(localizeSupabaseError(dbError));
      throw new Error(localizeSupabaseError(dbError));
    }

    // 3. Reload profile to confirm
    const { data: sessionData } = await supabase.auth.getUser();
    const next = await loadRemoteProfile({ id: user.id, email: sessionData.user?.email || updates.email || user.email });

    if (next) {
      setUser(next);
    } else {
      // Fallback if loadRemoteProfile fails immediately (e.g. latency)
      setUser(prev => prev ? ({ ...prev, ...updatedData, email: updates.email || prev.email } as AdminUser) : null);
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!user) throw new Error('لم يتم تسجيل الدخول.');
    if (!supabase) throw new Error('Supabase غير مهيأ.');
    const passwordError = validatePasswordStrength(newPassword);
    if (passwordError) throw new Error(passwordError);

    const { data, error } = await supabase.auth.getUser();
    if (error) throw new Error(localizeSupabaseError(error));
    const email = data.user?.email;
    if (!email) throw new Error('تعذر تحديد البريد الإلكتروني للحساب.');
    const reAuth = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (reAuth.error) throw new Error('كلمة المرور الحالية غير صحيحة.');
    const updated = await supabase.auth.updateUser({ password: newPassword });
    if (updated.error) throw new Error(localizeSupabaseError(updated.error));
    logger.info('Password changed successfully (Supabase)', { userId: user.id });
  };

  const listAdminUsers = async () => {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('admin_users')
      .select('auth_user_id, username, full_name, role, permissions, is_active, email, phone_number, avatar_url, created_at, updated_at')
      .order('username', { ascending: true });
    if (error) throw new Error(localizeSupabaseError(error));
    return (data || []).map(row =>
      mapRemoteAdminToUser({ id: String(row.auth_user_id), email: typeof row.email === 'string' ? row.email : undefined }, row)
    );
  };

  const localizeAdminInvokeError = (message: string) => {
    const raw = message.trim();
    if (!raw) return 'فشل تنفيذ العملية.';
    const normalized = raw.toLowerCase();
    if (normalized.includes('invalid jwt') || normalized.includes('jwt')) return 'انتهت الجلسة أو بيانات الدخول غير صالحة. أعد تسجيل الدخول ثم حاول مرة أخرى.';
    if (normalized.includes('failed to fetch') || normalized.includes('network') || normalized.includes('fetch')) return 'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.';
    if (normalized.includes('forbidden') || normalized.includes('not authorized') || normalized.includes('permission')) return 'ليس لديك صلاحية تنفيذ هذا الإجراء.';
    if (normalized.includes('already registered') || normalized.includes('user already')) return 'هذا البريد مستخدم مسبقاً.';
    if (normalized.includes('duplicate') && normalized.includes('username')) return 'اسم المستخدم مستخدم مسبقاً.';
    if (normalized.includes('missing required')) return 'الحقول المطلوبة ناقصة.';
    if (normalized.includes('unable to validate email address') || normalized.includes('invalid format') && normalized.includes('email')) return 'تعذر التحقق من البريد الإلكتروني. يرجى استخدام اسم مستخدم بحروف لاتينية أو إدخال بريد صالح.';
    return raw;
  };

  const extractFunctionErrorMessage = async (error: unknown): Promise<string | null> => {
    const maybeContext = (error as { context?: { text?: () => Promise<string>; json?: () => Promise<any> } })?.context;
    if (!maybeContext) return null;

    const tryParse = (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return null;
      try {
        const parsed = JSON.parse(trimmed);
        const msg = parsed?.error || parsed?.message;
        return typeof msg === 'string' ? msg : trimmed;
      } catch {
        return trimmed;
      }
    };

    if (typeof maybeContext.text === 'function') {
      try {
        const text = await maybeContext.text();
        return tryParse(String(text));
      } catch {
      }
    }

    if (typeof maybeContext.json === 'function') {
      try {
        const body = await maybeContext.json();
        const serverMessage = body?.error || body?.message;
        return typeof serverMessage === 'string' ? serverMessage : JSON.stringify(body);
      } catch {
      }
    }

    return null;
  };

  const createAdminUser = async (data: { username: string; fullName: string; role: AdminRole; password: string; permissions?: AdminPermission[] }) => {
    ensurePermission('adminUsers.manage');
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');

    const username = normalizeUsername(data.username);
    if (!username) throw new Error('اسم المستخدم مطلوب.');
    const fullName = data.fullName.trim();
    if (!fullName) throw new Error('الاسم الكامل مطلوب.');
    const passwordError = validatePasswordStrength(data.password);
    if (passwordError) throw new Error(passwordError);

    const email = makeServiceEmail(username);

    // Ensure session is valid and fresh before invoking the function
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        throw new Error('انتهت الجلسة. يرجى إعادة تسجيل الدخول.');
      }
    }

    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const { error } = await supabase.functions.invoke('create-admin-user', {
      body: {
        email: email.toLowerCase(),
        password: data.password,
        fullName: fullName,
        username: username,
        phoneNumber: null,
        role: data.role,
        permissions: data.permissions || [],
      },
      headers: {
        Authorization: `Bearer ${anonKey}`, // Use Anon Key to pass Gateway check
        'x-user-token': sessionData.session?.access_token ?? '' // Pass actual user token for internal verification
      }
    });

    if (error) {
      const serverMessage = await extractFunctionErrorMessage(error);
      const resolved = serverMessage || (typeof (error as any)?.message === 'string' ? (error as any).message : '');
      throw new Error(localizeAdminInvokeError(resolved || 'فشل إنشاء المستخدم.'));
    }
  };

  const updateAdminUser = async (
    userId: string,
    updates: Partial<Pick<AdminUser, 'username' | 'fullName' | 'email' | 'phoneNumber' | 'avatarUrl' | 'role' | 'permissions'>>
  ) => {
    if (!supabase) throw new Error('Supabase غير مهيأ.');
    const { data: existing, error: existingError } = await supabase
      .from('admin_users')
      .select('auth_user_id, role')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (existingError) throw new Error(localizeSupabaseError(existingError));
    if (!existing) throw new Error('المستخدم غير موجود.');
    if (existing.role === 'owner') throw new Error('لا يمكن تعديل بيانات المالك من هنا.');
    if (updates.role === 'owner') throw new Error('لا يمكن ترقية المستخدم إلى مالك.');

    const nextUsername = typeof updates.username === 'string' ? normalizeUsername(updates.username) : undefined;
    if (typeof updates.username === 'string' && !nextUsername) throw new Error('اسم المستخدم مطلوب.');

    const payload: Record<string, any> = {};
    if (nextUsername) payload.username = nextUsername;
    if (typeof updates.fullName === 'string') payload.full_name = updates.fullName.trim();
    if (typeof updates.email === 'string') payload.email = updates.email.trim();
    if (typeof updates.phoneNumber === 'string') payload.phone_number = updates.phoneNumber.trim();
    if (typeof updates.avatarUrl === 'string') payload.avatar_url = updates.avatarUrl.trim();
    if (typeof updates.role === 'string') payload.role = updates.role;
    if (Array.isArray(updates.permissions)) payload.permissions = updates.permissions.filter(p => allPermissionsSet.has(p));

    const { error } = await supabase.from('admin_users').update(payload).eq('auth_user_id', userId);
    if (error) throw new Error(localizeSupabaseError(error));

    if (user?.id === userId) {
      const { data: me } = await supabase.auth.getUser();
      const refreshed = await loadRemoteProfile({ id: userId, email: me.user?.email });
      if (refreshed) setUser(refreshed);
    }
  };

  const setAdminUserActive = async (userId: string, isActive: boolean) => {
    if (!supabase) throw new Error('Supabase غير مهيأ.');
    const { data: existing, error: existingError } = await supabase
      .from('admin_users')
      .select('auth_user_id, role')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (existingError) throw new Error(localizeSupabaseError(existingError));
    if (!existing) throw new Error('المستخدم غير موجود.');
    if (existing.role === 'owner') throw new Error('لا يمكن إيقاف حساب المالك.');

    const { error } = await supabase.from('admin_users').update({ is_active: isActive }).eq('auth_user_id', userId);
    if (error) throw new Error(localizeSupabaseError(error));

    if (user?.id === userId && !isActive) {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
      }
      setIsAuthenticated(false);
      setUser(null);
    }
  };

  const resetAdminUserPassword = async (userId: string, newPassword: string) => {
    ensurePermission('adminUsers.manage');
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        throw new Error('انتهت الجلسة. يرجى إعادة تسجيل الدخول.');
      }
    }
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const { error } = await supabase.functions.invoke('reset-admin-password', {
      body: { userId, newPassword },
      headers: {
        Authorization: `Bearer ${anonKey}`,
        'x-user-token': sessionData.session?.access_token ?? ''
      }
    });

    if (error) {
      const serverMessage = await extractFunctionErrorMessage(error);
      const resolved = serverMessage || (typeof (error as any)?.message === 'string' ? (error as any).message : '');
      throw new Error(localizeAdminInvokeError(resolved || 'فشل تغيير كلمة المرور.'));
    }
  };

  const deleteAdminUser = async (userId: string) => {
    ensurePermission('adminUsers.manage');
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase غير مهيأ.');

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        throw new Error('انتهت الجلسة. يرجى إعادة تسجيل الدخول.');
      }
    }
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const { error } = await supabase.functions.invoke('delete-admin-user', {
      body: { userId },
      headers: {
        Authorization: `Bearer ${anonKey}`,
        'x-user-token': sessionData.session?.access_token ?? ''
      }
    });

    if (error) {
      const serverMessage = await extractFunctionErrorMessage(error);
      const resolved = serverMessage || (typeof (error as any)?.message === 'string' ? (error as any).message : '');
      throw new Error(localizeAdminInvokeError(resolved || 'فشل أرشفة المستخدم.'));
    }

    // Optimistically remove from state if the user was in the list, though the list usually re-fetches.
    if (user?.id === userId) {
      try {
        await supabase.auth.signOut();
      } catch { }
      setIsAuthenticated(false);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        authProvider,
        isAuthenticated,
        userId: user?.id || null,
        user,
        isConfigured,
        loading,
        login,
        setupAdmin,
        logout,
        updateProfile,
        changePassword,
        listAdminUsers,
        createAdminUser,
        updateAdminUser,
        setAdminUserActive,
        resetAdminUserPassword,
        deleteAdminUser,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    return {
      authProvider: 'supabase',
      isAuthenticated: false,
      userId: null,
      user: null,
      isConfigured: false,
      loading: false,
      login: async () => false,
      setupAdmin: async () => undefined,
      logout: async () => undefined,
      updateProfile: async () => undefined,
      changePassword: async () => undefined,
      listAdminUsers: async () => [],
      createAdminUser: async () => undefined,
      updateAdminUser: async () => undefined,
      setAdminUserActive: async () => undefined,
      resetAdminUserPassword: async () => undefined,
      deleteAdminUser: async () => undefined,
      hasPermission: () => false,
    };
  }
  return context;
};
