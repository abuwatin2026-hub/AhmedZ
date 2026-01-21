// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

function getAllowedOrigin(origin: string | null): string {
    const raw = (Deno.env.get('CATY_ALLOWED_ORIGINS') || '').trim();
    if (!raw) return 'http://localhost:5174';
    const list = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (!origin) return list[0] || '*';
    return list.includes(origin) ? origin : list[0] || '*';
}

function buildCors(origin: string | null) {
    const allowOrigin = getAllowedOrigin(origin);
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-token',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    } as Record<string, string>;
}

serve(async (req) => {
    const origin = req.headers.get('origin');
    const corsHeaders = buildCors(origin);
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseUrl = Deno.env.get('CATY_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? ''
        const serviceRoleKey = Deno.env.get('CATY_SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        if (!supabaseUrl || !serviceRoleKey) {
            return new Response(
                JSON.stringify({ error: 'إعدادات الدالة غير مكتملة (CATY_SUPABASE_URL / CATY_SUPABASE_SERVICE_ROLE_KEY).' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        })
        const { userId } = await req.json()

        if (!userId) {
            return new Response(
                JSON.stringify({ error: 'Missing userId' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        let token = req.headers.get('x-user-token') || null
        if (!token) {
            const authHeader = req.headers.get('Authorization')
            if (authHeader) token = authHeader.replace('Bearer ', '')
        }
        if (!token) {
            return new Response(
                JSON.stringify({ error: 'Authorization token missing' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseAnonKey = Deno.env.get('CATY_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: `Bearer ${token}` } }
        })

        const { data: { user: authUser }, error: authError } = await userClient.auth.getUser()
        if (authError || !authUser) {
            const internalMsg = authError?.message || 'User verification failed'
            return new Response(
                JSON.stringify({ error: `SESSION_VERIFICATION_FAILED: ${internalMsg}` }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { data: requesterRow, error: requesterErr } = await supabaseClient
            .from('admin_users')
            .select('role, permissions, is_active')
            .eq('auth_user_id', authUser.id)
            .maybeSingle()
        if (requesterErr) {
            return new Response(
                JSON.stringify({ error: 'Failed to verify permissions' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }
        const isActive = Boolean(requesterRow?.is_active)
        const role = String(requesterRow?.role || '')
        const perms: string[] = Array.isArray(requesterRow?.permissions) ? requesterRow!.permissions as string[] : []
        const canManage = isActive && (role === 'owner' || perms.includes('adminUsers.manage'))
        if (!canManage) {
            return new Response(
                JSON.stringify({ error: 'Not authorized' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { data: targetRow, error: targetErr } = await supabaseClient
            .from('admin_users')
            .select('role')
            .eq('auth_user_id', userId)
            .maybeSingle()
        if (targetErr) {
            return new Response(
                JSON.stringify({ error: 'Failed to load target user' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }
        if (String(targetRow?.role || '') === 'owner') {
            return new Response(
                JSON.stringify({ error: 'Cannot delete owner account' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { data: existingAdminUser, error: existingErr } = await supabaseClient
            .from('admin_users')
            .select('auth_user_id, is_active')
            .eq('auth_user_id', userId)
            .maybeSingle()
        if (existingErr) {
            return new Response(
                JSON.stringify({ error: 'Failed to load target user' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }
        if (!existingAdminUser) {
            return new Response(
                JSON.stringify({ error: 'المستخدم غير موجود.' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (!existingAdminUser.is_active) {
            return new Response(
                JSON.stringify({ message: 'تم إيقاف المستخدم مسبقاً.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
            )
        }

        const { error: dbError } = await supabaseClient
            .from('admin_users')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('auth_user_id', userId)

        if (dbError) throw dbError

        return new Response(
            JSON.stringify({ message: 'تم إيقاف المستخدم بنجاح.' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
