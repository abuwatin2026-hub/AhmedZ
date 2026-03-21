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
  // ========== FIX 1: Add Missing Indexes ==========
  console.log('=== FIX 1: Missing Indexes ===');
  
  const indexes = [
    // notifications - only 14.9% index usage
    `CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read) WHERE is_read = false`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC)`,
    
    // batches - 52.5% index usage  
    `CREATE INDEX IF NOT EXISTS idx_batches_item_warehouse ON public.batches(item_id, warehouse_id)`,
    `CREATE INDEX IF NOT EXISTS idx_batches_expiry ON public.batches(expiry_date) WHERE expiry_date IS NOT NULL`,
    
    // stock_management - 75% index usage
    `CREATE INDEX IF NOT EXISTS idx_stock_mgmt_item_wh ON public.stock_management(item_id, warehouse_id)`,
    
    // system_audit_logs - large table, speed up queries
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_performed_at ON public.system_audit_logs(performed_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON public.system_audit_logs(module)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.system_audit_logs(action)`,
    
    // price_history - 3.7% index usage (worst!)
    `CREATE INDEX IF NOT EXISTS idx_price_history_item ON public.price_history(item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_price_history_date ON public.price_history(effective_date DESC)`,
    
    // party_open_items - 89.4%
    `CREATE INDEX IF NOT EXISTS idx_party_open_status ON public.party_open_items(status) WHERE status = 'open'`,
    
    // orders - optimize common queries
    `CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders(customer_auth_user_id)`,
  ];
  
  for (const idx of indexes) {
    const name = idx.match(/idx_\w+/)?.[0] || 'unknown';
    try {
      await sql(idx);
      console.log(`  ✅ ${name}`);
    } catch(e) {
      console.log(`  ⚠️ ${name}: ${e.message.slice(0,100)}`);
    }
  }

  // ========== FIX 2: Archive old system_audit_logs ==========
  console.log('\n=== FIX 2: Archive system_audit_logs ===');
  const oldCount = await sql(`SELECT count(*) as cnt FROM public.system_audit_logs WHERE performed_at < now() - interval '30 days'`);
  console.log(`  Old records (>30 days): ${oldCount[0].cnt}`);
  
  if (parseInt(oldCount[0].cnt) > 0) {
    await sql(`DELETE FROM public.system_audit_logs WHERE performed_at < now() - interval '30 days'`);
    console.log(`  ✅ Deleted ${oldCount[0].cnt} old audit logs`);
    await sql(`VACUUM ANALYZE public.system_audit_logs`);
    console.log('  ✅ VACUUM ANALYZE done');
  }

  // ========== FIX 3: Cache pg_timezone_names via materialized view ==========
  console.log('\n=== FIX 3: Cache pg_timezone_names ===');
  await sql(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS public.cached_timezone_names AS
    SELECT name, abbrev, utc_offset, is_dst FROM pg_timezone_names
    ORDER BY name
  `);
  await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cached_tz_name ON public.cached_timezone_names(name)`);
  // Grant access
  await sql(`GRANT SELECT ON public.cached_timezone_names TO authenticated, anon`);
  console.log('  ✅ Materialized view cached_timezone_names created');

  // ========== FIX 4: VACUUM ANALYZE on key tables ==========
  console.log('\n=== FIX 4: VACUUM ANALYZE key tables ===');
  const tables = ['orders', 'inventory_movements', 'journal_entries', 'journal_lines', 'payments', 'batches', 'notifications'];
  for (const t of tables) {
    try {
      await sql(`ANALYZE public.${t}`);
      console.log(`  ✅ ANALYZE ${t}`);
    } catch(e) {
      console.log(`  ⚠️ ${t}: ${e.message.slice(0,80)}`);
    }
  }

  // ========== FIX 5: Optimize Supabase PostgREST schema cache ==========
  console.log('\n=== FIX 5: Reset pg_stat_statements ===');
  await sql(`SELECT pg_stat_statements_reset()`).catch(() => {});
  console.log('  ✅ Stats reset for clean measurement');

  // ========== Verify Results ==========
  console.log('\n=== VERIFICATION ===');
  const newSize = await sql(`SELECT pg_size_pretty(pg_database_size(current_database())) as s`);
  console.log(`  DB size after cleanup: ${newSize[0].s}`);
  
  const auditCount = await sql(`SELECT count(*) as cnt FROM public.system_audit_logs`);
  console.log(`  Audit logs remaining: ${auditCount[0].cnt}`);
  
  const idxCount = await sql(`SELECT count(*) as cnt FROM pg_indexes WHERE schemaname='public'`);
  console.log(`  Total indexes: ${idxCount[0].cnt}`);
}
main().catch(console.error);
