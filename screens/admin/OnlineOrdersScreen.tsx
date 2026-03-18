/**
 * OnlineOrdersScreen.tsx
 * ─────────────────────
 * Dedicated screen for the Online Orders Dispatcher role.
 * Shows ONLY online delivery orders (no in-store/POS).
 * Workflow: pending → preparing → out_for_delivery → delivered
 *
 * Route: /admin/online-orders
 * Permission: orders.updateStatus.all
 *
 * Best practices implemented:
 * ✅ Supabase Realtime subscription (instant push, no polling)
 * ✅ Web Audio API alert sound for new pending orders
 * ✅ Live countdown timer per order card (ticks every second)
 * ✅ assignOrderToDelivery from OrderContext (correct fallback)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOrders } from '../../contexts/OrderContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import type { AdminUser, Order, OrderStatus } from '../../types';
import { getSupabaseClient } from '../../supabase';

// ─── Constants ───────────────────────────────────────────────────────────────

const IN_STORE_ZONE_ID = '11111111-1111-4111-8111-111111111111';

const STATUS_LABEL: Record<string, string> = {
  pending:           'قيد الانتظار',
  preparing:         'قيد التجهيز',
  out_for_delivery:  'في الطريق',
  delivered:         'تم التسليم',
  scheduled:         'مجدول',
  cancelled:         'ملغي',
};

const STATUS_COLOR: Record<string, string> = {
  pending:           'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  preparing:         'bg-purple-500/20 text-purple-300 border-purple-500/40',
  out_for_delivery:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  delivered:         'bg-gray-500/20 text-gray-400 border-gray-600',
  scheduled:         'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  cancelled:         'bg-red-500/20 text-red-400 border-red-500/40',
};

// OrderStatus = 'pending'|'preparing'|'out_for_delivery'|'delivered'|'scheduled'|'cancelled'
const ACTIVE_STATUSES: OrderStatus[] = ['pending', 'preparing', 'out_for_delivery', 'scheduled'];
const DONE_STATUSES:   OrderStatus[] = ['delivered', 'cancelled'];

// ─── Web Audio Alert (no external library) ───────────────────────────────────

function playNewOrderAlert(): void {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    // Three-tone ascending chime
    [[0, 523.25], [0.18, 659.25], [0.36, 783.99]].forEach(([delay, freq]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {
    // Silently fail if AudioContext is blocked
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isOnlineOrder(order: Order): boolean {
  const src  = String((order as any).orderSource  || (order as any).data?.orderSource  || '').trim();
  const zone = String((order as any).deliveryZoneId || (order as any).data?.deliveryZoneId || '').trim();
  const addr = String((order as any).address      || (order as any).data?.address      || '').trim();
  if (src === 'in_store')          return false;
  if (zone === IN_STORE_ZONE_ID)   return false;
  if (addr === 'داخل المحل')       return false;
  return true;
}

/** Live elapsed time — updates every second via a tick prop */
function formatElapsed(isoString: string): string {
  const diffMs  = Math.max(0, Date.now() - new Date(isoString).getTime());
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60)  return `${diffSec}ث`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)  return `${diffMin}د ${diffSec % 60}ث`;
  return `${Math.floor(diffMin / 60)}س ${diffMin % 60}د`;
}

function getOrderCustomerName(order: Order): string {
  return String(
    (order as any).customerName ||
    (order as any).data?.customerName ||
    (order as any).data?.customer?.name ||
    'عميل'
  ).trim() || 'عميل';
}

function getOrderAddress(order: Order): string {
  return String(
    (order as any).address ||
    (order as any).data?.address ||
    (order as any).data?.deliveryAddress ||
    ''
  ).trim();
}

function getAssignedDriverId(order: Order): string {
  return String(
    (order as any).data?.assignedDeliveryUserId ||
    (order as any).assignedDeliveryUserId ||
    ''
  ).trim();
}

function getOrderTotal(order: Order): string {
  const total = Number((order as any).total || 0).toFixed(0);
  const cur   = String((order as any).currency || '').trim();
  return `${total}${cur ? ' ' + cur : ''}`;
}

function getOrderItemsSummary(order: Order): string {
  const items: any[] = (order as any).items || (order as any).data?.items || [];
  if (!Array.isArray(items) || items.length === 0) return '';
  const parts = items
    .slice(0, 3)
    .map(i => {
      const name = String(i.name?.ar || i.name?.en || i.name || i.itemName || '').trim();
      const qty  = Number(i.quantity || i.qty || 1);
      return name ? `${qty}× ${name}` : '';
    })
    .filter(Boolean);
  return parts.join('، ') + (items.length > 3 ? ` +${items.length - 3}` : '');
}

// ─── Next Action Button ───────────────────────────────────────────────────────

type NextAction = { label: string; icon: string; nextStatus: OrderStatus; color: string };

function getNextAction(order: Order): NextAction | null {
  const s = order.status as OrderStatus;
  if (s === 'pending')          return { label: 'قبول وتجهيز',     icon: '✅', nextStatus: 'preparing',        color: 'bg-blue-600 hover:bg-blue-500' };
  if (s === 'preparing')        return { label: 'أرسل مع المندوب', icon: '🚀', nextStatus: 'out_for_delivery', color: 'bg-emerald-600 hover:bg-emerald-500' };
  if (s === 'out_for_delivery') return { label: 'تم التسليم',      icon: '🏠', nextStatus: 'delivered',        color: 'bg-gray-600 hover:bg-gray-500' };
  return null;
}

function urgencyLevel(order: Order): 'urgent' | 'warn' | null {
  if (order.status !== 'pending') return null;
  const diffMin = (Date.now() - new Date((order as any).createdAt || '').getTime()) / 60000;
  if (diffMin >= 10) return 'urgent';
  if (diffMin >= 3)  return 'warn';
  return null;
}

// ─── Order Card ───────────────────────────────────────────────────────────────

interface OrderCardProps {
  order: Order;
  deliveryUsers: AdminUser[];
  onStatusChange: (orderId: string, status: OrderStatus) => Promise<void>;
  onAssignDriver: (orderId: string, driverId: string) => Promise<void>;
  busy: Set<string>;
  nowMs: number; // live timestamp tick
}

function OrderCard({ order, deliveryUsers, onStatusChange, onAssignDriver, busy, nowMs }: OrderCardProps) {
  const nextAction   = getNextAction(order);
  const assignedId   = getAssignedDriverId(order);
  const urgency      = urgencyLevel(order);
  const isBusy       = busy.has(order.id);
  const itemsSummary = getOrderItemsSummary(order);
  const address      = getOrderAddress(order);
  const customerName = getOrderCustomerName(order);
  const [driverId, setDriverId] = useState(assignedId);

  useEffect(() => { setDriverId(assignedId); }, [assignedId]);

  const handleAssign = async (newId: string) => {
    setDriverId(newId);
    if (newId) await onAssignDriver(order.id, newId);
  };

  const orderShortId = order.id.slice(-6).toUpperCase();
  const createdAt    = String((order as any).createdAt || '');
  // Live elapsed using parent's nowMs tick (no internal setInterval per card)
  const elapsed = createdAt ? formatElapsed(createdAt) : '';

  // Visual urgency indicator with countdown
  const diffMin = createdAt ? (nowMs - new Date(createdAt).getTime()) / 60000 : 0;
  const warnMs  = Math.max(0, 3 * 60000 - (nowMs - new Date(createdAt || nowMs).getTime()));


  return (
    <div className={`bg-gray-800 rounded-2xl border overflow-hidden transition-all ${
      urgency === 'urgent'
        ? 'border-red-500 shadow-red-900/40 shadow-xl ring-1 ring-red-500/50'
        : urgency === 'warn'
        ? 'border-yellow-500/70'
        : 'border-gray-700'
    }`}>

      {/* Urgency progress bar at top */}
      {order.status === 'pending' && diffMin < 15 && (
        <div className="h-1 bg-gray-700 overflow-hidden">
          <div
            className={`h-full transition-all ${urgency === 'urgent' ? 'bg-red-500' : urgency === 'warn' ? 'bg-yellow-500' : 'bg-emerald-500'}`}
            style={{ width: `${Math.min(100, (diffMin / 15) * 100)}%` }}
          />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          {urgency === 'urgent' && <span className="text-red-400 text-base animate-bounce">🔴</span>}
          {urgency === 'warn'   && <span className="text-yellow-400 text-base">🟡</span>}
          <span className="text-white font-bold text-sm font-mono">#{orderShortId}</span>
          <span className={`text-xs border px-2 py-0.5 rounded-full font-semibold ${STATUS_COLOR[order.status] || 'bg-gray-700 text-gray-300 border-gray-600'}`}>
            {STATUS_LABEL[order.status] || order.status}
          </span>
        </div>
        {/* Live elapsed timer */}
        <div className={`text-xs font-mono font-semibold ${
          urgency === 'urgent' ? 'text-red-400' : urgency === 'warn' ? 'text-yellow-400' : 'text-gray-500'
        }`}>
          ⏱ {elapsed}
        </div>
      </div>

      {/* Urgency countdown ribbon */}
      {urgency === 'warn' && warnMs > 0 && (
        <div className="bg-yellow-900/30 border-b border-yellow-700/40 px-3 py-1 text-yellow-300 text-xs">
          ⚠️ تجاوز {Math.floor(diffMin)}د — يحتاج تأكيداً عاجلاً
        </div>
      )}
      {urgency === 'urgent' && (
        <div className="bg-red-900/40 border-b border-red-700/40 px-3 py-1 text-red-300 text-xs font-semibold animate-pulse">
          🚨 تأخر {Math.floor(diffMin)}د — يجب التصرف الآن!
        </div>
      )}

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Customer + Total */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-white font-semibold text-sm">{customerName}</div>
            {address && (
              <div className="text-gray-400 text-xs mt-0.5 flex items-start gap-1">
                <span>📍</span>
                <span className="leading-tight">{address}</span>
              </div>
            )}
          </div>
          <div className="text-emerald-400 font-bold text-base whitespace-nowrap">{getOrderTotal(order)}</div>
        </div>

        {/* Items */}
        {itemsSummary && (
          <div className="text-gray-400 text-xs bg-gray-700/50 rounded-lg px-3 py-2 leading-relaxed">
            {itemsSummary}
          </div>
        )}

        {/* Assign Driver */}
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-xs whitespace-nowrap">🛵 مندوب:</span>
          <select
            value={driverId}
            onChange={e => void handleAssign(e.target.value)}
            disabled={isBusy || order.status === 'delivered' || order.status === 'cancelled'}
            className="flex-1 bg-gray-700 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-50"
          >
            <option value="">— اختر مندوباً —</option>
            {deliveryUsers.map(u => (
              <option key={u.id} value={u.id}>{u.fullName || u.username}</option>
            ))}
          </select>
        </div>

        {/* Next Action Button */}
        {nextAction && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void onStatusChange(order.id, nextAction.nextStatus)}
            className={`w-full py-2.5 rounded-xl text-white font-bold text-sm transition-all flex items-center justify-center gap-2 ${nextAction.color} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isBusy
              ? <span className="animate-spin">⏳</span>
              : <><span className="text-lg">{nextAction.icon}</span>{nextAction.label}</>
            }
          </button>
        )}

        {(order.status === 'delivered' || order.status === 'cancelled') && (
          <div className={`text-center text-xs py-2 rounded-lg font-semibold ${
            order.status === 'delivered' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'
          }`}>
            {order.status === 'delivered' ? '✅ تم التسليم بنجاح' : '❌ طلب ملغي'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

const TABS = [
  { key: 'active', label: '🔴 نشطة' },
  { key: 'done',   label: '✅ منتهية' },
] as const;
type Tab = typeof TABS[number]['key'];

export default function OnlineOrdersScreen() {
  const { orders, updateOrderStatus, assignOrderToDelivery, fetchOrders, loading } = useOrders();
  const { showNotification } = useToast();
  const { listAdminUsers }   = useAuth();

  const [deliveryUsers, setDeliveryUsers] = useState<AdminUser[]>([]);
  const [tab, setTab]                     = useState<Tab>('active');
  const [busy, setBusy]                   = useState<Set<string>>(new Set());
  const [search, setSearch]               = useState('');
  const [nowMs, setNowMs]                 = useState(Date.now()); // ← live tick for all cards
  const prevPendingIdsRef                 = useRef<Set<string>>(new Set());
  const realtimeConnectedRef              = useRef(false);

  // ── Live clock: tick every second for countdown timers ────────────────────
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Load delivery agents ──────────────────────────────────────────────────
  useEffect(() => {
    void listAdminUsers().then(users => {
      setDeliveryUsers(users.filter(u => u.role === 'delivery' && u.isActive));
    });
  }, [listAdminUsers]);

  // ── Supabase Realtime subscription (instant push) ─────────────────────────
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || realtimeConnectedRef.current) return;
    realtimeConnectedRef.current = true;

    const channel = supabase
      .channel('online_orders_dispatcher')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => { void fetchOrders(); }
      )
      .subscribe();

    return () => {
      realtimeConnectedRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [fetchOrders]);

  // ── Fallback: poll every 60s in case Realtime misses something ────────────
  useEffect(() => {
    const t = setInterval(() => void fetchOrders(), 60000);
    return () => clearInterval(t);
  }, [fetchOrders]);

  // ── Filter: online orders only ────────────────────────────────────────────
  const onlineOrders = useMemo(() => orders.filter(isOnlineOrder), [orders]);

  // ── Sound + visual alert on new pending orders ────────────────────────────
  useEffect(() => {
    const currentPendingIds = new Set(
      onlineOrders.filter(o => o.status === 'pending').map(o => o.id)
    );
    const newOnes = [...currentPendingIds].filter(id => !prevPendingIdsRef.current.has(id));
    if (newOnes.length > 0) {
      playNewOrderAlert();
      showNotification(
        `🔔 ${newOnes.length > 1 ? `${newOnes.length} طلبات جديدة!` : 'طلب جديد!'}`,
        'info'
      );
    }
    prevPendingIdsRef.current = currentPendingIds;
  }, [onlineOrders, showNotification]);

  // ── Split tabs ────────────────────────────────────────────────────────────
  const activeOrders = useMemo(() =>
    onlineOrders.filter(o => (ACTIVE_STATUSES as string[]).includes(o.status)),
    [onlineOrders]
  );
  const doneOrders = useMemo(() =>
    onlineOrders.filter(o => (DONE_STATUSES as string[]).includes(o.status)),
    [onlineOrders]
  );

  // ── Search ────────────────────────────────────────────────────────────────
  const searchFilter = useCallback((list: Order[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(o => {
      const name  = getOrderCustomerName(o).toLowerCase();
      const shortId = o.id.slice(-6).toLowerCase();
      return name.includes(q) || shortId.includes(q);
    });
  }, [search]);

  const displayOrders = useMemo(() =>
    searchFilter(tab === 'active' ? activeOrders : doneOrders)
      .sort((a, b) => {
        // Sort: pending first among active, then by newest
        if (tab === 'active') {
          if (a.status === 'pending' && b.status !== 'pending') return -1;
          if (b.status === 'pending' && a.status !== 'pending') return 1;
        }
        return new Date((b as any).createdAt || '').getTime() - new Date((a as any).createdAt || '').getTime();
      }),
    [tab, activeOrders, doneOrders, searchFilter]
  );

  // ── Stats ─────────────────────────────────────────────────────────────────
  const pendingCount  = activeOrders.filter(o => o.status === 'pending').length;
  const inProgressCnt = activeOrders.filter(o => o.status !== 'pending').length;

  // ── Actions ───────────────────────────────────────────────────────────────
  const setBusyFor = (id: string, v: boolean) =>
    setBusy(prev => { const s = new Set(prev); v ? s.add(id) : s.delete(id); return s; });

  const handleStatusChange = useCallback(async (orderId: string, newStatus: OrderStatus) => {
    setBusyFor(orderId, true);
    try {
      await updateOrderStatus(orderId, newStatus);
      showNotification(`تم تغيير الحالة إلى "${STATUS_LABEL[newStatus] || newStatus}"`, 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'حدث خطأ'), 'error');
    } finally {
      setBusyFor(orderId, false);
    }
  }, [updateOrderStatus, showNotification]);

  const handleAssignDriver = useCallback(async (orderId: string, driverId: string) => {
    setBusyFor(orderId, true);
    try {
      await assignOrderToDelivery(orderId, driverId);
      const driver = deliveryUsers.find(u => u.id === driverId);
      showNotification(`تم تعيين المندوب ${driver?.fullName || driver?.username || ''}`, 'success');
    } catch (e: any) {
      showNotification(String(e?.message || 'تعذر تعيين المندوب'), 'error');
    } finally {
      setBusyFor(orderId, false);
    }
  }, [deliveryUsers, assignOrderToDelivery, showNotification]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-screen bg-gray-900" dir="rtl">

      {/* Top bar */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🌐</span>
          <div>
            <h1 className="text-white font-bold text-lg">الطلبات الأونلاين</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-emerald-400 text-xs font-semibold">Realtime • تحديث فوري</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5 bg-red-900/40 border border-red-600 px-3 py-1.5 rounded-full animate-pulse">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-red-300 text-sm font-bold">{pendingCount} بانتظار التأكيد</span>
            </div>
          )}
          {inProgressCnt > 0 && (
            <div className="flex items-center gap-1.5 bg-emerald-900/40 border border-emerald-700 px-3 py-1.5 rounded-full">
              <span className="text-emerald-300 text-sm font-semibold">🚀 {inProgressCnt} قيد التنفيذ</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => void fetchOrders()}
            disabled={loading}
            className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {loading ? '⏳' : '🔄'} تحديث
          </button>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="bg-gray-800/50 border-b border-gray-700 px-4 py-2 flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${
                tab === t.key ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
              <span className="mr-1.5 text-xs opacity-70">
                ({t.key === 'active' ? activeOrders.length : doneOrders.length})
              </span>
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="ابحث باسم العميل أو آخر 6 أرقام من رقم الطلب..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-1.5 placeholder-gray-500 focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
        />
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && displayOrders.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="text-4xl animate-spin">⏳</div>
            <div className="text-gray-400 text-sm">جاري تحميل الطلبات...</div>
          </div>
        )}
        {!loading && displayOrders.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="text-6xl">{tab === 'active' ? '🎉' : '📭'}</div>
            <div className="text-white font-bold text-lg">
              {tab === 'active' ? 'لا توجد طلبات نشطة' : 'لا توجد طلبات منتهية'}
            </div>
            <div className="text-gray-400 text-sm">
              {tab === 'active' ? 'ستظهر الطلبات الجديدة هنا فوراً عبر Realtime' : 'الطلبات المسلّمة والملغية ستظهر هنا'}
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {displayOrders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              deliveryUsers={deliveryUsers}
              onStatusChange={handleStatusChange}
              onAssignDriver={handleAssignDriver}
              busy={busy}
              nowMs={nowMs}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
