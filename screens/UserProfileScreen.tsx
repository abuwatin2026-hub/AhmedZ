import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserAuth } from '../contexts/UserAuthContext';
import { useToast } from '../contexts/ToastContext';
import { useChallenges } from '../contexts/ChallengeContext';
import TextInput from '../components/TextInput';
import LoyaltyTierCard from '../components/LoyaltyTierCard';
import ChallengeCard from '../components/ChallengeCard';
import { Share } from '@capacitor/share';
import { CameraIcon, UserIcon } from '../components/icons';
import { registerPasskey, listPasskeys, deletePasskey, localizePasskeyError, type PasskeyCredential } from '../utils/passkey';

const UserProfileScreen: React.FC = () => {
  const { currentUser, updateCustomer, logout } = useUserAuth();
  const { challenges, userProgress, claimReward, loading: challengesLoading } = useChallenges();
  const { showNotification } = useToast();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ fullName: '', avatarUrl: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);

  useEffect(() => {
    if (currentUser) {
      setFormData({
        fullName: currentUser.fullName || '',
        avatarUrl: currentUser.avatarUrl || `https://i.pravatar.cc/150?u=${currentUser.id}`,
      });
    }
  }, [currentUser]);

  const loadPasskeys = useCallback(async () => {
    setPasskeysLoading(true);
    try {
      const list = await listPasskeys();
      setPasskeys(list);
    } catch (err) {
      console.error('loadPasskeys error:', err);
      setPasskeys([]);
    } finally {
      setPasskeysLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPasskeys();
  }, [loadPasskeys]);

  const handleInfoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleAvatarChange = () => {
    const newAvatarId = Math.floor(Math.random() * 100);
    setFormData(prev => ({ ...prev, avatarUrl: `https://i.pravatar.cc/150?u=${currentUser?.id}-${newAvatarId}` }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    setIsSaving(true);
    await updateCustomer({
      ...currentUser,
      fullName: formData.fullName,
      avatarUrl: formData.avatarUrl
    });
    setIsSaving(false);
    showNotification('تم تحديث الملف الشخصي بنجاح', 'success');
  };

  const handleLogout = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  const handleAddPasskey = async () => {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) {
      showNotification('متصفحك لا يدعم البصمة (WebAuthn).', 'error');
      return;
    }
    setPasskeysLoading(true);
    try {
      const deviceName = `Passkey (${new Date().toLocaleDateString('ar-YE-u-nu-latn')})`;
      const result = await registerPasskey(deviceName);
      if ('error' in result) {
        showNotification(localizePasskeyError(result.error), 'error');
        return;
      }
      showNotification('تمت إضافة Passkey بنجاح ✓', 'success');
      if (currentUser && !currentUser.requirePasskey) {
        await updateCustomer({ ...currentUser, requirePasskey: true });
      }
      await loadPasskeys();
    } catch (err: any) {
      showNotification(localizePasskeyError(err?.message || 'webauthn_error'), 'error');
    } finally {
      setPasskeysLoading(false);
    }
  };

  const handleRemovePasskey = async (passkeyId: string) => {
    const ok = window.confirm('هل تريد حذف هذه البصمة؟');
    if (!ok) return;
    setPasskeysLoading(true);
    try {
      const deleted = await deletePasskey(passkeyId);
      if (!deleted) {
        showNotification('فشل حذف البصمة.', 'error');
        return;
      }
      showNotification('تم حذف البصمة.', 'success');
      const remaining = passkeys.filter(p => p.id !== passkeyId);
      setPasskeys(remaining);
      if (currentUser?.requirePasskey && remaining.length === 0) {
        await updateCustomer({ ...currentUser, requirePasskey: false });
      }
    } catch (err: any) {
      showNotification(localizePasskeyError(err?.message || 'internal_error'), 'error');
    } finally {
      setPasskeysLoading(false);
    }
  };

  const handleToggleRequirePasskey = async (next: boolean) => {
    if (!currentUser) return;
    if (next && passkeys.length === 0) {
      showNotification('أضف بصمة أولاً ثم فعّل الطلب عند تسجيل الدخول.', 'error');
      return;
    }
    setIsSaving(true);
    await updateCustomer({ ...currentUser, requirePasskey: next });
    setIsSaving(false);
    showNotification('تم تحديث إعداد البصمة.', 'success');
  };

  const handleShare = async () => {
    if (!currentUser?.referralCode) return;
    try {
      await Share.share({
        title: `دعوة للانضمام إلى منصتنا`,
        text: `استخدم كود الدعوة الخاص بي ${currentUser.referralCode} عند التسجيل للحصول على خصم على أول طلب!`,
        dialogTitle: `مشاركة كود الدعوة`,
      });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error sharing referral code:', error);
      }
      // Fallback to clipboard if sharing fails (e.g., on web without native share)
      navigator.clipboard.writeText(currentUser.referralCode);
      showNotification('تم نسخ كود الدعوة إلى الحافظة!', 'info');
    }
  };


  if (!currentUser) {
    return <div className="text-center p-8">Loading...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="animate-fade-in space-y-8">
        <h1 className="text-3xl font-bold dark:text-white">الملف الشخصي</h1>

        <section>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">الولاء والتحديات</h2>
          <LoyaltyTierCard />
        </section>

        {currentUser.referralCode && (
          <section>
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md text-center border-t-4 border-gold-500">
              <h3 className="font-bold text-xl text-gray-800 dark:text-white">ادعُ صديقاً</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">كود الدعوة الخاص بك</p>
              <div className="my-4 p-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg inline-block">
                <p className="text-2xl font-mono font-bold tracking-widest text-gold-500">{currentUser.referralCode}</p>
              </div>
              <button
                onClick={handleShare}
                className="w-full sm:w-auto bg-primary-500 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-primary-600 transition-transform transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-orange-300"
              >
                مشاركة
              </button>
            </div>
          </section>
        )}

        <section>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">التحديات</h2>
          <div className="space-y-4">
            {challengesLoading ? (
              <p>Loading challenges...</p>
            ) : (
              challenges.map(challenge => {
                const progress = userProgress.find(p => p.challengeId === challenge.id);
                return (
                  <ChallengeCard
                    key={challenge.id}
                    challenge={challenge}
                    progress={progress}
                    onClaim={claimReward}
                  />
                );
              })
            )}
          </div>
        </section>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8">
          <div className="flex items-center space-x-6 rtl:space-x-reverse mb-8">
            <div className="relative">
              <img src={formData.avatarUrl || undefined} alt="Profile" className="w-24 h-24 rounded-full object-cover border-4 border-gray-200 dark:border-gray-600" />
              <button type="button" onClick={handleAvatarChange} className="absolute bottom-0 right-0 bg-primary-500 p-2 rounded-full hover:bg-primary-600 transition-colors">
                <CameraIcon />
              </button>
            </div>
            <div>
              <h3 className="text-2xl font-bold dark:text-white">{formData.fullName}</h3>
              <p className="text-gray-500 dark:text-gray-400">{currentUser.phoneNumber || currentUser.loginIdentifier || currentUser.email}</p>
            </div>
          </div>

          <section className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold dark:text-gray-200 mb-2">المعلومات الشخصية</h3>
              <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الاسم الكامل</label>
              <TextInput id="fullName" name="fullName" value={formData.fullName} onChange={handleInfoChange} icon={<UserIcon />} required />
            </div>
            <div>
              <h3 className="text-lg font-semibold dark:text-gray-200 mb-2">معلومات الدخول</h3>
              <div>
                <label htmlFor="loginIdentifier" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">معرف الدخول (رقم الهاتف/البريد)</label>
                <TextInput
                  id="loginIdentifier"
                  name="loginIdentifier"
                  type="text"
                  value={currentUser.loginIdentifier || ''}
                  onChange={() => { }}
                  icon={<UserIcon />}
                  disabled
                />
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">لا يمكن تغيير معرف الدخول.</p>
            </div>
          </section>

          {/* Custom WebAuthn Passkeys — independent of Supabase MFA */}
          {typeof window !== 'undefined' && window.PublicKeyCredential && (
            <section className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold dark:text-gray-200 mb-2">
                البصمة / Passkey
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                أضف بصمتك أو قفل الشاشة لتسجيل الدخول بشكل أسرع وأكثر أماناً.
                يعمل على الأجهزة الحديثة ويتزامن عبر حساب Google/iCloud.
              </p>

              <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900 mb-4">
                <div>
                  <div className="font-semibold text-gray-800 dark:text-gray-200">طلب البصمة عند تسجيل الدخول</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">إذا فُعلت: سيُطلب منك تأكيد البصمة بعد كلمة المرور.</div>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(currentUser.requirePasskey)}
                  onChange={(e) => void handleToggleRequirePasskey(e.target.checked)}
                  className="h-5 w-5"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <button
                  type="button"
                  onClick={() => void handleAddPasskey()}
                  disabled={passkeysLoading}
                  className="bg-primary-500 text-white font-bold py-3 px-6 rounded-lg shadow-md hover:bg-primary-600 transition-colors disabled:bg-primary-400 disabled:cursor-wait"
                >
                  {passkeysLoading ? 'جاري...' : '➕ إضافة بصمة'}
                </button>
                <button
                  type="button"
                  onClick={() => void loadPasskeys()}
                  disabled={passkeysLoading}
                  className="px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60"
                >
                  تحديث القائمة
                </button>
              </div>

              <div>
                {passkeysLoading && (
                  <div className="text-sm text-gray-500 dark:text-gray-400">جاري التحميل...</div>
                )}
                {!passkeysLoading && passkeys.length === 0 && (
                  <div className="text-sm text-gray-500 dark:text-gray-400">لا توجد بصمات مضافة بعد.</div>
                )}
                {!passkeysLoading && passkeys.length > 0 && (
                  <div className="space-y-2">
                    {passkeys.map((pk) => (
                      <div key={pk.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
                        <div>
                          <div className="font-semibold text-gray-800 dark:text-gray-200">🔑 {pk.device_name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            أُضيفت: {new Date(pk.created_at).toLocaleDateString('ar-YE')}
                            {pk.last_used_at ? ` · آخر استخدام: ${new Date(pk.last_used_at).toLocaleDateString('ar-YE')}` : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRemovePasskey(pk.id)}
                          disabled={passkeysLoading}
                          className="px-3 py-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-60 text-sm font-semibold"
                        >
                          حذف
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          <div className="pt-6 mt-6 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <button type="button" onClick={handleLogout} className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 font-semibold hover:underline">
              {'تسجيل الخروج'}
            </button>
            <button type="submit" disabled={isSaving} className="bg-primary-500 text-white font-bold py-3 px-6 rounded-lg shadow-md hover:bg-primary-600 transition-colors w-40 disabled:bg-primary-400 disabled:cursor-wait">
              {isSaving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserProfileScreen;
