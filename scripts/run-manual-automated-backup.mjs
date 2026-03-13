import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const envVars = fs.readFileSync('.env.production', 'utf8')
const supabaseUrl = (envVars.match(/VITE_SUPABASE_URL=(.*)/) || [])[1]?.trim() || ''
const supabaseAnon = (envVars.match(/VITE_SUPABASE_ANON_KEY=(.*)/) || [])[1]?.trim() || ''

if (!supabaseUrl || !supabaseAnon) {
  console.error('Missing Supabase URL or anon key in .env.production')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnon)

async function main() {
  const login = await supabase.auth.signInWithPassword({
    email: 'owner@azta.com',
    password: 'AhmedZ#123456',
  })
  if (login.error) throw new Error(`login failed: ${login.error.message}`)

  const tablesRes = await supabase.rpc('admin_get_all_tables')
  if (tablesRes.error || !Array.isArray(tablesRes.data)) {
    throw new Error(`table scan failed: ${tablesRes.error?.message || 'invalid response'}`)
  }

  const backupData = {}
  for (const table of tablesRes.data) {
    let offset = 0
    const limit = 2000
    const rows = []
    while (true) {
      const r = await supabase.rpc('admin_export_table_data', {
        p_table: table,
        p_offset: offset,
        p_limit: limit,
      })
      if (r.error) throw new Error(`export ${table} failed: ${r.error.message}`)
      const arr = Array.isArray(r.data) ? r.data : []
      rows.push(...arr)
      if (arr.length < limit) break
      offset += limit
    }
    backupData[table] = rows
  }

  const payload = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    source: 'Manual automated backup fallback',
    data: backupData,
  }

  const fileName = `automated-backup-manual-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const upload = await supabase.storage
    .from('automated_backups')
    .upload(fileName, Buffer.from(JSON.stringify(payload)), {
      contentType: 'application/json',
      upsert: false,
    })

  if (upload.error) throw new Error(`upload failed: ${upload.error.message}`)

  const report = {
    ok: true,
    fileName,
    tables: tablesRes.data.length,
    generatedAt: payload.timestamp,
  }
  const outPath = path.join(process.cwd(), 'backups', `manual_automated_backup_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ ...report, outPath }, null, 2))
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2))
  process.exit(1)
})
