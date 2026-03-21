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
  // Read rebuild_order_line_items body
  const fn = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='rebuild_order_line_items' AND pronamespace='public'::regnamespace LIMIT 1`);
  console.log('=== rebuild_order_line_items ===');
  console.log(fn[0]?.def || 'NOT FOUND');
  
  // Read recompute_order_return_status body
  const fn2 = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='recompute_order_return_status' AND pronamespace='public'::regnamespace LIMIT 1`);
  console.log('\n=== recompute_order_return_status (relevant lines) ===');
  const body2 = fn2[0]?.def || '';
  const suspLines = body2.split('\n').filter((l,i) => l.includes('jsonb_array_elements') || l.includes('rebuild_order'));
  suspLines.forEach(l => console.log(l));
}
main().catch(console.error);
