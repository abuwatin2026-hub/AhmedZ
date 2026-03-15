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

const q = `
with eo as (
  select o.id, o.status, nullif(o.data->>'paidAt','')::timestamptz as paid_at,
         coalesce(
           nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
           nullif(o.data->>'paidAt', '')::timestamptz,
           nullif(o.data->>'deliveredAt', '')::timestamptz,
           o.created_at
         ) as date_by
  from public.orders o
  where nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
),
sales_orders as (
  select * from eo
  where status <> 'cancelled'
    and (status='delivered' or paid_at is not null)
    and date_by >= '${start}' and date_by <= '${end}'
),
oic as (
  select oic.item_id::text as item_id, sum(coalesce(oic.total_cost,0)) as oic_cost
  from public.order_item_cogs oic
  join sales_orders so on so.id = oic.order_id
  group by oic.item_id::text
),
mov as (
  select im.item_id::text as item_id, sum(coalesce(im.total_cost,0)) as sale_out_cost, sum(coalesce(im.quantity,0)) as sale_out_qty
  from public.inventory_movements im
  join sales_orders so on so.id::text = im.reference_id
  where im.reference_table='orders' and im.movement_type='sale_out'
  group by im.item_id::text
),
ret as (
  select im.item_id::text as item_id, sum(coalesce(im.total_cost,0)) as returns_cost, sum(coalesce(im.quantity,0)) as returns_qty
  from public.inventory_movements im
  join public.sales_returns sr on sr.id::text = im.reference_id and sr.status='completed'
  where im.reference_table='sales_returns' and im.movement_type='return_in'
    and im.occurred_at >= '${start}' and im.occurred_at <= '${end}'
  group by im.item_id::text
),
v10 as (
  select * from public.get_product_sales_report_v10('${start}'::timestamptz,'${end}'::timestamptz,null,false)
)
select json_build_object(
  'top_margin_outliers', (
    select coalesce(json_agg(x), '[]'::json)
    from (
      select
        v.item_id, v.item_name, v.quantity_sold, v.total_sales, v.total_cost, v.total_profit,
        coalesce(o.oic_cost,0) as oic_cost,
        coalesce(m.sale_out_cost,0) as movement_sale_out_cost,
        coalesce(r.returns_cost,0) as movement_returns_cost,
        coalesce(m.sale_out_cost,0)-coalesce(r.returns_cost,0) as movement_net_cost
      from v10 v
      left join oic o on o.item_id=v.item_id
      left join mov m on m.item_id=v.item_id
      left join ret r on r.item_id=v.item_id
      where v.total_sales > 0 and (v.total_profit / nullif(v.total_sales,0)) < -1
      order by v.total_profit asc
      limit 15
    ) x
  ),
  'zero_qty_nonzero_sales', (
    select count(*) from v10 v where v.quantity_sold = 0 and abs(v.total_sales) > 0.01
  )
) as payload
`;

const { data, error } = await supabase.rpc('exec_debug_sql', { q });
if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}
fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/product_cost_components_prod.json', JSON.stringify(data, null, 2), 'utf8');
console.log(JSON.stringify(data, null, 2));
