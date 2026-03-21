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
  // Read trg_block_manual_entry_changes full body
  const fn1 = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='trg_block_manual_entry_changes' AND pronamespace='public'::regnamespace LIMIT 1`);
  console.log('=== trg_block_manual_entry_changes ===');
  console.log(fn1[0]?.def || 'NOT FOUND');
  
  // Read trg_journal_entries_hard_rules full body 
  const fn2 = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='trg_journal_entries_hard_rules' AND pronamespace='public'::regnamespace LIMIT 1`);
  console.log('\n=== trg_journal_entries_hard_rules ===');
  console.log(fn2[0]?.def || 'NOT FOUND');
  
  // Check what the real error is when process_sales_return runs for an authenticated role
  // The debug function said 'not allowed' — which specific trigger block?
  // Let's check: what is source_event='processed' blocked?
  
  // Check _is_migration_actor function
  const migActor = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='_is_migration_actor' AND pronamespace='public'::regnamespace LIMIT 1`);
  console.log('\n=== _is_migration_actor ===');
  console.log(migActor[0]?.def?.slice(0, 500) || 'NOT FOUND');
}
main().catch(console.error);
