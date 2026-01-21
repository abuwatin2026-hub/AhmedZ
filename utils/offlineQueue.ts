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
          const { error } = await supabase.rpc(t.name, t.args);
          if (error) throw error;
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
