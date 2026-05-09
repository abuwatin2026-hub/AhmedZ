import fs from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()
const backupsDir = path.join(rootDir, 'backups')
if (!fs.existsSync(backupsDir)) {
  throw new Error(`Missing backups directory: ${backupsDir}`)
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

const candidates = fs.readdirSync(backupsDir)
  .filter((f) => /^orders_integrity_probe_.*\.json$/i.test(f))
  .map((f) => ({ file: path.join(backupsDir, f), mtime: fs.statSync(path.join(backupsDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)

const probePath = candidates[0]?.file
if (!probePath) throw new Error('orders integrity probe report not found. run orders-integrity-probe-prod first')

const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'))
const hasBreach = !probe?.ok
const severity = String(probe?.severity || (hasBreach ? 'warning' : 'ok'))

const payload = {
  type: 'orders_integrity_alert',
  generatedAt: new Date().toISOString(),
  hasBreach,
  severity,
  probePath,
  metrics: probe?.metrics || {},
}

const ts = new Date().toISOString().replace(/[:.]/g, '-')
const outPath = path.join(backupsDir, `orders_integrity_alert_${ts}.json`)

if (hasBreach) {
  const webhook = String(process.env.ALERT_WEBHOOK_URL || '').trim()
  const webhookResult = await postWebhook(webhook, payload)
  fs.writeFileSync(outPath, JSON.stringify({ ...payload, webhookResult }, null, 2), 'utf8')
  console.log(JSON.stringify({ status: 'ALERT', outPath, probePath, severity, webhookResult }, null, 2))
  process.exit(severity === 'critical' ? 3 : 2)
}

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8')
console.log(JSON.stringify({ status: 'OK', outPath, probePath }, null, 2))
