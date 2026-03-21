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
  // Get trigger function bodies for the key triggers
  const triggers = [
    'trg_validate_sales_return_inventory_reference',
    'trg_inventory_movements_ensure_batch_exists',
    'trg_inventory_movements_post',
    'trg_sale_out_require_batch',
  ];
  
  for (const tname of triggers) {
    // Get function name from trigger
    const tInfo = await sql(`
      SELECT t.trigger_name, t.action_statement, p.proname as fn_name,
             pg_get_functiondef(p.oid) as fn_body
      FROM information_schema.triggers t
      JOIN pg_proc p ON p.proname = regexp_replace(t.action_statement, 'EXECUTE FUNCTION public\\.([^(]+).*', '\\1')
      WHERE t.trigger_name = '${tname}' AND t.trigger_schema = 'public'
      LIMIT 1
    `).catch(() => [{fn_name: 'N/A', fn_body: ''}]);
    
    if (tInfo.length && tInfo[0].fn_body) {
      const body = tInfo[0].fn_body;
      const lines = body.split('\n');
      const suspicious = lines
        .map((l, i) => ({ line: i+1, text: l }))
        .filter(l => 
          l.text.includes('jsonb_array_elements') || 
          l.text.includes('22023') ||
          l.text.includes('cannot extract') ||
          l.text.includes('-> ') ||
          l.text.includes('raise exception') ||
          l.text.match(/raise\s+exception/i)
        );
      console.log(`\n${tname} (fn: ${tInfo[0].fn_name}):`);
      console.log(`  Total lines: ${lines.length}`);
      suspicious.forEach(l => console.log(`  L${l.line}: ${l.text.trim()}`));
      if (suspicious.length === 0) {
        console.log('  (no suspicious lines found)');
        // print first 20 lines
        lines.slice(0, 20).forEach((l, i) => console.log(`  L${i+1}: ${l}`));
      }
    } else {
      console.log(`\n${tname}: NOT FOUND or empty body`);
    }
  }
  
  // Also check trg_set_qty_base - this sets qty_base on insert and might fail
  const qtyBase = await sql(`
    SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname = 'trg_set_qty_base_inventory_movements_fn'
    UNION ALL
    SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname LIKE '%qty_base%'
    LIMIT 1
  `).catch(() => []);
  if (qtyBase.length) {
    console.log('\nqty_base trigger body (first 1000 chars):');
    console.log(qtyBase[0].def?.slice(0, 1000));
  }
}

main().catch(console.error);
