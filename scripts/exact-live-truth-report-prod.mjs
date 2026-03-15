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

const appliedPath = 'backups/top5_autocorrect_applied_prod.json';
if (!fs.existsSync(appliedPath)) {
  console.error(`Missing ${appliedPath}`);
  process.exit(1);
}
const applied = JSON.parse(fs.readFileSync(appliedPath, 'utf8'));
const changedAt = applied.created_at;
const top5Ids = (applied.changes || []).map((x) => String(x.item_id));
const nowIso = new Date().toISOString();
const start30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

const exactSql = `
with v as (
  select * from public.get_product_sales_report_v10('${start30}'::timestamptz, '${nowIso}'::timestamptz, null, false)
)
select json_build_object(
  'period_start', '${start30}',
  'period_end', '${nowIso}',
  'rows', count(*),
  'zero_qty_nonzero_sales_rows', count(*) filter (where coalesce(quantity_sold,0)=0 and abs(coalesce(total_sales,0))>0.0000001),
  'negative_profit_rows', count(*) filter (where coalesce(total_profit,0)<0),
  'outlier_margin_rows', count(*) filter (where coalesce(total_sales,0)<>0 and ((coalesce(total_profit,0)/nullif(total_sales,0))*100 > 100 or (coalesce(total_profit,0)/nullif(total_sales,0))*100 < -100)),
  'sum_total_sales', coalesce(sum(total_sales),0),
  'sum_total_cost', coalesce(sum(total_cost),0),
  'sum_total_profit', coalesce(sum(total_profit),0)
) as payload
from v
`;
const exactAgg = await supabase.rpc('exec_debug_sql', { q: exactSql });
if (exactAgg.error) {
  console.error(JSON.stringify(exactAgg.error, null, 2));
  process.exit(1);
}

const { data: currentItems, error: currentItemsErr } = await supabase
  .from('menu_items')
  .select('id,status,price')
  .in('id', top5Ids)
  .order('id');
if (currentItemsErr) {
  console.error(JSON.stringify(currentItemsErr, null, 2));
  process.exit(1);
}

const sinceRes = await supabase.rpc('get_product_sales_report_v10', {
  p_start_date: changedAt,
  p_end_date: nowIso,
  p_zone_id: null,
  p_invoice_only: false,
});
if (sinceRes.error) {
  console.error(JSON.stringify(sinceRes.error, null, 2));
  process.exit(1);
}
const byId = new Map((sinceRes.data || []).map((r) => [String(r.item_id), r]));
const top5Realized = (applied.changes || []).map((x) => {
  const r = byId.get(String(x.item_id)) || {};
  return {
    item_id: x.item_id,
    item_name: x.item_name,
    mode_applied: x.mode,
    changed_at: changedAt,
    realized_quantity_since_change: Number(r.quantity_sold || 0),
    realized_sales_since_change: Number(r.total_sales || 0),
    realized_cost_since_change: Number(r.total_cost || 0),
    realized_profit_since_change: Number(r.total_profit || 0),
  };
});

const output = {
  generated_at: nowIso,
  source: 'production_live',
  exact_30d_aggregate: exactAgg.data,
  top5_current_master_data: currentItems,
  top5_realized_since_change: top5Realized,
};

fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/exact_live_truth_report_prod.json', JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify(output, null, 2));
