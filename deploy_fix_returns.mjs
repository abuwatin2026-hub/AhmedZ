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
  const migration = fs.readFileSync('./supabase/migrations/20260321060000_fix_process_sales_return.sql', 'utf8');
  console.log('Deploying fix, length:', migration.length);
  await sql(migration);
  console.log('✅ Migration deployed successfully');
  
  // Verify the function was updated 
  const ver = await sql(`SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname='process_sales_return' AND pronamespace='public'::regnamespace LIMIT 1`);
  const hasJsonbTypeof = ver[0].def.includes('jsonb_typeof(v_items_jsonb)');
  const hasUomQtyInBase = ver[0].def.includes('uomQtyInBase');
  const hasSoftShift = ver[0].def.includes('raise warning');
  console.log('Verifications:');
  console.log('  jsonb_typeof guard:', hasJsonbTypeof ? '✅' : '❌');
  console.log('  uomQtyInBase priority:', hasUomQtyInBase ? '✅' : '❌');
  console.log('  Soft shift warning:', hasSoftShift ? '✅' : '❌');
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
