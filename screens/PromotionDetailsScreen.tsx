import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePromotions } from '../contexts/PromotionContext';
import { useCart } from '../contexts/CartContext';
import { useToast } from '../contexts/ToastContext';
import { useSettings } from '../contexts/SettingsContext';
import { useMenu } from '../contexts/MenuContext';
import YemeniPattern from '../components/YemeniPattern';

const PromotionDetailsScreen: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { activePromotions, refreshActivePromotions, adminPromotions } = usePromotions() as any;
  const { addPromotionToCart } = useCart();
  const { showNotification } = useToast();
  const { language } = useSettings();
  const { menuItems } = useMenu();
  const [bundleQty, setBundleQty] = useState<number>(1);

  useEffect(() => {
    void refreshActivePromotions();
  }, [refreshActivePromotions]);

  const promoSnapshot = useMemo(() => {
    return activePromotions.find((p: any) => String(p.promotionId) === String(id));
  }, [activePromotions, id]);

  const promoMeta = useMemo(() => {
    return adminPromotions.find((p: any) => String(p.id) === String(id));
  }, [adminPromotions, id]);

  const isActive = Boolean(promoSnapshot);
  const name = promoSnapshot?.name || promoMeta?.name || '';
  const imageUrl = promoSnapshot?.imageUrl || promoMeta?.imageUrl || '';
  const currencyCode = String((promoSnapshot?.currency || promoMeta?.currency || '')).toUpperCase() || '—';
  const original = promoSnapshot ? (typeof promoSnapshot.displayOriginalTotal === 'number' && promoSnapshot.displayOriginalTotal > 0 ? promoSnapshot.displayOriginalTotal : promoSnapshot.computedOriginalTotal) : undefined;
  const finalTotal = promoSnapshot?.finalTotal ?? undefined;

  const endText = useMemo(() => {
    if (!promoSnapshot) return '';
    const endAt = new Date(promoSnapshot.endAt).getTime();
    const now = Date.now();
    const remainingMs = Math.max(0, endAt - now);
    const remainingMin = Math.floor(remainingMs / 60000);
    const hours = Math.floor(remainingMin / 60);
    const minutes = remainingMin % 60;
    return remainingMs > 0 ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}` : '00:00';
  }, [promoSnapshot]);

  const items = promoSnapshot?.items || [];

  const handleAdd = async () => {
    if (!id) return;
    try {
      await addPromotionToCart({ promotionId: String(id), bundleQty: Math.max(1, Number(bundleQty) || 1) });
      navigate('/cart');
    } catch (err: any) {
      showNotification(err?.message || 'تعذر إضافة العرض إلى السلة', 'error');
    }
  };

  return (
    <div className="min-h-screen min-h-dvh font-sans">
      <div className="relative">
        <div className="h-52 sm:h-64 bg-gradient-to-r from-gold-500 to-primary-600 relative overflow-hidden">
          <div className="absolute inset-x-0 top-0"><YemeniPattern type="zigzag" color="gold" /></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <h1 className="text-2xl sm:text-4xl font-black text-white">{name}</h1>
          </div>
        </div>
        <div className="-mt-16 sm:-mt-20 container mx-auto max-w-screen-lg px-3 sm:px-6">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gold-500/20 overflow-hidden">
            {imageUrl ? (
              <img src={imageUrl} alt={name} className="w-full h-48 sm:h-64 object-cover" />
            ) : null}
            <div className="p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white">{name}</div>
                  {isActive && (
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      {typeof original === 'number' ? <span className="line-through text-gray-400 dark:text-gray-500">{original.toFixed(2)} {currencyCode}</span> : null}
                      {typeof finalTotal === 'number' ? <span className="mx-2">→</span> : null}
                      {typeof finalTotal === 'number' ? <span className="text-red-600 dark:text-red-400 font-extrabold">{Number(finalTotal || 0).toFixed(2)} {currencyCode}</span> : null}
                    </div>
                  )}
                </div>
                {isActive && <div className="shrink-0 text-xs font-bold px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">{endText}</div>}
              </div>

              <div className="border rounded-lg p-3 dark:border-gray-700">
                <div className="font-bold text-gray-800 dark:text-gray-200 mb-2">الأصناف داخل العرض</div>
                {items.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">لا توجد تفاصيل عناصر لهذا العرض.</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {items.map((it: any, idx: number) => {
                      const mi = menuItems.find(m => String(m.id) === String(it.itemId));
                      const title = mi?.name?.[language] || mi?.name?.ar || mi?.name?.en || it.itemId;
                      const img = mi?.imageUrl || '';
                      const unitLabel = language === 'ar' ? 'حبة' : 'pcs';
                      return (
                        <div key={`${it.itemId}:${idx}`} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700 flex items-center gap-3">
                          <div className="relative w-16 h-16 rounded-md overflow-hidden border border-gray-200 dark:border-gray-700">
                            {img ? <img src={img} alt={title} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gray-200 dark:bg-gray-700"></div>}
                            <span className="absolute top-0 right-0 px-1 py-0.5 bg-black/70 text-white text-[10px] rounded-bl">×{Number(it.quantity || 0)}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{title}</div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">الكمية: {Number(it.quantity || 0)} {unitLabel}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {isActive ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">الكمية</label>
                    <input
                      type="number"
                      min={1}
                      value={bundleQty}
                      onChange={(e) => setBundleQty(Math.max(1, Number(e.target.value) || 1))}
                      className="w-20 p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAdd}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-semibold"
                  >
                    أضف إلى السلة
                  </button>
                </div>
              ) : (
                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-700 dark:text-yellow-300">
                  هذا العرض غير مفعل حاليًا.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PromotionDetailsScreen;
