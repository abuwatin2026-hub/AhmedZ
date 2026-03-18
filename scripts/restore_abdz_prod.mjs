import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { createClient } from '@supabase/supabase-js'

const backupPath = process.argv[2]
if (!backupPath) {
  console.error('Usage: node scripts/restore_abdz_prod.mjs <path-to-abdz>')
  process.exit(1)
}

const loadEnv = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#') || !t.includes('=')) continue
      const i = t.indexOf('=')
      const k = t.slice(0, i).trim()
      let v = t.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!process.env[k]) process.env[k] = v
    }
  } catch {}
}

loadEnv(path.join(process.cwd(), '.env.production'))
loadEnv(path.join(process.cwd(), '.env.local'))

const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').trim()
const supabaseAnon = String(process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const ownerEmail = String(process.env.OWNER_EMAIL || process.env.BACKUP_OWNER_EMAIL || '').trim()
const ownerPassword = String(process.env.OWNER_PASSWORD || process.env.BACKUP_OWNER_PASSWORD || '').trim()

if (!supabaseUrl || !supabaseAnon) {
  console.error('Missing supabase URL/anon key in .env.production')
  process.exit(1)
}
if (!ownerEmail || !ownerPassword) {
  console.error('Missing OWNER_EMAIL/OWNER_PASSWORD or BACKUP_OWNER_EMAIL/BACKUP_OWNER_PASSWORD')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnon)
const statusPath = path.join(process.cwd(), 'backups', 'restore_abdz_status.json')
function saveStatus(payload) {
  fs.writeFileSync(statusPath, JSON.stringify({ at: new Date().toISOString(), ...payload }, null, 2), 'utf8')
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

async function login() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: ownerEmail,
    password: ownerPassword,
  })
  if (error) throw error
  return data.user
}

async function exportEmergencySnapshot() {
  const outPath = path.join(
    process.cwd(),
    'backups',
    `pre_restore_snapshot_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  )
  const { data: tables, error: tableErr } = await supabase.rpc('admin_get_all_tables')
  if (tableErr) throw tableErr
  const snapshot = {}
  for (const table of tables || []) {
    let offset = 0
    const chunkSize = 2000
    const rows = []
    while (true) {
      const { data: chunk, error } = await supabase.rpc('admin_export_table_data', {
        p_table: table,
        p_offset: offset,
        p_limit: chunkSize,
      })
      if (error) throw error
      const arr = Array.isArray(chunk) ? chunk : []
      rows.push(...arr)
      if (arr.length < chunkSize) break
      offset += chunkSize
    }
    snapshot[table] = rows
  }
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), data: snapshot }, null, 2), 'utf8')
  return outPath
}

async function restoreFromAbdz() {
  const buf = fs.readFileSync(backupPath)
  const zip = await JSZip.loadAsync(buf)
  const dbFile = zip.file('database.json')
  if (!dbFile) throw new Error('database.json not found in abdz')
  const parsed = JSON.parse(await dbFile.async('string'))
  if (!parsed?.data) throw new Error('invalid backup content')
  if (parsed?.version && String(parsed.version) !== '2.0') {
    throw new Error('backup format is not supported by production restore runner')
  }
  if (parsed?.manifest?.format_version && String(parsed.manifest.format_version) !== '2.0') {
    throw new Error('backup manifest format is not supported')
  }
  const tablesData = parsed.data

  const tables = Object.keys(tablesData)
  const sortedTables = tables.sort((a, b) => {
    const ia = priorityOrder.indexOf(a)
    const ib = priorityOrder.indexOf(b)
    if (ia === -1 && ib === -1) return 0
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })

  const { error: wipeError } = await supabase.rpc('admin_wipe_all_tables_for_restore')
  if (wipeError) throw new Error(`wipe failed: ${wipeError.message}`)

  const tableStats = {}
  for (const table of sortedTables) {
    const dataArray = Array.isArray(tablesData[table]) ? tablesData[table] : []
    tableStats[table] = { total: dataArray.length, imported: 0 }
    if (!dataArray.length) continue
    const chunkSize = 2000
    for (let i = 0; i < dataArray.length; i += chunkSize) {
      const chunk = dataArray.slice(i, i + chunkSize)
      const { data: res, error } = await supabase.rpc('admin_import_table_data', {
        p_table: table,
        p_data: chunk,
      })
      if (error || res?.status === 'error') {
        throw new Error(`import ${table} failed: ${error?.message || res?.message || 'unknown'}`)
      }
      tableStats[table].imported = Math.min(dataArray.length, i + chunk.length)
    }
  }

  for (const relativePath of Object.keys(zip.files)) {
    const m = relativePath.match(/^storage\/([^\/]+)\/(.*)$/)
    if (!m || zip.files[relativePath].dir) continue
    const bucketName = m[1]
    const fileName = m[2]
    const fileData = await zip.files[relativePath].async('nodebuffer')
    const { error } = await supabase.storage.from(bucketName).upload(fileName, fileData, { upsert: true })
    if (error) throw new Error(`storage upload failed ${bucketName}/${fileName}: ${error.message}`)
  }

  const { error: resyncErr } = await supabase.rpc('admin_post_restore_resync')
  if (resyncErr) {
    console.warn('post-restore resync warning:', resyncErr.message)
  }

  const verify = {}
  for (const t of ['warehouses', 'admin_users', 'menu_items', 'stock_management', 'batches', 'inventory_movements', 'orders', 'purchase_orders']) {
    const { data, error } = await supabase.rpc('admin_export_table_data', {
      p_table: t,
      p_offset: 0,
      p_limit: 1,
    })
    if (error) verify[t] = { ok: false, error: error.message }
    else verify[t] = { ok: true, hasRows: Array.isArray(data) && data.length > 0 }
  }

  return { tableStats, verify, backupTimestamp: parsed.timestamp || null, backupSource: parsed.source || null }
}

async function main() {
  saveStatus({ stage: 'start', backupPath })
  const user = await login()
  saveStatus({ stage: 'logged_in', userId: user?.id || null })
  const health = await supabase.rpc('admin_backup_health_report')
  if (health.error) throw new Error(`backup health check failed: ${health.error.message}`)
  const checks = Array.isArray(health.data?.checks) ? health.data.checks : []
  const failed = checks.filter((c) => !c?.ok)
  if (failed.length > 0) throw new Error(`backup health checks failed: ${failed.map((x) => x.key).join(', ')}`)
  const snapshotPath = await exportEmergencySnapshot()
  saveStatus({ stage: 'snapshot_done', snapshotPath })
  const result = await restoreFromAbdz()
  saveStatus({ stage: 'restore_done', resultSummary: { verify: result.verify } })
  const out = {
    at: new Date().toISOString(),
    byUser: user?.id || null,
    backupPath,
    snapshotPath,
    ...result,
  }
  const reportPath = path.join(process.cwd(), 'backups', `restore_abdz_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2), 'utf8')
  saveStatus({ stage: 'completed', reportPath, snapshotPath })
  console.log(JSON.stringify({ ok: true, reportPath, snapshotPath, backupPath }, null, 2))
}

main().catch((e) => {
  saveStatus({ stage: 'failed', error: String(e?.message || e) })
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2))
  process.exit(1)
})
