
// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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

serve(async (req) => {
    const origin = req.headers.get('origin');
    const corsHeaders = buildCors(origin, req);
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseUrl = (Deno.env.get('AZTA_SUPABASE_URL') ?? '').trim()
        const serviceRoleKey = (Deno.env.get('AZTA_SUPABASE_SERVICE_ROLE_KEY') ?? '').trim()
        if (!supabaseUrl || !serviceRoleKey) {
            return new Response(
                JSON.stringify({ error: 'إعدادات الدالة غير مكتملة (AZTA_SUPABASE_URL / AZTA_SUPABASE_SERVICE_ROLE_KEY).' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        })

        const { email, password, fullName, phoneNumber, role, permissions, username } = await req.json()

        if (!email || !password || !fullName || !role) {
            return new Response(
                JSON.stringify({ error: 'الحقول المطلوبة ناقصة.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const normalizedEmail = String(email).trim().toLowerCase()
        const normalizedFullName = String(fullName).trim()
        const normalizedUsername = (typeof username === 'string' ? username : normalizedEmail.split('@')[0]).trim()
        const normalizedRole = String(role).trim()
        const normalizedPhoneNumber = typeof phoneNumber === 'string' ? phoneNumber.trim() : null
        const normalizedPermissions = Array.isArray(permissions)
            ? permissions.filter((p) => typeof p === 'string').map((p) => String(p))
            : []

        if (!normalizedEmail || !normalizedFullName || !normalizedUsername || !normalizedRole) {
            return new Response(
                JSON.stringify({ error: 'البيانات المدخلة غير صحيحة.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 0. Verify Auth User (Security Layer) - Support both standard Bearer and custom header to bypass Gateway issues
        let token = req.headers.get('x-user-token')

        if (!token) {
            const authHeader = req.headers.get('Authorization')
            if (authHeader) {
                token = authHeader.replace('Bearer ', '')
            }
        }

        if (!token) {
            return new Response(
                JSON.stringify({ error: 'Authorization token missing' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const userClient = createClient(supabaseUrl, serviceRoleKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
            global: { headers: { Authorization: `Bearer ${token}` } }
        })

        const { data: { user: authUser }, error: authError } = await userClient.auth.getUser()

        if (authError || !authUser) {
            const internalMsg = authError?.message || 'User verification failed';
            console.error('Auth Check Failed:', internalMsg);
            return new Response(
                JSON.stringify({ error: `SESSION_VERIFICATION_FAILED: ${internalMsg}` }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { data: creatorRow, error: creatorErr } = await supabaseClient
            .from('admin_users')
            .select('auth_user_id, role, is_active, company_id, branch_id, warehouse_id')
            .eq('auth_user_id', authUser.id)
            .maybeSingle()

        if (creatorErr) {
            console.error('Creator lookup failed:', creatorErr?.message || creatorErr);
            return new Response(
                JSON.stringify({ error: 'تعذر التحقق من صلاحيات منشئ المستخدم.' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (!creatorRow?.is_active || !creatorRow?.role || !['owner', 'manager'].includes(String(creatorRow.role))) {
            return new Response(
                JSON.stringify({ error: 'ليس لديك صلاحية إنشاء مستخدمين.' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const creatorCompanyId = creatorRow?.company_id ?? null
        const creatorBranchId = creatorRow?.branch_id ?? null
        const creatorWarehouseId = creatorRow?.warehouse_id ?? null
        if (!creatorCompanyId || !creatorBranchId || !creatorWarehouseId) {
            return new Response(
                JSON.stringify({ error: 'نطاق جلسة منشئ المستخدم غير مكتمل. يجب تعيين الشركة/الفرع/المستودع.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 1. Create User in Supabase Auth
        const { data: userData, error: userError } = await supabaseClient.auth.admin.createUser({
            email: normalizedEmail,
            password,
            email_confirm: true,
            user_metadata: { full_name: normalizedFullName }
        })

        if (userError) {
            const raw = String(userError?.message ?? '')
            const msg = /already registered/i.test(raw)
                ? 'هذا البريد مستخدم مسبقاً.'
                : /password/i.test(raw) && /6/i.test(raw)
                    ? 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.'
                    : raw || 'تعذر إنشاء المستخدم في نظام الدخول.'
            return new Response(
                JSON.stringify({ error: msg }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (!userData.user) {
            throw new Error('User creation failed without error')
        }

        // 2. Insert into admin_users table
        const { error: dbError } = await supabaseClient
            .from('admin_users')
            .insert({
                auth_user_id: userData.user.id,
                email: normalizedEmail,
                username: normalizedUsername,
                full_name: normalizedFullName,
                phone_number: normalizedPhoneNumber,
                role: normalizedRole,
                permissions: normalizedPermissions,
                company_id: creatorCompanyId,
                branch_id: creatorBranchId,
                warehouse_id: creatorWarehouseId,
                is_active: true,
            })

        if (dbError) {
            // Rollback: Delete the auth user if DB insert fails
            await supabaseClient.auth.admin.deleteUser(userData.user.id)
            const raw = String(dbError?.message ?? '')
            const msg = /duplicate key/i.test(raw) && /username/i.test(raw)
                ? 'اسم المستخدم مستخدم مسبقاً.'
                : /violates check constraint/i.test(raw) && /role/i.test(raw)
                    ? 'الدور غير صالح.'
                    : raw || 'تعذر حفظ بيانات المستخدم في قاعدة البيانات.'
            return new Response(
                JSON.stringify({ error: msg }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(
            JSON.stringify(userData),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )

    } catch (error) {
        const raw = String(error?.message ?? '')
        const msg = /duplicate key/i.test(raw) && /username/i.test(raw)
            ? 'اسم المستخدم مستخدم مسبقاً.'
            : /already registered/i.test(raw)
                ? 'هذا البريد مستخدم مسبقاً.'
                : raw || 'حدث خطأ غير متوقع.'
        return new Response(
            JSON.stringify({ error: msg }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
