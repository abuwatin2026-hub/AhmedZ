const { Client } = require('pg');
const fs = require('fs');

const NAME_HINTS = [
  'عصير ميرا عائلي 12حبة*1لتر',
  'عصير ميرا عائلي',
  'ميرا عائلي',
  'ميرا 12حبة*1لتر',
  'عصير ميرا'
];

const IN_TYPES = new Set(['purchase_in', 'adjust_in', 'return_in', 'transfer_in', 'sale_return_in']);
const OUT_TYPES = new Set(['sale_out', 'adjust_out', 'return_out', 'transfer_out', 'wastage_out']);

(async () => {
  const client = new Client({
    host: 'aws-1-ap-south-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.pmhivhtaoydfolseelyc',
    password: process.env.DBPW,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const colsRes = await client.query(`select table_name, column_name from information_schema.columns where table_schema='public'`);
  const cols = {};
  for (const r of colsRes.rows) { if (!cols[r.table_name]) cols[r.table_name] = new Set(); cols[r.table_name].add(r.column_name); }
  const hasTable = (t) => !!cols[t];
  const hasCol = (t, c) => !!cols[t] && cols[t].has(c);

  const itemTable = hasTable('menu_items') ? 'menu_items' : hasTable('items') ? 'items' : null;
  if (!itemTable) throw new Error('no item table');

  const nameExpr = hasCol(itemTable, 'name') ? `coalesce(${itemTable}.name::text,'')` : hasCol(itemTable, 'data') ? `coalesce(${itemTable}.data->>'name','')` : `''`;
  const where = NAME_HINTS.map((_, i) => `${nameExpr} ilike $${i + 1}`).join(' or ');
  const itemRes = await client.query(`select * from public.${itemTable} ${itemTable} where ${where} order by updated_at desc nulls last, created_at desc nulls last limit 5`, NAME_HINTS.map(x=>`%${x}%`));
  if (!itemRes.rowCount) throw new Error('item not found');
  const item = itemRes.rows[0];
  const itemId = String(item.id);

  const uomMap = {};
  if (hasTable('uom')) {
    const u = await client.query(`select id::text as id, name, code from public.uom`);
    for (const x of u.rows) uomMap[x.id] = x.code ? `${x.name} (${x.code})` : x.name;
  }
  const uomLabel = (id) => (id ? uomMap[String(id)] || String(id) : 'غير محدد');
  const itemUom = hasTable('item_uom') ? (await client.query(`select * from public.item_uom where item_id::text=$1 limit 1`, [itemId])).rows[0] : null;

  const purchaseItems = hasTable('purchase_items') ? (await client.query(`
    select ${hasCol('purchase_items','uom_id') ? `coalesce(uom_id::text,'null')` : hasCol('purchase_items','unit_id') ? `coalesce(unit_id::text,'null')` : `'null'`} as uom_id,
           sum(coalesce(quantity,0))::numeric as qty,
           sum(coalesce(qty_base,coalesce(quantity,0)))::numeric as qty_base
    from public.purchase_items
    where item_id::text=$1
    group by 1 order by 1
  `,[itemId])).rows : [];

  const receiptItems = hasTable('purchase_receipt_items') ? (await client.query(`
    select ${hasCol('purchase_receipt_items','uom_id') ? `coalesce(uom_id::text,'null')` : hasCol('purchase_receipt_items','unit_id') ? `coalesce(unit_id::text,'null')` : `'null'`} as uom_id,
           sum(coalesce(quantity,0))::numeric as qty,
           sum(coalesce(qty_base,coalesce(quantity,0)))::numeric as qty_base
    from public.purchase_receipt_items
    where item_id::text=$1
    group by 1 order by 1
  `,[itemId])).rows : [];

  const movements = (await client.query(`
    select id::text as id, movement_type, coalesce(quantity,0)::numeric as quantity,
           coalesce(qty_base,coalesce(quantity,0))::numeric as qty_base,
           ${hasCol('inventory_movements','uom_id') ? `coalesce(uom_id::text,'null')` : hasCol('inventory_movements','unit_id') ? `coalesce(unit_id::text,'null')` : `'null'`} as uom_id,
           ${hasCol('inventory_movements','warehouse_id') ? `coalesce(warehouse_id::text,data->>'warehouseId','null')` : `coalesce(data->>'warehouseId','null')`} as warehouse_id,
           reference_table, reference_id, occurred_at
    from public.inventory_movements
    where item_id::text=$1
    order by occurred_at asc nulls last, created_at asc nulls last
  `,[itemId])).rows;

  const movementByType = {};
  const movementByWarehouse = {};
  let signed = 0;
  for (const m of movements) {
    if (!movementByType[m.movement_type]) movementByType[m.movement_type] = { qty_base: 0, qty: 0, count: 0, by_uom: {} };
    const t = movementByType[m.movement_type];
    t.qty_base += Number(m.qty_base||0); t.qty += Number(m.quantity||0); t.count += 1;
    t.by_uom[m.uom_id] = (t.by_uom[m.uom_id]||0) + Number(m.quantity||0);
    const w = m.warehouse_id || 'null';
    if (!movementByWarehouse[w]) movementByWarehouse[w] = { in_base: 0, out_base: 0, net_base: 0 };
    if (IN_TYPES.has(m.movement_type)) { signed += Number(m.qty_base||0); movementByWarehouse[w].in_base += Number(m.qty_base||0); movementByWarehouse[w].net_base += Number(m.qty_base||0); }
    else if (OUT_TYPES.has(m.movement_type)) { signed -= Number(m.qty_base||0); movementByWarehouse[w].out_base += Number(m.qty_base||0); movementByWarehouse[w].net_base -= Number(m.qty_base||0); }
  }

  const transferRefs = {};
  for (const m of movements.filter(x=>x.movement_type==='transfer_in' || x.movement_type==='transfer_out')) {
    const key = `${m.reference_table||''}:${m.reference_id||''}`;
    if (!transferRefs[key]) transferRefs[key] = { in_base: 0, out_base: 0, count: 0 };
    if (m.movement_type==='transfer_in') transferRefs[key].in_base += Number(m.qty_base||0);
    if (m.movement_type==='transfer_out') transferRefs[key].out_base += Number(m.qty_base||0);
    transferRefs[key].count += 1;
  }
  const transferCheck = Object.entries(transferRefs).map(([ref,v])=>({ref,in_base:v.in_base,out_base:v.out_base,diff:v.in_base-v.out_base,balanced:Math.abs(v.in_base-v.out_base)<0.000001,count:v.count}));

  const whMap = {};
  if (hasTable('warehouses')) {
    const r = await client.query(`select id::text as id, coalesce(name, code, id::text) as label from public.warehouses`);
    for (const x of r.rows) whMap[x.id] = x.label;
  }

  const stockRows = hasTable('stock_management') ? (await client.query(`
    select coalesce(warehouse_id::text,'null') as warehouse_id,
           coalesce(available_quantity,0)::numeric as available_quantity,
           ${hasCol('stock_management','uom_id') ? `coalesce(uom_id::text,'null')` : hasCol('stock_management','unit_id') ? `coalesce(unit_id::text,'null')` : hasCol('stock_management','unit') ? `coalesce(unit::text,'null')` : `'null'`} as unit_marker
    from public.stock_management
    where item_id::text=$1
  `,[itemId])).rows : [];

  const stockTotal = stockRows.reduce((s,r)=>s+Number(r.available_quantity||0),0);
  const widSet = new Set([...Object.keys(movementByWarehouse), ...stockRows.map(x=>x.warehouse_id)]);
  const byWarehouseDiff = [];
  for (const wid of widSet) {
    const m = movementByWarehouse[wid] || { net_base: 0 };
    const s = stockRows.filter(x=>x.warehouse_id===wid).reduce((acc,x)=>acc+Number(x.available_quantity||0),0);
    byWarehouseDiff.push({warehouse_id:wid,warehouse_name:whMap[wid]||wid,movement_net_base:m.net_base,stock_available:s,diff_stock_minus_movement:s-m.net_base});
  }

  const pick = (k)=> movementByType[k] ? Number(movementByType[k].qty_base||0) : 0;
  const out = {
    item: {
      id: itemId,
      name: item.name,
      base_uom_id: itemUom?.base_uom_id || null,
      base_uom_name: uomLabel(itemUom?.base_uom_id || null),
      purchase_uom_id: itemUom?.purchase_uom_id || null,
      purchase_uom_name: uomLabel(itemUom?.purchase_uom_id || null),
      sales_uom_id: itemUom?.sales_uom_id || null,
      sales_uom_name: uomLabel(itemUom?.sales_uom_id || null),
    },
    purchased: { by_unit: purchaseItems.map(r=>({uom_id:r.uom_id,uom_name:uomLabel(r.uom_id),qty:Number(r.qty||0),qty_base:Number(r.qty_base||0)})), total_base: purchaseItems.reduce((s,r)=>s+Number(r.qty_base||0),0) },
    entered_stock_from_receipts: { by_unit: receiptItems.map(r=>({uom_id:r.uom_id,uom_name:uomLabel(r.uom_id),qty:Number(r.qty||0),qty_base:Number(r.qty_base||0)})), total_base: receiptItems.reduce((s,r)=>s+Number(r.qty_base||0),0) },
    sold: { total_base: pick('sale_out'), details: movementByType.sale_out||null },
    sold_returns: { total_base: pick('return_in') + pick('sale_return_in'), return_in: movementByType.return_in||null, sale_return_in: movementByType.sale_return_in||null },
    transfers: { transfer_out_base: pick('transfer_out'), transfer_in_base: pick('transfer_in'), refs: transferCheck, all_balanced: transferCheck.every(x=>x.balanced) },
    movement_by_type: Object.fromEntries(Object.entries(movementByType).map(([k,v])=>[k,{qty_base:v.qty_base,qty:v.qty,count:v.count,by_uom:Object.fromEntries(Object.entries(v.by_uom).map(([u,q])=>[uomLabel(u==='null'?null:u),q]))}])),
    stock: {
      rows: stockRows.map(r=>({warehouse_id:r.warehouse_id,warehouse_name:whMap[r.warehouse_id]||r.warehouse_id,available_quantity:Number(r.available_quantity||0),unit_marker:r.unit_marker})),
      total_available: stockTotal,
      expected_from_movements: signed,
      diff_stock_minus_expected: stockTotal - signed,
      consistent: Math.abs(stockTotal - signed) < 0.000001,
      by_warehouse_diff: byWarehouseDiff
    }
  };

  fs.writeFileSync('tmp_audit_mira_result.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('DONE');
  await client.end();
})().catch(e=>{console.error(String(e?.message||e));process.exit(1);});
