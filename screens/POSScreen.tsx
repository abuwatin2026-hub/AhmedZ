import React, { useMemo, useState } from 'react';
import type { CartItem, MenuItem } from '../types';
import { useToast } from '../contexts/ToastContext';
import { useOrders } from '../contexts/OrderContext';
import { useCashShift } from '../contexts/CashShiftContext';
import POSHeaderShiftStatus from '../components/pos/POSHeaderShiftStatus';
import POSItemSearch from '../components/pos/POSItemSearch';
import POSLineItemList from '../components/pos/POSLineItemList';
import POSTotals from '../components/pos/POSTotals';
import POSPaymentPanel from '../components/pos/POSPaymentPanel';

const POSScreen: React.FC = () => {
  const { showNotification } = useToast();
  const { createInStoreSale, createInStorePendingOrder, resumeInStorePendingOrder, cancelInStorePendingOrder } = useOrders();
  const { currentShift } = useCashShift();
  const [items, setItems] = useState<CartItem[]>([]);
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);

  const addLine = (item: MenuItem, input: { quantity?: number; weight?: number }) => {
    const isWeight = item.unitType === 'kg' || item.unitType === 'gram';
    const qty = isWeight ? 1 : Number(input.quantity || 0);
    const wt = isWeight ? Number(input.weight || 0) : undefined;
    if (!isWeight && !(qty > 0)) return;
    if (isWeight && !(wt && wt > 0)) return;
    const cartItem: CartItem = {
      ...item,
      quantity: qty,
      weight: wt,
      selectedAddons: {},
      cartItemId: crypto.randomUUID(),
      unit: item.unitType || 'piece',
    };
    setItems(prev => [cartItem, ...prev]);
  };

  const updateLine = (cartItemId: string, next: { quantity?: number; weight?: number }) => {
    setItems(prev =>
      prev.map(i => {
        if (i.cartItemId !== cartItemId) return i;
        const isWeight = i.unitType === 'kg' || i.unitType === 'gram';
        return {
          ...i,
          quantity: isWeight ? 1 : Number(next.quantity ?? i.quantity),
          weight: isWeight ? Number(next.weight ?? i.weight) : undefined,
        };
      })
    );
  };

  const removeLine = (cartItemId: string) => {
    setItems(prev => prev.filter(i => i.cartItemId !== cartItemId));
  };

  const subtotal = useMemo(() => {
    return items.reduce((total, item) => {
      const addonsPrice = Object.values(item.selectedAddons || {}).reduce(
        (sum, { addon, quantity }) => sum + addon.price * quantity,
        0
      );
      let itemPrice = item.price;
      let itemQuantity = item.quantity;
      if (item.unitType === 'kg' || item.unitType === 'gram') {
        itemQuantity = item.weight || item.quantity;
        if (item.unitType === 'gram' && item.pricePerUnit) {
          itemPrice = item.pricePerUnit / 1000;
        }
      }
      return total + (itemPrice + addonsPrice) * itemQuantity;
    }, 0);
  }, [items]);

  const discountAmount = useMemo(() => {
    if (subtotal <= 0) return 0;
    if (discountType === 'percent') {
      const pct = Math.max(0, Math.min(100, Number(discountValue) || 0));
      return (pct * subtotal) / 100;
    }
    const amt = Math.max(0, Math.min(subtotal, Number(discountValue) || 0));
    return amt;
  }, [discountType, discountValue, subtotal]);

  const total = useMemo(() => {
    const base = Math.max(0, subtotal - discountAmount);
    return base;
  }, [subtotal, discountAmount]);

  const handleHold = () => {
    if (items.length === 0) return;
    const lines = items.map(i => {
      const isWeight = i.unitType === 'kg' || i.unitType === 'gram';
      const addons: Record<string, number> = {};
      Object.entries(i.selectedAddons || {}).forEach(([id, { quantity }]) => {
        if (quantity > 0) addons[id] = quantity;
      });
      return {
        menuItemId: i.id,
        quantity: isWeight ? undefined : i.quantity,
        weight: isWeight ? (i.weight || 0) : undefined,
        selectedAddons: addons
      };
    });
    createInStorePendingOrder({
      lines,
      discountType,
      discountValue
    }).then(order => {
      setPendingOrderId(order.id);
      showNotification('تم تعليق الفاتورة', 'info');
    }).catch(err => {
      const msg = err instanceof Error ? err.message : 'فشل تعليق الفاتورة';
      showNotification(msg, 'error');
    });
  };

  const handleCancelHold = () => {
    if (!pendingOrderId) return;
    cancelInStorePendingOrder(pendingOrderId).then(() => {
      setPendingOrderId(null);
      showNotification('تم إلغاء التعليق وإفراج الحجز', 'info');
    }).catch(err => {
      const msg = err instanceof Error ? err.message : 'فشل إلغاء التعليق';
      showNotification(msg, 'error');
    });
  };

  const handleFinalize = (payload: { method: string; amount: number; cashReceived?: number }) => {
    if (items.length === 0) return;
    if (!(payload.amount > 0)) return;
    if (payload.method === 'cash' && !currentShift) {
      showNotification('لا توجد وردية مفتوحة: الدفع النقدي غير مسموح.', 'error');
      return;
    }
    if (payload.method !== 'cash' && !currentShift) {
      showNotification('تحذير: لا توجد وردية مفتوحة. الدفع غير النقدي مسموح.', 'info');
    }
    const lines = items.map(i => {
      const isWeight = i.unitType === 'kg' || i.unitType === 'gram';
      const addons: Record<string, number> = {};
      Object.entries(i.selectedAddons || {}).forEach(([id, { quantity }]) => {
        if (quantity > 0) addons[id] = quantity;
      });
      return {
        menuItemId: i.id,
        quantity: isWeight ? undefined : i.quantity,
        weight: isWeight ? (i.weight || 0) : undefined,
        selectedAddons: addons
      };
    });
    if (pendingOrderId) {
      resumeInStorePendingOrder(pendingOrderId, {
        paymentMethod: payload.method,
        paymentBreakdown: [{ method: payload.method, amount: total, cashReceived: payload.cashReceived }],
      }).then(() => {
        setPendingOrderId(null);
        setItems([]);
        showNotification('تم إتمام الطلب المستأنف', 'success');
      }).catch(err => {
        const msg = err instanceof Error ? err.message : 'فشل إتمام الطلب المستأنف';
        showNotification(msg, 'error');
      });
    } else {
      createInStoreSale({
        lines,
        discountType,
        discountValue,
        paymentMethod: payload.method,
        paymentBreakdown: [{ method: payload.method, amount: total, cashReceived: payload.cashReceived }]
      }).then(() => {
        setItems([]);
        showNotification('تم إتمام الطلب مباشرة', 'success');
      }).catch(err => {
        const msg = err instanceof Error ? err.message : 'فشل إتمام الطلب';
        showNotification(msg, 'error');
      });
    }
  };

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="py-4">
        <POSHeaderShiftStatus />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4">
            <POSItemSearch onAddLine={addLine} />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4">
            <POSLineItemList items={items} onUpdate={updateLine} onRemove={removeLine} />
          </div>
        </div>
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <select
                value={discountType}
                onChange={e => setDiscountType(e.target.value as 'amount' | 'percent')}
                className="p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              >
                <option value="amount">خصم مبلغ</option>
                <option value="percent">خصم نسبة</option>
              </select>
              <input
                type="number"
                step={discountType === 'percent' ? '1' : '0.01'}
                value={discountValue}
                onChange={e => setDiscountValue(Number(e.target.value) || 0)}
                className="flex-1 p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                placeholder={discountType === 'percent' ? '0 - 100' : '0.00'}
              />
            </div>
            <POSTotals subtotal={subtotal} discountAmount={discountAmount} total={total} />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4">
            <POSPaymentPanel
              total={total}
              canFinalize={items.length > 0}
              onHold={handleHold}
              onFinalize={handleFinalize}
              pendingOrderId={pendingOrderId}
              onCancelHold={handleCancelHold}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default POSScreen;
