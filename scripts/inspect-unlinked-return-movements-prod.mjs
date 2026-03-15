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

const q = `
with m as (
  select
    im.id, im.reference_id, im.item_id, im.quantity, im.total_cost, im.occurred_at, im.data,
    im.data->>'orderId' as order_id
  from public.inventory_movements im
  where im.reference_table = 'sales_returns'
    and im.movement_type = 'return_in'
),
u as (
  select m.*
  from m
  left join public.sales_returns sr on sr.id::text = m.reference_id
  where sr.id is null
)
select json_build_object(
  'count_unlinked', (select count(*) from u),
  'sample', (
    select coalesce(json_agg(x), '[]'::json)
    from (
      select id, reference_id, order_id, item_id, quantity, total_cost, occurred_at, data
      from u
      order by occurred_at desc
      limit 5
    ) x
  )
) as payload
`;

const { data, error } = await supabase.rpc('exec_debug_sql', { q });
if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
