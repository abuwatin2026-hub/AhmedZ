import type React from 'react';
import { createContext, useContext, useState, ReactNode, useEffect, useCallback, useRef } from 'react';
import type { Customer } from '../types';
import { useToast } from './ToastContext';
import { useSettings } from './SettingsContext';
import { validatePasswordStrength } from '../utils/passwordUtils';
import { usernameSchema, validateData } from '../utils/validationSchemas';
import { createLogger } from '../utils/logger';
import { SUPABASE_AUTH_ERROR_EVENT, getSupabaseClient } from '../supabase';
import { localizeSupabaseError } from '../utils/errorUtils';

interface UserAuthContextType {
  currentUser: Customer | null;
  customers: Customer[];
  isAuthenticated: boolean;
  loading: boolean;
  registerWithPassword: (data: {
    identifier: string;
    phoneNumber?: string;
    password: string;
    referralCode?: string;
  }) => Promise<{ success: boolean; message?: string }>;
  loginWithPassword: (identifier: string, password: string, options?: { forcePasskey?: boolean }) => Promise<{ success: boolean; message?: string }>;
  loginWithGoogle: () => Promise<{ success: boolean; }>;
  logout: () => Promise<void>;
  addLoyaltyPoints: (customerId: string, points: number) => Promise<void>;
  redeemLoyaltyPoints: (points: number) => Promise<void>;
  updateCustomer: (updatedCustomer: Customer) => Promise<void>;
  fetchCustomers: () => Promise<void>;
  updateCustomerStatsAndTier: (userId: string, orderTotal: number) => Promise<void>;
  deleteCustomer: (userId: string) => Promise<boolean>;
}

const UserAuthContext = createContext<UserAuthContextType | undefined>(undefined);

const logger = createLogger('UserAuthContext');

const generateReferralCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const normalizeLoginIdentifier = (raw: string) => raw.trim().replace(/\s+/g, ' ');

const normalizeUsername = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, '');

const sha256Base64Url = async (value: string) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let binary = '';
  bytes.forEach(b => {
    binary += String.fromCharCode(b);
  });
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const toAuthEmailFromUsername = async (username: string) => {
  const normalized = normalizeUsername(username);
  const hash = await sha256Base64Url(normalized);
  return `u_${hash}@aztapp.com`;
};

const normalizeYemenPhoneToE164 = (raw: string): string | null => {
  const trimmed = normalizeLoginIdentifier(raw);
  const digitsOnly = trimmed.replace(/[^\d+]/g, '');
  if (!digitsOnly) return null;

  if (digitsOnly.startsWith('+')) {
    const cleaned = `+${digitsOnly.slice(1).replace(/\D/g, '')}`;
    if (/^\+\d{8,15}$/.test(cleaned)) return cleaned;
    return null;
  }

  const justDigits = digitsOnly.replace(/\D/g, '');
  if (/^\d{8,15}$/.test(justDigits) === false) return null;

  if (justDigits.startsWith('967')) {
    const normalized = `+${justDigits}`;
    if (/^\+\d{8,15}$/.test(normalized)) return normalized;
    return null;
  }

  if (/^7\d{8}$/.test(justDigits)) {
    return `+967${justDigits}`;
  }

  return null;
};

const maskUsernameForDisplay = (username: string) => {
  const normalized = normalizeUsername(username);
  if (normalized.length <= 3) return normalized;
  return `${normalized.slice(0, 2)}***${normalized.slice(-1)}`;
};

const toCustomerFromRow = (row: any): Customer => {
  const now = new Date().toISOString();
  const data = (row?.data && typeof row.data === 'object') ? row.data : {};
  const id = String(row?.auth_user_id || (data as any).id || '');
  return {
    id,
    phoneNumber: typeof row?.phone_number === 'string' ? row.phone_number : (typeof (data as any).phoneNumber === 'string' ? (data as any).phoneNumber : undefined),
    email: typeof row?.email === 'string' ? row.email : (typeof (data as any).email === 'string' ? (data as any).email : undefined),
    fullName: typeof row?.full_name === 'string' ? row.full_name : (typeof (data as any).fullName === 'string' ? (data as any).fullName : undefined),
    avatarUrl: typeof row?.avatar_url === 'string' ? row.avatar_url : (typeof (data as any).avatarUrl === 'string' ? (data as any).avatarUrl : undefined),
    preferredCurrency: typeof row?.preferred_currency === 'string' ? row.preferred_currency : (typeof (data as any).preferredCurrency === 'string' ? (data as any).preferredCurrency : undefined),
    customerType: typeof row?.customer_type === 'string' ? row.customer_type : (typeof (data as any).customerType === 'string' ? (data as any).customerType : undefined),
    paymentTerms: typeof row?.payment_terms === 'string' ? row.payment_terms : (typeof (data as any).paymentTerms === 'string' ? (data as any).paymentTerms : undefined),
    creditLimit: Number.isFinite(Number(row?.credit_limit)) ? Number(row.credit_limit) : (Number.isFinite(Number((data as any).creditLimit)) ? Number((data as any).creditLimit) : undefined),
    currentBalance: Number.isFinite(Number(row?.current_balance)) ? Number(row.current_balance) : (Number.isFinite(Number((data as any).currentBalance)) ? Number((data as any).currentBalance) : undefined),
    authProvider: (typeof row?.auth_provider === 'string' ? row.auth_provider : (data as any).authProvider) === 'google'
      ? 'google'
      : ((typeof row?.auth_provider === 'string' ? row.auth_provider : (data as any).authProvider) === 'phone' ? 'phone' : 'password'),
    passwordSalt: typeof row?.password_salt === 'string' ? row.password_salt : (typeof (data as any).passwordSalt === 'string' ? (data as any).passwordSalt : undefined),
    passwordHash: typeof row?.password_hash === 'string' ? row.password_hash : (typeof (data as any).passwordHash === 'string' ? (data as any).passwordHash : undefined),
    loginIdentifier: typeof (data as any).loginIdentifier === 'string' ? (data as any).loginIdentifier : undefined,
    requirePasskey: Boolean((data as any).requirePasskey ?? false),
    loyaltyPoints: Number.isFinite(Number(row?.loyalty_points)) ? Number(row.loyalty_points) : (Number.isFinite(Number((data as any).loyaltyPoints)) ? Number((data as any).loyaltyPoints) : 0),
    loyaltyTier: (row?.loyalty_tier === 'bronze' || row?.loyalty_tier === 'silver' || row?.loyalty_tier === 'gold' || row?.loyalty_tier === 'regular')
      ? row.loyalty_tier
      : ((data as any).loyaltyTier === 'bronze' || (data as any).loyaltyTier === 'silver' || (data as any).loyaltyTier === 'gold' || (data as any).loyaltyTier === 'regular')
        ? (data as any).loyaltyTier
        : 'regular',
    totalSpent: Number.isFinite(Number(row?.total_spent)) ? Number(row.total_spent) : (Number.isFinite(Number((data as any).totalSpent)) ? Number((data as any).totalSpent) : 0),
    referralCode: typeof row?.referral_code === 'string' ? row.referral_code : (typeof (data as any).referralCode === 'string' ? (data as any).referralCode : undefined),
    referredBy: typeof row?.referred_by === 'string' ? row.referred_by : (typeof (data as any).referredBy === 'string' ? (data as any).referredBy : undefined),
    firstOrderDiscountApplied: typeof row?.first_order_discount_applied === 'boolean'
      ? row.first_order_discount_applied
      : Boolean((data as any).firstOrderDiscountApplied ?? false),
    savedAddresses: Array.isArray((data as any).savedAddresses) ? (data as any).savedAddresses : undefined,
    ...(typeof (data as any).createdAt === 'string' ? { createdAt: (data as any).createdAt } : { createdAt: now }),
    ...(typeof (data as any).updatedAt === 'string' ? { updatedAt: (data as any).updatedAt } : { updatedAt: now }),
  } as Customer;
};

export const UserAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<Customer | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const { showNotification } = useToast();
  const { settings } = useSettings();
  const authIssueHandledAtRef = useRef<number>(0);

  const hydrateCurrentUser = useCallback(async (authUserId: string | null): Promise<Customer | null> => {
    if (!authUserId) {
      setCurrentUser(null);
      return null;
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      setCurrentUser(null);
      return null;
    }
    try {
      const { data: adminRow } = await supabase
        .from('admin_users')
        .select('auth_user_id,is_active')
        .eq('auth_user_id', authUserId)
        .maybeSingle();
      if (adminRow && Boolean((adminRow as any).is_active ?? true)) {
        setCurrentUser(null);
        return null;
      }

      const { data: row, error } = await supabase
        .from('customers')
        .select('auth_user_id, full_name, phone_number, email, auth_provider, password_salt, password_hash, referral_code, referred_by, loyalty_points, loyalty_tier, total_spent, first_order_discount_applied, avatar_url, preferred_currency, data')
        .eq('auth_user_id', authUserId)
        .maybeSingle();
      if (error) throw error;
      if (row) {
        const remoteUser = toCustomerFromRow(row);
        setCurrentUser(remoteUser);
        return remoteUser;
      }
      let authEmail: string | undefined;
      try {
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userData.user) {
          try { await supabase.auth.signOut({ scope: 'local' }); } catch {}
          setCurrentUser(null);
          return null;
        }
        authEmail = typeof userData.user?.email === 'string' ? userData.user?.email : undefined;
      } catch {
        try { await supabase.auth.signOut({ scope: 'local' }); } catch {}
        setCurrentUser(null);
        return null;
      }
      let attempts = 0;
      while (attempts < 5) {
        attempts += 1;
        const fallback: Customer = {
          id: authUserId,
          fullName: undefined,
          phoneNumber: undefined,
          email: authEmail,
          authProvider: 'password',
          passwordSalt: '',
          passwordHash: '',
          requirePasskey: false,
          loyaltyPoints: 0,
          loyaltyTier: 'regular',
          totalSpent: 0,
          referralCode: generateReferralCode(),
          referredBy: undefined,
          firstOrderDiscountApplied: false,
          avatarUrl: undefined,
          loginIdentifier: undefined,
        };
        const { error: insertError } = await supabase.from('customers').insert({
          auth_user_id: fallback.id,
          full_name: fallback.fullName ?? null,
          phone_number: typeof fallback.phoneNumber === 'string' ? fallback.phoneNumber : null,
          email: fallback.email ?? null,
          auth_provider: fallback.authProvider,
          password_salt: null,
          password_hash: null,
          referral_code: fallback.referralCode ?? null,
          referred_by: fallback.referredBy ?? null,
          loyalty_points: fallback.loyaltyPoints ?? 0,
          loyalty_tier: fallback.loyaltyTier ?? 'regular',
          total_spent: fallback.totalSpent ?? 0,
          first_order_discount_applied: Boolean(fallback.firstOrderDiscountApplied ?? false),
          avatar_url: fallback.avatarUrl ?? null,
          data: fallback,
        });
        if (!insertError) {
          setCurrentUser(fallback);
          return fallback;
        }
        if (String((insertError as any).code) === '23505') {
          const details = `${String((insertError as any).details || '')} ${String((insertError as any).message || '')}`.toLowerCase();
          if (details.includes('referral') || details.includes('referral_code')) continue;
        }
        throw insertError;
      }
      setCurrentUser(null);
      return null;
    } catch (error) {
      setCurrentUser(null);
      if (import.meta.env.DEV) {
        logger.error('Failed to hydrate user', new Error(localizeSupabaseError(error)));
      }
      return null;
    }
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setCustomers([]);
        return;
      }
      const { data: rows, error } = await supabase.rpc('list_customers_directory', { p_limit: 1000 } as any);
      if (error) throw error;
      const normalizedRows = (Array.isArray(rows) ? rows : []).map((r: any) => ({ ...r, auth_user_id: r?.id }));
      const list = normalizedRows.map(toCustomerFromRow).filter(Boolean);
      setCustomers(list as Customer[]);
    } catch (error) {
      setCustomers([]);
      if (import.meta.env.DEV) {
        logger.error("Error fetching customers from local DB:", new Error(localizeSupabaseError(error)));
      }
    }
  }, []);

  useEffect(() => {
    const checkSession = async () => {
      setLoading(true);
      try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          setCurrentUser(null);
          return;
        }
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        await hydrateCurrentUser(data.session?.user?.id ?? null);
      } catch (error) {
        if (import.meta.env.DEV) {
          logger.error("Error checking session:", new Error(localizeSupabaseError(error)));
        }
      } finally {
        setLoading(false);
      }
    };
    checkSession();
    fetchCustomers();
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void hydrateCurrentUser(session?.user?.id ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [fetchCustomers, hydrateCurrentUser]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (typeof window === 'undefined') return;
    const handler = async () => {
      const now = Date.now();
      if (now - authIssueHandledAtRef.current < 3000) return;
      authIssueHandledAtRef.current = now;
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
      }
      setCurrentUser(null);
    };
    window.addEventListener(SUPABASE_AUTH_ERROR_EVENT, handler as any);
    return () => {
      window.removeEventListener(SUPABASE_AUTH_ERROR_EVENT, handler as any);
    };
  }, []);

  const localizeAuthProviderError = (message?: string, context?: 'register' | 'login') => {
    if (!message) return context === 'register' ? 'فشل التسجيل' : 'حدث خطأ ما';
    const normalized = message.toLowerCase();
    if (normalized.includes('user already registered') || normalized.includes('already registered')) {
      return context === 'register' ? 'اسم المستخدم مستخدم بالفعل' : 'المستخدم مسجل بالفعل';
    }
    if (normalized.includes('invalid login credentials')) return 'بيانات الدخول غير صحيحة';
    if (normalized.includes('email not confirmed')) return 'البريد الإلكتروني غير مؤكد';
    if (normalized.includes('signups not allowed') || normalized.includes('signup is disabled') || normalized.includes('email signups are disabled')) return 'التسجيل معطل حالياً';
    if (normalized.includes('email address') && normalized.includes('invalid')) return 'فشل التسجيل';
    return context === 'register' ? 'فشل التسجيل' : 'حدث خطأ ما';
  };

  const withArabicCodeSuffix = (baseMessage: string, error: any) => {
    const code = String(error?.code || error?.status || '').trim();
    if (!code) return baseMessage;
    return `${baseMessage} (رمز: ${code})`;
  };

  const localizeDatabaseError = (error: any) => {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    const details = String(error?.details || '');
    const normalized = `${message} ${details}`.toLowerCase();
    if (code === '42P01' || normalized.includes('does not exist') || normalized.includes('relation')) return 'قاعدة البيانات غير جاهزة';
    if (code === '42501' || normalized.includes('row-level security') || normalized.includes('rls') || normalized.includes('permission') || normalized.includes('not allowed')) return 'ليس لديك صلاحية للوصول لقاعدة البيانات';
    return 'حدث خطأ ما';
  };

  const deleteCustomer = async (userId: string): Promise<boolean> => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        showNotification('Supabase غير مهيأ.', 'error');
        return false;
      }

      // Try to delete via RPC (Complete deletion: Auth + Profile)
      const { error: rpcError } = await supabase.rpc('delete_user_account', { target_user_id: userId });

      if (rpcError) {
        // Fallback: If RPC fails (e.g. not authorized or missing), try deleting from public table
        // This is a partial delete (profile only), but better than nothing while we debug.
        // Ideally RPC should work.
        console.warn('RPC delete_user_account failed, falling back to table delete:', rpcError);
        const { error: tableError } = await supabase.from('customers').delete().eq('auth_user_id', userId);

        if (tableError) {
          showNotification(withArabicCodeSuffix('فشل حذف العميل', tableError), 'error');
          return false;
        }
      }

      setCustomers(prev => prev.filter(c => c.id !== userId));
      if (currentUser?.id === userId) {
        setCurrentUser(null);
      }
      return true;
    } catch (err: any) {
      showNotification(withArabicCodeSuffix('فشل حذف العميل', err), 'error');
      return false;
    }
  };

  const registerWithPassword = async (data: {
    identifier: string;
    phoneNumber?: string;
    password: string;
    referralCode?: string;
  }): Promise<{ success: boolean; message?: string }> => {
    try {
      const usernameValidation = validateData(usernameSchema, data.identifier || '');
      if (!usernameValidation.success) {
        return { success: false, message: usernameValidation.error };
      }
      const username = normalizeUsername(usernameValidation.data);

      const passwordError = validatePasswordStrength(data.password);
      if (passwordError) {
        return { success: false, message: passwordError };
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        return { success: false, message: 'لم يتم تكوين قاعدة البيانات' };
      }

      const isTakenLocally = customers.some(c => normalizeUsername(c.loginIdentifier || '') === username);
      if (isTakenLocally) {
        return { success: false, message: 'اسم المستخدم هذا مستخدم بالفعل' };
      }

      // Use direct registration RPC (bypasses Supabase email rate limits)
      const { data: result, error: rpcError } = await supabase.rpc('register_customer_direct', {
        p_username: username,
        p_password: data.password,
        p_phone: (data.phoneNumber || '').trim() || null,
        p_referral_code: (data.referralCode || '').trim() || null,
      } as any);

      if (rpcError) {
        const msg = String(rpcError.message || '');
        if (msg.includes('user_already_registered')) {
          return { success: false, message: 'اسم المستخدم هذا مستخدم بالفعل' };
        }
        if (msg.includes('username_too_short')) {
          return { success: false, message: 'اسم المستخدم قصير جداً (3 أحرف على الأقل)' };
        }
        if (msg.includes('username_too_long')) {
          return { success: false, message: 'اسم المستخدم طويل جداً (30 حرف كحد أقصى)' };
        }
        return { success: false, message: withArabicCodeSuffix('فشل إنشاء الحساب', rpcError) };
      }

      const rpcResult = (typeof result === 'string' ? JSON.parse(result) : result) as any;
      if (!rpcResult?.success || !rpcResult?.email) {
        return { success: false, message: 'فشل إنشاء الحساب' };
      }

      // Sign in immediately with the created account
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: rpcResult.email,
        password: data.password,
      });
      if (signInError) {
        logger.warn('Post-registration sign-in failed', { error: signInError.message });
        return { success: false, message: 'تم إنشاء الحساب بنجاح — سجل الدخول يدوياً' };
      }

      await hydrateCurrentUser(rpcResult.user_id);
      await fetchCustomers();
      logger.info('User registered successfully (direct)', { userId: rpcResult.user_id });
      return { success: true };
    } catch (error) {
      logger.error('Registration error', error as Error);
      return { success: false, message: withArabicCodeSuffix('فشل إنشاء الحساب', error) };
    }
  };

  const loginWithPassword = async (identifier: string, password: string, options?: { forcePasskey?: boolean }): Promise<{ success: boolean; message?: string }> => {
    try {
      const username = normalizeUsername(identifier || '');
      if (!username) {
        return { success: false, message: 'الرجاء إدخال اسم المستخدم' };
      }

      if (!password) {
        return { success: false, message: 'الرجاء إدخال كلمة المرور' };
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        return { success: false, message: 'لم يتم تكوين قاعدة البيانات' };
      }

      const email = await toAuthEmailFromUsername(username);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        logger.warn('Login failed', { identifier: username, error: error.message });
        const base = withArabicCodeSuffix(localizeAuthProviderError(error.message, 'login'), error);
        return { success: false, message: `${base} (${maskUsernameForDisplay(username)})` };
      }
      const authUserId = data.user?.id ?? null;
      const hydratedUser = await hydrateCurrentUser(authUserId);
      const shouldUsePasskey = Boolean(hydratedUser?.requirePasskey || options?.forcePasskey);
      if (shouldUsePasskey) {
        const mfa = (supabase.auth as any)?.mfa;
        const supportsWebauthn = typeof window !== 'undefined' && !!window.PublicKeyCredential;
        if (!mfa?.webauthn?.authenticate || !supportsWebauthn) {
          try {
            const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
            const { data: sessionData } = await supabase.auth.getSession();
            if (isOnline && sessionData.session) {
              await supabase.auth.signOut({ scope: 'local' });
            }
          } catch {
          }
          return {
            success: false,
            message: 'هذا الجهاز لا يدعم Passkeys/البصمة لإكمال تسجيل الدخول.',
          };
        }

        const { data: factorsData, error: factorsError } = await mfa.listFactors();
        if (factorsError) {
          try {
            const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
            const { data: sessionData } = await supabase.auth.getSession();
            if (isOnline && sessionData.session) {
              await supabase.auth.signOut({ scope: 'local' });
            }
          } catch {
          }
          return {
            success: false,
            message: 'تعذر تحميل عوامل المصادقة لإكمال تسجيل الدخول.',
          };
        }

        const allFactors = Array.isArray((factorsData as any)?.all) ? (factorsData as any).all : [];
        const webauthnFactor = allFactors.find((f: any) => f?.factor_type === 'webauthn' && f?.status === 'verified');
        if (!webauthnFactor?.id) {
          try {
            const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
            const { data: sessionData } = await supabase.auth.getSession();
            if (isOnline && sessionData.session) {
              await supabase.auth.signOut({ scope: 'local' });
            }
          } catch {
          }
          return {
            success: false,
            message: 'لم يتم إعداد Passkey لهذا الحساب.',
          };
        }

        const { error: webauthnError } = await mfa.webauthn.authenticate({ factorId: webauthnFactor.id });
        if (webauthnError) {
          try {
            const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
            const { data: sessionData } = await supabase.auth.getSession();
            if (isOnline && sessionData.session) {
              await supabase.auth.signOut({ scope: 'local' });
            }
          } catch {
          }
          return {
            success: false,
            message: 'فشل تأكيد Passkey. تحقق من البصمة/قفل الشاشة وحاول مرة أخرى.',
          };
        }
      }
      logger.info('User logged in successfully', { userId: authUserId });
      return { success: true };
    } catch (error) {
      logger.error('Login error', error as Error);
      return { success: false, message: withArabicCodeSuffix('فشل تسجيل الدخول', error) };
    }
  };

  const loginWithGoogle = async (): Promise<{ success: boolean; }> => {
    showNotification('تسجيل الدخول عبر جوجل غير مفعّل في بيئة الإنتاج.', 'error');
    return { success: false };
  };

  const logout = async () => {
    const supabase = getSupabaseClient();
    if (supabase) {
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
      } catch (error) {
        logger.warn('Logout failed', { error: (error as any)?.message || String(error) });
      }
    }
    setCurrentUser(null);
  };

  const addLoyaltyPoints = useCallback(async (customerId: string, points: number) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let customer: Customer | undefined;
    try {
      const { data: row, error } = await supabase
        .from('customers')
        .select('auth_user_id, full_name, phone_number, email, auth_provider, password_salt, password_hash, referral_code, referred_by, loyalty_points, loyalty_tier, total_spent, first_order_discount_applied, avatar_url, data')
        .eq('auth_user_id', customerId)
        .maybeSingle();
      if (error) throw error;
      customer = row ? toCustomerFromRow(row) : undefined;
    } catch (error) {
      showNotification(localizeSupabaseError(error), 'error');
      return;
    }
    if (!customer) return;

    const newPoints = (customer.loyaltyPoints || 0) + points;
    const updatedCustomer = { ...customer, loyaltyPoints: newPoints };
    try {
      const { error } = await supabase.from('customers').upsert({
        auth_user_id: updatedCustomer.id,
        full_name: updatedCustomer.fullName ?? null,
        phone_number: typeof updatedCustomer.phoneNumber === 'string' ? updatedCustomer.phoneNumber : null,
        email: updatedCustomer.email ?? null,
        auth_provider: updatedCustomer.authProvider,
        password_salt: updatedCustomer.passwordSalt ?? null,
        password_hash: updatedCustomer.passwordHash ?? null,
        referral_code: updatedCustomer.referralCode ?? null,
        referred_by: updatedCustomer.referredBy ?? null,
        loyalty_points: updatedCustomer.loyaltyPoints ?? 0,
        loyalty_tier: updatedCustomer.loyaltyTier ?? 'regular',
        total_spent: updatedCustomer.totalSpent ?? 0,
        first_order_discount_applied: Boolean(updatedCustomer.firstOrderDiscountApplied ?? false),
        avatar_url: updatedCustomer.avatarUrl ?? null,
        data: updatedCustomer,
      }, { onConflict: 'auth_user_id' });
      if (error) throw error;
    } catch (error) {
      showNotification(localizeSupabaseError(error), 'error');
      return;
    }
    if (currentUser?.id === customerId) {
      setCurrentUser(prev => prev ? { ...prev, loyaltyPoints: newPoints } : null);
    }
    await fetchCustomers();
  }, [currentUser, fetchCustomers]);

  const redeemLoyaltyPoints = useCallback(async (points: number) => {
    if (currentUser && currentUser.loyaltyPoints >= points) {
      const newPoints = currentUser.loyaltyPoints - points;
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const updatedCustomer = { ...currentUser, loyaltyPoints: newPoints };
      try {
        const { error } = await supabase.from('customers').upsert({
          auth_user_id: updatedCustomer.id,
          full_name: updatedCustomer.fullName ?? null,
          phone_number: typeof updatedCustomer.phoneNumber === 'string' ? updatedCustomer.phoneNumber : null,
          email: updatedCustomer.email ?? null,
          auth_provider: updatedCustomer.authProvider,
          password_salt: updatedCustomer.passwordSalt ?? null,
          password_hash: updatedCustomer.passwordHash ?? null,
          referral_code: updatedCustomer.referralCode ?? null,
          referred_by: updatedCustomer.referredBy ?? null,
          loyalty_points: updatedCustomer.loyaltyPoints ?? 0,
          loyalty_tier: updatedCustomer.loyaltyTier ?? 'regular',
          total_spent: updatedCustomer.totalSpent ?? 0,
          first_order_discount_applied: Boolean(updatedCustomer.firstOrderDiscountApplied ?? false),
          avatar_url: updatedCustomer.avatarUrl ?? null,
          data: updatedCustomer,
        }, { onConflict: 'auth_user_id' });
        if (error) throw error;
      } catch (error) {
        showNotification(localizeSupabaseError(error), 'error');
        return;
      }
      setCurrentUser(prev => prev ? { ...prev, loyaltyPoints: newPoints } : null);
      await fetchCustomers();
    }
  }, [currentUser, fetchCustomers]);

  const updateCustomer = async (updatedCustomer: Customer) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      const { error } = await supabase.from('customers').upsert({
        auth_user_id: updatedCustomer.id,
        full_name: updatedCustomer.fullName ?? null,
        phone_number: typeof updatedCustomer.phoneNumber === 'string' ? updatedCustomer.phoneNumber : null,
        email: updatedCustomer.email ?? null,
        auth_provider: updatedCustomer.authProvider,
        password_salt: updatedCustomer.passwordSalt ?? null,
        password_hash: updatedCustomer.passwordHash ?? null,
        referral_code: updatedCustomer.referralCode ?? null,
        referred_by: updatedCustomer.referredBy ?? null,
        loyalty_points: updatedCustomer.loyaltyPoints ?? 0,
        loyalty_tier: updatedCustomer.loyaltyTier ?? 'regular',
        total_spent: updatedCustomer.totalSpent ?? 0,
        first_order_discount_applied: Boolean(updatedCustomer.firstOrderDiscountApplied ?? false),
        avatar_url: updatedCustomer.avatarUrl ?? null,
        data: updatedCustomer,
      }, { onConflict: 'auth_user_id' });
      if (error) throw error;
    } catch (error) {
      showNotification(localizeSupabaseError(error), 'error');
      return;
    }
    if (currentUser?.id === updatedCustomer.id) {
      setCurrentUser(updatedCustomer);
    }
    await fetchCustomers();
  };

  const updateCustomerStatsAndTier = async (userId: string, orderTotal: number) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let customer: Customer | undefined;
    try {
      const { data: row, error } = await supabase
        .from('customers')
        .select('auth_user_id, full_name, phone_number, email, auth_provider, password_salt, password_hash, referral_code, referred_by, loyalty_points, loyalty_tier, total_spent, first_order_discount_applied, avatar_url, data')
        .eq('auth_user_id', userId)
        .maybeSingle();
      if (error) throw error;
      customer = row ? toCustomerFromRow(row) : undefined;
    } catch (error) {
      showNotification(localizeSupabaseError(error), 'error');
      return;
    }
    if (!customer) return;

    const newTotalSpent = (customer.totalSpent || 0) + orderTotal;
    let newTier = customer.loyaltyTier;

    const { gold, silver, bronze } = settings.loyaltySettings.tiers;

    if (newTotalSpent >= gold.threshold && customer.loyaltyTier !== 'gold') {
      newTier = 'gold';
    } else if (newTotalSpent >= silver.threshold && (customer.loyaltyTier === 'bronze' || customer.loyaltyTier === 'regular')) {
      newTier = 'silver';
    } else if (newTotalSpent >= bronze.threshold && customer.loyaltyTier === 'regular') {
      newTier = 'bronze';
    }

    const didUpgrade = newTier !== customer.loyaltyTier;

    const updatedCustomer = { ...customer, totalSpent: newTotalSpent, loyaltyTier: newTier };
    try {
      const { error } = await supabase.from('customers').upsert({
        auth_user_id: updatedCustomer.id,
        full_name: updatedCustomer.fullName ?? null,
        phone_number: typeof updatedCustomer.phoneNumber === 'string' ? updatedCustomer.phoneNumber : null,
        email: updatedCustomer.email ?? null,
        auth_provider: updatedCustomer.authProvider,
        password_salt: updatedCustomer.passwordSalt ?? null,
        password_hash: updatedCustomer.passwordHash ?? null,
        referral_code: updatedCustomer.referralCode ?? null,
        referred_by: updatedCustomer.referredBy ?? null,
        loyalty_points: updatedCustomer.loyaltyPoints ?? 0,
        loyalty_tier: updatedCustomer.loyaltyTier ?? 'regular',
        total_spent: updatedCustomer.totalSpent ?? 0,
        first_order_discount_applied: Boolean(updatedCustomer.firstOrderDiscountApplied ?? false),
        avatar_url: updatedCustomer.avatarUrl ?? null,
        data: updatedCustomer,
      }, { onConflict: 'auth_user_id' });
      if (error) throw error;
    } catch (error) {
      showNotification(localizeSupabaseError(error), 'error');
      return;
    }

    // Update current user state immediately for responsiveness
    if (currentUser?.id === userId) {
      setCurrentUser(prev => prev ? { ...prev, totalSpent: newTotalSpent, loyaltyTier: newTier } : null);
    }

    await fetchCustomers();

    if (didUpgrade) {
      const tierName = settings.loyaltySettings.tiers[newTier].name.ar;
      showNotification(`🎉 ترقية! لقد وصلت إلى المستوى ${tierName}!`, 'success', 5000);
    }
  };

  return (
    <UserAuthContext.Provider value={{
      currentUser,
      customers,
      isAuthenticated: Boolean(currentUser),
      loading,
      registerWithPassword,
      loginWithPassword,
      loginWithGoogle,
      logout,
      addLoyaltyPoints,
      redeemLoyaltyPoints,
      updateCustomer,
      fetchCustomers,
      updateCustomerStatsAndTier,
      deleteCustomer,
    }}>
      {children}
    </UserAuthContext.Provider>
  );
};

export const useUserAuth = () => {
  const context = useContext(UserAuthContext);
  if (context === undefined) {
    throw new Error('useUserAuth must be used within a UserAuthProvider');
  }
  return context;
};
