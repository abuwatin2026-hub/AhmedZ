import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = String(process.env.AZTA_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const supabaseKey = String(process.env.AZTA_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const ownerEmail = String(process.env.ADMIN_EMAIL || process.env.AZTA_SMOKE_OWNER_EMAIL || '').trim();
const ownerPassword = String(process.env.ADMIN_PASSWORD || process.env.AZTA_SMOKE_OWNER_PASSWORD || '').trim();
const password = String(process.env.DBPW || process.env.SUPABASE_DB_PASSWORD || '').trim();

if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase URL/key');
if (!ownerEmail || !ownerPassword) throw new Error('Missing admin credentials');
if (!password) throw new Error('Missing DB password');

const keyword = String(process.env.ITEM_KEYWORD || 'شوكلاته الفيدو اصبع واحدة').trim();
const start = String(process.env.REPORT_START || '2000-01-01T00:00:00Z');
const end = String(process.env.REPORT_END || '2100-01-01T23:59:59Z');

const supabase = createClient(supabaseUrl, supabaseKey);
const login = await supabase.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
if (login.error) throw new Error(`auth_failed:${login.error.message}`);

const rpc = await supabase.rpc('get_product_sales_report_v10', {
  p_start_date: start,
  p_end_date: end,
  p_zone_id: null,
  p_invoice_only: false,
});
if (rpc.error) throw new Error(`rpc_failed:${rpc.error.message}`);
const rows = Array.isArray(rpc.data) ? rpc.data : [];
const target = rows.find((r) => String(r?.item_name?.ar || '').includes(keyword));
if (!target) throw new Error('item_not_found_in_v10');
const itemId = String(target.item_id);

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
  const menu = await client.query(
    'select id, unit_type, cost_price, data from public.menu_items where id::text = $1',
    [itemId]
  );

  const stock = await client.query(
    `select
       sum(coalesce(available_quantity, 0)) as available_qty,
       sum(coalesce(reserved_quantity, 0)) as reserved_qty,
       case
         when sum(coalesce(available_quantity, 0) + coalesce(reserved_quantity, 0)) > 0
           then sum((coalesce(available_quantity, 0) + coalesce(reserved_quantity, 0)) * coalesce(avg_cost, 0))
                / sum(coalesce(available_quantity, 0) + coalesce(reserved_quantity, 0))
         else 0
       end as weighted_avg_cost
     from public.stock_management
     where item_id::text = $1`,
    [itemId]
  );

  const purchased = await client.query(
    `select
       coalesce(sum(case when movement_type = 'purchase_in' then quantity else 0 end), 0) as purchased_qty,
       coalesce(sum(case when movement_type = 'return_out' and reference_table = 'purchase_returns' then quantity else 0 end), 0) as purchase_return_qty,
       coalesce(sum(case when movement_type = 'purchase_in' then quantity else 0 end), 0)
       - coalesce(sum(case when movement_type = 'return_out' and reference_table = 'purchase_returns' then quantity else 0 end), 0) as net_purchased_qty
     from public.inventory_movements
     where item_id::text = $1`,
    [itemId]
  );

  const sold = await client.query(
    `select
       coalesce(sum(im.quantity), 0) as sold_qty,
       count(distinct im.reference_id) as sold_orders_count
     from public.inventory_movements im
     join public.orders o on o.id::text = im.reference_id
     where im.item_id::text = $1
       and im.reference_table = 'orders'
       and im.movement_type = 'sale_out'
       and o.status = 'delivered'
       and nullif(trim(coalesce(o.data->>'voidedAt', '')), '') is null`,
    [itemId]
  );

  const returns = await client.query(
    `select
       coalesce(sum(im.quantity), 0) as returned_qty,
       count(distinct im.reference_id) as returns_count
     from public.inventory_movements im
     join public.sales_returns sr on sr.id::text = im.reference_id
     where im.item_id::text = $1
       and im.reference_table = 'sales_returns'
       and im.movement_type = 'return_in'
       and sr.status = 'completed'`,
    [itemId]
  );

  const cancels = await client.query(
    `with orders_with_item as (
       select
         o.id,
         o.status,
         nullif(o.data->>'deliveredAt', '')::timestamptz as delivered_at,
         nullif(o.data->>'voidedAt', '')::timestamptz as voided_at
       from public.orders o
       where exists (
         select 1
         from jsonb_array_elements(
           case
             when o.data->'invoiceSnapshot' is not null
               and jsonb_typeof(o.data->'invoiceSnapshot'->'items') = 'array'
               then o.data->'invoiceSnapshot'->'items'
             else coalesce(o.data->'items', '[]'::jsonb)
           end
         ) it
         where coalesce(it->>'itemId', it->>'id') = $1
       )
     )
     select
       count(*) filter (where status = 'cancelled') as cancelled_total,
       count(*) filter (where status = 'cancelled' and delivered_at is null) as cancelled_before_delivery,
       count(*) filter (where status = 'cancelled' and delivered_at is not null) as cancelled_after_delivery,
       count(*) filter (where voided_at is not null and delivered_at is null) as voided_before_delivery,
       count(*) filter (where voided_at is not null and delivered_at is not null) as voided_after_delivery
     from orders_with_item`,
    [itemId]
  );

  const legacyFactor = await client.query(
    `select item_id::text as item_id, qty_factor, active, note
     from public.product_report_legacy_qty_factors
     where item_id::text = $1`,
    [itemId]
  );

  const orderLineSamples = await client.query(
    `with effective_orders as (
       select
         o.id,
         o.created_at,
         o.data,
         nullif(o.data->>'currency', '') as currency_code,
         coalesce(nullif(o.data->>'fxRate', '')::numeric, 1) as fx_rate_effective,
         coalesce(nullif(o.data->>'baseTotal', '')::numeric, 0) as base_total_effective
       from public.orders o
       where o.status = 'delivered'
         and nullif(trim(coalesce(o.data->>'voidedAt', '')), '') is null
     ),
     lines as (
       select
         eo.id as order_id,
         eo.created_at,
         eo.currency_code,
         eo.fx_rate_effective,
         eo.base_total_effective,
         it
       from effective_orders eo,
       jsonb_array_elements(
         case
           when eo.data->'invoiceSnapshot' is not null
             and jsonb_typeof(eo.data->'invoiceSnapshot'->'items') = 'array'
             then eo.data->'invoiceSnapshot'->'items'
           else coalesce(eo.data->'items', '[]'::jsonb)
         end
       ) it
     )
     select
       order_id,
       created_at,
       currency_code,
       fx_rate_effective,
       base_total_effective,
       coalesce((it->>'total')::numeric, 0) as line_total,
       coalesce(it->>'itemId', it->>'id') as item_id,
       coalesce(it->>'unitType', it->>'unit') as unit_type,
       coalesce((it->>'quantity')::numeric, 0) as quantity,
       coalesce((it->>'price')::numeric, 0) as price,
       coalesce((it->>'pricePerUnit')::numeric, 0) as price_per_unit
     from lines
     where coalesce(it->>'itemId', it->>'id') = $1
     order by created_at desc
     limit 10`,
    [itemId]
  );

  const sales = Number(target.total_sales || 0);
  const qtySoldReport = Number(target.quantity_sold || 0);
  const out = {
    generated_at: new Date().toISOString(),
    item: {
      item_id: itemId,
      name_ar: target?.item_name?.ar || null,
      report_unit_type: target.unit_type,
      report_qty_sold: qtySoldReport,
      report_net_sales: Number(target.total_sales || 0),
      report_net_cost: Number(target.total_cost || 0),
      report_net_profit: Number(target.total_profit || 0),
      report_avg_price_per_sold_unit: qtySoldReport > 0 ? sales / qtySoldReport : 0,
      report_margin_percent: sales > 0 ? (Number(target.total_profit || 0) / sales) * 100 : 0,
    },
    system_pricing_and_cost: {
      menu_item: menu.rows?.[0] || null,
      stock_weighted_avg_cost: stock.rows?.[0] || null,
    },
    quantities: {
      purchased: purchased.rows?.[0] || null,
      sold: sold.rows?.[0] || null,
      returns: returns.rows?.[0] || null,
    },
    cancellations: cancels.rows?.[0] || null,
    diagnostics: {
      legacy_qty_factor: legacyFactor.rows || [],
      order_line_samples: orderLineSamples.rows || [],
    },
  };

  fs.mkdirSync(path.join(process.cwd(), 'backups'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'backups', 'single_item_probe.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
} finally {
  await client.end();
}
