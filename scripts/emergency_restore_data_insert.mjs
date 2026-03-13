import fs from 'node:fs'
import readline from 'node:readline'
import pg from 'pg'

const { Client } = pg

const dumpPath = process.argv[2] || 'backups/prod_20260204_235951/data_public.sql'
const resultPath = process.argv[3] || 'backups/emergency_restore_insert_result.json'
const batchSize = 200

function qid(v) {
  return `"${String(v).replace(/"/g, '""')}"`
}

function parseHeader(line) {
  const m = line.match(/^COPY\s+"public"\."([^"]+)"\s+\((.+)\)\s+FROM stdin;$/)
  if (!m) return null
  const table = m[1]
  const cols = m[2].split(',').map((x) => x.trim().replace(/^"|"$/g, ''))
  return { table, cols }
}

function unescapeCopyField(v) {
  if (v === '\\N') return null
  let s = v
  s = s.replace(/\\\\/g, '\u0000')
  s = s.replace(/\\t/g, '\t')
  s = s.replace(/\\n/g, '\n')
  s = s.replace(/\\r/g, '\r')
  s = s.replace(/\\b/g, '\b')
  s = s.replace(/\\f/g, '\f')
  s = s.replace(/\\v/g, '\v')
  s = s.replace(/\u0000/g, '\\')
  return s
}

async function insertBatch(client, table, cols, rows) {
  if (!rows.length) return 0
  const params = []
  const valuesSql = rows
    .map((row, i) => {
      const base = i * cols.length
      row.forEach((v) => params.push(v))
      const ps = cols.map((_, j) => `$${base + j + 1}`).join(',')
      return `(${ps})`
    })
    .join(',')
  const sql = `insert into public.${qid(table)} (${cols.map(qid).join(',')}) values ${valuesSql}`
  await client.query(sql, params)
  return rows.length
}

async function main() {
  if (!process.env.DBPW) throw new Error('DBPW is required')
  if (!fs.existsSync(dumpPath)) throw new Error(`dump not found: ${dumpPath}`)

  const client = new Client({
    host: 'aws-1-ap-south-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.pmhivhtaoydfolseelyc',
    password: process.env.DBPW,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  const rl = readline.createInterface({
    input: fs.createReadStream(dumpPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  let inCopy = false
  let curTable = ''
  let curCols = []
  let batch = []
  let tables = 0
  let rows = 0
  const tableRows = {}

  await client.query('begin')
  await client.query('set session_replication_role = replica')
  await client.query('set statement_timeout = 0')
  await client.query('set lock_timeout = 0')

  try {
    for await (const raw of rl) {
      const line = raw.replace(/\r$/, '')
      if (!inCopy) {
        const h = parseHeader(line)
        if (h) {
          inCopy = true
          curTable = h.table
          curCols = h.cols
          batch = []
          tables += 1
          tableRows[curTable] = tableRows[curTable] || 0
        }
        continue
      }

      if (line === '\\.') {
        const inserted = await insertBatch(client, curTable, curCols, batch)
        rows += inserted
        tableRows[curTable] += inserted
        inCopy = false
        curTable = ''
        curCols = []
        batch = []
        continue
      }

      const fields = line.split('\t').map(unescapeCopyField)
      batch.push(fields)
      if (batch.length >= batchSize) {
        const inserted = await insertBatch(client, curTable, curCols, batch)
        rows += inserted
        tableRows[curTable] += inserted
        batch = []
      }
    }

    if (inCopy && curTable && batch.length) {
      const inserted = await insertBatch(client, curTable, curCols, batch)
      rows += inserted
      tableRows[curTable] += inserted
    }

    await client.query('set session_replication_role = origin')
    await client.query('commit')

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
          (select count(*)::int from public.order_line_items) as order_line_items,
          (select count(*)::int from public.purchase_orders) as purchase_orders,
          (select count(*)::int from public.purchase_receipts) as purchase_receipts
      `)
    ).rows[0]

    const payload = { ok: true, dumpPath, tables, rows, counts, tableRows }
    fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8')
    console.log(JSON.stringify(payload, null, 2))
  } catch (e) {
    try {
      await client.query('set session_replication_role = origin')
    } catch {}
    await client.query('rollback')
    const payload = { ok: false, dumpPath, tables, rows, error: String(e?.message || e) }
    fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8')
    console.error(JSON.stringify(payload, null, 2))
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  const payload = { ok: false, dumpPath, error: String(e?.message || e) }
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8')
  console.error(String(e?.message || e))
  process.exit(1)
})
