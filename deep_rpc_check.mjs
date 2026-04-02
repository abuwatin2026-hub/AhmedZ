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
  // 1. All triggers on inventory_movements
  console.log('====== Triggers on inventory_movements ======');
  const triggers = await sql(`
    SELECT trigger_name, event_manipulation, action_timing, action_statement
    FROM information_schema.triggers
    WHERE event_object_table = 'inventory_movements'
    ORDER BY trigger_name
  `);
  triggers.forEach(t => console.log(`  ${t.action_timing} ${t.event_manipulation}: ${t.trigger_name} → ${t.action_statement}`));

  // 2. Get code of each trigger function
  console.log('\n====== Trigger Functions ======');
  const tFns = await sql(`
    SELECT DISTINCT trigger_name,
      (SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname = substring(t.action_statement FROM 'EXECUTE FUNCTION public\\.([^(]+)')) as fn_code
    FROM information_schema.triggers t
    WHERE event_object_table = 'inventory_movements'
  `);
  tFns.forEach(f => {
    console.log(`\n--- ${f.trigger_name} ---`);
    console.log(f.fn_code || '(no code found)');
  });

  // 3. Does complete_warehouse_transfer update stock_management directly?
  console.log('\n====== Search for stock_management updates in complete_warehouse_transfer ======');
  const fullCode = await sql(`SELECT pg_get_functiondef(oid) as code FROM pg_proc WHERE proname='complete_warehouse_transfer'`);
  const code = fullCode[0]?.code || '';
  const smLines = code.split('\n').filter(l => l.toLowerCase().includes('stock_management') || l.toLowerCase().includes('update public.stock'));
  if (smLines.length > 0) {
    console.log('Found stock_management references:');
    smLines.forEach(l => console.log('  ' + l.trim()));
  } else {
    console.log('❌ No direct stock_management updates in complete_warehouse_transfer!');
  }

  // 4. post_inventory_movement_core
  console.log('\n====== post_inventory_movement_core ======');
  const core = await sql(`SELECT pg_get_functiondef(oid) as code FROM pg_proc WHERE proname='post_inventory_movement_core'`);
  core.forEach(f => {
    const c = f.code || '';
    // Find stock_management lines
    const lines = c.split('\n').filter(l => l.toLowerCase().includes('stock_management') || l.toLowerCase().includes('available_quantity') || l.toLowerCase().includes('transfer'));
    console.log('Key lines:');
    lines.forEach(l => console.log('  ' + l.trim()));
  });

  // 5. Beginning of complete_warehouse_transfer (first 80 lines)
  console.log('\n====== complete_warehouse_transfer BEGINNING ======');
  const firstPart = code.split('\n').slice(0, 120).join('\n');
  console.log(firstPart);
}
main().catch(console.error);
