import React, { useMemo, useState } from 'react';
import { useMenu } from '../../contexts/MenuContext';
import { useOrders } from '../../contexts/OrderContext';
import { useCashShift } from '../../contexts/CashShiftContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useStock } from '../../contexts/StockContext';
import type { MenuItem } from '../../types';
import PageLoader from '../../components/PageLoader';

const pickSellableItems = (items: MenuItem[], count: number): MenuItem[] => {
  const sellable = items.filter(m => (m.availableStock || 0) > 0 && (m.status || 'active') === 'active');
  sellable.sort((a, b) => (b.availableStock || 0) - (a.availableStock || 0));
  return sellable.slice(0, Math.max(1, Math.min(count, sellable.length)));
};

const POSTestConsole: React.FC = () => {
  const { menuItems, loading: menuLoading, fetchMenuItems } = useMenu();
  const { createInStoreSale, createInStorePendingOrder, resumeInStorePendingOrder, cancelInStorePendingOrder } = useOrders();
  const { currentShift, startShift } = useCashShift();
  const { settings } = useSettings();
  const { fetchStock } = useStock();
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const addLog = (line: string) => {
    const ts = new Date().toISOString();
    setLogs(prev => [`${ts} | ${line}`, ...prev].slice(0, 200));
  };

  const hasNetwork = settings.paymentMethods.network;
  const hasCash = settings.paymentMethods.cash;
  const hasKuraimi = settings.paymentMethods.kuraimi;

  const ready = useMemo(() => !menuLoading, [menuLoading]);

  const ensureDataReady = async () => {
    if (!ready || menuItems.length === 0) {
      await fetchMenuItems();
    }
  };

  const makeLines = (items: MenuItem[]) => {
    return items.map(i => {
      const isWeight = i.unitType === 'kg' || i.unitType === 'gram';
      return {
        menuItemId: i.id,
        quantity: isWeight ? undefined : 1,
        weight: isWeight ? Math.max(0.1, Number(i.minWeight || 0.1)) : undefined,
        selectedAddons: {},
      };
    });
  };

  const runPressureTest = async () => {
    setBusy(true);
    try {
      await ensureDataReady();
      const items = pickSellableItems(menuItems, 5);
      if (items.length === 0) {
        addLog('لا توجد أصناف قابلة للبيع للاختبار');
        return;
      }
      const lines = makeLines(items);
      const count = 5;
      for (let i = 0; i < count; i++) {
        const method = hasCash && currentShift ? 'cash' : (hasNetwork ? 'network' : (hasKuraimi ? 'kuraimi' : 'cash'));
        const breakdown = [{ method, amount: 0, referenceNumber: method !== 'cash' ? 'TEST123' : undefined, senderName: method !== 'cash' ? 'Tester' : undefined, declaredAmount: method !== 'cash' ? 0 : undefined, amountConfirmed: method !== 'cash' ? true : undefined, cashReceived: method === 'cash' ? 1000 : undefined }];
        await createInStoreSale({ lines, discountType: 'amount', discountValue: 0, paymentMethod: method, paymentBreakdown: breakdown });
        addLog(`Pressure: تم إنشاء بيع ${i + 1}/${count} بطريقة ${method}`);
      }
    } catch (err: any) {
      addLog(`Pressure: فشل - ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const runHoldResumeTest = async () => {
    setBusy(true);
    try {
      await ensureDataReady();
      const itemsA = pickSellableItems(menuItems, 2);
      const itemsB = pickSellableItems(menuItems.slice(1), 2);
      if (itemsA.length === 0 || itemsB.length === 0) {
        addLog('Hold/Resume: لا توجد أصناف كافية');
        return;
      }
      const pendingA = await createInStorePendingOrder({ lines: makeLines(itemsA), discountType: 'amount', discountValue: 0 });
      const pendingB = await createInStorePendingOrder({ lines: makeLines(itemsB), discountType: 'amount', discountValue: 0 });
      addLog(`Hold/Resume: تم تعليق فواتير ${pendingA.id.slice(0, 8)} و ${pendingB.id.slice(0, 8)}`);
      const method = hasNetwork ? 'network' : (hasKuraimi ? 'kuraimi' : (hasCash && currentShift ? 'cash' : 'network'));
      await resumeInStorePendingOrder(pendingB.id, { paymentMethod: method, paymentBreakdown: [{ method, amount: pendingB.total || 0, referenceNumber: method !== 'cash' ? 'TEST123' : undefined, senderName: method !== 'cash' ? 'Tester' : undefined, declaredAmount: method !== 'cash' ? pendingB.total || 0 : undefined, amountConfirmed: method !== 'cash' ? true : undefined, cashReceived: method === 'cash' ? 1000 : undefined }] });
      addLog(`Hold/Resume: تم استئناف ${pendingB.id.slice(0, 8)} أولًا بطريقة ${method}`);
      await resumeInStorePendingOrder(pendingA.id, { paymentMethod: method, paymentBreakdown: [{ method, amount: pendingA.total || 0, referenceNumber: method !== 'cash' ? 'TEST124' : undefined, senderName: method !== 'cash' ? 'Tester' : undefined, declaredAmount: method !== 'cash' ? pendingA.total || 0 : undefined, amountConfirmed: method !== 'cash' ? true : undefined, cashReceived: method === 'cash' ? 1000 : undefined }] });
      addLog(`Hold/Resume: تم استئناف ${pendingA.id.slice(0, 8)} ثانيًا بطريقة ${method}`);
    } catch (err: any) {
      addLog(`Hold/Resume: فشل - ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const runStockReservationTest = async () => {
    setBusy(true);
    try {
      await ensureDataReady();
      const items = pickSellableItems(menuItems, 1);
      if (items.length === 0) {
        addLog('Stock: لا توجد أصناف كافية');
        return;
      }
      const target = items[0];
      const pending = await createInStorePendingOrder({ lines: makeLines([target]), discountType: 'amount', discountValue: 0 });
      addLog(`Stock: تم تعليق ${pending.id.slice(0, 8)} للصنف ${target.name.ar}`);
      try {
        await createInStorePendingOrder({ lines: makeLines([target]), discountType: 'amount', discountValue: 0 });
        addLog('Stock: محاولة تعليق ثانية لنفس الصنف نجحت (قد يكون المخزون كافيًا)');
      } catch (err: any) {
        addLog(`Stock: تعليق ثانية رفض بسبب الحجز - ${err?.message || String(err)}`);
      }
      await cancelInStorePendingOrder(pending.id);
      addLog(`Stock: تم إلغاء التعليق للصنف ${target.name.ar}`);
      await fetchStock();
      addLog('Stock: تم تحديث المخزون بعد الإلغاء');
    } catch (err: any) {
      addLog(`Stock: فشل - ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const runShiftTests = async () => {
    setBusy(true);
    try {
      await ensureDataReady();
      const items = pickSellableItems(menuItems, 2);
      if (items.length === 0) {
        addLog('Shift: لا توجد أصناف كافية');
        return;
      }
      const lines = makeLines(items);
      if (!currentShift) {
        try {
          await createInStoreSale({ lines, discountType: 'amount', discountValue: 0, paymentMethod: 'cash', paymentBreakdown: [{ method: 'cash', amount: 0, cashReceived: 1000 }] });
          addLog('Shift: تحذير - تم تمرير بيع نقدي بدون وردية (قد تكون القيود غير مفعلة في البيئة)');
        } catch (err: any) {
          addLog(`Shift: رفض النقدي بدون وردية (متوقع) - ${err?.message || String(err)}`);
        }
      }
      const nonCashMethod = hasNetwork ? 'network' : (hasKuraimi ? 'kuraimi' : 'network');
      try {
        await createInStoreSale({ lines, discountType: 'amount', discountValue: 0, paymentMethod: nonCashMethod, paymentBreakdown: [{ method: nonCashMethod, amount: 0, referenceNumber: 'TESTNET', senderName: 'Tester', declaredAmount: 0, amountConfirmed: true }] });
        addLog('Shift: بيع غير نقدي بدون وردية تم (تحذير فقط)');
      } catch (err: any) {
        addLog(`Shift: فشل غير النقدي بدون وردية - ${err?.message || String(err)}`);
      }
      if (!currentShift) {
        try {
          await startShift(100);
          addLog('Shift: تم فتح وردية بمبلغ بداية 100');
        } catch (err: any) {
          addLog(`Shift: فشل فتح وردية - ${err?.message || String(err)}`);
        }
      }
      try {
        await createInStoreSale({ lines, discountType: 'amount', discountValue: 0, paymentMethod: 'cash', paymentBreakdown: [{ method: 'cash', amount: 0, cashReceived: 1000 }] });
        addLog('Shift: بيع نقدي مع وردية مفتوحة تم بنجاح');
      } catch (err: any) {
        addLog(`Shift: فشل بيع نقدي مع وردية - ${err?.message || String(err)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const runPaymentTests = async () => {
    setBusy(true);
    try {
      await ensureDataReady();
      const items = pickSellableItems(menuItems, 2);
      if (items.length === 0) {
        addLog('Payment: لا توجد أصناف كافية');
        return;
      }
      const lines = makeLines(items);
      if (hasCash && currentShift) {
        await createInStoreSale({ lines, discountType: 'amount', discountValue: 0, paymentMethod: 'cash', paymentBreakdown: [{ method: 'cash', amount: 0, cashReceived: 1000 }] });
        addLog('Payment: نقدي تم');
      }
      if (hasNetwork) {
        await createInStoreSale({ lines, discountType: 'amount', discountValue: 0, paymentMethod: 'network', paymentBreakdown: [{ method: 'network', amount: 0, referenceNumber: 'NET123', senderName: 'Tester', declaredAmount: 0, amountConfirmed: true }] });
        addLog('Payment: شبكة/تحويل تم');
      } else if (hasKuraimi) {
        await createInStoreSale({ lines, discountType: 'amount', discountValue: 0, paymentMethod: 'kuraimi', paymentBreakdown: [{ method: 'kuraimi', amount: 0, referenceNumber: 'KR123', senderName: 'Tester', declaredAmount: 0, amountConfirmed: true }] });
        addLog('Payment: كريمي تم');
      }
      if (hasCash && (hasNetwork || hasKuraimi) && currentShift) {
        const other = hasNetwork ? 'network' : 'kuraimi';
        await createInStoreSale({
          lines,
          discountType: 'amount',
          discountValue: 0,
          paymentMethod: 'mixed',
          paymentBreakdown: [
            { method: 'cash', amount: 0, cashReceived: 500 },
            { method: other, amount: 0, referenceNumber: 'MIX123', senderName: 'Tester', declaredAmount: 0, amountConfirmed: true },
          ]
        });
        addLog('Payment: Mixed تم');
      }
    } catch (err: any) {
      addLog(`Payment: فشل - ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  if (menuLoading) return <PageLoader />;

  React.useEffect(() => {
    const runAll = async () => {
      if (busy) return;
      setBusy(true);
      try {
        await ensureDataReady();
        await runPressureTest();
        console.log('[POS Test] Pressure completed');
        await runHoldResumeTest();
        console.log('[POS Test] Hold/Resume completed');
        await runStockReservationTest();
        console.log('[POS Test] Stock reservation completed');
        await runShiftTests();
        console.log('[POS Test] Shift tests completed');
        await runPaymentTests();
        console.log('[POS Test] Payment tests completed');
      } catch (err) {
        console.log('[POS Test] Unexpected error', err);
      } finally {
        setBusy(false);
      }
    };
    void runAll();
  }, []);

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <h1 className="text-2xl font-bold mb-4 dark:text-white">POS Operational Testing</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button onClick={runPressureTest} disabled={busy} className="px-4 py-3 rounded-lg bg-primary-500 text-white disabled:opacity-50">ضغط كاشير: بيع متتالي</button>
        <button onClick={runHoldResumeTest} disabled={busy} className="px-4 py-3 rounded-lg bg-primary-500 text-white disabled:opacity-50">Hold/Resume متعدد</button>
        <button onClick={runStockReservationTest} disabled={busy} className="px-4 py-3 rounded-lg bg-primary-500 text-white disabled:opacity-50">اختبار الحجز/الإفراج للمخزون</button>
        <button onClick={runShiftTests} disabled={busy} className="px-4 py-3 rounded-lg bg-primary-500 text-white disabled:opacity-50">اختبارات الوردية</button>
        <button onClick={runPaymentTests} disabled={busy} className="px-4 py-3 rounded-lg bg-primary-500 text-white disabled:opacity-50">اختبارات الدفع</button>
      </div>
      <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow p-4">
        <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">Logs</div>
        <div className="max-h-64 overflow-auto space-y-1 font-mono text-xs">
          {logs.map((l, idx) => (
            <div key={idx} className="text-gray-800 dark:text-gray-200">{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default POSTestConsole;
