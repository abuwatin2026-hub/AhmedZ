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
  // Test recompute_stock_for_item
  const item = '878310b8-d146-4684-a6b2-5cbf72961c9d';
  const wh = '7628598d-3c02-4a55-b7db-76df1c421175';
  const order = 'd80638a8-03bd-48c2-9387-20f84ce27f4c';
  
  const r1 = await sql(`SELECT public.recompute_stock_for_item('${item}', '${wh}'::uuid)`).catch(e => ({error: e.message}));
  console.log('recompute_stock_for_item:', r1.error ? '❌ '+r1.error.slice(0,200) : '✅ OK');
  
  // Test recompute_order_return_status
  const r2 = await sql(`SELECT public.recompute_order_return_status('${order}'::uuid)`).catch(e => ({error: e.message}));
  console.log('recompute_order_return_status:', r2.error ? '❌ '+r2.error.slice(0,200) : '✅ OK');

  // Check body of recompute_order_return_status for jsonb_array_elements
  const fn = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='recompute_order_return_status' AND pronamespace='public'::regnamespace LIMIT 1`);
  const body = fn[0]?.def || '';
  const lines = body.split('\n').filter(l => l.includes('jsonb_array_elements'));
  console.log('\nrecompute_order_return_status jsonb_array_elements lines:', lines.join('\n  '));

  // Now: perform FULL process_sales_return to see what actually happens
  // At this point all the checks passed. The error from browser is 22023.
  // Let's look at whether there's a trigger on sales_returns UPDATE that causes the error
  const triggers = await sql(`
    SELECT t.trigger_name, t.event_manipulation, p.proname
    FROM information_schema.triggers t
    JOIN pg_proc p ON p.proname = t.event_object_table || '_' || lower(t.trigger_name)
    WHERE t.event_object_table = 'sales_returns' AND t.trigger_schema = 'public'
    LIMIT 10
  `).catch(() => sql(`
    SELECT DISTINCT t.trigger_name, t.event_manipulation
    FROM information_schema.triggers t
    WHERE t.event_object_table = 'sales_returns' AND t.trigger_schema = 'public'
    ORDER BY t.trigger_name
  `));
  console.log('\nTriggers on sales_returns:');
  triggers.forEach(t => console.log(`  ${t.trigger_name} [${t.event_manipulation}]`));
  
  // Check each trigger body for jsonb_array_elements
  const trigFns = await sql(`
    SELECT DISTINCT p.proname, pg_get_functiondef(p.oid) as body
    FROM pg_trigger trg
    JOIN pg_proc p ON p.oid = trg.tgfoid
    JOIN pg_class c ON c.oid = trg.tgrelid
    WHERE c.relname = 'sales_returns' AND c.relnamespace = 'public'::regnamespace
    ORDER BY p.proname
  `);
  console.log('\nTrigger functions on sales_returns:', trigFns.map(f=>f.proname).join(', '));
  for (const f of trigFns) {
    const body2 = f.body || '';
    const badLines = body2.split('\n').filter(l => l.includes('jsonb_array_elements'));
    if (badLines.length > 0) {
      console.log(`\n⚠️  ${f.proname} uses jsonb_array_elements:`);
      badLines.forEach(l => console.log(`    ${l.trim()}`));
    }
  }
  
  // Also check if there's a validation trigger that might be the cause
  const valTrig = await sql(`
    SELECT p.proname, pg_get_functiondef(p.oid) as def
    FROM pg_proc p
    WHERE p.proname ILIKE '%return%' AND pronamespace='public'::regnamespace
    AND pg_get_functiondef(p.oid) ILIKE '%jsonb_array_elements%'
    LIMIT 5
  `).catch(()=>[]);
  if (valTrig.length > 0) {
    console.log('\nFunctions with jsonb_array_elements related to returns:');
    valTrig.forEach(f => {
      console.log(`\n  ${f.proname}:`);
      f.def.split('\n').filter(l => l.includes('jsonb_array_elements')).forEach(l => console.log(`    ${l.trim()}`));
    });
  }
}
main().catch(console.error);
