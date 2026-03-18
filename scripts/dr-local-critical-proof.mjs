import fs from 'node:fs'
import JSZip from 'jszip'
import pg from 'pg'

const backupPath = process.argv[2]
const dbUrl = process.argv[3]
if (!backupPath || !dbUrl) {
  console.error('Usage: node scripts/dr-local-critical-proof.mjs <path-to-abdz> <local-db-url>')
  process.exit(1)
}

const { Client } = pg
const criticalTables = ['warehouses', 'admin_users', 'menu_items', 'stock_management', 'batches', 'inventory_movements', 'orders', 'purchase_orders']

const qid = (s) => `"${String(s).replace(/"/g, '""')}"`

const main = async () => {
  const raw = fs.readFileSync(backupPath)
  const zip = await JSZip.loadAsync(raw)
  const dbFile = zip.file('database.json')
  if (!dbFile) throw new Error('database.json not found')
  const payload = JSON.parse(await dbFile.async('string'))
  if (String(payload?.version || '') !== '2.0') throw new Error('backup is not v2')
  const data = payload.data || {}

  const client = new Client({ connectionString: dbUrl, ssl: false })
  await client.connect()

  const verify = {}
  try {
    await client.query('begin')
    await client.query(`set local session_replication_role = 'replica'`)
    for (const table of criticalTables) {
      await client.query(`truncate table public.${qid(table)} cascade`)
    }

    for (const table of criticalTables) {
      const rows = Array.isArray(data[table]) ? data[table] : []
      if (!rows.length) {
        verify[table] = { expected: 0, actual: 0, ok: true }
        continue
      }
      const colsInfo = await client.query(
        `select column_name from information_schema.columns where table_schema='public' and table_name=$1`,
        [table]
      )
      const validCols = new Set((colsInfo.rows || []).map((r) => String(r.column_name)))
      const keySet = new Set()
      for (const row of rows.slice(0, 1000)) {
        for (const k of Object.keys(row || {})) keySet.add(k)
      }
      const cols = Array.from(keySet).filter((k) => validCols.has(k))
      if (!cols.length) throw new Error(`no matching columns for table ${table}`)
      const colSql = cols.map(qid).join(', ')
      const chunkSize = 2000
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize)
        const sql = `insert into public.${qid(table)} (${colSql}) select ${colSql} from json_populate_recordset(null::public.${qid(table)}, $1::json)`
        await client.query(sql, [JSON.stringify(chunk)])
      }
      const count = await client.query(`select count(*)::int as c from public.${qid(table)}`)
      const actual = Number(count.rows[0].c || 0)
      verify[table] = { expected: rows.length, actual, ok: actual === rows.length }
    }
    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    await client.end()
  }

  const ok = Object.values(verify).every((x) => x.ok)
  const outPath = `c:/nasrflash/AhmedZ/backups/dr_local_critical_proof_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  fs.writeFileSync(outPath, JSON.stringify({ ok, verify, backupPath }, null, 2), 'utf8')
  console.log(JSON.stringify({ ok, outPath }, null, 2))
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2))
  process.exit(1)
})
