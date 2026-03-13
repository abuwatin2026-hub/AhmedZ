import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import pg from 'pg'

const { Client } = pg

const backupPath = process.argv[2]
if (!backupPath) {
  console.error('Usage: node scripts/restore_abdz_via_pg.mjs <path-to-abdz>')
  process.exit(1)
}
if (!process.env.DBPW) {
  console.error('DBPW env var is required')
  process.exit(1)
}

const priorityOrder = [
  'app_settings',
  'organization_settings',
  'currencies',
  'fx_rates',
  'roles',
  'branches',
  'companies',
  'cost_centers',
  'warehouses',
  'chart_of_accounts',
  'admin_users',
  'employees',
  'financial_parties',
  'suppliers',
  'customers',
  'categories',
  'menu_items',
  'items',
  'uom',
  'item_uom',
  'item_warehouses',
  'product_prices_multi_currency',
  'pricing_tiers',
  'customer_pricing',
  'purchase_orders',
  'purchase_items',
  'purchase_receipts',
  'purchase_receipt_items',
  'stock_management',
  'batches',
  'inventory_movements',
  'order_item_reservations',
  'import_shipments',
  'import_shipments_items',
  'import_expenses',
  'cash_shifts',
  'orders',
  'order_items',
  'order_item_cogs',
  'sales_returns',
  'warehouse_transfers',
  'warehouse_transfer_items',
  'journal_entries',
  'journal_lines',
  'vouchers',
  'payments',
  'supplier_credit_notes',
  'payroll_runs',
  'payroll_lines',
  'allowance_types',
  'deduction_types',
  'employee_allowances',
  'employee_deductions',
  'attendance_records',
  'employee_contracts',
  'employee_guarantees',
  'supplier_contracts',
  'supplier_evaluations',
  'notifications',
  'reviews',
  'system_audit_logs',
  'pos_sessions',
  'pos_terminals',
  'stocktaking_sessions',
  'stocktaking_items',
]

function qid(v) {
  return `"${String(v).replace(/"/g, '""')}"`
}

function saveStatus(payload) {
  const p = path.join(process.cwd(), 'backups', 'restore_abdz_via_pg_status.json')
  fs.writeFileSync(p, JSON.stringify({ at: new Date().toISOString(), ...payload }, null, 2), 'utf8')
}

async function getClient() {
  const c = new Client({
    host: 'aws-1-ap-south-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.pmhivhtaoydfolseelyc',
    password: process.env.DBPW,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  return c
}

async function exportSafetySnapshot(client) {
  const outPath = path.join(process.cwd(), 'backups', `pre_restore_pg_snapshot_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  const tables = (
    await client.query(`
      select table_name
      from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE'
      order by table_name
    `)
  ).rows.map((r) => r.table_name)

  const data = {}
  for (const t of tables) {
    data[t] = (await client.query(`select * from public.${qid(t)}`)).rows
  }
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), data }, null, 2), 'utf8')
  return outPath
}

async function truncateAll(client) {
  const tables = (
    await client.query(`
      select table_name
      from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE'
        and table_name not in ('schema_migrations')
      order by table_name
    `)
  ).rows.map((r) => `public.${qid(r.table_name)}`)
  if (!tables.length) return
  await client.query(`truncate table ${tables.join(', ')} restart identity cascade`)
}

async function insertRows(client, table, rows) {
  if (!rows.length) return 0
  const cols = Object.keys(rows[0])
  if (!cols.length) return 0
  const chunkSize = 300
  let inserted = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const params = []
    const valuesSql = chunk
      .map((row, idx) => {
        const base = idx * cols.length
        cols.forEach((c) => params.push(row[c]))
        return `(${cols.map((_, j) => `$${base + j + 1}`).join(',')})`
      })
      .join(',')
    const sql = `insert into public.${qid(table)} (${cols.map(qid).join(',')}) values ${valuesSql}`
    await client.query(sql, params)
    inserted += chunk.length
  }
  return inserted
}

async function main() {
  saveStatus({ stage: 'start', backupPath })
  const zip = await JSZip.loadAsync(fs.readFileSync(backupPath))
  const dbFile = zip.file('database.json')
  if (!dbFile) throw new Error('database.json not found inside abdz')
  const parsed = JSON.parse(await dbFile.async('string'))
  const tablesData = parsed?.data
  if (!tablesData || typeof tablesData !== 'object') throw new Error('invalid backup data')

  const client = await getClient()
  try {
    saveStatus({ stage: 'connected' })
    const snapshotPath = await exportSafetySnapshot(client)
    saveStatus({ stage: 'snapshot_done', snapshotPath })

    const allTables = Object.keys(tablesData)
    const sortedTables = allTables.sort((a, b) => {
      const ia = priorityOrder.indexOf(a)
      const ib = priorityOrder.indexOf(b)
      if (ia === -1 && ib === -1) return 0
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })

    await client.query('begin')
    await client.query('set local session_replication_role = replica')
    await truncateAll(client)
    const stats = {}
    for (const t of sortedTables) {
      const rows = Array.isArray(tablesData[t]) ? tablesData[t] : []
      const n = await insertRows(client, t, rows)
      stats[t] = n
    }
    await client.query('commit')
    saveStatus({ stage: 'db_restore_done' })

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

    const out = {
      ok: true,
      backupPath,
      backupTimestamp: parsed.timestamp || null,
      source: parsed.source || null,
      restoredTables: sortedTables.length,
      stats,
      counts,
      snapshotPath,
    }
    const reportPath = path.join(process.cwd(), 'backups', `restore_abdz_via_pg_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.writeFileSync(reportPath, JSON.stringify(out, null, 2), 'utf8')
    saveStatus({ stage: 'completed', reportPath, counts })
    console.log(JSON.stringify({ ok: true, reportPath, counts }, null, 2))
  } catch (e) {
    try {
      await client.query('rollback')
    } catch {}
    saveStatus({ stage: 'failed', error: String(e?.message || e) })
    console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2))
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  saveStatus({ stage: 'failed_outer', error: String(e?.message || e) })
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2))
  process.exit(1)
})
