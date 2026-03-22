import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

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

const sql = `
with item_scope as (
  select mi.id::text as item_id
  from public.menu_items mi
  union
  select sm.item_id::text as item_id
  from public.stock_management sm
  union
  select im.item_id::text as item_id
  from public.inventory_movements im
),
item_names as (
  select
    s.item_id,
    trim(coalesce(mi.name->>'ar', mi.name->>'en', '')) as item_name,
    coalesce(mi.status, 'unknown') as item_status
  from item_scope s
  left join public.menu_items mi on mi.id::text = s.item_id
),
uom_dict as (
  select
    u.id::text as uom_id,
    coalesce(u.code, '') as uom_code,
    coalesce(u.name, '') as uom_name
  from public.uom u
),
item_uom as (
  select
    iu.item_id::text as item_id,
    max(iu.uom_id::text) filter (where iu.is_default_purchase) as purchase_uom_id,
    max(iu.qty_in_base::numeric) filter (where iu.is_default_purchase) as purchase_qty_in_base,
    max(iu.uom_id::text) filter (where iu.is_default_sales) as sales_uom_id,
    max(iu.qty_in_base::numeric) filter (where iu.is_default_sales) as sales_qty_in_base,
    max(iu.uom_id::text) filter (where coalesce(iu.qty_in_base,0) = 1) as base_uom_id
  from public.item_uom_units iu
  where coalesce(iu.is_active, true) = true
  group by iu.item_id
),
stock as (
  select
    sm.item_id::text as item_id,
    sum(coalesce(sm.available_quantity, 0))::numeric as stock_available_base,
    sum(coalesce(sm.reserved_quantity, 0))::numeric as stock_reserved_base,
    max(sm.unit::text) as stock_unit_raw
  from public.stock_management sm
  group by sm.item_id
),
mov as (
  select
    im.item_id::text as item_id,
    sum(
      case
        when lower(coalesce(im.movement_type,'')) like '%purchase%'
             and lower(coalesce(im.movement_type,'')) not like '%return%'
        then coalesce(im.qty_base, im.quantity, 0)
        else 0
      end
    )::numeric as purchased_qty_base,
    sum(
      case
        when lower(coalesce(im.movement_type,'')) in ('sale_out','sold_out','sales_out')
          or (lower(coalesce(im.movement_type,'')) like '%sale%' and lower(coalesce(im.movement_type,'')) like '%out%')
        then abs(coalesce(im.qty_base, im.quantity, 0))
        else 0
      end
    )::numeric as sold_qty_base,
    sum(
      case
        when lower(coalesce(im.movement_type,'')) like '%sale_return%'
          or lower(coalesce(im.reference_table,'')) = 'sales_returns'
        then coalesce(im.qty_base, im.quantity, 0)
        else 0
      end
    )::numeric as sales_return_qty_base
  from public.inventory_movements im
  group by im.item_id
)
select
  n.item_id,
  n.item_name,
  n.item_status,

  coalesce(m.purchased_qty_base, 0)::numeric as purchased_qty_base,
  i.purchase_uom_id,
  coalesce(up.uom_code, '') as purchase_uom_code,
  coalesce(up.uom_name, '') as purchase_uom_name,
  i.purchase_qty_in_base,
  case
    when coalesce(i.purchase_qty_in_base,0) > 0
    then round(coalesce(m.purchased_qty_base,0) / i.purchase_qty_in_base, 6)
    else null
  end as purchased_qty_in_purchase_uom,

  coalesce(s.stock_available_base, 0)::numeric as stock_available_base,
  coalesce(s.stock_reserved_base, 0)::numeric as stock_reserved_base,
  s.stock_unit_raw,
  i.base_uom_id,
  coalesce(ub.uom_code, '') as base_uom_code,
  coalesce(ub.uom_name, '') as base_uom_name,

  coalesce(m.sold_qty_base, 0)::numeric as sold_qty_base,
  i.sales_uom_id,
  coalesce(us.uom_code, '') as sales_uom_code,
  coalesce(us.uom_name, '') as sales_uom_name,
  i.sales_qty_in_base,
  case
    when coalesce(i.sales_qty_in_base,0) > 0
    then round(coalesce(m.sold_qty_base,0) / i.sales_qty_in_base, 6)
    else null
  end as sold_qty_in_sales_uom,

  coalesce(m.sales_return_qty_base, 0)::numeric as sales_return_qty_base,
  case
    when coalesce(i.sales_qty_in_base,0) > 0
    then round(coalesce(m.sales_return_qty_base,0) / i.sales_qty_in_base, 6)
    else null
  end as sales_return_qty_in_sales_uom
from item_names n
left join mov m on m.item_id = n.item_id
left join stock s on s.item_id = n.item_id
left join item_uom i on i.item_id = n.item_id
left join uom_dict up on up.uom_id = i.purchase_uom_id
left join uom_dict us on us.uom_id = i.sales_uom_id
left join uom_dict ub on ub.uom_id = i.base_uom_id
order by
  case when trim(coalesce(n.item_name,'')) = '' then 1 else 0 end,
  n.item_name asc,
  n.item_id asc
`;

const csvEscape = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

await client.connect();
try {
  const r = await client.query(sql);
  const rawRows = Array.isArray(r.rows) ? r.rows : [];
  const n = (v) => {
    const x = Number(v || 0);
    return Number.isFinite(x) ? x : 0;
  };
  const rows = rawRows.map((row) => {
    const purchaseFactor = n(row.purchase_qty_in_base) > 0 ? n(row.purchase_qty_in_base) : 1;
    const salesFactor = n(row.sales_qty_in_base) > 0 ? n(row.sales_qty_in_base) : 1;
    const fallbackUnitCode = String(row.base_uom_code || row.stock_unit_raw || 'UNIT');
    const fallbackUnitName = String(row.base_uom_name || row.stock_unit_raw || 'Unit');
    const purchaseUnitCode = String(row.purchase_uom_code || fallbackUnitCode);
    const purchaseUnitName = String(row.purchase_uom_name || fallbackUnitName);
    const salesUnitCode = String(row.sales_uom_code || fallbackUnitCode);
    const salesUnitName = String(row.sales_uom_name || fallbackUnitName);
    const returnUnitCode = salesUnitCode;
    const returnUnitName = salesUnitName;
    const purchasedBase = n(row.purchased_qty_base);
    const soldBase = n(row.sold_qty_base);
    const returnBase = n(row.sales_return_qty_base);
    return {
      ...row,
      purchase_unit_code_final: purchaseUnitCode,
      purchase_unit_name_final: purchaseUnitName,
      sales_unit_code_final: salesUnitCode,
      sales_unit_name_final: salesUnitName,
      return_unit_code_final: returnUnitCode,
      return_unit_name_final: returnUnitName,
      purchased_qty_in_purchase_uom_final: Number((purchasedBase / purchaseFactor).toFixed(6)),
      sold_qty_in_sales_uom_final: Number((soldBase / salesFactor).toFixed(6)),
      sales_return_qty_in_return_uom_final: Number((returnBase / salesFactor).toFixed(6)),
    };
  });

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const header = columns.join(',');
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c])).join(','));
  const csv = [header, ...lines].join('\n');

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, `all_items_inventory_audit_${ts}.csv`);
  const jsonPath = path.join(outDir, `all_items_inventory_audit_${ts}.json`);
  const reportPath = path.join(outDir, `all_items_inventory_report_${ts}.txt`);

  fs.writeFileSync(csvPath, csv, 'utf8');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        rows: rows.length,
        columns,
        data: rows,
      },
      null,
      2,
    ),
    'utf8',
  );

  const textLines = [];
  textLines.push(`تقرير شامل الأصناف - ${new Date().toISOString()}`);
  textLines.push(`إجمالي الأصناف: ${rows.length}`);
  textLines.push('');
  textLines.push('الحقول: الصنف | المشتريات | المخزون الحالي | المبيعات | المرتجعات');
  textLines.push('');
  for (const row of rows) {
    textLines.push(
      `${row.item_name || '(بدون اسم)'} | `
      + `شراء: ${row.purchased_qty_in_purchase_uom_final} ${row.purchase_unit_code_final} `
      + `(أساس ${row.purchased_qty_base}) | `
      + `مخزون: ${row.stock_available_base} ${row.base_uom_code || row.stock_unit_raw || 'UNIT'} | `
      + `مباع: ${row.sold_qty_in_sales_uom_final} ${row.sales_unit_code_final} `
      + `(أساس ${row.sold_qty_base}) | `
      + `مرتجع: ${row.sales_return_qty_in_return_uom_final} ${row.return_unit_code_final} `
      + `(أساس ${row.sales_return_qty_base})`
    );
  }
  fs.writeFileSync(reportPath, textLines.join('\n'), 'utf8');

  const missingPurchaseUnit = rows.filter((x) => !String(x.purchase_unit_code_final || '').trim()).length;
  const missingSalesUnit = rows.filter((x) => !String(x.sales_unit_code_final || '').trim()).length;
  const missingReturnUnit = rows.filter((x) => !String(x.return_unit_code_final || '').trim()).length;

  console.log(
    JSON.stringify(
      {
        ok: true,
        rows: rows.length,
        csvPath,
        jsonPath,
        reportPath,
        missingUnits: {
          purchase: missingPurchaseUnit,
          sales: missingSalesUnit,
          returns: missingReturnUnit,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
