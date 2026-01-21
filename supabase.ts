import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

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

export const isSupabaseConfigured = (): boolean => {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';
  return Boolean(url.trim()) && Boolean(anonKey.trim());
};

export const getSupabaseClient = (): SupabaseClient | null => {
  if (client) return client;
  if (!isSupabaseConfigured()) return null;

  const url = (import.meta.env.VITE_SUPABASE_URL as string).trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string).trim();
  const timeoutMs = Number((import.meta.env.VITE_SUPABASE_REQUEST_TIMEOUT_MS as any) || 45_000);
  const retryCount = Number((import.meta.env.VITE_SUPABASE_REQUEST_RETRIES as any) || 2);

  client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: createRetryFetch(createTimeoutFetch(timeoutMs), { retries: retryCount, baseDelayMs: 250 }) },
  });

  return client;
};
