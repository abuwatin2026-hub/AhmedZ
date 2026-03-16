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
loadEnv(path.join(process.cwd(), '.env.development.local'));

const url = String(process.env.AZTA_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const key = String(process.env.AZTA_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const adminEmail = String(process.env.ADMIN_EMAIL || process.env.AZTA_SMOKE_OWNER_EMAIL || 'owner@azta.com').trim();
const adminPassword = String(process.env.ADMIN_PASSWORD || process.env.AZTA_SMOKE_OWNER_PASSWORD || '').trim();

if (!url || !key) {
  throw new Error('Missing AZTA_SUPABASE_URL/VITE_SUPABASE_URL or AZTA_SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY');
}
if (!adminEmail || !adminPassword) {
  throw new Error('Missing ADMIN_EMAIL/ADMIN_PASSWORD');
}

const supabase = createClient(url, key);
const round6 = (v) => Math.round((Number(v || 0) || 0) * 1_000_000) / 1_000_000;
const tolerance = Number(process.env.REPORT_ALIGN_TOLERANCE || '0.05');

const sumRows = (rows) => ({
  sales: round6((rows || []).reduce((a, r) => a + Number(r?.total_sales || 0), 0)),
  cost: round6((rows || []).reduce((a, r) => a + Number(r?.total_cost || 0), 0)),
  qty: round6((rows || []).reduce((a, r) => a + Number(r?.quantity_sold || 0), 0)),
});

const callRpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
  return { ok: true, data };
};

const runCase = async ({ label, start, end, zoneId, invoiceOnly }) => {
  const args = { p_start_date: start, p_end_date: end, p_zone_id: zoneId, p_invoice_only: invoiceOnly };
  const v10 = await callRpc('get_product_sales_report_v10', args);
  const summary = await callRpc('get_sales_report_summary', args);
  if (!v10.ok || !summary.ok) {
    return { label, ok: false, error: { v10: v10.ok ? null : v10.error, summary: summary.ok ? null : summary.error } };
  }
  const totalsV10 = sumRows(Array.isArray(v10.data) ? v10.data : []);
  const s = summary.data || {};
  const summaryNet = round6(Number(s?.total_sales_accrual || 0) - Number(s?.returns_total || 0));
  const summaryCogs = round6(Number(s?.cogs || 0));
  const deltaSales = round6(totalsV10.sales - summaryNet);
  const deltaCogs = round6(totalsV10.cost - summaryCogs);
  const pass = Math.abs(deltaSales) <= tolerance && Math.abs(deltaCogs) <= tolerance;
  return {
    label,
    ok: pass,
    totals: {
      v10_sales: totalsV10.sales,
      v10_cost: totalsV10.cost,
      v10_qty: totalsV10.qty,
      summary_net_sales: summaryNet,
      summary_cogs: summaryCogs,
    },
    delta: { sales: deltaSales, cogs: deltaCogs },
  };
};

const auth = await supabase.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
if (auth.error) {
  throw new Error(`Auth failed: ${auth.error.message}`);
}

const now = new Date();
const start30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
const start90 = new Date(Date.now() - 90 * 24 * 3600 * 1000);

const zoneListRes = await supabase.from('delivery_zones').select('id').limit(1);
const sampleZone = !zoneListRes.error && Array.isArray(zoneListRes.data) && zoneListRes.data[0]?.id
  ? String(zoneListRes.data[0].id)
  : null;

const cases = [
  { label: '30d_all_invoice_false', start: start30.toISOString(), end: now.toISOString(), zoneId: null, invoiceOnly: false },
  { label: '30d_all_invoice_true', start: start30.toISOString(), end: now.toISOString(), zoneId: null, invoiceOnly: true },
  { label: '90d_all_invoice_false', start: start90.toISOString(), end: now.toISOString(), zoneId: null, invoiceOnly: false },
];
if (sampleZone) {
  cases.push({ label: '30d_zone_invoice_false', start: start30.toISOString(), end: now.toISOString(), zoneId: sampleZone, invoiceOnly: false });
}

const results = [];
for (const c of cases) {
  results.push(await runCase(c));
}

const failed = results.filter((r) => !r.ok);
const report = {
  generated_at: new Date().toISOString(),
  tolerance,
  url,
  auth: { ok: true, email: adminEmail },
  sample_zone: sampleZone,
  checks: results,
  summary: {
    total_checks: results.length,
    passed_checks: results.length - failed.length,
    failed_checks: failed.length,
    pass: failed.length === 0,
  },
};

fs.mkdirSync(path.join(process.cwd(), 'backups'), { recursive: true });
const outPath = path.join(process.cwd(), 'backups', 'report_alignment_check_prod.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(outPath);
if (failed.length > 0) {
  process.exitCode = 2;
}
