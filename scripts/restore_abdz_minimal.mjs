import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import pg from 'pg'

const { Client } = pg

const backupPath = process.argv[2]
if (!backupPath) {
  console.error('Usage: node scripts/restore_abdz_minimal.mjs <path-to-abdz>')
  process.exit(1)
}
if (!process.env.DBPW) {
  console.error('DBPW env var is required')
  process.exit(1)
}

const statusPath = path.join(process.cwd(), 'backups', 'restore_abdz_minimal_status.json')
const reportPath = path.join(process.cwd(), 'backups', `restore_abdz_minimal_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)

const priorityOrder = [
  'app_settings','organization_settings','currencies','fx_rates','roles','branches','companies','cost_centers',
  'warehouses','chart_of_accounts','admin_users','employees','financial_parties','suppliers','customers',
  'categories','menu_items','items','uom','item_uom','item_warehouses','product_prices_multi_currency',
  'pricing_tiers','customer_pricing','purchase_orders','purchase_items','purchase_receipts','purchase_receipt_items',
  'stock_management','batches','inventory_movements','order_item_reservations','import_shipments',
  'import_shipments_items','import_expenses','cash_shifts','orders','order_items','order_item_cogs',
  'sales_returns','warehouse_transfers','warehouse_transfer_items','journal_entries','journal_lines','vouchers',
  'payments','supplier_credit_notes','payroll_runs','payroll_lines','allowance_types','deduction_types',
  'employee_allowances','employee_deductions','attendance_records','employee_contracts','employee_guarantees',
  'supplier_contracts','supplier_evaluations','notifications','reviews','system_audit_logs','pos_sessions',
  'pos_terminals','stocktaking_sessions','stocktaking_items',
]

const qid = (v) => `"${String(v).replace(/"/g, '""')}"`
const saveStatus = (payload) => fs.writeFileSync(statusPath, JSON.stringify({ at: new Date().toISOString(), ...payload }, null, 2), 'utf8')

async function main() {
  saveStatus({ stage: 'start', backupPath })
  const zip = await JSZip.loadAsync(fs.readFileSync(backupPath))
  const dbFile = zip.file('database.json')
  if (!dbFile) throw new Error('database.json not found inside abdz')
  const parsed = JSON.parse(await dbFile.async('string'))
  const data = parsed?.data
  if (!data || typeof data !== 'object') throw new Error('invalid backup data')

  const client = new Client({
    host: 'aws-1-ap-south-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.pmhivhtaoydfolseelyc',
    password: process.env.DBPW,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  saveStatus({ stage: 'connected' })

  const existingTables = (
    await client.query(`
      select table_name
      from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE'
    `)
  ).rows.map((r) => r.table_name)
  const existingSet = new Set(existingTables)
  const backupTables = Object.keys(data).filter((t) => existingSet.has(t))
  const sortedTables = backupTables.sort((a, b) => {
    const ia = priorityOrder.indexOf(a)
    const ib = priorityOrder.indexOf(b)
    if (ia === -1 && ib === -1) return 0
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })

  const truncateTargets = existingTables
    .filter((t) => t !== 'schema_migrations')
    .map((t) => `public.${qid(t)}`)
  saveStatus({ stage: 'truncate', tables: truncateTargets.length })
  await client.query(`truncate table ${truncateTargets.join(', ')} restart identity cascade`)

  await client.query(`set session_replication_role = replica`)
  const stats = {}
  const failed = {}
  const chunkSize = 250
  let done = 0
  for (const t of sortedTables) {
    const rows = Array.isArray(data[t]) ? data[t] : []
    stats[t] = 0
    if (!rows.length) {
      done += 1
      saveStatus({ stage: 'importing', done, total: sortedTables.length, table: t, inserted: 0 })
      continue
    }
    try {
      const cols = Object.keys(rows[0] || {})
      if (!cols.length) {
        done += 1
        saveStatus({ stage: 'importing', done, total: sortedTables.length, table: t, inserted: 0 })
        continue
      }
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize)
        const params = []
        const valuesSql = chunk.map((row, idx) => {
          const base = idx * cols.length
          cols.forEach((c) => params.push(row[c]))
          return `(${cols.map((_, j) => `$${base + j + 1}`).join(',')})`
        }).join(',')
        const sql = `insert into public.${qid(t)} (${cols.map(qid).join(',')}) values ${valuesSql}`
        await client.query(sql, params)
        stats[t] += chunk.length
      }
    } catch (e) {
      failed[t] = String(e?.message || e)
    }
    done += 1
    saveStatus({ stage: 'importing', done, total: sortedTables.length, table: t, inserted: stats[t] })
  }
  await client.query(`set session_replication_role = origin`)

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

  const report = {
    ok: Object.keys(failed).length === 0,
    backupPath,
    backupTimestamp: parsed.timestamp || null,
    source: parsed.source || null,
    restoredTables: sortedTables.length,
    failedTables: Object.keys(failed).length,
    failed,
    stats,
    counts,
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
  saveStatus({ stage: 'completed', reportPath, counts, failedTables: report.failedTables })
  console.log(JSON.stringify({ ok: report.ok, reportPath, counts, failedTables: report.failedTables }, null, 2))
  await client.end()
}

main().catch((e) => {
  saveStatus({ stage: 'failed', error: String(e?.message || e) })
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2))
  process.exit(1)
})
