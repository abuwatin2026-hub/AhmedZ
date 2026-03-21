const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
const fs = await import('fs');

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 500));
  return b;
}

async function main() {
  // Deploy using same pattern as deploy_fix_returns.mjs (which works)
  const migration = fs.readFileSync('./supabase/migrations/20260321070000_trace_return_debug.sql', 'utf8');
  console.log('Deploying trace function...');
  await sql(migration);
  console.log('✅ Deployed');
  
  const draft = await sql(`SELECT id FROM public.sales_returns WHERE status='draft' LIMIT 1`);
  const retId = draft[0]?.id;
  console.log('Testing return:', retId);
  
  const result = await sql(`SELECT * FROM public.trace_return_error('${retId}'::uuid) ORDER BY step`);
  console.log('\nTrace results:');
  result.forEach(r => console.log(`  Step ${r.step}: [${r.result}] err=${r.err||'none'} state=${r.state||'none'}`));
}
main().catch(console.error);
