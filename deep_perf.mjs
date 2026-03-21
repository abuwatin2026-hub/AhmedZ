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
  // === DEEP ANALYSIS 1: RLS POLICY OVERHEAD ===
  console.log('=== 1. RLS POLICY OVERHEAD (EXPLAIN ANALYZE) ===');
  // Test SELECT on heaviest tables with RLS
  const rlsTests = [
    { name: 'orders SELECT', q: `EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM public.orders LIMIT 50` },
    { name: 'journal_entries SELECT', q: `EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM public.journal_entries LIMIT 50` },
    { name: 'inventory_movements SELECT', q: `EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM public.inventory_movements LIMIT 50` },
    { name: 'system_audit_logs SELECT', q: `EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM public.system_audit_logs LIMIT 50` },
    { name: 'payments SELECT', q: `EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM public.payments LIMIT 50` },
  ];
  for (const t of rlsTests) {
    try {
      const r = await sql(t.q);
      const plan = r[0]['QUERY PLAN'] || r[0]['query plan'];
      const planObj = Array.isArray(plan) ? plan[0] : JSON.parse(plan)[0];
      console.log(`  ${t.name}: ${planObj['Execution Time']?.toFixed(1) || planObj['Planning Time']?.toFixed(1) || '?'}ms`);
    } catch(e) { console.log(`  ${t.name}: ${e.message.slice(0,100)}`); }
  }

  // === DEEP ANALYSIS 2: TRIGGER CHAINS ===
  console.log('\n=== 2. TRIGGER CHAIN ANALYSIS (orders table) ===');
  const orderTriggers = await sql(`
    SELECT t.tgname as trigger_name,
      CASE t.tgtype & 66 
        WHEN 2 THEN 'BEFORE'
        WHEN 64 THEN 'INSTEAD OF'
        ELSE 'AFTER' END as timing,
      CASE t.tgtype & 28
        WHEN 4 THEN 'INSERT'
        WHEN 8 THEN 'DELETE'
        WHEN 16 THEN 'UPDATE'
        WHEN 20 THEN 'INSERT|UPDATE'
        WHEN 28 THEN 'INSERT|UPDATE|DELETE'
        WHEN 12 THEN 'INSERT|DELETE'
        WHEN 24 THEN 'UPDATE|DELETE'
        ELSE 'OTHER(' || (t.tgtype & 28)::text || ')' END as event,
      p.proname as func_name,
      t.tgenabled as enabled
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'orders' AND c.relnamespace = 'public'::regnamespace
      AND NOT t.tgisinternal
    ORDER BY timing, event, t.tgname
  `);
  orderTriggers.forEach(t => console.log(`  [${t.timing} ${t.event}] ${t.trigger_name} → ${t.func_name} (${t.enabled})`));

  console.log('\n=== 3. TRIGGER CHAIN ANALYSIS (inventory_movements table) ===');
  const imTriggers = await sql(`
    SELECT t.tgname, 
      CASE t.tgtype & 66 WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END as timing,
      CASE t.tgtype & 28
        WHEN 4 THEN 'INSERT' WHEN 8 THEN 'DELETE' WHEN 16 THEN 'UPDATE'
        WHEN 20 THEN 'INS|UPD' WHEN 28 THEN 'INS|UPD|DEL'
        ELSE 'OTHER' END as event,
      p.proname as fn, t.tgenabled
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname='inventory_movements' AND c.relnamespace='public'::regnamespace AND NOT t.tgisinternal
    ORDER BY timing, event, t.tgname
  `);
  imTriggers.forEach(t => console.log(`  [${t.timing} ${t.event}] ${t.tgname} → ${t.fn} (${t.tgenabled})`));

  // === DEEP ANALYSIS 3: SUPABASE PLAN & QUOTAS ===
  console.log('\n=== 4. SUPABASE PROJECT INFO ===');
  const projInfo = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc', {
    headers: { Authorization: `Bearer ${SBP}` }
  }).then(r => r.json());
  console.log('  Plan:', projInfo.subscription_id || projInfo.plan || 'unknown');
  console.log('  Region:', projInfo.region);
  console.log('  DB host:', projInfo.db_host);
  console.log('  Status:', projInfo.status);

  // === DEEP ANALYSIS 4: CONNECTION POOLING ===
  console.log('\n=== 5. CONNECTION POOL & PG SETTINGS ===');
  const pgSettings = await sql(`
    SELECT name, setting, unit FROM pg_settings 
    WHERE name IN ('max_connections', 'shared_buffers', 'work_mem', 'maintenance_work_mem',
      'effective_cache_size', 'random_page_cost', 'statement_timeout', 'idle_in_transaction_session_timeout',
      'log_min_duration_statement')
    ORDER BY name
  `);
  pgSettings.forEach(s => console.log(`  ${s.name}: ${s.setting}${s.unit||''}`));

  // === DEEP ANALYSIS 5: ACTUAL RPC TIMINGS ===
  console.log('\n=== 6. RPC FUNCTION TIMINGS ===');
  const rpcTimings = await sql(`
    SELECT LEFT(query, 100) as q, calls, 
      round(mean_exec_time::numeric,1) as avg_ms,
      round(min_exec_time::numeric,1) as min_ms,
      round(max_exec_time::numeric,1) as max_ms,
      round(stddev_exec_time::numeric,1) as std_ms
    FROM pg_stat_statements
    WHERE query ILIKE '%pgrst_source%' AND calls > 5
    ORDER BY mean_exec_time DESC LIMIT 20
  `).catch(()=>[]);
  console.log('PostgREST API calls (via REST):');
  rpcTimings.forEach(q => console.log(`  [avg:${q.avg_ms}ms max:${q.max_ms}ms calls:${q.calls}] ${q.q}`));

  // === DEEP ANALYSIS 6: LOCK CONTENTION ===
  console.log('\n=== 7. CURRENT LOCKS ===');
  const locks = await sql(`
    SELECT l.locktype, c.relname, l.mode, count(*) as cnt
    FROM pg_locks l
    LEFT JOIN pg_class c ON c.oid = l.relation
    WHERE NOT l.granted = false
    GROUP BY l.locktype, c.relname, l.mode
    HAVING count(*) > 1
    ORDER BY cnt DESC LIMIT 10
  `).catch(()=>[]);
  locks.forEach(l => console.log(`  ${l.relname||l.locktype}: ${l.mode} x${l.cnt}`));

  // === DEEP ANALYSIS 7: CACHE HIT RATIO ===
  console.log('\n=== 8. BUFFER CACHE HIT RATIO ===');
  const cacheRatio = await sql(`
    SELECT 
      sum(heap_blks_read) as heap_read,
      sum(heap_blks_hit) as heap_hit,
      CASE WHEN sum(heap_blks_read)+sum(heap_blks_hit) > 0 
        THEN round(100.0 * sum(heap_blks_hit) / (sum(heap_blks_read)+sum(heap_blks_hit)),2)
        ELSE 0 END as hit_ratio
    FROM pg_statio_user_tables
  `);
  console.log(`  Cache hit ratio: ${cacheRatio[0].hit_ratio}%`);

  // === DEEP ANALYSIS 8: LONG RUNNING / WAITING ===
  console.log('\n=== 9. ACTIVE QUERIES RIGHT NOW ===');
  const activeQ = await sql(`
    SELECT pid, state, LEFT(query, 120) as query, 
      EXTRACT(EPOCH FROM now()-query_start)::int as running_sec,
      wait_event_type, wait_event
    FROM pg_stat_activity 
    WHERE state = 'active' AND pid <> pg_backend_pid()
    ORDER BY query_start
  `);
  activeQ.forEach(q => console.log(`  [${q.running_sec}s ${q.wait_event_type||''}/${q.wait_event||''}] ${q.query}`));

  // === DEEP ANALYSIS 9: EXTENSIONS LOADED ===
  console.log('\n=== 10. EXTENSIONS ===');
  const exts = await sql(`SELECT extname, extversion FROM pg_extension ORDER BY extname`);
  console.log('Extensions:', exts.map(e=>`${e.extname}(${e.extversion})`).join(', '));

  // === DEEP ANALYSIS 10: RLS POLICY DETAILS ===
  console.log('\n=== 11. HEAVIEST RLS POLICIES ===');
  const rlsPolicies = await sql(`
    SELECT tablename, policyname, cmd, LEFT(qual::text, 200) as filter,
      LEFT(with_check::text, 200) as with_chk
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('orders','journal_entries','payments','inventory_movements','system_audit_logs')
    ORDER BY tablename, policyname
  `);
  rlsPolicies.forEach(p => console.log(`  ${p.tablename}.${p.policyname} [${p.cmd}]: ${(p.filter||'').slice(0,80)}`));

  // === DEEP ANALYSIS 11: INSERT TIME for system_audit_logs ===
  console.log('\n=== 12. system_audit_logs INSERT PERFORMANCE ===');
  const auditInsert = await sql(`
    SELECT LEFT(query,100) as q, calls, 
      round(mean_exec_time::numeric,2) as avg_ms,
      round(total_exec_time::numeric/1000,1) as total_s
    FROM pg_stat_statements
    WHERE query ILIKE '%system_audit_logs%' AND query ILIKE '%INSERT%'
    LIMIT 3
  `).catch(()=>[]);
  auditInsert.forEach(q => console.log(`  [avg:${q.avg_ms}ms calls:${q.calls} total:${q.total_s}s] ${q.q}`));
}
main().catch(console.error);
