import type React from 'react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../contexts/CartContext';
import { useOrders } from '../contexts/OrderContext';
import { useToast } from '../contexts/ToastContext';
import { useSettings } from '../contexts/SettingsContext';

import { useUserAuth } from '../contexts/UserAuthContext';
import { useDeliveryZones } from '../contexts/DeliveryZoneContext';
import { usePricing } from '../contexts/PricingContext';
import TextInput from '../components/TextInput';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { BackArrowIcon, ShareIcon, KuraimiIcon, LocationIcon, MoneyIcon, PhoneIcon, UserIcon, TruckIcon } from '../components/icons';
import { addCSRFTokenToObject } from '../utils/csrfProtection';
import { decryptField, encrypt } from '../utils/encryption';
import { createLogger } from '../utils/logger';
import { findNearestDeliveryZone, verifyZoneMatch, formatDistance } from '../utils/geoUtils';
import InteractiveMap from '../components/InteractiveMap';
import type { Bank, TransferRecipient } from '../types';
import { getSupabaseClient } from '../supabase';

const paymentMethodIcons: { [key: string]: React.ReactNode } = {
    cash: <MoneyIcon />,
    kuraimi: <KuraimiIcon />,
    network: <ShareIcon />,
};

const logger = createLogger('CheckoutScreen');


const CheckoutScreen: React.FC = () => {
    const { cartItems, getCartSubtotal, appliedCoupon, clearCart } = useCart();
    const { addOrder, userOrders } = useOrders();
    const { showNotification } = useToast();
    const { settings } = useSettings();
    const language = 'ar';
    const { currentUser, updateCustomer } = useUserAuth();
    const { deliveryZones } = useDeliveryZones();
    const { getItemPrice, getItemDiscount } = usePricing();
    const navigate = useNavigate();

    const [customerName, setCustomerName] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [address, setAddress] = useState('');
    const [deliveryInstructions, setDeliveryInstructions] = useState('');
    const [notes, setNotes] = useState('');
    const [redeemPoints, setRedeemPoints] = useState(false);
    const [isScheduled, setIsScheduled] = useState(false);
    const [scheduledAt, setScheduledAt] = useState('');
    const [savedAddressTextById, setSavedAddressTextById] = useState<Record<string, string>>({});


    useEffect(() => {
        if (currentUser) {
            setCustomerName(currentUser.fullName || '');
            setPhoneNumber(currentUser.phoneNumber || '');
        }
    }, [currentUser]);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            const saved = currentUser?.savedAddresses || [];
            if (!saved.length) {
                setSavedAddressTextById({});
                return;
            }

            const entries = await Promise.all(
                saved.slice(0, 8).map(async (addr) => {
                    const resolved = await decryptField({ address: addr.address }, 'address');
                    return [addr.id, resolved.address] as const;
                })
            );

            if (!cancelled) {
                setSavedAddressTextById(Object.fromEntries(entries));
            }
        };

        void run();

        return () => {
            cancelled = true;
        };
    }, [currentUser?.id, currentUser?.savedAddresses]);

    const [paymentMethod, setPaymentMethod] = useState('');
    const [kuraimiRef, setKuraimiRef] = useState('');
    const [kuraimiScreenshot, setKuraimiScreenshot] = useState<string | null>(null);
    const [banks, setBanks] = useState<Bank[]>([]);
    const [selectedBankId, setSelectedBankId] = useState('');
    const [transferRecipients, setTransferRecipients] = useState<TransferRecipient[]>([]);
    const [selectedTransferRecipientId, setSelectedTransferRecipientId] = useState('');
    const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | undefined>(undefined);
    const [isMapVisible, setIsMapVisible] = useState(false);

    const [isLocating, setIsLocating] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [locationError, setLocationError] = useState('');
    const [autoDetectedZone, setAutoDetectedZone] = useState<string | null>(null);
    const [zoneMismatch, setZoneMismatch] = useState<{ distance: number; zoneName: string } | null>(null);
    const manualLocationOverrideRef = useRef(false);
    const locateRequestIdRef = useRef(0);

    const subtotal = getCartSubtotal();
    const [computedSubtotal, setComputedSubtotal] = useState(subtotal);
    const [tierDiscount, setTierDiscount] = useState(0);
    const activeDeliveryZones = useMemo(() => deliveryZones.filter(z => z.isActive), [deliveryZones]);
    const [deliveryZoneId, setDeliveryZoneId] = useState('');

    useEffect(() => {
        // Auto-select ONLY if previously selected or logic requires it. 
        // For now, we want explicit selection, so we might remove auto-select.
        // But if location detects a zone, we keep that in handleGetLocation.
        // Here we just ensure if deliveryZoneId is invalid we reset it? No, keeping selection is better.
    }, [activeDeliveryZones]);

    const selectedDeliveryZone = useMemo(() => {
        if (!deliveryZoneId) return undefined;
        return deliveryZones.find(z => z.id === deliveryZoneId);
    }, [deliveryZoneId, deliveryZones]);

    const effectiveDeliveryFee = useMemo(() => {
        if (computedSubtotal === 0) return 0;
        if (computedSubtotal === 0) return 0;

        if (selectedDeliveryZone && selectedDeliveryZone.isActive) {
            return selectedDeliveryZone.deliveryFee;
        }
        // Fallback or no zone selected -> 0 fee, but validation might block it unless it's "unregistered"
        return 0;
    }, [deliveryZoneId, selectedDeliveryZone, computedSubtotal]);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            try {
                if (cartItems.length === 0) {
                    if (!cancelled) {
                        setComputedSubtotal(0);
                        setTierDiscount(0);
                    }
                    return;
                }
                const customerId = currentUser?.id ?? null;
                let subtotalAgg = 0;
                let pricingDiscountAgg = 0;
                for (const item of cartItems) {
                    const addonsUnitPrice = Object.values(item.selectedAddons).reduce((sum, { addon, quantity }) => sum + (addon.price * quantity), 0);
                    let effectiveQuantity = item.quantity;
                    if (item.unitType === 'kg' || item.unitType === 'gram') {
                        effectiveQuantity = item.weight || item.quantity;
                    }
                    const unitPriceRaw = await getItemPrice(item.id, customerId, effectiveQuantity);
                    const discountPct = await getItemDiscount(item.id, customerId, effectiveQuantity);
                    const unitPriceNormalized = (item.unitType === 'gram' && item.pricePerUnit) ? (Number(unitPriceRaw) / 1000) : Number(unitPriceRaw);
                    const lineBaseSubtotal = (unitPriceNormalized + addonsUnitPrice) * effectiveQuantity;
                    const lineDiscountAmount = (unitPriceNormalized * (Number(discountPct) / 100)) * effectiveQuantity;
                    subtotalAgg += lineBaseSubtotal;
                    pricingDiscountAgg += lineDiscountAmount;
                }
                if (!cancelled) {
                    setComputedSubtotal(subtotalAgg);
                    setTierDiscount(pricingDiscountAgg);
                }
            } catch {
                if (!cancelled) {
                    setComputedSubtotal(subtotal);
                    setTierDiscount(0);
                }
            }
        };
        void run();
        return () => {
            cancelled = true;
        };
    }, [cartItems, currentUser?.id]);

    const referralDiscount = useMemo(() => {
        const isFirstOrder = userOrders.length === 0;
        if (!currentUser || !currentUser.referredBy || currentUser.firstOrderDiscountApplied || !isFirstOrder) {
            return 0;
        }
        const { type, value } = settings.loyaltySettings.newUserReferralDiscount;
        if (type === 'percentage') {
            return computedSubtotal * (value / 100);
        }
        return Math.min(value, computedSubtotal);
    }, [currentUser, userOrders, computedSubtotal, settings.loyaltySettings.newUserReferralDiscount]);

    const couponDiscount = useMemo(() => {
        const subtotalLocal = computedSubtotal;
        if (!appliedCoupon || subtotalLocal === 0) {
            return 0;
        }
        let calculatedDiscount = 0;
        if (appliedCoupon.type === 'percentage') {
            calculatedDiscount = subtotalLocal * (appliedCoupon.value / 100);
        } else {
            calculatedDiscount = Math.min(appliedCoupon.value, subtotalLocal);
        }
        if (appliedCoupon.maxDiscount && calculatedDiscount > appliedCoupon.maxDiscount) {
            calculatedDiscount = appliedCoupon.maxDiscount;
        }
        return calculatedDiscount;
    }, [appliedCoupon, computedSubtotal]);


    const pointsDiscount = useMemo(() => {
        const { enabled, currencyValuePerPoint } = settings.loyaltySettings;
        if (!redeemPoints || !currentUser || currentUser.loyaltyPoints <= 0 || !enabled) {
            return 0;
        }
        const pointsValue = currentUser.loyaltyPoints * currencyValuePerPoint;
        const valueAfterOtherDiscounts = computedSubtotal - couponDiscount - tierDiscount - referralDiscount;
        return Math.min(pointsValue, valueAfterOtherDiscounts);

    }, [redeemPoints, currentUser, computedSubtotal, couponDiscount, tierDiscount, referralDiscount, settings.loyaltySettings]);

    const pointsValueInCurrency = useMemo(() => {
        if (!currentUser) return 0;
        return currentUser.loyaltyPoints * settings.loyaltySettings.currencyValuePerPoint;
    }, [currentUser, settings.loyaltySettings]);


    const total = useMemo(() => {
        const valueAfterDiscounts = computedSubtotal - couponDiscount - tierDiscount - pointsDiscount - referralDiscount;
        return Math.max(0, valueAfterDiscounts) + effectiveDeliveryFee;
    }, [computedSubtotal, couponDiscount, tierDiscount, pointsDiscount, referralDiscount, effectiveDeliveryFee]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const supabase = getSupabaseClient();
                if (!supabase) {
                    if (!cancelled) setBanks([]);
                    return;
                }
                const { data, error } = await supabase.from('banks').select('id,data');
                if (error) throw error;
                const list = (data || []).map(row => row.data as Bank).filter(Boolean);
                const active = list.filter(bank => bank.isActive);
                active.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                if (!cancelled) setBanks(active);
            } catch {
                if (!cancelled) setBanks([]);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    const banksForPayment = useMemo(() => {
        return banks.filter(bank => Boolean(bank?.name?.trim()) && Boolean(bank?.accountName?.trim()) && Boolean(bank?.accountNumber?.trim()));
    }, [banks]);

    const selectedBank = useMemo(() => {
        if (!banksForPayment.length) return undefined;
        return banksForPayment.find(b => b.id === selectedBankId) || banksForPayment[0];
    }, [banksForPayment, selectedBankId]);

    useEffect(() => {
        if (!banksForPayment.length) return;
        if (selectedBankId && banksForPayment.some(b => b.id === selectedBankId)) return;
        setSelectedBankId(banksForPayment[0].id);
    }, [banksForPayment, selectedBankId]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const supabase = getSupabaseClient();
                if (!supabase) {
                    if (!cancelled) setTransferRecipients([]);
                    return;
                }
                const { data, error } = await supabase.from('transfer_recipients').select('id,data');
                if (error) throw error;
                const list = (data || []).map(row => row.data as TransferRecipient).filter(Boolean);
                const active = list.filter(recipient => recipient.isActive);
                active.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                if (!cancelled) setTransferRecipients(active);
            } catch {
                if (!cancelled) setTransferRecipients([]);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    const transferRecipientsForPayment = useMemo(() => {
        return transferRecipients.filter(r => Boolean(r?.name?.trim()) && Boolean(r?.phoneNumber?.trim()));
    }, [transferRecipients]);

    const selectedTransferRecipient = useMemo(() => {
        if (!transferRecipientsForPayment.length) return undefined;
        return (
            transferRecipientsForPayment.find(r => r.id === selectedTransferRecipientId)
            || transferRecipientsForPayment[0]
        );
    }, [selectedTransferRecipientId, transferRecipientsForPayment]);

    useEffect(() => {
        if (!transferRecipientsForPayment.length) return;
        if (selectedTransferRecipientId && transferRecipientsForPayment.some(r => r.id === selectedTransferRecipientId)) return;
        setSelectedTransferRecipientId(transferRecipientsForPayment[0].id);
    }, [selectedTransferRecipientId, transferRecipientsForPayment]);

    const availablePaymentMethods = useMemo(() => {
        const enabled = Object.entries(settings.paymentMethods)
            .filter(([, isEnabled]) => isEnabled)
            .map(([key]) => key);

        return enabled.filter((method) => {
            if (method === 'kuraimi') return banksForPayment.length > 0;
            if (method === 'network') return transferRecipientsForPayment.length > 0;
            return true;
        });
    }, [banksForPayment.length, settings.paymentMethods, transferRecipientsForPayment.length]);

    useEffect(() => {
        if (availablePaymentMethods.length === 0) {
            setPaymentMethod('');
            return;
        }
        if (!paymentMethod || !availablePaymentMethods.includes(paymentMethod)) {
            setPaymentMethod(availablePaymentMethods[0]);
            setKuraimiRef('');
            setKuraimiScreenshot(null);
            return;
        }
    }, [availablePaymentMethods, paymentMethod]);

    useEffect(() => {
        if (paymentMethod === 'cash') {
            setKuraimiRef('');
            setKuraimiScreenshot(null);
            const fileInput = document.getElementById('kuraimiScreenshotFile') as HTMLInputElement | null;
            if (fileInput) fileInput.value = '';
        }
    }, [paymentMethod]);

    const needsTransferDetails = paymentMethod === 'kuraimi' || paymentMethod === 'network';
    const hasPaymentProof = Boolean(kuraimiRef.trim() || kuraimiScreenshot);
    const canSubmit = !isSubmitting && availablePaymentMethods.length > 0 && (!needsTransferDetails || hasPaymentProof);

    const isValidCustomerName = useMemo(() => {
        const v = customerName.trim();
        if (v.length < 3 || v.length > 50) return false;
        return /^[\u0600-\u06FFa-zA-Z\s]+$/.test(v);
    }, [customerName]);

    const isValidPhoneNumber = useMemo(() => {
        const v = phoneNumber.trim();
        return /^(77|73|71|70)[0-9]{7}$/.test(v);
    }, [phoneNumber]);

    const isValidAddress = useMemo(() => {
        const v = address.trim();
        return v.length >= 10 && v.length <= 200;
    }, [address]);


    const handleGetLocation = async () => {
        if (!navigator.geolocation) {
            setLocationError('تحديد الموقع الجغرافي غير مدعوم في متصفحك.');
            return;
        }
        const isSecure = typeof window !== 'undefined' ? (window as any).isSecureContext : true;
        if (!isSecure) {
            setLocationError('تعذر تحديد الموقع لأن الصفحة ليست عبر HTTPS. افتح الموقع عبر https أو استخدم التطبيق.');
            setIsMapVisible(true);
            return;
        }
        manualLocationOverrideRef.current = false;
        setIsMapVisible(true);
        setIsLocating(true);
        setLocationError('');
        const requestId = ++locateRequestIdRef.current;

        const applyCoords = (coords: { lat: number; lng: number }) => {
            if (requestId !== locateRequestIdRef.current) return;
            setLocationCoords(coords);

            const nearestZone = findNearestDeliveryZone(coords, deliveryZones);
            if (nearestZone) {
                if (nearestZone.id !== deliveryZoneId) {
                    setDeliveryZoneId(nearestZone.id);
                    setAutoDetectedZone(nearestZone.id);
                    const zoneName = nearestZone.name.ar || nearestZone.name.en || '';
                    showNotification(
                        `تم اكتشاف منطقتك كـ ${zoneName}`,
                        'success'
                    );
                }
            } else {
                setLocationError('عذراً، موقعك الحالي خارج نطاق مناطق التوصيل المتاحة لدينا. لا يمكننا قبول الطلب في هذا الموقع.');
                setDeliveryZoneId(''); // Reset selection
                setAutoDetectedZone(null);
            }
        };

        const getPosition = (options: PositionOptions) =>
            new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, options);
            });

        let permissionState: string | null = null;
        try {
            const permissionsApi = (navigator as any)?.permissions;
            if (permissionsApi?.query) {
                const status = await permissionsApi.query({ name: 'geolocation' });
                permissionState = typeof status?.state === 'string' ? status.state : null;
            }
        } catch {
        }

        if (permissionState === 'denied') {
            setLocationError('تم رفض إذن الوصول للموقع. يرجى تفعيله من إعدادات المتصفح.');
            setIsLocating(false);
            return;
        }

        try {
            const fastPosition = await getPosition({ enableHighAccuracy: false, timeout: 4000, maximumAge: 60_000 });
            applyCoords({ lat: fastPosition.coords.latitude, lng: fastPosition.coords.longitude });
            setIsLocating(false);

            void (async () => {
                try {
                    const precise = await getPosition({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
                    if (requestId !== locateRequestIdRef.current) return;
                    if (manualLocationOverrideRef.current) return;
                    applyCoords({ lat: precise.coords.latitude, lng: precise.coords.longitude });
                } catch {
                }
            })();

            return;
        } catch {
        }

        try {
            const timeout = permissionState === 'prompt' ? 60_000 : 20_000;
            const position = await getPosition({ enableHighAccuracy: true, timeout, maximumAge: 0 });
            applyCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
        } catch (geoError) {
            const code = Number((geoError as any)?.code || 0);
            const message = code === 1
                ? 'تم رفض إذن الوصول للموقع. يرجى تفعيله من إعدادات المتصفح.'
                : (code === 3
                    ? 'انتهت مهلة تحديد الموقع. حاول مرة أخرى أو اختر موقعك من الخريطة.'
                    : 'تعذر تحديد موقعك الآن. تأكد من تشغيل GPS/خدمات الموقع ثم حاول مرة أخرى أو اختر الموقع من الخريطة.');
            setLocationError(message);
        } finally {
            if (requestId === locateRequestIdRef.current) {
                setIsLocating(false);
            }
        }
    };

    // Verify zone match when location or selected zone changes
    useEffect(() => {
        if (!locationCoords || !selectedDeliveryZone) {
            setZoneMismatch(null);
            return;
        }

        const verification = verifyZoneMatch(locationCoords, selectedDeliveryZone);

        if (!verification.matches && verification.distance) {
            setZoneMismatch({
                distance: verification.distance,
                zoneName: selectedDeliveryZone.name.ar || ''
            });
        } else {
            setZoneMismatch(null);
        }
    }, [locationCoords, selectedDeliveryZone]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onloadend = () => {
                setKuraimiScreenshot(reader.result as string);
                setKuraimiRef('');
            };
            reader.readAsDataURL(file);
        }
    };

    const handleKuraimiRefChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setKuraimiRef(e.target.value);
        setKuraimiScreenshot(null);
        const fileInput = document.getElementById('kuraimiScreenshotFile') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
    };

    const handleSubmitOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!isValidCustomerName) {
            setError('اسم العميل غير صحيح');
            return;
        }
        if (!isValidPhoneNumber) {
            setError('رقم الهاتف غير صحيح');
            return;
        }
        if (!isValidAddress) {
            setError('العنوان غير صحيح');
            return;
        }
        if (!paymentMethod) {
            setError('يرجى اختيار طريقة الدفع');
            return;
        }
        if (paymentMethod === 'cash') {
            if (kuraimiRef.trim() || kuraimiScreenshot) {
                setError('لا يسمح بإثبات دفع للدفع النقدي');
                return;
            }
        } else if (needsTransferDetails) {
            if (paymentMethod === 'kuraimi' && !selectedBank) {
                setError('لا توجد بنوك متاحة حاليًا');
                return;
            }
            if (paymentMethod === 'network' && !selectedTransferRecipient) {
                setError('لا يوجد مستلمين متاحين حاليًا');
                return;
            }
            if (!kuraimiRef.trim() && !kuraimiScreenshot) {
                setError('إثبات الدفع مطلوب لطرق الدفع غير النقدية');
                return;
            }
        }

        // Strict delivery zone validation
        if (!selectedDeliveryZone || !selectedDeliveryZone.isActive) {
            setError(language === 'ar' ? 'يرجى اختيار منطقة توصيل صحيحة ضمن النطاق المتاح' : 'Please select a valid delivery zone');
            return;
        }

        if (!locationCoords) {
            const msg = 'عذرًا، لا يمكن إرسال الطلب بدون تحديد موقعك على الخريطة للتأكد أنك ضمن نطاق منطقة التوصيل.';
            setError(msg);
            try {
                showNotification(msg, 'error');
            } catch {
            }
            return;
        }

        const zoneVerification = verifyZoneMatch(locationCoords, selectedDeliveryZone);
        if (!zoneVerification.matches) {
            const zoneName = selectedDeliveryZone.name?.ar || selectedDeliveryZone.name?.en || '';
            const distanceText = typeof zoneVerification.distance === 'number' ? formatDistance(zoneVerification.distance, 'ar') : '';
            const msg = distanceText
                ? `عذرًا، موقعك خارج نطاق منطقة التوصيل (${zoneName}). المسافة إلى مركز المنطقة تقريبًا ${distanceText}.`
                : `عذرًا، موقعك خارج نطاق منطقة التوصيل (${zoneName}).`;
            setError(msg);
            try {
                showNotification(msg, 'error');
            } catch {
            }
            return;
        }

        if (isScheduled && (!scheduledAt || new Date(scheduledAt) <= new Date())) {
            setError('وقت الجدولة غير صالح');
            return;
        }

        setIsSubmitting(true);
        try {
            const addressText = address.trim();

            const paymentProofType = needsTransferDetails
                ? (kuraimiScreenshot ? 'image' as const : (kuraimiRef ? 'ref_number' as const : undefined))
                : undefined;
            const paymentProof = needsTransferDetails ? (kuraimiScreenshot || kuraimiRef || undefined) : undefined;
            const paymentBank = (paymentMethod === 'kuraimi' && selectedBank)
                ? {
                    bankId: selectedBank.id,
                    bankName: selectedBank.name,
                    accountName: selectedBank.accountName,
                    accountNumber: selectedBank.accountNumber,
                }
                : undefined;
            const paymentNetworkRecipient = (paymentMethod === 'network' && selectedTransferRecipient)
                ? {
                    recipientId: selectedTransferRecipient.id,
                    recipientName: selectedTransferRecipient.name,
                    recipientPhoneNumber: selectedTransferRecipient.phoneNumber,
                }
                : undefined;

            

            const newOrder = {
                items: cartItems,
                subtotal: computedSubtotal,
                deliveryFee: effectiveDeliveryFee,
                deliveryZoneId: selectedDeliveryZone?.id,
                total,
                customerName: customerName.trim(),
                phoneNumber: phoneNumber.trim(),
                notes,
                address: addressText,
                location: locationCoords,
                paymentMethod,
                paymentBank,
                paymentNetworkRecipient,
                paymentProofType,
                paymentProof,
                deliveryInstructions,
                appliedCouponCode: appliedCoupon?.code,
                discountAmount: couponDiscount + pointsDiscount + tierDiscount + referralDiscount,
                pointsRedeemedValue: pointsDiscount,
                referralDiscount: referralDiscount,
                isScheduled,
                scheduledAt: isScheduled ? new Date(scheduledAt).toISOString() : undefined,
            };

            // Add CSRF token
            const orderWithCSRF = addCSRFTokenToObject(newOrder);
            logger.info('Checkout form submitted with CSRF protection');

            const createdOrder = await addOrder(orderWithCSRF);
            try {
                await Haptics.impact({ style: ImpactStyle.Heavy });
            } catch {
            }
            try {
                showNotification('تم استلام طلبك بنجاح', 'info');
            } catch {
            }
            try {
                clearCart();
            } catch {
            }
            navigate(`/order/${createdOrder.id}`);
        } catch (err: any) {
            let raw = '';
            if (err instanceof Error) {
                raw = err.message;
            } else if (typeof err === 'object' && err !== null) {
                // Handle Supabase/Postgrest error objects
                const details = err.details || err.hint || '';
                raw = err.message ? `${err.message} ${details}` : JSON.stringify(err);
            } else {
                raw = String(err || '');
            }

            // Clean up common technical prefixes if present
            raw = raw.replace(/^Exceeded max retries:\s*/i, '');

            const message = (raw && /[\u0600-\u06FF]/.test(raw) ? raw : 'فشل إنشاء الطلب.');
            setError(`${message} (${raw})`);
            logger.error('Checkout failed', err as Error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSaveAddress = async () => {
        if (!currentUser) return;
        if (!address.trim()) return;

        const label = window.prompt('أدخل اسمًا لهذا العنوان (مثل: المنزل، العمل)');
        if (!label || !label.trim()) return;

        try {
            // Encrypt address before saving
            const encryptedAddress = await encrypt(address.trim());

            const existing = currentUser.savedAddresses || [];
            const next = [
                {
                    id: crypto.randomUUID(),
                    label: label.trim(),
                    address: encryptedAddress, // Encrypted
                    location: locationCoords,
                    deliveryInstructions: deliveryInstructions.trim() ? deliveryInstructions.trim() : undefined,
                    createdAt: new Date().toISOString(),
                },
                ...existing,
            ].slice(0, 8);

            await updateCustomer({ ...currentUser, savedAddresses: next });
            showNotification('تم حفظ العنوان بنجاح', 'success');
            logger.info('Address saved with encryption');
        } catch (error) {
            logger.error('Failed to save address', error as Error);
            showNotification('فشل حفظ العنوان', 'error');
        }
    };

    const handleSelectSavedAddress = (saved: NonNullable<NonNullable<typeof currentUser>['savedAddresses']>[number]) => {
        const resolvedAddress = savedAddressTextById[saved.id] || saved.address;
        setAddress(resolvedAddress);
        manualLocationOverrideRef.current = true;
        setLocationCoords(saved.location);
        setDeliveryInstructions(saved.deliveryInstructions || '');
    };

    const handleDeleteSavedAddress = async (addressId: string) => {
        if (!currentUser) return;
        const ok = window.confirm('هل تريد حذف هذا العنوان؟');
        if (!ok) return;
        const next = (currentUser.savedAddresses || []).filter(a => a.id !== addressId);
        await updateCustomer({ ...currentUser, savedAddresses: next });
        showNotification('تم حذف العنوان', 'success');
    };

    useEffect(() => {
        if (cartItems.length === 0) {
            navigate('/cart', { replace: true });
        }
    }, [cartItems, navigate]);


    return (
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 sm:p-6 lg:p-8 animate-fade-in">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                    <h1 className="text-3xl font-bold dark:text-white">إتمام الطلب</h1>
                    <button onClick={() => navigate('/cart')} className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gold-500 dark:hover:text-gold-400 transition-colors inline-flex items-center space-x-2 rtl:space-x-reverse">
                        <BackArrowIcon className="h-4 w-4" />
                        <span>العودة للسلة</span>
                    </button>
                </div>

                <form onSubmit={handleSubmitOrder}>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 space-y-8">
                            {/* Customer & Address Info */}
                            <section>
                                <h2 className="text-xl font-semibold mb-4 dark:text-gray-200 border-r-4 rtl:border-r-0 rtl:border-l-4 border-gold-500 pr-3 rtl:pr-0 rtl:pl-3">بيانات العميل & عنوان التوصيل</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                    <div>
                                        <label htmlFor="customerName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اسم العميل</label>
                                        <TextInput id="customerName" name="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="الاسم الكامل" icon={<UserIcon />} required />
                                    </div>
                                    <div>
                                        <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رقم الهاتف</label>
                                        <TextInput id="phoneNumber" name="phoneNumber" type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="771234567" icon={<PhoneIcon />} required />
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    {currentUser && (
                                        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                                            <div className="flex items-center justify-between gap-3 mb-3">
                                                <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">العناوين المحفوظة</div>
                                                <button
                                                    type="button"
                                                    onClick={handleSaveAddress}
                                                    className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm"
                                                >
                                                    حفظ هذا العنوان
                                                </button>
                                            </div>
                                            {(currentUser.savedAddresses && currentUser.savedAddresses.length > 0) ? (
                                                <div className="space-y-2">
                                                    {currentUser.savedAddresses.slice(0, 8).map(saved => (
                                                        <div key={saved.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-white dark:bg-gray-800 rounded-lg">
                                                            <div className="min-w-0">
                                                                <div className="text-sm font-bold text-gray-900 dark:text-white">{saved.label}</div>
                                                                <div className="text-xs text-gray-500 dark:text-gray-400 truncate" title={savedAddressTextById[saved.id] || saved.address}>
                                                                    {savedAddressTextById[saved.id] || saved.address}
                                                                </div>
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleSelectSavedAddress(saved)}
                                                                    className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
                                                                >
                                                                    اختيار هذا العنوان
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteSavedAddress(saved.id)}
                                                                    className="px-3 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition text-sm"
                                                                >
                                                                    حذف
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-xs text-gray-500 dark:text-gray-300">لا توجد عناوين محفوظة</div>
                                            )}
                                        </div>
                                    )}
                                    <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={3} className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition" placeholder="تفاصيل العنوان (الشارع، الحي، معلم قريب...)" required />
                                    <div className="p-4 border-2 border-dashed border-primary-400 rounded-lg bg-white dark:bg-gray-800">
                                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                            <button type="button" onClick={handleGetLocation} disabled={isLocating} className="flex-1 flex items-center justify-center p-3 text-gold-500 rounded-lg hover:bg-gold-50 dark:hover:bg-gray-700 transition disabled:opacity-50">
                                                <LocationIcon />
                                                {isLocating ? 'جاري تحديد الموقع...' : 'استخدام موقعي الحالي'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setIsMapVisible(v => !v)}
                                                className="sm:w-auto w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                                            >
                                                {isMapVisible ? 'إخفاء الخريطة' : 'عرض الخريطة'}
                                            </button>
                                            {locationCoords && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        manualLocationOverrideRef.current = false;
                                                        setLocationCoords(undefined);
                                                    }}
                                                    className="sm:w-auto w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition"
                                                >
                                                    {'مسح الموقع'}
                                                </button>
                                            )}
                                        </div>
                                        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                                            {locationCoords
                                                ? `تم حفظ الموقع: ${locationCoords.lat.toFixed(6)}, ${locationCoords.lng.toFixed(6)}`
                                                : 'اختياري: تحديد الموقع يساعد المندوب للوصول بسرعة. العنوان النصي مطلوب.'}
                                        </div>
                                        {locationError && (
                                            <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
                                                {locationError}
                                            </div>
                                        )}
                                        {isMapVisible && (
                                            <div className="mt-4">
                                                <InteractiveMap
                                                    center={
                                                        locationCoords
                                                        || (selectedDeliveryZone?.coordinates
                                                            ? { lat: selectedDeliveryZone.coordinates.lat, lng: selectedDeliveryZone.coordinates.lng }
                                                            : { lat: 15.369445, lng: 44.191006 })
                                                    }
                                                    radius={0}
                                                    title="موقع التسليم"
                                                    onCenterChange={(newCoords) => {
                                                        manualLocationOverrideRef.current = true;
                                                        setLocationCoords(newCoords);
                                                    }}
                                                    heightClassName="h-64 sm:h-80"
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <textarea
                                        value={deliveryInstructions}
                                        onChange={(e) => setDeliveryInstructions(e.target.value)}
                                        rows={2}
                                        className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                                        placeholder="أي تعليمات إضافية للمندوب (اختياري)"
                                    />
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        تعليمات التوصيل
                                    </div>
                                </div>
                            </section>
                            <section>
                                <h2 className="text-xl font-semibold mb-4 dark:text-gray-200 border-r-4 rtl:border-r-0 rtl:border-l-4 border-gold-500 pr-3 rtl:pr-0 rtl:pl-3">مناطق التوصيل</h2>
                                <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">اختر المنطقة الأقرب إليك</label>
                                    <div className="flex items-center gap-3">
                                        <div className="text-gold-500">
                                            <TruckIcon />
                                        </div>
                                        <select
                                            value={deliveryZoneId}
                                            onChange={(e) => setDeliveryZoneId(e.target.value)}
                                            className="flex-1 p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition"
                                            disabled={false}
                                        >
                                            <option value="">اختر منطقة التوصيل</option>
                                            {deliveryZones.filter(z => z.isActive).map(zone => (
                                                <option key={zone.id} value={zone.id}>
                                                    {zone.name.ar} • {(Number(zone.deliveryFee) || 0).toFixed(2)} ر.ي • {zone.estimatedTime} دقيقة
                                                </option>
                                            ))}
                                            {/* Strict delivery only - no fallback */}
                                        </select>
                                    </div>
                                    {selectedDeliveryZone && (
                                        <div className="mt-3 text-xs text-gray-500 dark:text-gray-300">
                                            {`زمن التوصيل المتوقع: ${selectedDeliveryZone.estimatedTime} دقيقة`}
                                        </div>
                                    )}

                                    {/* Auto-detection success notification */}
                                    {autoDetectedZone && autoDetectedZone === deliveryZoneId && (
                                        <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                                            <div className="flex items-start gap-2">
                                                <div className="text-green-600 dark:text-green-400 mt-0.5">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                </div>
                                                <div className="flex-1">
                                                    <p className="text-sm font-medium text-green-800 dark:text-green-300">
                                                        تم تحديد المنطقة تلقائيًا
                                                    </p>
                                                    <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                                                        {`تم اكتشاف منطقتك كـ ${selectedDeliveryZone?.name.ar || ''}`}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Location mismatch warning */}
                                    {zoneMismatch && (
                                        <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                                            <div className="flex items-start gap-2">
                                                <div className="text-yellow-600 dark:text-yellow-400 mt-0.5">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                    </svg>
                                                </div>
                                                <div className="flex-1">
                                                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                                                        موقعك يبدو بعيدًا عن المنطقة المختارة
                                                    </p>
                                                    <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1">
                                                        {`أنت تبعد ${formatDistance(zoneMismatch.distance, 'ar')} عن ${zoneMismatch.zoneName}`}
                                                    </p>
                                                    <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1">
                                                        يرجى التأكد من اختيار المنطقة الصحيحة أو تعديل موقعك على الخريطة.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </section>
                            {/* Delivery Time Section */}
                            <section>
                                <h2 className="text-xl font-semibold mb-4 dark:text-gray-200 border-r-4 rtl:border-r-0 rtl:border-l-4 border-gold-500 pr-3 rtl:pr-0 rtl:pl-3">وقت التوصيل</h2>
                                <div className="space-y-3">
                                    <label className="flex items-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg cursor-pointer has-[:checked]:bg-gold-50 has-[:checked]:dark:bg-gray-600 has-[:checked]:ring-2 has-[:checked]:ring-gold-500 transition">
                                        <input type="radio" name="deliveryTime" value="now" checked={!isScheduled} onChange={() => setIsScheduled(false)} className="form-radio h-5 w-5 text-primary-600 focus:ring-gold-500" />
                                        <span className="mx-3 text-lg font-semibold text-gray-800 dark:text-gray-200">الآن (أسرع وقت)</span>
                                    </label>
                                    <label className="flex items-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg cursor-pointer has-[:checked]:bg-gold-50 has-[:checked]:dark:bg-gray-600 has-[:checked]:ring-2 has-[:checked]:ring-gold-500 transition">
                                        <input type="radio" name="deliveryTime" value="later" checked={isScheduled} onChange={() => setIsScheduled(true)} className="form-radio h-5 w-5 text-primary-600 focus:ring-gold-500" />
                                        <span className="mx-3 text-lg font-semibold text-gray-800 dark:text-gray-200">جدولة لوقت لاحق</span>
                                    </label>
                                    {isScheduled && (
                                        <div className="p-4 bg-gold-50 dark:bg-orange-900/20 rounded-b-lg animate-fade-in">
                                            <label htmlFor="scheduledAt" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اختر الوقت والتاريخ</label>
                                            <input type="datetime-local" id="scheduledAt" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} required className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700" min={new Date().toISOString().slice(0, 16)} />
                                        </div>
                                    )}
                                </div>
                            </section>

                            {/* Notes & Payment Section */}
                            <section>
                                <h2 className="text-xl font-semibold mb-4 dark:text-gray-200 border-r-4 rtl:border-r-0 rtl:border-l-4 border-gold-500 pr-3 rtl:pr-0 rtl:pl-3">ملاحظات إضافية & طريقة الدفع</h2>
                                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition mb-6" placeholder="أي ملاحظات حول الطلب..." />
                                <div className="space-y-3">
                                    {availablePaymentMethods.length > 0 ? (
                                        availablePaymentMethods.map(method => (
                                            <label key={method} className="flex items-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg cursor-pointer has-[:checked]:bg-gold-50 has-[:checked]:dark:bg-gray-600 has-[:checked]:ring-2 has-[:checked]:ring-gold-500 transition">
                                                <input type="radio" name="paymentMethod" value={method} checked={paymentMethod === method} onChange={(e) => setPaymentMethod(e.target.value)} className="form-radio h-5 w-5 text-primary-600 focus:ring-gold-500" />
                                                <div className="flex items-center flex-grow mx-3 rtl:mx-0 rtl:mr-3">
                                                    <div className="w-12 flex items-center justify-center">
                                                        {paymentMethodIcons[method]}
                                                    </div>
                                                    <span className="mx-3 rtl:mx-0 rtl:mr-3 text-lg font-semibold text-gray-800 dark:text-gray-200">
                                                        {method === 'cash' ? 'الدفع عند الاستلام' : method === 'kuraimi' ? 'حسابات بنكية' : 'حوالات'}
                                                    </span>
                                                </div>
                                            </label>
                                        ))
                                    ) : (
                                        <p className="text-center text-red-500 bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">لا توجد طرق دفع متاحة حاليًا</p>
                                    )}
                                </div>
                                {(paymentMethod === 'kuraimi' || paymentMethod === 'network') && (
                                    <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-500 rounded-r-lg space-y-4 animate-fade-in">
                                        <h3 className="text-lg font-bold text-blue-800 dark:text-blue-300">بيانات التحويل</h3>
                                        {paymentMethod === 'kuraimi' ? (
                                            banksForPayment.length === 0 ? (
                                                <div className="text-sm text-gray-700 dark:text-gray-300">
                                                    لا توجد بنوك متاحة حاليًا
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">اختر البنك للتحويل</div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        {banksForPayment.map((bank) => (
                                                            <button
                                                                key={bank.id}
                                                                type="button"
                                                                onClick={() => setSelectedBankId(bank.id)}
                                                                className={`text-left rtl:text-right p-3 rounded-lg border transition ${selectedBank?.id === bank.id
                                                                    ? 'border-blue-500 bg-white dark:bg-gray-800 ring-2 ring-blue-300 dark:ring-blue-700'
                                                                    : 'border-blue-200 dark:border-blue-800 bg-white/60 dark:bg-gray-800/60 hover:bg-white dark:hover:bg-gray-800'
                                                                    }`}
                                                            >
                                                                <div className="font-bold text-gray-900 dark:text-white truncate">{bank.name}</div>
                                                                <div className="text-xs text-gray-600 dark:text-gray-300 mt-1 truncate">
                                                                    اسم الحساب: <span className="font-mono">{bank.accountName}</span>
                                                                </div>
                                                                <div className="text-xs text-gray-600 dark:text-gray-300 truncate">
                                                                    رقم الحساب: <span className="font-mono">{bank.accountNumber}</span>
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                    {selectedBank && (
                                                        <div className="text-sm text-gray-700 dark:text-gray-300">
                                                            <p><strong>اسم الحساب:</strong> <span className="font-mono">{selectedBank.accountName}</span></p>
                                                            <p><strong>رقم الحساب:</strong> <span className="font-mono">{selectedBank.accountNumber}</span></p>
                                                        </div>
                                                    )}
                                                </>
                                            )
                                        ) : (
                                            transferRecipientsForPayment.length === 0 ? (
                                                <div className="text-sm text-gray-700 dark:text-gray-300">
                                                    لا يوجد مستلمين متاحين حاليًا
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">اختر المستلم</div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        {transferRecipientsForPayment.map((recipient) => (
                                                            <button
                                                                key={recipient.id}
                                                                type="button"
                                                                onClick={() => setSelectedTransferRecipientId(recipient.id)}
                                                                className={`text-left rtl:text-right p-3 rounded-lg border transition ${selectedTransferRecipient?.id === recipient.id
                                                                    ? 'border-blue-500 bg-white dark:bg-gray-800 ring-2 ring-blue-300 dark:ring-blue-700'
                                                                    : 'border-blue-200 dark:border-blue-800 bg-white/60 dark:bg-gray-800/60 hover:bg-white dark:hover:bg-gray-800'
                                                                    }`}
                                                            >
                                                                <div className="font-bold text-gray-900 dark:text-white truncate">{recipient.name}</div>
                                                                <div className="text-xs text-gray-600 dark:text-gray-300 mt-1 truncate">
                                                                    رقم هاتف المستلم: <span className="font-mono">{recipient.phoneNumber}</span>
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                    {selectedTransferRecipient && (
                                                        <div className="text-sm text-gray-700 dark:text-gray-300">
                                                            <p><strong>اسم المستلم:</strong> <span className="font-mono">{selectedTransferRecipient.name}</span></p>
                                                            <p><strong>رقم هاتف المستلم:</strong> <span className="font-mono">{selectedTransferRecipient.phoneNumber}</span></p>
                                                        </div>
                                                    )}
                                                </>
                                            )
                                        )}
                                        {((paymentMethod === 'kuraimi' && banksForPayment.length > 0) || (paymentMethod === 'network' && transferRecipientsForPayment.length > 0)) && (
                                            <>
                                                <hr className="dark:border-gray-600" />
                                                <h4 className="font-semibold text-gray-800 dark:text-gray-200">إثبات الدفع</h4>
                                                <div className="space-y-4">
                                                    <div>
                                                        <label htmlFor="kuraimiScreenshotFile" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">إرفاق صورة الإشعار</label>
                                                        <input type="file" id="kuraimiScreenshotFile" onChange={handleFileChange} accept="image/*" className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gold-50 file:text-primary-700 hover:file:bg-gold-100" />
                                                    </div>
                                                    <div className="text-center text-gray-500 dark:text-gray-400 font-semibold">أو أدخل رقم العملية</div>
                                                    <div>
                                                        <input type="text" value={kuraimiRef} onChange={handleKuraimiRefChange} placeholder="رقم العملية / الحوالة" className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition" />
                                                    </div>
                                                </div>
                                                {kuraimiScreenshot && <img src={kuraimiScreenshot} alt="Preview" className="mt-4 max-h-40 rounded-lg" />}
                                            </>
                                        )}
                                    </div>
                                )}
                            </section>
                        </div>
                        {/* Order Summary & Points */}
                        <div className="lg:col-span-1">
                            <div className="lg:sticky lg:top-24 space-y-6">
                                {currentUser && currentUser.loyaltyPoints > 0 && settings.loyaltySettings.enabled && (
                                    <section className="p-6 bg-yellow-50 dark:bg-yellow-900/30 border-l-4 border-yellow-500 rounded-r-lg">
                                        <h2 className="text-xl font-bold text-yellow-800 dark:text-yellow-300 mb-3">نقاط الولاء</h2>
                                        <p className="text-gray-700 dark:text-gray-300 mb-4">لديك <span className="font-bold">{currentUser.loyaltyPoints}</span> نقطة بقيمة {pointsValueInCurrency.toFixed(2)} ر.ي).</p>
                                        <label className="flex items-center cursor-pointer">
                                            <input type="checkbox" checked={redeemPoints} onChange={(e) => setRedeemPoints(e.target.checked)} className="form-checkbox h-5 w-5 text-primary-600 rounded focus:ring-gold-500" />
                                            <span className="mx-3 text-lg font-semibold text-gray-800 dark:text-gray-200">استخدام النقاط للخصم</span>
                                        </label>
                                    </section>
                                )}

                                <section className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
                                    <h2 className="text-xl font-bold mb-4 dark:text-white">ملخص الطلب</h2>
                                    <div className="space-y-3">
                                        <div className="flex justify-between text-gray-700 dark:text-gray-300"><span>المجموع الفرعي:</span><span className="font-mono">{computedSubtotal.toFixed(2)} ر.ي</span></div>
                                        {couponDiscount > 0 && <div className="flex justify-between text-green-600 dark:text-green-400"><span>الخصم:</span><span className="font-mono">- {couponDiscount.toFixed(2)} ر.ي</span></div>}
                                        {referralDiscount > 0 && <div className="flex justify-between text-green-600 dark:text-green-400"><span>خصم الدعوة:</span><span className="font-mono">- {referralDiscount.toFixed(2)} ر.ي</span></div>}
                                        {tierDiscount > 0 && <div className="flex justify-between text-green-600 dark:text-green-400"><span>خصم المستوى:</span><span className="font-mono">- {tierDiscount.toFixed(2)} ر.ي</span></div>}
                                        {pointsDiscount > 0 && <div className="flex justify-between text-green-600 dark:text-green-400"><span>خصم النقاط:</span><span className="font-mono">- {pointsDiscount.toFixed(2)} ر.ي</span></div>}
                                        <div className="flex justify-between text-gray-700 dark:text-gray-300"><span>رسوم التوصيل:</span><span className="font-mono">{(Number(effectiveDeliveryFee) || 0).toFixed(2)} ر.ي</span></div>
                                        <div className="border-t border-gray-200 dark:border-gray-600 my-2"></div>
                                        <div className="flex justify-between items-center font-bold text-lg">
                                            <span className="dark:text-white">الإجمالي:</span>
                                            <span className="text-2xl text-gold-500">{total.toFixed(2)} ر.ي</span>
                                        </div>
                                    </div>
                                    {error && <p className="text-red-500 text-center mt-4 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">{error}</p>}
                                    <div className="mt-6">
                                        <button type="submit" disabled={!canSubmit} className="w-full bg-primary-500 text-white font-bold py-4 px-6 rounded-lg shadow-lg hover:bg-primary-600 transition-transform transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-orange-300 disabled:bg-gray-400 disabled:scale-100 disabled:cursor-not-allowed">
                                            {isSubmitting ? 'جاري التأكيد...' : 'تأكيد الطلب'}
                                        </button>
                                    </div>
                                </section>
                            </div>
                        </div>
                    </div>
                </form>
            </div>
            
        </div>
    );
};

export default CheckoutScreen;
