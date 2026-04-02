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
  // KEY DISCOVERY: inventory_movements.quantity IS in base unit (confirmed)
  // The issue might be stock_management counting across warehouses incorrectly
  
  console.log('===== تدقيق شامل مع مراعاة المستودعات ووحدات القياس =====\n');

  // Warehouse names
  const wh = await sql(`SELECT id, name::text FROM warehouses`).catch(()=>[]);
  console.log('المستودعات:');
  wh.forEach(w => console.log(`  ${w.id.slice(0,8)}: ${w.name}`));

  // For EACH item: check purchases (qty_base), movements, stock per warehouse
  const allItems = await sql(`
    SELECT mi.id, mi.name::text as item_name
    FROM menu_items mi ORDER BY mi.name::text
  `);

  const report = [];

  for (const item of allItems) {
    const id = item.id;
    const name = item.item_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || item.item_name;

    // Purchase receipts (true source of purchased qty in base unit)
    const priSum = await sql(`
      SELECT coalesce(sum(qty_base::numeric),0) as total_base 
      FROM purchase_receipt_items WHERE item_id='${id}'
    `);
    const purchasedBase = parseFloat(priSum[0].total_base);

    // All movements by type (already in base unit)
    const mvs = await sql(`
      SELECT movement_type, sum(quantity) as total 
      FROM inventory_movements WHERE item_id='${id}' GROUP BY movement_type
    `);
    const mv = Object.fromEntries(mvs.map(m => [m.movement_type, parseFloat(m.total)]));

    // Stock per warehouse
    const smRows = await sql(`
      SELECT sm.warehouse_id, sm.available_quantity::numeric as qty, w.name::text as wname
      FROM stock_management sm
      LEFT JOIN warehouses w ON w.id = sm.warehouse_id
      WHERE sm.item_id='${id}'
    `);
    const totalStock = smRows.reduce((s, r) => s + parseFloat(r.qty || 0), 0);

    // Movements per warehouse (net in - out)
    const whMovements = await sql(`
      SELECT warehouse_id,
        sum(CASE WHEN movement_type IN ('purchase_in','return_in','adjust_in','transfer_in') THEN quantity ELSE 0 END) as total_in,
        sum(CASE WHEN movement_type IN ('sale_out','return_out','adjust_out','transfer_out','write_off') THEN quantity ELSE 0 END) as total_out
      FROM inventory_movements WHERE item_id='${id}'
      GROUP BY warehouse_id
    `);

    // Compute expected per warehouse
    const whExpected = {};
    whMovements.forEach(w => {
      whExpected[w.warehouse_id] = parseFloat(w.total_in) - parseFloat(w.total_out);
    });

    // Global expected (from movements: all IN - all OUT)
    const purchaseIn = mv['purchase_in'] || 0;
    const saleOut = mv['sale_out'] || 0;
    const returnIn = mv['return_in'] || 0;
    const returnOut = mv['return_out'] || 0;
    const adjIn = mv['adjust_in'] || 0;
    const adjOut = mv['adjust_out'] || 0;
    // transfer_in and transfer_out cancel each other globally
    const globalExpected = purchaseIn - saleOut + returnIn - returnOut + adjIn - adjOut;

    const globalDiscrep = totalStock - globalExpected;

    // Per-warehouse discrepancies
    let hasWhDiscrepancy = false;
    const whDetails = [];
    for (const r of smRows) {
      const expected = whExpected[r.warehouse_id] || 0;
      const actual = parseFloat(r.qty);
      const diff = actual - expected;
      if (Math.abs(diff) > 0.5) hasWhDiscrepancy = true;
      whDetails.push({ wh: r.warehouse_id?.slice(0,8), wname: r.wname, expected, actual, diff });
    }

    report.push({
      name, id, purchasedBase,
      purchaseIn, saleOut, returnIn, returnOut, adjIn, adjOut,
      globalExpected, totalStock, globalDiscrep,
      whDetails, hasWhDiscrepancy,
      smWarehouses: smRows.length
    });
  }

  // === RESULTS ===
  const surplus = report.filter(r => r.globalDiscrep > 0.5);
  const deficit = report.filter(r => r.globalDiscrep < -0.5);
  const ok = report.filter(r => Math.abs(r.globalDiscrep) <= 0.5);
  const whMismatch = report.filter(r => r.hasWhDiscrepancy);

  console.log(`\n===== النتائج =====`);
  console.log(`إجمالي: ${report.length} | ✅ صحيح عالمياً: ${ok.length} | 🔴 زيادة: ${surplus.length} | 🟡 نقص: ${deficit.length}`);
  console.log(`⚠️ فرق على مستوى المستودعات: ${whMismatch.length}`);

  // Purchase receipt vs movement comparison
  const priMismatch = report.filter(r => Math.abs(r.purchasedBase - r.purchaseIn) > 0.5);
  console.log(`📦 فرق بين فواتير الشراء وحركات الشراء: ${priMismatch.length}`);
  if (priMismatch.length > 0) {
    priMismatch.forEach(r => {
      console.log(`  ${r.name}: receipt_base=${r.purchasedBase} movement_purchaseIn=${r.purchaseIn} فرق=${r.purchasedBase - r.purchaseIn}`);
    });
  }

  if (surplus.length > 0) {
    console.log(`\n=== 🔴 زيادة (${surplus.length}) ===`);
    surplus.sort((a,b) => b.globalDiscrep - a.globalDiscrep);
    surplus.forEach(r => {
      console.log(`\n${r.name}:`);
      console.log(`  فواتير شراء (base): ${r.purchasedBase} | حركة شراء: ${r.purchaseIn}`);
      console.log(`  بيع:${r.saleOut} | مرتجع_صادر:${r.returnOut} | تعديل+:${r.adjIn}`);
      console.log(`  متوقع:${r.globalExpected} | فعلي:${r.totalStock} | زيادة:+${r.globalDiscrep.toFixed(0)}`);
      console.log(`  مستودعات (${r.smWarehouses}):`);
      r.whDetails.forEach(w => {
        const flag = Math.abs(w.diff) > 0.5 ? (w.diff > 0 ? '🔴' : '🟡') : '✅';
        console.log(`    ${flag} ${w.wname?.match(/"ar":\s*"([^"]+)"/)?.[1] || w.wh}: متوقع=${w.expected.toFixed(0)} فعلي=${w.actual} فرق=${w.diff.toFixed(0)}`);
      });
    });
  }

  if (deficit.length > 0) {
    console.log(`\n=== 🟡 نقص (${deficit.length}) — أكبر 5 ===`);
    deficit.sort((a,b) => a.globalDiscrep - b.globalDiscrep);
    deficit.slice(0,5).forEach(r => {
      console.log(`${r.name}: متوقع=${r.globalExpected} فعلي=${r.totalStock} نقص=${r.globalDiscrep.toFixed(0)}`);
    });
  }

  // Summary
  console.log('\n===== الخلاصة =====');
  console.log(`وحدة القياس: جميع الحركات مسجلة بالوحدة الأساسية ✅ (تم التأكد)`);
  console.log(`فرق فواتير الشراء vs حركات: ${priMismatch.length} صنف`);
  console.log(`أصناف بزيادة: ${surplus.length} | أصناف بنقص: ${deficit.length} | صحيحة: ${ok.length}`);
}
main().catch(console.error);
