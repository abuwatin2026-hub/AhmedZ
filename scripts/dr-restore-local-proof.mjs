import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { createClient } from '@supabase/supabase-js'

const backupPath = process.argv[2]
if (!backupPath) {
  console.error('Usage: node scripts/dr-restore-local-proof.mjs <path-to-abdz>')
  process.exit(1)
}

const localUrl = String(process.env.LOCAL_SUPABASE_URL || process.env.AZTA_SUPABASE_URL || '').trim()
const localAnon = String(process.env.LOCAL_SUPABASE_ANON_KEY || process.env.AZTA_SUPABASE_ANON_KEY || '').trim()
const localServiceRole = String(process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY || process.env.AZTA_SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ownerEmail = String(process.env.LOCAL_OWNER_EMAIL || process.env.AZTA_OWNER_EMAIL || 'owner@azta.com').trim()
const ownerPassword = String(process.env.LOCAL_OWNER_PASSWORD || process.env.AZTA_OWNER_PASSWORD || 'Owner@123').trim()

if (!localUrl || (!localAnon && !localServiceRole)) {
  console.error('Missing LOCAL_SUPABASE_URL and one of LOCAL_SUPABASE_ANON_KEY/LOCAL_SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const authKey = localServiceRole || localAnon
const supabase = createClient(localUrl, authKey, { auth: { persistSession: false } })

const priorityOrder = [
  'app_settings','organization_settings','currencies','fx_rates','roles','branches','companies','cost_centers','warehouses','chart_of_accounts',
  'admin_users','employees','financial_parties','suppliers','customers','categories','menu_items','items','uom','item_uom','item_warehouses',
  'product_prices_multi_currency','pricing_tiers','customer_pricing','purchase_orders','purchase_items','purchase_receipts','purchase_receipt_items',
  'stock_management','batches','inventory_movements','order_item_reservations','import_shipments','import_shipments_items','import_expenses',
  'cash_shifts','orders','order_items','order_item_cogs','sales_returns','warehouse_transfers','warehouse_transfer_items','journal_entries',
  'journal_lines','vouchers','payments','supplier_credit_notes','payroll_employees','payroll_runs','payroll_lines','allowance_types','deduction_types',
  'employee_allowances','employee_deductions','attendance_records','employee_contracts','employee_guarantees','attendance_config',
  'attendance_punches','attendance_webauthn_challenges','payroll_attendance','supplier_contracts','supplier_evaluations','notifications',
  'reviews','system_audit_logs','pos_sessions','pos_terminals','stocktaking_sessions','stocktaking_items'
]

const criticalTables = ['warehouses','admin_users','menu_items','stock_management','batches','inventory_movements','orders','purchase_orders']

const main = async () => {
  if (!localServiceRole) {
    const login = await supabase.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword })
    if (login.error) throw new Error(`local owner login failed: ${login.error.message}`)
  }

  if (!localServiceRole) {
    const health = await supabase.rpc('admin_backup_health_report')
    if (health.error) throw new Error(`backup health check failed: ${health.error.message}`)
  }

  const raw = fs.readFileSync(backupPath)
  const zip = await JSZip.loadAsync(raw)
  const dbFile = zip.file('database.json')
  if (!dbFile) throw new Error('database.json not found in backup')
  const parsed = JSON.parse(await dbFile.async('string'))
  if (!parsed?.data) throw new Error('invalid backup format')
  if (String(parsed?.version || '') !== '2.0') throw new Error('backup is not v2.0')
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw new Error('manifest.json missing')
  const manifest = JSON.parse(await manifestFile.async('string'))
  if (String(manifest?.format_version || '') !== '2.0') throw new Error('manifest is not v2.0')

  const backupData = parsed.data
  const tableNames = Object.keys(backupData)
  const sortedTables = tableNames.sort((a, b) => {
    const ia = priorityOrder.indexOf(a)
    const ib = priorityOrder.indexOf(b)
    if (ia === -1 && ib === -1) return 0
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })

  const wipe = await supabase.rpc('admin_wipe_all_tables_for_restore')
  if (wipe.error) throw new Error(`wipe failed: ${wipe.error.message}`)

  const imported = {}
  for (const table of sortedTables) {
    const arr = Array.isArray(backupData[table]) ? backupData[table] : []
    imported[table] = 0
    if (!arr.length) continue
    const chunkSize = 2000
    for (let i = 0; i < arr.length; i += chunkSize) {
      const chunk = arr.slice(i, i + chunkSize)
      const r = await supabase.rpc('admin_import_table_data', { p_table: table, p_data: chunk })
      if (r.error || r.data?.status === 'error') throw new Error(`import ${table} failed: ${r.error?.message || r.data?.message || 'unknown'}`)
      imported[table] = Math.min(arr.length, i + chunk.length)
    }
  }

  const resync = await supabase.rpc('admin_post_restore_resync')
  if (resync.error) throw new Error(`resync failed: ${resync.error.message}`)

  const verify = {}
  for (const table of criticalTables) {
    const expected = Number(manifest?.row_counts?.[table] ?? (Array.isArray(backupData[table]) ? backupData[table].length : 0))
    const probe = await supabase.rpc('admin_export_table_data', { p_table: table, p_offset: 0, p_limit: Math.max(1, expected) })
    if (probe.error) throw new Error(`verify ${table} failed: ${probe.error.message}`)
    const actual = Array.isArray(probe.data) ? probe.data.length : 0
    verify[table] = { expected, actual, ok: actual === expected }
  }

  const report = {
    ok: Object.values(verify).every((x) => x.ok),
    at: new Date().toISOString(),
    localUrl,
    authMode: localServiceRole ? 'service_role' : 'owner_login',
    backupPath: path.resolve(backupPath),
    verify,
  }

  const outPath = path.join(process.cwd(), 'backups', `dr_local_restore_proof_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: report.ok, outPath }, null, 2))
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2))
  process.exit(1)
})
