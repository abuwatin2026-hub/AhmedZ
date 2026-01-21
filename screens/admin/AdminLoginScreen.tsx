import type React from 'react';
import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import TextInput from '../../components/TextInput';
import PasswordInput from '../../components/PasswordInput';
import { InfoIcon, UserIcon } from '../../components/icons';
import PageLoader from '../../components/PageLoader';
import { adminLoginLimiter } from '../../utils/rateLimiter';
import { getCSRFToken } from '../../utils/csrfProtection';

const AdminLoginScreen: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, isAuthenticated, isConfigured, setupAdmin, loading, authProvider } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isSupabase = authProvider === 'supabase';

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/admin/orders');
    }
  }, [isAuthenticated, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Check rate limit
    const limitCheck = adminLoginLimiter.checkLimit(username);
    if (!limitCheck.allowed) {
      setError(limitCheck.message || 'تم تجاوز الحد الأقصى للمحاولات');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      if (!isConfigured) {
        if (password !== confirmPassword) {
          setError('كلمتا المرور غير متطابقتين.');
          return;
        }
        // Get CSRF token for setup
        getCSRFToken();
        await setupAdmin(username, password);
        adminLoginLimiter.reset(username); // Reset on successful setup
        const from = (location.state as any)?.from?.pathname || '/admin/orders';
        navigate(from, { replace: true });
        return;
      }

      // Get CSRF token for login
      getCSRFToken();
      const success = await login(username, password);
      if (success) {
        adminLoginLimiter.reset(username); // Reset on successful login
        const from = (location.state as any)?.from?.pathname || '/admin/orders';
        navigate(from, { replace: true });
      } else {
        adminLoginLimiter.recordAttempt(username, false); // Record failed attempt

        // Check if now locked
        const newCheck = adminLoginLimiter.checkLimit(username);
        if (!newCheck.allowed) {
          setError(newCheck.message || 'تم قفل الحساب مؤقتاً');
        } else {
          const remaining = newCheck.remainingAttempts || 0;
          setError(
            isSupabase
              ? `البريد الإلكتروني أو كلمة المرور غير صحيحة. (${remaining} محاولات متبقية)`
              : `اسم المستخدم أو كلمة المرور غير صحيحة. (${remaining} محاولات متبقية)`
          );
        }
      }
    } catch (err) {
      adminLoginLimiter.recordAttempt(username, false);
      const raw = err instanceof Error ? err.message : '';
      setError(raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'تعذر إكمال العملية.');
    } finally {
      setIsLoading(false);
    }
  };

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="flex items-center justify-center min-h-dvh bg-gray-100 dark:bg-gray-900 flex-col">
      <div className="w-full max-w-md p-8 space-y-8 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
        <div className="text-center relative">
          <Link
            to="/help"
            state={{ from: location.pathname }}
            className="absolute top-0 left-0 rtl:right-0 rtl:left-auto text-gray-500 hover:text-orange-600 dark:text-gray-400 dark:hover:text-orange-400 p-1"
            title="مساعدة"
          >
            <InfoIcon />
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">لوحة التحكم</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">{isConfigured ? 'تسجيل الدخول إلى لوحة التحكم' : 'إعداد حساب المالك لأول مرة'}</p>
        </div>
        <form className="space-y-6" onSubmit={handleLogin}>
          <div>
            <label htmlFor={isSupabase ? 'email' : 'username'} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {isSupabase ? 'البريد الإلكتروني' : 'اسم المستخدم'}
            </label>
            <TextInput
              id={isSupabase ? 'email' : 'username'}
              name={isSupabase ? 'email' : 'username'}
              type={isSupabase ? 'email' : 'text'}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              icon={<UserIcon />}
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              كلمة المرور
            </label>
            <PasswordInput
              id="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {!isConfigured && (
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                تأكيد كلمة المرور
              </label>
              <PasswordInput
                id="confirmPassword"
                name="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
          )}

          {error && <p className="text-sm text-center text-red-500">{error}</p>}

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50"
            >
              {isLoading ? (isConfigured ? 'جاري الدخول...' : 'جاري الإعداد...') : (isConfigured ? 'تسجيل الدخول' : 'إنشاء حساب المدير')}
            </button>
          </div>
        </form>
      </div>
      <div className="mt-6 text-center">
        <Link to="/" className="text-sm font-medium text-orange-600 hover:text-orange-500 dark:text-orange-400 dark:hover:text-orange-300">
          &larr; العودة إلى الموقع
        </Link>
      </div>
    </div>
  );
};

export default AdminLoginScreen;
