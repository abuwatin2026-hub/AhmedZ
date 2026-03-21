const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
const fs = await import('fs');
const path = await import('path');

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
  // All timestamps that should be marked as applied
  const allTimestamps = [
    ['20260317060500', '20260317060500_fix_inflated_returns_and_reclass_revaluation.sql'],
    ['20260318010000', '20260318010000_fx_policy_revaluation_automation.sql'],
    ['20260318010100', '20260318010100_fx_period_close_gate.sql'],
    ['20260318020000', '20260318020000_voucher_approval_workflow.sql'],
    ['20260318020100', '20260318020100_cost_centers_and_oci.sql'],
    ['20260318040000', '20260318040000_salary_allowances.sql'],
    ['20260318040100', '20260318040100_end_of_service_benefit.sql'],
    ['20260318040200', '20260318040200_advance_installments.sql'],
    ['20260318040300', '20260318040300_performance_reviews.sql'],
    ['20260318040400', '20260318040400_recruitment.sql'],
    ['20260318040500', '20260318040500_kitting_composite_items.sql'],
    ['20260318040600', '20260318040600_serial_numbers.sql'],
    ['20260318040700', '20260318040700_sales_representatives.sql'],
    ['20260318040800', '20260318040800_inventory_withdrawal_requests.sql'],
    ['20260318040900', '20260318040900_letters_of_credit.sql'],
    ['20260318150000', '20260318150000_backup_worldclass_hardening.sql'],
    ['20260318200000', '20260318200000_attendance_remaining_fixes.sql'],
    ['20260319003000', '20260319003000_direct_customer_registration.sql'],
    ['20260319010000', '20260319010000_admin_reset_customer_password.sql'],
    ['20260319020000', '20260319020000_passkey_credentials.sql'],
    ['20260319030000', '20260319030000_driver_locations.sql'],
    ['20260319040000', '20260319040000_fix_driver_location_security.sql'],
    ['20260321000000', '20260321000000_fix_voucher_critical_issues.sql'],
    ['20260321010000', '20260321010000_voucher_excellence.sql'],
    ['20260321020000', '20260321020000_manual_voucher_party_ledger.sql'],
    ['20260321030000', '20260321030000_fix_manual_voucher_party_ledger_currency.sql'],
    ['20260321040000', '20260321040000_online_orders_improvements.sql'],
    ['20260321060000', '20260321060000_fix_process_sales_return.sql'],
    ['20260321070000', '20260321070000_trace_return_debug.sql'],
    ['20260322010000', '20260322010000_fix_rebuild_order_line_items_jsonb_guard.sql'],
  ];

  console.log('Registering all migrations in history table...');
  for (const [version, name] of allTimestamps) {
    await sql(`
      INSERT INTO supabase_migrations.schema_migrations(version, name, statements, execution_time_ms)
      VALUES ('${version}', '${name}', ARRAY['-- applied via script'], 0)
      ON CONFLICT (version) DO NOTHING
    `).catch(e => {
      if (!e.message.includes('does not exist')) console.log(`  Warning ${version}: ${e.message.slice(0,100)}`);
    });
  }
  console.log('✅ Done registering');

  // Verify
  const check = await sql(`
    SELECT version FROM supabase_migrations.schema_migrations 
    WHERE version >= '20260317060500'
    ORDER BY version ASC
  `).catch(async () => {
    // Maybe the table is in a different schema
    console.log('Checking _prisma_migrations or other tables...');
    const tables = await sql(`SELECT tablename, schemaname FROM pg_tables WHERE tablename LIKE '%migrat%' ORDER BY schemaname, tablename`);
    console.log('Migration tables:', JSON.stringify(tables));
    return [];
  });
  
  console.log('\nMigrations registered >= 20260317060500:');
  console.log(check.map(r=>r.version).join(', '));
  
  // Final sanity check: verify process_sales_return has the accounting bypass
  const fnCheck = await sql(`SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname='process_sales_return' AND pronamespace='public'::regnamespace LIMIT 1`);
  const body = fnCheck[0]?.def || '';
  console.log('\nCritical function checks:');
  console.log('  process_sales_return accounting_bypass:', body.includes('accounting_bypass') ? '✅ YES' : '❌ NO');
  console.log('  process_sales_return uomQtyInBase:', body.includes('uomQtyInBase') ? '✅ YES' : '❌ NO');
  
  const fn2 = await sql(`SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname='rebuild_order_line_items' AND pronamespace='public'::regnamespace LIMIT 1`);
  const body2 = fn2[0]?.def || '';
  console.log('  rebuild_order_line_items jsonb_typeof guard:', body2.includes("jsonb_typeof(v_items_src)") ? '✅ YES' : '❌ NO');
}
main().catch(console.error);
