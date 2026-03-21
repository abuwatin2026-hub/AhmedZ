const NEW_SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
const fs = await import('fs');

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${NEW_SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 800));
  return b;
}

async function main() {
  // Test connection first
  const test = await sql(`SELECT version()`);
  console.log('✅ Connected:', test[0].version.slice(0, 50));

  // Deploy trace function from migration file
  const migration = fs.readFileSync('./supabase/migrations/20260321070000_trace_return_debug.sql', 'utf8');
  console.log('Deploying trace_return_error...');
  await sql(migration);
  console.log('✅ trace_return_error deployed');

  // Also re-deploy the main fix to ensure accounting_bypass is there
  const fix = fs.readFileSync('./supabase/migrations/20260321060000_fix_process_sales_return.sql', 'utf8');
  console.log('Re-deploying process_sales_return fix...');
  await sql(fix);
  console.log('✅ process_sales_return fix re-deployed');

  // Get draft return
  const draft = await sql(`SELECT id, order_id, refund_method, total_refund_amount FROM public.sales_returns WHERE status='draft' ORDER BY created_at DESC LIMIT 3`);
  console.log('\nDraft returns:');
  draft.forEach(d => console.log(`  ${d.id} | order:${d.order_id.slice(-8)} | ${d.refund_method} | ${d.total_refund_amount}`));

  // Run trace for each draft
  for (const d of draft) {
    console.log(`\n=== Tracing return ${d.id.slice(-8)} (${d.refund_method}) ===`);
    const result = await sql(`SELECT * FROM public.trace_return_error('${d.id}'::uuid) ORDER BY step`);
    result.forEach(r => {
      const status = r.result.startsWith('OK') ? '✅' : r.result.startsWith('SKIP') ? '⏭️' : '❌';
      console.log(`  ${status} Step ${r.step}: ${r.result}${r.err ? ' | ERR: '+r.err : ''}`);
    });
    // Stop at first failure
    const failed = result.find(r => r.result.startsWith('FAIL'));
    if (failed) {
      console.log(`\n💥 FAILED at step ${failed.step}: ${failed.result}`);
      console.log(`   SQLERRM: ${failed.err}`);
      console.log(`   SQLSTATE: ${failed.state}`);
    }
  }
}
main().catch(console.error);
