import React, { useEffect, useMemo, useState } from 'react';
import type { Promotion, PromotionDiscountMode, PromotionItem } from '../../types';
import { useMenu } from '../../contexts/MenuContext';

type PromotionDraft = Omit<Promotion, 'id' | 'items'> & { id?: string; items: PromotionItem[] };

interface PromotionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (input: { promotion: PromotionDraft; activate: boolean }) => Promise<void> | void;
  promotionToEdit: Promotion | null;
  isSaving: boolean;
}

const toLocalDateTimeValue = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const PromotionFormModal: React.FC<PromotionFormModalProps> = ({ isOpen, onClose, onSave, promotionToEdit, isSaving }) => {
  const { menuItems } = useMenu();

  const sortedMenuItems = useMemo(() => {
    return [...(menuItems || [])].sort((a, b) => (a.name?.ar || '').localeCompare(b.name?.ar || '', 'ar'));
  }, [menuItems]);

  const getInitial = (): PromotionDraft => ({
    id: undefined,
    name: '',
    startAt: new Date().toISOString(),
    endAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    isActive: false,
    discountMode: 'fixed_total',
    fixedTotal: 0,
    percentOff: undefined,
    displayOriginalTotal: undefined,
    maxUses: undefined,
    exclusiveWithCoupon: true,
    requiresApproval: false,
    approvalStatus: 'approved',
    approvalRequestId: null,
    items: [],
  });

  const [draft, setDraft] = useState<PromotionDraft>(getInitial);
  const [activateOnSave, setActivateOnSave] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (promotionToEdit) {
      setDraft({
        id: promotionToEdit.id,
        name: promotionToEdit.name || '',
        startAt: promotionToEdit.startAt,
        endAt: promotionToEdit.endAt,
        isActive: promotionToEdit.isActive,
        discountMode: promotionToEdit.discountMode,
        fixedTotal: promotionToEdit.fixedTotal ?? 0,
        percentOff: promotionToEdit.percentOff,
        displayOriginalTotal: promotionToEdit.displayOriginalTotal,
        maxUses: promotionToEdit.maxUses,
        exclusiveWithCoupon: promotionToEdit.exclusiveWithCoupon ?? true,
        requiresApproval: promotionToEdit.requiresApproval,
        approvalStatus: promotionToEdit.approvalStatus,
        approvalRequestId: promotionToEdit.approvalRequestId ?? null,
        items: Array.isArray(promotionToEdit.items) ? promotionToEdit.items.map((it) => ({ ...it })) : [],
      });
    } else {
      setDraft(getInitial());
    }
    setActivateOnSave(false);
  }, [promotionToEdit, isOpen]);

  const setDiscountMode = (mode: PromotionDiscountMode) => {
    setDraft((prev) => ({
      ...prev,
      discountMode: mode,
      fixedTotal: mode === 'fixed_total' ? (prev.fixedTotal ?? 0) : undefined,
      percentOff: mode === 'percent_off' ? (prev.percentOff ?? 10) : undefined,
    }));
  };

  const addItem = () => {
    const first = sortedMenuItems[0];
    if (!first) return;
    setDraft((prev) => ({
      ...prev,
      items: [...prev.items, { itemId: first.id, quantity: 1, sortOrder: prev.items.length }],
    }));
  };

  const removeItem = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx).map((it, i) => ({ ...it, sortOrder: i })),
    }));
  };

  const updateItem = (idx: number, patch: Partial<PromotionItem>) => {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      promotion: {
        ...draft,
        startAt: new Date(draft.startAt).toISOString(),
        endAt: new Date(draft.endAt).toISOString(),
        fixedTotal: draft.discountMode === 'fixed_total' ? Number(draft.fixedTotal) || 0 : undefined,
        percentOff: draft.discountMode === 'percent_off' ? Number(draft.percentOff) || 0 : undefined,
        displayOriginalTotal: draft.displayOriginalTotal ? Number(draft.displayOriginalTotal) : undefined,
        maxUses: draft.maxUses ? Number(draft.maxUses) : undefined,
      },
      activate: activateOnSave,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl animate-fade-in-up max-h-[min(90dvh,calc(100dvh-2rem))] overflow-hidden flex flex-col">
        <div className="p-6 border-b dark:border-gray-700">
          <h2 className="text-xl font-bold dark:text-white">{promotionToEdit ? 'تعديل عرض' : 'إضافة عرض'}</h2>
        </div>
        <form onSubmit={handleSubmit} className="min-h-0 flex-1 flex flex-col">
          <div className="p-6 space-y-4 overflow-y-auto min-h-0 flex-1">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">اسم العرض</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                required
                className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">بداية العرض</label>
                <input
                  type="datetime-local"
                  value={toLocalDateTimeValue(draft.startAt)}
                  onChange={(e) => setDraft((prev) => ({ ...prev, startAt: new Date(e.target.value).toISOString() }))}
                  required
                  className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">نهاية العرض</label>
                <input
                  type="datetime-local"
                  value={toLocalDateTimeValue(draft.endAt)}
                  onChange={(e) => setDraft((prev) => ({ ...prev, endAt: new Date(e.target.value).toISOString() }))}
                  required
                  className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">نوع التخفيض</label>
                <select
                  value={draft.discountMode}
                  onChange={(e) => setDiscountMode(e.target.value as PromotionDiscountMode)}
                  className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                >
                  <option value="fixed_total">سعر نهائي</option>
                  <option value="percent_off">نسبة خصم</option>
                </select>
              </div>
              {draft.discountMode === 'fixed_total' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">السعر النهائي</label>
                  <input
                    type="number"
                    value={draft.fixedTotal ?? 0}
                    onChange={(e) => setDraft((prev) => ({ ...prev, fixedTotal: Number(e.target.value) || 0 }))}
                    min={0}
                    required
                    className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">نسبة الخصم %</label>
                  <input
                    type="number"
                    value={draft.percentOff ?? 0}
                    onChange={(e) => setDraft((prev) => ({ ...prev, percentOff: Number(e.target.value) || 0 }))}
                    min={0}
                    max={100}
                    required
                    className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">السعر الأصلي (اختياري)</label>
                <input
                  type="number"
                  value={draft.displayOriginalTotal ?? ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, displayOriginalTotal: e.target.value ? Number(e.target.value) : undefined }))}
                  min={0}
                  className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">حد الاستخدام (اختياري)</label>
                <input
                  type="number"
                  value={draft.maxUses ?? ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, maxUses: e.target.value ? Number(e.target.value) : undefined }))}
                  min={0}
                  className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  checked={draft.exclusiveWithCoupon ?? true}
                  onChange={(e) => setDraft((prev) => ({ ...prev, exclusiveWithCoupon: e.target.checked }))}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">منع الدمج مع كوبون</span>
              </div>
            </div>

            <div className="border rounded-md p-4 dark:border-gray-700">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-bold dark:text-white">الأصناف داخل العرض</h3>
                <button
                  type="button"
                  onClick={addItem}
                  className="bg-primary-500 text-white font-bold py-1 px-3 rounded-md hover:bg-primary-600"
                >
                  إضافة صنف
                </button>
              </div>

              {draft.items.length === 0 ? (
                <div className="mt-3 text-sm text-gray-500 dark:text-gray-400">لا توجد أصناف بعد</div>
              ) : (
                <div className="mt-3 space-y-3">
                  {draft.items.map((it, idx) => (
                    <div key={`${it.itemId}:${idx}`} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                      <div className="md:col-span-7">
                        <label className="block text-xs text-gray-600 dark:text-gray-400">الصنف</label>
                        <select
                          value={it.itemId}
                          onChange={(e) => updateItem(idx, { itemId: e.target.value })}
                          className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                        >
                          {sortedMenuItems.map((mi) => (
                            <option key={mi.id} value={mi.id}>{mi.name?.ar || mi.id}</option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-3">
                        <label className="block text-xs text-gray-600 dark:text-gray-400">الكمية</label>
                        <input
                          type="number"
                          value={it.quantity}
                          onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) || 0 })}
                          min={0}
                          className="mt-1 w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                        />
                      </div>
                      <div className="md:col-span-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="py-2 px-3 bg-red-600 text-white rounded-md hover:bg-red-700"
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={activateOnSave}
                onChange={(e) => setActivateOnSave(e.target.checked)}
                className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">تفعيل العرض بعد الحفظ</span>
            </div>
          </div>

          <div className="p-6 bg-gray-50 dark:bg-gray-700 flex justify-end space-x-3 rtl:space-x-reverse shrink-0">
            <button type="button" onClick={onClose} disabled={isSaving} className="py-2 px-4 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:opacity-50">إلغاء</button>
            <button type="submit" disabled={isSaving} className="py-2 px-4 bg-primary-500 text-white rounded-md hover:bg-primary-600 w-28 disabled:bg-primary-400 disabled:cursor-wait">
              {isSaving ? 'جاري...' : 'حفظ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PromotionFormModal;

