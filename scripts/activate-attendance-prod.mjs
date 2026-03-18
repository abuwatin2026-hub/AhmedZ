import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const loadEnv = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
};

loadEnv(path.join(process.cwd(), '.env.production'));
loadEnv(path.join(process.cwd(), '.env.local'));

const isDryRun = process.argv.includes('--dry-run');
const projectRoot = process.cwd();
const migrationPath = path.join(projectRoot, 'supabase', 'migrations', '20260318123000_attendance_worldclass_hardening.sql');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = String(process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const ownerEmail = String(process.env.OWNER_EMAIL || process.env.ATTENDANCE_OWNER_EMAIL || '').trim();
const ownerPassword = String(process.env.OWNER_PASSWORD || process.env.ATTENDANCE_OWNER_PASSWORD || '').trim();
const allowedIps = String(process.env.ATTENDANCE_ALLOWED_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
const allowedOrigins = String(process.env.ATTENDANCE_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const weekendDaysRaw = String(process.env.ATTENDANCE_WEEKEND_DAYS || '5').split(',').map(s => s.trim()).filter(Boolean);
const weekendDays = weekendDaysRaw.map(v => Number(v)).filter(v => Number.isInteger(v) && v >= 0 && v <= 6);
const pinMapRaw = String(process.env.ATTENDANCE_PIN_MAP || '').trim();
const pinMap = pinMapRaw ? JSON.parse(pinMapRaw) : {};

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

if (!isDryRun && (!ownerEmail || !ownerPassword)) {
  throw new Error('Missing OWNER_EMAIL/OWNER_PASSWORD or ATTENDANCE_OWNER_EMAIL/ATTENDANCE_OWNER_PASSWORD');
}

if (isDryRun) {
  console.log(JSON.stringify({
    dryRun: true,
    migrationPath,
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey),
    hasOwnerEmail: Boolean(ownerEmail),
    hasOwnerPassword: Boolean(ownerPassword),
    allowedIpsCount: allowedIps.length,
    allowedOriginsCount: allowedOrigins.length,
    weekendDays,
    pinMapEntries: Object.keys(pinMap || {}).length,
  }, null, 2));
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
const signIn = await supabase.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
if (signIn.error) throw signIn.error;

const execSql = async (q) => {
  const { error } = await supabase.rpc('exec_debug_sql', { q });
  if (error) throw error;
};

await execSql(migrationSql);

const weekendSql = `{${(weekendDays.length ? weekendDays : [5]).join(',')}}`;
const ipsSql = `{${allowedIps.map(v => `"${v.replace(/"/g, '\\"')}"`).join(',')}}`;
const originsSql = `{${allowedOrigins.map(v => `"${v.replace(/"/g, '\\"')}"`).join(',')}}`;

await execSql(`
update public.attendance_config
set allowed_ips = '${ipsSql}'::text[],
    allowed_origins = '${originsSql}'::text[],
    weekend_days = '${weekendSql}'::int[],
    updated_at = now();
`);

if (pinMap && typeof pinMap === 'object') {
  const { data: employees, error: empErr } = await supabase
    .from('payroll_employees')
    .select('id,employee_code,is_active')
    .eq('is_active', true);
  if (empErr) throw empErr;
  const byCode = new Map((employees || []).map(e => [String(e.employee_code || '').trim(), String(e.id)]));
  for (const [code, pin] of Object.entries(pinMap)) {
    const employeeId = byCode.get(String(code).trim());
    if (!employeeId) continue;
    const pinText = String(pin || '').trim();
    if (!/^\d{4}$/.test(pinText)) continue;
    const { error } = await supabase.rpc('set_employee_pin', { p_employee_id: employeeId, p_pin: pinText });
    if (error) throw error;
  }
}

const probes = {};
const runProbe = async (label, sql) => {
  const { data, error } = await supabase.rpc('exec_debug_sql', { q: sql });
  probes[label] = { ok: !error, error: error?.message || null, data: data || null };
};

await runProbe('has_set_pin', `select to_regprocedure('public.set_employee_pin(uuid,text)') is not null as ok;`);
await runProbe('has_issue_challenge', `select to_regprocedure('public.issue_attendance_webauthn_challenge()') is not null as ok;`);
await runProbe('has_webauthn_v2', `select to_regprocedure('public.punch_attendance_webauthn(text,text,text,text,text,text,text)') is not null as ok;`);

await supabase.auth.signOut();

console.log(JSON.stringify({
  appliedMigration: true,
  setup: {
    allowedIpsCount: allowedIps.length,
    allowedOriginsCount: allowedOrigins.length,
    weekendDays: weekendDays.length ? weekendDays : [5],
    pinMapEntries: Object.keys(pinMap || {}).length,
  },
  probes,
}, null, 2));
