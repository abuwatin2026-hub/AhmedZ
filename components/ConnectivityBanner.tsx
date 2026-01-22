import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useOrders } from '../contexts/OrderContext';
import { useMenu } from '../contexts/MenuContext';
import { useUserAuth } from '../contexts/UserAuthContext';
import { useDeliveryZones } from '../contexts/DeliveryZoneContext';
import { processQueue, queueSize } from '../utils/offlineQueue';

const ConnectivityBanner: React.FC = () => {
  const location = useLocation();
  const { fetchOrders } = useOrders();
  const { fetchMenuItems } = useMenu();
  const { fetchCustomers } = useUserAuth();
  const { fetchDeliveryZones } = useDeliveryZones();
  const [online, setOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const [connectionInfo, setConnectionInfo] = useState<{ effectiveType: string; downlink?: number; rtt?: number; saveData?: boolean }>(() => {
    const conn: any = (typeof navigator !== 'undefined' && (navigator as any).connection) ? (navigator as any).connection : null;
    return {
      effectiveType: typeof conn?.effectiveType === 'string' ? conn.effectiveType : '',
      downlink: typeof conn?.downlink === 'number' ? conn.downlink : undefined,
      rtt: typeof conn?.rtt === 'number' ? conn.rtt : undefined,
      saveData: typeof conn?.saveData === 'boolean' ? conn.saveData : undefined,
    };
  });
  const [pendingCount, setPendingCount] = useState<number>(() => queueSize());
  const [refreshing, setRefreshing] = useState(false);
  const [flushing, setFlushing] = useState(false);

  const hasConnectionInfo = useMemo(() => {
    return Boolean(connectionInfo.effectiveType)
      || typeof connectionInfo.downlink === 'number'
      || typeof connectionInfo.rtt === 'number'
      || typeof connectionInfo.saveData === 'boolean';
  }, [connectionInfo.downlink, connectionInfo.effectiveType, connectionInfo.rtt, connectionInfo.saveData]);

  const isWeak = useMemo(() => {
    if (!hasConnectionInfo) return false;
    const eff = String(connectionInfo.effectiveType || '');
    if (eff === 'slow-2g' || eff === '2g') return true;
    const rtt = connectionInfo.rtt;
    const downlink = connectionInfo.downlink;
    if (typeof rtt === 'number' && Number.isFinite(rtt) && rtt >= 1000) return true;
    if (typeof downlink === 'number' && Number.isFinite(downlink) && downlink > 0 && downlink <= 0.7) return true;
    return false;
  }, [connectionInfo.downlink, connectionInfo.effectiveType, connectionInfo.rtt, hasConnectionInfo]);
  const isAdminRoute = useMemo(() => location.pathname.startsWith('/admin'), [location.pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => {
      setOnline(true);
      setTimeout(async () => {
        await processQueue();
        setPendingCount(queueSize());
      }, 200);
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const conn: any = (typeof navigator !== 'undefined' && (navigator as any).connection) ? (navigator as any).connection : null;
    const onConnChange = () => setConnectionInfo({
      effectiveType: typeof conn?.effectiveType === 'string' ? conn.effectiveType : '',
      downlink: typeof conn?.downlink === 'number' ? conn.downlink : undefined,
      rtt: typeof conn?.rtt === 'number' ? conn.rtt : undefined,
      saveData: typeof conn?.saveData === 'boolean' ? conn.saveData : undefined,
    });
    if (conn?.addEventListener) conn.addEventListener('change', onConnChange);
    const timer = setInterval(() => setPendingCount(queueSize()), 5000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (conn?.removeEventListener) conn.removeEventListener('change', onConnChange);
      clearInterval(timer);
    };
  }, []);

  const refreshAll = async () => {
    if (!online) return;
    if (refreshing) return;
    if (typeof window !== 'undefined') {
      setRefreshing(true);
      window.location.reload();
      return;
    }
    setRefreshing(true);
    try {
      const jobs: Array<Promise<unknown>> = [fetchOrders(), fetchMenuItems(), fetchDeliveryZones()];
      if (isAdminRoute) jobs.push(fetchCustomers());
      await Promise.allSettled(jobs);
    } finally {
      setRefreshing(false);
    }
  };

  const flushQueue = async () => {
    if (!online) return;
    if (flushing) return;
    setFlushing(true);
    try {
      await processQueue();
      setPendingCount(queueSize());
    } finally {
      setFlushing(false);
    }
  };

  if (online && !isWeak && pendingCount === 0) return null;

  const base = 'w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2 text-xs sm:text-sm font-semibold';
  const style = !online
    ? 'bg-red-600 text-white'
    : 'bg-amber-500 text-black';

  const title = !online ? 'لا يوجد اتصال بالإنترنت' : (isWeak ? 'الإنترنت ضعيف' : 'هناك تحديثات غير مُرسلة');

  return (
    <div className={`${base} ${style}`}>
      <span className="min-w-0 break-words">
        {title}{pendingCount > 0 ? ` • عمليات متأخرة: ${pendingCount}` : ''}
      </span>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={refreshAll}
          disabled={!online || refreshing || flushing}
          className="px-2 py-1 rounded bg-white/20 hover:bg-white/30 disabled:opacity-60 disabled:pointer-events-none"
        >
          {refreshing ? 'جاري التحديث…' : 'تحديث الآن'}
        </button>
        {pendingCount > 0 && (
          <button
            onClick={flushQueue}
            disabled={!online || refreshing || flushing}
            className="px-2 py-1 rounded bg-white/20 hover:bg-white/30 disabled:opacity-60 disabled:pointer-events-none"
          >
            {flushing ? 'جاري الإرسال…' : 'إرسال التحديثات'}
          </button>
        )}
      </div>
    </div>
  );
};

export default ConnectivityBanner;
