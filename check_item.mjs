const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
const ITEM_ID = '878310b8-d146-4684-a6b2-5cbf72961c9d';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 400));
  return b;
}

async function main() {
  const mvs = await sql(`
    SELECT movement_type, count(*) as cnt, sum(quantity) as total
    FROM public.inventory_movements WHERE item_id='${ITEM_ID}'
    GROUP BY movement_type ORDER BY movement_type
  `);
  console.log('=== حركات المخزون ===');
  mvs.forEach(m => console.log(`  ${m.movement_type}: ${m.cnt} حركة | الكمية: ${m.total}`));

  const sm = await sql(`SELECT available_quantity, reserved_quantity FROM public.stock_management WHERE item_id='${ITEM_ID}'`);
  console.log('\n=== المخزون الحالي ===');
  sm.forEach(s => console.log(`  متاح: ${s.available_quantity} | محجوز: ${s.reserved_quantity}`));

  const bats = await sql(`
    SELECT LEFT(id::text,8) as bid, quantity_received, quantity_consumed, status
    FROM public.batches WHERE item_id='${ITEM_ID}' ORDER BY created_at
  `);
  console.log('\n=== الدفعات ===');
  bats.forEach(b => console.log(`  batch:${b.bid} | وارد:${b.quantity_received} | مستهلك:${b.quantity_consumed} | status:${b.status}`));

  const rets = await sql(`
    SELECT sr.id, sr.order_id, sr.status, sr.total_refund_amount, sr.created_at
    FROM public.sales_returns sr
    WHERE sr.items::text LIKE '%${ITEM_ID}%'
  `).catch(()=>[]);
  console.log(`\n=== المرتجعات (${rets.length}) ===`);
  rets.forEach(r => console.log(`  return:${r.id?.slice(0,8)} | order:${r.order_id?.slice(0,8)} | status:${r.status} | refund:${r.total_refund_amount}`));

  // Total sold (sale_out) vs summary
  const sold = mvs.find(m => m.movement_type === 'sale_out');
  const purchased = mvs.find(m => m.movement_type === 'purchase_in');
  const adj = mvs.find(m => m.movement_type === 'adjust_in');
  const ret = mvs.find(m => m.movement_type === 'return_in');

  console.log('\n=== ملخص ===');
  console.log(`  مشتريات: ${purchased?.total || 0}`);
  console.log(`  مبيعات : ${sold?.total || 0}`);
  console.log(`  مرتجعات: ${ret?.total || 0}`);
  console.log(`  تعديلات: ${adj?.total || 0}`);
  console.log(`  الرصيد المتوقع: ${(+(purchased?.total||0)) - (+(sold?.total||0)) + (+(ret?.total||0)) + (+(adj?.total||0))}`);
  console.log(`  الرصيد الفعلي: ${sm.map(s=>s.available_quantity).join(', ')}`);
}
main().catch(console.error);
