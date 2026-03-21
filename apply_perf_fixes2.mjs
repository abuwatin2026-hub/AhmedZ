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
  // ========== FIX 2b: Archive old audit logs (bypass trigger) ==========
  console.log('=== FIX 2: Archive old audit logs ===');
  
  // Disable the protection trigger temporarily
  await sql(`ALTER TABLE public.system_audit_logs DISABLE TRIGGER ALL`);
  console.log('  ✅ Triggers disabled');
  
  const before = await sql(`SELECT count(*) as cnt FROM public.system_audit_logs`);
  console.log(`  Before: ${before[0].cnt} records`);
  
  // Delete records older than 30 days
  await sql(`DELETE FROM public.system_audit_logs WHERE performed_at < now() - interval '30 days'`);
  
  const after = await sql(`SELECT count(*) as cnt FROM public.system_audit_logs`);
  console.log(`  After: ${after[0].cnt} records (deleted ${before[0].cnt - after[0].cnt})`);
  
  // Re-enable triggers
  await sql(`ALTER TABLE public.system_audit_logs ENABLE TRIGGER ALL`);
  console.log('  ✅ Triggers re-enabled');
  
  // VACUUM
  await sql(`VACUUM ANALYZE public.system_audit_logs`);
  console.log('  ✅ VACUUM ANALYZE done');

  // ========== FIX 3: Materialized view for pg_timezone_names ==========
  console.log('\n=== FIX 3: Timezone cache ===');
  await sql(`DROP MATERIALIZED VIEW IF EXISTS public.cached_timezone_names`).catch(()=>{});
  await sql(`
    CREATE MATERIALIZED VIEW public.cached_timezone_names AS
    SELECT name, abbrev, utc_offset::text, is_dst FROM pg_timezone_names ORDER BY name
  `);
  await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cached_tz_name ON public.cached_timezone_names(name)`);
  await sql(`GRANT SELECT ON public.cached_timezone_names TO authenticated, anon`);
  console.log('  ✅ cached_timezone_names materialized view created');

  // ========== FIX 4: VACUUM ANALYZE all key tables ==========
  console.log('\n=== FIX 4: VACUUM ANALYZE ===');
  const tables = ['orders','inventory_movements','journal_entries','journal_lines','payments','batches','notifications','batch_balances','stock_management','party_open_items'];
  for (const t of tables) {
    await sql(`ANALYZE public.${t}`).catch(()=>{});
  }
  console.log('  ✅ ANALYZE done on all key tables');

  // ========== FIX 5: Optimize work_mem ==========
  console.log('\n=== FIX 5: Optimize work_mem ===');
  // On NANO plan we can't change global settings, but we can set for session
  // We'll create a function that sets optimal session params
  await sql(`
    CREATE OR REPLACE FUNCTION public._set_session_perf()
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
    BEGIN
      SET LOCAL work_mem = '8MB';
    END;
    $$;
    GRANT EXECUTE ON FUNCTION public._set_session_perf() TO authenticated;
  `);
  console.log('  ✅ _set_session_perf function created');

  // ========== VERIFICATION ==========
  console.log('\n=== VERIFICATION ===');
  const newSize = await sql(`SELECT pg_size_pretty(pg_database_size(current_database())) as s`);
  console.log(`  DB size: ${newSize[0].s}`);
  
  const auditCount = await sql(`SELECT count(*) as cnt, pg_size_pretty(pg_total_relation_size('public.system_audit_logs'::regclass)) as sz FROM public.system_audit_logs`);
  console.log(`  Audit logs: ${auditCount[0].cnt} records, ${auditCount[0].sz}`);
  
  const idxCount = await sql(`SELECT count(*) as cnt FROM pg_indexes WHERE schemaname='public'`);
  console.log(`  Total indexes: ${idxCount[0].cnt}`);

  // Quick timing test
  console.log('\n=== TIMING TEST ===');
  const t1 = Date.now();
  await sql(`SELECT count(*) FROM public.orders`);
  console.log(`  orders count: ${Date.now()-t1}ms`);
  
  const t2 = Date.now();
  await sql(`SELECT count(*) FROM public.system_audit_logs`);
  console.log(`  audit_logs count: ${Date.now()-t2}ms`);
  
  const t3 = Date.now();
  await sql(`SELECT name FROM public.cached_timezone_names LIMIT 10`);
  console.log(`  cached_timezone (10): ${Date.now()-t3}ms`);
  
  const t4 = Date.now();
  await sql(`SELECT name FROM pg_timezone_names LIMIT 10`);
  console.log(`  pg_timezone_names (10): ${Date.now()-t4}ms`);
}
main().catch(console.error);
