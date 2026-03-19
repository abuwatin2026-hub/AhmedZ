// passkey-register-verify/index.ts
// Verifies the WebAuthn registration response and saves the credential to DB.

import { verifyRegistrationResponse } from 'https://esm.sh/@simplewebauthn/server@13.1.0';

const getEnv = (name: string): string => {
  const deno = (globalThis as any).Deno;
  const v = deno?.env?.get ? deno.env.get(name) : undefined;
  return typeof v === 'string' ? v : '';
};

const SUPABASE_URL = (getEnv('AZTA_SUPABASE_URL') || getEnv('SUPABASE_URL')).trim();
const SUPABASE_SERVICE_KEY = (getEnv('AZTA_SUPABASE_SERVICE_ROLE_KEY') || getEnv('SUPABASE_SERVICE_ROLE_KEY')).trim();
const SUPABASE_ANON_KEY = (getEnv('AZTA_SUPABASE_ANON_KEY') || getEnv('SUPABASE_ANON_KEY')).trim();
const RP_ID = (getEnv('AZTA_PASSKEY_RP_ID') || 'ahmedzangah.pages.dev').trim();
const ORIGIN = (getEnv('AZTA_PASSKEY_ORIGIN') || `https://${RP_ID}`).trim();

function getAllowedOrigin(origin: string | null): string {
  const raw = (getEnv('AZTA_ALLOWED_ORIGINS') || '').trim();
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

const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCors(origin), 'Content-Type': 'application/json' },
  });

const dbFetch = (path: string, opts: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...((opts.headers as Record<string, string>) || {}),
    },
  });

const handler = async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');
  const corsHeaders = buildCors(origin, req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405, origin);

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY || !RP_ID || !ORIGIN) {
      return new Response(JSON.stringify({ error: 'missing_function_env' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Authenticate the caller
    const token = (() => {
      const h = req.headers.get('Authorization') || req.headers.get('x-user-token') || '';
      return h.startsWith('Bearer ') ? h.slice(7) : h;
    })();
    if (!token) return json({ error: 'Unauthorized' }, 401, origin);

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return json({ error: 'Unauthorized' }, 401, origin);
    const userPayload = await userRes.json();
    const userId: string = userPayload?.id;
    if (!userId) return json({ error: 'Unauthorized' }, 401, origin);

    // 2. Parse request body
    const body = await req.json();
    const { registrationResponse, deviceName } = body as {
      registrationResponse: any;
      deviceName?: string;
    };
    if (!registrationResponse) return json({ error: 'Missing registrationResponse' }, 400, origin);

    // 3. Fetch the stored challenge for this user
    const challengeRes = await dbFetch(
      `/rest/v1/passkey_challenges?user_id=eq.${encodeURIComponent(userId)}&purpose=eq.registration&expires_at=gte.${new Date().toISOString()}&order=created_at.desc&limit=1`
    );
    const challenges = challengeRes.ok ? (await challengeRes.json() as any[]) : [];
    if (!challenges || challenges.length === 0) {
      return json({ error: 'challenge_not_found_or_expired' }, 400, origin);
    }
    const storedChallenge: string = challenges[0].challenge;
    const challengeId: string = challenges[0].id;

    // 4. Verify the registration response
    const verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: storedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return json({ error: 'verification_failed' }, 400, origin);
    }

    const { credential, aaguid } = verification.registrationInfo;

    // 5. Save the credential
    // credential.id is a Uint8Array, encode to base64url
    const credentialIdB64 = btoa(String.fromCharCode(...credential.id))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    // credential.publicKey is a Uint8Array (CBOR), encode to base64url
    const publicKeyB64 = btoa(String.fromCharCode(...credential.publicKey))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    const saveRes = await dbFetch('/rest/v1/passkey_credentials', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        credential_id: credentialIdB64,
        public_key_cbor: publicKeyB64,
        sign_count: credential.counter,
        aaguid: aaguid || null,
        device_name: (deviceName || 'Passkey').slice(0, 100),
        transports: registrationResponse.response?.transports || null,
      }),
    });

    if (!saveRes.ok) {
      const details = await saveRes.text();
      console.error('Save credential failed:', details);
      return json({ error: 'save_failed', details }, 500, origin);
    }

    // 6. Delete the used challenge
    await dbFetch(`/rest/v1/passkey_challenges?id=eq.${encodeURIComponent(challengeId)}`, {
      method: 'DELETE',
    });

    // 7. Cleanup expired challenges (best effort)
    await dbFetch('/rest/v1/passkey_challenges?expires_at=lt.' + new Date().toISOString(), {
      method: 'DELETE',
    });

    return json({ success: true }, 200, origin);
  } catch (e: any) {
    console.error('passkey-register-verify error:', e);
    return json({ error: e?.message || 'internal_error' }, 500, origin);
  }
};

{
  const deno = (globalThis as any).Deno;
  if (deno?.serve) {
    deno.serve(handler);
  } else {
    addEventListener('fetch', (event: any) => event.respondWith(handler(event.request)));
  }
}

export {};
