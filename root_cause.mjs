const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 600));
  return b;
}
async function main() {
  const itemId = '98f406f7-631a-480f-997b-5dc1e3fd09d9';

  // 1. All movements chronologically with running balance per warehouse
  console.log('=== الرصيد المحسوب من الحركات (بالتسلسل) ===');
  const allMvs = await sql(`
    SELECT im.movement_type, im.quantity, im.warehouse_id, im.reference_id, im.created_at,
      (SELECT w.name::text FROM warehouses w WHERE w.id=im.warehouse_id) as wh_name
    FROM inventory_movements im WHERE im.item_id='${itemId}'
    ORDER BY im.created_at
  `);
  const curStock = {};
  allMvs.forEach((m, i) => {
    const wh = m.warehouse_id;
    const wName = m.wh_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || wh?.slice(0,8);
    if (!curStock[wh]) curStock[wh] = 0;
    const before = curStock[wh];
    const isIn = ['purchase_in','transfer_in','return_in','adjust_in'].includes(m.movement_type);
    curStock[wh] += isIn ? parseFloat(m.quantity) : -parseFloat(m.quantity);
    console.log(`  ${(i+1).toString().padStart(2)}. ${m.movement_type.padEnd(14)} qty=${String(m.quantity).padStart(4)} | ${wName} | ${before} → ${curStock[wh]} | ref=${m.reference_id?.slice(0,8)}`);
  });

  console.log('\n  الرصيد المحسوب:');
  for (const [wh, qty] of Object.entries(curStock)) {
    const wName = allMvs.find(m=>m.warehouse_id===wh)?.wh_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || wh?.slice(0,8);
    console.log(`    ${wName}: ${qty}`);
  }
  console.log(`    المجموع: ${Object.values(curStock).reduce((s,q)=>s+q,0)}`);

  // 2. stock_management actual
  console.log('\n=== stock_management الفعلي ===');
  const sm = await sql(`
    SELECT sm.warehouse_id, sm.available_quantity,
      (SELECT w.name::text FROM warehouses w WHERE w.id=sm.warehouse_id) as wh_name
    FROM stock_management sm WHERE sm.item_id='${itemId}'
  `);
  let totalSM = 0;
  sm.forEach(s => {
    const wName = s.wh_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || s.warehouse_id?.slice(0,8);
    totalSM += parseFloat(s.available_quantity);
    const calc = curStock[s.warehouse_id] || 0;
    const diff = parseFloat(s.available_quantity) - calc;
    console.log(`  ${wName}: فعلي=${s.available_quantity} | محسوب=${calc} | فرق=${diff > 0 ? '+':''}${diff} ${Math.abs(diff)<0.5?'✅':'❌'}`);
  });
  console.log(`  المجموع الفعلي: ${totalSM} | المجموع المحسوب: ${Object.values(curStock).reduce((s,q)=>s+q,0)}`);

  // 3. Can stock_management total != purchase total prove bug?
  const purchasedTotal = 20; // confirmed
  console.log(`\n=== التحقق النهائي ===`);
  console.log(`  المشترى: 20`);
  console.log(`  لا يوجد بيع، لا مرتجع، لا شطب`);
  console.log(`  المتوقع في المخزون: 20`);
  console.log(`  الموجود في stock_management: ${totalSM}`);
  console.log(`  الزيادة الوهمية: +${totalSM - purchasedTotal}`);

  // 4. Transfer c8993137 items detail
  console.log('\n=== تحويل c8993137 — أصناف التحويل ===');
  const tItems = await sql(`SELECT * FROM warehouse_transfer_items WHERE transfer_id LIKE 'c8993137%'`);
  
  // Get actual ID
  const tRec = await sql(`SELECT id FROM warehouse_transfers WHERE id::text LIKE 'c8993137%'`);
  if (tRec.length) {
    const tid = tRec[0].id;
    console.log(`  Transfer ID: ${tid}`);
    const ti = await sql(`SELECT item_id, quantity, transferred_quantity, batch_id FROM warehouse_transfer_items WHERE transfer_id='${tid}'`);
    ti.forEach(i => {
      const isMine = i.item_id === itemId;
      console.log(`  ${isMine ? '◄' : ' '} item=${i.item_id?.slice(0,8)} | qty=${i.quantity} | transferred=${i.transferred_quantity} | batch=${i.batch_id || 'NULL'}`);
    });
    
    // From transfer record
    const tr = await sql(`SELECT from_warehouse_id, to_warehouse_id, status, shipping_cost FROM warehouse_transfers WHERE id='${tid}'`);
    if (tr.length) {
      console.log(`  from=${tr[0].from_warehouse_id?.slice(0,8)} → to=${tr[0].to_warehouse_id?.slice(0,8)} | status=${tr[0].status} | shipping=${tr[0].shipping_cost}`);
    }
    
    // v_food_batch_balances at time of transfer for this item
    console.log('\n  دُفعات الصنف التي كانت متاحة وقت التحويل:');
    const batches = await sql(`
      SELECT b.id::text as bid, b.quantity_received, b.quantity_consumed, b.status, b.warehouse_id, b.created_at,
        (SELECT w.name::text FROM warehouses w WHERE w.id=b.warehouse_id) as wh
      FROM batches b WHERE b.item_id='${itemId}' ORDER BY b.created_at
    `);
    batches.forEach((b,i) => {
      const rem = parseFloat(b.quantity_received) - parseFloat(b.quantity_consumed);
      const wName = b.wh?.match(/"ar":\s*"([^"]+)"/)?.[1] || b.warehouse_id?.slice(0,8);
      console.log(`  ${i+1}. batch=${b.bid?.slice(0,8)} | وارد=${b.quantity_received} مستهلك=${b.quantity_consumed} متبقي=${rem} | مستودع=${wName} | ${b.created_at?.slice(0,10)}`);
    });
  }
}
main().catch(console.error);
