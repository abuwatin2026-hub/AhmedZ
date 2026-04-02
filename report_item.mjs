const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 800));
  return b;
}

const ITEM_ID = '878310b8-d146-4684-a6b2-5cbf72961c9d';

async function main() {
  console.log('=== معلومات الصنف ===');
  console.log('  شراب سفري منووع *24باكت*24حبه*9جم');
  console.log(`  ID: ${ITEM_ID}`);

  // UOM columns
  const uomCols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='item_uom_units' ORDER BY ordinal_position`);
  const uoms = await sql(`SELECT * FROM public.item_uom_units WHERE item_id='${ITEM_ID}'`);
  console.log(`\n=== وحدات القياس (${uoms.length}) ===`);
  uoms.forEach(u => console.log(`  ${JSON.stringify(u)}`));

  // Batch columns
  const batchCols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='batches' ORDER BY ordinal_position`);
  console.log('\nBatch columns:', batchCols.map(c=>c.column_name).join(', '));

  // Batches
  const batches = await sql(`SELECT * FROM public.batches WHERE item_id='${ITEM_ID}' ORDER BY created_at`);
  console.log(`\n=== الدُفعات (${batches.length}) ===`);
  batches.forEach(b => console.log(`  ${JSON.stringify(b).slice(0,200)}`));

  // Batch balances
  const bids = batches.map(b=>`'${b.id}'`).join(',');
  const bals = bids ? await sql(`SELECT * FROM public.batch_balances WHERE batch_id IN (${bids})`).catch(()=>[]) : [];
  console.log(`\n=== أرصدة الدُفعات ===`);
  bals.forEach(b => console.log(`  batch:${b.batch_id?.slice(0,8)} | available:${b.available_qty} | reserved:${b.reserved_qty} | qc:${b.qc_qty}`));

  // Stock
  const stock = await sql(`SELECT * FROM public.stock_management WHERE item_id='${ITEM_ID}'`);
  console.log(`\n=== المخزون الحالي ===`);
  stock.forEach(s => console.log(`  qty: ${s.quantity}`));

  // Movement summary
  const mvs = await sql(`
    SELECT movement_type, count(*) as cnt, sum(quantity) as total
    FROM public.inventory_movements WHERE item_id='${ITEM_ID}' GROUP BY movement_type
  `);
  console.log(`\n=== ملخص الحركات ===`);
  mvs.forEach(m => console.log(`  ${m.movement_type}: ${m.cnt} حركة | إجمالي: ${m.total}`));

  // Purchase details
  const purchases = await sql(`
    SELECT quantity, unit_cost, created_at::date as dt, LEFT(batch_id::text,8) as bid
    FROM public.inventory_movements WHERE item_id='${ITEM_ID}' AND movement_type='purchase_in' ORDER BY created_at
  `);
  console.log(`\n=== المشتريات (${purchases.length}) ===`);
  let tP = 0;
  purchases.forEach((p,i) => { tP += +p.quantity; console.log(`  ${i+1}. ${p.dt} | qty:${p.quantity} | cost:${p.unit_cost} | batch:${p.bid}`); });

  // Sales
  const sales = await sql(`
    SELECT quantity, unit_cost, created_at::date as dt, LEFT(batch_id::text,8) as bid, LEFT(reference_id,8) as oid
    FROM public.inventory_movements WHERE item_id='${ITEM_ID}' AND movement_type='sale_out' ORDER BY created_at
  `);
  console.log(`\n=== المبيعات (${sales.length}) ===`);
  let tS = 0;
  sales.forEach((s,i) => { tS += +s.quantity; console.log(`  ${i+1}. ${s.dt} | qty:${s.quantity} | cost:${s.unit_cost} | order:${s.oid} | batch:${s.bid}`); });

  // Returns
  const returns = await sql(`
    SELECT quantity, unit_cost, created_at::date as dt, LEFT(batch_id::text,8) as bid, LEFT(reference_id,8) as rid
    FROM public.inventory_movements WHERE item_id='${ITEM_ID}' AND movement_type='return_in' ORDER BY created_at
  `);
  console.log(`\n=== المرتجعات (${returns.length}) ===`);
  let tR = 0;
  returns.forEach((r,i) => { tR += +r.quantity; console.log(`  ${i+1}. ${r.dt} | qty:${r.quantity} | cost:${r.unit_cost} | ref:${r.rid} | batch:${r.bid}`); });

  // Other movements
  const others = await sql(`
    SELECT movement_type, quantity, unit_cost, created_at::date as dt, LEFT(batch_id::text,8) as bid
    FROM public.inventory_movements WHERE item_id='${ITEM_ID}' AND movement_type NOT IN ('purchase_in','sale_out','return_in') ORDER BY created_at
  `);
  if (others.length > 0) {
    console.log(`\n=== حركات أخرى (${others.length}) ===`);
    others.forEach(o => console.log(`  ${o.dt} | ${o.movement_type} | qty:${o.quantity} | batch:${o.bid}`));
  }

  // Prices
  const prices = await sql(`SELECT * FROM public.product_prices_multi_currency WHERE item_id='${ITEM_ID}'`);
  console.log(`\n=== الأسعار (${prices.length}) ===`);
  prices.forEach(p => console.log(`  ${p.currency}: ${p.price}`));

  const stockQty = parseFloat(stock[0]?.quantity || 0);
  const expected = tP - tS + tR;
  console.log(`\n━━━━━━━━━━━ التقرير الشامل ━━━━━━━━━━━`);
  console.log(`  الصنف: شراب سفري منووع *24باكت*24حبه*9جم`);
  console.log(`  إجمالي المشتريات: ${tP}`);
  console.log(`  إجمالي المبيعات: ${tS}`);
  console.log(`  إجمالي المرتجعات: ${tR}`);
  console.log(`  الرصيد المتوقع: ${expected}`);
  console.log(`  الرصيد الفعلي: ${stockQty}`);
  console.log(`  الفرق: ${expected - stockQty}`);
  console.log(`  ${Math.abs(expected - stockQty) < 1 ? '✅ متطابق' : '⚠️ يوجد فرق!'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}
main().catch(console.error);
