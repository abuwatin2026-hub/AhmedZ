const getEnvOptional = (name: string): string | undefined => {
  const deno = (globalThis as any).Deno;
  const v = deno?.env?.get ? deno.env.get(name) : undefined;
  return typeof v === 'string' ? v : undefined;
};

type CreateCustomerBody = {
  fullName?: string;
  phone: string;
  customerType?: 'retail' | 'wholesale';
  creditLimit?: number | null;
  notes?: string | null;
};

function getAllowedOrigin(origin: string | null): string {
  const raw = (getEnvOptional('AZTA_ALLOWED_ORIGINS') || '').trim();
  if (!origin) {
    if (!raw) return '*';
    const first = raw.split(',').map(s => s.trim()).filter(Boolean)[0];
    return first || '*';
  }

  const originUrl = (() => { try { return new URL(origin); } catch { return null; } })();
  const host = originUrl?.hostname || '';
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const isPrivateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host);
  if (!raw) return origin;

  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (list.includes('*')) return origin;
  if (isLocal || isPrivateIp) return origin;

  const matches = (allowed: string) => {
    if (!allowed) return false;
    if (allowed === origin) return true;
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    if (!allowed.includes('://')) return host === allowed;
    const allowedUrl = (() => { try { return new URL(allowed); } catch { return null; } })();
    if (!allowedUrl) return false;
    if (allowedUrl.hostname !== host) return false;
    if (allowedUrl.port && originUrl?.port && allowedUrl.port !== originUrl.port) return false;
    return true;
  };

  return list.some(matches) ? origin : 'null';
}

function buildCors(origin: string | null, req?: Request) {
  const allowOrigin = getAllowedOrigin(origin);
  const requestHeaders = (req?.headers.get('access-control-request-headers') || '').trim();
  const allowHeaders = requestHeaders || 'authorization, x-client-info, apikey, content-type, x-user-token, x-supabase-api-version, x-supabase-user-agent';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': allowHeaders,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin, Access-Control-Request-Headers',
  } as Record<string, string>;
}

const SUPABASE_URL = ((getEnvOptional('AZTA_SUPABASE_URL') ?? getEnvOptional('SUPABASE_URL')) ?? '').trim();
const SUPABASE_ANON_KEY = ((getEnvOptional('AZTA_SUPABASE_ANON_KEY') ?? getEnvOptional('SUPABASE_ANON_KEY')) ?? '').trim();
const SUPABASE_SERVICE_ROLE_KEY = ((getEnvOptional('AZTA_SUPABASE_SERVICE_ROLE_KEY') ?? getEnvOptional('SUPABASE_SERVICE_ROLE_KEY')) ?? '').trim();

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...(init?.headers || {}),
      'Content-Type': 'application/json',
    },
  });

const buildUrl = (base: string, path: string) => {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
};

const safeJson = async (res: Response) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const handler = async (req: Request) => {
  const origin = req.headers.get('origin');
  const corsHeaders = buildCors(origin, req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return json({ error: 'Method Not Allowed' }, { status: 405, headers: corsHeaders });
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'missing_function_env' }, { status: 500, headers: corsHeaders });
    }

    const token = (req.headers.get('x-user-token') || '').trim() || (() => {
      const authHeader = req.headers.get('Authorization') || '';
      return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    })();
    if (!token) {
      return json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const permRes = await fetch(buildUrl(SUPABASE_URL, '/rest/v1/rpc/has_admin_permission'), {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p: 'customers.manage' }),
    });
    if (!permRes.ok) {
      const body = await safeJson(permRes);
      return json({ error: 'Permission check failed', details: body }, { status: 403, headers: corsHeaders });
    }
    const canManage = await permRes.json();
    if (!canManage) {
      return json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const body: CreateCustomerBody = await req.json();
    const fullName = (body.fullName || '').trim();
    const phone = (body.phone || '').trim();
    const customerType = body.customerType === 'wholesale' ? 'wholesale' : 'retail';
    const creditLimit = typeof body.creditLimit === 'number' ? body.creditLimit : null;
    const notes = (body.notes || '') || null;

    if (!phone) {
      return json({ error: 'Phone is required' }, { status: 400, headers: corsHeaders });
    }

    {
      const u = buildUrl(SUPABASE_URL, `/rest/v1/customers?select=auth_user_id&phone_number=eq.${encodeURIComponent(phone)}&limit=1`);
      const dupRes = await fetch(u, {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      if (!dupRes.ok) {
        const details = await dupRes.text();
        return json({ error: 'Duplicate check failed', details }, { status: 500, headers: corsHeaders });
      }
      const rows = await dupRes.json();
      if (Array.isArray(rows) && rows.length > 0) {
        return json({ error: 'duplicate_phone' }, { status: 409, headers: corsHeaders });
      }
    }

    const businessCustomerId = crypto.randomUUID();
    const customerPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`;

    const createAuthRes = await fetch(buildUrl(SUPABASE_URL, '/auth/v1/admin/users'), {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: `manual-${businessCustomerId}@azta.com`,
        password: customerPassword,
        email_confirm: true,
        user_metadata: {
          manual: true,
          full_name: fullName || null,
          phone_number: phone,
          business_customer_id: businessCustomerId,
        },
      }),
    });

    if (!createAuthRes.ok) {
      const details = await createAuthRes.text();
      return json({ error: 'create_auth_user_failed', details }, { status: 500, headers: corsHeaders });
    }
    const created = await safeJson(createAuthRes);
    const authUserId = (created as any)?.id || (created as any)?.user?.id || null;
    if (!authUserId) {
      return json({ error: 'create_auth_user_failed', details: 'missing_user_id' }, { status: 500, headers: corsHeaders });
    }

    const insertPayload: any = {
      auth_user_id: authUserId,
      full_name: fullName || null,
      phone_number: phone,
      data: { isManual: true, business_customer_id: businessCustomerId, notes: notes || null },
    };
    insertPayload.customer_type = customerType;
    insertPayload.payment_terms = customerType === 'wholesale' ? 'net_30' : 'cash';
    insertPayload.current_balance = 0;
    if (customerType === 'wholesale' && creditLimit !== null) insertPayload.credit_limit = creditLimit;

    const insertRes = await fetch(buildUrl(SUPABASE_URL, '/rest/v1/customers?select=auth_user_id,full_name,phone_number,customer_type,credit_limit,data'), {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(insertPayload),
    });

    if (!insertRes.ok) {
      try {
        await fetch(buildUrl(SUPABASE_URL, `/auth/v1/admin/users/${encodeURIComponent(String(authUserId))}`), {
          method: 'DELETE',
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        });
      } catch {
      }
      const details = await insertRes.text();
      return json({ error: 'insert_failed', details }, { status: 500, headers: corsHeaders });
    }
    const inserted = await safeJson(insertRes);

    const customer = Array.isArray(inserted) ? inserted?.[0] : inserted;
    return json({ customer: customer || null }, { status: 200, headers: corsHeaders });
  } catch (e) {
    return json({ error: (e as Error)?.message || 'internal_error' }, { status: 500, headers: corsHeaders });
  }
};

{
  const deno = (globalThis as any).Deno;
  if (deno?.serve) {
    deno.serve(handler);
  } else {
    addEventListener('fetch', (event: any) => {
      event.respondWith(handler(event.request));
    });
  }
}

export {};
