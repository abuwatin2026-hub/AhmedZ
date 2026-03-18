import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import pg from 'pg'

const backupPath = process.argv[2]
const dbUrl = process.argv[3]

if (!backupPath || !dbUrl) {
  console.error('Usage: node scripts/dr-local-full-proof.mjs <path-to-abdz> <local-db-url>')
  process.exit(1)
}

if (!/127\.0\.0\.1|localhost/i.test(dbUrl)) {
  console.error('Refusing to run: db-url is not local')
  process.exit(1)
}

const { Client } = pg
const qid = (s) => `"${String(s).replace(/"/g, '""')}"`

const main = async () => {
  const raw = fs.readFileSync(backupPath)
  const zip = await JSZip.loadAsync(raw)
  const dbFile = zip.file('database.json')
  if (!dbFile) throw new Error('database.json not found in backup')
  const parsed = JSON.parse(await dbFile.async('string'))
  if (String(parsed?.version || '') !== '2.0') throw new Error('backup is not v2.0')
  if (!parsed?.data || typeof parsed.data !== 'object') throw new Error('invalid backup payload')

  const data = parsed.data
  const allTables = Object.keys(data)
  const report = {
    ok: true,
    at: new Date().toISOString(),
    backupPath: path.resolve(backupPath),
    totalTables: allTables.length,
    tableResults: {},
    failedTables: [],
  }

  const client = new Client({ connectionString: dbUrl, ssl: false })
  await client.connect()

  try {
    const existingTablesRes = await client.query(
      `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`
    )
    const existingTables = new Set((existingTablesRes.rows || []).map((r) => String(r.table_name)))

    await client.query('begin')
    await client.query(`set local session_replication_role = 'replica'`)

    for (const table of allTables.filter((t) => existingTables.has(t))) {
      await client.query(`truncate table public.${qid(table)} cascade`)
    }

    for (const table of allTables) {
      const rows = Array.isArray(data[table]) ? data[table] : []
      if (!existingTables.has(table)) {
        if (rows.length === 0) {
          report.tableResults[table] = { expected: 0, actual: 0, ok: true, skipped: 'table_missing_in_local_schema' }
        } else {
          report.tableResults[table] = { expected: rows.length, actual: 0, ok: false, error: 'table_missing_in_local_schema' }
          report.failedTables.push(table)
        }
        continue
      }
      if (!rows.length) {
        report.tableResults[table] = { expected: 0, actual: 0, ok: true }
        continue
      }

      const colsInfo = await client.query(
        `select column_name from information_schema.columns where table_schema='public' and table_name=$1`,
        [table]
      )
      const validCols = new Set((colsInfo.rows || []).map((r) => String(r.column_name)))
      const keySet = new Set()
      for (const row of rows.slice(0, 1500)) {
        for (const k of Object.keys(row || {})) keySet.add(k)
      }
      const cols = Array.from(keySet).filter((k) => validCols.has(k))
      if (!cols.length) {
        report.tableResults[table] = { expected: rows.length, actual: 0, ok: false, error: 'no matching columns' }
        report.failedTables.push(table)
        continue
      }

      const colSql = cols.map(qid).join(', ')
      const chunkSize = 2000
      let inserted = 0
      await client.query(`savepoint sp_${table.replace(/[^a-zA-Z0-9_]/g, '_')}`)
      try {
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize)
          const sql = `insert into public.${qid(table)} (${colSql}) select ${colSql} from json_populate_recordset(null::public.${qid(table)}, $1::json)`
          await client.query(sql, [JSON.stringify(chunk)])
          inserted += chunk.length
        }
      } catch (e) {
        await client.query(`rollback to savepoint sp_${table.replace(/[^a-zA-Z0-9_]/g, '_')}`)
        report.tableResults[table] = { expected: rows.length, actual: 0, ok: false, error: String(e?.message || e) }
        report.failedTables.push(table)
        continue
      }

      const countRes = await client.query(`select count(*)::int as c from public.${qid(table)}`)
      const actual = Number(countRes.rows[0]?.c || 0)
      const ok = actual === rows.length
      report.tableResults[table] = { expected: rows.length, actual, ok, inserted }
      if (!ok) report.failedTables.push(table)
    }

    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    await client.end()
  }

  report.ok = report.failedTables.length === 0
  const outPath = path.join(process.cwd(), 'backups', `dr_local_full_proof_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: report.ok, outPath, totalTables: report.totalTables, failedTables: report.failedTables.length }, null, 2))
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2))
  process.exit(1)
})
