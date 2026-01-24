import { getSupabaseClient } from '../supabase';

type TableOp = 'insert' | 'upsert' | 'update' | 'delete';

interface OfflineTaskBase {
  id: string;
  ts: number;
  attempts: number;
  maxAttempts: number;
}

interface RpcTask extends OfflineTaskBase {
  kind: 'rpc';
  name: string;
  args: Record<string, any>;
}

interface TableTask extends OfflineTaskBase {
  kind: 'table';
  op: TableOp;
  table: string;
  payload?: Record<string, any>;
  onConflict?: string;
  match?: { column: string; value: any };
}

type OfflineTask = RpcTask | TableTask;

const STORAGE_KEY = 'offline_tasks';
const POS_OFFLINE_ORDERS_KEY = 'offline_pos_orders';
let isProcessing = false;
let processorStarted = false;

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

const BLOCK_OFFLINE_RPC = new Set<string>([
  'record_order_payment',
  'record_purchase_order_payment',
  'confirm_order_delivery',
  'deduct_stock_on_delivery_v2',
  'receive_purchase_order',
  'receive_purchase_order_partial',
  'purge_purchase_order',
  'cancel_purchase_order',
  'create_purchase_return',
]);

type OfflinePosState = 'CREATED_OFFLINE' | 'SYNCED' | 'DELIVERED' | 'FAILED' | 'CONFLICT';

type OfflinePosOrder = {
  offlineId: string;
  orderId: string;
  state: OfflinePosState;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const readPosOrders = (): OfflinePosOrder[] => {
  try {
    const raw = localStorage.getItem(POS_OFFLINE_ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writePosOrders = (orders: OfflinePosOrder[]) => {
  try {
    localStorage.setItem(POS_OFFLINE_ORDERS_KEY, JSON.stringify(orders));
  } catch {}
};

export const upsertOfflinePosOrder = (input: { offlineId: string; orderId: string; state?: OfflinePosState; error?: string }) => {
  const offlineId = String(input.offlineId || '');
  const orderId = String(input.orderId || '');
  if (!offlineId || !orderId) return;
  const now = Date.now();
  const list = readPosOrders();
  const idx = list.findIndex((o) => o.offlineId === offlineId);
  const next: OfflinePosOrder = {
    offlineId,
    orderId,
    state: input.state || 'CREATED_OFFLINE',
    error: input.error,
    createdAt: idx >= 0 ? list[idx].createdAt : now,
    updatedAt: now,
  };
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...next };
  } else {
    list.unshift(next);
  }
  writePosOrders(list);
};

export const setOfflinePosOrderState = (offlineId: string, state: OfflinePosState, error?: string) => {
  const id = String(offlineId || '');
  if (!id) return;
  const now = Date.now();
  const list = readPosOrders();
  const idx = list.findIndex((o) => o.offlineId === id);
  if (idx < 0) return;
  list[idx] = { ...list[idx], state, error, updatedAt: now };
  writePosOrders(list);
};

const read = (): OfflineTask[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const write = (tasks: OfflineTask[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {}
};

export const queueSize = (): number => read().length;

export const enqueueRpc = (name: string, args: Record<string, any>) => {
  if (isOffline() && BLOCK_OFFLINE_RPC.has(name)) {
    throw new Error('هذه العملية تتطلب اتصالاً بالإنترنت لإتمامها بأمان.');
  }
  const tasks = read();
  tasks.push({
    id: crypto.randomUUID(),
    kind: 'rpc',
    name,
    args,
    ts: Date.now(),
    attempts: 0,
    maxAttempts: 5,
  });
  write(tasks);
};

export const enqueueTable = (
  table: string,
  op: TableOp,
  payload?: Record<string, any>,
  options?: { onConflict?: string; match?: { column: string; value: any } }
) => {
  const tasks = read();
  tasks.push({
    id: crypto.randomUUID(),
    kind: 'table',
    table,
    op,
    payload,
    onConflict: options?.onConflict,
    match: options?.match,
    ts: Date.now(),
    attempts: 0,
    maxAttempts: 5,
  });
  write(tasks);
};

export const processQueue = async (): Promise<{ processed: number; remaining: number }> => {
  if (isOffline()) return { processed: 0, remaining: queueSize() };
  if (isProcessing) return { processed: 0, remaining: queueSize() };
  isProcessing = true;
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return { processed: 0, remaining: queueSize() };
    const tasks = read();
    const next: OfflineTask[] = [];
    let processed = 0;
    for (const t of tasks) {
      try {
        if (t.kind === 'rpc') {
          if (t.name === 'sync_offline_pos_sale') {
            const offlineId = String((t.args as any)?.p_offline_id || '');
            const orderId = String((t.args as any)?.p_order_id || '');
            const warehouseId = String((t.args as any)?.p_warehouse_id || '');
            if (offlineId && orderId && warehouseId) {
              const meta = readPosOrders().find((o) => o.offlineId === offlineId);
              const createdAtIso = meta?.createdAt ? new Date(meta.createdAt).toISOString() : new Date().toISOString();
              try {
                await supabase.rpc('register_pos_offline_sale_created', {
                  p_offline_id: offlineId,
                  p_order_id: orderId,
                  p_created_at: createdAtIso,
                  p_warehouse_id: warehouseId,
                });
              } catch {}
            }
          }
          const { data, error } = await supabase.rpc(t.name, t.args);
          if (error) throw error;
          if (t.name === 'sync_offline_pos_sale' && data && typeof data === 'object') {
            const status = String((data as any).status || '');
            const offlineId = String((t.args as any)?.p_offline_id || '');
            if (offlineId) {
              if (status === 'DELIVERED') {
                setOfflinePosOrderState(offlineId, 'DELIVERED');
              } else if (status === 'CONFLICT') {
                setOfflinePosOrderState(offlineId, 'CONFLICT', String((data as any).error || ''));
              } else if (status === 'REQUIRES_RECONCILIATION') {
                const reqId = String((data as any).approvalRequestId || '');
                const msg = reqId ? `يتطلب اعتماد تسوية: ${reqId}` : 'يتطلب اعتماد تسوية';
                setOfflinePosOrderState(offlineId, 'CONFLICT', msg);
              } else if (status === 'FAILED') {
                setOfflinePosOrderState(offlineId, 'FAILED', String((data as any).error || ''));
              } else if (status === 'SYNCED') {
                setOfflinePosOrderState(offlineId, 'SYNCED');
              }
            }
            if (status === 'REQUIRES_RECONCILIATION') {
              processed += 1;
              continue;
            }
          }
        } else {
          if (t.op === 'insert') {
            const { error } = await supabase.from(t.table).insert(t.payload || {});
            if (error) throw error;
          } else if (t.op === 'upsert') {
            const { error } = await supabase.from(t.table).upsert(t.payload || {}, t.onConflict ? { onConflict: t.onConflict } : undefined);
            if (error) throw error;
          } else if (t.op === 'update') {
            const builder = supabase.from(t.table).update(t.payload || {});
            const { error } = t.match ? await builder.eq(t.match.column, t.match.value) : await builder;
            if (error) throw error;
          } else if (t.op === 'delete') {
            const builder = supabase.from(t.table).delete();
            const { error } = t.match ? await builder.eq(t.match.column, t.match.value) : await builder;
            if (error) throw error;
          }
        }
        processed += 1;
      } catch (err: any) {
        const msg = String(err?.message || '');
        const aborted = /abort|ERR_ABORTED|Failed to fetch/i.test(msg);
        if (isOffline() || aborted) {
          next.push(t);
          continue;
        }
        if (t.kind === 'rpc' && t.name === 'sync_offline_pos_sale') {
          const offlineId = String((t.args as any)?.p_offline_id || '');
          if (offlineId) {
            setOfflinePosOrderState(offlineId, 'FAILED', msg);
          }
          processed += 1;
          continue;
        }
        const attempts = (t.attempts || 0) + 1;
        if (attempts < t.maxAttempts) {
          next.push({ ...t, attempts });
        }
      }
    }
    write(next);
    return { processed, remaining: next.length };
  } finally {
    isProcessing = false;
  }
};

export const startQueueProcessor = () => {
  if (processorStarted) return;
  processorStarted = true;
  const trigger = () => {
    processQueue().catch(() => {});
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', trigger);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') trigger();
    });
    setInterval(trigger, 30_000);
  }
  trigger();
};
