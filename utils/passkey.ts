/**
 * utils/passkey.ts
 * Custom WebAuthn Passkey helpers using @simplewebauthn/browser.
 * Communicates with our Supabase Edge Functions (passkey-register-options, passkey-register-verify).
 */

import { startRegistration } from '@simplewebauthn/browser';
import { getSupabaseClient } from '../supabase';

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
  : 'https://pmhivhtaoydfolseelyc.supabase.co/functions/v1';

/** Passkey row returned from list_passkey_credentials() RPC */
export interface PasskeyCredential {
  id: string;
  device_name: string;
  aaguid: string | null;
  created_at: string;
  last_used_at: string | null;
  transports: string[] | null;
}

/** Get bearer token from active Supabase session */
async function getBearerToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

/** Call an Edge Function with the user's JWT */
async function callEdgeFunction(
  fnName: string,
  body: Record<string, unknown>
): Promise<{ data?: unknown; error?: string }> {
  const token = await getBearerToken();
  if (!token) return { error: 'not_authenticated' };

  const res = await fetch(`${FUNCTIONS_URL}/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  let json: Record<string, unknown>;
  try { json = await res.json(); } catch { json = {}; }

  if (!res.ok) {
    return { error: (json.error as string) || `HTTP ${res.status}` };
  }
  return { data: json };
}

/** Register a new passkey. Triggers native browser biometric prompt. */
export async function registerPasskey(deviceName?: string): Promise<{ success: true } | { error: string }> {
  // 1. Check browser support
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return { error: 'browser_not_supported' };
  }

  // 2. Get registration options from server
  const optResult = await callEdgeFunction('passkey-register-options', {});
  if (optResult.error) return { error: optResult.error };
  const options = optResult.data as Record<string, unknown>;

  // 3. Show native browser passkey prompt
  let registrationResponse;
  try {
    registrationResponse = await startRegistration({ optionsJSON: options as any });
  } catch (e: any) {
    if (e?.name === 'NotAllowedError') return { error: 'user_cancelled' };
    if (e?.name === 'InvalidStateError') return { error: 'already_registered' };
    return { error: e?.message || 'webauthn_error' };
  }

  // 4. Send response to server for verification + storage
  const verResult = await callEdgeFunction('passkey-register-verify', {
    registrationResponse,
    deviceName: deviceName || `Passkey (${new Date().toLocaleDateString('ar-YE-u-nu-latn')})`,
  });
  if (verResult.error) return { error: verResult.error };

  return { success: true };
}

/** List all passkeys for the current user */
export async function listPasskeys(): Promise<PasskeyCredential[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_passkey_credentials');
  if (error) {
    console.error('list_passkey_credentials error:', error);
    return [];
  }
  return (data as PasskeyCredential[]) || [];
}

/** Delete a passkey by its primary key UUID */
export async function deletePasskey(passkeyId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('delete_passkey_credential', { p_credential_pk: passkeyId });
  if (error) {
    console.error('delete_passkey_credential error:', error);
    return false;
  }
  return Boolean(data);
}

/** Localize error codes to Arabic */
export function localizePasskeyError(err: string): string {
  const map: Record<string, string> = {
    not_authenticated: 'يجب تسجيل الدخول أولاً.',
    browser_not_supported: 'متصفحك لا يدعم البصمة (WebAuthn).',
    user_cancelled: 'تم إلغاء العملية من قِبلك.',
    already_registered: 'هذا الجهاز مسجّل بالفعل.',
    challenge_not_found_or_expired: 'انتهت صلاحية الطلب. أعد المحاولة.',
    verification_failed: 'فشل التحقق من البصمة.',
    save_failed: 'فشل حفظ بيانات البصمة.',
    webauthn_error: 'خطأ في WebAuthn.',
    internal_error: 'خطأ داخلي في الخادم.',
  };
  return map[err] || `خطأ: ${err}`;
}
