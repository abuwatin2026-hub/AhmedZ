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
  const items = await sql(`SELECT id, name::text, base_unit FROM menu_items WHERE name::text ILIKE '%ميرا%عائلي%'`);
  if (!items.length) { console.log('Item not found! Trying broader search...'); 
    const items2 = await sql(`SELECT id, name::text FROM menu_items WHERE name::text ILIKE '%ميرا%'`);
    items2.forEach(i=>console.log(i.id, i.name));
    return;
  }
  const item = items[0];
  const id = item.id;
  const nameFull = item.name;
  const nameAr = nameFull?.match(/"ar":\s*"([^"]+)"/)?.[1] || nameFull;
  console.log(`===== ${nameAr} =====`);
  console.log(`ID: ${id} | base_unit: ${item.base_unit}`);

  // 2. UOM units
  console.log('\n--- وحدات القياس ---');
  const uoms = await sql(`
    SELECT u.uom_id, u.qty_in_base, u.is_default_purchase, u.is_default_sales,
      (SELECT um.name::text FROM uom um WHERE um.id = u.uom_id) as uom_name
    FROM item_uom_units u WHERE u.item_id='${id}'
  `);
  if (!uoms.length) console.log('  ❌ لا توجد وحدات قياس محددة');
  uoms.forEach(u => console.log(`  ${u.uom_name} | معامل:${u.qty_in_base} | شراء:${u.is_default_purchase} | بيع:${u.is_default_sales}`));

  // 3. Purchase receipts
  console.log('\n--- فواتير الشراء ---');
  const pris = await sql(`
    SELECT pri.quantity, pri.qty_base, pri.uom_id, pri.unit_cost, pri.total_cost, pri.created_at::date as dt,
      (SELECT um.name::text FROM uom um WHERE um.id = pri.uom_id) as uom_name
    FROM purchase_receipt_items pri WHERE pri.item_id='${id}' ORDER BY pri.created_at
  `);
  let totalPurchasedQty = 0, totalPurchasedBase = 0;
  if (!pris.length) console.log('  لا توجد فواتير شراء');
  pris.forEach(p => {
    const ratio = parseFloat(p.qty_base)/parseFloat(p.quantity);
    totalPurchasedQty += parseFloat(p.quantity);
    totalPurchasedBase += parseFloat(p.qty_base);
    console.log(`  ${p.dt} | qty=${p.quantity} ${p.uom_name||p.uom_id} | base=${p.qty_base} | تحويل=${ratio} | سعر=${p.unit_cost}`);
  });
  console.log(`  ═══ إجمالي الشراء: ${totalPurchasedQty} (وحدة شراء) | ${totalPurchasedBase} (وحدة أساسية)`);

  // 4. ALL movements
  console.log('\n--- حركات المخزون (بالترتيب) ---');
  const mvs = await sql(`
    SELECT im.movement_type, im.quantity, im.qty_base, im.warehouse_id, im.reference_id, im.reference_table, im.created_at,
      (SELECT w.name::text FROM warehouses w WHERE w.id=im.warehouse_id) as wh_name
    FROM inventory_movements im WHERE im.item_id='${id}' ORDER BY im.created_at
  `);
  const whStock = {};
  const summary = {};
  mvs.forEach((m,i) => {
    const wName = m.wh_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || m.warehouse_id?.slice(0,8) || '-';
    const wh = m.warehouse_id;
    if (!whStock[wh]) whStock[wh] = { name: wName, qty: 0 };
    if (!summary[m.movement_type]) summary[m.movement_type] = { count: 0, total: 0 };
    summary[m.movement_type].count++;
    summary[m.movement_type].total += parseFloat(m.quantity);
    const isIn = ['purchase_in','transfer_in','return_in','adjust_in'].includes(m.movement_type);
    whStock[wh].qty += isIn ? parseFloat(m.quantity) : -parseFloat(m.quantity);
    console.log(`  ${(i+1).toString().padStart(2)}. ${m.created_at?.slice(0,10)} | ${m.movement_type.padEnd(14)} | qty=${String(m.quantity).padStart(5)} | ${wName} | stock→${whStock[wh].qty}`);
  });

  console.log('\n--- ملخص الحركات ---');
  Object.entries(summary).forEach(([t,s]) => console.log(`  ${t.padEnd(16)}: ${s.count} حركة | مجموع=${s.total}`));

  const purchaseIn = summary['purchase_in']?.total || 0;
  const saleOut = summary['sale_out']?.total || 0;
  const returnIn = summary['return_in']?.total || 0;
  const returnOut = summary['return_out']?.total || 0;
  const adjustIn = summary['adjust_in']?.total || 0;
  const adjustOut = summary['adjust_out']?.total || 0;

  // 5. Stock management
  console.log('\n--- المخزون الحالي (stock_management) ---');
  const sm = await sql(`
    SELECT sm.warehouse_id, sm.available_quantity, sm.unit,
      (SELECT w.name::text FROM warehouses w WHERE w.id=sm.warehouse_id) as wh_name
    FROM stock_management sm WHERE sm.item_id='${id}'
  `);
  let totalStock = 0;
  sm.forEach(s => {
    const wName = s.wh_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || s.warehouse_id?.slice(0,8);
    const calcQty = whStock[s.warehouse_id]?.qty || 0;
    const diff = parseFloat(s.available_quantity) - calcQty;
    totalStock += parseFloat(s.available_quantity);
    console.log(`  ${wName}: فعلي=${s.available_quantity} | محسوب=${calcQty} | فرق=${diff>0?'+':''}${diff} ${Math.abs(diff)<0.5?'✅':'❌'} | وحدة=${s.unit}`);
  });
  console.log(`  ═══ إجمالي stock_management: ${totalStock}`);

  // 6. Returns
  console.log('\n--- المرتجعات ---');
  const returns = await sql(`
    SELECT sr.id, sr.return_type, sr.status, sr.created_at, sr.items::text
    FROM sales_returns sr WHERE sr.items::text ILIKE '%${id}%'
  `).catch(()=>[]);
  if (!returns.length) console.log('  لا توجد مرتجعات');
  else returns.forEach(r => console.log(`  ${r.return_type} | ${r.status} | ${r.created_at?.slice(0,10)}`));

  // 7. Transfers detail
  if (summary['transfer_out'] || summary['transfer_in']) {
    console.log('\n--- تفاصيل التحويلات ---');
    const tRefs = [...new Set(mvs.filter(m=>m.movement_type.startsWith('transfer')).map(m=>m.reference_id))];
    for (const ref of tRefs) {
      const relMvs = mvs.filter(m=>m.reference_id===ref && m.movement_type.startsWith('transfer'));
      const outTotal = relMvs.filter(m=>m.movement_type==='transfer_out').reduce((s,m)=>s+parseFloat(m.quantity),0);
      const inTotal = relMvs.filter(m=>m.movement_type==='transfer_in').reduce((s,m)=>s+parseFloat(m.quantity),0);
      const ok = Math.abs(outTotal-inTotal)<0.01;
      console.log(`  تحويل ${ref?.slice(0,8)}: خروج=${outTotal} دخول=${inTotal} ${ok?'✅ متوازن':'❌ غير متوازن!'}`);
    }
  }

  // 8. Final analysis
  const calcTotal = Object.values(whStock).reduce((s,w)=>s+w.qty, 0);
  console.log('\n===== التحليل النهائي =====');
  console.log(`  المشترى (purchase_in):   +${purchaseIn}`);
  console.log(`  المباع (sale_out):        -${saleOut}`);
  console.log(`  مرتجع وارد (return_in):  +${returnIn}`);
  console.log(`  مرتجع صادر (return_out): -${returnOut}`);
  console.log(`  تعديل+ (adjust_in):       +${adjustIn}`);
  console.log(`  تعديل- (adjust_out):      -${adjustOut}`);
  console.log(`  ──────────────────`);
  const expectedTotal = purchaseIn - saleOut + returnIn - returnOut + adjustIn - adjustOut;
  console.log(`  المتوقع (من الحركات): ${expectedTotal}`);
  console.log(`  فعلي (stock_management): ${totalStock}`);
  const diffTotal = totalStock - expectedTotal;
  console.log(`  الفرق: ${diffTotal>0?'+':''}${diffTotal} ${Math.abs(diffTotal)<0.5?'✅ صحيح':'❌ خطأ'}`);
  console.log(`  تطابق فواتير مع purchase_in: ${Math.abs(totalPurchasedBase-purchaseIn)<0.5?'✅':'❌ فرق='+(totalPurchasedBase-purchaseIn)}`);
}
main().catch(console.error);
