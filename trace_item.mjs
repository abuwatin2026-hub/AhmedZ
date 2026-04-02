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
  // 1. ALL inventory movements - chronological
  console.log('=== 1. كل حركات المخزون بالتسلسل الزمني ===');
  const allMvs = await sql(`
    SELECT id, movement_type, quantity, unit_cost, reference_table, reference_id,
      LEFT(batch_id::text,8) as bid, created_at, data
    FROM public.inventory_movements 
    WHERE item_id='${ITEM_ID}' ORDER BY created_at ASC
  `);
  allMvs.forEach((m, i) => {
    console.log(`  ${i+1}. [${m.created_at.slice(0,19)}] ${m.movement_type} | qty:${m.quantity} | cost:${m.unit_cost} | ref:${m.reference_table}:${m.reference_id?.slice(0,8)||'-'} | batch:${m.bid}`);
  });

  // 2. ALL orders that contain this item (including deleted — check order_line_items)
  console.log('\n=== 2. طلبات تحتوي على هذا الصنف ===');
  const orderItems = await sql(`
    SELECT oli.order_id, LEFT(oli.order_id::text,8) as oid, oli.quantity, oli.unit_price, oli.total,
      o.status, o.created_at, o.customer_name, o.total as order_total, o.currency
    FROM public.order_line_items oli
    JOIN public.orders o ON o.id = oli.order_id
    WHERE oli.item_id = '${ITEM_ID}'
    ORDER BY o.created_at ASC
  `).catch(()=>[]);
  orderItems.forEach((o,i) => {
    console.log(`  ${i+1}. order:${o.oid} | status:${o.status} | qty:${o.quantity} | price:${o.unit_price} | total:${o.total} | ${o.created_at?.slice(0,19)} | ${o.customer_name||'-'}`);
  });

  // 3. Check if there are deleted movements (from the cancelled orders we purged)
  // We can check sale_out movements for this item
  console.log('\n=== 3. حركات البيع (sale_out) لهذا الصنف ===');
  const saleOuts = await sql(`
    SELECT * FROM public.inventory_movements 
    WHERE item_id='${ITEM_ID}' AND movement_type='sale_out'
  `);
  console.log(`  عدد حركات البيع: ${saleOuts.length}`);
  saleOuts.forEach(s => console.log(`  ${JSON.stringify(s).slice(0,200)}`));

  // 4. Purchase receipts
  console.log('\n=== 4. فواتير الشراء ===');
  const receipts = await sql(`
    SELECT pri.*, pr.supplier_id, pr.created_at as receipt_date
    FROM public.purchase_receipt_items pri
    JOIN public.purchase_receipts pr ON pr.id = pri.receipt_id
    WHERE pri.item_id = '${ITEM_ID}'
    ORDER BY pr.created_at ASC
  `).catch(()=>[]);
  receipts.forEach((r,i) => {
    console.log(`  ${i+1}. ${JSON.stringify(r).slice(0,250)}`);
  });

  // 5. Sales returns for this item
  console.log('\n=== 5. المرتجعات ===');
  const returns = await sql(`
    SELECT sr.id, LEFT(sr.id::text,8) as rid, sr.order_id, LEFT(sr.order_id::text,8) as oid,
      sr.status, sr.total_refund_amount, sr.items, sr.created_at
    FROM public.sales_returns sr
    WHERE sr.items::text LIKE '%${ITEM_ID}%'
    ORDER BY sr.created_at ASC
  `).catch(()=>[]);
  returns.forEach((r,i) => {
    console.log(`  ${i+1}. return:${r.rid} | order:${r.oid} | status:${r.status} | refund:${r.total_refund_amount} | ${r.created_at?.slice(0,19)}`);
    console.log(`     items: ${JSON.stringify(r.items).slice(0,200)}`);
  });

  // 6. Batches detail — quantity_received vs quantity_consumed
  console.log('\n=== 6. تفاصيل الدفعات ===');
  const batches = await sql(`
    SELECT LEFT(id::text,8) as bid, batch_code, quantity_received, quantity_consumed,
      unit_cost, cost_per_unit, created_at, status
    FROM public.batches WHERE item_id='${ITEM_ID}' ORDER BY created_at ASC
  `);
  batches.forEach((b,i) => {
    console.log(`  ${i+1}. batch:${b.bid} | code:${b.batch_code||'-'} | received:${b.quantity_received} | consumed:${b.quantity_consumed} | cost:${b.unit_cost} | status:${b.status} | ${b.created_at?.slice(0,19)}`);
  });

  // 7. Check batch_balances
  console.log('\n=== 7. أرصدة الدفعات الحالية ===');
  const bals = await sql(`
    SELECT LEFT(bb.batch_id::text,8) as bid, bb.available_qty, bb.reserved_qty, bb.qc_qty
    FROM public.batch_balances bb
    JOIN public.batches b ON b.id = bb.batch_id
    WHERE b.item_id='${ITEM_ID}'
  `).catch(()=>[]);
  bals.forEach(b => console.log(`  batch:${b.bid} | available:${b.available_qty} | reserved:${b.reserved_qty} | qc:${b.qc_qty}`));

  // 8. stock_management columns
  const smCols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='stock_management' ORDER BY ordinal_position`);
  const sm = await sql(`SELECT * FROM public.stock_management WHERE item_id='${ITEM_ID}'`);
  console.log('\n=== 8. سجل المخزون ===');
  sm.forEach(s => console.log(`  ${JSON.stringify(s).slice(0,300)}`));

  // 9. Check if any orders referencing this item still exist
  console.log('\n=== 9. طلبات مرتبطة بحركات هذا الصنف ===');
  const orderRefs = allMvs.filter(m => m.reference_table === 'orders' && m.reference_id);
  for (const ref of orderRefs) {
    const ord = await sql(`SELECT id, status, total, created_at FROM public.orders WHERE id='${ref.reference_id}'`).catch(()=>[]);
    if (ord.length > 0) {
      console.log(`  order:${ref.reference_id.slice(0,8)} | EXISTS | status:${ord[0].status} | total:${ord[0].total}`);
    } else {
      console.log(`  order:${ref.reference_id.slice(0,8)} | DELETED/NOT FOUND`);
    }
  }
}
main().catch(console.error);
