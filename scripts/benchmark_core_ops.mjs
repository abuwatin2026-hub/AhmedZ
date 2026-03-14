import fs from 'node:fs'
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

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

const actor = '25b65f34-ce92-421d-abbd-b53a0bfcf4f6'
const claims = JSON.stringify({ role: 'authenticated', sub: actor }).replace(/'/g, "''")

async function benchReserve() {
  const runs = []
  for (let i = 0; i < 5; i += 1) {
    await client.query('begin')
    try {
      await client.query(`set local "request.jwt.claims"='${claims}'`)
      await client.query(`set local app.allow_ledger_ddl='1'`)
      await client.query(`alter table public.menu_items disable trigger user`)
      await client.query(`alter table public.orders disable trigger user`)
      const w1 = randomUUID()
      const w2 = randomUUID()
      const i1 = randomUUID()
      const i2 = randomUUID()
      const o = randomUUID()
      await client.query(`insert into public.warehouses(id,code,name,type,pricing) values($1,'BR1','BR1','main','{}'::jsonb),($2,'BR2','BR2','main','{}'::jsonb)`, [w1, w2])
      await client.query(`insert into public.menu_items(id,category,unit_type,status,data,cost_price,name,price,base_unit) values($1,'grocery','piece','active','{}'::jsonb,5,'{"ar":"RB1","en":"RB1"}'::jsonb,10,'piece'),($2,'grocery','piece','active','{}'::jsonb,5,'{"ar":"RB2","en":"RB2"}'::jsonb,10,'piece')`, [i1, i2])
      await client.query(`insert into public.stock_management(item_id,warehouse_id,available_quantity,reserved_quantity,unit,low_stock_threshold,avg_cost,last_updated,updated_at,data,created_at,qc_hold_quantity) values($1,$2,20,0,'piece',1,5,now(),now(),'{}'::jsonb,now(),0),($3,$4,20,0,'piece',1,5,now(),now(),'{}'::jsonb,now(),0)`, [i1, w1, i2, w2])
      await client.query(`insert into public.batches(id,item_id,warehouse_id,batch_code,quantity_received,quantity_consumed,unit_cost,data,created_at,updated_at,quantity_transferred,status,cost_per_unit,min_margin_pct,min_selling_price,qc_status) values(gen_random_uuid(),$1,$2,'RB1',20,0,5,'{}'::jsonb,now(),now(),0,'active',5,0,0,'released'),(gen_random_uuid(),$3,$4,'RB2',20,0,5,'{}'::jsonb,now(),now(),0,'active',5,0,0,'released')`, [i1, w1, i2, w2])
      await client.query(`insert into public.orders(id,customer_auth_user_id,warehouse_id,currency,subtotal,total,payment_method,status,data,created_at,updated_at) values($1,$2,$3,'SAR',20,20,'cash','pending',jsonb_build_object('orderSource','in_store'),now(),now())`, [o, actor, w1])
      await client.query(`alter table public.menu_items enable trigger user`)
      await client.query(`alter table public.orders enable trigger user`)
      const t0 = performance.now()
      await client.query(`select public.reserve_stock_for_order($1::jsonb,$2::uuid,$3::uuid)`, [JSON.stringify([{ itemId: i1, quantity: 1, uomQtyInBase: 1, warehouseId: w1 }, { itemId: i2, quantity: 1, uomQtyInBase: 1, warehouseId: w2 }]), o, w1])
      runs.push(performance.now() - t0)
    } catch {
      runs.push(null)
    } finally {
      await client.query('rollback')
    }
  }
  return runs
}

async function benchTransfer() {
  const runs = []
  const errors = []
  for (let i = 0; i < 5; i += 1) {
    await client.query('begin')
    try {
      await client.query(`set local "request.jwt.claims"='${claims}'`)
      await client.query(`set local app.allow_ledger_ddl='1'`)
      await client.query(`alter table public.menu_items disable trigger user`)
      const w1 = randomUUID()
      const w2 = randomUUID()
      const it = randomUUID()
      const tr = randomUUID()
      const tri = randomUUID()
      await client.query(`insert into public.warehouses(id,code,name,type,pricing) values($1,'BT1','BT1','main','{}'::jsonb),($2,'BT2','BT2','main','{}'::jsonb)`, [w1, w2])
      await client.query(`insert into public.menu_items(id,category,unit_type,status,data,cost_price,name,price,base_unit) values($1,'grocery','piece','active','{}'::jsonb,7,'{"ar":"TB","en":"TB"}'::jsonb,10,'piece')`, [it])
      await client.query(`insert into public.stock_management(item_id,warehouse_id,available_quantity,reserved_quantity,unit,low_stock_threshold,avg_cost,last_updated,updated_at,data,created_at,qc_hold_quantity) values($1,$2,100,0,'piece',1,7,now(),now(),'{}'::jsonb,now(),0)`, [it, w1])
      await client.query(`insert into public.batches(id,item_id,warehouse_id,batch_code,quantity_received,quantity_consumed,unit_cost,data,created_at,updated_at,quantity_transferred,status,cost_per_unit,min_margin_pct,min_selling_price,qc_status) values(gen_random_uuid(),$1,$2,'TB',100,0,7,'{}'::jsonb,now(),now(),0,'active',7,0,0,'released')`, [it, w1])
      await client.query(`insert into public.warehouse_transfers(id,from_warehouse_id,to_warehouse_id,transfer_date,status,notes,created_by) values($1,$2,$3,now(),'pending','bench',$4)`, [tr, w1, w2, actor])
      await client.query(`insert into public.warehouse_transfer_items(id,transfer_id,item_id,quantity,transferred_quantity,notes) values($1,$2,$3,15,0,'')`, [tri, tr, it])
      await client.query(`alter table public.menu_items enable trigger user`)
      const t0 = performance.now()
      await client.query(`select public.complete_warehouse_transfer($1::uuid)`, [tr])
      runs.push(performance.now() - t0)
    } catch (e) {
      runs.push(null)
      errors.push(String(e?.message || e))
    } finally {
      await client.query('rollback')
    }
  }
  return { runs, errors }
}

function summarize(runs) {
  const ok = runs.filter((x) => typeof x === 'number')
  if (!ok.length) return { runs_ms: runs, avg_ms: null, min_ms: null, max_ms: null }
  return {
    runs_ms: runs,
    avg_ms: ok.reduce((a, b) => a + b, 0) / ok.length,
    min_ms: Math.min(...ok),
    max_ms: Math.max(...ok),
  }
}

await client.connect()
const reserveRuns = await benchReserve()
const transferRes = await benchTransfer()
let confirmObserved = []
try {
  confirmObserved = (
    await client.query(`
      select query,calls,mean_exec_time,total_exec_time
      from pg_stat_statements
      where query ilike 'select public.confirm_order_delivery(%'
      order by total_exec_time desc
      limit 2
    `)
  ).rows
} catch {}

const report = {
  at: new Date().toISOString(),
  env: 'production',
  benchmarks: {
    reserve_stock_for_order: summarize(reserveRuns),
    complete_warehouse_transfer: { ...summarize(transferRes.runs), errors: transferRes.errors.slice(0, 5) },
    confirm_order_delivery_observed: confirmObserved,
  },
}
fs.writeFileSync('backups/perf_benchmark_after_tuning.json', JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify(report, null, 2))
await client.end()
