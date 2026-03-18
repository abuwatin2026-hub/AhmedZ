/**
 * LiveDriverMapScreen.tsx
 * Admin screen showing live GPS positions of all delivery agents
 * using Leaflet.js + OpenStreetMap (100% free, no API key needed).
 * Updates in real-time via Supabase Realtime subscriptions.
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { getSupabaseClient } from '../../supabase';

// Inject Leaflet CSS + JS via script/link tags once
let leafletLoaded = false;
function ensureLeaflet(): Promise<void> {
  if (leafletLoaded || (window as any).L) {
    leafletLoaded = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => { leafletLoaded = true; resolve(); };
    document.head.appendChild(script);
  });
}

interface DriverLocation {
  driver_id: string;
  driver_name: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  is_active: boolean;
  updated_at: string;
  seconds_ago: number;
}

function formatSince(sec: number): string {
  if (sec < 60) return `منذ ${sec} ث`;
  if (sec < 3600) return `منذ ${Math.floor(sec / 60)} د`;
  return `منذ ${Math.floor(sec / 3600)} س`;
}

export default function LiveDriverMapScreen() {
  const supabase = getSupabaseClient();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});

  const [drivers, setDrivers] = useState<DriverLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);

  // Tick every 10s to refresh display
  useEffect(() => {
    const t = setInterval(() => setDrivers(prev => [...prev]), 10000);
    return () => clearInterval(t);
  }, []);

  // Initialize Leaflet map
  useEffect(() => {
    ensureLeaflet().then(() => {
      const L = (window as any).L;
      if (!mapContainerRef.current || mapRef.current) return;

      // Default center: Yemen (Sanaa approximate)
      mapRef.current = L.map(mapContainerRef.current, {
        center: [15.5527, 48.5164],
        zoom: 7,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapRef.current);

      setMapReady(true);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersRef.current = {};
      }
    };
  }, []);

  const updateMarkers = useCallback((driverList: DriverLocation[]) => {
    const L = (window as any).L;
    if (!mapRef.current || !L) return;

    const currentIds = new Set(driverList.map(d => d.driver_id));

    // Remove stale markers
    Object.keys(markersRef.current).forEach(id => {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });

    // Add/update markers
    driverList.forEach(driver => {
      const isOnline = driver.seconds_ago < 120; // online if updated in last 2 min
      const color = isOnline ? '#10b981' : '#9ca3af';
      const emoji = isOnline ? '🛵' : '😴';

      const icon = L.divIcon({
        className: '',
        html: `
          <div style="
            background: ${color};
            border: 3px solid white;
            border-radius: 50%;
            width: 44px; height: 44px;
            display: flex; align-items: center; justify-content: center;
            font-size: 22px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            cursor: pointer;
          ">
            ${emoji}
          </div>
          <div style="
            background: rgba(0,0,0,0.75);
            color: white;
            font-size: 11px;
            font-weight: bold;
            text-align: center;
            padding: 2px 6px;
            border-radius: 8px;
            margin-top: 2px;
            white-space: nowrap;
            direction: rtl;
          ">
            ${driver.driver_name || 'مندوب'}
          </div>
        `,
        iconSize: [60, 60],
        iconAnchor: [30, 22],
      });

      if (markersRef.current[driver.driver_id]) {
        markersRef.current[driver.driver_id]
          .setLatLng([driver.latitude, driver.longitude])
          .setIcon(icon);
      } else {
        const marker = L.marker([driver.latitude, driver.longitude], { icon })
          .addTo(mapRef.current)
          .bindPopup(`
            <div dir="rtl" style="min-width:180px;font-family:sans-serif">
              <b style="font-size:14px">${driver.driver_name || 'مندوب'}</b><br>
              <span style="color:${isOnline ? '#10b981' : '#9ca3af'};font-weight:bold">${isOnline ? '● متصل' : '● غير نشط'}</span><br>
              <small>آخر تحديث: ${formatSince(driver.seconds_ago)}</small><br>
              ${driver.speed != null ? `<small>السرعة: ${Math.round(driver.speed * 3.6)} كم/س</small><br>` : ''}
              ${driver.accuracy != null ? `<small>الدقة: ${Math.round(driver.accuracy)} م</small>` : ''}
            </div>
          `);
        markersRef.current[driver.driver_id] = marker;
      }
    });

    // Auto-fit map to all markers if there are drivers
    if (driverList.length > 0) {
      const bounds = L.latLngBounds(driverList.map(d => [d.latitude, d.longitude]));
      mapRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    }
  }, []);

  // Load driver locations
  const loadDrivers = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc('get_active_driver_locations');
    if (error) {
      console.error('get_active_driver_locations error:', error);
      return;
    }
    const list = (data as DriverLocation[]) || [];
    setDrivers(list);
    if (mapReady) updateMarkers(list);
  }, [supabase, mapReady, updateMarkers]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    loadDrivers().finally(() => setLoading(false));
  }, [loadDrivers]);

  // Update markers when map becomes ready
  useEffect(() => {
    if (mapReady && drivers.length > 0) updateMarkers(drivers);
  }, [mapReady, drivers, updateMarkers]);

  // Supabase Realtime subscription
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('driver_locations_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_locations' },
        (_payload) => {
          void loadDrivers(); // Re-fetch on any change
        }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [supabase, loadDrivers]);

  const onlinecount = drivers.filter(d => d.seconds_ago < 120).length;

  return (
    <div className="flex flex-col h-full min-h-screen bg-gray-900" dir="rtl">

      {/* Header Bar */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🗺️</span>
          <div>
            <h1 className="text-white font-bold text-lg">خريطة المندوبين</h1>
            <p className="text-gray-400 text-xs">تتبع مباشر — يتحدث كل 15 ثانية</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-emerald-900/40 border border-emerald-700 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-emerald-300 text-sm font-semibold">{onlinecount} نشط</span>
          </div>
          <div className="text-gray-400 text-sm">{drivers.length} إجمالي</div>
          <button
            type="button"
            onClick={() => void loadDrivers()}
            className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
          >
            🔄 تحديث
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">

        {/* Sidebar — Driver List */}
        <div className="w-64 flex-shrink-0 bg-gray-800 border-l border-gray-700 overflow-y-auto flex flex-col">
          <div className="p-3 text-gray-400 text-xs font-semibold border-b border-gray-700 uppercase tracking-wider">
            المندوبون
          </div>
          {loading && (
            <div className="p-4 text-gray-500 text-sm text-center">جاري التحميل...</div>
          )}
          {!loading && drivers.length === 0 && (
            <div className="p-4 text-gray-500 text-sm text-center">
              لا يوجد مندوبون نشطون الآن.
            </div>
          )}
          {drivers.map(driver => {
            const isOnline = driver.seconds_ago < 120;
            const isSelected = selectedDriver === driver.driver_id;
            return (
              <button
                key={driver.driver_id}
                type="button"
                onClick={() => {
                  setSelectedDriver(driver.driver_id);
                  if (mapRef.current) {
                    mapRef.current.setView([driver.latitude, driver.longitude], 15);
                    markersRef.current[driver.driver_id]?.openPopup();
                  }
                }}
                className={`w-full text-right p-3 border-b border-gray-700/50 transition-colors ${
                  isSelected ? 'bg-blue-900/30' : 'hover:bg-gray-700/50'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${isOnline ? 'bg-emerald-500' : 'bg-gray-500'}`} />
                  <div className="min-w-0">
                    <div className="text-white text-sm font-semibold truncate">{driver.driver_name || 'مندوب'}</div>
                    <div className={`text-xs ${isOnline ? 'text-emerald-400' : 'text-gray-500'}`}>
                      {formatSince(driver.seconds_ago)}
                    </div>
                    {driver.speed != null && driver.speed > 0.5 && (
                      <div className="text-xs text-blue-400">{Math.round(driver.speed * 3.6)} كم/س</div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Map */}
        <div className="flex-1 relative min-h-0">
          <div ref={mapContainerRef} className="absolute inset-0" style={{ zIndex: 1 }} />
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
              <div className="text-gray-400 text-sm">جاري تحميل الخريطة...</div>
            </div>
          )}
          {mapReady && drivers.length === 0 && !loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="bg-gray-900/80 backdrop-blur rounded-2xl p-6 text-center">
                <div className="text-5xl mb-3">🛵</div>
                <div className="text-white font-bold text-lg">لا يوجد مندوبون نشطون</div>
                <div className="text-gray-400 text-sm mt-1">سيظهر المندوبون هنا عند تشغيل تطبيقهم</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
