import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { createClient } from '@supabase/supabase-js'

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

if (!supabaseUrl || !supabaseAnon || !ownerEmail || !ownerPassword) {
  console.error('Missing required env keys for export-abdz-v2')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false } })

const main = async () => {
  const login = await supabase.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword })
  if (login.error) throw new Error(`login failed: ${login.error.message}`)

  const health = await supabase.rpc('admin_backup_health_report')
  if (health.error) throw new Error(`health check failed: ${health.error.message}`)
  const failed = Array.isArray(health.data?.checks) ? health.data.checks.filter((c) => !c?.ok) : []
  if (failed.length > 0) throw new Error(`health checks failed: ${failed.map((x) => x.key).join(', ')}`)

  const tablesRes = await supabase.rpc('admin_get_all_tables')
  if (tablesRes.error || !Array.isArray(tablesRes.data)) throw new Error(`table scan failed: ${tablesRes.error?.message || 'invalid response'}`)

  const backupData = {}
  const rowCounts = {}
  for (const table of tablesRes.data) {
    let offset = 0
    const limit = 2000
    const rows = []
    while (true) {
      const r = await supabase.rpc('admin_export_table_data', { p_table: table, p_offset: offset, p_limit: limit })
      if (r.error) throw new Error(`export ${table} failed: ${r.error.message}`)
      const arr = Array.isArray(r.data) ? r.data : []
      rows.push(...arr)
      if (arr.length < limit) break
      offset += limit
    }
    backupData[table] = rows
    rowCounts[table] = rows.length
  }

  const migrationRows = Array.isArray(backupData.schema_migrations) ? backupData.schema_migrations : []
  const migrationStrings = migrationRows
    .map((x) => String(x?.version || x?.name || x?.id || '').trim())
    .filter(Boolean)
    .sort()

  const payload = {
    version: '2.0',
    timestamp: new Date().toISOString(),
    source: 'ABDZ v2 export script',
    data: backupData,
  }

  const manifest = {
    format_version: '2.0',
    generated_at: payload.timestamp,
    source: payload.source,
    schema_migration_count: migrationStrings.length,
    schema_migration_latest: migrationStrings.length ? migrationStrings[migrationStrings.length - 1] : null,
    table_count: Object.keys(backupData).length,
    row_counts: rowCounts,
    storage_files: [],
  }

  const zip = new JSZip()
  zip.file('database.json', JSON.stringify(payload))
  zip.file('manifest.json', JSON.stringify(manifest))
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const fileName = `AhmedZ_Full_Backup_v2_${new Date().toISOString().replace(/[:.]/g, '-')}.abdz`
  const outPath = path.join(process.cwd(), 'backups', fileName)
  fs.writeFileSync(outPath, buf)
  console.log(JSON.stringify({ ok: true, outPath, tableCount: manifest.table_count }, null, 2))
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2))
  process.exit(1)
})
