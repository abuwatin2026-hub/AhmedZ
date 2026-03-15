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

const adminEmail = process.env.ADMIN_EMAIL || env.ADMIN_EMAIL || '';
const adminPassword = process.env.ADMIN_PASSWORD || env.ADMIN_PASSWORD || '';
if (adminEmail && adminPassword) {
  await supabase.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
}

const end = new Date();
const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

const sql = `
with rc as (
  select
    sr.id,
    coalesce(sr.total_refund_amount, 0) as return_subtotal,
    public.order_fx_rate(
      coalesce(nullif(btrim(coalesce(o.currency,'')),''), nullif(btrim(coalesce(o.data->>'currency','')),''), public.get_base_currency()),
      sr.return_date,
      o.fx_rate
    ) as fx_rate,
    greatest(
      coalesce(nullif((o.data->>'subtotal')::numeric, null), 0)
      - coalesce(nullif((o.data->>'discountAmount')::numeric, null), 0),
      0
    ) as order_net_subtotal,
    coalesce(nullif((o.data->>'taxAmount')::numeric, null), coalesce(o.tax_amount, 0), 0) as order_tax
  from public.sales_returns sr
  join public.orders o on o.id::text = sr.order_id::text
  where sr.status='completed'
    and sr.return_date >= '${start.toISOString()}'
    and sr.return_date <= '${end.toISOString()}'
    and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
),
rb as (
  select
    id,
    sum(return_subtotal) as return_subtotal,
    sum(
      case
        when order_net_subtotal > 0 and order_tax > 0 and return_subtotal > 0
          then least(order_tax, (return_subtotal / order_net_subtotal) * order_tax)
        else 0
      end
    ) as tax_refund,
    max(fx_rate) as fx_rate
  from rc
  group by id
)
select json_build_object(
  'returns_base_calc', coalesce(sum(rb.return_subtotal * rb.fx_rate), 0),
  'tax_refunds_base_calc', coalesce(sum(rb.tax_refund * rb.fx_rate), 0),
  'returns_total_base_calc', coalesce(sum((rb.return_subtotal + rb.tax_refund) * rb.fx_rate), 0),
  'returns_rows', (
    select count(*)
    from public.sales_returns sr
    where sr.status='completed'
      and sr.return_date >= '${start.toISOString()}'
      and sr.return_date <= '${end.toISOString()}'
  ),
  'returns_cogs_calc', (
    select coalesce(sum(im.total_cost), 0)
    from public.inventory_movements im
    where im.reference_table='sales_returns'
      and im.movement_type='return_in'
      and im.occurred_at >= '${start.toISOString()}'
      and im.occurred_at <= '${end.toISOString()}'
  )
) as payload
from rb
`;

const summary = await supabase.rpc('get_sales_report_summary', {
  p_start_date: start.toISOString(),
  p_end_date: end.toISOString(),
  p_zone_id: null,
  p_invoice_only: false,
});

const diag = await supabase.rpc('exec_debug_sql', { q: sql });

const movementLinkSql = `
with m as (
  select im.id, im.reference_id, im.occurred_at, im.total_cost, im.data->>'orderId' as order_id
  from public.inventory_movements im
  where im.reference_table='sales_returns'
    and im.movement_type='return_in'
    and im.occurred_at >= '${start.toISOString()}'
    and im.occurred_at <= '${end.toISOString()}'
)
select json_build_object(
  'movement_rows', (select count(*) from m),
  'movement_cost', (select coalesce(sum(total_cost), 0) from m),
  'linked_returns_rows', (select count(*) from m join public.sales_returns sr on sr.id::text = m.reference_id),
  'linked_completed_rows', (select count(*) from m join public.sales_returns sr on sr.id::text = m.reference_id and sr.status='completed'),
  'unlinked_rows', (select count(*) from m left join public.sales_returns sr on sr.id::text = m.reference_id where sr.id is null),
  'sample_unlinked', (
    select coalesce(json_agg(x), '[]'::json)
    from (
      select m.reference_id, m.order_id, m.occurred_at, m.total_cost
      from m
      left join public.sales_returns sr on sr.id::text = m.reference_id
      where sr.id is null
      order by m.occurred_at desc
      limit 5
    ) x
  )
) as payload
`;
const movementLink = await supabase.rpc('exec_debug_sql', { q: movementLinkSql });

const rootCauseSql = `
with m as (
  select im.id, im.reference_id, im.occurred_at, im.total_cost, im.data->>'orderId' as order_id
  from public.inventory_movements im
  where im.reference_table='sales_returns'
    and im.movement_type='return_in'
    and im.occurred_at >= '${start.toISOString()}'
    and im.occurred_at <= '${end.toISOString()}'
),
u as (
  select m.*
  from m
  left join public.sales_returns sr on sr.id::text = m.reference_id
  where sr.id is null
),
sr_by_order as (
  select
    sr.order_id::text as order_id,
    count(*) as sr_count,
    count(*) filter (where sr.status='completed') as sr_completed_count
  from public.sales_returns sr
  group by sr.order_id::text
)
select json_build_object(
  'sales_returns_total', (select count(*) from public.sales_returns),
  'sales_returns_completed_total', (select count(*) from public.sales_returns where status='completed'),
  'unlinked_distinct_orders', (select count(distinct order_id) from u where nullif(order_id,'') is not null),
  'unlinked_with_any_sales_return_same_order', (
    select count(*)
    from (
      select distinct u.order_id
      from u
      join sr_by_order sbo on sbo.order_id = u.order_id
      where nullif(u.order_id,'') is not null
    ) z
  ),
  'unlinked_with_completed_sales_return_same_order', (
    select count(*)
    from (
      select distinct u.order_id
      from u
      join sr_by_order sbo on sbo.order_id = u.order_id
      where nullif(u.order_id,'') is not null
        and sbo.sr_completed_count > 0
    ) z
  ),
  'sample_order_matches', (
    select coalesce(json_agg(x), '[]'::json)
    from (
      select
        u.order_id,
        count(*) as unlinked_rows,
        max(u.occurred_at) as last_movement_at,
        coalesce(sbo.sr_count,0) as sales_returns_count_for_order,
        coalesce(sbo.sr_completed_count,0) as completed_sales_returns_count_for_order
      from u
      left join sr_by_order sbo on sbo.order_id = u.order_id
      where nullif(u.order_id,'') is not null
      group by u.order_id, sbo.sr_count, sbo.sr_completed_count
      order by last_movement_at desc
      limit 10
    ) x
  )
) as payload
`;
const rootCause = await supabase.rpc('exec_debug_sql', { q: rootCauseSql });

const result = {
  period: { start: start.toISOString(), end: end.toISOString() },
  summary: summary.error
    ? { error: summary.error }
    : {
        returns: summary.data?.returns,
        returns_total: summary.data?.returns_total,
        tax_refunds: summary.data?.tax_refunds,
        cogs: summary.data?.cogs,
        returns_cogs: summary.data?.returns_cogs,
        total_sales_accrual: summary.data?.total_sales_accrual,
      },
  diag: diag.error ? { error: diag.error } : diag.data,
  movement_link: movementLink.error ? { error: movementLink.error } : movementLink.data,
  root_cause: rootCause.error ? { error: rootCause.error } : rootCause.data,
};

fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/sales_returns_audit_prod.json', JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result, null, 2));
