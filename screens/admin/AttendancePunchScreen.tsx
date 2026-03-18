import { useCallback, useEffect, useState, useRef } from 'react';
import { getSupabaseClient } from '../../supabase';
import { useToast } from '../../contexts/ToastContext';

/* ── helpers ─────────────────────────────────────────── */
function bufToBase64url(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let s = '';
    bytes.forEach(b => (s += String.fromCharCode(b)));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBuf(b64: string): ArrayBuffer {
    const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    const buf = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i);
    return buf.buffer;
}

type PunchResult = {
    success: boolean;
    employee_name: string;
    employee_code?: string;
    punch_type: 'in' | 'out';
    punch_time: string;
};

/* ── component ───────────────────────────────────────── */
export default function AttendancePunchScreen() {
    const { showNotification } = useToast();
    const supabase = getSupabaseClient();

    const [mode, setMode] = useState<'idle' | 'pin' | 'registering'>('idle');
    const [pin, setPin] = useState('');
    const [punchType, setPunchType] = useState<'in' | 'out'>('in');
    const [processing, setProcessing] = useState(false);
    const [lastResult, setLastResult] = useState<PunchResult | null>(null);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [webauthnAvailable, setWebauthnAvailable] = useState(false);
    const [recentPunches, setRecentPunches] = useState<any[]>([]);
    const pinRef = useRef<HTMLInputElement>(null);

    // Update clock every second
    useEffect(() => {
        const t = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(t);
    }, []);

    // Check WebAuthn support
    useEffect(() => {
        setWebauthnAvailable(
            typeof window !== 'undefined' &&
            !!window.PublicKeyCredential &&
            typeof navigator.credentials?.get === 'function'
        );
    }, []);

    // Load recent punches
    const loadRecentPunches = useCallback(async () => {
        if (!supabase) return;
        const today = new Date().toISOString().split('T')[0];
        const { data } = await supabase
            .from('attendance_punches')
            .select('id,employee_id,punch_time,punch_type,payroll_employees(full_name)')
            .gte('punch_time', today)
            .order('punch_time', { ascending: false })
            .limit(10);
        setRecentPunches(Array.isArray(data) ? data : []);
    }, [supabase]);

    useEffect(() => { void loadRecentPunches(); }, [loadRecentPunches]);

    // Get client IP
    const getClientIp = async (): Promise<string> => {
        try {
            const res = await fetch('https://api.ipify.org?format=json');
            const data = await res.json();
            return data.ip || '';
        } catch { return ''; }
    };

    /* ── PIN punch ───────────────────────────────────── */
    const handlePinPunch = async () => {
        if (!supabase || !pin.trim()) return;
        setProcessing(true);
        try {
            const ip = await getClientIp();
            const { data, error } = await supabase.rpc('punch_attendance_pin', {
                p_pin: pin.trim(),
                p_type: punchType,
                p_ip: ip,
            } as any);
            if (error) throw error;
            const result = data as unknown as PunchResult;
            setLastResult(result);
            showNotification(
                `تم تسجيل ${punchType === 'in' ? 'الدخول' : 'الخروج'} — ${result.employee_name}`,
                'success'
            );
            setPin('');
            setMode('idle');
            await loadRecentPunches();

            // Auto-clear result after 5 seconds
            setTimeout(() => setLastResult(null), 5000);
        } catch (e: any) {
            const msg = String(e?.message || '');
            if (msg.includes('PIN not found')) showNotification('رقم PIN غير صحيح', 'error');
            else if (msg.includes('not allowed from this location')) showNotification('غير مسموح من هذا الموقع — يجب التسجيل من مكان العمل', 'error');
            else if (msg.includes('duplicate')) showNotification('تم التسجيل مسبقاً خلال 5 دقائق', 'error');
            else if (msg.includes('inactive')) showNotification('الموظف غير نشط', 'error');
            else showNotification(msg || 'حدث خطأ', 'error');
        } finally {
            setProcessing(false);
        }
    };

    /* ── WebAuthn fingerprint punch ──────────────────── */
    const handleFingerprintPunch = async () => {
        if (!supabase || !webauthnAvailable) return;
        setProcessing(true);
        try {
            const { data: challengeData, error: challengeError } = await supabase.rpc('issue_attendance_webauthn_challenge');
            if (challengeError) throw challengeError;
            const challenge = String(challengeData || '');
            if (!challenge) throw new Error('failed to issue challenge');

            // Get all registered credentials
            const { data: creds } = await supabase.rpc('get_attendance_webauthn_credentials');
            const credList = (Array.isArray(creds) ? creds : (creds as any) || []) as any[];

            if (credList.length === 0) {
                showNotification('لا توجد بصمات مسجلة. يرجى تسجيل البصمات أولاً من الإعدادات.', 'error');
                setProcessing(false);
                return;
            }

            // Build allowCredentials from registered employees
            const allowCredentials = credList.map((c: any) => ({
                type: 'public-key' as const,
                id: base64urlToBuf(c.credential_id),
            }));

            // Request fingerprint
            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge: base64urlToBuf(challenge),
                    allowCredentials,
                    timeout: 30000,
                    userVerification: 'required',
                },
            }) as PublicKeyCredential;

            if (!assertion) {
                showNotification('تم إلغاء البصمة', 'error');
                setProcessing(false);
                return;
            }

            const credentialId = bufToBase64url(assertion.rawId);
            const response = assertion.response as AuthenticatorAssertionResponse;
            const clientDataJson = bufToBase64url(response.clientDataJSON);
            const authenticatorData = bufToBase64url(response.authenticatorData);
            const signature = bufToBase64url(response.signature);

            // Send to server
            const ip = await getClientIp();
            const { data, error } = await supabase.rpc('punch_attendance_webauthn', {
                p_credential_id: credentialId,
                p_type: punchType,
                p_ip: ip,
                p_challenge: challenge,
                p_client_data_json: clientDataJson,
                p_authenticator_data: authenticatorData,
                p_signature: signature,
            } as any);
            if (error) throw error;
            const result = data as unknown as PunchResult;
            setLastResult(result);
            showNotification(
                `تم تسجيل ${punchType === 'in' ? 'الدخول' : 'الخروج'} — ${result.employee_name}`,
                'success'
            );
            await loadRecentPunches();
            setTimeout(() => setLastResult(null), 5000);
        } catch (e: any) {
            const msg = String(e?.message || e?.name || '');
            if (msg.includes('NotAllowedError') || msg.includes('AbortError')) {
                showNotification('تم إلغاء البصمة أو رفض الإذن', 'error');
            } else if (msg.includes('credential not registered')) {
                showNotification('البصمة غير مسجلة — يرجى تسجيلها أولاً', 'error');
            } else if (msg.includes('invalid or expired challenge')) {
                showNotification('انتهت صلاحية جلسة التحقق — حاول مجددًا', 'error');
            } else if (msg.includes('incomplete webauthn assertion')) {
                showNotification('فشل التحقق من بيانات البصمة', 'error');
            } else if (msg.includes('not allowed from this location')) {
                showNotification('غير مسموح من هذا الموقع', 'error');
            } else {
                showNotification(msg || 'حدث خطأ', 'error');
            }
        } finally {
            setProcessing(false);
        }
    };

    /* ── Render ──────────────────────────────────────── */
    const timeStr = currentTime.toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = currentTime.toLocaleDateString('ar-SA-u-nu-latn', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex flex-col items-center justify-center p-4 select-none" dir="rtl">
            {/* Clock */}
            <div className="text-center mb-8">
                <div className="text-7xl font-bold text-white tabular-nums tracking-wider" dir="ltr">
                    {timeStr}
                </div>
                <div className="text-xl text-gray-400 mt-2">{dateStr}</div>
            </div>

            {/* Success Flash */}
            {lastResult && (
                <div className={`fixed inset-0 z-50 flex items-center justify-center ${lastResult.punch_type === 'in' ? 'bg-emerald-900/90' : 'bg-red-900/90'}`}
                    onClick={() => setLastResult(null)}
                >
                    <div className="text-center animate-pulse">
                        <div className="text-8xl mb-4">{lastResult.punch_type === 'in' ? '✅' : '🔴'}</div>
                        <div className="text-4xl font-bold text-white mb-2">
                            {lastResult.punch_type === 'in' ? 'تسجيل دخول' : 'تسجيل خروج'}
                        </div>
                        <div className="text-3xl text-white/90">{lastResult.employee_name}</div>
                        <div className="text-xl text-white/60 mt-2 font-mono" dir="ltr">
                            {new Date(lastResult.punch_time).toLocaleTimeString('ar-SA-u-nu-latn')}
                        </div>
                    </div>
                </div>
            )}

            {/* Punch Type Toggle */}
            <div className="flex gap-0 rounded-2xl overflow-hidden shadow-2xl mb-8 border border-gray-600">
                <button
                    type="button"
                    onClick={() => setPunchType('in')}
                    className={`px-12 py-5 text-2xl font-bold transition-all ${punchType === 'in'
                        ? 'bg-emerald-600 text-white shadow-inner'
                        : 'bg-gray-700 text-gray-400 hover:text-white'
                        }`}
                >
                    🟢 بصمة دخول
                </button>
                <button
                    type="button"
                    onClick={() => setPunchType('out')}
                    className={`px-12 py-5 text-2xl font-bold transition-all ${punchType === 'out'
                        ? 'bg-red-600 text-white shadow-inner'
                        : 'bg-gray-700 text-gray-400 hover:text-white'
                        }`}
                >
                    🔴 بصمة خروج
                </button>
            </div>

            {/* Main Actions */}
            <div className="flex flex-col items-center gap-4 w-full max-w-md">
                {/* Fingerprint Button */}
                {webauthnAvailable && (
                    <button
                        type="button"
                        onClick={() => void handleFingerprintPunch()}
                        disabled={processing}
                        className={`w-full py-6 rounded-2xl text-2xl font-bold shadow-2xl transition-all ${processing ? 'opacity-60 cursor-wait' : 'hover:scale-105 active:scale-95'
                            } ${punchType === 'in'
                                ? 'bg-gradient-to-r from-emerald-500 to-emerald-700 text-white'
                                : 'bg-gradient-to-r from-red-500 to-red-700 text-white'
                            }`}
                    >
                        {processing ? 'جارِ التحقق...' : '👆 ضع إصبعك للبصمة'}
                    </button>
                )}

                {/* Divider */}
                <div className="flex items-center gap-3 w-full">
                    <div className="h-px flex-1 bg-gray-600" />
                    <span className="text-gray-500 text-sm">أو أدخل رقم PIN</span>
                    <div className="h-px flex-1 bg-gray-600" />
                </div>

                {/* PIN Input */}
                {mode === 'pin' ? (
                    <div className="w-full flex flex-col gap-3">
                        <input
                            ref={pinRef}
                            type="password"
                            inputMode="numeric"
                            maxLength={6}
                            value={pin}
                            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                            onKeyDown={e => { if (e.key === 'Enter') void handlePinPunch(); }}
                            placeholder="أدخل رقم PIN"
                            className="w-full px-6 py-5 rounded-2xl text-center text-3xl font-bold tracking-[0.5em] border-2 border-gray-600 bg-gray-800 text-white focus:border-blue-500 outline-none"
                            autoFocus
                        />
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => void handlePinPunch()}
                                disabled={processing || pin.length < 3}
                                className={`flex-1 py-4 rounded-xl text-xl font-bold shadow-lg transition-all ${processing || pin.length < 3 ? 'opacity-50 cursor-not-allowed' : ''
                                    } ${punchType === 'in'
                                        ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                                        : 'bg-red-600 text-white hover:bg-red-500'
                                    }`}
                            >
                                {processing ? 'جارِ...' : punchType === 'in' ? '✓ تسجيل دخول' : '✓ تسجيل خروج'}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setMode('idle'); setPin(''); }}
                                className="px-6 py-4 rounded-xl text-xl font-bold bg-gray-700 text-gray-300 hover:bg-gray-600"
                            >
                                إلغاء
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => { setMode('pin'); setTimeout(() => pinRef.current?.focus(), 100); }}
                        className="w-full py-5 rounded-2xl text-xl font-bold bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600 transition-all"
                    >
                        🔢 إدخال رمز PIN
                    </button>
                )}
            </div>

            {/* Recent Punches */}
            {recentPunches.length > 0 && (
                <div className="mt-10 w-full max-w-lg">
                    <div className="text-gray-500 text-sm mb-2 text-center">آخر البصمات اليوم</div>
                    <div className="bg-gray-800/50 rounded-xl border border-gray-700 divide-y divide-gray-700/50 max-h-48 overflow-y-auto">
                        {recentPunches.map((p: any) => (
                            <div key={p.id} className="flex items-center justify-between px-4 py-2">
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${p.punch_type === 'in' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                    <span className="text-white text-sm">{p.payroll_employees?.full_name || '—'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs px-2 py-0.5 rounded ${p.punch_type === 'in' ? 'bg-emerald-800 text-emerald-200' : 'bg-red-800 text-red-200'}`}>
                                        {p.punch_type === 'in' ? 'دخول' : 'خروج'}
                                    </span>
                                    <span className="text-gray-400 text-xs font-mono" dir="ltr">
                                        {new Date(p.punch_time).toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Footer */}
            <div className="mt-10 text-gray-600 text-xs text-center">
                نظام تسجيل الحضور — ضع إصبعك أو أدخل رمز PIN
            </div>
        </div>
    );
}
