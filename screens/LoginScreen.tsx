import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUserAuth } from '../contexts/UserAuthContext';
import TextInput from '../components/TextInput';
import PasswordInput from '../components/PasswordInput';
import { GoogleIcon, PhoneIcon, TagIcon, UserIcon, BackArrowIcon } from '../components/icons';
import { userLoginLimiter } from '../utils/rateLimiter';

const LoginScreen: React.FC = () => {
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [identifier, setIdentifier] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [referralCode, setReferralCode] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [loadingVariant, setLoadingVariant] = useState<'default' | 'passkey'>('default');
    const [error, setError] = useState('');
    const { registerWithPassword, loginWithPassword, loginWithGoogle, isAuthenticated } = useUserAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const isGoogleLoginEnabled = (import.meta.env.VITE_ENABLE_GOOGLE_LOGIN as string | undefined) === 'true';

    useEffect(() => {
        if (isAuthenticated) {
            const from = (location.state as any)?.from?.pathname || '/';
            navigate(from, { replace: true });
        }
    }, [isAuthenticated, navigate, location.state]);

    const runAuth = async (options?: { forcePasskey?: boolean }) => {
        if (!identifier.trim()) {
            setError('الرجاء إدخال اسم المستخدم أو البريد الإلكتروني');
            return;
        }
        if (!password) {
            setError('الرجاء إدخال كلمة المرور');
            return;
        }

        if (mode === 'login') {
            const limitCheck = userLoginLimiter.checkLimit(identifier);
            if (!limitCheck.allowed) {
                setError(limitCheck.message || 'تم تجاوز الحد الأقصى للمحاولات');
                return;
            }
        }

        setError('');
        setLoadingVariant(options?.forcePasskey ? 'passkey' : 'default');
        setIsLoading(true);

        const result =
            mode === 'register'
                ? await registerWithPassword({
                    identifier,
                    phoneNumber: phoneNumber.trim() ? phoneNumber : undefined,
                    password,
                    referralCode: referralCode.trim() ? referralCode : undefined,
                })
                : await loginWithPassword(identifier, password, options);

        setIsLoading(false);
        setLoadingVariant('default');

        if (result.success) {
            if (mode === 'login') {
                userLoginLimiter.reset(identifier);
            }
        } else {
            if (mode === 'login') {
                userLoginLimiter.recordAttempt(identifier, false);

                const newCheck = userLoginLimiter.checkLimit(identifier);
                if (!newCheck.allowed) {
                    setError(newCheck.message || 'تم قفل الحساب مؤقتاً');
                } else {
                    const remaining = newCheck.remainingAttempts || 0;
                    setError(`${result.message || 'حدث خطأ'} (${remaining} محاولات متبقية)`);
                }
            } else {
                setError(result.message || 'حدث خطأ غير متوقع');
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await runAuth();
    };

    const handlePasskeyLogin = async () => {
        await runAuth({ forcePasskey: true });
    };

    const handleGoogleLogin = async () => {
        setError('');
        setIsLoading(true);
        const result = await loginWithGoogle();
        setIsLoading(false);
        if (result.success) {
            const from = (location.state as any)?.from?.pathname || '/';
            navigate(from, { replace: true });
        } else {
            setError('فشل تسجيل الدخول باستخدام Google');
        }
    };

    const toggleMode = () => {
        setMode(prev => prev === 'login' ? 'register' : 'login');
        setError('');
        setPassword('');
        setPhoneNumber('');
        setLoadingVariant('default');
    }

    return (
        <div className="flex flex-col items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8 animate-fade-in text-center max-w-md mx-auto relative w-full">
                <button
                    onClick={() => navigate('/')}
                    aria-label={'رجوع'}
                    className="absolute top-6 left-6 rtl:left-auto rtl:right-6 text-gray-500 hover:text-gold-500 dark:text-gray-400 dark:hover:text-gold-400 transition-colors"
                >
                    <BackArrowIcon className="h-6 w-6 transform rtl:rotate-180" />
                </button>
                <h1 className="text-3xl font-bold dark:text-white">
                    {mode === 'login' ? 'مرحباً بعودتك' : 'إنشاء حساب'}
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    {mode === 'login' ? 'سجل الدخول للمتابعة' : 'أنشئ حسابك الجديد'}
                </p>

                <div className="my-8">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="identifier" className="sr-only">{'اسم المستخدم أو البريد الإلكتروني'}</label>
                            <TextInput
                                id="identifier"
                                name="identifier"
                                type="text"
                                value={identifier}
                                onChange={(e) => setIdentifier(e.target.value)}
                                placeholder={'اسم المستخدم أو البريد الإلكتروني'}
                                icon={<UserIcon />}
                                required
                            />
                        </div>
                        {mode === 'register' && (
                            <div>
                                <label htmlFor="phoneNumber" className="sr-only">{'رقم الهاتف'}</label>
                                <TextInput
                                    id="phoneNumber"
                                    name="phoneNumber"
                                    type="tel"
                                    value={phoneNumber}
                                    onChange={(e) => setPhoneNumber(e.target.value)}
                                    placeholder={'رقم الهاتف (اختياري)'}
                                    icon={<PhoneIcon />}
                                />
                            </div>
                        )}
                        {mode === 'register' && (
                            <div>
                                <label htmlFor="referralCode" className="sr-only">{'كود الإحالة'}</label>
                                <TextInput id="referralCode" name="referralCode" type="text" value={referralCode} onChange={(e) => setReferralCode(e.target.value)} placeholder={'كود الإحالة (اختياري)'} icon={<TagIcon />} />
                            </div>
                        )}
                        <div>
                            <label htmlFor="password" className="sr-only">{'كلمة المرور'}</label>
                            <PasswordInput id="password" name="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={'كلمة المرور'} required />
                        </div>
                        {error && <p className="text-red-500 text-sm text-start">{error}</p>}
                        <button type="submit" disabled={isLoading} className="w-full bg-primary-500 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-primary-600 transition-transform transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-orange-300 disabled:bg-gray-400">
                            {isLoading ? (loadingVariant === 'passkey' ? 'جاري تسجيل الدخول بالبصمة...' : 'جاري تسجيل الدخول...') : (mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب')}
                        </button>
                        {mode === 'login' && (
                            <button
                                type="button"
                                onClick={handlePasskeyLogin}
                                disabled={isLoading}
                                className="w-full flex justify-center items-center py-3 px-6 rounded-lg shadow-lg border border-primary-500 text-primary-600 dark:text-primary-400 bg-transparent hover:bg-primary-50 dark:hover:bg-gray-700 transition-transform transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-orange-300 disabled:opacity-50"
                            >
                                {isLoading && loadingVariant === 'passkey' ? 'جاري تسجيل الدخول بالبصمة...' : 'تسجيل الدخول بالبصمة'}
                            </button>
                        )}
                    </form>

                    {isGoogleLoginEnabled && (
                        <>
                            <div className="relative my-6">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-gray-300 dark:border-gray-600" />
                                </div>
                                <div className="relative flex justify-center text-sm">
                                    <span className="bg-white dark:bg-gray-800 px-2 text-gray-500 dark:text-gray-400">
                                        {'أو'}
                                    </span>
                                </div>
                            </div>

                            <div>
                                <button
                                    type="button"
                                    onClick={handleGoogleLogin}
                                    disabled={isLoading}
                                    className="w-full flex justify-center items-center gap-3 py-3 px-4 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gold-500"
                                >
                                    <GoogleIcon />
                                    {'المتابعة باستخدام جوجل'}
                                </button>
                            </div>
                        </>
                    )}

                </div>

                <p className="text-sm text-gray-600 dark:text-gray-400">
                    {mode === 'login' ? 'ليس لديك حساب؟' : 'لديك حساب بالفعل؟'}{' '}
                    <button onClick={toggleMode} className="font-semibold text-gold-500 hover:underline">
                        {mode === 'login' ? 'إنشاء حساب' : 'تسجيل الدخول'}
                    </button>
                </p>
            </div>
            <div className="mt-6 text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                    نصر البكري للبرامج والتطبيقات
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400" dir="ltr">
                    <a href="tel:+967772519054" className="hover:text-gold-500">772519054</a>
                    <span className="mx-1">|</span>
                    <a href="tel:+967718419380" className="hover:text-gold-500">718419380</a>
                </p>
            </div>
        </div>
    );
};

export default LoginScreen;
