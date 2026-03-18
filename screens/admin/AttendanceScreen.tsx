import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../supabase';
import PageLoader from '../../components/PageLoader';
import { useToast } from '../../contexts/ToastContext';
import { useNavigate } from 'react-router-dom';

function bufToBase64url(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let s = '';
    bytes.forEach(b => (s += String.fromCharCode(b)));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type Employee = {
    id: string;
    full_name: string;
    employee_code?: string | null;
    is_active: boolean;
    has_pin: boolean;
    webauthn_registered: boolean;
};
type AttendanceRow = {
    id: string; employee_id: string; work_date: string; hours_worked: number;
    overtime_hours: number; overtime_rate_multiplier: number; absence_days: number; employee_name?: string;
};
type PunchRow = {
    id: string; employee_id: string; punch_time: string; punch_type: 'in' | 'out';
    ip_address?: string; is_manual: boolean; employee_name?: string;
};
type AttendanceConfig = {
    id: string; allowed_ips: string[]; work_start_time: string; work_end_time: string;
    work_hours_per_day: number; late_threshold_minutes: number; overtime_rate_multiplier: number;
    allowed_origins: string[]; weekend_days: number[];
};

export default function AttendanceScreen() {
    const { showNotification } = useToast();
    const navigate = useNavigate();
    const supabase = getSupabaseClient();
    const [loading, setLoading] = useState(true);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [tab, setTab] = useState<'punches' | 'summary' | 'config'>('punches');

    // Punches tab
    const [punches, setPunches] = useState<PunchRow[]>([]);
    const [punchDate, setPunchDate] = useState(() => new Date().toISOString().split('T')[0]);

    // Summary tab
    const [records, setRecords] = useState<AttendanceRow[]>([]);
    const [filterMonth, setFilterMonth] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [filterEmployeeId, setFilterEmployeeId] = useState('');

    // Config tab
    const [config, setConfig] = useState<AttendanceConfig | null>(null);
    const [configDraft, setConfigDraft] = useState<Partial<AttendanceConfig>>({});
    const [newIp, setNewIp] = useState('');
    const [newOrigin, setNewOrigin] = useState('');
    const [pinEmployeeId, setPinEmployeeId] = useState('');
    const [pinDraft, setPinDraft] = useState('');
    const [webauthnEmployeeId, setWebauthnEmployeeId] = useState('');

    // Manual add
    const [manualEmpId, setManualEmpId] = useState('');
    const [manualType, setManualType] = useState<'in' | 'out'>('in');
    const [manualTime, setManualTime] = useState('');
    const [manualNotes, setManualNotes] = useState('');

    // Draft for summary add
    const [draft, setDraft] = useState({
        employee_id: '', work_date: new Date().toISOString().split('T')[0],
        hours_worked: 8, overtime_hours: 0, overtime_rate_multiplier: 1.5, absence_days: 0,
    });

    const loadEmployees = useCallback(async () => {
        if (!supabase) return;
        const { data, error } = await supabase.from('payroll_employees').select('id,full_name,employee_code,is_active,pin_hash,pin_fingerprint,webauthn_credential_id').order('full_name');
        if (error) throw error;
        setEmployees((Array.isArray(data) ? data : []).map((e: any) => ({
            id: String(e.id), full_name: String(e.full_name || ''), employee_code: e.employee_code ? String(e.employee_code) : null,
            is_active: Boolean(e.is_active),
            has_pin: Boolean(e.pin_hash || e.pin_fingerprint),
            webauthn_registered: Boolean(e.webauthn_credential_id),
        })));
    }, [supabase]);

    const loadPunches = useCallback(async () => {
        if (!supabase) return;
        const { data, error } = await supabase
            .from('attendance_punches')
            .select('id,employee_id,punch_time,punch_type,ip_address,is_manual,payroll_employees(full_name)')
            .gte('punch_time', punchDate)
            .lt('punch_time', new Date(new Date(punchDate).getTime() + 86400000).toISOString().split('T')[0])
            .order('punch_time', { ascending: false });
        if (error) throw error;
        setPunches((Array.isArray(data) ? data : []).map((r: any) => ({
            id: String(r.id), employee_id: String(r.employee_id),
            punch_time: String(r.punch_time || ''), punch_type: String(r.punch_type || 'in') as 'in' | 'out',
            ip_address: r.ip_address ? String(r.ip_address) : undefined,
            is_manual: Boolean(r.is_manual),
            employee_name: String(r?.payroll_employees?.full_name || ''),
        })));
    }, [supabase, punchDate]);

    const loadRecords = useCallback(async () => {
        if (!supabase) return;
        const [year, month] = filterMonth.split('-').map(Number);
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0).toISOString().split('T')[0];
        let query = supabase
            .from('payroll_attendance')
            .select('id,employee_id,work_date,hours_worked,overtime_hours,overtime_rate_multiplier,absence_days,payroll_employees(full_name)')
            .gte('work_date', startDate).lte('work_date', endDate)
            .order('work_date', { ascending: false });
        if (filterEmployeeId) query = query.eq('employee_id', filterEmployeeId);
        const { data, error } = await query;
        if (error) throw error;
        setRecords((Array.isArray(data) ? data : []).map((r: any) => ({
            id: String(r.id), employee_id: String(r.employee_id), work_date: String(r.work_date || ''),
            hours_worked: Number(r.hours_worked || 0), overtime_hours: Number(r.overtime_hours || 0),
            overtime_rate_multiplier: Number(r.overtime_rate_multiplier || 1.5), absence_days: Number(r.absence_days || 0),
            employee_name: String(r?.payroll_employees?.full_name || ''),
        })));
    }, [supabase, filterMonth, filterEmployeeId]);

    const loadConfig = useCallback(async () => {
        if (!supabase) return;
        const { data, error } = await supabase.from('attendance_config').select('*').limit(1).maybeSingle();
        if (error) throw error;
        if (data) {
            const c: AttendanceConfig = {
                id: String((data as any).id), allowed_ips: Array.isArray((data as any).allowed_ips) ? (data as any).allowed_ips : [],
                work_start_time: String((data as any).work_start_time || '08:00'), work_end_time: String((data as any).work_end_time || '17:00'),
                work_hours_per_day: Number((data as any).work_hours_per_day || 8), late_threshold_minutes: Number((data as any).late_threshold_minutes || 15),
                overtime_rate_multiplier: Number((data as any).overtime_rate_multiplier || 1.5),
                allowed_origins: Array.isArray((data as any).allowed_origins) ? (data as any).allowed_origins : [],
                weekend_days: Array.isArray((data as any).weekend_days) ? (data as any).weekend_days.map((x: any) => Number(x)).filter((x: number) => Number.isInteger(x) && x >= 0 && x <= 6) : [5],
            };
            setConfig(c);
            setConfigDraft(c);
        }
    }, [supabase]);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try { await loadEmployees(); await loadPunches(); await loadConfig(); } catch (e: any) {
                showNotification(String(e?.message || 'تعذر تحميل البيانات'), 'error');
            } finally { setLoading(false); }
        })();
    }, [loadEmployees, loadPunches, loadConfig, showNotification]);

    useEffect(() => { void loadPunches(); }, [loadPunches]);
    useEffect(() => { if (tab === 'summary') void loadRecords(); }, [tab, loadRecords]);

    const addManualPunch = async () => {
        if (!supabase || !manualEmpId) { showNotification('يرجى اختيار الموظف', 'error'); return; }
        try {
            const { error } = await supabase.rpc('punch_attendance_manual', {
                p_employee_id: manualEmpId, p_type: manualType,
                p_time: manualTime ? new Date(manualTime).toISOString() : new Date().toISOString(),
                p_notes: manualNotes || null,
            } as any);
            if (error) throw error;
            showNotification('تم إضافة البصمة يدوياً', 'success');
            setManualEmpId(''); setManualNotes('');
            await loadPunches();
        } catch (e: any) { showNotification(String(e?.message || 'تعذر الإضافة'), 'error'); }
    };

    const deletePunch = async (id: string) => {
        if (!supabase || !window.confirm('هل تريد حذف هذه البصمة؟')) return;
        try {
            const { error } = await supabase.from('attendance_punches').delete().eq('id', id);
            if (error) throw error;
            showNotification('تم الحذف', 'success'); await loadPunches();
        } catch (e: any) { showNotification(String(e?.message || 'تعذر الحذف'), 'error'); }
    };

    const syncToPayroll = async () => {
        if (!supabase) return;
        const [year, month] = filterMonth.split('-').map(Number);
        try {
            const { data, error } = await supabase.rpc('sync_punches_to_payroll_attendance', { p_year: year, p_month: month } as any);
            if (error) throw error;
            showNotification(`تم مزامنة ${data} سجل إلى مسيّر الرواتب`, 'success');
            await loadRecords();
        } catch (e: any) { showNotification(String(e?.message || 'تعذرت المزامنة'), 'error'); }
    };

    const saveConfig = async () => {
        if (!supabase || !config?.id) return;
        try {
            const { error } = await supabase.from('attendance_config').update({
                allowed_ips: configDraft.allowed_ips || [],
                work_start_time: configDraft.work_start_time || '08:00',
                work_end_time: configDraft.work_end_time || '17:00',
                work_hours_per_day: Number(configDraft.work_hours_per_day || 8),
                late_threshold_minutes: Number(configDraft.late_threshold_minutes || 15),
                overtime_rate_multiplier: Number(configDraft.overtime_rate_multiplier || 1.5),
                allowed_origins: configDraft.allowed_origins || [],
                weekend_days: configDraft.weekend_days || [5],
                updated_at: new Date().toISOString(),
            }).eq('id', config.id);
            if (error) throw error;
            showNotification('تم حفظ إعدادات الحضور', 'success'); await loadConfig();
        } catch (e: any) { showNotification(String(e?.message || 'تعذر الحفظ'), 'error'); }
    };

    const saveEmployeePin = async () => {
        if (!supabase || !pinEmployeeId) { showNotification('اختر الموظف أولاً', 'error'); return; }
        if (!/^\d{4}$/.test(pinDraft.trim())) { showNotification('PIN يجب أن يكون 4 أرقام', 'error'); return; }
        try {
            const { error } = await supabase.rpc('set_employee_pin', { p_employee_id: pinEmployeeId, p_pin: pinDraft.trim() } as any);
            if (error) throw error;
            showNotification('تم ضبط PIN المشفر للموظف بنجاح', 'success');
            setPinDraft('');
            await loadEmployees();
        } catch (e: any) { showNotification(String(e?.message || 'تعذر ضبط PIN'), 'error'); }
    };

    const clearEmployeePin = async () => {
        if (!supabase || !pinEmployeeId) { showNotification('اختر الموظف أولاً', 'error'); return; }
        try {
            const { error } = await supabase.rpc('clear_employee_pin', { p_employee_id: pinEmployeeId } as any);
            if (error) throw error;
            showNotification('تم حذف PIN للموظف', 'success');
            await loadEmployees();
        } catch (e: any) { showNotification(String(e?.message || 'تعذر حذف PIN'), 'error'); }
    };

    const registerEmployeeWebauthn = async () => {
        if (!supabase || !webauthnEmployeeId) { showNotification('اختر الموظف أولاً', 'error'); return; }
        if (!(window.PublicKeyCredential && navigator.credentials?.create)) {
            showNotification('المتصفح لا يدعم WebAuthn', 'error');
            return;
        }
        try {
            const employee = employees.find(e => e.id === webauthnEmployeeId);
            const challenge = crypto.getRandomValues(new Uint8Array(32));
            const userId = crypto.getRandomValues(new Uint8Array(16));
            const credential = await navigator.credentials.create({
                publicKey: {
                    challenge,
                    rp: { name: 'Attendance Device', id: window.location.hostname },
                    user: {
                        id: userId,
                        name: `${employee?.employee_code || webauthnEmployeeId}@attendance.local`,
                        displayName: employee?.full_name || 'Employee',
                    },
                    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                    authenticatorSelection: { userVerification: 'required' },
                    timeout: 60000,
                    attestation: 'none',
                },
            }) as PublicKeyCredential | null;
            if (!credential) throw new Error('تم إلغاء التسجيل');
            const credentialId = bufToBase64url(credential.rawId);
            const { error } = await supabase.rpc('register_employee_webauthn', {
                p_employee_id: webauthnEmployeeId,
                p_credential_id: credentialId,
                p_public_key: null,
            } as any);
            if (error) throw error;
            showNotification('تم تسجيل بصمة WebAuthn للموظف', 'success');
            await loadEmployees();
        } catch (e: any) { showNotification(String(e?.message || 'تعذر تسجيل البصمة'), 'error'); }
    };

    const addRecord = async () => {
        if (!supabase || !draft.employee_id) { showNotification('يرجى اختيار الموظف', 'error'); return; }
        try {
            const { error } = await supabase.from('payroll_attendance').upsert({
                employee_id: draft.employee_id, work_date: draft.work_date,
                hours_worked: draft.hours_worked, overtime_hours: draft.overtime_hours,
                overtime_rate_multiplier: draft.overtime_rate_multiplier, absence_days: draft.absence_days,
            }, { onConflict: 'employee_id,work_date' });
            if (error) throw error;
            showNotification('تم حفظ سجل الحضور بنجاح', 'success');
            setDraft(prev => ({ ...prev, overtime_hours: 0, absence_days: 0 }));
            await loadRecords();
        } catch (e: any) { showNotification(String(e?.message || 'تعذر حفظ السجل'), 'error'); }
    };

    const deleteRecord = async (id: string) => {
        if (!supabase || !window.confirm('هل تريد حذف هذا السجل؟')) return;
        try {
            const { error } = await supabase.from('payroll_attendance').delete().eq('id', id);
            if (error) throw error;
            showNotification('تم حذف السجل', 'success'); await loadRecords();
        } catch (e: any) { showNotification(String(e?.message || 'تعذر الحذف'), 'error'); }
    };

    if (loading) return <PageLoader />;
    const activeEmployees = employees.filter(e => e.is_active);
    const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm";
    const tabCls = (active: boolean) => `px-3 py-2 rounded-lg text-sm font-semibold ${active ? 'bg-gray-900 text-white' : 'border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'}`;

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold dark:text-white">الحضور والبصمة</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">سجلات البصمة والحضور والغياب</p>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setTab('punches')} className={tabCls(tab === 'punches')}>سجل البصمات</button>
                    <button type="button" onClick={() => setTab('summary')} className={tabCls(tab === 'summary')}>الملخص الشهري</button>
                    <button type="button" onClick={() => setTab('config')} className={tabCls(tab === 'config')}>الإعدادات</button>
                    <button type="button" onClick={() => navigate('/attendance-punch')}
                        className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold text-sm">
                        🖥️ شاشة البصمة
                    </button>
                </div>
            </div>

            {tab === 'punches' && (
                <div className="space-y-4">
                    {/* Manual Punch Add */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
                        <div className="font-semibold text-gray-700 dark:text-gray-200 mb-3">إضافة بصمة يدوية</div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">الموظف</div>
                                <select value={manualEmpId} onChange={e => setManualEmpId(e.target.value)} className={inputCls}>
                                    <option value="">اختر...</option>
                                    {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                                </select>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">النوع</div>
                                <select value={manualType} onChange={e => setManualType(e.target.value as 'in' | 'out')} className={inputCls}>
                                    <option value="in">دخول</option>
                                    <option value="out">خروج</option>
                                </select>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">الوقت</div>
                                <input type="datetime-local" value={manualTime} onChange={e => setManualTime(e.target.value)} className={inputCls} />
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">ملاحظة</div>
                                <input value={manualNotes} onChange={e => setManualNotes(e.target.value)} className={inputCls} />
                            </div>
                            <div className="flex items-end">
                                <button type="button" onClick={() => void addManualPunch()} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold text-sm w-full">إضافة</button>
                            </div>
                        </div>
                    </div>

                    {/* Filter + Punches Table */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="text-xs text-gray-500 dark:text-gray-400">التاريخ:</div>
                            <input type="date" value={punchDate} onChange={e => setPunchDate(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
                        </div>
                        <table className="min-w-[700px] w-full text-right">
                            <thead className="bg-gray-50 dark:bg-gray-700/50">
                                <tr>
                                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الموظف</th>
                                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">النوع</th>
                                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الوقت</th>
                                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">IP</th>
                                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">يدوي؟</th>
                                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">إجراءات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {punches.length === 0 ? (
                                    <tr><td colSpan={6} className="p-8 text-center text-gray-500 dark:text-gray-400">لا توجد بصمات لهذا اليوم.</td></tr>
                                ) : punches.map(p => (
                                    <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                        <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{p.employee_name || '—'}</td>
                                        <td className="p-3 text-sm border-r dark:border-gray-700">
                                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${p.punch_type === 'in' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-800 dark:text-emerald-200' : 'bg-red-100 text-red-700 dark:bg-red-800 dark:text-red-200'}`}>
                                                {p.punch_type === 'in' ? 'دخول' : 'خروج'}
                                            </span>
                                        </td>
                                        <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">
                                            {new Date(p.punch_time).toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </td>
                                        <td className="p-3 text-xs font-mono text-gray-400 border-r dark:border-gray-700" dir="ltr">{p.ip_address || '—'}</td>
                                        <td className="p-3 text-sm border-r dark:border-gray-700">{p.is_manual ? '✋' : '🤖'}</td>
                                        <td className="p-3 text-sm">
                                            <button type="button" onClick={() => void deletePunch(p.id)} className="px-3 py-1 rounded bg-red-600 text-white text-xs font-semibold">حذف</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {tab === 'summary' && (
                <div className="space-y-4">
                    {/* Add Summary Record */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
                        <div className="font-semibold text-gray-700 dark:text-gray-200 mb-3">تسجيل يدوي</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">الموظف</div>
                                <select value={draft.employee_id} onChange={e => setDraft(prev => ({ ...prev, employee_id: e.target.value }))} className={inputCls}>
                                    <option value="">اختر موظف...</option>
                                    {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                                </select>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">التاريخ</div>
                                <input type="date" value={draft.work_date} onChange={e => setDraft(prev => ({ ...prev, work_date: e.target.value }))} className={inputCls} />
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">ساعات العمل</div>
                                <input type="number" min="0" step="0.5" value={draft.hours_worked} onChange={e => setDraft(prev => ({ ...prev, hours_worked: Number(e.target.value) }))} className={inputCls} />
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">أيام الغياب</div>
                                <input type="number" min="0" step="0.5" value={draft.absence_days} onChange={e => setDraft(prev => ({ ...prev, absence_days: Number(e.target.value) }))} className={inputCls} />
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">ساعات إضافي</div>
                                <input type="number" min="0" step="0.5" value={draft.overtime_hours} onChange={e => setDraft(prev => ({ ...prev, overtime_hours: Number(e.target.value) }))} className={inputCls} />
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">معامل الإضافي</div>
                                <input type="number" min="1" step="0.25" value={draft.overtime_rate_multiplier} onChange={e => setDraft(prev => ({ ...prev, overtime_rate_multiplier: Number(e.target.value) }))} className={inputCls} />
                            </div>
                            <div className="flex items-end">
                                <button type="button" onClick={() => void addRecord()} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold text-sm w-full">حفظ السجل</button>
                            </div>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
                        <div className="flex items-center gap-3 flex-wrap">
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">الشهر</div>
                                <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className={inputCls} />
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">الموظف</div>
                                <select value={filterEmployeeId} onChange={e => setFilterEmployeeId(e.target.value)} className={inputCls}>
                                    <option value="">الكل</option>
                                    {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                                </select>
                            </div>
                            <div className="flex items-end gap-2">
                                <button type="button" onClick={() => void loadRecords()} className="px-4 py-2 rounded-lg bg-gray-900 text-white font-semibold text-sm">بحث</button>
                                <button type="button" onClick={() => void syncToPayroll()} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm">مزامنة البصمات ← الرواتب</button>
                            </div>
                        </div>
                    </div>

                    {/* Records Table */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-x-auto">
                        <table className="min-w-[800px] w-full text-right">
                            <thead className="bg-gray-50 dark:bg-gray-700/50">
                                <tr>
                                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">الموظف</th>
                                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">التاريخ</th>
                                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">ساعات العمل</th>
                                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">غياب</th>
                                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">إضافي</th>
                                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r dark:border-gray-700">معامل</th>
                                    <th className="p-3 text-xs font-semibold text-gray-600 dark:text-gray-300">إجراءات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {records.length === 0 ? (
                                    <tr><td colSpan={7} className="p-8 text-center text-gray-500 dark:text-gray-400">لا توجد سجلات.</td></tr>
                                ) : records.map(r => (
                                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                        <td className="p-3 text-sm dark:text-gray-200 border-r dark:border-gray-700">{r.employee_name || '—'}</td>
                                        <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{r.work_date}</td>
                                        <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{r.hours_worked}</td>
                                        <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">
                                            {r.absence_days > 0 ? <span className="text-red-600 dark:text-red-400 font-semibold">{r.absence_days}</span> : '0'}
                                        </td>
                                        <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">
                                            {r.overtime_hours > 0 ? <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{r.overtime_hours}</span> : '0'}
                                        </td>
                                        <td className="p-3 text-sm font-mono dark:text-gray-200 border-r dark:border-gray-700" dir="ltr">{r.overtime_rate_multiplier}x</td>
                                        <td className="p-3 text-sm">
                                            <button type="button" onClick={() => void deleteRecord(r.id)} className="px-3 py-1 rounded bg-red-600 text-white text-xs font-semibold">حذف</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {tab === 'config' && config && (
                <div className="space-y-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 p-4">
                        <div className="font-semibold text-gray-700 dark:text-gray-200 mb-4">إعدادات نظام البصمة</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">بداية الدوام</div>
                                <input type="time" value={configDraft.work_start_time || ''} onChange={e => setConfigDraft(prev => ({ ...prev, work_start_time: e.target.value }))} className={inputCls} />
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">نهاية الدوام</div>
                                <input type="time" value={configDraft.work_end_time || ''} onChange={e => setConfigDraft(prev => ({ ...prev, work_end_time: e.target.value }))} className={inputCls} />
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">ساعات العمل اليومية</div>
                                <input type="number" value={configDraft.work_hours_per_day || 8} onChange={e => setConfigDraft(prev => ({ ...prev, work_hours_per_day: Number(e.target.value) }))} className={inputCls} />
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">مدة السماح بالتأخير (دقائق)</div>
                                <input type="number" value={configDraft.late_threshold_minutes || 15} onChange={e => setConfigDraft(prev => ({ ...prev, late_threshold_minutes: Number(e.target.value) }))} className={inputCls} />
                            </div>
                            <div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">معامل الساعات الإضافية</div>
                                <input type="number" step="0.25" value={configDraft.overtime_rate_multiplier || 1.5} onChange={e => setConfigDraft(prev => ({ ...prev, overtime_rate_multiplier: Number(e.target.value) }))} className={inputCls} />
                            </div>
                        </div>

                        {/* Allowed IPs */}
                        <div className="mt-6">
                            <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">عناوين IP المسموحة (للبصمة من مكان العمل فقط)</div>
                            <div className="flex flex-wrap gap-2 mb-2">
                                {(configDraft.allowed_ips || []).map((ip, i) => (
                                    <span key={i} className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-200 text-sm font-mono">
                                        {ip}
                                        <button type="button" onClick={() => setConfigDraft(prev => ({ ...prev, allowed_ips: (prev.allowed_ips || []).filter((_, idx) => idx !== i) }))} className="text-red-500 hover:text-red-700 font-bold">×</button>
                                    </span>
                                ))}
                                {(configDraft.allowed_ips || []).length === 0 && <span className="text-xs text-yellow-600 dark:text-yellow-400">⚠️ لا يوجد تقييد — البصمة مسموحة من أي مكان</span>}
                            </div>
                            <div className="flex gap-2">
                                <input value={newIp} onChange={e => setNewIp(e.target.value)} className={inputCls + ' max-w-xs font-mono'} dir="ltr" placeholder="مثال: 192.168.1.100" />
                                <button type="button" onClick={() => { if (newIp.trim()) { setConfigDraft(prev => ({ ...prev, allowed_ips: [...(prev.allowed_ips || []), newIp.trim()] })); setNewIp(''); } }} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">إضافة IP</button>
                            </div>
                        </div>

                        <div className="mt-6">
                            <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Allowed Origins لـ WebAuthn</div>
                            <div className="flex flex-wrap gap-2 mb-2">
                                {(configDraft.allowed_origins || []).map((origin, i) => (
                                    <span key={i} className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-200 text-sm font-mono">
                                        {origin}
                                        <button type="button" onClick={() => setConfigDraft(prev => ({ ...prev, allowed_origins: (prev.allowed_origins || []).filter((_, idx) => idx !== i) }))} className="text-red-500 hover:text-red-700 font-bold">×</button>
                                    </span>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <input value={newOrigin} onChange={e => setNewOrigin(e.target.value)} className={inputCls + ' max-w-xl font-mono'} dir="ltr" placeholder="https://app.example.com" />
                                <button type="button" onClick={() => { if (newOrigin.trim()) { setConfigDraft(prev => ({ ...prev, allowed_origins: [...(prev.allowed_origins || []), newOrigin.trim()] })); setNewOrigin(''); } }} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold">إضافة Origin</button>
                            </div>
                        </div>

                        <div className="mt-6">
                            <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">أيام الإجازة الأسبوعية</div>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { v: 0, t: 'الأحد' }, { v: 1, t: 'الإثنين' }, { v: 2, t: 'الثلاثاء' }, { v: 3, t: 'الأربعاء' },
                                    { v: 4, t: 'الخميس' }, { v: 5, t: 'الجمعة' }, { v: 6, t: 'السبت' },
                                ].map(d => {
                                    const selected = (configDraft.weekend_days || []).includes(d.v);
                                    return (
                                        <button
                                            key={d.v}
                                            type="button"
                                            onClick={() => setConfigDraft(prev => {
                                                const set = new Set(prev.weekend_days || []);
                                                if (set.has(d.v)) set.delete(d.v); else set.add(d.v);
                                                return { ...prev, weekend_days: Array.from(set).sort((a, b) => a - b) };
                                            })}
                                            className={`px-3 py-1 rounded-lg text-sm font-semibold ${selected ? 'bg-orange-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                                        >
                                            {d.t}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-6">
                            <div className="font-semibold text-gray-700 dark:text-gray-200 mb-3">إدارة بيانات البصمة للموظفين</div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-3">
                                    <div className="text-xs text-gray-500 dark:text-gray-400">ضبط PIN مشفر</div>
                                    <select value={pinEmployeeId} onChange={e => setPinEmployeeId(e.target.value)} className={inputCls}>
                                        <option value="">اختر موظف...</option>
                                        {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.full_name} {e.has_pin ? '• PIN ✅' : '• PIN ❌'}</option>)}
                                    </select>
                                    <input type="password" inputMode="numeric" maxLength={4} value={pinDraft} onChange={e => setPinDraft(e.target.value.replace(/\D/g, ''))} className={inputCls + ' font-mono tracking-widest'} dir="ltr" placeholder="4 digits" />
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => void saveEmployeePin()} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold">حفظ PIN</button>
                                        <button type="button" onClick={() => void clearEmployeePin()} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold">حذف PIN</button>
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    <div className="text-xs text-gray-500 dark:text-gray-400">تسجيل بصمة WebAuthn للموظف</div>
                                    <select value={webauthnEmployeeId} onChange={e => setWebauthnEmployeeId(e.target.value)} className={inputCls}>
                                        <option value="">اختر موظف...</option>
                                        {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.full_name} {e.webauthn_registered ? '• WebAuthn ✅' : '• WebAuthn ❌'}</option>)}
                                    </select>
                                    <button type="button" onClick={() => void registerEmployeeWebauthn()} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold">
                                        تسجيل بصمة الآن
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end">
                            <button type="button" onClick={() => void saveConfig()} className="px-6 py-2 rounded-lg bg-emerald-600 text-white font-semibold">حفظ الإعدادات</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
