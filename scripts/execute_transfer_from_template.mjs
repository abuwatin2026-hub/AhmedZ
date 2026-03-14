import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import crypto from 'node:crypto'

const { Client } = pg

const fileArg = process.argv[2]
const itemwiseMode = process.argv.includes('--itemwise')
const strictRequireQty = process.argv.includes('--strict-require-qty')
if (!fileArg) {
  console.error('Usage: node scripts/execute_transfer_from_template.mjs <template_csv_path>')
  process.exit(1)
}
if (!process.env.DBPW) {
  console.error('DBPW is required')
  process.exit(1)
}

function parseNum(v) {
  if (v === null || v === undefined) return NaN
  const s = String(v)
    .trim()
    .replace(/,/g, '.')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
  if (!s) return NaN
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

function parseLine(line, sep = ';') {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === sep && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

const fullPath = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg)
if (!fs.existsSync(fullPath)) {
  console.error(`Template file not found: ${fullPath}`)
  process.exit(1)
}

const txt = fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '')
const lines = txt.split(/\r?\n/).filter(Boolean)
if (lines.length < 2) {
  console.error('Template file is empty')
  process.exit(1)
}

const header = parseLine(lines[0], ';').map((x) => x.trim())
const idx = Object.fromEntries(header.map((h, i) => [h, i]))

const requiredCols = ['source_warehouse_id', 'target_warehouse_id', 'item_id']
for (const col of requiredCols) {
  if (idx[col] === undefined) {
    console.error(`Missing required column: ${col}`)
    process.exit(1)
  }
}

const rows = []
for (let i = 1; i < lines.length; i += 1) {
  const c = parseLine(lines[i], ';')
  rows.push({
    line: i + 1,
    source_warehouse_id: String(c[idx.source_warehouse_id] || '').trim(),
    target_warehouse_id: String(c[idx.target_warehouse_id] || '').trim(),
    item_id: String(c[idx.item_id] || '').trim(),
    item_name_ar: String(c[idx.item_name_ar] || '').trim(),
    qty_in_base_per_uom: parseNum(c[idx.qty_in_base_per_uom]),
    available_base_qty: parseNum(c[idx.available_base_qty]),
    transfer_qty_uom: parseNum(c[idx.transfer_qty_uom]),
    transfer_qty: parseNum(c[idx.transfer_qty]),
  })
}

const selected = rows.filter((r) => r.source_warehouse_id && r.target_warehouse_id && r.item_id)
if (!selected.length) {
  console.error('No executable lines found')
  process.exit(1)
}

const groups = new Map()
for (const r of selected) {
  const key = `${r.source_warehouse_id}__${r.target_warehouse_id}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(r)
}

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.pmhivhtaoydfolseelyc',
  password: process.env.DBPW,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
})

await client.connect()

const actor = '25b65f34-ce92-421d-abbd-b53a0bfcf4f6'
const claims = JSON.stringify({ role: 'authenticated', sub: actor }).replace(/'/g, "''")

const report = {
  at: new Date().toISOString(),
  file: fullPath,
  assumption: 'If transfer_qty_uom is empty, available_base_qty is used once per item.',
  mode: itemwiseMode ? 'itemwise' : 'bulk',
  groups: [],
}

if (strictRequireQty) {
  const missing = selected.filter((r) => {
    const q1 = Number.isFinite(r.transfer_qty_uom) && r.transfer_qty_uom > 0
    const q2 = Number.isFinite(r.transfer_qty) && r.transfer_qty > 0
    return !(q1 || q2)
  })
  if (missing.length > 0) {
    const outPath = path.join(process.cwd(), 'backups', `transfer_execute_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    const failReport = {
      ...report,
      ok: false,
      error: 'STRICT_MODE_MISSING_QUANTITY',
      missing_count: missing.length,
      missing_sample: missing.slice(0, 20).map((x) => ({
        line: x.line,
        item_id: x.item_id,
        item_name_ar: x.item_name_ar,
        source_warehouse_id: x.source_warehouse_id,
        target_warehouse_id: x.target_warehouse_id,
      })),
    }
    fs.writeFileSync(outPath, JSON.stringify(failReport, null, 2), 'utf8')
    console.log(JSON.stringify({ ok: false, outPath, error: failReport.error, missing_count: missing.length }, null, 2))
    await client.end()
    process.exit(2)
  }
}

for (const [k, gRows] of groups.entries()) {
  const [sourceWh, targetWh] = k.split('__')
  const byItem = new Map()

  for (const r of gRows) {
    if (!byItem.has(r.item_id)) {
      byItem.set(r.item_id, {
        item_id: r.item_id,
        item_name_ar: r.item_name_ar,
        manual_base: 0,
        auto_base: 0,
        lines: [],
      })
    }
    const it = byItem.get(r.item_id)
    it.lines.push(r.line)
    const manualUom = Number.isFinite(r.transfer_qty_uom) && r.transfer_qty_uom > 0 && Number.isFinite(r.qty_in_base_per_uom) && r.qty_in_base_per_uom > 0
    const manualBase = Number.isFinite(r.transfer_qty) && r.transfer_qty > 0
    if (manualUom) {
      it.manual_base += r.transfer_qty_uom * r.qty_in_base_per_uom
    } else if (manualBase) {
      it.manual_base += r.transfer_qty
    } else {
      it.auto_base = Math.max(it.auto_base, Number.isFinite(r.available_base_qty) ? r.available_base_qty : 0)
    }
  }

  const itemIds = [...byItem.keys()]
  const sm = (
    await client.query(
      `select item_id::text as item_id, coalesce(available_quantity,0)::numeric as available from public.stock_management where warehouse_id=$1 and item_id = any($2::text[])`,
      [sourceWh, itemIds]
    )
  ).rows
  const availMap = new Map(sm.map((x) => [x.item_id, Number(x.available)]))

  const plan = []
  for (const it of byItem.values()) {
    const desired = it.manual_base > 0 ? it.manual_base : it.auto_base
    const current = availMap.get(it.item_id) ?? 0
    const finalBase = Math.max(0, Math.min(desired, current))
    if (finalBase > 0) {
      plan.push({
        item_id: it.item_id,
        item_name_ar: it.item_name_ar,
        desired_base: desired,
        current_available: current,
        final_base: finalBase,
        adjusted: finalBase !== desired,
      })
    }
  }

  if (!plan.length) {
    report.groups.push({ sourceWh, targetWh, skipped: true, reason: 'No positive quantities' })
    continue
  }

  const executeItemwise = async () => {
    const success = []
    const failed = []
    const skipped = []
    for (const p of plan) {
      if (!(p.final_base > 0)) {
        skipped.push({ item_id: p.item_id, reason: 'qty<=0' })
        continue
      }
      await client.query('begin')
      try {
        await client.query(`set local "request.jwt.claims"='${claims}'`)
        const transferId = crypto.randomUUID()
        const notes = `Itemwise transfer from template ${path.basename(fullPath)}`
        await client.query(
          `insert into public.warehouse_transfers(id,from_warehouse_id,to_warehouse_id,transfer_date,status,notes,created_by) values($1,$2,$3,now(),'pending',$4,$5)`,
          [transferId, sourceWh, targetWh, notes, actor]
        )
        await client.query(
          `insert into public.warehouse_transfer_items(id,transfer_id,item_id,quantity,transferred_quantity,notes) values($1,$2,$3,$4,0,$5)`,
          [crypto.randomUUID(), transferId, p.item_id, p.final_base, p.adjusted ? 'AUTO_ADJUSTED_TO_CURRENT_STOCK' : '']
        )
        await client.query(`select public.complete_warehouse_transfer($1::uuid)`, [transferId])
        const tr = (
          await client.query(
            `select id::text, transfer_number, status, completed_at from public.warehouse_transfers where id=$1`,
            [transferId]
          )
        ).rows[0]
        await client.query('commit')
        success.push({
          item_id: p.item_id,
          item_name_ar: p.item_name_ar,
          qty: p.final_base,
          transfer_number: tr.transfer_number,
          status: tr.status,
        })
      } catch (e) {
        await client.query('rollback')
        failed.push({
          item_id: p.item_id,
          item_name_ar: p.item_name_ar,
          qty: p.final_base,
          error: String(e?.message || e),
        })
      }
    }
    return { success, failed, skipped }
  }

  if (itemwiseMode) {
    const itemwise = await executeItemwise()
    report.groups.push({
      sourceWh,
      targetWh,
      mode: 'itemwise',
      summary: {
        success: itemwise.success.length,
        failed: itemwise.failed.length,
        skipped: itemwise.skipped.length,
      },
      success_sample: itemwise.success.slice(0, 20),
      failed_sample: itemwise.failed.slice(0, 20),
    })
    continue
  }

  await client.query('begin')
  try {
    await client.query(`set local "request.jwt.claims"='${claims}'`)
    const transferId = crypto.randomUUID()
    const notes = `Bulk transfer from template ${path.basename(fullPath)}`
    await client.query(
      `insert into public.warehouse_transfers(id,from_warehouse_id,to_warehouse_id,transfer_date,status,notes,created_by) values($1,$2,$3,now(),'pending',$4,$5)`,
      [transferId, sourceWh, targetWh, notes, actor]
    )
    for (const p of plan) {
      await client.query(
        `insert into public.warehouse_transfer_items(id,transfer_id,item_id,quantity,transferred_quantity,notes) values($1,$2,$3,$4,0,$5)`,
        [crypto.randomUUID(), transferId, p.item_id, p.final_base, p.adjusted ? 'AUTO_ADJUSTED_TO_CURRENT_STOCK' : '']
      )
    }
    await client.query(`select public.complete_warehouse_transfer($1::uuid)`, [transferId])
    const tr = (
      await client.query(
        `select id::text, transfer_number, status, from_warehouse_id::text as from_warehouse_id, to_warehouse_id::text as to_warehouse_id, completed_at from public.warehouse_transfers where id=$1`,
        [transferId]
      )
    ).rows[0]
    const sum = (
      await client.query(`select count(*)::int as items, coalesce(sum(quantity),0)::numeric as total_qty from public.warehouse_transfer_items where transfer_id=$1`, [transferId])
    ).rows[0]
    await client.query('commit')

    report.groups.push({
      sourceWh,
      targetWh,
      transfer: tr,
      summary: sum,
      adjusted_items: plan.filter((x) => x.adjusted).length,
      sample: plan.slice(0, 20),
    })
  } catch (e) {
    await client.query('rollback')
    const bulkError = String(e?.message || e)
    if (bulkError.toLowerCase().includes('batch not released or recalled')) {
      const itemwise = await executeItemwise()
      report.groups.push({
        sourceWh,
        targetWh,
        mode: 'itemwise_fallback',
        bulk_error: bulkError,
        summary: {
          success: itemwise.success.length,
          failed: itemwise.failed.length,
          skipped: itemwise.skipped.length,
        },
        success_sample: itemwise.success.slice(0, 20),
        failed_sample: itemwise.failed.slice(0, 20),
      })
    } else {
      report.groups.push({ sourceWh, targetWh, error: bulkError })
    }
  }
}

report.ok = report.groups.every((g) => !g.error && !g.skipped && (g.summary ? g.summary.success > 0 : true))
const outPath = path.join(process.cwd(), 'backups', `transfer_execute_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ ok: report.ok, outPath, groups: report.groups.map((g) => ({ sourceWh: g.sourceWh, targetWh: g.targetWh, transfer_number: g.transfer?.transfer_number || null, status: g.transfer?.status || null, error: g.error || null, skipped: !!g.skipped })) }, null, 2))

await client.end()
