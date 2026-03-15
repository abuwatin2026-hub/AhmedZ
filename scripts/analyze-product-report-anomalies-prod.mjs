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

const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY,
);
await supabase.auth.signInWithPassword({ email: 'owner@azta.com', password: 'AhmedZ#123456' });

const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const end = new Date().toISOString();

const { data, error } = await supabase.rpc('get_product_sales_report_v10', {
  p_start_date: start,
  p_end_date: end,
  p_zone_id: null,
  p_invoice_only: false,
});
if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}

const rows = Array.isArray(data) ? data : [];
const eps = 0.01;

const zeroQtyNonZeroSales = rows.filter((r) => Number(r?.quantity_sold || 0) === 0 && Math.abs(Number(r?.total_sales || 0)) > eps);
const negativeProfitRows = rows.filter((r) => Number(r?.total_profit || 0) < -eps);
const marginOutliers = rows.filter((r) => {
  const s = Number(r?.total_sales || 0);
  const p = Number(r?.total_profit || 0);
  if (Math.abs(s) <= eps) return false;
  const m = (p / s) * 100;
  return m > 100.5 || m < -100.5;
});

const key = (r) => `${JSON.stringify(r?.item_name || null)}|${String(r?.unit_type || '')}|${Number(r?.quantity_sold || 0)}|${Number(r?.total_sales || 0)}|${Number(r?.total_cost || 0)}|${Number(r?.total_profit || 0)}`;
const dupMap = new Map();
for (const r of rows) {
  const k = key(r);
  dupMap.set(k, (dupMap.get(k) || 0) + 1);
}
const exactDuplicates = [...dupMap.entries()].filter(([, c]) => c > 1).length;

const summary = {
  period: { start, end },
  total_rows: rows.length,
  zero_qty_nonzero_sales_rows: zeroQtyNonZeroSales.length,
  negative_profit_rows: negativeProfitRows.length,
  margin_outlier_rows: marginOutliers.length,
  exact_duplicate_signature_count: exactDuplicates,
  sample_zero_qty_nonzero_sales: zeroQtyNonZeroSales.slice(0, 10),
  sample_negative_profit: negativeProfitRows.slice(0, 10),
  sample_margin_outliers: marginOutliers.slice(0, 10),
};

fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/product_report_anomalies_prod.json', JSON.stringify(summary, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
