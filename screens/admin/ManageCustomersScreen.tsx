import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserAuth } from '../../contexts/UserAuthContext';
import { useOrders } from '../../contexts/OrderContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Customer, Order, OrderStatus } from '../../types';
import ManagePointsModal from '../../components/admin/ManagePointsModal';
import { StarIcon } from '../../components/icons';
import Spinner from '../../components/Spinner';
import { getBaseCurrencyCode, getSupabaseClient } from '../../supabase';
import ConfirmationModal from '../../components/admin/ConfirmationModal';
import CurrencyDualAmount from '../../components/common/CurrencyDualAmount';

const ManageCustomersScreen: React.FC = () => {
  const navigate = useNavigate();
  const { customers, loading, fetchCustomers, deleteCustomer } = useUserAuth();
  const { updateOrderStatus, markOrderPaid } = useOrders();
  const { hasPermission, listAdminUsers } = useAuth();
  const { showNotification } = useToast();
  const [baseCode, setBaseCode] = useState('—');
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<'overview' | 'orders' | 'actions'>('overview');
  const [isSelectedCustomerAppLinked, setIsSelectedCustomerAppLinked] = useState<boolean>(true);
  const [currencyOptions, setCurrencyOptions] = useState<string[]>([]);
  const [customerDraft, setCustomerDraft] = useState<{ fullName: string; phoneNumber: string; loyaltyTier: Customer['loyaltyTier']; firstOrderDiscountApplied: boolean; preferredCurrency: string; customerType?: Customer['customerType']; paymentTerms?: Customer['paymentTerms']; creditLimit?: number }>({
    fullName: '',
    phoneNumber: '',
    loyaltyTier: 'regular',
    firstOrderDiscountApplied: false,
    preferredCurrency: '',
    customerType: undefined,
    paymentTerms: undefined,
    creditLimit: undefined,
  });
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);

  useEffect(() => {
    void getBaseCurrencyCode().then((c) => {
      if (!c) return;
      setBaseCode(c);
    });
  }, []);
  const [isCancellingOrder, setIsCancellingOrder] = useState(false);
  const [deleteCustomerId, setDeleteCustomerId] = useState<string | null>(null);
  const [isDeletingCustomer, setIsDeletingCustomer] = useState(false);
  const [adminUserIds, setAdminUserIds] = useState<Set<string>>(new Set());
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
  const [newCustomerDraft, setNewCustomerDraft] = useState<{ fullName: string; phone: string; customerType: 'retail' | 'wholesale'; creditLimit?: number; notes?: string }>({
    fullName: '',
    phone: '',
    customerType: 'retail',
    creditLimit: undefined,
    notes: '',
  });

  const statusTranslations: Record<OrderStatus, string> = {
    pending: 'قيد الانتظار',
    preparing: 'جاري التحضير',
    out_for_delivery: 'في الطريق',
    delivered: 'تم التوصيل',
    scheduled: 'مجدول',
    cancelled: 'ملغي'
  };

  const canViewOrders = hasPermission('orders.view');
  const canUpdateAllStatuses = hasPermission('orders.updateStatus.all');
  const canUpdateDeliveryStatuses = hasPermission('orders.updateStatus.delivery');
  const canCancelOrders = hasPermission('orders.cancel') || canUpdateAllStatuses;
  const canMarkPaid = hasPermission('orders.markPaid') || canUpdateAllStatuses;
  const canViewInvoice = canMarkPaid || canUpdateAllStatuses;
  const canDeleteCustomer = hasPermission('customers.manage');
  const canManageCustomers = hasPermission('customers.manage');

  const handleOpenPointsModal = (customer: Customer) => {
    setEditingCustomer(customer);
  };

  const handleClosePointsModal = () => {
    setEditingCustomer(null);
  };

  const openCustomerDetails = (customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerDraft({
      fullName: customer.fullName || '',
      phoneNumber: customer.phoneNumber || '',
      loyaltyTier: customer.loyaltyTier || 'regular',
      firstOrderDiscountApplied: Boolean(customer.firstOrderDiscountApplied),
      preferredCurrency: String((customer as any).preferredCurrency || ''),
      customerType: customer.customerType,
      paymentTerms: customer.paymentTerms,
      creditLimit: typeof customer.creditLimit === 'number' ? customer.creditLimit : undefined,
    });
    setDetailsTab('overview');
  };

  useEffect(() => {
    let active = true;
    const loadCurrencies = async () => {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { data, error } = await supabase.from('currencies').select('code').order('code', { ascending: true });
        if (error) throw error;
        const codes = (Array.isArray(data) ? data : []).map((r: any) => String(r.code || '').toUpperCase()).filter(Boolean);
        if (active) setCurrencyOptions(codes);
      } catch {
        if (active) setCurrencyOptions([]);
      }
    };
    void loadCurrencies();
    return () => { active = false; };
  }, []);

  const closeCustomerDetails = () => {
    setSelectedCustomer(null);
    setCustomerOrders([]);
    setOrdersError(null);
    setOrdersLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    const loadAdmins = async () => {
      try {
        const admins = await listAdminUsers();
        const ids = new Set(admins.map(a => a.id));
        if (!cancelled) setAdminUserIds(ids);
      } catch {
        if (!cancelled) setAdminUserIds(new Set());
      }
    };
    loadAdmins();
    return () => { cancelled = true; };
  }, [listAdminUsers]);

  const visibleCustomers = useMemo(() => {
    if (!adminUserIds || adminUserIds.size === 0) return customers;
    return customers.filter(c => !adminUserIds.has(c.id));
  }, [customers, adminUserIds]);

  useEffect(() => {
    if (!selectedCustomer) return;
    let cancelled = false;
    const run = async () => {
      setOrdersLoading(true);
      setOrdersError(null);
      try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          setCustomerOrders([]);
          setOrdersError('Supabase غير مهيأ.');
          return;
        }
        const { data: rows, error } = await supabase
          .from('orders')
          .select('id,data,customer_auth_user_id,created_at,status,total,payment_method,currency,fx_rate,base_total')
          .or(`customer_auth_user_id.eq.${selectedCustomer.id},data->>customerId.eq.${selectedCustomer.id}`);
        if (error) throw error;
        const orders = (rows || [])
          .map((r: any) => {
            const base = (r?.data && typeof r.data === 'object') ? r.data : {};
            const id = String(r?.id || (base as any)?.id || '').trim();
            if (!id) return null;
            const createdAt = String((base as any)?.createdAt || r?.created_at || '').trim() || new Date().toISOString();
            const status = ((base as any)?.status || r?.status || 'pending') as OrderStatus;
            const total = Number((base as any)?.total ?? r?.total ?? 0) || 0;
            const paymentMethod = String((base as any)?.paymentMethod || r?.payment_method || '').trim() || 'cash';
            const currency = String((base as any)?.currency || r?.currency || '').trim() || undefined;
            const fxRate = Number((base as any)?.fxRate ?? r?.fx_rate ?? 0) || undefined;
            const baseTotal = Number((base as any)?.baseTotal ?? r?.base_total ?? 0) || undefined;
            const userId = String((base as any)?.userId || r?.customer_auth_user_id || '').trim() || undefined;
            return {
              ...base,
              id,
              userId,
              createdAt,
              status,
              total,
              paymentMethod,
              currency,
              fxRate,
              baseTotal,
              items: Array.isArray((base as any)?.items) ? (base as any).items : [],
              subtotal: Number((base as any)?.subtotal ?? 0) || 0,
              deliveryFee: Number((base as any)?.deliveryFee ?? 0) || 0,
              customerName: String((base as any)?.customerName ?? ''),
              phoneNumber: String((base as any)?.phoneNumber ?? ''),
              address: String((base as any)?.address ?? ''),
            } as Order;
          })
          .filter(Boolean) as Order[];
        orders.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        if (!cancelled) setCustomerOrders(orders);
      } catch (error) {
        if (!cancelled) {
          setCustomerOrders([]);
          setOrdersError((error as any)?.message ? String((error as any).message) : 'فشل تحميل طلبات العميل.');
        }
      } finally {
        if (!cancelled) setOrdersLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer?.id]);

  useEffect(() => {
    let cancelled = false;
    const loadCredit = async () => {
      if (!selectedCustomer) return;
      try {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { data } = await supabase.rpc('get_customer_credit_summary', { p_customer_id: selectedCustomer.id });
        const exists = Boolean((data as any)?.exists);
        if (!exists || cancelled) return;
        const limit = Number((data as any)?.credit_limit);
        const bal = Number((data as any)?.current_balance);
        setSelectedCustomer(prev => prev ? { ...prev, creditLimit: Number.isFinite(limit) ? limit : prev.creditLimit, currentBalance: Number.isFinite(bal) ? bal : prev.currentBalance } : prev);
      } catch {
      }
    };
    void loadCredit();
    return () => { cancelled = true; };
  }, [selectedCustomer?.id]);

  useEffect(() => {
    // Simple badge: show "غير مرتبط بالتطبيق" if customers.auth_user_id is null
    let cancelled = false;
    const probe = async () => {
      if (!selectedCustomer) {
        setIsSelectedCustomerAppLinked(true);
        return;
      }
      const supabase = getSupabaseClient();
      if (!supabase) {
        setIsSelectedCustomerAppLinked(true);
        return;
      }
      try {
        const phone = selectedCustomer.phoneNumber;
        if (!phone) {
          setIsSelectedCustomerAppLinked(Boolean(selectedCustomer.loginIdentifier || selectedCustomer.email));
          return;
        }
        const { data, error } = await supabase
          .from('customers')
          .select('auth_user_id')
          .eq('phone_number', phone)
          .limit(1)
          .maybeSingle();
        if (error) {
          setIsSelectedCustomerAppLinked(true);
          return;
        }
        const authId = (data as any)?.auth_user_id || null;
        if (!cancelled) setIsSelectedCustomerAppLinked(Boolean(authId));
      } catch {
        if (!cancelled) setIsSelectedCustomerAppLinked(true);
      }
    };
    void probe();
    return () => { cancelled = true; };
  }, [selectedCustomer?.phoneNumber, selectedCustomer?.id]);

  useEffect(() => {
    if (!selectedCustomer) return;
    const latest = customers.find(c => c.id === selectedCustomer.id);
    if (!latest) return;
    setSelectedCustomer(latest);
  }, [customers, selectedCustomer?.id]);

  const customerOrderStats = useMemo(() => {
    const count = customerOrders.length;
    const totalSpentBase = customerOrders.reduce((sum, o: any) => sum + (Number(o?.baseTotal) || 0), 0);
    const totalsByCurrency = customerOrders.reduce((acc: Record<string, number>, o: any) => {
      const c = String(o?.currency || '').toUpperCase() || '—';
      acc[c] = (acc[c] || 0) + (Number(o?.total) || 0);
      return acc;
    }, {});
    const lastOrderAt = customerOrders[0]?.createdAt || null;
    return { count, totalSpentBase, totalsByCurrency, lastOrderAt };
  }, [customerOrders]);

  const handleSaveCustomer = async () => {
    if (!selectedCustomer) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSavingCustomer(true);
    try {
      const pref = String(customerDraft.preferredCurrency || '').trim().toUpperCase();
      const next: Customer = {
        ...selectedCustomer,
        fullName: customerDraft.fullName.trim() ? customerDraft.fullName.trim() : undefined,
        phoneNumber: customerDraft.phoneNumber.trim() ? customerDraft.phoneNumber.trim() : undefined,
        loyaltyTier: customerDraft.loyaltyTier,
        firstOrderDiscountApplied: Boolean(customerDraft.firstOrderDiscountApplied),
        preferredCurrency: pref || undefined,
        customerType: customerDraft.customerType,
        paymentTerms: customerDraft.paymentTerms,
        creditLimit: typeof customerDraft.creditLimit === 'number' ? customerDraft.creditLimit : undefined,
      };
      const { error } = await supabase.from('customers').upsert({
        auth_user_id: next.id,
        full_name: next.fullName ?? null,
        phone_number: next.phoneNumber ?? null,
        email: next.email ?? null,
        auth_provider: next.authProvider,
        password_salt: next.passwordSalt ?? null,
        password_hash: next.passwordHash ?? null,
        referral_code: next.referralCode ?? null,
        referred_by: next.referredBy ?? null,
        loyalty_points: next.loyaltyPoints ?? 0,
        loyalty_tier: next.loyaltyTier ?? 'regular',
        total_spent: next.totalSpent ?? 0,
        first_order_discount_applied: Boolean(next.firstOrderDiscountApplied ?? false),
        avatar_url: next.avatarUrl ?? null,
        preferred_currency: next.preferredCurrency ?? null,
        customer_type: next.customerType ?? null,
        payment_terms: next.paymentTerms ?? null,
        credit_limit: typeof next.creditLimit === 'number' ? next.creditLimit : null,
        data: next,
      }, { onConflict: 'auth_user_id' });
      if (error) throw error;
      setSelectedCustomer(next);
      await fetchCustomers();
      showNotification('تم حفظ بيانات العميل.', 'success');
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error || '');
      showNotification((raw || 'فشل حفظ بيانات العميل.'), 'error');
    } finally {
      setSavingCustomer(false);
    }
  };

  const openOrdersInManageOrders = () => {
    if (!selectedCustomer) return;
    navigate('/admin/orders', { state: { customerId: selectedCustomer.id } });
  };

  const requestCancelOrder = (orderId: string) => {
    if (!canCancelOrders) return;
    setCancelOrderId(orderId);
    setIsCancellingOrder(false);
  };

  const confirmCancelOrder = async () => {
    if (!cancelOrderId) return;
    setIsCancellingOrder(true);
    try {
      await updateOrderStatus(cancelOrderId, 'cancelled');
      showNotification('تم إلغاء الطلب.', 'success');
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error || '');
      showNotification((raw || 'فشل إلغاء الطلب.'), 'error');
    } finally {
      setIsCancellingOrder(false);
      setCancelOrderId(null);
    }
  };

  const handleChangeOrderStatus = async (orderId: string, nextStatus: OrderStatus) => {
    try {
      await updateOrderStatus(orderId, nextStatus);
      showNotification('تم تحديث حالة الطلب.', 'success');
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error || '');
      showNotification((raw || 'فشل تحديث حالة الطلب.'), 'error');
    }
  };

  const handleMarkPaid = async (orderId: string) => {
    if (!canMarkPaid) return;
    try {
      await markOrderPaid(orderId);
      showNotification('تم تأكيد الدفع.', 'success');
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error || '');
      showNotification((raw || 'فشل تأكيد الدفع.'), 'error');
    }
  };

  const requestDeleteCustomer = (customerId: string) => {
    if (!canDeleteCustomer) return;
    setDeleteCustomerId(customerId);
    setIsDeletingCustomer(false);
  };

  const confirmDeleteCustomer = async () => {
    if (!deleteCustomerId) return;
    setIsDeletingCustomer(true);
    try {
      const ok = await deleteCustomer(deleteCustomerId);
      if (ok) {
        await fetchCustomers();
        showNotification('تم حذف بيانات العميل من قاعدة البيانات.', 'success');
        if (selectedCustomer?.id === deleteCustomerId) {
          closeCustomerDetails();
        }
      } else {
        showNotification('فشل حذف العميل.', 'error');
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error || '');
      showNotification((raw || 'فشل حذف العميل.'), 'error');
    } finally {
      setIsDeletingCustomer(false);
      setDeleteCustomerId(null);
    }
  };

  const renderAvatarFallback = (customer: Customer) => {
    const name = (customer.fullName || customer.loginIdentifier || '').trim();
    const initial = name ? name.slice(0, 1).toUpperCase() : '?';
    return (
      <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-700 dark:text-gray-200 font-bold">
        {initial}
      </div>
    );
  };

  return (
    <>
      <div className="animate-fade-in">
        <h1 className="text-3xl font-bold dark:text-white mb-6">إدارة العملاء</h1>
        <div className="mb-4">
          {canManageCustomers && (
            <button
              type="button"
              onClick={() => setNewCustomerModalOpen(true)}
              className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
            >
              ➕ إضافة عميل
            </button>
          )}
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">العميل</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">وسيلة التسجيل</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">رصيد نقاط الولاء</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {loading ? (
                   <tr>
                    <td colSpan={4} className="text-center py-16">
                       <div className="flex justify-center items-center space-x-2 rtl:space-x-reverse text-gray-500 dark:text-gray-400">
                          <Spinner /> 
                          <span>جاري تحميل العملاء...</span>
                       </div>
                    </td>
                  </tr>
                ) : visibleCustomers.length > 0 ? (
                  visibleCustomers.map((customer: Customer) => (
                    <tr key={customer.id} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40" onClick={() => openCustomerDetails(customer)}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10">
                            {customer.avatarUrl ? (
                              <img className="h-10 w-10 rounded-full object-cover" src={customer.avatarUrl} alt={customer.fullName || 'Customer'} />
                            ) : (
                              renderAvatarFallback(customer)
                            )}
                          </div>
                          <div className="mx-4">
                            <div className="text-sm font-medium text-gray-900 dark:text-white">{customer.fullName}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">{customer.loginIdentifier || customer.phoneNumber || customer.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              customer.authProvider === 'phone'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
                              : customer.authProvider === 'google'
                                ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                                : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                          }`}>
                              {customer.authProvider === 'phone' ? 'رقم الهاتف' : (customer.authProvider === 'google' ? 'جوجل' : 'كلمة مرور')}
                          </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-gray-900 dark:text-white font-bold">
                          <StarIcon />
                          <span className="mx-2">{customer.loyaltyPoints}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOpenPointsModal(customer); }}
                          className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-200 p-1 font-semibold text-xs border border-indigo-500 rounded-md px-2 py-1 hover:bg-indigo-50 dark:hover:bg-indigo-900/40"
                        >
                          إدارة النقاط
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="text-center py-16 text-gray-500 dark:text-gray-400">
                      <p className="font-semibold text-lg">لا يوجد عملاء مسجلون بعد</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      {editingCustomer && (
        <ManagePointsModal 
          isOpen={!!editingCustomer}
          onClose={handleClosePointsModal}
          customer={editingCustomer}
        />
      )}

      {newCustomerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setNewCustomerModalOpen(false)} />
          <div className="relative w-full max-w-xl bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div className="text-lg font-bold text-gray-900 dark:text-white">إضافة عميل</div>
              <button onClick={() => setNewCustomerModalOpen(false)} className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                إغلاق
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">الاسم</label>
                <input
                  type="text"
                  value={newCustomerDraft.fullName}
                  onChange={(e) => setNewCustomerDraft(prev => ({ ...prev, fullName: e.target.value }))}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">رقم الهاتف (فريد)</label>
                <input
                  type="text"
                  value={newCustomerDraft.phone}
                  onChange={(e) => setNewCustomerDraft(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">نوع العميل</label>
                <select
                  value={newCustomerDraft.customerType}
                  onChange={(e) => setNewCustomerDraft(prev => ({ ...prev, customerType: e.target.value === 'wholesale' ? 'wholesale' : 'retail' }))}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                >
                  <option value="retail">Retail</option>
                  <option value="wholesale">Wholesale</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">حد ائتماني (اختياري)</label>
                <input
                  type="number"
                  value={typeof newCustomerDraft.creditLimit === 'number' ? newCustomerDraft.creditLimit : ''}
                  onChange={(e) => setNewCustomerDraft(prev => ({ ...prev, creditLimit: e.target.value ? parseFloat(e.target.value) : undefined }))}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">ملاحظات</label>
                <textarea
                  rows={3}
                  value={newCustomerDraft.notes || ''}
                  onChange={(e) => setNewCustomerDraft(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                />
              </div>
              <div className="pt-3 mt-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={async () => {
                    const supabase = getSupabaseClient();
                    if (!supabase) {
                      showNotification('تعذر الوصول للخادم.', 'error');
                      return;
                    }

                    const extractFunctionMessage = async (err: unknown): Promise<string | null> => {
                      const maybeContext = (err as { context?: { text?: () => Promise<string>; json?: () => Promise<any> } })?.context;
                      if (!maybeContext) return null;

                      const tryParse = (text: string) => {
                        const trimmed = text.trim();
                        if (!trimmed) return null;
                        try {
                          const parsed = JSON.parse(trimmed);
                          const parsedError = parsed?.error;
                          const parsedMessage = parsed?.message;
                          const parsedDetails = parsed?.details;
                          if (typeof parsedError === 'string' && typeof parsedDetails === 'string') {
                            if (parsedError === 'insert_failed') return parsedDetails;
                            if (parsedError === 'create_auth_user_failed') return parsedDetails;
                            if (parsedError === 'duplicate_check_failed') return parsedDetails;
                          }
                          if (typeof parsedMessage === 'string') return parsedMessage;
                          if (typeof parsedError === 'string') return parsedError;
                          if (typeof parsedDetails === 'string') return parsedDetails;
                          return trimmed;
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
                          const bodyError = body?.error;
                          const bodyMessage = body?.message;
                          const bodyDetails = body?.details;
                          if (typeof bodyError === 'string' && typeof bodyDetails === 'string') {
                            if (bodyError === 'insert_failed') return bodyDetails;
                            if (bodyError === 'create_auth_user_failed') return bodyDetails;
                            if (bodyError === 'duplicate_check_failed') return bodyDetails;
                          }
                          if (typeof bodyMessage === 'string') return bodyMessage;
                          if (typeof bodyError === 'string') return bodyError;
                          if (typeof bodyDetails === 'string') return bodyDetails;
                          return JSON.stringify(body);
                        } catch {
                        }
                      }

                      return null;
                    };

                    const localizeCreateCustomerError = (rawMessage: string) => {
                      const raw = String(rawMessage || '').trim();
                      if (!raw) return 'فشل إنشاء العميل.';
                      const normalized = raw.toLowerCase();
                      if (normalized.includes('duplicate_phone') || (normalized.includes('duplicate') && normalized.includes('phone'))) {
                        return 'رقم الهاتف مستخدم مسبقاً.';
                      }
                      if (normalized.includes('missing_function_env')) {
                        return 'إعدادات الخادم ناقصة لإنشاء العملاء.';
                      }
                      if (normalized.includes('503') || normalized.includes('service temporarily unavailable')) {
                        return 'خدمة إنشاء العملاء غير متاحة حالياً. شغّل Supabase Edge Functions (npm run supabase:functions) أو استخدم npm run dev:local.';
                      }
                      if (normalized.includes('name resolution failed')) {
                        return 'تعذر الوصول لخدمة إنشاء العملاء. غالباً Edge Runtime غير شغال محلياً (Docker/Functions Serve). شغّل: npm run supabase:functions';
                      }
                      if (normalized.includes('encryption key not configured')) {
                        return 'مفتاح تشفير بيانات العملاء غير مضبوط على الخادم.';
                      }
                      if (normalized.includes('forbidden') || normalized.includes('permission') || normalized.includes('not allowed')) {
                        return 'ليس لديك صلاحية إنشاء العملاء.';
                      }
                      if (normalized.includes('insert_failed')) {
                        return 'فشل حفظ بيانات العميل في قاعدة البيانات.';
                      }
                      if (/[\u0600-\u06FF]/.test(raw)) return raw;
                      return `فشل إنشاء العميل: ${raw}`;
                    };

                    const fullName = newCustomerDraft.fullName.trim();
                    const phone = newCustomerDraft.phone.trim();
                    const customerType = newCustomerDraft.customerType === 'wholesale' ? 'wholesale' : 'retail';
                    const creditLimit = typeof newCustomerDraft.creditLimit === 'number' ? newCustomerDraft.creditLimit : null;
                    const notes = (newCustomerDraft.notes || '').trim();
                    if (!phone) {
                      showNotification('رقم الهاتف مطلوب.', 'error');
                      return;
                    }
                    try {
                      const { error } = await (supabase as any).functions.invoke('create-admin-customer', {
                        body: { fullName, phone, customerType, creditLimit, notes },
                      });
                      if (error) {
                        const fromContext = await extractFunctionMessage(error);
                        const msg = fromContext || (error as any)?.message || String(error);
                        showNotification(localizeCreateCustomerError(msg), 'error');
                        return;
                      }
                      showNotification('تم إنشاء العميل بنجاح.', 'success');
                      setNewCustomerModalOpen(false);
                      setNewCustomerDraft({ fullName: '', phone: '', customerType: 'retail', creditLimit: undefined, notes: '' });
                    } catch (err) {
                      const fromContext = await extractFunctionMessage(err);
                      const raw = fromContext || (err instanceof Error ? err.message : String(err || ''));
                      showNotification(localizeCreateCustomerError(raw), 'error');
                    }
                  }}
                  className="px-4 py-2 rounded-md bg-gray-800 text-white text-sm font-semibold"
                >
                  حفظ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={closeCustomerDetails} />
          <div className="relative w-full max-w-5xl bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12">
                  {selectedCustomer.avatarUrl ? (
                    <img className="h-12 w-12 rounded-full object-cover" src={selectedCustomer.avatarUrl} alt={selectedCustomer.fullName || 'Customer'} />
                  ) : (
                    <div className="h-12 w-12">{renderAvatarFallback(selectedCustomer)}</div>
                  )}
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white">{selectedCustomer.fullName || 'عميل'}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">{selectedCustomer.id}</div>
                        {!isSelectedCustomerAppLinked && (
                          <div className="mt-1">
                            <span className="px-2 py-1 rounded-full text-[11px] font-semibold bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                              غير مرتبط بالتطبيق
                            </span>
                          </div>
                        )}
                </div>
              </div>
              <button onClick={closeCustomerDetails} className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                إغلاق
              </button>
            </div>

            <div className="px-6 pt-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDetailsTab('overview')}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold ${detailsTab === 'overview' ? 'bg-primary-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'}`}
                >
                  نظرة عامة
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsTab('orders')}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold ${detailsTab === 'orders' ? 'bg-primary-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'}`}
                >
                  الطلبات
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsTab('actions')}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold ${detailsTab === 'actions' ? 'bg-primary-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'}`}
                >
                  الإدارة
                </button>
              </div>
            </div>

            <div className="p-6 max-h-[75vh] overflow-auto">
              {detailsTab === 'overview' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-5">
                    <div className="text-sm font-bold text-gray-900 dark:text-white mb-4">معلومات العميل</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="text-gray-700 dark:text-gray-200">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">اسم المستخدم</div>
                        <div className="font-mono">{selectedCustomer.loginIdentifier || '-'}</div>
                      </div>
                      <div className="text-gray-700 dark:text-gray-200">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">رقم الهاتف</div>
                        <div className="font-mono">{selectedCustomer.phoneNumber || '-'}</div>
                      </div>
                      <div className="text-gray-700 dark:text-gray-200">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">البريد</div>
                        <div className="font-mono">{selectedCustomer.email || '-'}</div>
                      </div>
                      <div className="text-gray-700 dark:text-gray-200">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">وسيلة التسجيل</div>
                        <div>{selectedCustomer.authProvider === 'phone' ? 'رقم الهاتف' : (selectedCustomer.authProvider === 'google' ? 'جوجل' : 'كلمة مرور')}</div>
                      </div>
                      <div className="text-gray-700 dark:text-gray-200">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">نقاط الولاء</div>
                        <div className="flex items-center font-bold">
                          <StarIcon />
                          <span className="mx-2">{selectedCustomer.loyaltyPoints}</span>
                        </div>
                      </div>
                      <div className="text-gray-700 dark:text-gray-200">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">المستوى</div>
                        <div>{selectedCustomer.loyaltyTier}</div>
                      </div>
                      <div className="text-gray-700 dark:text-gray-200">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">إجمالي المصروف</div>
                        <CurrencyDualAmount amount={Number(selectedCustomer.totalSpent || 0)} currencyCode={baseCode} compact />
                      </div>
                      <div className="text-gray-700 dark:text-gray-200">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">العملة المفضلة</div>
                        <div className="font-mono">{String((selectedCustomer as any).preferredCurrency || '') || '-'}</div>
                      </div>
                      <div className="text-gray-700 dark:text-gray-200">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">كود الدعوة</div>
                        <div className="font-mono">{selectedCustomer.referralCode || '-'}</div>
                      </div>
                      <div className="text-gray-700 dark:text-gray-200">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">أُحيل بواسطة</div>
                        <div className="font-mono">{selectedCustomer.referredBy || '-'}</div>
                      </div>
                      <div className="text-gray-700 dark:text-gray-200">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">خصم أول طلب</div>
                        <div>{selectedCustomer.firstOrderDiscountApplied ? 'تم تطبيقه' : 'لم يتم تطبيقه'}</div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {canViewOrders && (
                        <button
                          type="button"
                          onClick={openOrdersInManageOrders}
                          className="px-4 py-2 rounded-lg bg-gray-900 text-white font-semibold"
                        >
                          عرض طلبات العميل في شاشة الطلبات
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-5">
                    <div className="text-sm font-bold text-gray-900 dark:text-white mb-4">ملخص الطلبات</div>
                    {ordersLoading ? (
                      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-300">
                        <Spinner />
                        <span>جاري تحميل الطلبات...</span>
                      </div>
                    ) : ordersError ? (
                      <div className="text-red-600 dark:text-red-300 text-sm">{ordersError}</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">عدد الطلبات</div>
                          <div className="text-xl font-bold text-gray-900 dark:text-white">{customerOrderStats.count}</div>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">إجمالي الطلبات (بالأساس)</div>
                          <div className="text-gray-900 dark:text-white">
                            <CurrencyDualAmount amount={Number(customerOrderStats.totalSpentBase || 0)} currencyCode={baseCode} />
                          </div>
                          <div className="mt-2 text-xs text-gray-600 dark:text-gray-300 space-y-1">
                            {Object.entries(customerOrderStats.totalsByCurrency || {}).map(([c, amt]) => (
                              <div key={c} className="flex items-center justify-between gap-2" dir="ltr">
                                <span className="font-mono">{c}</span>
                                <CurrencyDualAmount amount={Number(amt || 0)} currencyCode={c} compact />
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">آخر طلب</div>
                          <div className="text-sm font-mono text-gray-900 dark:text-white">{customerOrderStats.lastOrderAt || '-'}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {detailsTab === 'orders' && (
                <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-sm font-bold text-gray-900 dark:text-white">طلبات العميل</div>
                    <div className="text-xs text-gray-500 dark:text-gray-300">آخر 30 طلب</div>
                  </div>
                  {ordersLoading ? (
                    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-300">
                      <Spinner />
                      <span>جاري تحميل الطلبات...</span>
                    </div>
                  ) : ordersError ? (
                    <div className="text-red-600 dark:text-red-300 text-sm">{ordersError}</div>
                  ) : customerOrders.length === 0 ? (
                    <div className="text-gray-600 dark:text-gray-300 text-sm">لا توجد طلبات لهذا العميل.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
                        <thead className="bg-white dark:bg-gray-800">
                          <tr>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">رقم</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">التاريخ</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الحالة</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الإجمالي</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">الدفع</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">إدارة</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                          {customerOrders.slice(0, 30).map((order, idx) => (
                            <tr key={(order as any)?.id || `row-${idx}`}>
                              <td className="px-4 py-3 text-sm font-mono text-gray-800 dark:text-gray-200">{String((order as any)?.id || '').slice(0, 8) || '-'}</td>
                              <td className="px-4 py-3 text-sm font-mono text-gray-700 dark:text-gray-300">{order.createdAt || '-'}</td>
                              <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                                {canUpdateAllStatuses || canUpdateDeliveryStatuses ? (
                                  <select
                                    value={order.status}
                                    onChange={(e) => handleChangeOrderStatus(order.id, e.target.value as OrderStatus)}
                                    className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-sm"
                                  >
                                    {(['pending', 'preparing', 'out_for_delivery', 'delivered', 'scheduled'] as OrderStatus[]).map((s) => (
                                      <option key={s} value={s} disabled={!canUpdateAllStatuses && (s !== 'out_for_delivery' && s !== 'delivered')}>
                                        {statusTranslations[s]}
                                      </option>
                                    ))}
                                    {canCancelOrders && <option value="cancelled">ملغي</option>}
                                  </select>
                                ) : (
                                  order.status
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-800 dark:text-gray-200">
                                <CurrencyDualAmount
                                  amount={Number(order.total || 0)}
                                  currencyCode={(order as any).currency}
                                  baseAmount={(order as any).baseTotal}
                                  fxRate={(order as any).fxRate}
                                  compact
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                                <div className="flex flex-col gap-1">
                                  <div>{order.paymentMethod}</div>
                                  {order.paidAt ? (
                                    <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">مدفوع</div>
                                  ) : (
                                    <div className="text-xs text-gray-500 dark:text-gray-400">غير مدفوع</div>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                                  <div className="flex flex-wrap gap-2">
                                  {canMarkPaid && !order.paidAt && order.status !== 'cancelled' && (
                                    <button
                                      type="button"
                                      onClick={() => handleMarkPaid(order.id)}
                                      className="px-3 py-1 rounded-md bg-emerald-600 text-white text-xs font-semibold"
                                    >
                                      تأكيد الدفع
                                    </button>
                                  )}
                                  {canViewInvoice && order.status === 'delivered' && order.paidAt && !order.invoiceIssuedAt && (
                                    <button
                                      type="button"
                                      onClick={() => navigate(`/admin/invoice/${order.id}`)}
                                      className="px-3 py-1 rounded-md bg-blue-600 text-white text-xs font-semibold"
                                    >
                                      إصدار الآن
                                    </button>
                                  )}
                                  {canViewInvoice && order.invoiceIssuedAt ? (
                                    <button
                                      type="button"
                                      onClick={() => navigate(`/admin/invoice/${order.id}`)}
                                      className="px-3 py-1 rounded-md bg-blue-600 text-white text-xs font-semibold"
                                    >
                                      الفاتورة
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled
                                      className="px-3 py-1 rounded-md bg-gray-300 text-gray-600 text-xs font-semibold cursor-not-allowed"
                                    >
                                      الفاتورة
                                    </button>
                                  )}
                                    {canCancelOrders && order.status !== 'cancelled' && order.status !== 'delivered' && (
                                      <button
                                        type="button"
                                        onClick={() => requestCancelOrder(order.id)}
                                        className="px-3 py-1 rounded-md bg-red-600 text-white text-xs font-semibold"
                                      >
                                        إلغاء
                                      </button>
                                    )}
                                  </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {detailsTab === 'actions' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-5">
                    <div className="text-sm font-bold text-gray-900 dark:text-white mb-4">تعديل بيانات العميل</div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">اسم العميل</label>
                        <input
                          type="text"
                          value={customerDraft.fullName}
                          onChange={(e) => setCustomerDraft(prev => ({ ...prev, fullName: e.target.value }))}
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">رقم الهاتف</label>
                        <input
                          type="text"
                          value={customerDraft.phoneNumber}
                          onChange={(e) => setCustomerDraft(prev => ({ ...prev, phoneNumber: e.target.value }))}
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">المستوى</label>
                        <select
                          value={customerDraft.loyaltyTier}
                          onChange={(e) => setCustomerDraft(prev => ({ ...prev, loyaltyTier: e.target.value as Customer['loyaltyTier'] }))}
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                        >
                          <option value="regular">regular</option>
                          <option value="bronze">bronze</option>
                          <option value="silver">silver</option>
                          <option value="gold">gold</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">العملة المفضلة</label>
                        <select
                          value={String(customerDraft.preferredCurrency || '').toUpperCase()}
                          onChange={(e) => setCustomerDraft(prev => ({ ...prev, preferredCurrency: String(e.target.value || '').toUpperCase() }))}
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                        >
                          <option value="">—</option>
                          {currencyOptions.map((c) => (
                            <option key={c} value={c}>{c}{baseCode && c === baseCode ? ' (أساسية)' : ''}</option>
                          ))}
                        </select>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                        <input
                          type="checkbox"
                          checked={customerDraft.firstOrderDiscountApplied}
                          onChange={(e) => setCustomerDraft(prev => ({ ...prev, firstOrderDiscountApplied: e.target.checked }))}
                          className="form-checkbox h-4 w-4 text-primary-600 rounded focus:ring-gold-500"
                        />
                        تم تطبيق خصم أول طلب
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleSaveCustomer}
                          disabled={savingCustomer}
                          className="px-4 py-2 rounded-lg bg-primary-500 text-white font-semibold disabled:bg-gray-400"
                        >
                          {savingCustomer ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenPointsModal(selectedCustomer)}
                          className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold"
                        >
                          إدارة النقاط
                        </button>
                        {canDeleteCustomer && (
                          <button
                            type="button"
                            onClick={() => requestDeleteCustomer(selectedCustomer.id)}
                            className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold"
                          >
                            حذف العميل
                          </button>
                        )}
                        {!isSelectedCustomerAppLinked && canManageCustomers && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const supabase = getSupabaseClient();
                                if (!supabase) {
                                  showNotification('تعذر الوصول للخادم.', 'error');
                                  return;
                                }
                                const fullName = customerDraft.fullName.trim() || selectedCustomer.fullName || '';
                                const phone = customerDraft.phoneNumber.trim();
                                const creditLimit = typeof customerDraft.creditLimit === 'number' ? customerDraft.creditLimit : undefined;
                                const { data, error } = await (supabase as any).functions.invoke('convert-party-to-customer', {
                                  body: { partyId: selectedCustomer.id, fullName, phone, customerType: 'wholesale', creditLimit }
                                });
                                if (error) {
                                  const msg = (error as any)?.message || String(error);
                                  showNotification(`فشل تحويل الطرف إلى عميل: ${msg}`, 'error');
                                  return;
                                }
                                showNotification('تم تحويل الطرف إلى عميل بنجاح.', 'success');
                                await fetchCustomers();
                                try {
                                  const authId = String((data as any)?.customer?.auth_user_id || '');
                                  const next = (customers || []).find(c => c.id === authId);
                                  if (next) setSelectedCustomer(next);
                                } catch {}
                                setIsSelectedCustomerAppLinked(true);
                              } catch (err) {
                                const raw = err instanceof Error ? err.message : String(err || '');
                                showNotification((raw || 'فشل تحويل الطرف إلى عميل.'), 'error');
                              }
                            }}
                            className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold"
                          >
                            تحويل إلى عميل
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-5">
                    <div className="text-sm font-bold text-gray-900 dark:text-white mb-4">ملاحظات</div>
                    <div className="text-sm text-gray-700 dark:text-gray-300 space-y-2">
                      <div>العناوين داخل الطلبات مشفرة على جهاز العميل، لذلك قد لا تظهر نصاً واضحاً هنا.</div>
                      <div>يمكنك إدارة نقاط الولاء من زر إدارة النقاط.</div>
                    </div>
                  </div>
                  
                  <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-5">
                    <div className="text-sm font-bold text-gray-900 dark:text-white mb-4">الائتمان</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">نوع العميل</label>
                        <select
                          value={String(customerDraft.customerType || (selectedCustomer.customerType || 'retail'))}
                          onChange={(e) => setCustomerDraft(prev => ({ ...prev, customerType: e.target.value as any }))}
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                        >
                          <option value="retail">retail</option>
                          <option value="wholesale">wholesale</option>
                          <option value="distributor">distributor</option>
                          <option value="vip">vip</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">شروط الدفع</label>
                        <select
                          value={String(customerDraft.paymentTerms || (selectedCustomer.paymentTerms || 'cash'))}
                          onChange={(e) => setCustomerDraft(prev => ({ ...prev, paymentTerms: e.target.value as any }))}
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                        >
                          <option value="cash">cash</option>
                          <option value="net_15">net_15</option>
                          <option value="net_30">net_30</option>
                          <option value="net_45">net_45</option>
                          <option value="net_60">net_60</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">حد الائتمان</label>
                        <input
                          type="number"
                          value={typeof customerDraft.creditLimit === 'number' ? customerDraft.creditLimit : (typeof selectedCustomer.creditLimit === 'number' ? selectedCustomer.creditLimit : 0)}
                          onChange={(e) => setCustomerDraft(prev => ({ ...prev, creditLimit: parseFloat(e.target.value || '0') }))}
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">الرصيد الحالي</label>
                        <div className="font-mono text-sm text-gray-900 dark:text-white">{typeof selectedCustomer.currentBalance === 'number' ? selectedCustomer.currentBalance : '-'}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={Boolean(cancelOrderId)}
        onClose={() => setCancelOrderId(null)}
        onConfirm={confirmCancelOrder}
        title="تأكيد إلغاء الطلب"
        message="هل أنت متأكد من إلغاء هذا الطلب؟"
        isConfirming={isCancellingOrder}
        cancelText="تراجع"
        confirmText="إلغاء الطلب"
        confirmingText="جاري الإلغاء..."
      />

      <ConfirmationModal
        isOpen={Boolean(deleteCustomerId)}
        onClose={() => setDeleteCustomerId(null)}
        onConfirm={confirmDeleteCustomer}
        title="حذف العميل"
        message="سيتم حذف بيانات العميل من جدول العملاء فقط. لن يتم حذف حساب Supabase Auth أو طلباته. هل تريد المتابعة؟"
        isConfirming={isDeletingCustomer}
        cancelText="تراجع"
        confirmText="حذف"
        confirmingText="جاري الحذف..."
      />
    </>
  );
};

export default ManageCustomersScreen;
