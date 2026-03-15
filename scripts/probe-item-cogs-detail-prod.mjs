import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const itemId = process.argv[2];
if (!itemId) {
  console.error('Usage: node scripts/probe-item-cogs-detail-prod.mjs <item_id>');
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const end = new Date().toISOString();

const q = `
with so as (
  select
    im.id,
    im.reference_id as order_id,
    im.quantity,
    im.total_cost,
    case when coalesce(im.quantity,0)<>0 then im.total_cost/im.quantity else null end as unit_cost,
    im.occurred_at
  from public.inventory_movements im
  join public.orders o on o.id::text = im.reference_id::text
  where im.item_id::text='${itemId}'
    and im.reference_table='orders'
    and im.movement_type='sale_out'
    and im.occurred_at >= '${start}'::timestamptz
    and im.occurred_at <= '${end}'::timestamptz
    and o.status <> 'cancelled'
    and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
),
ri as (
  select
    sum(coalesce(im.quantity,0)) as return_qty,
    sum(coalesce(im.total_cost,0)) as return_cost
  from public.inventory_movements im
  where im.item_id::text='${itemId}'
    and im.reference_table='sales_returns'
    and im.movement_type='return_in'
    and im.occurred_at >= '${start}'::timestamptz
    and im.occurred_at <= '${end}'::timestamptz
)
select json_build_object(
  'item_id','${itemId}',
  'period_start','${start}',
  'period_end','${end}',
  'sale_out_qty', coalesce((select sum(quantity) from so),0),
  'sale_out_cost', coalesce((select sum(total_cost) from so),0),
  'sale_out_rows', coalesce((select count(*) from so),0),
  'max_unit_cost', coalesce((select max(unit_cost) from so),0),
  'min_unit_cost', coalesce((select min(unit_cost) from so),0),
  'sample_rows', (
    select coalesce(json_agg(x), '[]'::json)
    from (
      select id, order_id, quantity, total_cost, unit_cost, occurred_at
      from so
      order by unit_cost desc nulls last
      limit 10
    ) x
  ),
  'returns', json_build_object(
    'return_qty', coalesce((select return_qty from ri),0),
    'return_cost', coalesce((select return_cost from ri),0)
  )
) as payload
`;

const { data, error } = await supabase.rpc('exec_debug_sql', { q });
if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
