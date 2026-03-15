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
const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const end = new Date().toISOString();

const q = `
with eo as (
  select
    o.id,
    o.status,
    nullif(o.data->>'paidAt','')::timestamptz as paid_at,
    coalesce(
      nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
      nullif(o.data->>'paidAt', '')::timestamptz,
      nullif(o.data->>'deliveredAt', '')::timestamptz,
      o.created_at
    ) as date_by,
    coalesce(nullif(o.data->>'subtotal','')::numeric,0) as subtotal,
    coalesce(nullif(o.data->>'discountAmount','')::numeric, nullif(o.data->>'discountTotal','')::numeric, nullif(o.data->>'discount','')::numeric,0) as discount,
    coalesce(nullif(o.data->>'taxAmount','')::numeric,0) as tax,
    coalesce(nullif(o.data->>'total','')::numeric,0) as total,
    jsonb_array_length(case when jsonb_typeof(o.data->'items')='array' then o.data->'items' else '[]'::jsonb end) as items_count
  from public.orders o
  where nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
),
f as (
  select * from eo
  where (status='delivered' or paid_at is not null)
    and date_by >= '${start}' and date_by <= '${end}'
)
select json_build_object(
  'orders', count(*),
  'subtotal_zero_orders', count(*) filter (where subtotal = 0),
  'subtotal_positive_orders', count(*) filter (where subtotal > 0),
  'items_zero_orders', count(*) filter (where items_count = 0),
  'sum_subtotal', sum(subtotal),
  'sum_total', sum(total),
  'sum_tax', sum(tax),
  'sum_discount', sum(discount),
  'sample_subtotal_zero', (
    select coalesce(json_agg(x), '[]'::json)
    from (
      select id, subtotal, total, tax, discount, items_count
      from f
      where subtotal = 0
      order by total desc
      limit 10
    ) x
  )
) as payload
from f
`;

const { data, error } = await supabase.rpc('exec_debug_sql', { q });
if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
