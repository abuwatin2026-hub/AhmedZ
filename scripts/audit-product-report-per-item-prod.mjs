import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const round = (n, d = 6) => {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return 0;
  return Number(x.toFixed(d));
};

const password = String(process.env.DBPW || process.env.SUPABASE_DB_PASSWORD || '').trim();
if (!password) {
  throw new Error('Missing DBPW or SUPABASE_DB_PASSWORD');
}

const supabaseUrl = String(process.env.AZTA_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const supabaseKey = String(process.env.AZTA_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const ownerEmail = String(process.env.ADMIN_EMAIL || process.env.AZTA_SMOKE_OWNER_EMAIL || 'owner@azta.com').trim();
const ownerPassword = String(process.env.ADMIN_PASSWORD || process.env.AZTA_SMOKE_OWNER_PASSWORD || '').trim();
if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing AZTA_SUPABASE_URL/VITE_SUPABASE_URL or AZTA_SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY');
}
if (!ownerEmail || !ownerPassword) {
  throw new Error('Missing ADMIN_EMAIL/ADMIN_PASSWORD');
}

const client = new Client({
  host: process.env.DB_HOST || 'aws-1-ap-south-1.pooler.supabase.com',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres.pmhivhtaoydfolseelyc',
  password,
  database: process.env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
});

const start = String(process.env.REPORT_START || '2000-01-01T00:00:00Z');
const end = String(process.env.REPORT_END || '2100-01-01T23:59:59Z');
const eps = Number(process.env.REPORT_EPS || '0.01');

const supabase = createClient(supabaseUrl, supabaseKey);
const auth = await supabase.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
if (auth.error) {
  throw new Error(`Auth failed: ${auth.error.message}`);
}

const { data: v10Data, error: v10Error } = await supabase.rpc('get_product_sales_report_v10', {
  p_start_date: start,
  p_end_date: end,
  p_zone_id: null,
  p_invoice_only: false,
});
if (v10Error) {
  throw new Error(`get_product_sales_report_v10 failed: ${v10Error.message}`);
}

const v10Rows = Array.isArray(v10Data) ? v10Data : [];
const itemIds = v10Rows.map((r) => String(r?.item_id || '')).filter(Boolean);

await client.connect();
try {
  if (itemIds.length === 0) {
    throw new Error('No rows returned by get_product_sales_report_v10');
  }

  const movementQuery = `
    with mv_sale as (
      select
        im.item_id::text as item_id,
        sum(coalesce(im.quantity, 0)) as sale_qty,
        sum(coalesce(nullif(im.total_cost, 0), im.quantity * coalesce(nullif(im.unit_cost, 0), 0), 0)) as sale_cost
      from public.inventory_movements im
      join public.orders o on o.id::text = im.reference_id
      where im.reference_table = 'orders'
        and im.movement_type = 'sale_out'
        and im.occurred_at >= $1::timestamptz
        and im.occurred_at <= $2::timestamptz
        and o.status = 'delivered'
        and nullif(trim(coalesce(o.data->>'voidedAt', '')), '') is null
      and im.item_id::text = any($3::text[])
      group by im.item_id::text
    ),
    mv_ret as (
      select
        im.item_id::text as item_id,
        sum(coalesce(im.quantity, 0)) as ret_qty,
        sum(coalesce(nullif(im.total_cost, 0), im.quantity * coalesce(nullif(im.unit_cost, 0), 0), 0)) as ret_cost
      from public.inventory_movements im
      join public.sales_returns sr on sr.id::text = im.reference_id
      where im.reference_table = 'sales_returns'
        and im.movement_type = 'return_in'
        and im.occurred_at >= $1::timestamptz
        and im.occurred_at <= $2::timestamptz
        and sr.status = 'completed'
      and im.item_id::text = any($3::text[])
      group by im.item_id::text
    )
    select
      coalesce(s.item_id, r.item_id) as item_id,
      coalesce(s.sale_qty, 0) - coalesce(r.ret_qty, 0) as net_qty,
      coalesce(s.sale_cost, 0) - coalesce(r.ret_cost, 0) as net_cost
    from mv_sale s
    full outer join mv_ret r on r.item_id = s.item_id
  `;

  const stockQuery = `
    select
      sm.item_id::text as item_id,
      sum(coalesce(sm.available_quantity, 0)) as current_stock_agg,
      sum(coalesce(sm.reserved_quantity, 0)) as reserved_stock_agg,
      case
        when sum(coalesce(sm.available_quantity, 0) + coalesce(sm.reserved_quantity, 0)) > 0
          then sum((coalesce(sm.available_quantity, 0) + coalesce(sm.reserved_quantity, 0)) * coalesce(sm.avg_cost, 0))
               / sum(coalesce(sm.available_quantity, 0) + coalesce(sm.reserved_quantity, 0))
        else 0
      end as current_cost_price_agg
    from public.stock_management sm
    where sm.item_id::text = any($1::text[])
    group by sm.item_id::text
  `;

  const unitQuery = `
    select
      mi.id::text as item_id,
      coalesce(mi.unit_type, '') as menu_unit_type
    from public.menu_items mi
    where mi.id::text = any($1::text[])
  `;

  const { rows: mvRows } = await client.query(movementQuery, [start, end, itemIds]);
  const { rows: smRows } = await client.query(stockQuery, [itemIds]);
  const { rows: unitRows } = await client.query(unitQuery, [itemIds]);

  const mvMap = new Map((mvRows || []).map((r) => [String(r.item_id), r]));
  const smMap = new Map((smRows || []).map((r) => [String(r.item_id), r]));
  const unitMap = new Map((unitRows || []).map((r) => [String(r.item_id), r]));

  const products = v10Rows.map((x) => {
    const itemId = String(x?.item_id || '');
    const mv = mvMap.get(itemId) || {};
    const sm = smMap.get(itemId) || {};
    const um = unitMap.get(itemId) || {};
    const qty = Number(x?.quantity_sold || 0);
    const sales = Number(x?.total_sales || 0);
    const cost = Number(x?.total_cost || 0);
    const profit = Number(x?.total_profit || 0);
    const avgInventory = Number(x?.avg_inventory || 0);
    const currentStock = Number(x?.current_stock || 0);
    const margin = sales > 0 ? (profit / sales) * 100 : 0;
    const turnover = avgInventory > 0 ? qty / avgInventory : 0;
    const expectedProfit = sales - cost;

    const qtyDiff = qty - Number(mv.net_qty || 0);
    const costDiff = cost - Number(mv.net_cost || 0);
    const stockDiff = currentStock - Number(sm.current_stock_agg || 0);
    const reservedDiff = Number(x?.reserved_stock || 0) - Number(sm.reserved_stock_agg || 0);
    const costPriceDiff = Number(x?.current_cost_price || 0) - Number(sm.current_cost_price_agg || 0);

    return {
      item_id: itemId,
      item_name: String(x?.item_name?.ar || x?.item_name?.en || itemId),
      columns: {
        quantity_sold: round(qty, 6),
        unit_type: String(x?.unit_type || ''),
        net_sales: round(sales, 6),
        net_cost: round(cost, 6),
        net_profit: round(profit, 6),
        profit_margin_percent: round(margin, 4),
        turnover_rate: round(turnover, 6),
      },
      checks: {
        quantity_vs_movements_ok: Math.abs(qtyDiff) <= eps,
        quantity_vs_movements_diff: round(qtyDiff, 6),
        unit_matches_menu_item_ok: String(x?.unit_type || '') === String(um.menu_unit_type || ''),
        net_cost_vs_movements_ok: Math.abs(costDiff) <= eps,
        net_cost_vs_movements_diff: round(costDiff, 6),
        net_profit_equation_ok: Math.abs(profit - expectedProfit) <= eps,
        net_profit_equation_diff: round(profit - expectedProfit, 6),
        net_sales_non_negative_ok: sales >= -eps,
        net_cost_non_negative_ok: cost >= -eps,
        margin_formula_ok: Number.isFinite(margin),
        turnover_formula_ok: Number.isFinite(turnover),
        stock_vs_agg_ok: Math.abs(stockDiff) <= eps,
        stock_vs_agg_diff: round(stockDiff, 6),
        reserved_vs_agg_ok: Math.abs(reservedDiff) <= eps,
        reserved_vs_agg_diff: round(reservedDiff, 6),
        cost_price_vs_agg_ok: Math.abs(costPriceDiff) <= eps,
        cost_price_vs_agg_diff: round(costPriceDiff, 6),
      },
    };
  });

  const summary = {
    total_products: products.length,
    pass_quantity_vs_movements: products.filter((p) => p.checks.quantity_vs_movements_ok).length,
    pass_cost_vs_movements: products.filter((p) => p.checks.net_cost_vs_movements_ok).length,
    pass_profit_equation: products.filter((p) => p.checks.net_profit_equation_ok).length,
    pass_unit_match: products.filter((p) => p.checks.unit_matches_menu_item_ok).length,
    pass_stock_match: products.filter((p) => p.checks.stock_vs_agg_ok && p.checks.reserved_vs_agg_ok && p.checks.cost_price_vs_agg_ok).length,
    negative_sales_rows: products.filter((p) => !p.checks.net_sales_non_negative_ok).length,
    negative_cost_rows: products.filter((p) => !p.checks.net_cost_non_negative_ok).length,
  };

  const top_quantity_variances = [...products]
    .sort((a, b) => Math.abs(b.checks.quantity_vs_movements_diff) - Math.abs(a.checks.quantity_vs_movements_diff))
    .slice(0, 10)
    .map((p) => ({ item_id: p.item_id, item_name: p.item_name, diff: p.checks.quantity_vs_movements_diff }));

  const top_cost_variances = [...products]
    .sort((a, b) => Math.abs(b.checks.net_cost_vs_movements_diff) - Math.abs(a.checks.net_cost_vs_movements_diff))
    .slice(0, 10)
    .map((p) => ({ item_id: p.item_id, item_name: p.item_name, diff: p.checks.net_cost_vs_movements_diff }));

  const report = {
    generated_at: new Date().toISOString(),
    period: { start, end, zone: null, invoice_only: false },
    auth: { email: ownerEmail, ok: true },
    summary,
    top_quantity_variances,
    top_cost_variances,
    products,
  };

  fs.mkdirSync(path.join(process.cwd(), 'backups'), { recursive: true });
  const outPath = path.join(process.cwd(), 'backups', 'product_report_per_item_audit.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(outPath);
  console.log(JSON.stringify({ summary, top_quantity_variances: top_quantity_variances.slice(0, 5), top_cost_variances: top_cost_variances.slice(0, 5) }, null, 2));
} finally {
  await client.end();
}
