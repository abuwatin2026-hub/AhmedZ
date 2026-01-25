import React, { useState, useEffect, useMemo } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { useToast } from '../../contexts/ToastContext';
import { AppSettings, LoyaltyTier, Bank, TransferRecipient } from '../../types';
import { getSupabaseClient } from '../../supabase';
import NumberInput from '../../components/NumberInput';
import { useMenu } from '../../contexts/MenuContext';
import { useDeliveryZones } from '../../contexts/DeliveryZoneContext';
import { useItemMeta } from '../../contexts/ItemMetaContext';
import { usePurchases } from '../../contexts/PurchasesContext';
import { useWarehouses } from '../../contexts/WarehouseContext';
import { usePromotions } from '../../contexts/PromotionContext';
import { useCoupons } from '../../contexts/CouponContext';
import { useAds } from '../../contexts/AdContext';
import { useCashShift } from '../../contexts/CashShiftContext';
import { usePricing } from '../../contexts/PricingContext';
import { useAuth } from '../../contexts/AuthContext';
import * as Icons from '../../components/icons';
import { Link } from 'react-router-dom';

const SettingsScreen: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { showNotification } = useToast();
  const [formState, setFormState] = useState<AppSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [isMaintenanceSaving, setIsMaintenanceSaving] = useState(false);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [isBankFormOpen, setIsBankFormOpen] = useState(false);
  const [isBankSaving, setIsBankSaving] = useState(false);
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [bankForm, setBankForm] = useState({
    name: '',
    accountName: '',
    accountNumber: '',
    isActive: true,
  });
  const [transferRecipients, setTransferRecipients] = useState<TransferRecipient[]>([]);
  const [isTransferRecipientFormOpen, setIsTransferRecipientFormOpen] = useState(false);
  const [isTransferRecipientSaving, setIsTransferRecipientSaving] = useState(false);
  const [editingTransferRecipientId, setEditingTransferRecipientId] = useState<string | null>(null);
  const [transferRecipientForm, setTransferRecipientForm] = useState({
    name: '',
    phoneNumber: '',
    isActive: true,
  });
  const [accounts, setAccounts] = useState<any[]>([]);
  const accountingLabels: Record<string, string> = {
    sales: 'مبيعات',
    sales_returns: 'مرتجعات المبيعات',
    inventory: 'المخزون',
    cogs: 'تكلفة البضاعة المباعة',
    ar: 'الذمم المدينة',
    ap: 'الذمم الدائنة',
    vat_payable: 'ضريبة القيمة المضافة المستحقة',
    vat_recoverable: 'ضريبة القيمة المضافة المستردة',
    cash: 'النقدية',
    bank: 'البنك',
    deposits: 'الودائع',
    expenses: 'المصروفات',
    shrinkage: 'نقص المخزون',
    gain: 'أرباح',
    delivery_income: 'إيرادات التوصيل',
    sales_discounts: 'خصومات المبيعات',
    over_short: 'زيادة/نقص الصندوق',
  };

  useEffect(() => {
    const fetchAccounts = async () => {
        const supabase = getSupabaseClient();
        if(!supabase) return;
        const { data } = await supabase.from('chart_of_accounts').select('*').eq('is_active', true);
        if(data) setAccounts(data);
    };
    fetchAccounts();
  }, []);


  useEffect(() => {
    setFormState(settings);
  }, [settings]);

  const { menuItems } = useMenu();
  const { deliveryZones } = useDeliveryZones();
  const { categories, unitTypes } = useItemMeta();
  const { suppliers } = usePurchases();
  const { warehouses } = useWarehouses();
  const { adminPromotions } = usePromotions();
  const { coupons } = useCoupons();
  const { ads } = useAds();
  const { currentShift } = useCashShift();
  const { priceTiers, specialPrices } = usePricing();
  const { hasPermission } = useAuth();

  const checklist = useMemo(() => {
    const nameOk = Boolean((settings.cafeteriaName?.ar || settings.cafeteriaName?.en || '').trim());
    const contactOk = Boolean((settings.contactNumber || '').trim());
    const addressOk = Boolean((settings.address || '').trim());
    const storeBasicsOk = nameOk && contactOk && addressOk;

    const anyPaymentEnabled = Boolean(settings.paymentMethods.cash || settings.paymentMethods.kuraimi || settings.paymentMethods.network);
    const kuraimiOk = !settings.paymentMethods.kuraimi || (banks.length > 0);
    const networkOk = !settings.paymentMethods.network || (transferRecipients.length > 0);
    const paymentsOk = anyPaymentEnabled && kuraimiOk && networkOk;
    const paymentsDetail = paymentsOk
      ? 'مكتمل'
      : (!anyPaymentEnabled
          ? 'فعّل طريقة دفع'
          : (!kuraimiOk
              ? 'أضف بنك للكريمي'
              : !networkOk
                ? 'أضف مستلماً للشبكة'
                : ''));

    const zonesActiveCount = deliveryZones.filter(z => z.isActive).length;
    const zonesOk = zonesActiveCount > 0;

    const metaOk = (categories.length > 0) && (unitTypes.length > 0);
    const suppliersOk = suppliers.length > 0;
    const itemsOk = menuItems.length > 0;
    const warehousesOk = warehouses.length > 0;

    const accountingRequiredKeys = ['sales', 'inventory', 'cogs', 'cash'];
    const accountingConfigured = accountingRequiredKeys.every(k => Boolean((settings.accounting_accounts as any)?.[k]));
    const loyaltyEnabled = Boolean(settings.loyaltySettings.enabled);
    const loyaltyConfigured = !loyaltyEnabled || (
      Number(settings.loyaltySettings.pointsPerCurrencyUnit) > 0 &&
      Number(settings.loyaltySettings.currencyValuePerPoint) > 0
    );
    const promotionsOk = adminPromotions.some(p => Boolean(p.isActive));
    const couponsOk = coupons.length > 0;
    const adsOk = ads.length > 0;
    const posFlags = settings.posFlags || { barcodeScanEnabled: false, autoPrintThermalEnabled: false, thermalCopies: 0 };
    const posReady = Boolean(posFlags.barcodeScanEnabled) && Boolean(posFlags.autoPrintThermalEnabled) && Number(posFlags.thermalCopies) >= 1 && Boolean(currentShift) && hasPermission('orders.createInStore');
    const posDetail = `باركود: ${posFlags.barcodeScanEnabled ? 'مفعل' : 'غير مفعل'}، طباعة: ${posFlags.autoPrintThermalEnabled ? 'مفعّلة' : 'غير مفعّلة'}، نسخ: ${Number(posFlags.thermalCopies) || 0}، وردية: ${currentShift ? 'مفتوحة' : 'غير مفتوحة'}، صلاحية البيع الحضوري: ${hasPermission('orders.createInStore') ? 'موجودة' : 'غير موجودة'}`;
    const taxEnabled = Boolean(settings.taxSettings?.enabled);
    const vatOk = !taxEnabled || (Number(settings.taxSettings?.rate) > 0 && Boolean(settings.taxSettings?.taxNumber));
    const vatDetail = vatOk ? 'مكتمل' : 'أكمل نسبة الضريبة والرقم الضريبي';
    const maintenanceOk = !Boolean(settings.maintenanceEnabled);
    const advPricingOk = (priceTiers.length > 0) || (specialPrices.length > 0);
    const approvalsOk = hasPermission('approvals.manage');
    const accountingViewOk = hasPermission('accounting.view');

    return [
      {
        key: 'store',
        ok: storeBasicsOk,
        title: 'بيانات المتجر الأساسية',
        detail: storeBasicsOk ? 'مكتمل' : 'اسم/رقم تواصل/عنوان مطلوبة',
        actionText: 'فتح البيانات',
        to: '/admin/settings',
      },
      {
        key: 'payments',
        ok: paymentsOk,
        title: 'طرق الدفع',
        detail: paymentsDetail,
        actionText: 'إدارة الدفع',
        to: '/admin/settings',
      },
      {
        key: 'zones',
        ok: zonesOk,
        title: 'مناطق التوصيل',
        detail: zonesOk ? 'مكتمل' : 'أضف منطقة توصيل فعّالة',
        actionText: 'إدارة المناطق',
        to: '/admin/delivery-zones',
      },
      {
        key: 'meta',
        ok: metaOk,
        title: 'إعدادات الميتا (فئات/وحدات)',
        detail: metaOk ? 'مكتمل' : 'أضف فئات ووحدات قياس',
        actionText: 'إدارة الأصناف',
        to: '/admin/items',
      },
      {
        key: 'suppliers',
        ok: suppliersOk,
        title: 'الموردون',
        detail: suppliersOk ? 'مكتمل' : 'أضف موردًا واحدًا على الأقل',
        actionText: 'إدارة الموردين',
        to: '/admin/suppliers',
      },
      {
        key: 'warehouses',
        ok: warehousesOk,
        title: 'المستودعات',
        detail: warehousesOk ? 'مكتمل' : 'أضف مستودعًا واحدًا على الأقل',
        actionText: 'إدارة المستودعات',
        to: '/admin/warehouses',
      },
      {
        key: 'items',
        ok: itemsOk,
        title: 'الأصناف للبيع',
        detail: itemsOk ? 'مكتمل' : 'أضف صنفًا واحدًا على الأقل',
        actionText: 'إدارة الأصناف',
        to: '/admin/items',
      },
      {
        key: 'accounting',
        ok: accountingConfigured,
        title: 'إعداد الحسابات المحاسبية',
        detail: accountingConfigured ? 'مكتمل' : 'عيّن حسابات رئيسية (مبيعات/مخزون/COGS/نقدية)',
        actionText: 'إعداد الحسابات',
        to: '/admin/settings',
      },
      {
        key: 'loyalty',
        ok: loyaltyConfigured,
        title: 'برنامج الولاء',
        detail: loyaltyConfigured ? 'مكتمل' : 'أكمل إعداد النقاط وقيمة النقطة',
        actionText: 'إعدادات الولاء',
        to: '/admin/settings',
      },
      {
        key: 'promotions',
        ok: promotionsOk,
        title: 'العروض الترويجية',
        detail: promotionsOk ? 'مكتمل' : 'أضف عرضًا أو فعّل عرضًا',
        actionText: 'إدارة العروض',
        to: '/admin/promotions',
      },
      {
        key: 'coupons',
        ok: couponsOk,
        title: 'الكوبونات',
        detail: couponsOk ? 'مكتمل' : 'أضف كوبون خصم',
        actionText: 'إدارة الكوبونات',
        to: '/admin/coupons',
      },
      {
        key: 'ads',
        ok: adsOk,
        title: 'الإعلانات',
        detail: adsOk ? 'مكتمل' : 'أضف إعلانًا نشطًا لشريط العروض',
        actionText: 'إدارة الإعلانات',
        to: '/admin/ads',
      },
      {
        key: 'vat',
        ok: vatOk,
        title: 'الضريبة (VAT)',
        detail: vatDetail,
        actionText: 'إعدادات الضريبة',
        to: '/admin/settings',
      },
      {
        key: 'maintenance',
        ok: maintenanceOk,
        title: 'وضع الصيانة',
        detail: maintenanceOk ? 'مكتمل' : 'أوقف وضع الصيانة قبل الإطلاق',
        actionText: 'حالة النظام',
        to: '/admin/settings',
      },
      {
        key: 'advanced-pricing',
        ok: advPricingOk,
        title: 'التسعير المتقدم (شرائح/أسعار خاصة)',
        detail: advPricingOk ? 'مكتمل' : 'اختياري: أضف شرائح أو أسعار خاصة',
        actionText: 'إدارة التسعير',
        to: '/admin/price-tiers',
      },
      {
        key: 'approvals',
        ok: approvalsOk,
        title: 'جاهزية الموافقات',
        detail: approvalsOk ? 'مكتمل' : 'امنح صلاحية إدارة الموافقات لمدير واحد على الأقل',
        actionText: 'إدارة المستخدمين',
        to: '/admin/profile',
      },
      {
        key: 'financial-reports',
        ok: accountingViewOk && accountingConfigured,
        title: 'جاهزية التقارير المالية',
        detail: accountingViewOk && accountingConfigured ? 'مكتمل' : 'عيّن حسابات رئيسية وتأكد من صلاحية عرض المحاسبة',
        actionText: 'إعداد الحسابات',
        to: '/admin/settings',
      },
      {
        key: 'period-close',
        ok: hasPermission('accounting.periods.close'),
        title: 'جاهزية إقفال الفترة المحاسبية',
        detail: hasPermission('accounting.periods.close') ? 'مكتمل' : 'امنح صلاحية إقفال الفترات للمحاسب/المالك',
        actionText: 'إدارة المستخدمين',
        to: '/admin/profile',
      },
      {
        key: 'pos',
        ok: posReady,
        title: 'جاهزية نقطة البيع (POS)',
        detail: posReady ? 'مكتمل' : posDetail,
        actionText: 'فتح POS',
        to: '/pos',
      },
    ];
  }, [settings, banks.length, transferRecipients.length, deliveryZones, categories.length, unitTypes.length, suppliers.length, menuItems.length, warehouses.length, adminPromotions, coupons.length, ads.length, currentShift, priceTiers.length, specialPrices.length, hasPermission]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          if (mounted) setBanks([]);
          return;
        }
        const { data, error } = await supabase.from('banks').select('id,data');
        if (error) throw error;
        const list = (data || []).map(row => row.data as Bank).filter(Boolean);
        list.sort((a, b) => {
          const an = a.name || '';
          const bn = b.name || '';
          return an.localeCompare(bn);
        });
        if (mounted) setBanks(list);
      } catch {
        if (mounted) setBanks([]);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          if (mounted) setTransferRecipients([]);
          return;
        }
        const { data, error } = await supabase.from('transfer_recipients').select('id,data');
        if (error) throw error;
        const list = (data || []).map(row => row.data as TransferRecipient).filter(Boolean);
        list.sort((a, b) => {
          const an = a.name || '';
          const bn = b.name || '';
          return an.localeCompare(bn);
        });
        if (mounted) setTransferRecipients(list);
      } catch {
        if (mounted) setTransferRecipients([]);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const refreshBanks = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setBanks([]);
      return;
    }
    const { data, error } = await supabase.from('banks').select('id,data');
    if (error) throw error;
    const list = (data || []).map(row => row.data as Bank).filter(Boolean);
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    setBanks(list);
  };

  const refreshTransferRecipients = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setTransferRecipients([]);
      return;
    }
    const { data, error } = await supabase.from('transfer_recipients').select('id,data');
    if (error) throw error;
    const list = (data || []).map(row => row.data as TransferRecipient).filter(Boolean);
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    setTransferRecipients(list);
  };

  const openCreateBank = () => {
    setEditingBankId(null);
    setBankForm({ name: '', accountName: '', accountNumber: '', isActive: true });
    setIsBankFormOpen(true);
  };

  const openEditBank = (bank: Bank) => {
    setEditingBankId(bank.id);
    setBankForm({
      name: bank.name || '',
      accountName: bank.accountName || '',
      accountNumber: bank.accountNumber || '',
      isActive: Boolean(bank.isActive),
    });
    setIsBankFormOpen(true);
  };

  const openCreateTransferRecipient = () => {
    setEditingTransferRecipientId(null);
    setTransferRecipientForm({ name: '', phoneNumber: '', isActive: true });
    setIsTransferRecipientFormOpen(true);
  };

  const openEditTransferRecipient = (recipient: TransferRecipient) => {
    setEditingTransferRecipientId(recipient.id);
    setTransferRecipientForm({
      name: recipient.name || '',
      phoneNumber: recipient.phoneNumber || '',
      isActive: Boolean(recipient.isActive),
    });
    setIsTransferRecipientFormOpen(true);
  };

  const handleBankSave = async () => {
    if (!bankForm.name.trim() || !bankForm.accountName.trim() || !bankForm.accountNumber.trim()) {
      showNotification(
        'الرجاء إدخال جميع البيانات المطلوبة',
        'error'
      );
      return;
    }

    setIsBankSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase غير مهيأ.');
      }
      if (editingBankId) {
        const existing = banks.find(b => b.id === editingBankId);
        if (!existing) {
          showNotification('تعذر العثور على البنك.', 'error');
          return;
        }
        const updated: Bank = {
          ...existing,
          name: bankForm.name.trim(),
          accountName: bankForm.accountName.trim(),
          accountNumber: bankForm.accountNumber.trim(),
          isActive: Boolean(bankForm.isActive),
          updatedAt: nowIso,
        };
        const { error } = await supabase.from('banks').upsert({ id: updated.id, data: updated }, { onConflict: 'id' });
        if (error) throw error;
      } else {
        const record: Bank = {
          id: crypto.randomUUID(),
          name: bankForm.name.trim(),
          accountName: bankForm.accountName.trim(),
          accountNumber: bankForm.accountNumber.trim(),
          isActive: Boolean(bankForm.isActive),
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        const { error } = await supabase.from('banks').insert({ id: record.id, data: record });
        if (error) throw error;
      }
      await refreshBanks();
      setIsBankFormOpen(false);
      setEditingBankId(null);
      showNotification('تم حفظ البنك.', 'success');
    } catch {
      showNotification('فشل حفظ البنك.', 'error');
    } finally {
      setIsBankSaving(false);
    }
  };

  const handleTransferRecipientSave = async () => {
    const name = transferRecipientForm.name.trim();
    const phone = transferRecipientForm.phoneNumber.trim();
    const isPhoneValid = /^(77|73|71|70)\d{7}$/.test(phone);

    if (!name || !phone) {
      showNotification('الرجاء إدخال الاسم', 'error');
      return;
    }
    if (!isPhoneValid) {
      showNotification('رقم الهاتف غير صحيح.', 'error');
      return;
    }

    setIsTransferRecipientSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase غير مهيأ.');
      }
      if (editingTransferRecipientId) {
        const existing = transferRecipients.find(r => r.id === editingTransferRecipientId);
        if (!existing) {
          showNotification('تعذر العثور على المستلم.', 'error');
          return;
        }
        const updated: TransferRecipient = {
          ...existing,
          name,
          phoneNumber: phone,
          isActive: Boolean(transferRecipientForm.isActive),
          updatedAt: nowIso,
        };
        const { error } = await supabase.from('transfer_recipients').upsert({ id: updated.id, data: updated }, { onConflict: 'id' });
        if (error) throw error;
      } else {
        const record: TransferRecipient = {
          id: crypto.randomUUID(),
          name,
          phoneNumber: phone,
          isActive: Boolean(transferRecipientForm.isActive),
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        const { error } = await supabase.from('transfer_recipients').insert({ id: record.id, data: record });
        if (error) throw error;
      }
      await refreshTransferRecipients();
      setIsTransferRecipientFormOpen(false);
      setEditingTransferRecipientId(null);
      showNotification('تم حفظ المستلم.', 'success');
    } catch {
      showNotification('فشل حفظ المستلم.', 'error');
    } finally {
      setIsTransferRecipientSaving(false);
    }
  };

  const handleBankDelete = async (bank: Bank) => {
    const ok = window.confirm(`حذف "${bank.name}"؟`);
    if (!ok) return;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase غير مهيأ.');
      const { error } = await supabase.from('banks').delete().eq('id', bank.id);
      if (error) throw error;
      await refreshBanks();
      showNotification('تم حذف البنك.', 'success');
    } catch {
      showNotification('فشل حذف البنك.', 'error');
    }
  };

  const handleTransferRecipientDelete = async (recipient: TransferRecipient) => {
    const ok = window.confirm(`حذف "${recipient.name}"؟`);
    if (!ok) return;
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase غير مهيأ.');
      const { error } = await supabase.from('transfer_recipients').delete().eq('id', recipient.id);
      if (error) throw error;
      await refreshTransferRecipients();
      showNotification('تم حذف المستلم.', 'success');
    } catch {
      showNotification('فشل حذف المستلم.', 'error');
    }
  };

  const toggleBankActive = async (bank: Bank, next: boolean) => {
    try {
      const nowIso = new Date().toISOString();
      const updated: Bank = { ...bank, isActive: next, updatedAt: nowIso };
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase غير مهيأ.');
      const { error } = await supabase.from('banks').upsert({ id: updated.id, data: updated }, { onConflict: 'id' });
      if (error) throw error;
      await refreshBanks();
    } catch {
    }
  };

  const toggleTransferRecipientActive = async (recipient: TransferRecipient, next: boolean) => {
    try {
      const nowIso = new Date().toISOString();
      const updated: TransferRecipient = { ...recipient, isActive: next, updatedAt: nowIso };
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase غير مهيأ.');
      const { error } = await supabase.from('transfer_recipients').upsert({ id: updated.id, data: updated }, { onConflict: 'id' });
      if (error) throw error;
      await refreshTransferRecipients();
    } catch {
    }
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showNotification('الرجاء اختيار ملف صورة صالح', 'error');
      e.target.value = '';
      return;
    }

    const maxBytes = 2 * 1024 * 1024;
    if (file.size > maxBytes) {
      showNotification('حجم الصورة كبير. الرجاء اختيار صورة أصغر من 2MB', 'error');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        showNotification('تعذر قراءة الصورة', 'error');
        return;
      }
      try {
        const img = new Image();
        img.decoding = 'async';
        const png: string = await new Promise((resolve, reject) => {
          img.onload = () => {
            const size = 512;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('no-canvas'));
              return;
            }
            ctx.clearRect(0, 0, size, size);
            const scale = Math.min(size / img.width, size / img.height);
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const x = Math.round((size - w) / 2);
            const y = Math.round((size - h) / 2);
            ctx.drawImage(img, x, y, w, h);
            try {
              resolve(canvas.toDataURL('image/png'));
            } catch (e) {
              reject(e);
            }
          };
          img.onerror = () => reject(new Error('img-load-failed'));
          img.src = result;
        });
        setFormState(prev => ({ ...prev, logoUrl: png }));
        showNotification('تم تحميل الشعار (سيتم حفظه عند الضغط على حفظ التغييرات)', 'success');
      } catch {
        setFormState(prev => ({ ...prev, logoUrl: result }));
        showNotification('تم تحميل الشعار (سيتم حفظه عند الضغط على حفظ التغييرات)', 'success');
      }
    };
    reader.onerror = () => {
      showNotification('تعذر قراءة الصورة', 'error');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setFormState(prev => ({ ...prev, logoUrl: '' }));
    showNotification('تمت إزالة الشعار (سيتم حفظ التغيير عند الضغط على حفظ التغييرات)', 'success');
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;

    if (name.startsWith('payment.')) {
      const method = name.split('.')[1];
      const isChecked = (e.target as HTMLInputElement).checked;
      setFormState(prev => ({
        ...prev,
        paymentMethods: {
          ...prev.paymentMethods,
          [method]: isChecked,
        },
      }));
    } else if (name.startsWith('loyalty.')) {
      const field = name.split('.')[1];
      const isChecked = (e.target as HTMLInputElement).checked;
      setFormState(prev => ({
        ...prev,
        loyaltySettings: {
          ...prev.loyaltySettings,
          [field]: type === 'checkbox' ? isChecked : parseFloat(value) || 0,
        }
      }));
    } else if (name.startsWith('tier.')) {
      const [_, tier, field] = name.split('.');
      setFormState(prev => ({
        ...prev,
        loyaltySettings: {
          ...prev.loyaltySettings,
          tiers: {
            ...prev.loyaltySettings.tiers,
            [tier]: {
              ...prev.loyaltySettings.tiers[tier as LoyaltyTier],
              [field]: parseFloat(value) || 0,
            }
          }
        }
      }))
    } else if (name.startsWith('referralDiscount.')) {
      const field = name.split('.')[1];
      setFormState(prev => ({
        ...prev,
        loyaltySettings: {
          ...prev.loyaltySettings,
          newUserReferralDiscount: {
            ...prev.loyaltySettings.newUserReferralDiscount,
            [field]: field === 'value' ? parseFloat(value) || 0 : value,
          }
        }
      }));
    }
    else if (name.startsWith('brandColors.')) {
      const field = name.split('.')[1] as 'primary' | 'gold' | 'mint';
      setFormState(prev => ({
        ...prev,
        brandColors: {
          primary: prev.brandColors?.primary || '#2F2B7C',
          gold: prev.brandColors?.gold || '#B0AEFF',
          mint: prev.brandColors?.mint || '#7E7BFF',
          [field]: value,
        },
      }));
    }
    else if (name.startsWith('taxSettings.')) {
      const field = name.split('.')[1];
      const isChecked = (e.target as HTMLInputElement).checked;
      setFormState(prev => ({
        ...prev,
        taxSettings: {
          ...prev.taxSettings!,
          [field]: field === 'enabled' ? isChecked : field === 'rate' ? (parseFloat(value) || 0) : value,
        }
      }));
    }
    else if (name.startsWith('posFlags.')) {
      const field = name.split('.')[1] as 'barcodeScanEnabled' | 'autoPrintThermalEnabled' | 'thermalCopies';
      const isChecked = (e.target as HTMLInputElement).checked;
      setFormState(prev => ({
        ...prev,
        posFlags: {
          barcodeScanEnabled: Boolean(prev.posFlags?.barcodeScanEnabled),
          autoPrintThermalEnabled: Boolean(prev.posFlags?.autoPrintThermalEnabled),
          thermalCopies: Number(prev.posFlags?.thermalCopies) || 1,
          [field]: field === 'thermalCopies' ? Math.max(1, parseInt(value) || 1) : isChecked,
        },
      }));
    }
    else if (name.startsWith('accounting_accounts.')) {
      const field = name.split('.')[1];
      setFormState(prev => ({
        ...prev,
        accounting_accounts: {
          ...prev.accounting_accounts,
          [field]: value,
        }
      }));
    }
    else if (name === 'maintenanceEnabled') {
      const isChecked = (e.target as HTMLInputElement).checked;
      setFormState(prev => ({ ...prev, maintenanceEnabled: isChecked }));
    }
    else if (name === 'maintenanceMessage') {
      setFormState(prev => ({ ...prev, maintenanceMessage: value }));
    }
    else {
      setFormState(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleLocalizedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const [field, lang] = name.split('.');

    setFormState(prev => ({
      ...prev,
      [field]: {
        ...((prev as any)[field] as object),
        [lang]: value,
      },
    }));
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await updateSettings(formState);
      showNotification('تم حفظ الإعدادات بنجاح!', 'success');
    } catch (err: any) {
      showNotification(err?.message || 'فشل حفظ الإعدادات.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleMaintenanceToggleInstant = async (enabled: boolean) => {
    setIsMaintenanceSaving(true);
    const next = { ...formState, maintenanceEnabled: enabled, maintenanceMessage: formState.maintenanceMessage || 'نُجري صيانة مؤقتًا، الرجاء المحاولة لاحقًا.' };
    setFormState(next);
    try {
      await updateSettings(next);
    } catch (err: any) {
      showNotification(err?.message || 'فشل تطبيق وضع الصيانة.', 'error');
      setIsMaintenanceSaving(false);
      return;
    }
    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        const { data: admins, error } = await supabase
          .from('admin_users')
          .select('auth_user_id, role, is_active')
          .eq('is_active', true);
        if (!error && Array.isArray(admins)) {
          const title = enabled ? 'تم تفعيل وضع الصيانة' : 'تم إيقاف وضع الصيانة';
          const msg = enabled ? (next.maintenanceMessage || 'نُجري صيانة مؤقتًا، الرجاء المحاولة لاحقًا.') : 'النظام عاد للعمل';
          const targets = admins;
          if (targets.length > 0) {
            await supabase.from('notifications').insert(
              targets.map(a => ({
                user_id: a.auth_user_id,
                title,
                message: msg,
                type: 'info',
                link: '/admin/settings'
              }))
            );
          }
        }
      }
    } catch {}
    showNotification(enabled ? 'تم تفعيل وضع الصيانة فورًا' : 'تم إيقاف وضع الصيانة فورًا', 'success');
    setIsMaintenanceSaving(false);
  };

  return (
    <div className="animate-fade-in space-y-8">
      <h1 className="text-3xl font-bold dark:text-white">الإعدادات العامة</h1>

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
          قائمة تحقق بدء التشغيل
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {checklist.map(item => (
            <div key={item.key} className="p-4 rounded-lg border dark:border-gray-700 flex items-start gap-3">
              <div className={`p-2 rounded-full ${item.ok ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                {item.ok ? <Icons.Check className="h-5 w-5" /> : <Icons.X className="h-5 w-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-gray-900 dark:text-white">{item.title}</div>
                <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">{item.detail}</div>
              </div>
              <div>
                <Link to={item.to} className="px-3 py-2 rounded-md bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition">
                  {item.actionText}
                </Link>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          يُنصح بإتمام البنود الحمراء قبل البدء الفعلي باستقبال الطلبات.
        </div>
      </section>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8 space-y-8">

        <section>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
            حالة النظام
          </h2>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${formState.maintenanceEnabled ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>
                الصيانة: {formState.maintenanceEnabled ? 'مفعّلة' : 'موقفة'}
              </span>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {formState.maintenanceEnabled ? (formState.maintenanceMessage || 'نُجري صيانة مؤقتًا، الرجاء المحاولة لاحقًا.') : 'النظام يعمل بشكل طبيعي'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleMaintenanceToggleInstant(!Boolean(formState.maintenanceEnabled))}
                disabled={isMaintenanceSaving}
                className={`px-4 py-2 rounded-md text-white font-semibold transition ${formState.maintenanceEnabled ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} ${isMaintenanceSaving ? 'opacity-70 cursor-wait' : ''}`}
              >
                {formState.maintenanceEnabled ? 'إيقاف الصيانة الآن' : 'تفعيل الصيانة الآن'}
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
            بيانات المتجر
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="cafeteriaName.ar" className="block text-sm font-medium text-gray-700 dark:text-gray-300">اسم المتجر (بالعربية)</label>
              <input type="text" name="cafeteriaName.ar" id="cafeteriaName.ar" value={formState.cafeteriaName.ar} onChange={handleLocalizedChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600" />
            </div>
            <div>
              <label htmlFor="cafeteriaName.en" className="block text-sm font-medium text-gray-700 dark:text-gray-300">اسم المتجر (بالإنجليزية)</label>
              <input type="text" name="cafeteriaName.en" id="cafeteriaName.en" value={formState.cafeteriaName.en || ''} onChange={handleLocalizedChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600" />
            </div>
            <div>
              <label htmlFor="logoUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300">شعار المتجر</label>
              <input
                type="file"
                id="logoUrl"
                accept="image/*"
                onChange={handleLogoFileChange}
                className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              />
              {formState.logoUrl ? (
                <div className="mt-3 flex items-center gap-4">
                  <img src={formState.logoUrl} alt="Logo" className="h-14 w-14 rounded-lg object-contain bg-white" />
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="px-3 py-2 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 transition"
                  >
                    إزالة الشعار
                  </button>
                </div>
              ) : (
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  اختر صورة PNG/JPG/WebP من جهازك.
                </div>
              )}
            </div>
            <div>
              <label htmlFor="contactNumber" className="block text-sm font-medium text-gray-700 dark:text-gray-300">رقم التواصل</label>
              <input type="tel" name="contactNumber" id="contactNumber" value={formState.contactNumber} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="address" className="block text-sm font-medium text-gray-700 dark:text-gray-300">العنوان</label>
              <input type="text" name="address" id="address" value={formState.address} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600" />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
            ألوان التطبيق
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label htmlFor="brandColors.primary" className="block text-sm font-medium text-gray-700 dark:text-gray-300">اللون الأساسي</label>
              <input
                type="color"
                name="brandColors.primary"
                id="brandColors.primary"
                value={formState.brandColors?.primary || '#2F2B7C'}
                onChange={handleChange}
                className="mt-2 h-12 w-full p-1 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              />
            </div>
            <div>
              <label htmlFor="brandColors.gold" className="block text-sm font-medium text-gray-700 dark:text-gray-300">اللون الذهبي</label>
              <input
                type="color"
                name="brandColors.gold"
                id="brandColors.gold"
                value={formState.brandColors?.gold || '#B0AEFF'}
                onChange={handleChange}
                className="mt-2 h-12 w-full p-1 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              />
            </div>
            <div>
              <label htmlFor="brandColors.mint" className="block text-sm font-medium text-gray-700 dark:text-gray-300">اللون الثانوي</label>
              <input
                type="color"
                name="brandColors.mint"
                id="brandColors.mint"
                value={formState.brandColors?.mint || '#7E7BFF'}
                onChange={handleChange}
                className="mt-2 h-12 w-full p-1 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <div className="flex items-center gap-2 rounded-md border p-3 dark:border-gray-600">
              <span className="h-4 w-4 rounded-full" style={{ backgroundColor: formState.brandColors?.primary || '#2F2B7C' }}></span>
              <span className="text-sm text-gray-700 dark:text-gray-300">أساسي</span>
            </div>
            <div className="flex items-center gap-2 rounded-md border p-3 dark:border-gray-600">
              <span className="h-4 w-4 rounded-full" style={{ backgroundColor: formState.brandColors?.gold || '#B0AEFF' }}></span>
              <span className="text-sm text-gray-700 dark:text-gray-300">ذهبي</span>
            </div>
            <div className="flex items-center gap-2 rounded-md border p-3 dark:border-gray-600">
              <span className="h-4 w-4 rounded-full" style={{ backgroundColor: formState.brandColors?.mint || '#7E7BFF' }}></span>
              <span className="text-sm text-gray-700 dark:text-gray-300">ثانوي</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            سيتم تطبيق الألوان على مستوى التطبيق بعد حفظ التغييرات.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
            إعدادات برنامج الولاء
          </h2>
          <div className="space-y-4">
            <label className="flex items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600">
              <input type="checkbox" name="loyalty.enabled" checked={formState.loyaltySettings.enabled} onChange={handleChange} className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500" />
              <span className="mx-3 font-semibold text-gray-700 dark:text-gray-300">تفعيل برنامج الولاء</span>
            </label>
            <div className={`space-y-6 transition-opacity duration-300 ${formState.loyaltySettings.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="pointsPerCurrencyUnit" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">النقاط المكتسبة لكل وحدة عملة</label>
                  <NumberInput
                    id="pointsPerCurrencyUnit"
                    name="loyalty.pointsPerCurrencyUnit"
                    value={formState.loyaltySettings.pointsPerCurrencyUnit}
                    onChange={handleChange}
                    step={0.0001}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{`سيحصل العميل على ${Math.round(formState.loyaltySettings.pointsPerCurrencyUnit * 10000) / 1000} نقطة مقابل كل 10 ر.ي ينفقها.`}</p>
                </div>
                <div>
                  <label htmlFor="currencyValuePerPoint" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">قيمة النقطة بالعملة</label>
                  <NumberInput
                    id="currencyValuePerPoint"
                    name="loyalty.currencyValuePerPoint"
                    value={formState.loyaltySettings.currencyValuePerPoint}
                    onChange={handleChange}
                    step={1}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{`كل نقطة تساوي ${formState.loyaltySettings.currencyValuePerPoint} ر.ي عند الاستبدال.`}</p>
                </div>
              </div>

              <div className="p-4 border rounded-lg dark:border-gray-600">
                <h3 className="font-semibold text-lg mb-3 dark:text-gray-200">إعدادات مستويات الولاء</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="tier.bronze.threshold" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">حد المستوى البرونزي (نقاط)</label>
                      <NumberInput id="tier.bronze.threshold" name="tier.bronze.threshold" value={formState.loyaltySettings.tiers.bronze.threshold} onChange={handleChange} step={100} />
                    </div>
                    <div>
                      <label htmlFor="tier.bronze.discountPercentage" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">خصم المستوى البرونزي (%)</label>
                      <NumberInput id="tier.bronze.discountPercentage" name="tier.bronze.discountPercentage" value={formState.loyaltySettings.tiers.bronze.discountPercentage} onChange={handleChange} step={1} max={100} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="tier.silver.threshold" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">حد المستوى الفضي (نقاط)</label>
                      <NumberInput id="tier.silver.threshold" name="tier.silver.threshold" value={formState.loyaltySettings.tiers.silver.threshold} onChange={handleChange} step={100} />
                    </div>
                    <div>
                      <label htmlFor="tier.silver.discountPercentage" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">خصم المستوى الفضي (%)</label>
                      <NumberInput id="tier.silver.discountPercentage" name="tier.silver.discountPercentage" value={formState.loyaltySettings.tiers.silver.discountPercentage} onChange={handleChange} step={1} max={100} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="tier.gold.threshold" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">حد المستوى الذهبي (نقاط)</label>
                      <NumberInput id="tier.gold.threshold" name="tier.gold.threshold" value={formState.loyaltySettings.tiers.gold.threshold} onChange={handleChange} step={100} />
                    </div>
                    <div>
                      <label htmlFor="tier.gold.discountPercentage" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">خصم المستوى الذهبي (%)</label>
                      <NumberInput id="tier.gold.discountPercentage" name="tier.gold.discountPercentage" value={formState.loyaltySettings.tiers.gold.discountPercentage} onChange={handleChange} step={1} max={100} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 border rounded-lg dark:border-gray-600">
                <h3 className="font-semibold text-lg mb-3 dark:text-gray-200">إعدادات برنامج الإحالة</h3>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="loyalty.referralRewardPoints" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">مكافأة الداعي (نقاط)</label>
                    <NumberInput id="loyalty.referralRewardPoints" name="loyalty.referralRewardPoints" value={formState.loyaltySettings.referralRewardPoints} onChange={handleChange} step={10} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="referralDiscount.type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">خصم المستخدم الجديد</label>
                      <select name="referralDiscount.type" id="referralDiscount.type" value={formState.loyaltySettings.newUserReferralDiscount.type} onChange={handleChange} className="w-full p-3 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition">
                        <option value="percentage">نسبة مئوية</option>
                        <option value="fixed">مبلغ ثابت</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="referralDiscount.value" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">قيمة الخصم</label>
                      <NumberInput id="referralDiscount.value" name="referralDiscount.value" value={formState.loyaltySettings.newUserReferralDiscount.value} onChange={handleChange} min={0} step={formState.loyaltySettings.newUserReferralDiscount.type === 'percentage' ? 1 : 100} max={formState.loyaltySettings.newUserReferralDiscount.type === 'percentage' ? 100 : undefined} />
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>



        <section>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
            طرق الدفع المتاحة
          </h2>
          <div className="space-y-3">
            <label className="flex items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600">
              <input type="checkbox" name="payment.cash" checked={formState.paymentMethods.cash} onChange={handleChange} className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500" />
              <span className="mx-3 text-gray-700 dark:text-gray-300">نقدًا</span>
            </label>
            <label className="flex items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600">
              <input type="checkbox" name="payment.kuraimi" checked={formState.paymentMethods.kuraimi} onChange={handleChange} className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500" />
              <span className="mx-3 text-gray-700 dark:text-gray-300">الكريمي</span>
            </label>
            <label className="flex items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600">
              <input type="checkbox" name="payment.network" checked={formState.paymentMethods.network} onChange={handleChange} className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500" />
              <span className="mx-3 text-gray-700 dark:text-gray-300">شبكة</span>
            </label>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
            إعدادات نقاط البيع (POS)
          </h2>
          <div className="space-y-4">
            <label className="flex items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600">
              <input
                type="checkbox"
                name="posFlags.barcodeScanEnabled"
                checked={Boolean(formState.posFlags?.barcodeScanEnabled)}
                onChange={handleChange}
                className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500"
              />
              <span className="mx-3 text-gray-700 dark:text-gray-300">تمكين إضافة عبر الباركود (مسح + Enter)</span>
            </label>
            <label className="flex items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600">
              <input
                type="checkbox"
                name="posFlags.autoPrintThermalEnabled"
                checked={Boolean(formState.posFlags?.autoPrintThermalEnabled)}
                onChange={handleChange}
                className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500"
              />
              <span className="mx-3 text-gray-700 dark:text-gray-300">طباعة حرارية تلقائية بعد الإتمام</span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">عدد النسخ الحرارية</label>
                <NumberInput
                  id="posFlags.thermalCopies"
                  name="posFlags.thermalCopies"
                  value={Number(formState.posFlags?.thermalCopies) || 1}
                  onChange={handleChange}
                  min={1}
                  step={1}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">مثلاً 2 لنسخة عميل + نسخة تاجر.</p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
              إدارة الحسابات البنكية
            </h2>
            <button
              type="button"
              onClick={openCreateBank}
              className="mb-4 px-4 py-2 rounded-md bg-primary-500 text-white font-semibold hover:bg-primary-600 transition"
            >
              إضافة بنك
            </button>
          </div>

          {isBankFormOpen && (
            <div className="p-4 mb-4 border rounded-lg dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">اسم البنك</label>
                  <input
                    type="text"
                    value={bankForm.name}
                    onChange={(e) => setBankForm(prev => ({ ...prev, name: e.target.value }))}
                    className="mt-1 w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">اسم الحساب</label>
                  <input
                    type="text"
                    value={bankForm.accountName}
                    onChange={(e) => setBankForm(prev => ({ ...prev, accountName: e.target.value }))}
                    className="mt-1 w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">رقم الحساب</label>
                  <input
                    type="text"
                    value={bankForm.accountNumber}
                    onChange={(e) => setBankForm(prev => ({ ...prev, accountNumber: e.target.value }))}
                    className="mt-1 w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
                  />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={bankForm.isActive}
                    onChange={(e) => setBankForm(prev => ({ ...prev, isActive: e.target.checked }))}
                    className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500"
                  />
                  نشط
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsBankFormOpen(false);
                      setEditingBankId(null);
                    }}
                    className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 font-semibold hover:bg-gray-300 dark:hover:bg-gray-500 transition"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={handleBankSave}
                    disabled={isBankSaving}
                    className="px-4 py-2 rounded-md bg-green-600 text-white font-semibold hover:bg-green-700 transition disabled:bg-green-400 disabled:cursor-wait"
                  >
                    {isBankSaving ? 'جاري الحفظ...' : 'حفظ'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {banks.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                لا توجد بنوك بعد.
              </div>
            ) : (
              banks.map(bank => (
                <div key={bank.id} className="p-4 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-gray-900 dark:text-white truncate">{bank.name}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                        اسم الحساب: <span className="font-mono">{bank.accountName}</span>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        رقم الحساب: <span className="font-mono">{bank.accountNumber}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={bank.isActive}
                          onChange={(e) => toggleBankActive(bank, e.target.checked)}
                          className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500"
                        />
                        نشط
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEditBank(bank)}
                          className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition"
                        >
                          تعديل
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBankDelete(bank)}
                          className="px-3 py-2 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition"
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
              إدارة مستلمي الحوالات
            </h2>
            <button
              type="button"
              onClick={openCreateTransferRecipient}
              className="mb-4 px-4 py-2 rounded-md bg-primary-500 text-white font-semibold hover:bg-primary-600 transition"
            >
              إضافة مستلم
            </button>
          </div>

          {isTransferRecipientFormOpen && (
            <div className="p-4 mb-4 border rounded-lg dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">اسم المستلم</label>
                  <input
                    type="text"
                    value={transferRecipientForm.name}
                    onChange={(e) => setTransferRecipientForm(prev => ({ ...prev, name: e.target.value }))}
                    className="mt-1 w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">رقم هاتف المستلم</label>
                  <input
                    type="tel"
                    value={transferRecipientForm.phoneNumber}
                    onChange={(e) => setTransferRecipientForm(prev => ({ ...prev, phoneNumber: e.target.value }))}
                    className="mt-1 w-full p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={transferRecipientForm.isActive}
                      onChange={(e) => setTransferRecipientForm(prev => ({ ...prev, isActive: e.target.checked }))}
                      className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500"
                    />
                    نشط
                  </label>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsTransferRecipientFormOpen(false);
                    setEditingTransferRecipientId(null);
                  }}
                  className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 font-semibold hover:bg-gray-300 dark:hover:bg-gray-500 transition"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleTransferRecipientSave}
                  disabled={isTransferRecipientSaving}
                  className="px-4 py-2 rounded-md bg-green-600 text-white font-semibold hover:bg-green-700 transition disabled:bg-green-400 disabled:cursor-wait"
                >
                  {isTransferRecipientSaving ? 'جاري الحفظ...' : 'حفظ'}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {transferRecipients.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                لا يوجد مستلمون بعد.
              </div>
            ) : (
              transferRecipients.map(recipient => (
                <div key={recipient.id} className="p-4 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-gray-900 dark:text-white truncate">{recipient.name}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                        رقم هاتف المستلم: <span className="font-mono">{recipient.phoneNumber}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={recipient.isActive}
                          onChange={(e) => toggleTransferRecipientActive(recipient, e.target.checked)}
                          className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500"
                        />
                        نشط
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEditTransferRecipient(recipient)}
                          className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition"
                        >
                          تعديل
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTransferRecipientDelete(recipient)}
                          className="px-3 py-2 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition"
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
            وضع الصيانة
          </h2>
          <div className="space-y-4">
            <label className="flex items-center gap-3 text-gray-800 dark:text-gray-200">
              <input
                type="checkbox"
                name="maintenanceEnabled"
                checked={Boolean(formState.maintenanceEnabled)}
                onChange={handleChange}
                className="form-checkbox h-5 w-5 text-gold-500 rounded focus:ring-gold-500"
              />
              تفعيل وضع الصيانة (إيقاف واجهة العملاء مؤقتًا)
            </label>
            <div>
              <label htmlFor="maintenanceMessage" className="block text-sm font-medium text-gray-700 dark:text-gray-300">رسالة الصيانة</label>
              <textarea
                id="maintenanceMessage"
                name="maintenanceMessage"
                value={formState.maintenanceMessage || ''}
                onChange={handleChange}
                rows={3}
                className="mt-1 w-full p-3 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                placeholder="نُجري صيانة مؤقتًا، الرجاء المحاولة لاحقًا."
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                تظهر هذه الرسالة لكل العملاء أثناء الصيانة، ويمكن تعديلها حسب الحاجة.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
            إعدادات التطبيق
          </h2>
          <div>
            <label htmlFor="defaultLanguage" className="block text-sm font-medium text-gray-700 dark:text-gray-300">اللغة الافتراضية</label>
            <select name="defaultLanguage" id="defaultLanguage" value={formState.defaultLanguage} onChange={handleChange} className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600">
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 border-r-4 rtl:border-l-4 rtl:border-r-0 border-gold-500 pr-4 rtl:pr-0 rtl:pl-4">
            إعدادات الحسابات المحاسبية
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
             {['sales', 'sales_returns', 'inventory', 'cogs', 'ar', 'ap', 'vat_payable', 'vat_recoverable', 'cash', 'bank', 'deposits', 'expenses', 'shrinkage', 'gain', 'delivery_income', 'sales_discounts', 'over_short'].map(key => (
                 <div key={key}>
                     <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 capitalize">
                        {accountingLabels[key] ?? key.replace(/_/g, ' ')}
                     </label>
                     <select
                        name={`accounting_accounts.${key}`}
                        value={formState.accounting_accounts?.[key as keyof typeof formState.accounting_accounts] || ''}
                        onChange={handleChange}
                        className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                     >
                        <option value="">افتراضي</option>
                        {accounts.map(acc => (
                            <option key={acc.id} value={acc.id}>
                                {acc.code} - {acc.name}
                            </option>
                        ))}
                     </select>
                 </div>
             ))}
          </div>
        </section>

        <div className="pt-6 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="bg-primary-500 text-white font-bold py-3 px-8 rounded-lg shadow-lg hover:bg-primary-600 transition-transform transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-orange-300 disabled:bg-primary-400 disabled:cursor-wait"
          >
            {isSaving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
          </button>
        </div>
      </form>

    </div>
  );
};

export default SettingsScreen;
