/// <reference path="../../../types-deno-edge.d.ts" />

// Phase 6: Admin-created customer via Edge Function (Security Definer equivalent)
// Constraints:
// - Do not modify existing RLS
// - Verify caller has customers.manage
// - Create auth user (phone-only) then insert into public.customers
// - Prevent duplicate phone; avoid linking to admin user records

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';

type CreateCustomerBody = {
  fullName?: string;
  phone: string;
  customerType?: 'retail' | 'wholesale';
  creditLimit?: number | null;
  notes?: string | null;
};

function getAllowedOrigin(origin: string | null): string {
  const raw = (Deno.env.get('AZTA_ALLOWED_ORIGINS') || '').trim();
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

const SUPABASE_URL = ((Deno.env.get('AZTA_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL')) ?? '').trim();
const SUPABASE_ANON_KEY = ((Deno.env.get('AZTA_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')) ?? '').trim();
const SUPABASE_SERVICE_ROLE_KEY = ((Deno.env.get('AZTA_SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) ?? '').trim();

serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const corsHeaders = buildCors(origin, req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: 'missing_function_env' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const token = (req.headers.get('x-user-token') || '').trim() || (() => {
      const authHeader = req.headers.get('Authorization') || '';
      return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    })();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    // Permission check: customers.manage
    const { data: canManage, error: permErr } = await userClient.rpc('has_admin_permission', { p: 'customers.manage' });
    if (permErr) {
      return new Response(JSON.stringify({ error: 'Permission check failed' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!canManage) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body: CreateCustomerBody = await req.json();
    const fullName = (body.fullName || '').trim();
    const phone = (body.phone || '').trim();
    const customerType = body.customerType === 'wholesale' ? 'wholesale' : 'retail';
    const creditLimit = typeof body.creditLimit === 'number' ? body.creditLimit : null;
    const notes = (body.notes || '') || null;

    if (!phone) {
      return new Response(JSON.stringify({ error: 'Phone is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Prevent duplicate phone
    {
      const { data: existingByPhone, error: dupErr } = await adminClient
        .from('customers')
        .select('auth_user_id')
        .eq('phone_number', phone)
        .limit(1)
        .maybeSingle();
      if (dupErr) {
        return new Response(JSON.stringify({ error: 'Duplicate check failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (existingByPhone) {
        return new Response(JSON.stringify({ error: 'duplicate_phone' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const businessCustomerId = crypto.randomUUID();
    const customerPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: `manual-${businessCustomerId}@azta.com`,
      password: customerPassword,
      email_confirm: true,
      user_metadata: {
        manual: true,
        full_name: fullName || null,
        phone_number: phone,
        business_customer_id: businessCustomerId,
      },
    });

    const authUserId = created?.user?.id || null;
    if (createErr || !authUserId) {
      return new Response(JSON.stringify({ error: 'create_auth_user_failed', details: createErr?.message || '' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

    const { data: inserted, error: insErr } = await adminClient
      .from('customers')
      .insert(insertPayload)
      .select('auth_user_id, full_name, phone_number, customer_type, credit_limit, data')
      .limit(1);

    if (insErr) {
      try { await adminClient.auth.admin.deleteUser(authUserId); } catch {}
      return new Response(JSON.stringify({ error: 'insert_failed', details: insErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ customer: inserted?.[0] || null }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message || 'internal_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
