import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);
const adminEmail = process.env.ADMIN_EMAIL || env.ADMIN_EMAIL || '';
const adminPassword = process.env.ADMIN_PASSWORD || env.ADMIN_PASSWORD || '';
if (adminEmail && adminPassword) {
  await supabase.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
}
const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const end = new Date().toISOString();

const sumRows = (rows) => ({
  sales: Number((rows || []).reduce((a, r) => a + Number(r?.total_sales || 0), 0).toFixed(2)),
  cogs: Number((rows || []).reduce((a, r) => a + Number(r?.total_cost || 0), 0).toFixed(2)),
});

const v10 = await supabase.rpc('get_product_sales_report_v10', { p_start_date: start, p_end_date: end, p_zone_id: null, p_invoice_only: false });
const v9 = await supabase.rpc('get_product_sales_report_v9', { p_start_date: start, p_end_date: end, p_zone_id: null, p_invoice_only: false });
const unified = await supabase.rpc('get_product_sales_report_unified', { p_start_date: start, p_end_date: end, p_zone_id_text: null, p_invoice_only: false });
const summary = await supabase.rpc('get_sales_report_summary', { p_start_date: start, p_end_date: end, p_zone_id: null, p_invoice_only: false });

console.log(JSON.stringify({
  period: { start, end },
  summary: summary.error ? summary.error : {
    net_sales: Number(summary.data?.total_sales_accrual || 0) - Number(summary.data?.returns_total || 0),
    cogs: Number(summary.data?.cogs || 0),
  },
  v10: v10.error ? v10.error : sumRows(v10.data),
  v9: v9.error ? v9.error : sumRows(v9.data),
  unified: unified.error ? unified.error : sumRows(unified.data),
}, null, 2));
