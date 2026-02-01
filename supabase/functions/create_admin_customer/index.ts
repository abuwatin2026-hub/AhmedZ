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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
    }
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    // Permission check: customers.manage
    const { data: canManage, error: permErr } = await userClient.rpc('has_admin_permission', { p: 'customers.manage' });
    if (permErr) {
      return new Response(JSON.stringify({ error: 'Permission check failed' }), { status: 403 });
    }
    if (!canManage) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const body: CreateCustomerBody = await req.json();
    const fullName = (body.fullName || '').trim();
    const phone = (body.phone || '').trim();
    const customerType = body.customerType === 'wholesale' ? 'wholesale' : 'retail';
    const creditLimit = typeof body.creditLimit === 'number' ? body.creditLimit : null;
    const notes = (body.notes || '') || null;

    if (!phone) {
      return new Response(JSON.stringify({ error: 'Phone is required' }), { status: 400 });
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
        return new Response(JSON.stringify({ error: 'Duplicate check failed' }), { status: 500 });
      }
      if (existingByPhone) {
        return new Response(JSON.stringify({ error: 'duplicate_phone' }), { status: 409 });
      }
    }

    const businessCustomerId = crypto.randomUUID();
    const customerPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: `manual-${businessCustomerId}@azta.local`,
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
      return new Response(JSON.stringify({ error: 'create_auth_user_failed', details: createErr?.message || '' }), { status: 500 });
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
      return new Response(JSON.stringify({ error: 'insert_failed', details: insErr.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ customer: inserted?.[0] || null }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message || 'internal_error' }), { status: 500 });
  }
});
