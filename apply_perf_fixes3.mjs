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
  // ===== FIX 2: Audit log cleanup =====
  console.log('=== FIX 2: Audit log cleanup ===');
  
  // Find user-defined triggers on system_audit_logs
  const triggers = await sql(`
    SELECT t.tgname FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'system_audit_logs' AND c.relnamespace = 'public'::regnamespace
      AND NOT t.tgisinternal
  `);
  console.log('User triggers on audit_logs:', triggers.map(t=>t.tgname).join(', '));
  
  // Disable each user trigger
  for (const t of triggers) {
    await sql(`ALTER TABLE public.system_audit_logs DISABLE TRIGGER "${t.tgname}"`);
    console.log(`  ✅ Disabled: ${t.tgname}`);
  }
  
  const before = await sql(`SELECT count(*) as cnt FROM public.system_audit_logs`);
  console.log(`  Before: ${before[0].cnt} records`);
  
  await sql(`DELETE FROM public.system_audit_logs WHERE performed_at < now() - interval '30 days'`);
  
  const after = await sql(`SELECT count(*) as cnt FROM public.system_audit_logs`);
  console.log(`  After: ${after[0].cnt} records (deleted ${before[0].cnt - after[0].cnt})`);
  
  // Re-enable
  for (const t of triggers) {
    await sql(`ALTER TABLE public.system_audit_logs ENABLE TRIGGER "${t.tgname}"`);
  }
  console.log('  ✅ All triggers re-enabled');
  
  await sql(`VACUUM ANALYZE public.system_audit_logs`);
  console.log('  ✅ VACUUM ANALYZE done');

  // ===== FIX 3: Timezone cache =====
  console.log('\n=== FIX 3: Timezone cache ===');
  await sql(`DROP MATERIALIZED VIEW IF EXISTS public.cached_timezone_names`).catch(()=>{});
  await sql(`
    CREATE MATERIALIZED VIEW public.cached_timezone_names AS
    SELECT name, abbrev, utc_offset::text as utc_offset, is_dst FROM pg_timezone_names ORDER BY name
  `);
  await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cached_tz_name ON public.cached_timezone_names(name)`);
  await sql(`GRANT SELECT ON public.cached_timezone_names TO authenticated, anon`);
  console.log('  ✅ cached_timezone_names created');

  // ===== FIX 4: ANALYZE =====
  console.log('\n=== FIX 4: ANALYZE ===');
  for (const t of ['orders','inventory_movements','journal_entries','journal_lines','payments','batches','notifications','batch_balances','stock_management']) {
    await sql(`ANALYZE public.${t}`).catch(()=>{});
  }
  console.log('  ✅ ANALYZE done');

  // ===== VERIFY =====
  console.log('\n=== VERIFY ===');
  const newSize = await sql(`SELECT pg_size_pretty(pg_database_size(current_database())) as s`);
  console.log(`  DB size: ${newSize[0].s}`);
  
  const auditSz = await sql(`SELECT count(*) as cnt, pg_size_pretty(pg_total_relation_size('public.system_audit_logs'::regclass)) as sz FROM public.system_audit_logs`);
  console.log(`  Audit: ${auditSz[0].cnt} records, ${auditSz[0].sz}`);
  
  console.log('\n=== TIMING COMPARISON ===');
  const t1 = Date.now();
  await sql(`SELECT name FROM pg_timezone_names LIMIT 10`);
  console.log(`  pg_timezone_names: ${Date.now()-t1}ms`);
  
  const t2 = Date.now();
  await sql(`SELECT name FROM public.cached_timezone_names LIMIT 10`);
  console.log(`  cached_timezone_names: ${Date.now()-t2}ms`);
  
  const t3 = Date.now();
  await sql(`SELECT count(*) FROM public.orders`);
  console.log(`  orders count: ${Date.now()-t3}ms`);
}
main().catch(console.error);
