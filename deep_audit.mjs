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
  // === STEP 0: Understand the schema ===
  console.log('======= STEP 0: Schema Discovery =======');
  
  const smCols = await sql(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='stock_management' ORDER BY ordinal_position`);
  console.log('stock_management:', smCols.map(c=>c.column_name).join(', '));

  const bbCols = await sql(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='batch_balances' ORDER BY ordinal_position`);
  console.log('batch_balances:', bbCols.map(c=>c.column_name).join(', '));

  const bCols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='batches' AND column_name ILIKE '%qty%' OR column_name ILIKE '%quantity%' OR column_name ILIKE '%consumed%' AND table_name='batches'`);
  console.log('batches qty cols:', bCols.map(c=>c.column_name).join(', '));

  const uomCols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='item_uom_units' ORDER BY ordinal_position`);
  console.log('item_uom_units:', uomCols.map(c=>c.column_name).join(', '));

  const priCols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='purchase_receipt_items' ORDER BY ordinal_position`);
  console.log('purchase_receipt_items:', priCols.map(c=>c.column_name).join(', '));

  // Movement types
  const mvTypes = await sql(`SELECT movement_type, count(*) as cnt, sum(quantity) as total FROM inventory_movements GROUP BY movement_type ORDER BY movement_type`);
  console.log('\nAll movement types:');
  mvTypes.forEach(m => console.log(`  ${m.movement_type}: ${m.cnt} movements, total qty=${m.total}`));

  // === STEP 1: Get all items with UOM info ===
  console.log('\n======= STEP 1: Items + UOM =======');
  const allItems = await sql(`
    SELECT mi.id, mi.name::text as item_name, mi.base_unit,
      (SELECT json_agg(json_build_object('uom_id',u.uom_id,'qty_in_base',u.qty_in_base,'is_default_purchase',u.is_default_purchase,'is_default_sales',u.is_default_sales))
       FROM item_uom_units u WHERE u.item_id=mi.id) as uoms
    FROM menu_items mi
    ORDER BY mi.name::text
  `);
  console.log(`Total items: ${allItems.length}`);

  // === STEP 2: For each item, get comprehensive data ===
  console.log('\n======= STEP 2: Comprehensive Per-Item Audit =======');
  
  const report = [];
  
  for (const item of allItems) {
    const name = item.item_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || item.item_name?.slice(0,50);
    const id = item.id;

    // All movements
    const mvs = await sql(`
      SELECT movement_type, sum(quantity) as total, count(*) as cnt
      FROM inventory_movements WHERE item_id='${id}'
      GROUP BY movement_type
    `);
    const mv = Object.fromEntries(mvs.map(m => [m.movement_type, { total: parseFloat(m.total), cnt: parseInt(m.cnt) }]));

    // Stock
    const smRows = await sql(`SELECT available_quantity, reserved_quantity, warehouse_id FROM stock_management WHERE item_id='${id}'`);
    const actualStock = smRows.reduce((s, r) => s + parseFloat(r.available_quantity || 0), 0);

    // Batches
    const batches = await sql(`
      SELECT id, quantity_received, quantity_consumed, status
      FROM batches WHERE item_id='${id}'
    `);
    const batchRemaining = batches.reduce((s, b) => s + (parseFloat(b.quantity_received || 0) - parseFloat(b.quantity_consumed || 0)), 0);

    // Purchase receipt items — actual purchase qty and unit
    const pris = await sql(`
      SELECT pri.quantity, pri.unit_quantity, pri.uom_id, pri.base_quantity
      FROM purchase_receipt_items pri WHERE pri.item_id='${id}'
    `).catch(()=>[]);
    const totalPurchaseReceipt = pris.reduce((s, p) => s + parseFloat(p.base_quantity || p.quantity || 0), 0);

    // Compute expected
    const purchased = mv['purchase_in']?.total || 0;
    const sold = mv['sale_out']?.total || 0;
    const returnIn = mv['return_in']?.total || 0;
    const returnOut = mv['return_out']?.total || 0;
    const adjIn = mv['adjust_in']?.total || 0;
    const adjOut = mv['adjust_out']?.total || 0;
    const writeOff = mv['write_off']?.total || 0;

    // expected = in - out
    const totalIn = purchased + returnIn + adjIn;
    const totalOut = sold + returnOut + adjOut + writeOff;
    const expected = totalIn - totalOut;
    const discrepancy = actualStock - expected;

    // UOM info
    const uoms = typeof item.uoms === 'string' ? JSON.parse(item.uoms) : item.uoms;
    const purchaseUom = uoms?.find(u => u.is_default_purchase);
    const salesUom = uoms?.find(u => u.is_default_sales);

    report.push({
      name, id,
      purchased, sold, returnIn, returnOut, adjIn, adjOut, writeOff,
      totalIn, totalOut, expected,
      actualStock, batchRemaining,
      discrepancy,
      purchaseUomFactor: purchaseUom?.qty_in_base || 1,
      salesUomFactor: salesUom?.qty_in_base || 1,
      totalPurchaseReceipt,
      smWarehouses: smRows.length,
      batchCount: batches.length
    });
  }

  // === STEP 3: Report ===
  const surplus = report.filter(r => r.discrepancy > 0.5);
  const deficit = report.filter(r => r.discrepancy < -0.5);
  const ok = report.filter(r => Math.abs(r.discrepancy) <= 0.5);
  const batchMismatch = report.filter(r => Math.abs(r.batchRemaining - r.actualStock) > 0.5);

  console.log(`\nإجمالي الأصناف: ${report.length}`);
  console.log(`✅ صحيحة: ${ok.length}`);
  console.log(`🔴 زيادة (فعلي > متوقع): ${surplus.length}`);
  console.log(`🟡 نقص (فعلي < متوقع): ${deficit.length}`);
  console.log(`⚠️ فرق بين batch_remaining و stock: ${batchMismatch.length}`);

  if (surplus.length > 0) {
    console.log('\n=== 🔴 أصناف بزيادة في المخزون ===');
    surplus.sort((a,b) => b.discrepancy - a.discrepancy);
    surplus.forEach((r, i) => {
      console.log(`\n${i+1}. ${r.name}`);
      console.log(`   شراء:${r.purchased} | بيع:${r.sold} | مرتجع_وارد:${r.returnIn} | مرتجع_صادر:${r.returnOut} | تعديل+:${r.adjIn} | تعديل-:${r.adjOut}`);
      console.log(`   إجمالي_دخول:${r.totalIn} | إجمالي_خروج:${r.totalOut}`);
      console.log(`   متوقع:${r.expected} | فعلي:${r.actualStock} | فرق:+${r.discrepancy.toFixed(0)}`);
      console.log(`   batch_remaining:${r.batchRemaining} | UOM شراء:x${r.purchaseUomFactor} بيع:x${r.salesUomFactor}`);
      console.log(`   purchase_receipts_base_qty:${r.totalPurchaseReceipt} | مستودعات:${r.smWarehouses} | دُفعات:${r.batchCount}`);
      // Flag potential UOM issue
      if (r.purchaseUomFactor > 1 && Math.abs(r.discrepancy) > r.purchaseUomFactor) {
        console.log(`   ⚠️ قد يكون سبب الزيادة خطأ في وحدة القياس (factor=${r.purchaseUomFactor})`);
      }
    });
  }

  if (deficit.length > 0) {
    console.log('\n=== 🟡 أصناف بنقص في المخزون (أكبر 10) ===');
    deficit.sort((a,b) => a.discrepancy - b.discrepancy);
    deficit.slice(0,10).forEach((r, i) => {
      console.log(`${i+1}. ${r.name}`);
      console.log(`   شراء:${r.purchased} | بيع:${r.sold} | مرتجع_صادر:${r.returnOut} | متوقع:${r.expected} | فعلي:${r.actualStock} | نقص:${r.discrepancy.toFixed(0)}`);
    });
  }

  if (batchMismatch.length > 0) {
    console.log('\n=== ⚠️ فرق بين batch_remaining و stock_management ===');
    batchMismatch.forEach((r, i) => {
      console.log(`${i+1}. ${r.name}: batch_remaining=${r.batchRemaining} stock=${r.actualStock} فرق=${(r.batchRemaining-r.actualStock).toFixed(0)}`);
    });
  }
}
main().catch(console.error);
