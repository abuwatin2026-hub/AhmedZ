import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import pg from 'pg'

const { Client } = pg

const backupPath = process.argv[2]
if (!backupPath) {
  console.error('Usage: node scripts/restore_abdz_fast.mjs <path-to-abdz>')
  process.exit(1)
}
if (!process.env.DBPW) {
  console.error('DBPW is required')
  process.exit(1)
}

const statusPath = path.join(process.cwd(), 'backups', 'restore_abdz_fast_status.json')
function saveStatus(payload) {
  fs.writeFileSync(statusPath, JSON.stringify({ at: new Date().toISOString(), ...payload }, null, 2), 'utf8')
}
function qid(v) {
  return `"${String(v).replace(/"/g, '""')}"`
}

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.pmhivhtaoydfolseelyc',
  password: process.env.DBPW,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
})

async function insertChunk(table, cols, rows) {
  if (!rows.length) return
  const params = []
  const valuesSql = rows
    .map((row, idx) => {
      const base = idx * cols.length
      cols.forEach((c) => params.push(row[c]))
      return `(${cols.map((_, j) => `$${base + j + 1}`).join(',')})`
    })
    .join(',')
  const sql = `insert into public.${qid(table)} (${cols.map(qid).join(',')}) values ${valuesSql}`
  await client.query(sql, params)
}

async function main() {
  saveStatus({ stage: 'start', backupPath })
  await client.connect()
  const zip = await JSZip.loadAsync(fs.readFileSync(backupPath))
  const dbFile = zip.file('database.json')
  if (!dbFile) throw new Error('database.json missing')
  const parsed = JSON.parse(await dbFile.async('string'))
  const data = parsed?.data || {}
  const backupTables = Object.keys(data)

  const existingTables = (
    await client.query(`
      select table_name
      from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE'
    `)
  ).rows.map((r) => r.table_name)
  const tableSet = new Set(existingTables)
  const tables = backupTables.filter((t) => tableSet.has(t))

  saveStatus({ stage: 'truncate', tables: tables.length })
  const truncateTargets = existingTables
    .filter((t) => t !== 'schema_migrations')
    .map((t) => `public.${qid(t)}`)
  await client.query(`truncate table ${truncateTargets.join(', ')} restart identity cascade`)

  const report = { ok: true, backupPath, backupTimestamp: parsed.timestamp || null, inserted: {}, failed: {} }
  let done = 0

  for (const table of tables) {
    const rows = Array.isArray(data[table]) ? data[table] : []
    if (!rows.length) {
      report.inserted[table] = 0
      done += 1
      saveStatus({ stage: 'importing', done, total: tables.length, table, rows: 0 })
      continue
    }

    const cols = Object.keys(rows[0])
    const chunkSize = 250
    let inserted = 0
    try {
      await client.query('begin')
      await client.query("set local session_replication_role = replica")
      for (let i = 0; i < rows.length; i += chunkSize) {
        await insertChunk(table, cols, rows.slice(i, i + chunkSize))
        inserted = Math.min(rows.length, i + chunkSize)
      }
      await client.query('commit')
      report.inserted[table] = inserted
    } catch (e) {
      try {
        await client.query('rollback')
      } catch {}
      report.failed[table] = String(e?.message || e)
    }
    done += 1
    saveStatus({ stage: 'importing', done, total: tables.length, table, inserted })
  }

  const counts = (
    await client.query(`
      select
        (select count(*)::int from public.warehouses) as warehouses,
        (select count(*)::int from public.admin_users) as admin_users,
        (select count(*)::int from public.menu_items) as menu_items,
        (select count(*)::int from public.stock_management) as stock_management,
        (select count(*)::int from public.batches) as batches,
        (select count(*)::int from public.inventory_movements) as inventory_movements,
        (select count(*)::int from public.orders) as orders,
        (select count(*)::int from public.purchase_orders) as purchase_orders,
        (select count(*)::int from public.payments) as payments
    `)
  ).rows[0]
  report.counts = counts

  const reportPath = path.join(process.cwd(), 'backups', `restore_abdz_fast_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
  saveStatus({ stage: 'completed', reportPath, counts, failedTables: Object.keys(report.failed).length })
  console.log(JSON.stringify({ ok: true, reportPath, counts, failedTables: Object.keys(report.failed).length }, null, 2))
}

main()
  .catch((e) => {
    saveStatus({ stage: 'failed', error: String(e?.message || e) })
    console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2))
    process.exit(1)
  })
  .finally(async () => {
    try {
      await client.end()
    } catch {}
  })
