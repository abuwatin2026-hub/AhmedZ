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
  const id = '98f406f7-631a-480f-997b-5dc1e3fd09d9';

  console.log('=== 1. الصنف ===');
  const item = await sql(`SELECT name::text, base_unit FROM menu_items WHERE id='${id}'`);
  console.log(`  الاسم: ${item[0].name}`);
  console.log(`  base_unit: ${item[0].base_unit}`);

  // UOM might use text id - check
  const uomTable = await sql(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='uom' AND column_name='id'`);
  console.log(`  uom.id type: ${uomTable[0]?.data_type}`);

  // Try looking up base_unit as text
  const baseUom = await sql(`SELECT id::text, name::text FROM uom WHERE id::text='${item[0].base_unit}'`).catch(() => []);
  if (baseUom.length) {
    console.log(`  الوحدة الأساسية: ${baseUom[0].name}`);
  } else {
    console.log(`  base_unit '${item[0].base_unit}' — هذا معرّف مخصص وليس UUID`);
  }

  console.log('\n=== 2. وحدات القياس المعرّفة للصنف ===');
  const uoms = await sql(`SELECT * FROM item_uom_units WHERE item_id='${id}'`);
  console.log(`  عدد وحدات القياس: ${uoms.length}`);
  for (const u of uoms) {
    console.log(`  uom_id=${u.uom_id} | qty_in_base=${u.qty_in_base} | شراء=${u.is_default_purchase} | بيع=${u.is_default_sales}`);
    // Try to get uom name
    const uomName = await sql(`SELECT name::text FROM uom WHERE id::text='${u.uom_id}'`).catch(() => []);
    if (uomName.length) console.log(`    → اسم الوحدة: ${uomName[0].name}`);
  }

  console.log('\n=== 3. فاتورة الشراء — التفصيل الكامل ===');
  const pri = await sql(`SELECT * FROM purchase_receipt_items WHERE item_id='${id}'`);
  for (const p of pri) {
    console.log(`  receipt_id: ${p.receipt_id}`);
    console.log(`  quantity (كمية بوحدة الشراء): ${p.quantity}`);
    console.log(`  qty_base (كمية بالوحدة الأساسية): ${p.qty_base}`);
    console.log(`  uom_id (وحدة الشراء): ${p.uom_id}`);
    console.log(`  unit_cost: ${p.unit_cost}`);
    console.log(`  total_cost: ${p.total_cost}`);
    
    // هل وحدة الشراء = الوحدة الأساسية؟
    console.log(`  وحدة الشراء = الوحدة الأساسية؟ ${p.uom_id === item[0].base_unit ? '✅ نعم' : '❌ لا — يوجد تحويل'}`);
    
    const ratio = parseFloat(p.qty_base) / parseFloat(p.quantity);
    console.log(`  معامل التحويل (qty_base/quantity): ${ratio}`);
    
    if (ratio !== 1) {
      console.log(`  ⚠️ تم شراء ${p.quantity} وحدة شراء = ${p.qty_base} وحدة أساسية`);
    } else {
      console.log(`  ✅ تم شراء ${p.quantity} وحدة (شراء = أساسية)`);
    }
  }

  // 4. Source receipt
  if (pri.length > 0) {
    console.log('\n=== 4. تفاصيل الفاتورة الأم ===');
    const pr = await sql(`SELECT id, supplier_name, total_amount, status, created_at FROM purchase_receipts WHERE id='${pri[0].receipt_id}'`);
    if (pr.length) {
      console.log(`  المورد: ${pr[0].supplier_name}`);
      console.log(`  إجمالي الفاتورة: ${pr[0].total_amount}`);
      console.log(`  الحالة: ${pr[0].status}`);
      console.log(`  التاريخ: ${pr[0].created_at}`);
    }
  }

  // 5. حركة الشراء في inventory_movements
  console.log('\n=== 5. حركة الشراء (inventory_movements) ===');
  const mv = await sql(`SELECT quantity, qty_base, uom_id FROM inventory_movements WHERE item_id='${id}' AND movement_type='purchase_in'`);
  mv.forEach(m => {
    console.log(`  quantity=${m.quantity} | qty_base=${m.qty_base} | uom_id=${m.uom_id}`);
  });

  console.log('\n=== 6. النتيجة ===');
  const pQty = pri.reduce((s,p) => s + parseFloat(p.quantity), 0);
  const pBase = pri.reduce((s,p) => s + parseFloat(p.qty_base), 0);
  const mQty = mv.reduce((s,m) => s + parseFloat(m.quantity), 0);
  console.log(`  فاتورة: quantity=${pQty} | qty_base=${pBase}`);
  console.log(`  حركة: quantity=${mQty}`);
  console.log(`  تطابق كمية الفاتورة مع الحركة: ${Math.abs(pBase - mQty) < 0.01 ? '✅' : '❌'}`);
}
main().catch(console.error);
