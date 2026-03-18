// passkey-register-options/index.ts
// Returns WebAuthn registration options to the browser.
// Uses @simplewebauthn/server via esm.sh CDN (Deno-compatible).
// The challenge is stored in passkey_challenges table for verification.

import { generateRegistrationOptions } from 'https://esm.sh/@simplewebauthn/server@13.1.0';

const getEnv = (name: string): string => {
  const deno = (globalThis as any).Deno;
  const v = deno?.env?.get ? deno.env.get(name) : undefined;
  return typeof v === 'string' ? v : '';
};

const SUPABASE_URL = (getEnv('AZTA_SUPABASE_URL') || getEnv('SUPABASE_URL')).trim();
const SUPABASE_SERVICE_KEY = (getEnv('AZTA_SUPABASE_SERVICE_ROLE_KEY') || getEnv('SUPABASE_SERVICE_ROLE_KEY')).trim();
const SUPABASE_ANON_KEY = (getEnv('AZTA_SUPABASE_ANON_KEY') || getEnv('SUPABASE_ANON_KEY')).trim();

const RP_NAME = 'مؤسسة أحمد زنقاح للتجارة والتوكيلات';
// RP ID must match the domain of the production site
const RP_ID = 'ahmedzangah.pages.dev';

const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
});

const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405, origin);

  try {
    // 1. Authenticate the caller (must be logged-in customer)
    const token = (() => {
      const h = req.headers.get('Authorization') || req.headers.get('x-user-token') || '';
      return h.startsWith('Bearer ') ? h.slice(7) : h;
    })();
    if (!token) return json({ error: 'Unauthorized' }, 401, origin);

    // Validate JWT via Supabase Auth
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!userRes.ok) return json({ error: 'Unauthorized' }, 401, origin);
    const userPayload = await userRes.json();
    const userId: string = userPayload?.id;
    if (!userId) return json({ error: 'Unauthorized' }, 401, origin);

    // 2. Fetch existing credentials to exclude from new registration
    const credsRes = await dbFetch(
      `/rest/v1/passkey_credentials?user_id=eq.${encodeURIComponent(userId)}&select=credential_id,transports`
    );
    const existingCreds = credsRes.ok ? (await credsRes.json() as any[]) : [];

    // 3. Generate registration options
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: new TextEncoder().encode(userId),
      userName: userId,
      attestationType: 'none',
      excludeCredentials: existingCreds.map((c: any) => ({
        id: c.credential_id,
        type: 'public-key',
        transports: c.transports || [],
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
      },
    });

    // 4. Store challenge with 5-minute expiry
    await dbFetch('/rest/v1/passkey_challenges', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        challenge: options.challenge,
        purpose: 'registration',
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }),
    });

    return json(options, 200, origin);
  } catch (e: any) {
    console.error('passkey-register-options error:', e);
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
