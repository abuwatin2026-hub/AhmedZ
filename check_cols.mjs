const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${SBP}`},
    body:JSON.stringify({query:q}),
  });
  const b=await r.json();
  if(!r.ok) throw new Error(JSON.stringify(b).slice(0,600));
  return b;
}
async function main(){
  // Check column types
  const cols = await sql(`
    SELECT column_name, data_type, udt_name 
    FROM information_schema.columns c
    WHERE table_name IN ('stock_management','inventory_movements')
    AND column_name IN ('item_id','warehouse_id','unit')
    ORDER BY table_name, column_name
  `);
  cols.forEach(c=>console.log(`${c.table_name}.${c.column_name}: ${c.data_type} (${c.udt_name})`));
}
main().catch(console.error);
