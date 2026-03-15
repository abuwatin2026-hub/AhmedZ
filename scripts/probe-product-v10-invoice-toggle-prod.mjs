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
await supabase.auth.signInWithPassword({ email: 'owner@azta.com', password: 'AhmedZ#123456' });
const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const end = new Date().toISOString();

const aggregate = (rows) => ({
  sales: Number((rows || []).reduce((a, r) => a + Number(r?.total_sales || 0), 0).toFixed(2)),
  cogs: Number((rows || []).reduce((a, r) => a + Number(r?.total_cost || 0), 0).toFixed(2)),
  count: (rows || []).length,
});

const summary = await supabase.rpc('get_sales_report_summary', { p_start_date: start, p_end_date: end, p_zone_id: null, p_invoice_only: false });
const v10False = await supabase.rpc('get_product_sales_report_v10', { p_start_date: start, p_end_date: end, p_zone_id: null, p_invoice_only: false });
const v10True = await supabase.rpc('get_product_sales_report_v10', { p_start_date: start, p_end_date: end, p_zone_id: null, p_invoice_only: true });

console.log(JSON.stringify({
  period: { start, end },
  summary: summary.error ? summary.error : {
    total_sales_accrual: Number(summary.data?.total_sales_accrual || 0),
    returns_total: Number(summary.data?.returns_total || 0),
    net_sales: Number(summary.data?.total_sales_accrual || 0) - Number(summary.data?.returns_total || 0),
    cogs: Number(summary.data?.cogs || 0),
  },
  v10_false: v10False.error ? v10False.error : aggregate(v10False.data),
  v10_true: v10True.error ? v10True.error : aggregate(v10True.data),
}, null, 2));
