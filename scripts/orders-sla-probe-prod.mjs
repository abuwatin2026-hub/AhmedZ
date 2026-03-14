import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const { Client } = pg

if (!process.env.DBPW) {
  console.error('DBPW is required')
  process.exit(1)
}

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.pmhivhtaoydfolseelyc',
  password: process.env.DBPW,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
})

const parseArg = (name, fallback) => {
  const token = `--${name}=`
  const hit = process.argv.find((x) => x.startsWith(token))
  if (!hit) return fallback
  const v = Number(hit.slice(token.length))
  if (!Number.isFinite(v)) return fallback
  return v
}

const runs = Math.max(3, parseArg('runs', 15))
const limit = Math.max(10, parseArg('limit', 60))
const readP95ThresholdMs = Math.max(100, parseArg('read-p95-threshold-ms', 1000))
const readP99ThresholdMs = Math.max(100, parseArg('read-p99-threshold-ms', 1500))
const readMaxThresholdMs = Math.max(100, parseArg('read-max-threshold-ms', 5000))
const paymentP95ThresholdMs = Math.max(100, parseArg('payment-p95-threshold-ms', 1500))
const paymentP99ThresholdMs = Math.max(100, parseArg('payment-p99-threshold-ms', 2200))

const percentile = (arr, p) => {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

async function probeQuery(sql, params = []) {
  const t0 = Date.now()
  const res = await client.query(sql, params)
  return { ms: Date.now() - t0, rowCount: res.rowCount || 0 }
}

async function main() {
  await client.connect()

  const report = {
    generatedAt: new Date().toISOString(),
    runs,
    limit,
    probes: [],
    summary: {},
    sla: {},
  }

  const readDurations = []
  const countDurations = []
  const paymentAggDurations = []

  for (let i = 0; i < runs; i += 1) {
    const read = await probeQuery(
      `
      select id, status, created_at
      from public.orders
      order by created_at desc
      limit $1
      `,
      [limit]
    )
    const count = await probeQuery(`select count(*)::int from public.orders`)
    const paymentAgg = await probeQuery(
      `
      select reference_id, sum(amount) as total
      from public.payments
      where reference_table='orders'
      group by reference_id
      order by max(created_at) desc nulls last
      limit $1
      `,
      [limit]
    )

    readDurations.push(read.ms)
    countDurations.push(count.ms)
    paymentAggDurations.push(paymentAgg.ms)
    report.probes.push({
      i,
      readOrdersMs: read.ms,
      countOrdersMs: count.ms,
      paymentAggMs: paymentAgg.ms,
      readRows: read.rowCount,
    })
  }

  const summary = {
    readOrders: {
      min: Math.min(...readDurations),
      p50: percentile(readDurations, 50),
      p95: percentile(readDurations, 95),
      p99: percentile(readDurations, 99),
      max: Math.max(...readDurations),
      avg: Math.round(readDurations.reduce((a, b) => a + b, 0) / readDurations.length),
    },
    countOrders: {
      min: Math.min(...countDurations),
      p50: percentile(countDurations, 50),
      p95: percentile(countDurations, 95),
      max: Math.max(...countDurations),
      avg: Math.round(countDurations.reduce((a, b) => a + b, 0) / countDurations.length),
    },
    paymentAggregation: {
      min: Math.min(...paymentAggDurations),
      p50: percentile(paymentAggDurations, 50),
      p95: percentile(paymentAggDurations, 95),
      p99: percentile(paymentAggDurations, 99),
      max: Math.max(...paymentAggDurations),
      avg: Math.round(paymentAggDurations.reduce((a, b) => a + b, 0) / paymentAggDurations.length),
    },
  }
  report.summary = summary

  report.thresholds = {
    readP95ThresholdMs,
    readP99ThresholdMs,
    readMaxThresholdMs,
    paymentP95ThresholdMs,
    paymentP99ThresholdMs,
  }
  report.sla = {
    readOrdersP95WithinThreshold: summary.readOrders.p95 <= readP95ThresholdMs,
    readOrdersP99WithinThreshold: summary.readOrders.p99 <= readP99ThresholdMs,
    readOrdersMaxWithinThreshold: summary.readOrders.max <= readMaxThresholdMs,
    paymentAggregationP95WithinThreshold: summary.paymentAggregation.p95 <= paymentP95ThresholdMs,
    paymentAggregationP99WithinThreshold: summary.paymentAggregation.p99 <= paymentP99ThresholdMs,
  }
  report.ok = Object.values(report.sla).every(Boolean)
  report.severity = report.ok
    ? 'ok'
    : (summary.readOrders.max > readMaxThresholdMs * 1.5 || summary.readOrders.p99 > readP99ThresholdMs * 1.5 ? 'critical' : 'warning')

  const outPath = path.join(process.cwd(), 'backups', `orders_sla_probe_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        outPath,
        readOrders: summary.readOrders,
        paymentAggregation: summary.paymentAggregation,
      },
      null,
      2
    )
  )
}

main()
  .catch((e) => {
    console.error(String(e?.message || e))
    process.exit(1)
  })
  .finally(async () => {
    try {
      await client.end()
    } catch {}
  })
