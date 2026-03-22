import { Client } from 'pg';

const args = process.argv.slice(2);
const val = (flag, fallback = '') => {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return typeof v === 'string' ? v : fallback;
};

const itemQuery = String(val('--item-query', 'شراب سفري منوع')).trim();
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

await client.connect();
try {
  const safeQuery = async (sql, params = []) => {
    try {
      return await client.query(sql, params);
    } catch {
      return { rows: [] };
    }
  };

  const itemRes = await client.query(
    `
    with names as (
      select
        mi.id,
        trim(coalesce(
          mi.name->>'ar',
          mi.name->>'en',
          ''
        )) as item_name,
        mi.status
      from public.menu_items mi
    )
    select *
    from names
    where item_name ilike ('%' || $1 || '%')
    order by
      case when item_name ilike ($1 || '%') then 0 else 1 end,
      length(item_name) asc
    limit 5
    `,
    [itemQuery],
  );

  if (!itemRes.rows.length) {
    console.log(JSON.stringify({ ok: false, message: 'item_not_found', itemQuery }, null, 2));
    process.exit(0);
  }

  const item = itemRes.rows[0];
  const itemId = item.id;

  const stockRes = await safeQuery(
    `
    select
      sm.item_id::text as item_id,
      sum(coalesce(sm.available_quantity,0))::numeric as available_qty,
      sum(coalesce(sm.reserved_quantity,0))::numeric as reserved_qty,
      avg(nullif(sm.avg_cost,0))::numeric as avg_cost,
      jsonb_agg(
        jsonb_build_object(
          'warehouse_id', sm.warehouse_id::text,
          'available', coalesce(sm.available_quantity,0),
          'reserved', coalesce(sm.reserved_quantity,0),
          'avg_cost', sm.avg_cost
        )
        order by sm.warehouse_id
      ) filter (where sm.item_id is not null) as by_warehouse
    from public.stock_management sm
    where sm.item_id = $1::uuid
    group by sm.item_id
    `,
    [itemId],
  );

  const batchesRes = await safeQuery(
    `
    select
      b.id::text as batch_id,
      coalesce(b.batch_number, right(b.id::text, 8)) as batch_code,
      coalesce(b.quantity,0)::numeric as qty_total,
      coalesce(b.available_quantity,0)::numeric as qty_available,
      coalesce(b.unit_cost,0)::numeric as unit_cost,
      coalesce(b.total_cost,0)::numeric as total_cost,
      b.created_at
    from public.batches b
    where b.item_id = $1::uuid
    order by b.created_at asc
    `,
    [itemId],
  );

  const movSummaryRes = await safeQuery(
    `
    select
      coalesce(im.movement_type,'unknown') as movement_type,
      count(*)::int as moves,
      sum(
        case
          when im.qty_base is not null then coalesce(im.qty_base,0)
          else coalesce(im.quantity,0)
        end
      )::numeric as qty_sum,
      sum(coalesce(im.total_cost,0))::numeric as cost_sum
    from public.inventory_movements im
    where im.item_id = $1::uuid
    group by 1
    order by 1
    `,
    [itemId],
  );

  const soldReturnedRes = await safeQuery(
    `
    with im as (
      select
        lower(coalesce(movement_type,'')) as mt,
        lower(coalesce(reference_table,'')) as rt,
        case when qty_base is not null then coalesce(qty_base,0) else coalesce(quantity,0) end as qty
      from public.inventory_movements
      where item_id = $1::uuid
    )
    select jsonb_build_object(
      'purchased_qty', coalesce(sum(case when mt like '%purchase%' then qty else 0 end),0),
      'sold_qty', coalesce(sum(case when mt in ('sale_out','sold_out','sales_out') or (mt like '%sale%' and mt like '%out%') then abs(qty) else 0 end),0),
      'sales_return_qty', coalesce(sum(case when mt in ('sale_return_in','sales_return_in') or rt='sales_returns' then qty else 0 end),0),
      'purchase_return_qty', coalesce(sum(case when mt in ('purchase_return_out','purchase_return') then abs(qty) else 0 end),0),
      'adjustment_plus_qty', coalesce(sum(case when mt like '%adjust%' and qty > 0 then qty else 0 end),0),
      'adjustment_minus_qty', coalesce(sum(case when mt like '%adjust%' and qty < 0 then abs(qty) else 0 end),0)
    ) as payload
    from im
    `,
    [itemId],
  );

  const salesOrdersRes = await safeQuery(
    `
    with lines as (
      select
        o.id::text as order_id,
        o.invoice_number,
        lower(coalesce(o.status,'')) as status,
        o.created_at,
        i.value as line
      from public.orders o
      cross join lateral jsonb_array_elements(coalesce(o.data->'items','[]'::jsonb)) as i(value)
    ),
    normalized as (
      select
        order_id, invoice_number, status, created_at,
        coalesce(
          nullif(line->>'id',''),
          nullif(line->>'itemId',''),
          nullif(line->>'menuItemId','')
        ) as item_id_text,
        coalesce((line->>'quantity')::numeric, 0) as qty
      from lines
    )
    select
      count(distinct order_id)::int as orders_count,
      sum(qty)::numeric as sold_qty_from_orders
    from normalized
    where item_id_text = $1::text
      and status in ('delivered','posted')
    `,
    [itemId],
  );

  const returnsRes = await safeQuery(
    `
    select
      count(*)::int as returns_count,
      coalesce(sum(coalesce(ri.quantity,0)),0)::numeric as returned_qty
    from public.sales_return_items ri
    where ri.item_id = $1::uuid
    `,
    [itemId],
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        itemQuery,
        matchedItems: itemRes.rows,
        selectedItem: item,
        stock: stockRes.rows[0] || { available_qty: 0, reserved_qty: 0, avg_cost: null, by_warehouse: [] },
        batches: batchesRes.rows,
        movementSummary: movSummaryRes.rows,
        movementKpis: soldReturnedRes.rows[0]?.payload || {},
        salesFromOrders: salesOrdersRes.rows[0] || { orders_count: 0, sold_qty_from_orders: 0 },
        returnsFromSalesReturnItems: returnsRes.rows[0] || { returns_count: 0, returned_qty: 0 },
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
