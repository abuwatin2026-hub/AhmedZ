import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
const RPC_STRICT_MODE_KEY = 'RPC_STRICT_MODE';
const REALTIME_DISABLED_KEY = 'AZTA_DISABLE_REALTIME';
export const SUPABASE_AUTH_ERROR_EVENT = 'AZTA_SUPABASE_AUTH_ERROR';
let realtimeDisabled = false;
let postgrestReloadAttempt: Promise<boolean> | null = null;
const RPC_HAS_FUNCTION_TTL_MS = 10 * 60_000;
let rpcHasFunctionInflight: Map<string, Promise<boolean>> | null = null;
let rpcHasFunctionCache: Map<string, { at: number; value: boolean }> | null = null;
let rpcWrappersAvailableInflight: Promise<boolean> | null = null;
let rpcWrappersAvailableCache: { at: number; value: boolean } | null = null;

const createTimeoutFetch = (timeoutMs: number) => {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof fetch === 'undefined') {
      throw new Error('fetch is not available');
    }
    if (typeof AbortController === 'undefined') {
      return fetch(input, init);
    }

    const conn: any = (typeof navigator !== 'undefined' && (navigator as any).connection) ? (navigator as any).connection : null;
    const eff: string = typeof conn?.effectiveType === 'string' ? conn.effectiveType : '';
    const isSlow = eff === 'slow-2g' || eff === '2g';
    const baseTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20_000;
    const dynamicTimeout = isSlow ? Math.max(baseTimeout, 60_000) : baseTimeout;
    let timeoutId: any = null;
    let didTimeout = false;

    const existingSignal = init?.signal;
    const combinedSignal = existingSignal;

    const toUrlString = (value: RequestInfo | URL) => {
      try {
        if (typeof value === 'string') return value;
        if (value instanceof URL) return value.toString();
        // @ts-ignore
        if (value && typeof value.url === 'string') return value.url;
      } catch {}
      return '';
    };
    const urlStr = toUrlString(input);
    try {
      const fetchPromise = fetch(input, { ...init, signal: combinedSignal });
      const guardedFetch = fetchPromise.catch((err: any) => {
        if (didTimeout) return new Response(null, { status: 408, statusText: 'timeout' });
        throw err;
      });

      const timeoutPromise = new Promise<Response>((_, reject) => {
        timeoutId = setTimeout(() => {
          didTimeout = true;
          const timeoutError: any = new Error('Request timed out');
          timeoutError.name = 'TimeoutError';
          reject(timeoutError);
        }, dynamicTimeout);
      });

      return await Promise.race([guardedFetch, timeoutPromise]);
    } catch (err: any) {
      const msg = String(err?.message || '');
      const aborted = /abort|ERR_ABORTED|Failed to fetch/i.test(msg);
      if (aborted && /\/auth\/v1\/logout/.test(urlStr)) {
        // Synthesize a successful empty response for aborted logout
        return new Response(null, { status: 204, statusText: 'aborted' });
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
};

const createRetryFetch = (baseFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, options?: { retries?: number; baseDelayMs?: number }) => {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const isRetryableNetworkError = (err: unknown) => {
    const msg = String((err as any)?.message || '');
    if (!msg) return true;
    if (/ERR_QUIC_PROTOCOL_ERROR/i.test(msg)) return true;
    if (/Failed to fetch/i.test(msg)) return true;
    if (/NetworkError/i.test(msg)) return true;
    if (/ERR_NETWORK/i.test(msg)) return true;
    if (/ERR_CONNECTION/i.test(msg)) return true;
    if (/timeout|timed out/i.test(msg)) return true;
    if (/ECONNRESET|EPIPE|ENOTFOUND|ETIMEDOUT/i.test(msg)) return true;
    return false;
  };

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method || 'GET').toUpperCase();
    const canRetry = method === 'GET' || method === 'HEAD';
    const signal = init?.signal;
    const conn: any = (typeof navigator !== 'undefined' && (navigator as any).connection) ? (navigator as any).connection : null;
    const eff: string = typeof conn?.effectiveType === 'string' ? conn.effectiveType : '';
    const isSlow = eff === 'slow-2g' || eff === '2g';
    const retries = isSlow ? (eff === 'slow-2g' ? 0 : 1) : (Number.isFinite(options?.retries) ? Math.max(0, Number(options?.retries)) : 2);
    const baseDelayMs = Number.isFinite(options?.baseDelayMs) ? Math.max(50, Number(options?.baseDelayMs)) : 250;

    let attempt = 0;
    while (true) {
      try {
        return await baseFetch(input, init);
      } catch (err) {
        if (!canRetry) throw err;
        if (signal?.aborted) throw err;
        if (!isRetryableNetworkError(err)) throw err;
        if (attempt >= retries) throw err;
        const jitter = Math.floor(Math.random() * 100);
        const wait = baseDelayMs * Math.pow(2, attempt) + jitter;
        attempt += 1;
        await sleep(wait);
      }
    }
  };
};

const createConcurrencyFetch = (
  baseFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  options?: { maxConcurrent?: number; maxQueue?: number }
) => {
  const maxConcurrent = Number.isFinite(options?.maxConcurrent) ? Math.max(1, Number(options?.maxConcurrent)) : 6;
  const maxQueue = Number.isFinite(options?.maxQueue) ? Math.max(0, Number(options?.maxQueue)) : 250;

  let active = 0;
  const queue: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
    resolve: (res: Response) => void;
    reject: (err: any) => void;
    signal?: AbortSignal | null;
  }> = [];

  const makeAbortError = () => {
    try {
      // @ts-ignore
      return new DOMException('Aborted', 'AbortError');
    } catch {
      const e: any = new Error('Aborted');
      e.name = 'AbortError';
      return e;
    }
  };

  const pump = () => {
    while (active < maxConcurrent && queue.length) {
      const job = queue.shift()!;
      if (job.signal?.aborted) {
        job.reject(makeAbortError());
        continue;
      }
      active += 1;
      Promise.resolve()
        .then(() => baseFetch(job.input, job.init))
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? null;
    if (signal?.aborted) throw makeAbortError();
    if (active < maxConcurrent && queue.length === 0) {
      active += 1;
      try {
        return await baseFetch(input, init);
      } finally {
        active -= 1;
        pump();
      }
    }

    if (maxQueue > 0 && queue.length >= maxQueue) {
      const err: any = new Error('Too many pending requests');
      err.name = 'ConcurrencyQueueOverflow';
      throw err;
    }

    return await new Promise<Response>((resolve, reject) => {
      const job = { input, init, resolve, reject, signal };
      queue.push(job);

      if (signal) {
        const onAbort = () => {
          const idx = queue.indexOf(job);
          if (idx >= 0) queue.splice(idx, 1);
          reject(makeAbortError());
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      pump();
    });
  };
};

const toHeaders = (value?: HeadersInit): Headers => {
  if (value instanceof Headers) return new Headers(value);
  const headers = new Headers();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry) continue;
      const k = String((entry as any)[0] ?? '').trim();
      if (!k) continue;
      const v = String((entry as any)[1] ?? '');
      headers.set(k, v);
    }
    return headers;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      const key = String(k ?? '').trim();
      if (!key) continue;
      if (v == null) continue;
      headers.set(key, String(v));
    }
  }
  return headers;
};

const withSupabaseHeaders = (baseFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, anonKey: string) => {
  const key = String(anonKey || '').trim();
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = toHeaders(init?.headers);
    if (key) {
      if (!headers.has('apikey')) headers.set('apikey', key);
      if (!headers.has('authorization')) headers.set('Authorization', `Bearer ${key}`);
    }

    const res = await baseFetch(input, { ...init, headers });

    if (typeof window !== 'undefined') {
      const status = Number(res.status);
      if (status === 401 || status === 403) {
        try {
          const urlStr = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : String((input as any)?.url || ''));
          const cloned = res.clone();
          const txt = await cloned.text();
          const normalized = String(txt || '').toLowerCase();
          const isAuthHeaderIssue =
            normalized.includes('jwt cryptographic operation failed') ||
            normalized.includes('invalid jwt') ||
            normalized.includes('session_verification_failed');
          if (isAuthHeaderIssue) {
            window.dispatchEvent(new CustomEvent(SUPABASE_AUTH_ERROR_EVENT, { detail: { status, url: urlStr, message: txt } }));
          }
        } catch {
        }
      }
    }

    return res;
  };
};

export const isSupabaseConfigured = (): boolean => {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';
  return Boolean(url.trim()) && Boolean(anonKey.trim());
};

export const isRealtimeEnabled = (): boolean => {
  if (realtimeDisabled) return false;
  const envDisable = String((import.meta.env.VITE_DISABLE_REALTIME as any) ?? '').trim();
  if (envDisable === '1' || envDisable.toLowerCase() === 'true') return false;
  try {
    const host = typeof location !== 'undefined' ? String(location.hostname || '').trim().toLowerCase() : '';
    if (host.endsWith('.pages.dev')) return false;
  } catch {}
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(REALTIME_DISABLED_KEY) === '1') {
      realtimeDisabled = true;
      return false;
    }
  } catch {}
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  return true;
};

export const disableRealtime = (): void => {
  realtimeDisabled = true;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(REALTIME_DISABLED_KEY, '1');
  } catch {}
};

export const clearRealtimeDisable = (): void => {
  realtimeDisabled = false;
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(REALTIME_DISABLED_KEY);
  } catch {}
};

export const getSupabaseClient = (): SupabaseClient | null => {
  if (client) return client;
  if (!isSupabaseConfigured()) return null;

  const url = (import.meta.env.VITE_SUPABASE_URL as string).trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string).trim();
  const timeoutMs = Number((import.meta.env.VITE_SUPABASE_REQUEST_TIMEOUT_MS as any) || 45_000);
  const retryCount = Number((import.meta.env.VITE_SUPABASE_REQUEST_RETRIES as any) || 2);
  const maxConcurrent = Number((import.meta.env.VITE_SUPABASE_MAX_CONCURRENT_REQUESTS as any) || 6);
  const baseFetch = createConcurrencyFetch(
    createRetryFetch(createTimeoutFetch(timeoutMs), { retries: retryCount, baseDelayMs: 250 }),
    { maxConcurrent }
  );

  client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: withSupabaseHeaders(baseFetch, anonKey) },
  });

  return client;
};

export const isRpcStrictMode = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(RPC_STRICT_MODE_KEY) === '1';
  } catch {
    return false;
  }
};

export const markRpcStrictModeEnabled = (): void => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(RPC_STRICT_MODE_KEY, '1');
  } catch {}
};

export const rpcHasFunction = async (name: string): Promise<boolean> => {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  if (!rpcHasFunctionInflight) rpcHasFunctionInflight = new Map();
  if (!rpcHasFunctionCache) rpcHasFunctionCache = new Map();
  const key = String(name || '').trim();
  if (!key) return false;

  const now = Date.now();
  const cached = rpcHasFunctionCache.get(key);
  if (cached && (now - cached.at) < RPC_HAS_FUNCTION_TTL_MS) return cached.value;

  const inflight = rpcHasFunctionInflight.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    try {
      const { data, error } = await supabase.rpc('rpc_has_function', { p_name: key });
      const ok = !error && Boolean(data);
      rpcHasFunctionCache!.set(key, { at: Date.now(), value: ok });
      return ok;
    } catch {
      rpcHasFunctionCache!.set(key, { at: Date.now(), value: false });
      return false;
    }
  })().finally(() => {
    rpcHasFunctionInflight!.delete(key);
  });

  rpcHasFunctionInflight.set(key, p);
  return p;
};

export const isRpcWrappersAvailable = async (): Promise<boolean> => {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) return false;
    const now = Date.now();
    if (rpcWrappersAvailableCache && (now - rpcWrappersAvailableCache.at) < RPC_HAS_FUNCTION_TTL_MS) return rpcWrappersAvailableCache.value;
    if (rpcWrappersAvailableInflight) return rpcWrappersAvailableInflight;

    rpcWrappersAvailableInflight = Promise.all([
      rpcHasFunction('public.confirm_order_delivery(jsonb)'),
      rpcHasFunction('public.confirm_order_delivery_with_credit(jsonb)'),
      rpcHasFunction('public.reserve_stock_for_order(jsonb)'),
    ])
      .then((checks) => {
        const ok = checks.every(Boolean);
        rpcWrappersAvailableCache = { at: Date.now(), value: ok };
        return ok;
      })
      .catch(() => false)
      .finally(() => {
        rpcWrappersAvailableInflight = null;
      });

    return await rpcWrappersAvailableInflight;
  } catch {
    return false;
  }
};

export const reloadPostgrestSchema = async (): Promise<boolean> => {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  if (postgrestReloadAttempt) {
    const previous = await postgrestReloadAttempt;
    if (!previous) postgrestReloadAttempt = null;
    return previous;
  }

  postgrestReloadAttempt = (async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) return false;

      try {
        const { data, error } = await supabase.rpc('rpc_reload_postgrest_schema');
        if (!error) return Boolean(data);
      } catch {}

      const start = new Date(0).toISOString();
      const end = new Date().toISOString();
      const { error } = await supabase.rpc('get_sales_report_orders', {
        p_start_date: start,
        p_end_date: end,
        p_zone_id: null,
        p_invoice_only: false,
        p_search: '__pgrst_reload__',
        p_limit: 1,
        p_offset: 0,
      } as any);

      return !error;
    } catch {
      return false;
    }
  })();

  const ok = await postgrestReloadAttempt;
  if (!ok) postgrestReloadAttempt = null;
  return ok;
};

let cachedBaseCurrencyCode: string | null = null;
let baseCurrencyCodePromise: Promise<string | null> | null = null;

export const invalidateBaseCurrencyCodeCache = (): void => {
  cachedBaseCurrencyCode = null;
  baseCurrencyCodePromise = null;
};

export const getBaseCurrencyCode = async (): Promise<string | null> => {
  if (cachedBaseCurrencyCode) return cachedBaseCurrencyCode;
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  if (baseCurrencyCodePromise) return baseCurrencyCodePromise;

  baseCurrencyCodePromise = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_base_currency');
      if (!error) {
        const code = String(data || '').toUpperCase().trim();
        if (code) return code;
      }
    } catch {
    }

    try {
      const { data, error } = await supabase
        .from('currencies')
        .select('code')
        .eq('is_base', true)
        .limit(1)
        .maybeSingle();
      if (error) return null;
      const code = String((data as any)?.code || '').toUpperCase().trim();
      return code || null;
    } catch {
      return null;
    }
  })()
    .then((code) => {
      cachedBaseCurrencyCode = code;
      return code;
    })
    .finally(() => {
      baseCurrencyCodePromise = null;
    });

  return baseCurrencyCodePromise;
};
