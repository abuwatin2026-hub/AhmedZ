import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const password = String(process.env.DBPW || '').trim();
if (!password) throw new Error('Missing DBPW');

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.pmhivhtaoydfolseelyc',
  password,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const allowed = [
  2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 18, 20, 24, 30, 32, 36, 40, 48, 50, 60, 72, 80, 90, 96, 100, 120, 144, 200, 240, 360, 500, 1000,
];

function nearestAllowed(x) {
  let best = null;
  let bestDist = Infinity;
  for (const k of allowed) {
    const d = Math.abs(x - k);
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  }
  return best;
}

function relErr(a, b) {
  const denom = Math.max(1e-9, Math.abs(b));
  return Math.abs(a - b) / denom;
}

await client.connect();
try {
  const base = await client.query(`
    with ord as (
      select
        coalesce(it->>'id','') as item_id,
        coalesce(sum(coalesce((it->>'quantity')::numeric,0)),0)::numeric as order_qty,
        coalesce(sum(coalesce((it->>'total')::numeric,coalesce((it->>'price')::numeric,0)*coalesce((it->>'quantity')::numeric,0))),0)::numeric as order_sales
      from public.orders o
      cross join lateral jsonb_array_elements(coalesce(o.data->'items','[]'::jsonb)) it
      where o.status='delivered'
        and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
      group by 1
    ),
    mv as (
      select
        item_id::text as item_id,
        coalesce(sum(case when movement_type='sale_out' then coalesce(quantity,0) else 0 end),0)::numeric as sale_out_qty,
        coalesce(sum(case when movement_type='sale_out' then coalesce(total_cost,0) else 0 end),0)::numeric as sale_out_cost,
        coalesce(sum(case when movement_type in ('return_in','sales_return_in') then coalesce(quantity,0) else 0 end),0)::numeric as return_qty
      from public.inventory_movements
      group by 1
    )
    select
      mi.id::text as item_id,
      coalesce(mi.name->>'ar', mi.name->>'en', '') as item_name,
      mi.unit_type,
      coalesce(ord.order_qty,0)::numeric as order_qty,
      coalesce(ord.order_sales,0)::numeric as order_sales,
      coalesce(mv.sale_out_qty,0)::numeric as sale_out_qty,
      coalesce(mv.sale_out_cost,0)::numeric as sale_out_cost,
      coalesce(mv.return_qty,0)::numeric as return_qty
    from public.menu_items mi
    left join ord on ord.item_id = mi.id::text
    left join mv on mv.item_id = mi.id::text
    where coalesce(ord.order_sales,0) > 0
       or coalesce(mv.sale_out_cost,0) > 0
  `);

  const existing = await client.query(`select item_id, qty_factor, active from public.product_report_legacy_qty_factors`);
  const existingMap = new Map(existing.rows.map((r) => [String(r.item_id), { qty_factor: n(r.qty_factor), active: !!r.active }]));

  const suggestions = [];
  for (const r of base.rows) {
    const itemId = String(r.item_id);
    const orderQty = n(r.order_qty);
    const orderSales = n(r.order_sales);
    const mvQty = n(r.sale_out_qty);
    const mvCost = n(r.sale_out_cost);
    if (orderSales <= 0 || orderQty <= 0 || mvQty <= 0) continue;

    const oldMargin = orderSales > 0 ? ((orderSales - mvCost) / orderSales) * 100 : 0;

    const qtyRatio = mvQty / Math.max(1e-9, orderQty);
    const qtyFactor = qtyRatio >= 1.5 ? nearestAllowed(qtyRatio) : null;

    let suggested = null;
    if (qtyFactor && qtyFactor > 1 && relErr(mvQty, orderQty * qtyFactor) <= 0.07) {
      const newSales = orderSales * qtyFactor;
      const newMargin = newSales > 0 ? ((newSales - mvCost) / newSales) * 100 : 0;
      const looksBad = oldMargin < -20 || oldMargin > 150;
      const improves = Math.abs(newMargin) < Math.abs(oldMargin) || (oldMargin < -20 && newMargin > -20);
      if (looksBad && improves) {
        suggested = { apply_to_qty: true, qty_factor: qtyFactor, sales_factor: qtyFactor, newSales, newMargin, kind: 'qty+sales' };
      }
    }

    if (!suggested) {
      const costRatio = mvCost / Math.max(1e-9, orderSales);
      const salesFactor = costRatio >= 1.5 ? nearestAllowed(costRatio) : null;
      const qtyLooksSame = relErr(mvQty, orderQty) <= 0.15;
      if (salesFactor && salesFactor > 1 && qtyLooksSame) {
        const newSales = orderSales * salesFactor;
        const newMargin = newSales > 0 ? ((newSales - mvCost) / newSales) * 100 : 0;
        const looksBad = oldMargin < -20 || oldMargin > 150;
        const improves = Math.abs(newMargin) < Math.abs(oldMargin) || (oldMargin < -20 && newMargin > -20);
        if (looksBad && improves) {
          suggested = { apply_to_qty: false, qty_factor: 1, sales_factor: salesFactor, newSales, newMargin, kind: 'sales-only' };
        }
      }
    }

    if (!suggested) continue;

    const ex = existingMap.get(itemId);
    if (ex && ex.active && Math.abs(ex.qty_factor - suggested.qty_factor) < 0.000001) continue;

    suggestions.push({
      item_id: itemId,
      item_name: String(r.item_name || ''),
      unit_type: String(r.unit_type || ''),
      order_qty: orderQty,
      sale_out_qty: mvQty,
      sale_out_cost: mvCost,
      order_sales: orderSales,
      qty_ratio: qtyRatio,
      suggested_qty_factor: suggested.qty_factor,
      suggested_sales_factor: suggested.sales_factor,
      apply_to_qty: suggested.apply_to_qty,
      kind: suggested.kind,
      old_margin_pct: oldMargin,
      new_margin_pct: suggested.newMargin,
      old_sales: orderSales,
      new_sales: suggested.newSales,
      existing_factor: ex ? ex.qty_factor : null,
      existing_active: ex ? ex.active : null,
    });
  }

  suggestions.sort((a, b) => Math.abs(b.old_margin_pct) - Math.abs(a.old_margin_pct));

  const out = {
    generated_at: new Date().toISOString(),
    total_items_scanned: base.rows.length,
    suggestions_count: suggestions.length,
    suggestions: suggestions.slice(0, 200),
  };

  const outPath = path.join(process.cwd(), 'backups', 'legacy_factor_suggestions_prod.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(outPath);
  console.log(JSON.stringify({ suggestions_count: out.suggestions_count, top: out.suggestions.slice(0, 20) }, null, 2));
} finally {
  await client.end();
}
