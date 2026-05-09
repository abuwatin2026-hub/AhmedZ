import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const { Client } = pg

if (!process.env.DBPW) {
  console.error('DBPW is required')
  process.exit(1)
}

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.pmhivhtaoydfolseelyc',
  password: process.env.DBPW,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
})

const lookbackHours = Math.max(1, Number(process.env.ORDERS_INTEGRITY_LOOKBACK_HOURS || 168))

const sql = `
with delivered_credit as (
  select o.id, o.party_id
  from public.orders o
  where o.status = 'delivered'
    and (
      o.payment_method = 'ar'
      or lower(coalesce(o.data->>'isCreditSale','false')) in ('true','1','yes')
      or lower(coalesce(o.invoice_terms,'')) = 'credit'
      or lower(coalesce(o.data->>'invoiceTerms','')) = 'credit'
    )
    and o.updated_at >= now() - ($1::text || ' hours')::interval
),
credit_missing_ar as (
  select count(*)::int as c
  from delivered_credit dc
  where not exists (
    select 1
    from public.ar_open_items a
    where a.order_id = dc.id
  )
),
credit_missing_party_ledger as (
  select count(*)::int as c
  from delivered_credit dc
  where dc.party_id is not null
    and exists (
      select 1
      from public.journal_entries je
      where je.source_table='orders'
        and je.source_id=dc.id::text
        and je.source_event in ('invoiced','delivered')
    )
    and not exists (
      select 1
      from public.party_ledger_entries ple
      where ple.journal_entry_id in (
        select je.id
        from public.journal_entries je
        where je.source_table='orders'
          and je.source_id=dc.id::text
          and je.source_event in ('invoiced','delivered')
      )
    )
),
orphan_order_payments as (
  select count(*)::int as c
  from public.payments p
  where p.reference_table='orders'
    and p.direction='in'
    and p.created_at >= now() - ($1::text || ' hours')::interval
    and not exists (
      select 1 from public.orders o where o.id::text = p.reference_id
    )
),
sale_out_uom_violations as (
  select count(*)::int as c
  from public.inventory_movements im
  where im.movement_type='sale_out'
    and im.created_at >= now() - ($1::text || ' hours')::interval
    and (im.uom_id is null or coalesce(im.qty_base,0) <= 0)
),
returns_missing_return_in as (
  select count(*)::int as c
  from public.orders o
  where o.updated_at >= now() - ($1::text || ' hours')::interval
    and (
      lower(coalesce(o.data->>'returnStatus','')) in ('partial','full')
      or o.data ? 'returnedAt'
    )
    and not exists (
      select 1
      from public.inventory_movements im
      where im.reference_table='orders'
        and im.reference_id=o.id::text
        and im.movement_type='return_in'
    )
)
select jsonb_build_object(
  'lookback_hours', $1::int,
  'missing_credit_ar_open_items', (select c from credit_missing_ar),
  'credit_missing_party_ledger_entries', (select c from credit_missing_party_ledger),
  'orphan_order_payments', (select c from orphan_order_payments),
  'sale_out_uom_violations', (select c from sale_out_uom_violations),
  'returns_missing_return_in', (select c from returns_missing_return_in)
) as metrics
`

async function main() {
  await client.connect()
  const q = await client.query(sql, [lookbackHours])
  const metrics = q.rows?.[0]?.metrics || {}
  const summary = {
    generatedAt: new Date().toISOString(),
    metrics,
    ok:
      Number(metrics.missing_credit_ar_open_items || 0) === 0 &&
      Number(metrics.credit_missing_party_ledger_entries || 0) === 0 &&
      Number(metrics.orphan_order_payments || 0) === 0 &&
      Number(metrics.sale_out_uom_violations || 0) === 0 &&
      Number(metrics.returns_missing_return_in || 0) === 0,
  }
  summary.severity = summary.ok ? 'ok' : (Number(metrics.orphan_order_payments || 0) > 0 ? 'critical' : 'warning')

  const outDir = path.join(process.cwd(), 'backups')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = path.join(outDir, `orders_integrity_probe_${ts}.json`)
  const latestPath = path.join(outDir, 'orders_integrity_latest.json')
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, severity: summary.severity, outPath, latestPath, metrics }, null, 2))
  process.exit(summary.ok ? 0 : (summary.severity === 'critical' ? 3 : 2))
}

main()
  .catch((e) => {
    console.error(String(e?.message || e))
    process.exit(1)
  })
  .finally(async () => {
    try {
      await client.end()
    } catch {}
  })
