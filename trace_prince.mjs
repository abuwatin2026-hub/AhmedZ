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
  // 1. Find item
  const items = await sql(`SELECT id, name::text, base_unit FROM menu_items WHERE name::text ILIKE '%برنس%عائلي%'`);
  if (!items.length) { console.log('Item not found!'); return; }
  const item = items[0];
  const id = item.id;
  const name = item.name?.match(/"ar":\s*"([^"]+)"/)?.[1] || item.name;
  console.log(`===== ${name} =====`);
  console.log(`ID: ${id}`);
  console.log(`Base unit: ${item.base_unit}`);

  // 2. UOM units
  console.log('\n--- وحدات القياس ---');
  const uoms = await sql(`
    SELECT u.uom_id, u.qty_in_base, u.is_default_purchase, u.is_default_sales,
      (SELECT um.name::text FROM uom um WHERE um.id = u.uom_id) as uom_name
    FROM item_uom_units u WHERE u.item_id='${id}'
  `);
  uoms.forEach(u => {
    const uName = u.uom_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || u.uom_name;
    console.log(`  ${uName} | معامل:${u.qty_in_base} | شراء:${u.is_default_purchase} | بيع:${u.is_default_sales}`);
  });

  // 3. Purchase receipts (actual purchases)
  console.log('\n--- فواتير الشراء (purchase_receipt_items) ---');
  const pris = await sql(`
    SELECT pri.quantity, pri.qty_base, pri.uom_id, pri.unit_cost, pri.total_cost,
      pri.created_at::date as dt,
      (SELECT um.name::text FROM uom um WHERE um.id = pri.uom_id) as uom_name
    FROM purchase_receipt_items pri WHERE pri.item_id='${id}'
    ORDER BY pri.created_at
  `);
  let totalPurchaseQty = 0, totalPurchaseBase = 0;
  pris.forEach(p => {
    const uName = p.uom_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || p.uom_name;
    totalPurchaseQty += parseFloat(p.quantity);
    totalPurchaseBase += parseFloat(p.qty_base);
    console.log(`  ${p.dt} | كمية:${p.quantity} ${uName} | base:${p.qty_base} | سعر:${p.unit_cost} | إجمالي:${p.total_cost}`);
  });
  console.log(`  ═══ إجمالي الشراء: ${totalPurchaseQty} (وحدة شراء) = ${totalPurchaseBase} (وحدة أساسية)`);

  // 4. ALL inventory movements chronologically
  console.log('\n--- حركات المخزون (بالترتيب) ---');
  const mvs = await sql(`
    SELECT im.movement_type, im.quantity, im.qty_base, im.uom_id,
      im.warehouse_id, im.reference_id, im.reference_table,
      im.created_at,
      (SELECT um.name::text FROM uom um WHERE um.id = im.uom_id) as uom_name,
      (SELECT w.name::text FROM warehouses w WHERE w.id = im.warehouse_id) as wh_name
    FROM inventory_movements im WHERE im.item_id='${id}'
    ORDER BY im.created_at
  `);
  const summary = {};
  mvs.forEach((m, i) => {
    const uName = m.uom_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || m.uom_name || '-';
    const wName = m.wh_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || m.wh_name?.slice(0,15) || '-';
    const type = m.movement_type;
    if (!summary[type]) summary[type] = { count: 0, total: 0 };
    summary[type].count++;
    summary[type].total += parseFloat(m.quantity);
    console.log(`  ${i+1}. ${m.created_at?.slice(0,10)} | ${type.padEnd(14)} | كمية:${m.quantity} | base:${m.qty_base||'-'} | UOM:${uName} | مستودع:${wName} | ref:${m.reference_table||'-'}/${m.reference_id?.slice(0,8)||'-'}`);
  });

  console.log('\n--- ملخص الحركات ---');
  Object.entries(summary).forEach(([t, s]) => {
    console.log(`  ${t}: ${s.count} حركة | إجمالي: ${s.total}`);
  });

  // 5. Returns
  console.log('\n--- المرتجعات ---');
  const returns = await sql(`
    SELECT sr.id, sr.return_type, sr.status, sr.created_at,
      sr.items::text as items_json
    FROM sales_returns sr
    WHERE sr.items::text ILIKE '%${id}%'
  `).catch(()=>[]);
  if (returns.length) {
    returns.forEach(r => console.log(`  ${r.return_type} | status:${r.status} | ${r.created_at}`));
  } else {
    console.log('  لا توجد مرتجعات');
  }

  // 6. Batches
  console.log('\n--- الدُفعات ---');
  const batches = await sql(`
    SELECT b.id, b.quantity_received, b.quantity_consumed, b.status,
      b.warehouse_id, b.created_at,
      (SELECT w.name::text FROM warehouses w WHERE w.id = b.warehouse_id) as wh_name
    FROM batches b WHERE b.item_id='${id}'
    ORDER BY b.created_at
  `);
  let totalBatchReceived = 0, totalBatchConsumed = 0;
  batches.forEach((b, i) => {
    const wName = b.wh_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || b.wh_name?.slice(0,15) || '-';
    const remaining = parseFloat(b.quantity_received) - parseFloat(b.quantity_consumed);
    totalBatchReceived += parseFloat(b.quantity_received);
    totalBatchConsumed += parseFloat(b.quantity_consumed);
    console.log(`  ${i+1}. وارد:${b.quantity_received} | مستهلك:${b.quantity_consumed} | متبقي:${remaining} | مستودع:${wName} | ${b.status} | ${b.created_at?.slice(0,10)}`);
  });
  console.log(`  ═══ إجمالي دُفعات: وارد=${totalBatchReceived} | مستهلك=${totalBatchConsumed} | متبقي=${totalBatchReceived-totalBatchConsumed}`);

  // 7. Stock management
  console.log('\n--- المخزون الحالي ---');
  const sm = await sql(`
    SELECT sm.available_quantity, sm.reserved_quantity, sm.unit, sm.warehouse_id,
      (SELECT w.name::text FROM warehouses w WHERE w.id = sm.warehouse_id) as wh_name
    FROM stock_management sm WHERE sm.item_id='${id}'
  `);
  let totalStock = 0;
  sm.forEach(s => {
    const wName = s.wh_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || s.wh_name?.slice(0,15) || '-';
    totalStock += parseFloat(s.available_quantity);
    console.log(`  مستودع ${wName}: ${s.available_quantity} (محجوز:${s.reserved_quantity}) | وحدة:${s.unit}`);
  });
  console.log(`  ═══ إجمالي المخزون: ${totalStock}`);

  // 8. التحليل النهائي
  console.log('\n===== التحليل النهائي =====');
  const purchaseIn = summary['purchase_in']?.total || 0;
  const saleOut = summary['sale_out']?.total || 0;
  const returnIn = summary['return_in']?.total || 0;
  const returnOut = summary['return_out']?.total || 0;
  const adjustIn = summary['adjust_in']?.total || 0;
  const adjustOut = summary['adjust_out']?.total || 0;

  const expected = purchaseIn - saleOut + returnIn - returnOut + adjustIn - adjustOut;
  const diff = totalStock - expected;

  console.log(`  شراء (purchase_in): +${purchaseIn}`);
  console.log(`  بيع (sale_out): -${saleOut}`);
  console.log(`  مرتجع وارد (return_in): +${returnIn}`);
  console.log(`  مرتجع صادر (return_out): -${returnOut}`);
  console.log(`  تعديل+ (adjust_in): +${adjustIn}`);
  console.log(`  تعديل- (adjust_out): -${adjustOut}`);
  console.log(`  ──────────────────`);
  console.log(`  المتوقع: ${expected}`);
  console.log(`  الفعلي: ${totalStock}`);
  console.log(`  الفرق: ${diff > 0 ? '+' : ''}${diff}`);
  console.log(`  فواتير الشراء (base): ${totalPurchaseBase}`);
  console.log(`  حركات الشراء: ${purchaseIn}`);
  console.log(`  تطابق فواتير/حركات: ${Math.abs(totalPurchaseBase - purchaseIn) < 0.5 ? '✅' : '❌'}`);
  console.log(`  النتيجة: ${Math.abs(diff) < 0.5 ? '✅ المخزون صحيح' : `❌ فرق ${diff > 0 ? 'زيادة' : 'نقص'} = ${Math.abs(diff)}`}`);
}
main().catch(console.error);
