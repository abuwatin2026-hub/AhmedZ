import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const password = String(process.env.DBPW || process.env.SUPABASE_DB_PASSWORD || '').trim();
if (!password) throw new Error('Missing DBPW or SUPABASE_DB_PASSWORD');
const itemId = String(process.env.ITEM_ID || '81e85ebf-1415-49a3-b9fa-0fcae3af6b8a').trim();

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
  const q = await client.query(
    `with effective_orders as (
       select
         o.id,
         o.created_at,
         o.data,
         nullif(o.data->>'currency', '') as currency_code,
         coalesce(public.order_fx_rate(
           coalesce(nullif(btrim(coalesce(o.data->>'currency', '')), ''), public.get_base_currency()),
           o.created_at,
           nullif(o.data->>'fxRate','')::numeric
         ), 1) as fx_rate_effective
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
     ),
     f as (
       select
         order_id,
         created_at,
         currency_code,
         fx_rate_effective,
         coalesce((it->>'quantity')::numeric, 0) as quantity,
         coalesce((it->>'price')::numeric, 0) as price,
         coalesce((it->>'pricePerUnit')::numeric, 0) as price_per_unit,
         coalesce((it->>'total')::numeric, 0) as line_total,
         (coalesce((it->>'price')::numeric, 0) * coalesce((it->>'quantity')::numeric, 0) * fx_rate_effective) as base_as_unit_price,
         (coalesce((it->>'price')::numeric, 0) * fx_rate_effective) as base_as_line_price
       from lines
       where coalesce(it->>'itemId', it->>'id') = $1
     )
     select * from f
     order by created_at desc`,
    [itemId]
  );

  const rows = q.rows || [];
  const summary = {
    rows: rows.length,
    total_base_as_unit_price: rows.reduce((a, r) => a + Number(r.base_as_unit_price || 0), 0),
    total_base_as_line_price: rows.reduce((a, r) => a + Number(r.base_as_line_price || 0), 0),
    high_price_rows_over_1000: rows.filter((r) => Number(r.price || 0) >= 1000).length,
    sar_rows: rows.filter((r) => String(r.currency_code || '').toUpperCase() === 'SAR').length,
    yer_rows: rows.filter((r) => String(r.currency_code || '').toUpperCase() === 'YER').length,
  };

  const top = [...rows]
    .sort((a, b) => Number(b.base_as_unit_price || 0) - Number(a.base_as_unit_price || 0))
    .slice(0, 20);

  const out = { generated_at: new Date().toISOString(), item_id: itemId, summary, top_rows: top };
  fs.mkdirSync(path.join(process.cwd(), 'backups'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'backups', 'item_price_outliers_analysis.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
} finally {
  await client.end();
}
