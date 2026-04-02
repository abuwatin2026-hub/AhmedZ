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
  // 1. What movement types exist?
  console.log('=== كل أنواع الحركات الموجودة في النظام ===');
  const types = await sql(`SELECT movement_type, count(*) as cnt, sum(quantity) as total FROM public.inventory_movements GROUP BY movement_type ORDER BY movement_type`);
  types.forEach(t => console.log(`  ${t.movement_type}: ${t.cnt} حركة | إجمالي: ${t.total}`));

  // 2. For the 5 surplus items — deep dive
  const surplusItems = [
    { name: 'شربه شوفان كويكر', id: null },
    { name: 'عصير ميرا وسط', id: null },
    { name: 'زيت امل', id: null },
    { name: 'عصير ميرا صغير', id: null },
    { name: 'عصير ميرا عائلي', id: null },
  ];

  console.log('\n=== تفاصيل الأصناف ذات الزيادة ===');
  for (const item of surplusItems) {
    const found = await sql(`SELECT id, name::text FROM public.menu_items WHERE name::text ILIKE '%${item.name}%' LIMIT 1`);
    if (found.length === 0) { console.log(`  ${item.name}: NOT FOUND`); continue; }
    const iid = found[0].id;
    
    // ALL movements for this item
    const mvs = await sql(`
      SELECT movement_type, sum(quantity) as total, count(*) as cnt
      FROM public.inventory_movements WHERE item_id='${iid}'
      GROUP BY movement_type ORDER BY movement_type
    `);
    
    const stock = await sql(`SELECT sum(available_quantity::numeric) as s FROM public.stock_management WHERE item_id='${iid}'`);
    const actualStock = parseFloat(stock[0].s || 0);
    
    // Also check sales_returns for this item
    const returns = await sql(`
      SELECT count(*) as cnt FROM public.sales_returns sr
      WHERE sr.items::text LIKE '%${iid}%'
    `).catch(()=>[{cnt:0}]);
    
    // Also check if there are purchase_return_out movements
    const allTypes = Object.fromEntries(mvs.map(m => [m.movement_type, parseFloat(m.total)]));
    
    const purchased = allTypes['purchase_in'] || 0;
    const sold = allTypes['sale_out'] || 0;
    const returnIn = allTypes['return_in'] || 0;
    const adjIn = allTypes['adjust_in'] || 0;
    const adjOut = allTypes['adjust_out'] || 0;
    const writeOff = allTypes['write_off'] || 0;
    const expired = allTypes['expired'] || 0;
    const purchaseReturn = allTypes['purchase_return_out'] || allTypes['purchase_return'] || 0;
    
    const expected = purchased - sold + returnIn + adjIn - adjOut - writeOff - purchaseReturn;
    const name = found[0].name?.match(/"ar":\s*"([^"]+)"/)?.[1] || found[0].name;
    
    console.log(`\n${name}:`);
    mvs.forEach(m => console.log(`  - ${m.movement_type}: qty=${m.total} (${m.cnt} حركات)`));
    console.log(`  مرتجعات مسجلة في sales_returns: ${returns[0].cnt}`);
    console.log(`  المخزون الفعلي: ${actualStock}`);
    console.log(`  المتوقع (شامل كل الحركات): ${expected}`);
    console.log(`  الفرق: ${actualStock - expected > 0 ? '+' : ''}${(actualStock - expected).toFixed(0)}`);
  }

  // 3. Confirm: is the deficit in "نقص" items really from deleted orders?
  console.log('\n=== تأكيد سبب النقص في الأصناف الأخرى ===');
  // Compare sum of all sale_out vs what stock says was consumed
  const totalSaleOut = await sql(`SELECT sum(quantity) as total FROM public.inventory_movements WHERE movement_type='sale_out'`);
  const totalPurchaseIn = await sql(`SELECT sum(quantity) as total FROM public.inventory_movements WHERE movement_type='purchase_in'`);
  const totalReturnIn = await sql(`SELECT sum(quantity) as total FROM public.inventory_movements WHERE movement_type='return_in'`);
  const totalStock = await sql(`SELECT sum(available_quantity::numeric) as total FROM public.stock_management`);
  const totalAdjIn = await sql(`SELECT sum(quantity) as total FROM public.inventory_movements WHERE movement_type='adjust_in'`);
  
  console.log(`إجمالي المشتريات: ${totalPurchaseIn[0].total}`);
  console.log(`إجمالي المبيعات: ${totalSaleOut[0].total}`);
  console.log(`إجمالي المرتجعات: ${totalReturnIn[0].total}`);
  console.log(`إجمالي التعديلات+: ${totalAdjIn[0].total}`);
  console.log(`المخزون الفعلي الكلي: ${totalStock[0].total}`);
  console.log(`المتوقع الكلي = مشتريات - مبيعات + مرتجعات + تعديلات = ${parseFloat(totalPurchaseIn[0].total||0) - parseFloat(totalSaleOut[0].total||0) + parseFloat(totalReturnIn[0].total||0) + parseFloat(totalAdjIn[0].total||0)}`);
}
main().catch(console.error);
