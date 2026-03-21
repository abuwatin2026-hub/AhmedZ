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
  // Check post_inventory_movement (function, not trigger)
  const pim = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='post_inventory_movement' AND pronamespace='public'::regnamespace LIMIT 1`);
  console.log('=== post_inventory_movement ===');
  console.log(pim[0]?.def || 'NOT FOUND');
  
  // Also check convert_qty
  const cq = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='convert_qty' AND pronamespace='public'::regnamespace LIMIT 1`);
  console.log('\n=== convert_qty ===');
  console.log(cq[0]?.def?.slice(0, 1000) || 'NOT FOUND');
  
  // Check recompute_stock_for_item
  const rsi = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='recompute_stock_for_item' AND pronamespace='public'::regnamespace LIMIT 1`);
  console.log('\n=== recompute_stock_for_item ===');
  console.log(rsi[0]?.def?.slice(0, 1500) || 'NOT FOUND');
  
  // Search all public functions for "cannot extract" or "22023"
  const found = await sql(`
    SELECT p.proname, 
      CASE WHEN pg_get_functiondef(p.oid) LIKE '%cannot extract%' THEN 'has cannot extract text' ELSE '' END as match
    FROM pg_proc p 
    WHERE p.pronamespace = 'public'::regnamespace
    AND pg_get_functiondef(p.oid) LIKE '%cannot extract%'
    LIMIT 10
  `).catch(()=>[]);
  console.log('\nFunctions containing "cannot extract":', found.map(f=>f.proname).join(', ') || 'none');
  
  // The error 22023 in PostgreSQL comes from invalid_parameter_value
  // It's NOT typically a user-defined message but a built-in PG error
  // Let's check: what functions call jsonb_array_elements on something that might be an object?
  const suspectFns = await sql(`
    SELECT p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
    AND pg_get_functiondef(p.oid) LIKE '%jsonb_array_elements%'
    ORDER BY p.proname
  `).catch(()=>[]);
  console.log('\nFunctions using jsonb_array_elements:');
  suspectFns.forEach(f => console.log(`  - ${f.proname}`));
  
  // Among these, which ones are called by process_sales_return?
  // process_sales_return calls: post_inventory_movement, recompute_stock_for_item, _apply_ar_open_item_credit, recompute_order_return_status
  const calls = ['post_inventory_movement','recompute_stock_for_item','_apply_ar_open_item_credit','recompute_order_return_status'];
  for(const fn of calls) {
    const match = suspectFns.find(f => f.proname === fn);
    if(match) console.log(`  ⚠️ ${fn} uses jsonb_array_elements!`);
  }
}

main().catch(console.error);
