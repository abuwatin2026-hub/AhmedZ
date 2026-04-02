const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${SBP}`},
    body:JSON.stringify({query:q}),
  });
  const b=await r.json();
  if(!r.ok) throw new Error(JSON.stringify(b).slice(0,600));
  return b;
}
async function main(){
  // 1. Available RPCs for in-store sale / financial party / receipt
  console.log('=== RPCs المتاحة ===');
  const rpcs = await sql(`
    SELECT proname, pg_get_function_arguments(oid) as args
    FROM pg_proc 
    WHERE proname IN (
      'create_in_store_sale','create_order','create_financial_party',
      'add_financial_party','create_party','record_order_payment_v2',
      'create_receipt','settle_receipt','create_ar_receipt',
      'confirm_order_delivery','record_payment'
    )
    ORDER BY proname
  `);
  rpcs.forEach(r=>console.log(`  ${r.proname}(${r.args?.slice(0,100)})`));

  // Also check for any RPC with 'party' or 'receipt' or 'settle' in name
  console.log('\n=== RPCs تحتوي party/receipt/settle ===');
  const rpcs2 = await sql(`
    SELECT proname FROM pg_proc 
    WHERE proname LIKE '%party%' OR proname LIKE '%receipt%' OR proname LIKE '%settle%' OR proname LIKE '%instore%' OR proname LIKE '%in_store%'
    ORDER BY proname
  `);
  rpcs2.forEach(r=>console.log(`  ${r.proname}`));

  // 2. Warehouses
  console.log('\n=== المستودعات ===');
  const whs = await sql(`SELECT id, name::text FROM warehouses ORDER BY name`);
  whs.forEach(w=>console.log(`  ${w.id?.slice(0,8)}: ${w.name?.match(/"ar":\s*"([^"]+)"/)?.[1] || w.name}`));

  // 3. Items in TWO different warehouses (with stock > 0)
  console.log('\n=== أصناف موجودة في مستودعين مختلفين ===');
  const candidates = await sql(`
    SELECT DISTINCT sm1.item_id::text, sm1.warehouse_id as wh1, sm2.warehouse_id as wh2,
      sm1.available_quantity as qty1, sm2.available_quantity as qty2,
      sm1.unit as unit1, sm2.unit as unit2,
      (SELECT mi.name::text FROM menu_items mi WHERE mi.id::text=sm1.item_id) as name1,
      (SELECT mi.name::text FROM menu_items mi WHERE mi.id::text=sm1.item_id) as name2
    FROM stock_management sm1
    JOIN stock_management sm2 ON sm1.item_id=sm2.item_id AND sm1.warehouse_id != sm2.warehouse_id
    WHERE sm1.available_quantity > 5 AND sm2.available_quantity > 5
    LIMIT 5
  `);
  candidates.forEach(c=>{
    const n = c.name1?.match(/"ar":\s*"([^"]+)"/)?.[1] || c.item_id?.slice(0,8);
    console.log(`  صنف: ${n} | wh1=${c.wh1?.slice(0,8)} qty=${c.qty1} | wh2=${c.wh2?.slice(0,8)} qty=${c.qty2}`);
  });

  // 4. Items with UOM units (multiple units)
  console.log('\n=== أصناف بوحدات متعددة ===');
  const multiUOM = await sql(`
    SELECT u.item_id::text,
      (SELECT mi.name::text FROM menu_items mi WHERE mi.id::text=u.item_id) as name,
      COUNT(*) as uom_count,
      STRING_AGG(
        (SELECT um.name::text FROM uom um WHERE um.id=u.uom_id) || '(x' || u.qty_in_base::text || ')', ' | '
      ) as units
    FROM item_uom_units u
    GROUP BY u.item_id HAVING COUNT(*) > 1
    LIMIT 5
  `);
  multiUOM.forEach(i=>{
    const n = i.name?.match(/"ar":\s*"([^"]+)"/)?.[1] || i.item_id?.slice(0,8);
    console.log(`  ${n}: ${i.units}`);
  });

  // 5. Financial parties structure
  console.log('\n=== هيكل financial_parties / party_types ===');
  const fpCols = await sql(`
    SELECT column_name, data_type FROM information_schema.columns 
    WHERE table_name='financial_parties' ORDER BY ordinal_position LIMIT 15
  `);
  fpCols.forEach(c=>console.log(`  ${c.column_name}: ${c.data_type}`));

  // 6. orders table key columns for in-store
  console.log('\n=== أعمدة orders الرئيسية ===');
  const ordCols = await sql(`
    SELECT column_name, data_type, column_default FROM information_schema.columns 
    WHERE table_name='orders' ORDER BY ordinal_position LIMIT 30
  `);
  ordCols.forEach(c=>console.log(`  ${c.column_name}: ${c.data_type} ${c.column_default||''}`));
}
main().catch(console.error);
