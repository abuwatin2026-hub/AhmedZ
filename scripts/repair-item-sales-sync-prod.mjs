import { Client } from 'pg';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = '') => {
  const i = args.indexOf(f);
  if (i === -1) return d;
  const v = args[i + 1];
  return typeof v === 'string' ? v : d;
};

const execute = has('--execute');
const itemId = String(val('--item-id', '')).trim();
const targetAvailableBase = (() => {
  const raw = String(val('--target-available-base', '')).trim();
  if (!raw) return null;
  const x = Number(raw);
  return Number.isFinite(x) && x >= 0 ? x : null;
})();
if (!itemId) throw new Error('Missing --item-id');
const password = String(process.env.DBPW || process.env.SUPABASE_DB_PASSWORD || '').trim();
if (!password) throw new Error('Missing DBPW or SUPABASE_DB_PASSWORD');

const client = new Client({
  host: process.env.DB_HOST || 'aws-1-ap-south-1.pooler.supabase.com',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres.pmhivhtaoydfolseelyc',
  password,
  database: process.env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
});

const n = (v) => {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
};

await client.connect();
try {
  const itemRes = await client.query(
    `select id::text as id, coalesce(name->>'ar', name->>'en', '') as name from public.menu_items where id::text=$1`,
    [itemId],
  );
  if (!itemRes.rows[0]) throw new Error('Item not found');

  const uomRows = await client.query(
    `select uom_id::text as uom_id, qty_in_base::numeric as qty_in_base
     from public.item_uom_units
     where item_id::text=$1 and is_active=true`,
    [itemId],
  );
  const uomFactor = new Map(uomRows.rows.map((r) => [String(r.uom_id), n(r.qty_in_base)]));
  const baseUomId = (uomRows.rows.find((r) => Math.abs(n(r.qty_in_base) - 1) < 1e-9)?.uom_id) || null;

  const orderLines = await client.query(
    `
    with lines as (
      select
        o.id::text as order_id,
        lower(coalesce(o.status,'')) as status,
        o.created_at,
        coalesce(nullif(o.data->>'warehouseId',''), nullif(o.data->>'warehouse_id','')) as warehouse_id_text,
        coalesce(nullif(o.data->>'createdByAdminId',''), nullif(o.data->>'_createdBy','')) as actor_id_text,
        i.value as line
      from public.orders o
      cross join lateral jsonb_array_elements(coalesce(o.data->'items','[]'::jsonb)) i(value)
      where lower(coalesce(o.status,'')) in ('delivered','posted')
    )
    select
      order_id,
      status,
      created_at,
      warehouse_id_text,
      actor_id_text,
      coalesce(nullif(line->>'id',''), nullif(line->>'itemId',''), nullif(line->>'menuItemId','')) as line_item_id,
      coalesce((line->>'quantity')::numeric,0) as qty,
      coalesce(
        nullif(line->>'uomId',''),
        nullif(line->>'uom_id','')
      ) as line_uom_id,
      coalesce(
        nullif((line->>'uomQtyInBase')::numeric, null),
        nullif((line->>'uom_qty_in_base')::numeric, null),
        0
      ) as line_qty_in_base
    from lines
    `,
  );

  const expectedByOrder = new Map();
  for (const r of orderLines.rows) {
    if (String(r.line_item_id || '').toLowerCase() !== itemId.toLowerCase()) continue;
    const q = n(r.qty);
    if (q <= 0) continue;
    let factor = n(r.line_qty_in_base);
    if (factor <= 0 && r.line_uom_id) factor = n(uomFactor.get(String(r.line_uom_id)) || 0);
    if (factor <= 0) factor = 1;
    const qtyBase = q * factor;
    const key = String(r.order_id);
    const cur = expectedByOrder.get(key) || { expected_qty_base: 0, warehouse_id_text: r.warehouse_id_text || null, actor_id_text: r.actor_id_text || null, created_at: r.created_at };
    cur.expected_qty_base += qtyBase;
    if (!cur.warehouse_id_text && r.warehouse_id_text) cur.warehouse_id_text = r.warehouse_id_text;
    expectedByOrder.set(key, cur);
  }

  const saleRows = await client.query(
    `
    select reference_id::text as order_id, sum(coalesce(qty_base,quantity,0))::numeric as sold_qty
    from public.inventory_movements
    where movement_type='sale_out'
      and reference_table='orders'
      and item_id::text=$1
    group by reference_id
    `,
    [itemId],
  );
  const soldByOrder = new Map(saleRows.rows.map((r) => [String(r.order_id), n(r.sold_qty)]));

  const stockInfo = await client.query(
    `
    select warehouse_id::text as warehouse_id, coalesce(available_quantity,0)::numeric as available, coalesce(avg_cost,0)::numeric as avg_cost
    from public.stock_management
    where item_id::text=$1
    order by available_quantity desc
    `,
    [itemId],
  );
  const defaultWh = stockInfo.rows[0]?.warehouse_id || null;

  const fixes = [];
  for (const [orderId, v] of expectedByOrder.entries()) {
    const sold = n(soldByOrder.get(orderId) || 0);
    const missing = Math.max(0, n(v.expected_qty_base) - sold);
    if (missing > 0.000001) {
      fixes.push({
        order_id: orderId,
        warehouse_id: v.warehouse_id_text || defaultWh,
        actor_id: v.actor_id_text || null,
        expected_qty_base: n(v.expected_qty_base),
        sold_qty_base: sold,
        missing_qty_base: missing,
      });
    }
  }

  const returnRows = await client.query(
    `
    with sr_items as (
      select
        sr.id::text as return_id,
        coalesce(nullif(sr.order_id::text,''), '') as order_id,
        coalesce(nullif(sr.items::text,''), '[]')::jsonb as items_json,
        sr.created_at
      from public.sales_returns sr
    ),
    lines as (
      select
        s.return_id,
        s.order_id,
        s.created_at,
        i.value as line
      from sr_items s
      cross join lateral jsonb_array_elements(coalesce(s.items_json, '[]'::jsonb)) i(value)
    )
    select
      return_id,
      order_id,
      created_at,
      coalesce(nullif(line->>'id',''), nullif(line->>'itemId',''), nullif(line->>'menuItemId','')) as line_item_id,
      coalesce((line->>'quantity')::numeric,0) as qty,
      coalesce(nullif(line->>'uomId',''), nullif(line->>'uom_id','')) as line_uom_id,
      coalesce(nullif((line->>'uomQtyInBase')::numeric,null), nullif((line->>'uom_qty_in_base')::numeric,null), 0) as line_qty_in_base
    from lines
    `,
  );

  const expectedReturnByDoc = new Map();
  for (const r of returnRows.rows) {
    if (String(r.line_item_id || '').toLowerCase() !== itemId.toLowerCase()) continue;
    const q = n(r.qty);
    if (q <= 0) continue;
    let factor = n(r.line_qty_in_base);
    if (factor <= 0 && r.line_uom_id) factor = n(uomFactor.get(String(r.line_uom_id)) || 0);
    if (factor <= 0) factor = 1;
    const qtyBase = q * factor;
    const key = String(r.return_id);
    expectedReturnByDoc.set(key, (expectedReturnByDoc.get(key) || 0) + qtyBase);
  }

  const retMovRows = await client.query(
    `
    select reference_id::text as return_id, sum(coalesce(qty_base,quantity,0))::numeric as return_qty
    from public.inventory_movements
    where movement_type in ('return_in','sale_return_in','sales_return_in')
      and reference_table='sales_returns'
      and item_id::text=$1
    group by reference_id
    `,
    [itemId],
  );
  const returnByDoc = new Map(retMovRows.rows.map((r) => [String(r.return_id), n(r.return_qty)]));

  const returnFixes = [];
  for (const [returnId, expected] of expectedReturnByDoc.entries()) {
    const current = n(returnByDoc.get(returnId) || 0);
    const missing = Math.max(0, expected - current);
    if (missing > 0.000001) returnFixes.push({ return_id: returnId, expected_qty_base: expected, current_qty_base: current, missing_qty_base: missing });
  }

  const beforeStock = await client.query(`select sum(coalesce(available_quantity,0))::numeric as available from public.stock_management where item_id::text=$1`, [itemId]);

  console.log(JSON.stringify({
    phase: 'plan',
    item: itemRes.rows[0],
    baseUomId,
    expectedSaleOrders: expectedByOrder.size,
    fixesCount: fixes.length,
    fixesSample: fixes.slice(0, 20),
    returnDocs: expectedReturnByDoc.size,
    returnFixesCount: returnFixes.length,
    returnFixesSample: returnFixes.slice(0, 20),
    beforeAvailable: beforeStock.rows[0]?.available || 0,
    targetAvailableBase,
    execute,
  }, null, 2));

  if (!execute) process.exit(0);

  await client.query('begin');
  await client.query(`select set_config('app.allow_ledger_ddl','1', true)`);

  let insertedSaleOut = 0;
  let insertedReturnIn = 0;
  for (const f of fixes) {
    const wh = f.warehouse_id || defaultWh;
    if (!wh) continue;
    const avgRes = await client.query(
      `select coalesce(avg_cost,0)::numeric as avg_cost from public.stock_management where item_id::text=$1 and warehouse_id::text=$2 limit 1`,
      [itemId, wh],
    );
    const unitCost = n(avgRes.rows[0]?.avg_cost || 0);
    let qtyNeed = n(f.missing_qty_base);
    const batches = await client.query(
      `
      select
        b.id::text as batch_id,
        greatest(coalesce(b.quantity_received,0)-coalesce(b.quantity_consumed,0)-coalesce(b.quantity_transferred,0),0)::numeric as remaining,
        coalesce(b.unit_cost,$1)::numeric as unit_cost
      from public.batches b
      where b.item_id::text=$2
        and b.warehouse_id::text=$3
        and coalesce(b.status,'active')='active'
        and (b.expiry_date is null or b.expiry_date >= current_date)
      order by coalesce(b.expiry_date, '2999-12-31'::date) asc, b.created_at asc
      `,
      [unitCost, itemId, wh],
    );
    for (const b of batches.rows) {
      if (qtyNeed <= 0.000001) break;
      const remaining = n(b.remaining);
      if (remaining <= 0.000001) continue;
      const alloc = Math.min(qtyNeed, remaining);
      const uCost = n(b.unit_cost || unitCost);
      const total = alloc * uCost;
      const upd = await client.query(
        `update public.batches
         set quantity_consumed = coalesce(quantity_consumed,0) + $1
         where id::text=$2
         returning quantity_received, quantity_consumed`,
        [alloc, b.batch_id],
      );
      const qr = n(upd.rows[0]?.quantity_received);
      const qc = n(upd.rows[0]?.quantity_consumed);
      if (qc - qr > 0.000001) throw new Error(`Batch over-consumed ${b.batch_id}`);
      const ins = await client.query(
        `
        insert into public.inventory_movements(
          item_id, movement_type, quantity, qty_base, unit_cost, total_cost,
          reference_table, reference_id, occurred_at, created_by, warehouse_id, batch_id, data
        ) values (
          $1::uuid, 'sale_out', $2, $2, $3, $4,
          'orders', $5, now(), nullif($6,'')::uuid, $7::uuid, $8::uuid, jsonb_build_object('repair', true, 'reason', 'missing_sale_out_sync')
        ) returning id
        `,
        [itemId, alloc, uCost, total, f.order_id, String(f.actor_id || ''), wh, b.batch_id],
      );
      const movementId = ins.rows[0]?.id;
      if (movementId) {
        insertedSaleOut += 1;
        try { await client.query(`select public.post_inventory_movement($1::uuid)`, [movementId]); } catch {}
        await client.query(
          `insert into public.order_item_cogs(order_id, item_id, quantity, unit_cost, total_cost, created_at)
           values ($1::uuid, $2::text, $3, $4, $5, now())
           on conflict do nothing`,
          [f.order_id, itemId, alloc, uCost, total],
        );
      }
      qtyNeed -= alloc;
    }
    if (qtyNeed > 0.000001) {
      throw new Error(`INSUFFICIENT_BATCH_STOCK_FOR_REPAIR order=${f.order_id} missing=${qtyNeed}`);
    }
    await client.query(
      `update public.stock_management sm
       set reserved_quantity = coalesce((
             select sum(r.quantity)
             from public.order_item_reservations r
             where r.item_id = $1
               and r.warehouse_id = $2::uuid
           ), 0),
           available_quantity = coalesce((
             select sum(greatest(coalesce(b.quantity_received,0)-coalesce(b.quantity_consumed,0)-coalesce(b.quantity_transferred,0),0))
             from public.batches b
             where b.item_id::text=$1
               and b.warehouse_id::text=$2
               and coalesce(b.status,'active')='active'
               and (b.expiry_date is null or b.expiry_date >= current_date)
           ), 0),
           last_updated = now(),
           updated_at = now()
       where sm.item_id::text=$1 and sm.warehouse_id::text=$2`,
      [itemId, wh],
    );
  }

  for (const rf of returnFixes) {
    const qty = n(rf.missing_qty_base);
    if (qty <= 0) continue;
    const wh = defaultWh;
    if (!wh) continue;
    const avgRes = await client.query(
      `select coalesce(avg_cost,0)::numeric as avg_cost from public.stock_management where item_id::text=$1 and warehouse_id::text=$2 limit 1`,
      [itemId, wh],
    );
    const unitCost = n(avgRes.rows[0]?.avg_cost || 0);
    const total = qty * unitCost;
    const ins = await client.query(
      `
      insert into public.inventory_movements(
        item_id, movement_type, quantity, qty_base, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, warehouse_id, data
      ) values (
        $1::uuid, 'return_in', $2, $2, $3, $4,
        'sales_returns', $5, now(), null, $6::uuid, jsonb_build_object('repair', true, 'reason', 'missing_return_in_sync')
      ) returning id
      `,
      [itemId, qty, unitCost, total, rf.return_id, wh],
    );
    const movementId = ins.rows[0]?.id;
    if (movementId) {
      insertedReturnIn += 1;
      try { await client.query(`select public.post_inventory_movement($1::uuid)`, [movementId]); } catch {}
      await client.query(
        `update public.stock_management
         set available_quantity = coalesce(available_quantity,0) + $1,
             last_updated = now(),
             updated_at = now()
         where item_id::text=$2 and warehouse_id::text=$3`,
        [qty, itemId, wh],
      );
    }
  }

  if (targetAvailableBase != null) {
    const wh = defaultWh;
    if (wh) {
      const curRes = await client.query(
        `select coalesce(sum(available_quantity),0)::numeric as available
         from public.stock_management
         where item_id::text=$1 and warehouse_id::text=$2`,
        [itemId, wh],
      );
      let current = n(curRes.rows[0]?.available);
      let diff = current - n(targetAvailableBase);
      if (diff > 0.000001) {
        const batches = await client.query(
          `
          select
            b.id::text as batch_id,
            coalesce(b.unit_cost,0)::numeric as unit_cost,
            greatest(coalesce(b.quantity_received,0)-coalesce(b.quantity_consumed,0)-coalesce(b.quantity_transferred,0),0)::numeric as remaining
          from public.batches b
          where b.item_id::text=$1
            and b.warehouse_id::text=$2
            and coalesce(b.status,'active')='active'
          order by b.created_at desc
          `,
          [itemId, wh],
        );
        for (const b of batches.rows) {
          if (diff <= 0.000001) break;
          const rem = n(b.remaining);
          if (rem <= 0.000001) continue;
          const alloc = Math.min(rem, diff);
          await client.query(
            `update public.batches set quantity_consumed = coalesce(quantity_consumed,0) + $1 where id::text=$2`,
            [alloc, b.batch_id],
          );
          diff -= alloc;
        }
        if (diff > 0.000001) {
          throw new Error(`TARGET_AVAILABLE_ADJUST_FAILED remaining=${diff}`);
        }
        await client.query(
          `update public.stock_management sm
           set available_quantity = coalesce((
                 select sum(greatest(coalesce(b.quantity_received,0)-coalesce(b.quantity_consumed,0)-coalesce(b.quantity_transferred,0),0))
                 from public.batches b
                 where b.item_id::text=$1 and b.warehouse_id::text=$2 and coalesce(b.status,'active')='active'
               ),0),
               last_updated = now(),
               updated_at = now()
           where sm.item_id::text=$1 and sm.warehouse_id::text=$2`,
          [itemId, wh],
        );
      }
    }
  }

  if (baseUomId) {
    await client.query(
      `update public.stock_management
       set unit=$1, updated_at=now(), last_updated=now()
       where item_id::text=$2`,
      [baseUomId, itemId],
    );
  }

  const afterStock = await client.query(`select sum(coalesce(available_quantity,0))::numeric as available from public.stock_management where item_id::text=$1`, [itemId]);

  await client.query('commit');

  console.log(JSON.stringify({
    phase: 'done',
    insertedSaleOut,
    insertedReturnIn,
    beforeAvailable: beforeStock.rows[0]?.available || 0,
    afterAvailable: afterStock.rows[0]?.available || 0,
  }, null, 2));
} catch (e) {
  try { await client.query('rollback'); } catch {}
  throw e;
} finally {
  await client.end();
}
