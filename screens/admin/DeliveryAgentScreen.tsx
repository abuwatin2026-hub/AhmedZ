/**
 * DeliveryAgentScreen.tsx
 * Screen for delivery agents to share their live GPS location.
 * Shows on the admin map in real-time.
 * Accessible via /admin/driver-location (only for 'delivery' role)
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

type TrackingStatus = 'idle' | 'tracking' | 'error';

export default function DeliveryAgentScreen() {
  const { user } = useAuth();
  const { showNotification } = useToast();
  const supabase = getSupabaseClient();

  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [currentPos, setCurrentPos] = useState<GeolocationPosition | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [lastSent, setLastSent] = useState<Date | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const sendIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestPosRef = useRef<GeolocationPosition | null>(null);

  const sendLocation = useCallback(async (pos: GeolocationPosition) => {
    if (!supabase) return;
    try {
      await supabase.rpc('upsert_driver_location', {
        p_latitude: pos.coords.latitude,
        p_longitude: pos.coords.longitude,
        p_accuracy: pos.coords.accuracy ?? null,
        p_heading: pos.coords.heading ?? null,
        p_speed: pos.coords.speed ?? null,
      } as any);
      setLastSent(new Date());
    } catch (err) {
      console.error('Failed to send location:', err);
    }
  }, [supabase]);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setErrorMsg('جهازك لا يدعم GPS.');
      setStatus('error');
      return;
    }

    setStatus('tracking');
    setErrorMsg('');

    // Watch GPS position
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        latestPosRef.current = pos;
        setCurrentPos(pos);
      },
      (err) => {
        setErrorMsg(
          err.code === 1
            ? 'تم رفض إذن الموقع. يرجى منح الإذن من إعدادات المتصفح.'
            : err.code === 2
            ? 'تعذر تحديد الموقع. تأكد من تشغيل GPS.'
            : 'خطأ في GPS: ' + err.message
        );
        setStatus('error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );

    // Send to server every 15 seconds
    sendIntervalRef.current = setInterval(() => {
      if (latestPosRef.current) {
        void sendLocation(latestPosRef.current);
      }
    }, 15000);

    // Send immediately on start
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        latestPosRef.current = pos;
        setCurrentPos(pos);
        void sendLocation(pos);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [sendLocation]);

  const stopTracking = useCallback(async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }
    // Mark as offline
    if (supabase) {
      await supabase.rpc('set_driver_offline');
    }
    setStatus('idle');
    setCurrentPos(null);
    setLastSent(null);
    showNotification('تم إيقاف مشاركة الموقع.', 'info');
  }, [supabase, showNotification]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (sendIntervalRef.current) clearInterval(sendIntervalRef.current);
      // Mark offline
      if (supabase) void supabase.rpc('set_driver_offline');
    };
  }, [supabase]);

  const coords = currentPos?.coords;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex flex-col items-center justify-center p-6 select-none" dir="rtl">

      {/* Header */}
      <div className="text-center mb-10">
        <div className="text-6xl mb-4">🛵</div>
        <h1 className="text-3xl font-bold text-white mb-1">مندوب التوصيل</h1>
        <p className="text-gray-400">{user?.fullName || 'مندوب'}</p>
      </div>

      {/* Status Card */}
      <div className={`w-full max-w-sm rounded-3xl p-6 mb-8 border-2 transition-all duration-500 ${
        status === 'tracking'
          ? 'bg-emerald-900/30 border-emerald-500 shadow-emerald-500/20 shadow-lg'
          : status === 'error'
          ? 'bg-red-900/30 border-red-500'
          : 'bg-gray-800/50 border-gray-600'
      }`}>

        {/* Status Indicator */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-3 h-3 rounded-full ${
            status === 'tracking' ? 'bg-emerald-500 animate-pulse' :
            status === 'error' ? 'bg-red-500' : 'bg-gray-500'
          }`} />
          <span className="text-lg font-bold text-white">
            {status === 'tracking' ? 'يتم مشاركة موقعك' :
             status === 'error' ? 'خطأ' : 'غير نشط'}
          </span>
        </div>

        {/* GPS Info */}
        {coords && (
          <div className="space-y-2 text-sm text-gray-300 font-mono">
            <div className="flex justify-between">
              <span>خط العرض:</span>
              <span dir="ltr">{coords.latitude.toFixed(6)}</span>
            </div>
            <div className="flex justify-between">
              <span>خط الطول:</span>
              <span dir="ltr">{coords.longitude.toFixed(6)}</span>
            </div>
            {coords.accuracy && (
              <div className="flex justify-between">
                <span>الدقة:</span>
                <span dir="ltr">{Math.round(coords.accuracy)} م</span>
              </div>
            )}
            {coords.speed != null && coords.speed > 0 && (
              <div className="flex justify-between">
                <span>السرعة:</span>
                <span dir="ltr">{Math.round(coords.speed * 3.6)} كم/س</span>
              </div>
            )}
          </div>
        )}

        {/* Last Sent */}
        {lastSent && (
          <div className="mt-3 text-xs text-emerald-400">
            ✓ آخر إرسال: {lastSent.toLocaleTimeString('ar-SA-u-nu-latn')}
          </div>
        )}

        {/* Error Message */}
        {errorMsg && (
          <div className="mt-3 text-sm text-red-300">{errorMsg}</div>
        )}
      </div>

      {/* Action Button */}
      {status === 'tracking' ? (
        <button
          type="button"
          onClick={() => void stopTracking()}
          className="w-full max-w-sm py-5 rounded-2xl text-xl font-bold bg-red-600 text-white hover:bg-red-500 transition-all shadow-lg active:scale-95"
        >
          ⏹ إيقاف مشاركة الموقع
        </button>
      ) : (
        <button
          type="button"
          onClick={startTracking}
          className="w-full max-w-sm py-5 rounded-2xl text-xl font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-all shadow-lg active:scale-95"
        >
          📍 بدء مشاركة الموقع
        </button>
      )}

      {/* Info */}
      <p className="mt-6 text-xs text-gray-600 text-center max-w-xs">
        موقعك يتم إرساله تلقائياً كل 15 ثانية للإدارة. أوقف المشاركة عند انتهاء العمل.
      </p>
    </div>
  );
}
