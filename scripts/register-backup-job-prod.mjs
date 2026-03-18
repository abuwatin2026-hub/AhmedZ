import fs from 'node:fs'
import path from 'node:path'
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
const cronToken = String(process.env.BACKUP_CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const cronExpr = String(process.env.BACKUP_CRON || '0 3 * * *').trim()

if (!supabaseUrl || !supabaseAnon || !ownerEmail || !ownerPassword || !cronToken) {
  console.error('Missing required env keys for backup scheduler setup')
  process.exit(1)
}

const functionUrl = String(process.env.BACKUP_FUNCTION_URL || `${supabaseUrl.replace('.supabase.co', '.functions.supabase.co')}/automated-backup`).trim()
const supabase = createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false } })

const main = async () => {
  const login = await supabase.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword })
  if (login.error) throw new Error(`login failed: ${login.error.message}`)

  const health = await supabase.rpc('admin_backup_health_report')
  if (health.error) throw new Error(`health check failed: ${health.error.message}`)

  const schedule = await supabase.rpc('admin_register_automated_backup_job', {
    p_function_url: functionUrl,
    p_bearer_token: cronToken,
    p_cron: cronExpr,
  })
  if (schedule.error) throw new Error(`register schedule failed: ${schedule.error.message}`)

  const verify = await supabase.rpc('admin_backup_health_report')
  if (verify.error) throw new Error(`verify health check failed: ${verify.error.message}`)

  console.log(JSON.stringify({
    ok: true,
    functionUrl,
    cron: cronExpr,
    scheduleResult: schedule.data,
    healthOk: Boolean(verify.data?.ok),
  }, null, 2))
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2))
  process.exit(1)
})
