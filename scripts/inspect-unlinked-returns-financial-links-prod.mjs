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

const q = `
with missing as (
  select distinct im.reference_id, im.data->>'orderId' as order_id, min(im.occurred_at) as first_at
  from public.inventory_movements im
  left join public.sales_returns sr on sr.id::text = im.reference_id
  where im.reference_table='sales_returns'
    and im.movement_type='return_in'
    and sr.id is null
  group by im.reference_id, im.data->>'orderId'
),
p as (
  select reference_id, sum(coalesce(amount,0)) as payment_sum
  from public.payments
  where reference_table='sales_returns'
  group by reference_id
),
j as (
  select je.source_id, sum(coalesce(jl.credit,0)-coalesce(jl.debit,0)) as net_credit_minus_debit
  from public.journal_entries je
  join public.journal_lines jl on jl.journal_entry_id = je.id
  where je.source_table='sales_returns'
  group by je.source_id
)
select json_build_object(
  'missing_count', (select count(*) from missing),
  'with_payment', (select count(*) from missing m join p on p.reference_id = m.reference_id),
  'with_journal', (select count(*) from missing m join j on j.source_id = m.reference_id),
  'sample', (
    select coalesce(json_agg(x), '[]'::json)
    from (
      select m.reference_id, m.order_id, m.first_at, coalesce(p.payment_sum,0) as payment_sum, coalesce(j.net_credit_minus_debit,0) as journal_net
      from missing m
      left join p on p.reference_id = m.reference_id
      left join j on j.source_id = m.reference_id
      order by m.first_at desc
      limit 20
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
