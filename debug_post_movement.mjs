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

async function main() {
  // Get post_inventory_movement body
  const pim = await sql(`SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname='post_inventory_movement' AND pronamespace='public'::regnamespace LIMIT 1`);
  if (pim.length) {
    const def = pim[0].def;
    // Look for jsonb_array_elements or extract usage
    const lines = def.split('\n');
    const suspicious = lines
      .map((l, i) => ({ line: i+1, text: l }))
      .filter(l => 
        l.text.includes('jsonb_array_elements') || 
        l.text.includes('-> ') || 
        l.text.includes('->>') ||
        l.text.includes('extract') ||
        l.text.includes('#>') ||
        l.text.match(/jsonb.*element/i)
      );
    console.log('post_inventory_movement suspicious lines:');
    suspicious.forEach(l => console.log(`  L${l.line}: ${l.text.trim()}`));
    console.log('Total lines:', lines.length);
    
    // Also check if it handles 'return_in' movement type
    const returnInLines = lines
      .map((l, i) => ({ line: i+1, text: l }))
      .filter(l => l.text.includes('return_in') || l.text.includes('return'));
    console.log('\nreturn-related lines:');
    returnInLines.slice(0, 10).forEach(l => console.log(`  L${l.line}: ${l.text.trim()}`));
  } else {
    console.log('post_inventory_movement NOT FOUND');
  }
  
  // Also check recompute_stock_for_item
  const rsi = await sql(`SELECT proname, pg_get_functiondef(oid) as def FROM pg_proc WHERE proname='recompute_stock_for_item' AND pronamespace='public'::regnamespace LIMIT 1`).catch(()=>[]);
  if (rsi.length) {
    const lines = rsi[0].def.split('\n');
    const suspicious = lines
      .map((l, i) => ({ line: i+1, text: l }))
      .filter(l => l.text.includes('jsonb_array_elements') || l.text.includes('extract') || l.text.includes('cannot extract'));
    console.log('\nrecompute_stock_for_item suspicious lines:', suspicious.length);
    suspicious.forEach(l => console.log(`  L${l.line}: ${l.text.trim()}`));
  } else {
    console.log('\nrecompute_stock_for_item NOT FOUND');
  }
  
  // Check _apply_ar_open_item_credit
  const ar = await sql(`SELECT proname FROM pg_proc WHERE proname='_apply_ar_open_item_credit' AND pronamespace='public'::regnamespace`).catch(()=>[]);
  console.log('\n_apply_ar_open_item_credit exists:', ar.length > 0);
  
  // Check if there's a trigger on inventory_movements that might fail
  const trgs = await sql(`
    SELECT t.trigger_name, t.event_manipulation, p.proname as fn_name
    FROM information_schema.triggers t
    JOIN pg_proc p ON p.proname = replace(t.action_statement, 'EXECUTE FUNCTION public.', '')
    WHERE t.event_object_table = 'inventory_movements' AND t.trigger_schema = 'public'
    ORDER BY t.trigger_name
  `).catch(()=>[]);
  console.log('\nTriggers on inventory_movements:');
  trgs.forEach(t => console.log(`  ${t.trigger_name} [${t.event_manipulation}] → ${t.fn_name}`));
  
  // Simpler: just list trigger names
  const trgs2 = await sql(`SELECT trigger_name, event_manipulation FROM information_schema.triggers WHERE event_object_table='inventory_movements' ORDER BY trigger_name`).catch(()=>[]);
  console.log('All triggers on inventory_movements:');
  trgs2.forEach(t => console.log(`  ${t.trigger_name} [${t.event_manipulation}]`));
}

main().catch(console.error);
