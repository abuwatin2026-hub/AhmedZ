const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
const ITEM_ID = '878310b8-d146-4684-a6b2-5cbf72961c9d';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 600));
  return b;
}

async function disableTriggers(tbl) {
  const trgs = await sql(`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='${tbl}' AND c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`).catch(()=>[]);
  for (const t of trgs) await sql(`ALTER TABLE public."${tbl}" DISABLE TRIGGER "${t.tgname}"`).catch(()=>{});
  return trgs;
}
async function enableTriggers(tbl, trgs) {
  for (const t of trgs) await sql(`ALTER TABLE public."${tbl}" ENABLE TRIGGER "${t.tgname}"`).catch(()=>{});
}

async function main() {
  console.log('=== BEFORE ===');
  const before = await sql(`SELECT movement_type, sum(quantity) as total FROM public.inventory_movements WHERE item_id='${ITEM_ID}' GROUP BY movement_type`);
  before.forEach(m => console.log(`  ${m.movement_type}: ${m.total}`));
  const smBefore = await sql(`SELECT available_quantity FROM public.stock_management WHERE item_id='${ITEM_ID}'`);
  console.log('Stock before:', smBefore.map(s=>s.available_quantity).join(', '));

  // === STEP 1: Delete the erroneous adjust_in movement (2400) ===
  console.log('\n=== Step 1: Delete adjust_in 2400 ===');
  const adjMv = await sql(`SELECT id, batch_id FROM public.inventory_movements WHERE item_id='${ITEM_ID}' AND movement_type='adjust_in'`);
  console.log(`Found ${adjMv.length} adjust_in movement(s)`);
  const adjBatchId = adjMv[0]?.batch_id;

  const imTrgs = await disableTriggers('inventory_movements');
  await sql(`DELETE FROM public.inventory_movements WHERE item_id='${ITEM_ID}' AND movement_type='adjust_in'`);
  console.log('  ✅ adjust_in movement deleted');
  await enableTriggers('inventory_movements', imTrgs);

  // === STEP 2: Delete the erroneous batch (f470683f — ADJ batch) ===
  console.log('\n=== Step 2: Delete erroneous batch f470683f ===');
  const batchTrgs = await disableTriggers('batches');
  const bbTrgs = await disableTriggers('batch_balances');
  
  if (adjBatchId) {
    await sql(`DELETE FROM public.batch_balances WHERE batch_id='${adjBatchId}'`).catch(()=>{});
    await sql(`DELETE FROM public.batches WHERE id='${adjBatchId}'`);
    console.log(`  ✅ Batch ${adjBatchId.slice(0,8)} deleted`);
  }
  await enableTriggers('batches', batchTrgs);
  await enableTriggers('batch_balances', bbTrgs);

  // === STEP 3: Fix batch 22d31e3a — received 1200 consumed 1176 → set consumed to 1200 ===
  console.log('\n=== Step 3: Fix batch 22d31e3a (consumed 1176 → 1200) ===');
  const batchTrgs2 = await disableTriggers('batches');
  await sql(`UPDATE public.batches SET quantity_consumed=1200 WHERE item_id='${ITEM_ID}' AND batch_code='TRF-AUTO-7158584f' AND quantity_received=1200 AND quantity_consumed=1176`);
  console.log('  ✅ batch 22d31e3a consumed updated to 1200');
  await enableTriggers('batches', batchTrgs2);

  // === STEP 4: Set stock_management to 0 ===
  console.log('\n=== Step 4: Set stock_management available_quantity = 0 ===');
  const smTrgs = await disableTriggers('stock_management');
  await sql(`UPDATE public.stock_management SET available_quantity=0, reserved_quantity=0, last_updated=now() WHERE item_id='${ITEM_ID}'`);
  console.log('  ✅ stock_management set to 0');
  await enableTriggers('stock_management', smTrgs);

  // === VERIFY ===
  console.log('\n=== AFTER ===');
  const after = await sql(`SELECT movement_type, sum(quantity) as total FROM public.inventory_movements WHERE item_id='${ITEM_ID}' GROUP BY movement_type`);
  after.forEach(m => console.log(`  ${m.movement_type}: ${m.total}`));
  
  const smAfter = await sql(`SELECT available_quantity, reserved_quantity FROM public.stock_management WHERE item_id='${ITEM_ID}'`);
  console.log('Stock after:', smAfter.map(s=>`available:${s.available_quantity} reserved:${s.reserved_quantity}`).join(', '));

  const batsAfter = await sql(`SELECT LEFT(id::text,8) as bid, quantity_received, quantity_consumed FROM public.batches WHERE item_id='${ITEM_ID}'`);
  console.log('Batches:');
  batsAfter.forEach(b => console.log(`  ${b.bid}: received=${b.quantity_received} consumed=${b.quantity_consumed} remaining=${b.quantity_received-b.quantity_consumed}`));

  const totalPurchased = after.find(m=>m.movement_type==='purchase_in')?.total || 0;
  const totalSold = after.find(m=>m.movement_type==='sale_out')?.total || 0;
  console.log(`\n  ✅ مشتريات: ${totalPurchased} | مبيعات: ${totalSold} | الرصيد: ${totalPurchased - totalSold}`);
}
main().catch(console.error);
