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

const adminEmail = process.env.ADMIN_EMAIL || env.ADMIN_EMAIL || 'owner@azta.com';
const adminPassword = process.env.ADMIN_PASSWORD || env.ADMIN_PASSWORD || 'AhmedZ#123456';
await supabase.auth.signInWithPassword({ email: adminEmail, password: adminPassword });

const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
const end = new Date().toISOString();

const q = `
with orders_window as (
  select
    o.id,
    o.status,
    o.created_at,
    nullif(trim(coalesce(o.data->>'voidedAt','')), '')::timestamptz as voided_at
  from public.orders o
  where o.created_at >= '${start}' and o.created_at <= '${end}'
),
cancelled_before as (
  select ow.id
  from orders_window ow
  where ow.status = 'cancelled' and ow.voided_at is null
),
voided_after as (
  select ow.id
  from orders_window ow
  where ow.status = 'delivered' and ow.voided_at is not null
),
returns_completed as (
  select sr.id, sr.order_id
  from public.sales_returns sr
  where sr.status='completed'
    and sr.return_date >= '${start}' and sr.return_date <= '${end}'
),
cb_metrics as (
  select
    count(*)::int as total_cancelled_before,
    (
      select count(*)::int
      from public.inventory_movements im
      join cancelled_before cb on cb.id::text = im.reference_id
      where im.reference_table='orders' and im.movement_type='sale_out'
    ) as sale_out_rows,
    (
      select count(distinct je.source_id)::int
      from public.journal_entries je
      join cancelled_before cb on cb.id::text = je.source_id
      where je.source_table='orders'
    ) as with_order_journal_rows,
    (
      select count(*)::int
      from public.payments p
      join cancelled_before cb on cb.id::text = p.reference_id
      where p.reference_table='orders'
    ) as payments_rows
  from cancelled_before
),
va_metrics as (
  select
    count(*)::int as total_voided_after,
    (
      select count(*)::int
      from public.inventory_movements im
      join voided_after va on va.id::text = im.reference_id
      where im.reference_table='order_voids' and im.movement_type='return_in'
    ) as return_in_rows,
    (
      select count(distinct je.source_id)::int
      from public.journal_entries je
      join voided_after va on va.id::text = je.source_id
      where je.source_table='order_voids'
    ) as with_void_journal_rows,
    (
      select count(*)::int
      from public.payments p
      join voided_after va on va.id::text = p.reference_id
      where p.reference_table='order_voids'
    ) as void_payment_rows
  from voided_after
),
sr_metrics as (
  select
    count(*)::int as total_returns_completed,
    (
      select count(*)::int
      from public.inventory_movements im
      join returns_completed rc on rc.id::text = im.reference_id
      where im.reference_table='sales_returns' and im.movement_type='return_in'
    ) as return_in_rows,
    (
      select count(distinct je.source_id)::int
      from public.journal_entries je
      join returns_completed rc on rc.id::text = je.source_id
      where je.source_table='sales_returns'
    ) as with_returns_journal_rows,
    (
      select count(*)::int
      from public.payments p
      join returns_completed rc on rc.id::text = p.reference_id
      where p.reference_table='sales_returns'
    ) as refund_payment_rows,
    (
      select coalesce(sum(sr.total_refund_amount),0)
      from public.sales_returns sr
      where sr.status='completed'
        and sr.return_date >= '${start}' and sr.return_date <= '${end}'
    ) as refunds_total
  from returns_completed
),
summary_vals as (
  select
    (x->>'total_sales_accrual')::numeric as total_sales_accrual,
    (x->>'returns_total')::numeric as returns_total,
    (x->>'cogs')::numeric as cogs
  from (
    select public.get_sales_report_summary('${start}'::timestamptz, '${end}'::timestamptz, null, false)::jsonb as x
  ) q
)
select json_build_object(
  'window', json_build_object('start','${start}','end','${end}'),
  'cancelled_before_delivery', (select row_to_json(cbm) from cb_metrics cbm),
  'voided_after_delivery', (select row_to_json(vam) from va_metrics vam),
  'sales_returns', (select row_to_json(srm) from sr_metrics srm),
  'sales_summary', (select row_to_json(sv) from summary_vals sv)
) as payload
`;

const { data, error } = await supabase.rpc('exec_debug_sql', { q });
if (error) {
  console.error(JSON.stringify(error, null, 2));
  process.exit(1);
}

fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync('backups/order_operations_three_audit_prod.json', JSON.stringify(data, null, 2), 'utf8');
console.log(JSON.stringify(data, null, 2));
