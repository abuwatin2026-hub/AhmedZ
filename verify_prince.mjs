const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0,600));
  return b;
}

async function main() {
  const itemId = '98f406f7-631a-480f-997b-5dc1e3fd09d9';
  
  // 1. Purchase receipt — the ONLY source of truth
  console.log('===== 1. فاتورة الشراء (المصدر الأصلي) =====');
  const pri = await sql(`SELECT quantity, qty_base, uom_id, unit_cost FROM purchase_receipt_items WHERE item_id='${itemId}'`);
  pri.forEach(p => console.log(`  quantity=${p.quantity} | qty_base=${p.qty_base} | unit_cost=${p.unit_cost}`));
  console.log(`  ← المشترى فعلياً: ${pri.reduce((s,p)=>s+parseFloat(p.qty_base),0)} وحدة أساسية`);

  // 2. Each movement with FULL detail
  console.log('\n===== 2. كل حركة بالتفصيل =====');
  const mvs = await sql(`
    SELECT im.id, im.movement_type, im.quantity, im.qty_base, im.warehouse_id,
      im.reference_id, im.created_at,
      (SELECT w.name::text FROM warehouses w WHERE w.id=im.warehouse_id) as wh
    FROM inventory_movements im WHERE im.item_id='${itemId}'
    ORDER BY im.created_at, im.movement_type
  `);
  
  // Track per-warehouse
  const whStock = {};
  mvs.forEach((m,i) => {
    const wName = m.wh?.match(/"ar":\s*"([^"]+)"/)?.[1] || m.warehouse_id?.slice(0,8);
    if (!whStock[wName]) whStock[wName] = 0;
    
    const isIn = ['purchase_in','transfer_in','return_in','adjust_in'].includes(m.movement_type);
    const isOut = ['sale_out','transfer_out','return_out','adjust_out'].includes(m.movement_type);
    if (isIn) whStock[wName] += parseFloat(m.quantity);
    if (isOut) whStock[wName] -= parseFloat(m.quantity);
    
    console.log(`  ${(i+1).toString().padStart(2)}. ${m.created_at?.slice(0,16)} | ${m.movement_type.padEnd(14)} | qty=${m.quantity} | مستودع=${wName.padEnd(12)} | رصيد_متوقع=${whStock[wName]} | ref=${m.reference_id?.slice(0,8)}`);
  });

  // 3. Expected per-warehouse vs actual
  console.log('\n===== 3. مقارنة: متوقع من الحركات vs فعلي =====');
  const sm = await sql(`
    SELECT sm.warehouse_id, sm.available_quantity,
      (SELECT w.name::text FROM warehouses w WHERE w.id=sm.warehouse_id) as wh
    FROM stock_management sm WHERE sm.item_id='${itemId}'
  `);
  let totalExpected = 0, totalActual = 0;
  const smMap = {};
  sm.forEach(s => {
    const wName = s.wh?.match(/"ar":\s*"([^"]+)"/)?.[1] || s.warehouse_id?.slice(0,8);
    smMap[wName] = parseFloat(s.available_quantity);
  });
  
  const allWH = new Set([...Object.keys(whStock), ...Object.keys(smMap)]);
  allWH.forEach(w => {
    const exp = whStock[w] || 0;
    const act = smMap[w] || 0;
    const diff = act - exp;
    totalExpected += exp;
    totalActual += act;
    const ok = Math.abs(diff) < 0.5;
    console.log(`  ${w.padEnd(15)} | متوقع=${exp.toString().padStart(5)} | فعلي=${act.toString().padStart(5)} | فرق=${diff > 0 ? '+':''}${diff} ${ok ? '✅' : '❌'}`);
  });
  console.log(`  ${'المجموع'.padEnd(15)} | متوقع=${totalExpected.toString().padStart(5)} | فعلي=${totalActual.toString().padStart(5)} | فرق=${totalActual - totalExpected > 0 ? '+':''}${totalActual - totalExpected}`);

  // 4. Warehouse transfers detail
  console.log('\n===== 4. تفاصيل كل تحويل =====');
  const transferRefs = [...new Set(mvs.filter(m=>m.movement_type.startsWith('transfer')).map(m=>m.reference_id))];
  for (const ref of transferRefs) {
    console.log(`\n  تحويل ${ref?.slice(0,8)}:`);
    // Get transfer details
    const td = await sql(`SELECT * FROM warehouse_transfers WHERE id='${ref}'`).catch(()=>[]);
    if (td.length) {
      const t = td[0];
      const fromWh = (await sql(`SELECT name::text as n FROM warehouses WHERE id='${t.from_warehouse_id}'`).catch(()=>[{n:'-'}]))[0].n;
      const toWh = (await sql(`SELECT name::text as n FROM warehouses WHERE id='${t.to_warehouse_id}'`).catch(()=>[{n:'-'}]))[0].n;
      const fName = fromWh?.match(/"ar":\s*"([^"]+)"/)?.[1] || fromWh;
      const tName = toWh?.match(/"ar":\s*"([^"]+)"/)?.[1] || toWh;
      console.log(`    من: ${fName} → إلى: ${tName} | status=${t.status} | ${t.created_at?.slice(0,10)}`);
      // Items in transfer
      const items = typeof t.items === 'string' ? JSON.parse(t.items) : t.items;
      if (items) {
        const thisItem = Array.isArray(items) ? items.find(i => i.item_id === itemId) : null;
        if (thisItem) console.log(`    كمية في التحويل: ${thisItem.quantity || thisItem.qty} ${thisItem.uom || '-'}`);
      }
    }
    // Related movements
    const relMvs = mvs.filter(m => m.reference_id === ref);
    relMvs.forEach(m => {
      const wName = m.wh?.match(/"ar":\s*"([^"]+)"/)?.[1] || '-';
      console.log(`    → ${m.movement_type}: ${m.quantity} من/إلى ${wName}`);
    });
    const totalOut = relMvs.filter(m=>m.movement_type==='transfer_out').reduce((s,m)=>s+parseFloat(m.quantity),0);
    const totalIn = relMvs.filter(m=>m.movement_type==='transfer_in').reduce((s,m)=>s+parseFloat(m.quantity),0);
    console.log(`    خروج=${totalOut} | دخول=${totalIn} | ${totalOut===totalIn ? '✅ متوازن' : '❌ غير متوازن!'}`);
  }

  // 5. Batch analysis
  console.log('\n===== 5. الدُفعات: لماذا وارد 115 مقابل 20 مشترى؟ =====');
  const batches = await sql(`
    SELECT b.id, b.quantity_received, b.quantity_consumed, b.status, b.warehouse_id, b.created_at,
      (SELECT w.name::text FROM warehouses w WHERE w.id=b.warehouse_id) as wh
    FROM batches b WHERE b.item_id='${itemId}' ORDER BY b.created_at
  `);
  batches.forEach((b,i) => {
    const wName = b.wh?.match(/"ar":\s*"([^"]+)"/)?.[1] || '-';
    console.log(`  ${i+1}. وارد=${b.quantity_received} مستهلك=${b.quantity_consumed} مستودع=${wName} ${b.status} ${b.created_at?.slice(0,10)}`);
  });
}
main().catch(console.error);
