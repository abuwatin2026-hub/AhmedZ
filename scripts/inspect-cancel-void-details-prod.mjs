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
with c as (
  select
    o.id,
    o.status,
    nullif(trim(coalesce(o.data->>'deliveredAt','')), '')::timestamptz as delivered_at,
    nullif(trim(coalesce(o.data->>'voidedAt','')), '')::timestamptz as voided_at
  from public.orders o
  where o.status='cancelled'
),
v as (
  select o.id
  from public.orders o
  where o.status='delivered'
    and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is not null
)
select json_build_object(
  'cancelled', json_build_object(
    'total', (select count(*) from c),
    'with_delivered_at', (select count(*) from c where delivered_at is not null),
    'with_voided_at', (select count(*) from c where voided_at is not null),
    'sale_out_orders', (
      select count(distinct c.id)
      from c join public.inventory_movements im
        on im.reference_table='orders' and im.reference_id=c.id::text and im.movement_type='sale_out'
    ),
    'sample_sale_out_cancelled', (
      select coalesce(json_agg(x), '[]'::json)
      from (
        select c.id, c.delivered_at, c.voided_at
        from c join public.inventory_movements im
          on im.reference_table='orders' and im.reference_id=c.id::text and im.movement_type='sale_out'
        order by c.delivered_at desc nulls last
        limit 10
      ) x
    )
  ),
  'voided_after', json_build_object(
    'total', (select count(*) from v),
    'order_voids_return_in', (
      select count(*) from public.inventory_movements im
      join v on v.id::text=im.reference_id
      where im.reference_table='order_voids' and im.movement_type='return_in'
    ),
    'orders_return_in', (
      select count(*) from public.inventory_movements im
      join v on v.id::text=im.reference_id
      where im.reference_table='orders' and im.movement_type='return_in'
    ),
    'sample_voided', (
      select coalesce(json_agg(x), '[]'::json)
      from (
        select o.id, o.status, o.data->>'voidedAt' as voided_at, o.data->>'deliveredAt' as delivered_at
        from public.orders o
        where o.status='delivered' and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is not null
        order by o.updated_at desc nulls last
        limit 10
      ) x
    )
  )
) as payload
`;

const { data, error } = await supabase.rpc('exec_debug_sql', { q });
if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}
fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/cancel_void_details_prod.json', JSON.stringify(data, null, 2), 'utf8');
console.log(JSON.stringify(data, null, 2));
