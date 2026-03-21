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
  // Check triggers on journal_entries
  const triggers = await sql(`
    SELECT t.trigger_name, t.event_manipulation
    FROM information_schema.triggers t
    WHERE t.event_object_table = 'journal_entries' AND t.trigger_schema = 'public'
    ORDER BY t.trigger_name
  `);
  console.log('Triggers on journal_entries:');
  triggers.forEach(t => console.log(`  ${t.trigger_name} [${t.event_manipulation}]`));
  
  // Get body of each trigger function
  const trigFns = await sql(`
    SELECT DISTINCT p.proname, pg_get_functiondef(p.oid) as body
    FROM pg_trigger trg
    JOIN pg_proc p ON p.oid = trg.tgfoid
    JOIN pg_class c ON c.oid = trg.tgrelid
    WHERE c.relname = 'journal_entries' AND c.relnamespace = 'public'::regnamespace
    ORDER BY p.proname
  `);
  
  console.log(`\nFound ${trigFns.length} trigger functions on journal_entries:`);
  for (const f of trigFns) {
    console.log(`\n--- ${f.proname} ---`);
    const body = f.body || '';
    const lines = body.split('\n')
      .map((l, i) => ({line: i+1, text: l}))
      .filter(l => l.text.includes('raise') || l.text.includes('not allow') || l.text.includes('not auth') || l.text.includes('period') || l.text.includes('closed') || l.text.includes('locked'));
    if (lines.length) {
      lines.forEach(l => console.log(`  L${l.line}: ${l.text.trim()}`));
    } else {
      console.log('  (no raise/block lines found, first 10 lines:)');
      body.split('\n').slice(0, 10).forEach((l, i) => console.log(`  L${i+1}: ${l}`));
    }
  }
  
  // Also check RLS on journal_entries
  const rls = await sql(`
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE tablename = 'journal_entries' AND schemaname = 'public'
    LIMIT 10
  `);
  console.log('\nRLS policies on journal_entries:', rls.length);
  rls.forEach(p => console.log(`  ${p.policyname} [${p.cmd}]: qual=${String(p.qual).slice(0,100)}`));
  
  // Check accounting_periods
  const periods = await sql(`
    SELECT id, period_name, start_date, end_date, status, is_locked
    FROM public.accounting_periods
    ORDER BY start_date DESC
    LIMIT 5
  `).catch(() => []);
  console.log('\nAccounting periods:', periods.length);
  periods.forEach(p => console.log(`  ${p.period_name}: ${p.start_date} to ${p.end_date} | status=${p.status} | locked=${p.is_locked}`));
  
  // Direct test: try inserting a journal entry as service role
  const testInsert = await sql(`
    INSERT INTO public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
    VALUES (now(), 'Test entry', 'test_table', 'test-id', 'test_event', null, 'draft')
    RETURNING id
  `).catch(e => ({error: e.message}));
  
  if (testInsert.error) {
    console.log('\n❌ Test journal_entries insert FAILED:', testInsert.error.slice(0, 300));
  } else {
    console.log('\n✅ Test journal_entries insert OK:', testInsert[0]?.id);
    await sql(`DELETE FROM public.journal_entries WHERE id='${testInsert[0]?.id}'`).catch(()=>{});
  }
}
main().catch(console.error);
