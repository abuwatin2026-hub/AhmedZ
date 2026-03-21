import { Client } from 'pg';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const val = (flag, fallback = '') => {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return typeof v === 'string' ? v : fallback;
};

const ownerEmail = String(val('--owner-email', 'owner@azta.com')).trim().toLowerCase();
const execute = has('--execute');
const reason = String(val('--reason', 'OWNER_EXPERIMENTAL_PURGE')).trim() || 'OWNER_EXPERIMENTAL_PURGE';
const password = String(process.env.DBPW || process.env.SUPABASE_DB_PASSWORD || '').trim();
if (!password) {
  throw new Error('Missing DBPW or SUPABASE_DB_PASSWORD');
}

const client = new Client({
  host: process.env.DB_HOST || 'aws-1-ap-south-1.pooler.supabase.com',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres.pmhivhtaoydfolseelyc',
  password,
  database: process.env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
});

const targetSql = `
with owner_user as (
  select auth_user_id
  from public.admin_users
  where lower(coalesce(email,'')) = $1
    and is_active = true
  order by case when role='owner' then 0 else 1 end, created_at asc
  limit 1
)
select distinct o.id
from public.orders o
cross join owner_user ou
where (
  exists (
    select 1
    from public.order_events oe
    where oe.order_id = o.id
      and oe.action = 'order.created'
      and oe.actor_id = ou.auth_user_id
  )
  or coalesce(
    nullif(o.data->>'createdByAdminId',''),
    nullif(o.data->>'createdBy',''),
    nullif(o.data->>'createdById',''),
    nullif(o.data->>'createdByUserId',''),
    nullif(o.data->>'cashierId',''),
    nullif(o.data->>'actorId','')
  ) = ou.auth_user_id::text
  or (
    o.customer_auth_user_id = ou.auth_user_id
    and coalesce(o.data->>'orderSource','') = 'in_store'
  )
)
`;

const auditSql = `
with owner_user as (
  select auth_user_id
  from public.admin_users
  where lower(coalesce(email,'')) = $1
    and is_active = true
  order by case when role='owner' then 0 else 1 end, created_at asc
  limit 1
),
target_orders as (
  select distinct o.id, o.status, o.created_at, o.invoice_number
  from public.orders o
  cross join owner_user ou
  where (
    exists (
      select 1
      from public.order_events oe
      where oe.order_id = o.id
        and oe.action = 'order.created'
        and oe.actor_id = ou.auth_user_id
    )
    or coalesce(
      nullif(o.data->>'createdByAdminId',''),
      nullif(o.data->>'createdBy',''),
      nullif(o.data->>'createdById',''),
      nullif(o.data->>'createdByUserId',''),
      nullif(o.data->>'cashierId',''),
      nullif(o.data->>'actorId','')
    ) = ou.auth_user_id::text
    or (
      o.customer_auth_user_id = ou.auth_user_id
      and coalesce(o.data->>'orderSource','') = 'in_store'
    )
  )
)
select jsonb_build_object(
  'ownerUserId', (select auth_user_id::text from owner_user),
  'ordersTotal', (select count(*) from target_orders),
  'statusBreakdown', (
    select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
    from (select status, count(*)::int cnt from target_orders group by status) s
  ),
  'links', jsonb_build_object(
    'orderEvents', (select count(*) from public.order_events e join target_orders t on t.id = e.order_id),
    'reservations', (select count(*) from public.order_item_reservations r join target_orders t on t.id = r.order_id),
    'inventoryMovements_orders', (select count(*) from public.inventory_movements im join target_orders t on im.reference_table='orders' and im.reference_id=t.id::text),
    'inventoryMovements_orderVoids', (select count(*) from public.inventory_movements im join target_orders t on im.reference_table='order_voids' and im.reference_id=t.id::text),
    'payments_orders', (select count(*) from public.payments p join target_orders t on p.reference_table='orders' and p.reference_id=t.id::text),
    'journalEntries_orders', (select count(*) from public.journal_entries je join target_orders t on je.source_table='orders' and je.source_id=t.id::text),
    'journalEntries_payments', (select count(*) from public.journal_entries je join public.payments p on je.source_table='payments' and je.source_id=p.id::text join target_orders t on p.reference_table='orders' and p.reference_id=t.id::text),
    'orderItemCogs', (select count(*) from public.order_item_cogs oc join target_orders t on t.id=oc.order_id),
    'arOpenItems', (select count(*) from public.ar_open_items ao join target_orders t on t.id=ao.order_id or t.id=ao.invoice_id)
  ),
  'sample', (
    select coalesce(jsonb_agg(x), '[]'::jsonb)
    from (
      select id::text, status, created_at, coalesce(invoice_number, right(id::text, 8)) as inv
      from target_orders
      order by created_at desc
      limit 10
    ) x
  )
) as payload
`;

await client.connect();
try {
  const pre = await client.query(auditSql, [ownerEmail]);
  const preAudit = pre.rows[0]?.payload ?? {};
  console.log(JSON.stringify({ phase: 'pre_audit', ownerEmail, ...preAudit }, null, 2));

  if (!execute) {
    console.log(JSON.stringify({ phase: 'dry_run_only', execute }, null, 2));
    process.exit(0);
  }

  await client.query('begin');
  await client.query('create temp table _target_orders(id uuid primary key) on commit drop');
  await client.query('insert into _target_orders(id) ' + targetSql, [ownerEmail]);

  const targetCountRes = await client.query('select count(*)::int as c from _target_orders');
  const targetCount = Number(targetCountRes.rows[0]?.c || 0);
  if (targetCount === 0) {
    await client.query('commit');
    console.log(JSON.stringify({ phase: 'execute_done', deletedOrders: 0 }, null, 2));
    process.exit(0);
  }

  await client.query(`
    do $$
    declare r record;
    begin
      for r in select id from _target_orders loop
        begin
          begin
            perform public.cancel_order(r.id, $q$${reason}$q$, now());
          exception when undefined_function then
            perform public.cancel_order(r.id, $q$${reason}$q$);
          end;
        exception when others then
          null;
        end;
        begin
          perform public.purge_order_payment(r.id, $q$${reason}$q$);
        exception when others then
          null;
        end;
      end loop;
    end
    $$;
  `);

  await client.query(`create temp table _target_payments(id uuid primary key) on commit drop as
    select p.id
    from public.payments p
    where (p.reference_table = 'orders' and p.reference_id in (select id::text from _target_orders))
       or (p.reference_table = 'order_voids' and p.reference_id in (select id::text from _target_orders))
       or (p.reference_table = 'sales_returns' and p.reference_id in (
            select sr.id::text from public.sales_returns sr where sr.order_id in (select id from _target_orders)
       ))`);

  await client.query(`create temp table _target_movements(id uuid primary key) on commit drop as
    select im.id
    from public.inventory_movements im
    where (im.reference_table = 'orders' and im.reference_id in (select id::text from _target_orders))
       or (im.reference_table = 'order_voids' and im.reference_id in (select id::text from _target_orders))
       or (im.reference_table = 'sales_returns' and im.reference_id in (
            select sr.id::text from public.sales_returns sr where sr.order_id in (select id from _target_orders)
       ))`);

  await client.query(`create temp table _target_journal_entries(id uuid primary key) on commit drop as
    select je.id
    from public.journal_entries je
    where (je.source_table = 'orders' and je.source_id in (select id::text from _target_orders))
       or (je.source_table = 'payments' and je.source_id in (select id::text from _target_payments))
       or (je.source_table = 'inventory_movements' and je.source_id in (select id::text from _target_movements))
       or (je.source_table = 'sales_returns' and je.source_id in (
            select sr.id::text from public.sales_returns sr where sr.order_id in (select id from _target_orders)
       ))`);

  await client.query(`create temp table _target_journal_lines(id uuid primary key) on commit drop as
    select jl.id from public.journal_lines jl where jl.journal_entry_id in (select id from _target_journal_entries)`);

  await client.query(`alter table public.journal_lines disable trigger user`);
  await client.query(`alter table public.journal_entries disable trigger user`);
  await client.query(`alter table public.payments disable trigger user`);
  await client.query(`alter table public.orders disable trigger user`);
  await client.query(`alter table public.party_ledger_entries disable trigger user`);
  await client.query(`alter table public.party_open_items disable trigger user`);

  const optionalDisables = [
    'public.ar_open_items',
    'public.ar_allocations',
    'public.ar_payment_status',
    'public.bank_reconciliation_matches',
    'public.accounting_documents',
    'public.settlement_lines',
    'public.settlement_headers',
  ];
  for (const tbl of optionalDisables) {
    try {
      await client.query(`alter table ${tbl} disable trigger user`);
    } catch {}
  }

  await client.query(`delete from public.ar_allocations where payment_id in (select id from _target_payments)`);
  await client.query(`delete from public.ar_payment_status where payment_id in (select id from _target_payments)`);
  await client.query(`delete from public.bank_reconciliation_matches where payment_id in (select id from _target_payments)`);

  await client.query(`
    delete from public.settlement_lines
    where from_open_item_id in (
      select poi.id from public.party_open_items poi where poi.journal_line_id in (select id from _target_journal_lines)
    )
    or to_open_item_id in (
      select poi.id from public.party_open_items poi where poi.journal_line_id in (select id from _target_journal_lines)
    )
  `);
  await client.query(`delete from public.settlement_headers sh where not exists (select 1 from public.settlement_lines sl where sl.settlement_id = sh.id)`);

  await client.query(`delete from public.party_open_items where journal_line_id in (select id from _target_journal_lines)`);
  await client.query(`delete from public.party_ledger_entries where journal_line_id in (select id from _target_journal_lines)`);
  await client.query(`delete from public.ar_open_items where journal_entry_id in (select id from _target_journal_entries)`);
  await client.query(`delete from public.journal_lines where id in (select id from _target_journal_lines)`);
  await client.query(`delete from public.journal_entries where id in (select id from _target_journal_entries)`);
  await client.query(`delete from public.payments where id in (select id from _target_payments)`);
  await client.query(`delete from public.inventory_movements where id in (select id from _target_movements)`);
  await client.query(`delete from public.order_item_cogs where order_id in (select id from _target_orders)`);
  await client.query(`delete from public.order_item_reservations where order_id in (select id from _target_orders)`);
  await client.query(`delete from public.sales_returns where order_id in (select id from _target_orders)`);

  const fkRefs = await client.query(`
    select
      quote_ident(ns.nspname) as schema_name,
      quote_ident(cls.relname) as table_name,
      quote_ident(att.attname) as column_name
    from pg_constraint c
    join pg_class cls on cls.oid = c.conrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    join unnest(c.conkey) with ordinality as ck(attnum, ord) on true
    join pg_attribute att on att.attrelid = c.conrelid and att.attnum = ck.attnum
    where c.contype = 'f'
      and c.confrelid = 'public.orders'::regclass
      and ns.nspname = 'public'
      and cls.relname <> 'orders'
  `);

  for (const row of fkRefs.rows) {
    const fullTable = `${row.schema_name}.${row.table_name}`;
    const column = row.column_name;
    try {
      await client.query(`delete from ${fullTable} where ${column} in (select id from _target_orders)`);
    } catch {}
  }

  const deletedOrdersRes = await client.query(`delete from public.orders where id in (select id from _target_orders) returning id`);
  const deletedOrders = deletedOrdersRes.rowCount || 0;

  await client.query(`alter table public.journal_lines enable trigger user`);
  await client.query(`alter table public.journal_entries enable trigger user`);
  await client.query(`alter table public.payments enable trigger user`);
  await client.query(`alter table public.orders enable trigger user`);
  await client.query(`alter table public.party_ledger_entries enable trigger user`);
  await client.query(`alter table public.party_open_items enable trigger user`);
  for (const tbl of optionalDisables) {
    try {
      await client.query(`alter table ${tbl} enable trigger user`);
    } catch {}
  }

  await client.query('commit');

  const post = await client.query(auditSql, [ownerEmail]);
  const postAudit = post.rows[0]?.payload ?? {};
  console.log(JSON.stringify({ phase: 'post_audit', ownerEmail, deletedOrders, ...postAudit }, null, 2));
} catch (e) {
  try {
    await client.query('rollback');
  } catch {}
  throw e;
} finally {
  await client.end();
}
