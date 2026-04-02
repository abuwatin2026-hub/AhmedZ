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
  // 1. Full code of complete_warehouse_transfer
  console.log('====== complete_warehouse_transfer (FULL CODE) ======');
  const fn = await sql(`SELECT pg_get_functiondef(oid) as code FROM pg_proc WHERE proname='complete_warehouse_transfer'`);
  const code = fn[0]?.code || 'NOT FOUND';
  console.log(code);

  // 2. post_inventory_movement
  console.log('\n====== post_inventory_movement (FULL CODE) ======');
  const fn2 = await sql(`SELECT pg_get_functiondef(oid) as code FROM pg_proc WHERE proname='post_inventory_movement'`);
  fn2.forEach(f => console.log(f.code));
}
main().catch(console.error);
