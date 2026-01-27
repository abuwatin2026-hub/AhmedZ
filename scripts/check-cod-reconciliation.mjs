import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.AZTA_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.AZTA_SUPABASE_ANON_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing AZTA_SUPABASE_URL / AZTA_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkReconciliation() {
  console.log('🔎 Checking COD Reconciliation (CIT vs Driver Balances)...');
  const { data, error } = await supabase
    .from('v_cod_reconciliation_check')
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('❌ Query Failed:', error.message);
    process.exit(1);
  }

  if (!data) {
    console.error('❌ No reconciliation data returned');
    process.exit(1);
  }

  const cit = Number(data.cash_in_transit_balance || 0);
  const sumDrivers = Number(data.sum_driver_balances || 0);
  const diff = Number(data.diff || (cit - sumDrivers));

  console.log(`   Cash-In-Transit:        ${cit.toFixed(2)}`);
  console.log(`   Σ Driver Balances:      ${sumDrivers.toFixed(2)}`);
  console.log(`   Difference (CIT - Σ):   ${diff.toFixed(2)}`);

  const epsilon = 1e-6;
  if (Math.abs(diff) <= epsilon) {
    console.log('✅ Reconciliation PASSED (difference ≈ 0)');
    process.exit(0);
  } else {
    console.log('⚠️ Reconciliation WARNING (difference != 0)');
    process.exit(2);
  }
}

checkReconciliation().catch((e) => {
  console.error('❌ Unexpected Error:', e?.message || String(e));
  process.exit(1);
});
