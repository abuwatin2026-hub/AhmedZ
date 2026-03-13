import fs from 'node:fs'
import readline from 'node:readline'
import pg from 'pg'
import pgCopyStreams from 'pg-copy-streams'

const { Client } = pg
const { from: copyFrom } = pgCopyStreams

const dumpPath = process.argv[2] || 'backups/prod_20260204_235951/data_public.sql'
const resultPath = process.argv[3] || 'backups/emergency_restore_result.json'

function waitStream(stream) {
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve)
    stream.on('error', reject)
  })
}

async function main() {
  if (!process.env.DBPW) throw new Error('DBPW is required')
  if (!fs.existsSync(dumpPath)) throw new Error(`dump file missing: ${dumpPath}`)

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
  let copySql = ''
  let copyStream = null
  let copiedTables = 0
  let copiedRows = 0

  await client.query('begin')
  await client.query('set session_replication_role = replica')
  await client.query('set statement_timeout = 0')
  await client.query('set lock_timeout = 0')
  await client.query('set idle_in_transaction_session_timeout = 0')

  try {
    for await (const raw of rl) {
      const line = raw.replace(/\r$/, '')
      if (!inCopy) {
        if (line.startsWith('COPY ') && line.endsWith(' FROM stdin;')) {
          inCopy = true
          copySql = line.slice(0, -1)
          copyStream = client.query(copyFrom(copySql))
          copiedTables += 1
        }
        continue
      }

      if (line === '\\.') {
        copyStream.end()
        await waitStream(copyStream)
        inCopy = false
        copySql = ''
        copyStream = null
        continue
      }

      copyStream.write(line + '\n')
      copiedRows += 1
    }

    if (inCopy && copyStream) {
      copyStream.end()
      await waitStream(copyStream)
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

    const payload = { ok: true, dumpPath, copiedTables, copiedRows, counts }
    fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8')
    console.log(JSON.stringify(payload, null, 2))
  } catch (e) {
    try {
      await client.query('set session_replication_role = origin')
    } catch {}
    await client.query('rollback')
    const payload = { ok: false, dumpPath, copiedTables, copiedRows, error: String(e?.message || e) }
    fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8')
    console.error(JSON.stringify(payload, null, 2))
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(String(e?.message || e))
  process.exit(1)
})
