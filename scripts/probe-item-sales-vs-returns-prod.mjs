import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const itemId = process.argv[2];
if (!itemId) process.exit(1);

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
    coalesce(
      nullif(o.data->'invoiceSnapshot'->>'issuedAt', '')::timestamptz,
      nullif(o.data->>'paidAt', '')::timestamptz,
      nullif(o.data->>'deliveredAt', '')::timestamptz,
      o.created_at
    ) as date_by
  from public.orders o
  where nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
),
eo_filtered as (
  select * from eo
  where status <> 'cancelled'
    and (status='delivered' or nullif((select o2.data->>'paidAt' from public.orders o2 where o2.id=eo.id),'') is not null)
    and date_by >= '${start}'::timestamptz
    and date_by <= '${end}'::timestamptz
),
sales as (
  select
    sum(coalesce((it->>'quantity')::numeric,0)) as sold_qty,
    sum(
      greatest(
        coalesce((it->>'lineSubtotal')::numeric, coalesce((it->>'price')::numeric,0)*coalesce((it->>'quantity')::numeric,0))
        - coalesce((it->>'lineDiscount')::numeric,0),
        0
      )
    ) as sold_sales
  from eo_filtered eo
  join public.orders o on o.id = eo.id
  cross join lateral jsonb_array_elements(case when jsonb_typeof(o.data->'items')='array' then o.data->'items' else '[]'::jsonb end) it
  where coalesce(it->>'itemId', it->>'id') = '${itemId}'
),
ret as (
  select
    sum(coalesce((ri->>'quantity')::numeric,0)) as return_qty,
    sum(
      greatest(
        coalesce((ri->>'lineSubtotal')::numeric, coalesce((ri->>'price')::numeric,0)*coalesce((ri->>'quantity')::numeric,0))
        - coalesce((ri->>'lineDiscount')::numeric,0),
        0
      )
    ) as return_sales
  from public.sales_returns sr
  join public.orders o on o.id = sr.order_id
  cross join lateral jsonb_array_elements(case when jsonb_typeof(sr.items)='array' then sr.items else '[]'::jsonb end) ri
  where sr.status='completed'
    and sr.return_date >= '${start}'::timestamptz
    and sr.return_date <= '${end}'::timestamptz
    and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
    and coalesce(ri->>'itemId', ri->>'id') = '${itemId}'
)
select json_build_object(
  'sold_qty', coalesce((select sold_qty from sales),0),
  'sold_sales', coalesce((select sold_sales from sales),0),
  'return_qty', coalesce((select return_qty from ret),0),
  'return_sales', coalesce((select return_sales from ret),0),
  'net_qty', coalesce((select sold_qty from sales),0) - coalesce((select return_qty from ret),0),
  'net_sales', coalesce((select sold_sales from sales),0) - coalesce((select return_sales from ret),0)
) as payload
`;

const { data, error } = await supabase.rpc('exec_debug_sql', { q });
if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
