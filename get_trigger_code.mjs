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
  // Get first 120 lines of complete_warehouse_transfer
  const fn = await sql(`SELECT pg_get_functiondef(oid) as code FROM pg_proc WHERE proname='complete_warehouse_transfer'`);
  const code = fn[0]?.code || '';
  const lines = code.split('\n');
  console.log('Total lines:', lines.length);
  console.log('=== Lines 1-120 ===');
  console.log(lines.slice(0,120).join('\n'));
  console.log('\n=== Lines 40-90 (stock check area) ===');
  console.log(lines.slice(40,90).join('\n'));

  // Also get trigger function
  console.log('\n=== trigger function names on SM ===');
  const trig = await sql(`
    SELECT tgname, 
      (SELECT proname FROM pg_proc WHERE oid=tgfoid) as fn_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'stock_management'
    ORDER BY tgname
  `);
  trig.forEach(t => console.log(`  ${t.tgname} → ${t.fn_name}`));
  
  // Get the audit trigger code
  for(const t of trig){
    if(t.fn_name){
      const fc = await sql(`SELECT pg_get_functiondef(oid) as code FROM pg_proc WHERE proname='${t.fn_name}'`).catch(()=>[]);
      if(fc.length && fc[0].code){
        console.log(`\n=== ${t.fn_name} ===`);
        console.log(fc[0].code.slice(0,1500));
      }
    }
  }
}
main().catch(console.error);
