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

const now = new Date();
const nowIso = now.toISOString();
const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
const allStart = '2020-01-01T00:00:00.000Z';

const windows = [
  { key: 'last_30_days', start: last30, end: nowIso },
  { key: 'month_to_date', start: monthStart, end: nowIso },
  { key: 'all_time', start: allStart, end: nowIso },
];

const runWindow = async (w) => {
  const q = `
with summary as (
  select public.get_sales_report_summary('${w.start}'::timestamptz, '${w.end}'::timestamptz, null, false)::jsonb as j
),
products as (
  select
    count(*)::int as rows_count,
    coalesce(sum(coalesce(p.total_sales,0)),0)::numeric as net_sales,
    coalesce(sum(coalesce(p.total_cost,0)),0)::numeric as cogs,
    coalesce(sum(coalesce(p.total_profit,0)),0)::numeric as gross_profit
  from public.get_product_sales_report_v10('${w.start}'::timestamptz, '${w.end}'::timestamptz, null, false) p
),
r as (
  select
    sum(coalesce(sr.total_refund_amount,0))::numeric as refunds_raw,
    count(*)::int as returns_count
  from public.sales_returns sr
  join public.orders o on o.id = sr.order_id
  where sr.status='completed'
    and sr.return_date >= '${w.start}'::timestamptz
    and sr.return_date <= '${w.end}'::timestamptz
    and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
),
im as (
  select
    sum(coalesce(im.total_cost,0))::numeric as returns_cogs_raw
  from public.inventory_movements im
  join public.sales_returns sr on sr.id::text = im.reference_id and sr.status='completed'
  join public.orders o on o.id = sr.order_id
  where im.reference_table='sales_returns'
    and im.movement_type='return_in'
    and im.occurred_at >= '${w.start}'::timestamptz
    and im.occurred_at <= '${w.end}'::timestamptz
    and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
)
select json_build_object(
  'summary_rpc_exact', json_build_object(
    'total_sales_accrual', coalesce((select (j->>'total_sales_accrual')::numeric from summary),0),
    'returns_total', coalesce((select (j->>'returns_total')::numeric from summary),0),
    'net_sales', coalesce((select (j->>'total_sales_accrual')::numeric - (j->>'returns_total')::numeric from summary),0),
    'cogs', coalesce((select (j->>'cogs')::numeric from summary),0),
    'gross_profit', coalesce((select ((j->>'total_sales_accrual')::numeric - (j->>'returns_total')::numeric) - (j->>'cogs')::numeric from summary),0),
    'cancelled_orders', coalesce((select (j->>'cancelled_orders')::int from summary),0)
  ),
  'product_rpc_exact', json_build_object(
    'rows', coalesce((select rows_count from products),0),
    'net_sales', coalesce((select net_sales from products),0),
    'cogs', coalesce((select cogs from products),0),
    'gross_profit', coalesce((select gross_profit from products),0)
  ),
  'raw_tables_exact', json_build_object(
    'refunds_raw', coalesce((select refunds_raw from r), 0),
    'returns_count', coalesce((select returns_count from r), 0),
    'returns_cogs_raw', coalesce((select returns_cogs_raw from im), 0)
  ),
  'reconciliation_exact', json_build_object(
    'sales_diff_product_vs_summary', coalesce((select net_sales from products),0) - coalesce((select (j->>'total_sales_accrual')::numeric - (j->>'returns_total')::numeric from summary),0),
    'cogs_diff_product_vs_summary', coalesce((select cogs from products),0) - coalesce((select (j->>'cogs')::numeric from summary),0),
    'gross_profit_diff_product_vs_summary', coalesce((select gross_profit from products),0) - coalesce((select ((j->>'total_sales_accrual')::numeric - (j->>'returns_total')::numeric) - (j->>'cogs')::numeric from summary),0)
  )
) as payload
`;
  const raw = await supabase.rpc('exec_debug_sql', { q });
  if (raw.error) throw new Error(`raw_${w.key}: ${raw.error.message}`);

  return {
    key: w.key,
    period_start: w.start,
    period_end: w.end,
    ...raw.data,
  };
};

const results = [];
for (const w of windows) {
  results.push(await runWindow(w));
}

const top5 = fs.existsSync('backups/top5_autocorrect_verify_prod.json')
  ? JSON.parse(fs.readFileSync('backups/top5_autocorrect_verify_prod.json', 'utf8'))
  : [];

const pack = {
  generated_at: nowIso,
  source: 'production_live_exact',
  currency_hint: 'SAR',
  precision_note: 'No manual rounding in calculations. Values are raw numeric outputs from DB/RPC.',
  windows: results,
  top5_current_master_data: top5,
};

fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/accountant_exact_pack_prod.json', JSON.stringify(pack, null, 2), 'utf8');
console.log(JSON.stringify({ file: 'backups/accountant_exact_pack_prod.json', windows: results.length }, null, 2));
