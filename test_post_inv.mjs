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

async function main() {
  // The trace test inserted a movement f55f5cc1-1e25-417d-8791-46d50605c0e0
  // Let's test post_inventory_movement on it
  const mvId = 'f55f5cc1-1e25-417d-8791-46d50605c0e0';

  // First check if the movement still exists (trace may have left it)
  const mv = await sql(`SELECT id, movement_type, quantity, item_id, batch_id, warehouse_id FROM public.inventory_movements WHERE id='${mvId}'`);
  console.log('Test movement:', mv.length > 0 ? JSON.stringify(mv[0]).slice(0,200) : 'NOT FOUND - was rolled back');

  // Find any recent return_in movement to test on
  const returnMvs = await sql(`
    SELECT id, movement_type, quantity, item_id, batch_id, warehouse_id, reference_table
    FROM public.inventory_movements 
    WHERE movement_type='return_in' ORDER BY created_at DESC LIMIT 3
  `);
  console.log('\nRecent return_in movements:', returnMvs.length);
  returnMvs.forEach(m => console.log(`  ${m.id} | qty:${m.quantity} | item:${m.item_id.slice(-8)} | ref:${m.reference_table}`));

  // Get the body of post_inventory_movement_core
  const fn = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='post_inventory_movement_core' AND pronamespace='public'::regnamespace LIMIT 1`);
  const body = fn[0]?.def || '';
  // Find jsonb_array_elements usage
  const lines = body.split('\n');
  const suspicious = lines
    .map((l, i) => ({l, i}))
    .filter(({l}) => l.includes('jsonb_array_elements') || l.includes('raise exception'));
  console.log('\npost_inventory_movement_core suspicious lines:');
  suspicious.forEach(({l, i}) => console.log(`  L${i+1}: ${l.trim()}`));

  // Also check post_inventory_movement wrapper
  const fn2 = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='post_inventory_movement' AND pronamespace='public'::regnamespace LIMIT 1`);
  console.log('\npost_inventory_movement body (first 30 lines):');
  fn2[0]?.def?.split('\n').slice(0, 30).forEach((l, i) => console.log(`  L${i+1}: ${l}`));

  // Now test it directly   
  if (returnMvs.length > 0) {
    for (const m of returnMvs.slice(0, 2)) {
      console.log(`\nTesting post_inventory_movement('${m.id}')`);
      const res = await sql(`SELECT public.post_inventory_movement('${m.id}'::uuid)`).catch(e => ({error: e.message}));
      if (res.error) console.log(`  ❌ FAILED: ${res.error.slice(0,300)}`);
      else console.log(`  ✅ OK: ${JSON.stringify(res)}`);
    }
  }

  // Also: check if there's a test movement from the trace  
  const traceMovs = await sql(`
    SELECT id, movement_type FROM public.inventory_movements 
    WHERE reference_table='sales_returns' AND movement_type='return_in' 
    ORDER BY created_at DESC LIMIT 5
  `);
  console.log('\nRecent return_in from sales_returns:', JSON.stringify(traceMovs));
}
main().catch(console.error);
