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

const q = `
with cad as (
  select o.id
  from public.orders o
  where o.status='cancelled'
    and nullif(trim(coalesce(o.data->>'deliveredAt','')), '') is not null
    and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
),
sale_out as (
  select im.reference_id, sum(coalesce(im.total_cost,0)) as cost
  from public.inventory_movements im
  where im.reference_table='orders' and im.movement_type='sale_out'
  group by im.reference_id
),
return_in as (
  select im.reference_id, sum(coalesce(im.total_cost,0)) as cost
  from public.inventory_movements im
  where im.reference_table='orders' and im.movement_type='return_in'
  group by im.reference_id
)
select json_build_object(
  'cancelled_after_delivery_total', (select count(*) from cad),
  'with_sale_out_orders', (select count(*) from cad c join sale_out s on s.reference_id = c.id::text),
  'with_return_in_orders', (select count(*) from cad c join return_in r on r.reference_id = c.id::text),
  'sale_out_cost_total', (select coalesce(sum(s.cost),0) from cad c join sale_out s on s.reference_id = c.id::text),
  'return_in_cost_total', (select coalesce(sum(r.cost),0) from cad c join return_in r on r.reference_id = c.id::text),
  'with_void_journal', (
    select count(distinct c.id)
    from cad c join public.journal_entries je
      on je.source_table='order_voids' and je.source_id=c.id::text
  ),
  'sample_unreversed', (
    select coalesce(json_agg(x), '[]'::json)
    from (
      select c.id, coalesce(s.cost,0) as sale_out_cost, coalesce(r.cost,0) as return_in_cost
      from cad c
      left join sale_out s on s.reference_id = c.id::text
      left join return_in r on r.reference_id = c.id::text
      where coalesce(s.cost,0) > coalesce(r.cost,0) + 0.01
      limit 10
    ) x
  )
) as payload
`;

const { data, error } = await supabase.rpc('exec_debug_sql', { q });
if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}
fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/cancelled_after_delivery_impact_prod.json', JSON.stringify(data, null, 2), 'utf8');
console.log(JSON.stringify(data, null, 2));
