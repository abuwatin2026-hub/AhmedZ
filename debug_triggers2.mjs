const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 800));
  return b;
}
const fs = await import('fs');

async function main() {
  // Get all trigger functions for inventory_movements via pg_trigger
  const trigFns = await sql(`
    SELECT DISTINCT p.proname, pg_get_functiondef(p.oid) as body
    FROM pg_trigger trg
    JOIN pg_proc p ON p.oid = trg.tgfoid
    JOIN pg_class c ON c.oid = trg.tgrelid
    WHERE c.relname = 'inventory_movements'
    AND c.relnamespace = 'public'::regnamespace
    ORDER BY p.proname
  `);
  
  console.log(`Found ${trigFns.length} trigger functions on inventory_movements:`);
  trigFns.forEach(f => console.log(`  - ${f.proname}`));
  
  // Search all trigger bodies for jsonb_array_elements or "cannot extract"
  const problematic = [];
  for (const f of trigFns) {
    const body = f.body || '';
    if (body.includes('jsonb_array_elements') || body.includes('cannot extract') || body.includes('->>') ) {
      const lines = body.split('\n');
      const hits = lines
        .map((l, i) => ({ line: i+1, text: l }))
        .filter(l => l.text.includes('jsonb_array_elements') || l.text.includes('cannot extract') || l.text.includes('raise exception'));
      if (hits.length > 0) {
        problematic.push({ fn: f.proname, hits });
      }
    }
  }
  
  console.log('\nTrigger functions with jsonb/raise operations:');
  if (problematic.length === 0) {
    console.log('  (none)');
  }
  problematic.forEach(p => {
    console.log(`\n  ${p.fn}:`);
    p.hits.forEach(h => console.log(`    L${h.line}: ${h.text.trim()}`));
  });
  
  // Save all bodies to file for full inspection
  const allBodies = trigFns.map(f => `\n${'='.repeat(60)}\n-- TRIGGER FN: ${f.proname}\n${'='.repeat(60)}\n${f.body}`).join('\n');
  fs.writeFileSync('./all_inventory_triggers.sql', allBodies, 'utf8');
  console.log('\nAll trigger bodies saved to all_inventory_triggers.sql');
  
  // Actually test: try inserting a dummy return_in movement manually with service role to see exact error
  // First find a real batch
  const batch = await sql(`SELECT b.id, b.item_id, b.warehouse_id, b.unit_cost FROM public.batches b WHERE b.unit_cost > 0 LIMIT 1`).catch(()=>[]);
  if (batch.length) {
    console.log('\nTest batch:', batch[0].id, '| item:', batch[0].item_id, '| wh:', batch[0].warehouse_id);
    
    // Try inserting a return_in movement
    const testInsert = await sql(`
      INSERT INTO public.inventory_movements(
        item_id, movement_type, quantity, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_by, data,
        batch_id, warehouse_id
      )
      VALUES (
        '${batch[0].item_id}'::text,
        'return_in',
        1,
        ${batch[0].unit_cost},
        ${batch[0].unit_cost},
        'sales_returns',
        'test-delete-me',
        now(),
        null,
        '{"test": true}'::jsonb,
        '${batch[0].id}'::uuid,
        '${batch[0].warehouse_id}'::uuid
      )
      RETURNING id
    `).catch(e => ({ error: e.message }));
    
    if (testInsert.error) {
      console.log('\n❌ Test insert FAILED:', testInsert.error.slice(0, 500));
    } else {
      console.log('\n✅ Test insert SUCCESS, id:', testInsert[0]?.id);
      // Delete it
      await sql(`DELETE FROM public.inventory_movements WHERE id='${testInsert[0].id}'`).catch(()=>{});
    }
  }
}

main().catch(console.error);
