import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import type { AdminPermission, AdminRole, AdminUser } from '../../types';
import { ADMIN_PERMISSION_DEFS, defaultAdminPermissionsForRole, UI_ROLE_PRESET_DEFS, permissionsForPreset } from '../../types';
import TextInput from '../../components/TextInput';
import PasswordInput from '../../components/PasswordInput';
import { AtSymbolIcon, CameraIcon, MailIcon, PhoneIcon, UserIcon } from '../../components/icons';
import ConfirmationModal from '../../components/admin/ConfirmationModal';

const AdminProfileScreen: React.FC = () => {
  const { user, updateProfile, changePassword, listAdminUsers, createAdminUser, updateAdminUser, setAdminUserActive, resetAdminUserPassword, deleteAdminUser, hasPermission } = useAuth();
  const { showNotification } = useToast();
  const [formData, setFormData] = useState<Partial<AdminUser>>({});
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [isSavingInfo, setIsSavingInfo] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [managementError, setManagementError] = useState('');

  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', fullName: '', role: 'employee' as AdminRole, password: '', confirmPassword: '' });
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [customizeNewUserPermissions, setCustomizeNewUserPermissions] = useState(false);
  const [newUserPermissions, setNewUserPermissions] = useState<AdminPermission[]>([]);
  const [newUserPreset, setNewUserPreset] = useState<string>('');

  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editUser, setEditUser] = useState({ username: '', fullName: '', role: 'employee' as AdminRole, email: '', phoneNumber: '', avatarUrl: '' });
  const [editPermissions, setEditPermissions] = useState<AdminPermission[]>([]);
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);
  const [editPreset, setEditPreset] = useState<string>('');

  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        phoneNumber: user.phoneNumber,
        avatarUrl: user.avatarUrl,
      });
    }
  }, [user]);

  const roleLabel: Record<AdminRole, string> = {
    owner: 'المالك',
    manager: 'مدير',
    employee: 'موظف',
    cashier: 'كاشير',
    delivery: 'مندوب',
    accountant: 'محاسب',
  };

  const defaultPermissionsForRole = (role: AdminRole): AdminPermission[] => defaultAdminPermissionsForRole(role);

  const localizeCreateAdminUserError = (message: string) => {
    const raw = message.trim();
    if (!raw) return 'تعذر إنشاء المستخدم.';
    if (/[\u0600-\u06FF]/.test(raw)) return raw;
    const normalized = raw.toLowerCase();
    if (normalized.includes('invalid jwt') || normalized.includes('jwt')) return 'انتهت الجلسة أو بيانات الدخول غير صالحة. أعد تسجيل الدخول ثم حاول مرة أخرى.';
    if (normalized.includes('failed to fetch') || normalized.includes('network') || normalized.includes('fetch')) return 'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.';
    if (normalized.includes('not authorized') || normalized.includes('forbidden') || normalized.includes('permission')) return 'ليس لديك صلاحية تنفيذ هذا الإجراء.';
    if (normalized.includes('already registered') || normalized.includes('user already')) return 'هذا البريد مستخدم مسبقاً.';
    if (normalized.includes('duplicate') && normalized.includes('username')) return 'اسم المستخدم مستخدم مسبقاً.';
    if (normalized.includes('missing required')) return 'الحقول المطلوبة ناقصة.';
    return `تعذر إنشاء المستخدم: ${raw}`;
  };

  const refreshUsers = async () => {
    if (!hasPermission('adminUsers.manage')) return;
    setIsLoadingUsers(true);
    try {
      const list = await listAdminUsers();
      setAdminUsers(list);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  useEffect(() => {
    refreshUsers();
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!customizeNewUserPermissions) {
      setNewUserPermissions(defaultPermissionsForRole(newUser.role));
    }
  }, [customizeNewUserPermissions, newUser.role]);

  const handleInfoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPasswordData({ ...passwordData, [e.target.name]: e.target.value });
  };

  const handleAvatarChange = () => {
    // Simulate cycling through avatars
    const newAvatarId = Math.floor(Math.random() * 100);
    setFormData(prev => ({ ...prev, avatarUrl: `https://i.pravatar.cc/150?u=admin${newAvatarId}` }));
  };

  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingInfo(true);
    try {
      await updateProfile({
        fullName: formData.fullName,
        username: formData.username,
        email: formData.email,
        phoneNumber: formData.phoneNumber,
        avatarUrl: formData.avatarUrl
      });
      showNotification('تم تحديث الملف الشخصي بنجاح!', 'success');
      await refreshUsers();
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      showNotification(raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'تعذر حفظ التغييرات.', 'error');
    } finally {
      setIsSavingInfo(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError('كلمتا المرور الجديدتان غير متطابقتين.');
      return;
    }
    if (passwordData.newPassword.length < 6) {
      setPasswordError('يجب أن تكون كلمة المرور الجديدة 6 أحرف على الأقل.');
      return;
    }

    setIsSavingPassword(true);
    try {
      await changePassword(passwordData.currentPassword, passwordData.newPassword);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      showNotification('تم تغيير كلمة المرور بنجاح!', 'success');
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      setPasswordError(raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'تعذر تغيير كلمة المرور.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  if (!user) {
    return <div>جاري تحميل بيانات المستخدم...</div>;
  }

  return (
    <div className="animate-fade-in space-y-8">
      <h1 className="text-3xl font-bold dark:text-white">الملف الشخصي للمدير</h1>

      {/* Profile Info Form */}
      <form onSubmit={handleInfoSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
          المعلومات الشخصية
        </h2>

        <div className="flex items-center space-x-6 rtl:space-x-reverse mb-8">
          <div className="relative">
            <img src={formData.avatarUrl || undefined} alt="Profile" className="w-24 h-24 rounded-full object-cover border-4 border-gray-200 dark:border-gray-600" />
            <button type="button" onClick={handleAvatarChange} className="absolute bottom-0 right-0 bg-primary-500 p-2 rounded-full hover:bg-primary-600 transition-colors">
              <CameraIcon />
            </button>
          </div>
          <div>
            <h3 className="text-2xl font-bold dark:text-white">{formData.fullName}</h3>
            <p className="text-gray-500 dark:text-gray-400">@{formData.username}</p>
            <p className="text-gray-500 dark:text-gray-400">{formData.email}</p>
            <p className="text-gray-500 dark:text-gray-400">{roleLabel[user.role]}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الاسم الكامل</label>
            <TextInput id="fullName" name="fullName" value={formData.fullName || ''} onChange={handleInfoChange} icon={<UserIcon />} required />
          </div>
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اسم المستخدم</label>
            <TextInput id="username" name="username" value={formData.username || ''} onChange={handleInfoChange} icon={<AtSymbolIcon />} required />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">يستخدم لتسجيل الدخول إلى لوحة التحكم.</p>
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">البريد الإلكتروني</label>
            <TextInput id="email" name="email" type="email" value={formData.email || ''} onChange={handleInfoChange} icon={<MailIcon />} required />
          </div>
          <div>
            <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رقم الهاتف</label>
            <TextInput id="phoneNumber" name="phoneNumber" type="tel" value={formData.phoneNumber || ''} onChange={handleInfoChange} icon={<PhoneIcon />} required />
          </div>
        </div>
        <div className="pt-6 mt-6 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button type="submit" disabled={isSavingInfo} className="bg-primary-500 text-white font-bold py-2 px-6 rounded-lg shadow-md hover:bg-primary-600 transition-colors w-36 disabled:bg-primary-400 disabled:cursor-wait">
            {isSavingInfo ? 'جاري الحفظ...' : 'حفظ التغييرات'}
          </button>
        </div>
      </form>

      {hasPermission('adminUsers.manage') && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
            إدارة مستخدمي لوحة التحكم
          </h2>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setManagementError('');
              if (!newUser.username.trim()) {
                setManagementError('اسم المستخدم مطلوب.');
                return;
              }
              if (!newUser.fullName.trim()) {
                setManagementError('الاسم الكامل مطلوب.');
                return;
              }
              if (newUser.password !== newUser.confirmPassword) {
                setManagementError('كلمتا المرور غير متطابقتين.');
                return;
              }
              setIsCreatingUser(true);
              try {
                await createAdminUser({
                  username: newUser.username,
                  fullName: newUser.fullName,
                  role: newUser.role,
                  password: newUser.password,
                  permissions: newUserPermissions,
                });
                setNewUser({ username: '', fullName: '', role: 'employee', password: '', confirmPassword: '' });
                setCustomizeNewUserPermissions(false);
                setNewUserPermissions(defaultPermissionsForRole('employee'));
                showNotification('تم إنشاء المستخدم بنجاح!', 'success');
                await refreshUsers();
              } catch (err) {
                const raw = err instanceof Error ? err.message : String(err || '');
                showNotification(localizeCreateAdminUserError(raw), 'error');
              } finally {
                setIsCreatingUser(false);
              }
            }}
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            <div>
              <label htmlFor="newUsername" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اسم المستخدم</label>
              <TextInput id="newUsername" name="newUsername" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} icon={<AtSymbolIcon />} required />
            </div>
            <div>
              <label htmlFor="newFullName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الاسم الكامل</label>
              <TextInput id="newFullName" name="newFullName" value={newUser.fullName} onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })} icon={<UserIcon />} required />
            </div>
            <div>
              <label htmlFor="newRole" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الدور</label>
              <select
                id="newRole"
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value as AdminRole })}
                className="w-full p-3 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
              >
                <option value="manager">مدير</option>
                <option value="employee">موظف</option>
                <option value="cashier">كاشير</option>
                <option value="delivery">مندوب</option>
                <option value="accountant">محاسب</option>
              </select>
            </div>
            <div className="md:col-span-2 flex items-center gap-3">
              <input
                id="customizeNewUserPermissions"
                type="checkbox"
                checked={customizeNewUserPermissions}
                onChange={(e) => setCustomizeNewUserPermissions(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="customizeNewUserPermissions" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                تخصيص الصلاحيات لهذا المستخدم
              </label>
            </div>
            {customizeNewUserPermissions && (
              <div className="md:col-span-2">
                <div className="flex items-center gap-3 mb-3">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">قالب صلاحيات</label>
                  <select
                    value={newUserPreset}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewUserPreset(val);
                      if (val) setNewUserPermissions(permissionsForPreset(val as any));
                    }}
                    className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-gold-500 focus:border-gold-500 text-sm"
                  >
                    <option value="">— اختر قالب —</option>
                    {UI_ROLE_PRESET_DEFS.map(p => (
                      <option key={p.key} value={p.key}>{p.labelAr}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setNewUserPermissions(defaultPermissionsForRole(newUser.role))}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    افتراضي الدور
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {ADMIN_PERMISSION_DEFS.filter(def => def.key !== 'adminUsers.manage').map(def => (
                    <label key={def.key} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                      <input
                        type="checkbox"
                        checked={newUserPermissions.includes(def.key)}
                        onChange={(e) => {
                          setNewUserPermissions(prev => (e.target.checked ? Array.from(new Set([...prev, def.key])) : prev.filter(p => p !== def.key)));
                        }}
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-gray-800 dark:text-gray-200">{def.labelAr}</span>
                    </label>
                  ))}
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                    <input
                      type="checkbox"
                      checked={newUserPermissions.includes('adminUsers.manage')}
                      onChange={(e) => {
                        setNewUserPermissions(prev => (e.target.checked ? Array.from(new Set([...prev, 'adminUsers.manage'])) : prev.filter(p => p !== 'adminUsers.manage')));
                      }}
                      className="h-4 w-4"
                    />
                    <span className="text-sm text-gray-800 dark:text-gray-200">إدارة مستخدمي لوحة التحكم</span>
                  </label>
                </div>
              </div>
            )}
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="newPasswordUser" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">كلمة المرور</label>
                <PasswordInput id="newPasswordUser" name="newPasswordUser" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} required />
              </div>
              <div>
                <label htmlFor="newPasswordUserConfirm" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تأكيد كلمة المرور</label>
                <PasswordInput id="newPasswordUserConfirm" name="newPasswordUserConfirm" value={newUser.confirmPassword} onChange={(e) => setNewUser({ ...newUser, confirmPassword: e.target.value })} required />
              </div>
            </div>
            <div className="md:col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={isCreatingUser}
                className="bg-green-600 text-white font-bold py-2 px-6 rounded-lg shadow-md hover:bg-green-700 transition-colors w-44 disabled:bg-green-400 disabled:cursor-wait"
              >
                {isCreatingUser ? 'جاري الإنشاء...' : 'إنشاء مستخدم'}
              </button>
            </div>
            {managementError && <p className="md:col-span-2 text-red-500 text-sm">{managementError}</p>}
          </form>

          <div className="mt-8">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">المستخدم</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الدور</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الحالة</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {isLoadingUsers ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">جاري تحميل المستخدمين...</td>
                    </tr>
                  ) : adminUsers.length > 0 ? (
                    adminUsers.map((u) => (
                      <tr key={u.id}>
                        <td className="px-4 py-3">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">{u.fullName}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">@{u.username}</div>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={u.role}
                            disabled={u.role === 'owner'}
                            onChange={async (e) => {
                              try {
                                await updateAdminUser(u.id, { role: e.target.value as AdminRole });
                                showNotification('تم تحديث الدور.', 'success');
                                await refreshUsers();
                              } catch (err) {
                                const raw = err instanceof Error ? err.message : '';
                                showNotification(raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'تعذر تحديث الدور.', 'error');
                              }
                            }}
                            className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-orange-500 focus:border-orange-500 transition text-sm"
              >
                {u.role === 'owner' && <option value="owner">المالك</option>}
                <option value="manager">مدير</option>
                <option value="employee">موظف</option>
                <option value="cashier">كاشير</option>
                <option value="delivery">مندوب</option>
                <option value="accountant">محاسب</option>
              </select>
            </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${u.isActive ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}>
                            {u.isActive ? 'نشط' : 'موقوف'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setResetPasswordUserId(u.id);
                                setResetPasswordValue('');
                                setResetPasswordConfirm('');
                                setManagementError('');
                              }}
                              className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm"
                            >
                              إعادة ضبط كلمة المرور
                            </button>
                            {u.role !== 'owner' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditUserId(u.id);
                                    setEditUser({
                                      username: u.username,
                                      fullName: u.fullName,
                                      role: u.role,
                                      email: u.email || '',
                                      phoneNumber: u.phoneNumber || '',
                                      avatarUrl: u.avatarUrl || '',
                                    });
                                    setEditPermissions(Array.isArray(u.permissions) && u.permissions.length ? u.permissions : defaultPermissionsForRole(u.role));
                                    setManagementError('');
                                  }}
                                  className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-800 transition text-sm"
                                >
                                  تعديل
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteUserId(u.id);
                                    setManagementError('');
                                  }}
                                  className="px-3 py-1 bg-red-700 text-white rounded hover:bg-red-800 transition text-sm"
                                >
                                  أرشفة
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await setAdminUserActive(u.id, !u.isActive);
                                      showNotification(u.isActive ? 'تم إيقاف المستخدم.' : 'تم تفعيل المستخدم.', 'success');
                                      await refreshUsers();
                                    } catch (err) {
                                      const raw = err instanceof Error ? err.message : '';
                                      showNotification(raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'تعذر تحديث حالة المستخدم.', 'error');
                                    }
                                  }}
                                  className={`px-3 py-1 text-white rounded transition text-sm ${u.isActive ? 'bg-orange-600 hover:bg-orange-700' : 'bg-green-600 hover:bg-green-700'}`}
                                >
                                  {u.isActive ? 'إيقاف' : 'تفعيل'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">لا يوجد مستخدمون.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <ConfirmationModal
            isOpen={Boolean(resetPasswordUserId)}
            onClose={() => {
              if (isResettingPassword) return;
              setResetPasswordUserId(null);
            }}
            onConfirm={async () => {
              if (!resetPasswordUserId) return;
              setManagementError('');
              if (resetPasswordValue !== resetPasswordConfirm) {
                setManagementError('كلمتا المرور غير متطابقتين.');
                return;
              }
              if (resetPasswordValue.trim().length < 6) {
                setManagementError('يجب أن تكون كلمة المرور 6 أحرف على الأقل.');
                return;
              }
              setIsResettingPassword(true);
              try {
                await resetAdminUserPassword(resetPasswordUserId, resetPasswordValue);
                showNotification('تم تحديث كلمة المرور.', 'success');
                setResetPasswordUserId(null);
              } catch (err) {
                const raw = err instanceof Error ? err.message : '';
                showNotification(raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'تعذر تحديث كلمة المرور.', 'error');
              } finally {
                setIsResettingPassword(false);
              }
            }}
            title="إعادة ضبط كلمة المرور"
            message=""
            isConfirming={isResettingPassword}
            confirmText="حفظ"
            confirmingText="جاري الحفظ..."
            cancelText="إلغاء"
            confirmButtonClassName="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400"
          >
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">أدخل كلمة مرور جديدة للمستخدم.</p>
              <div>
                <label htmlFor="resetPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">كلمة المرور الجديدة</label>
                <PasswordInput id="resetPassword" name="resetPassword" value={resetPasswordValue} onChange={(e) => setResetPasswordValue(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="resetPasswordConfirm" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تأكيد كلمة المرور</label>
                <PasswordInput id="resetPasswordConfirm" name="resetPasswordConfirm" value={resetPasswordConfirm} onChange={(e) => setResetPasswordConfirm(e.target.value)} required />
              </div>
              {managementError && <p className="text-red-500 text-sm">{managementError}</p>}
            </div>
          </ConfirmationModal>

          <ConfirmationModal
            isOpen={Boolean(editUserId)}
            onClose={() => {
              if (isUpdatingUser) return;
              setEditUserId(null);
            }}
            onConfirm={async () => {
              if (!editUserId) return;
              setManagementError('');
              if (!editUser.username.trim()) {
                setManagementError('اسم المستخدم مطلوب.');
                return;
              }
              if (!editUser.fullName.trim()) {
                setManagementError('الاسم الكامل مطلوب.');
                return;
              }
              setIsUpdatingUser(true);
              try {
                await updateAdminUser(editUserId, {
                  username: editUser.username.trim(),
                  fullName: editUser.fullName.trim(),
                  role: editUser.role,
                  email: editUser.email.trim() ? editUser.email.trim() : undefined,
                  phoneNumber: editUser.phoneNumber.trim() ? editUser.phoneNumber.trim() : undefined,
                  avatarUrl: editUser.avatarUrl.trim() ? editUser.avatarUrl.trim() : undefined,
                  permissions: editPermissions,
                });
                showNotification('تم تحديث بيانات المستخدم.', 'success');
                setEditUserId(null);
                await refreshUsers();
              } catch (err) {
                const raw = err instanceof Error ? err.message : '';
                showNotification(raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'تعذر تحديث بيانات المستخدم.', 'error');
              } finally {
                setIsUpdatingUser(false);
              }
            }}
            title="تعديل المستخدم"
            message=""
            isConfirming={isUpdatingUser}
            confirmText="حفظ"
            confirmingText="جاري الحفظ..."
            cancelText="إلغاء"
            confirmButtonClassName="bg-green-600 hover:bg-green-700 disabled:bg-green-400"
          >
            <div className="space-y-4">
              <div>
                <label htmlFor="editUsername" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اسم المستخدم</label>
                <TextInput id="editUsername" name="editUsername" value={editUser.username} onChange={(e) => setEditUser(prev => ({ ...prev, username: e.target.value }))} icon={<AtSymbolIcon />} required />
              </div>
              <div>
                <label htmlFor="editFullName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الاسم الكامل</label>
                <TextInput id="editFullName" name="editFullName" value={editUser.fullName} onChange={(e) => setEditUser(prev => ({ ...prev, fullName: e.target.value }))} icon={<UserIcon />} required />
              </div>
              <div>
                <label htmlFor="editEmail" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">البريد الإلكتروني</label>
                <TextInput id="editEmail" name="editEmail" type="email" value={editUser.email} onChange={(e) => setEditUser(prev => ({ ...prev, email: e.target.value }))} icon={<MailIcon />} />
              </div>
              <div>
                <label htmlFor="editPhoneNumber" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رقم الهاتف</label>
                <TextInput id="editPhoneNumber" name="editPhoneNumber" type="tel" value={editUser.phoneNumber} onChange={(e) => setEditUser(prev => ({ ...prev, phoneNumber: e.target.value }))} icon={<PhoneIcon />} />
              </div>
              <div>
                <label htmlFor="editAvatarUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رابط الصورة</label>
                <TextInput id="editAvatarUrl" name="editAvatarUrl" value={editUser.avatarUrl} onChange={(e) => setEditUser(prev => ({ ...prev, avatarUrl: e.target.value }))} icon={<CameraIcon />} />
              </div>
              <div>
                <label htmlFor="editRole" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">الدور</label>
                <select
                  id="editRole"
                  value={editUser.role}
                  onChange={(e) => setEditUser(prev => ({ ...prev, role: e.target.value as AdminRole }))}
                  className="w-full p-3 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                >
                  <option value="manager">مدير</option>
                  <option value="employee">موظف</option>
                  <option value="cashier">كاشير</option>
                  <option value="delivery">مندوب</option>
                  <option value="accountant">محاسب</option>
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">الصلاحيات</label>
                  <button
                    type="button"
                    onClick={() => setEditPermissions(defaultPermissionsForRole(editUser.role))}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    افتراضي الدور
                  </button>
                  <div className="flex items-center gap-2">
                    <select
                      value={editPreset}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditPreset(val);
                        if (val) setEditPermissions(permissionsForPreset(val as any));
                      }}
                      className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:ring-gold-500 focus:border-gold-500 text-xs"
                    >
                      <option value="">— قالب صلاحيات —</option>
                      {UI_ROLE_PRESET_DEFS.map(p => (
                        <option key={p.key} value={p.key}>{p.labelAr}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-auto p-2 border border-gray-200 dark:border-gray-700 rounded-lg">
                  {ADMIN_PERMISSION_DEFS.map(def => (
                    <label key={def.key} className="flex items-center gap-3 p-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700">
                      <input
                        type="checkbox"
                        checked={editPermissions.includes(def.key)}
                        onChange={(e) => {
                          setEditPermissions(prev => (e.target.checked ? Array.from(new Set([...prev, def.key])) : prev.filter(p => p !== def.key)));
                        }}
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-gray-800 dark:text-gray-200">{def.labelAr}</span>
                    </label>
                  ))}
                </div>
              </div>
              {managementError && <p className="text-red-500 text-sm">{managementError}</p>}
            </div>
          </ConfirmationModal>

          <ConfirmationModal
            isOpen={Boolean(deleteUserId)}
            onClose={() => {
              if (isDeletingUser) return;
              setDeleteUserId(null);
            }}
            onConfirm={async () => {
              if (!deleteUserId) return;
              setIsDeletingUser(true);
              try {
                await deleteAdminUser(deleteUserId);
                showNotification('تم أرشفة المستخدم.', 'success');
                setDeleteUserId(null);
                await refreshUsers();
              } catch (err) {
                const raw = err instanceof Error ? err.message : '';
                showNotification(raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'تعذر أرشفة المستخدم.', 'error');
              } finally {
                setIsDeletingUser(false);
              }
            }}
            title="أرشفة المستخدم"
            message="هل أنت متأكد من أرشفة هذا المستخدم (إيقافه)؟"
            isConfirming={isDeletingUser}
            confirmText="أرشفة"
            confirmingText="جاري الأرشفة..."
            cancelText="إلغاء"
            confirmButtonClassName="bg-red-600 hover:bg-red-700 disabled:bg-red-400"
          />
        </div>
      )}

      {/* Change Password Form */}
      <form onSubmit={handlePasswordSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
          تغيير كلمة المرور
        </h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">كلمة المرور الحالية</label>
            <PasswordInput id="currentPassword" name="currentPassword" value={passwordData.currentPassword} onChange={handlePasswordChange} required />
          </div>
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">كلمة المرور الجديدة</label>
            <PasswordInput id="newPassword" name="newPassword" value={passwordData.newPassword} onChange={handlePasswordChange} required />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تأكيد كلمة المرور الجديدة</label>
            <PasswordInput id="confirmPassword" name="confirmPassword" value={passwordData.confirmPassword} onChange={handlePasswordChange} required />
          </div>
        </div>
        {passwordError && <p className="text-red-500 text-sm mt-4">{passwordError}</p>}
        <div className="pt-6 mt-6 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button type="submit" disabled={isSavingPassword} className="bg-blue-600 text-white font-bold py-2 px-6 rounded-lg shadow-md hover:bg-blue-700 transition-colors w-40 disabled:bg-blue-400 disabled:cursor-wait">
            {isSavingPassword ? 'جاري التغيير...' : 'تغيير كلمة المرور'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AdminProfileScreen;
