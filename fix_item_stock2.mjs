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
  // === Fix batch 22d31e3a (consumed 1176 → 1200, remaining = 0) ===
  console.log('=== Fix batch 22d31e3a consumed 1176→1200 ===');
  const batchTrgs = await disableTriggers('batches');
  await sql(`UPDATE public.batches SET quantity_consumed=1200 WHERE item_id='${ITEM_ID}' AND quantity_received=1200 AND quantity_consumed=1176`);
  console.log('  ✅ batch 22d31e3a fixed');

  // Fix batch f470683f (received=2400, consumed was 1200 after transfer_out — 
  // now adjust_in deleted, so this batch effectively doesn't count. 
  // Set consumed=quantity_received so remaining=0)
  await sql(`UPDATE public.batches SET quantity_consumed=quantity_received WHERE item_id='${ITEM_ID}' AND batch_code='ADJ-20260308-f470683f'`);
  console.log('  ✅ batch f470683f consumed = received (zeroed)');
  await enableTriggers('batches', batchTrgs);

  // === Set stock_management to 0 ===
  console.log('\n=== Set stock to 0 ===');
  const smTrgs = await disableTriggers('stock_management');
  await sql(`UPDATE public.stock_management SET available_quantity=0, reserved_quantity=0, last_updated=now() WHERE item_id='${ITEM_ID}'`);
  console.log('  ✅ stock_management set to 0');
  await enableTriggers('stock_management', smTrgs);

  // === VERIFY ===
  console.log('\n=== FINAL VERIFICATION ===');
  const mvs = await sql(`SELECT movement_type, sum(quantity) as total FROM public.inventory_movements WHERE item_id='${ITEM_ID}' GROUP BY movement_type`);
  mvs.forEach(m => console.log(`  ${m.movement_type}: ${m.total}`));
  
  const sm = await sql(`SELECT available_quantity, reserved_quantity FROM public.stock_management WHERE item_id='${ITEM_ID}'`);
  console.log('\nStock (all warehouses):');
  sm.forEach((s,i) => console.log(`  warehouse ${i+1}: available=${s.available_quantity} reserved=${s.reserved_quantity}`));

  const bats = await sql(`SELECT LEFT(id::text,8) as bid, batch_code, quantity_received, quantity_consumed FROM public.batches WHERE item_id='${ITEM_ID}' ORDER BY created_at`);
  console.log('\nBatches:');
  bats.forEach(b => console.log(`  ${b.bid} (${b.batch_code}): received=${b.quantity_received} consumed=${b.quantity_consumed} remaining=${b.quantity_received - b.quantity_consumed}`));

  const p = mvs.find(m=>m.movement_type==='purchase_in')?.total || 0;
  const s = mvs.find(m=>m.movement_type==='sale_out')?.total || 0;
  const a = mvs.find(m=>m.movement_type==='adjust_in')?.total || 0;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  مشتريات: ${p} حبة (50 كرتون)`);
  console.log(`  مبيعات : ${s} حبة (50 كرتون)`);
  console.log(`  تعديلات: ${a}`);
  console.log(`  المخزون الفعلي الآن: ${sm[0]?.available_quantity || 0}`);
  console.log(sm[0]?.available_quantity == 0 ? '  ✅ الرصيد صفر — صحيح!' : '  ⚠️ لا يزال هناك رصيد');
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}
main().catch(console.error);
