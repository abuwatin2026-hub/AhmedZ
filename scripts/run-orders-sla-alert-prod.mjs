import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const loadEnv = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i <= 0) continue
      const k = t.slice(0, i).trim()
      let v = t.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!process.env[k]) process.env[k] = v
    }
  } catch {}
}

const postWebhook = async (url, payload) => {
  if (!url) return { sent: false }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { sent: true, status: res.status, ok: res.ok }
}

loadEnv(path.join(rootDir, '.env.production'))
loadEnv(path.join(rootDir, '.env.local'))

if (!String(process.env.DBPW || process.env.SUPABASE_DB_PASSWORD || '').trim()) {
  throw new Error('Missing DBPW or SUPABASE_DB_PASSWORD')
}

const startedAt = new Date().toISOString()
const backupsDir = path.join(rootDir, 'backups')
const probeCandidates = fs.readdirSync(backupsDir)
  .filter((f) => /^orders_sla_probe_.*\.json$/i.test(f))
  .map((f) => ({
    file: path.join(backupsDir, f),
    mtime: fs.statSync(path.join(backupsDir, f)).mtimeMs,
  }))
  .sort((a, b) => b.mtime - a.mtime)
const probePath = probeCandidates[0]?.file || ''
if (!probePath || !fs.existsSync(probePath)) throw new Error('orders SLA probe report was not found. run orders-sla-probe-prod first')

const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'))
const hasBreach = !probe?.ok
const severity = String(probe?.severity || (hasBreach ? 'warning' : 'ok'))

const result = {
  startedAt,
  finishedAt: new Date().toISOString(),
  hasBreach,
  severity,
  probePath,
  summary: probe?.summary || {},
  thresholds: probe?.thresholds || {},
  sla: probe?.sla || {},
}

const outDir = path.join(rootDir, 'backups')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
const ts = new Date().toISOString().replace(/[:.]/g, '-')
const outPath = path.join(outDir, `orders_sla_alert_check_${ts}.json`)
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8')

if (hasBreach) {
  const webhook = String(process.env.ALERT_WEBHOOK_URL || '').trim()
  const payload = {
    text: `[${severity.toUpperCase()}] orders SLA breach detected at ${result.finishedAt}`,
    ...result,
  }
  const webhookResult = await postWebhook(webhook, payload)
  const alertPath = path.join(outDir, `orders_sla_alert_${ts}.json`)
  fs.writeFileSync(alertPath, JSON.stringify({ ...payload, webhookResult }, null, 2), 'utf8')
  console.log(JSON.stringify({ status: 'ALERT', outPath, alertPath, webhookResult, probePath }, null, 2))
  process.exit(severity === 'critical' ? 3 : 2)
}

console.log(JSON.stringify({ status: 'OK', outPath, probePath }, null, 2))
