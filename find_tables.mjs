const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
async function sql(q){const r=await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${SBP}`},body:JSON.stringify({query:q})});const b=await r.json();if(!r.ok)throw new Error(JSON.stringify(b).slice(0,600));return b;}
async function main(){
  const c=await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='party_open_items' ORDER BY ordinal_position`);
  c.forEach(r=>console.log(r.column_name));
  // sample
  const s=await sql(`SELECT * FROM party_open_items LIMIT 1`);
  console.log('sample:', JSON.stringify(s[0])?.slice(0,300));
  // settlements table?
  const st=await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='settlements' ORDER BY ordinal_position`).catch(()=>[]);
  st.forEach(r=>console.log('settlements:', r.column_name));
}
main().catch(console.error);
