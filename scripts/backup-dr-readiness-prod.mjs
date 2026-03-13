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

const requiredFunctions = [
  'admin_get_all_tables',
  'admin_export_table_data',
  'admin_import_table_data',
  'admin_wipe_all_tables_for_restore',
  'admin_post_restore_resync',
]

async function main() {
  await client.connect()
  const report = {
    generatedAt: new Date().toISOString(),
    checks: [],
  }

  const fnRows = (
    await client.query(`
      select proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public'
        and proname = any($1::text[])
    `, [requiredFunctions])
  ).rows.map(r => r.proname)

  for (const fn of requiredFunctions) {
    report.checks.push({
      key: `function:${fn}`,
      ok: fnRows.includes(fn),
      value: fnRows.includes(fn),
    })
  }

  const buckets = await client.query(`select id,name,public from storage.buckets`)
  const autoBucket = buckets.rows.find(b => b.id === 'automated_backups')
  report.checks.push({
    key: 'bucket:automated_backups_exists',
    ok: !!autoBucket,
    value: !!autoBucket,
  })

  if (autoBucket) {
    const latestObj = await client.query(`
      select name, created_at
      from storage.objects
      where bucket_id='automated_backups'
      order by created_at desc
      limit 1
    `)
    const latest = latestObj.rows[0] || null
    report.checks.push({
      key: 'bucket:automated_backups_has_object',
      ok: !!latest,
      value: latest ? latest.created_at : null,
    })
  }

  const coreCounts = (
    await client.query(`
      select
        (select count(*)::int from public.warehouses) as warehouses,
        (select count(*)::int from public.admin_users) as admin_users,
        (select count(*)::int from public.menu_items) as menu_items,
        (select count(*)::int from public.stock_management) as stock_management,
        (select count(*)::int from public.batches) as batches,
        (select count(*)::int from public.inventory_movements) as inventory_movements
    `)
  ).rows[0]
  report.coreCounts = coreCounts

  report.ok = report.checks.every(c => c.ok)

  const outPath = path.join(process.cwd(), 'backups', `backup_dr_readiness_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: report.ok, outPath }, null, 2))
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
