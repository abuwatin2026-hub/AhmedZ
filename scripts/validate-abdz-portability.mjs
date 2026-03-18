import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const backupPath = process.argv[2]
if (!backupPath) {
  console.error('Usage: node scripts/validate-abdz-portability.mjs <path-to-abdz>')
  process.exit(1)
}

const requiredTables = [
  'warehouses',
  'admin_users',
  'menu_items',
  'stock_management',
  'batches',
  'inventory_movements',
  'orders',
  'purchase_orders',
]

const main = async () => {
  const raw = fs.readFileSync(backupPath)
  const zip = await JSZip.loadAsync(raw)
  const dbFile = zip.file('database.json')
  if (!dbFile) throw new Error('database.json not found')
  const parsed = JSON.parse(await dbFile.async('string'))
  const manifestFile = zip.file('manifest.json')
  const manifest = manifestFile ? JSON.parse(await manifestFile.async('string')) : null
  const missing = requiredTables.filter((t) => !Array.isArray(parsed?.data?.[t]))
  const storageFiles = Object.keys(zip.files).filter((p) => /^storage\/[^\/]+\/.+/.test(p) && !zip.files[p].dir)

  const report = {
    ok: true,
    version: parsed?.version || null,
    hasManifest: Boolean(manifest),
    manifestVersion: manifest?.format_version || null,
    tableCount: parsed?.data ? Object.keys(parsed.data).length : 0,
    missingRequiredTables: missing,
    schemaMigrationCount: manifest?.schema_migration_count ?? null,
    schemaMigrationLatest: manifest?.schema_migration_latest ?? null,
    storageFiles: storageFiles.length,
  }

  if (String(report.version) !== '2.0') report.ok = false
  if (!report.hasManifest || String(report.manifestVersion) !== '2.0') report.ok = false
  if (missing.length > 0) report.ok = false

  const outPath = path.join(process.cwd(), 'backups', `abdz_portability_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: report.ok, outPath, report }, null, 2))
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2))
  process.exit(1)
})
