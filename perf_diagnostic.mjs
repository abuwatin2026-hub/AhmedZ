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
  console.log('=== 1. DATABASE & TABLE SIZES ===');
  const dbSize = await sql(`SELECT pg_size_pretty(pg_database_size(current_database())) as s`);
  console.log('DB size:', dbSize[0].s);

  const tableSizes = await sql(`
    SELECT c.relname as tbl,
      pg_size_pretty(pg_total_relation_size(c.oid)) as total,
      pg_size_pretty(pg_relation_size(c.oid)) as data_sz,
      s.n_live_tup as rows
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relname = c.relname AND s.schemaname = 'public'
    WHERE ns.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 20
  `);
  console.log('\nTop 20 tables:');
  tableSizes.forEach(t => console.log(`  ${t.tbl}: ${t.total} (data:${t.data_sz}) rows:${t.rows}`));

  console.log('\n=== 2. SLOWEST QUERIES ===');
  const slow = await sql(`
    SELECT LEFT(query,150) as q, calls, round(mean_exec_time::numeric,1) as avg_ms,
      round(max_exec_time::numeric,1) as max_ms,
      round(total_exec_time::numeric/1000,1) as total_s
    FROM pg_stat_statements WHERE mean_exec_time > 50
    ORDER BY mean_exec_time DESC LIMIT 15
  `).catch(()=>[]);
  slow.forEach(q => console.log(`  [avg:${q.avg_ms}ms max:${q.max_ms}ms calls:${q.calls} total:${q.total_s}s] ${q.q}`));

  console.log('\n=== 3. MOST TOTAL TIME QUERIES ===');
  const heavy = await sql(`
    SELECT LEFT(query,150) as q, calls, round(mean_exec_time::numeric,1) as avg_ms,
      round(total_exec_time::numeric/1000,1) as total_s
    FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10
  `).catch(()=>[]);
  heavy.forEach(q => console.log(`  [total:${q.total_s}s avg:${q.avg_ms}ms calls:${q.calls}] ${q.q}`));

  console.log('\n=== 4. SEQ SCANS ON LARGE TABLES ===');
  const seq = await sql(`
    SELECT relname as tbl, seq_scan, idx_scan, n_live_tup as rows,
      pg_size_pretty(pg_total_relation_size(relid)) as sz
    FROM pg_stat_user_tables
    WHERE seq_scan > 5 AND n_live_tup > 100
    ORDER BY seq_scan DESC LIMIT 15
  `);
  seq.forEach(t => console.log(`  ${t.tbl}: seq=${t.seq_scan} idx=${t.idx_scan} rows=${t.rows} sz=${t.sz}`));

  console.log('\n=== 5. LOWEST INDEX USAGE ===');
  const lowIdx = await sql(`
    SELECT relname as tbl,
      CASE WHEN idx_scan+seq_scan>0 THEN round(100.0*idx_scan/(idx_scan+seq_scan),1) ELSE 0 END as pct,
      idx_scan, seq_scan, n_live_tup as rows
    FROM pg_stat_user_tables WHERE n_live_tup > 100
    ORDER BY pct ASC LIMIT 15
  `);
  lowIdx.forEach(t => console.log(`  ${t.tbl}: ${t.pct}% idx (seq:${t.seq_scan} idx:${t.idx_scan}) rows:${t.rows}`));

  console.log('\n=== 6. CONNECTIONS ===');
  const conn = await sql(`
    SELECT count(*) as total,
      count(*) FILTER(WHERE state='active') as active,
      count(*) FILTER(WHERE state='idle') as idle,
      count(*) FILTER(WHERE state='idle in transaction') as idle_tx,
      max(EXTRACT(EPOCH FROM now()-query_start))::int as longest_q_sec
    FROM pg_stat_activity WHERE pid<>pg_backend_pid()
  `);
  console.log(JSON.stringify(conn[0]));

  console.log('\n=== 7. DEAD TUPLES / BLOAT ===');
  const dead = await sql(`
    SELECT relname, n_live_tup as live, n_dead_tup as dead,
      CASE WHEN n_live_tup>0 THEN round(100.0*n_dead_tup/n_live_tup,1) ELSE 0 END as dead_pct,
      last_autovacuum::text
    FROM pg_stat_user_tables WHERE n_dead_tup>100 ORDER BY n_dead_tup DESC LIMIT 10
  `);
  dead.forEach(t => console.log(`  ${t.relname}: ${t.dead} dead (${t.dead_pct}%) live:${t.live} vacuum:${t.last_autovacuum?.slice(0,19)||'never'}`));

  console.log('\n=== 8. REALTIME TABLES ===');
  const rt = await sql(`SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename`).catch(()=>[]);
  console.log('Tables in realtime publication:', rt.map(t=>t.tablename).join(', '));

  console.log('\n=== 9. TRIGGER COUNTS ===');
  const trg = await sql(`
    SELECT event_object_table as tbl, count(*) as cnt
    FROM information_schema.triggers WHERE trigger_schema='public'
    GROUP BY event_object_table ORDER BY cnt DESC LIMIT 10
  `);
  trg.forEach(t => console.log(`  ${t.tbl}: ${t.cnt} triggers`));

  console.log('\n=== 10. EXISTING INDEXES ===');
  const idx = await sql(`
    SELECT tablename, count(*) as idx_count
    FROM pg_indexes WHERE schemaname='public'
    GROUP BY tablename ORDER BY idx_count DESC LIMIT 10
  `);
  idx.forEach(t => console.log(`  ${t.tablename}: ${t.idx_count} indexes`));
  
  console.log('\n=== 11. RLS POLICY COUNTS ===');
  const rls = await sql(`
    SELECT tablename, count(*) as policy_count
    FROM pg_policies WHERE schemaname='public'
    GROUP BY tablename ORDER BY policy_count DESC LIMIT 10
  `);
  rls.forEach(t => console.log(`  ${t.tablename}: ${t.policy_count} policies`));
}
main().catch(console.error);
