/**
 * Supplementary audit: fill in gaps from first pass using RPC-based queries
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pmhivhtaoydfolseelyc.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';
const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function login() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'owner@azta.com', password: 'AhmedZ#123456',
  });
  if (error) throw new Error(`Login: ${error.message}`);
  console.log(`Logged in as ${data.user?.email}`);
}

async function main() {
  await login();

  // 1. Check journal entries balance by fetching entries with lines
  console.log('\n─── Unbalanced Journal Entries Check ───');
  const { data: entries } = await supabase
    .from('journal_entries')
    .select('id, description, source_type, source_id, status, entry_date')
    .eq('status', 'posted')
    .order('created_at', { ascending: false })
    .limit(1000);
  
  let unbalancedCount = 0;
  const unbalancedList = [];
  
  for (const entry of (entries || [])) {
    const { data: lines } = await supabase
      .from('journal_lines')
      .select('debit_amount, credit_amount')
      .eq('entry_id', entry.id);
    
    const totalDebit = (lines || []).reduce((s, l) => s + Number(l.debit_amount || 0), 0);
    const totalCredit = (lines || []).reduce((s, l) => s + Number(l.credit_amount || 0), 0);
    const imbal = Math.abs(totalDebit - totalCredit);
    if (imbal > 0.01) {
      unbalancedCount++;
      unbalancedList.push({ id: entry.id, desc: entry.description, source_type: entry.source_type, debit: totalDebit, credit: totalCredit, diff: imbal });
    }
  }
  
  if (unbalancedCount === 0) {
    console.log(`✅ All ${(entries||[]).length} posted entries are balanced`);
  } else {
    console.log(`⚠ ${unbalancedCount} UNBALANCED entries:`);
    unbalancedList.forEach(u => {
      console.log(`  ${u.id.slice(0,8)}: D=${u.debit.toFixed(2)} C=${u.credit.toFixed(2)} diff=${u.diff.toFixed(2)} — ${u.source_type} — ${(u.desc||'').slice(0,60)}`);
    });
  }

  // 2. FX Rates
  console.log('\n─── FX Rates ───');
  const { data: fxRates, count: fxCount } = await supabase
    .from('fx_rates')
    .select('*', { count: 'exact' })
    .order('effective_date', { ascending: false })
    .limit(20);
  console.log(`Total FX rates: ${fxCount}`);
  (fxRates || []).forEach(r => {
    console.log(`  ${r.from_currency} → ${r.to_currency}: rate=${r.rate} (${r.effective_date})`);
  });

  // 3. Currency in journal_lines
  console.log('\n─── Currency Distribution in Journal Lines ───');
  const { data: allLines } = await supabase
    .from('journal_lines')
    .select('currency, debit_amount, credit_amount, foreign_amount, fx_rate')
    .limit(5000);

  const byCurrency = {};
  let fxMismatch = 0;
  (allLines || []).forEach(l => {
    const curr = l.currency || '(null)';
    if (!byCurrency[curr]) byCurrency[curr] = { count: 0, debit: 0, credit: 0 };
    byCurrency[curr].count++;
    byCurrency[curr].debit += Number(l.debit_amount || 0);
    byCurrency[curr].credit += Number(l.credit_amount || 0);

    // FX mismatch check
    if (l.foreign_amount && l.fx_rate && Number(l.fx_rate) > 0) {
      const expectedBase = Math.abs(Number(l.foreign_amount) * Number(l.fx_rate));
      const actualBase = Number(l.debit_amount || 0) + Number(l.credit_amount || 0);
      if (Math.abs(actualBase - expectedBase) > 1) fxMismatch++;
    }
  });
  
  Object.entries(byCurrency).forEach(([curr, d]) => {
    console.log(`  ${curr}: ${d.count} lines, D=${d.debit.toFixed(2)}, C=${d.credit.toFixed(2)}`);
  });
  console.log(`\nFX conversion mismatches (> 1 unit): ${fxMismatch}`);

  // 4. App Settings
  console.log('\n─── App Settings (currency-related) ───');
  const { data: settings } = await supabase
    .from('app_settings')
    .select('key, value');
  const currSettings = (settings || []).filter(s => 
    ['base_currency', 'secondary_currencies', 'enable_multi_currency', 'default_currency'].some(k => s.key?.includes(k) || s.key?.includes('currency'))
  );
  currSettings.forEach(s => console.log(`  ${s.key}: ${JSON.stringify(s.value)}`));
  if (!currSettings.length) {
    console.log('  (no currency-related settings found in app_settings)');
    console.log('  All settings keys:');
    (settings || []).forEach(s => console.log(`    ${s.key}`));
  }

  // 5. Financial Parties (full query)
  console.log('\n─── Financial Parties ───');
  const { data: parties, count: pCount } = await supabase
    .from('financial_parties')
    .select('*', { count: 'exact' })
    .order('name');
  console.log(`Total: ${pCount}`);
  const byType = {};
  (parties || []).forEach(p => {
    byType[p.party_type] = (byType[p.party_type] || 0) + 1;
  });
  console.log('By type:', JSON.stringify(byType));
  const custBal = (parties || []).filter(p => p.party_type === 'customer').reduce((s, p) => s + Number(p.balance || 0), 0);
  const suppBal = (parties || []).filter(p => p.party_type === 'supplier').reduce((s, p) => s + Number(p.balance || 0), 0);
  console.log(`Customer balances total: ${custBal.toFixed(2)}`);
  console.log(`Supplier balances total: ${suppBal.toFixed(2)}`);
  
  // 6. Negative batch check
  console.log('\n─── Negative Batches ───');
  const { data: negBatches, count: negCount } = await supabase
    .from('batches')
    .select('id, product_id, quantity, unit_cost', { count: 'exact' })
    .lt('quantity', 0);
  console.log(`Negative batches: ${negCount}`);
  (negBatches || []).slice(0, 10).forEach(b => console.log(`  batch ${b.id.slice(0,8)}: qty=${b.quantity}, cost=${b.unit_cost}`));

  // 7. Zero-value journal lines
  console.log('\n─── Zero-Value Journal Lines ───');
  const { count: zeroCount } = await supabase
    .from('journal_lines')
    .select('id', { count: 'exact', head: true })
    .eq('debit_amount', 0)
    .eq('credit_amount', 0);
  console.log(`Zero-value lines: ${zeroCount}`);

  // 8. Shift reconciliation for today  
  console.log('\n─── Shift Reconciliation Summary (This Month) ───');
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end = now.toISOString();
    const { data: shiftSummary, error: shiftErr } = await supabase.rpc('get_shift_reconciliation_summary', {
      p_start_date: start,
      p_end_date: end,
    });
    if (shiftErr) throw shiftErr;
    const ss = shiftSummary;
    console.log(`  Shifts total: ${ss.shifts_total}, Open: ${ss.shifts_open}, Closed: ${ss.shifts_closed}`);
    console.log(`  Approved: ${ss.shifts_approved}, Pending: ${ss.shifts_pending}, Rejected: ${ss.shifts_rejected}`);
    console.log(`  Start amount: ${ss.total_start_amount}, Expected: ${ss.total_expected}`);
    console.log(`  Counted: ${ss.total_counted}, Difference: ${ss.total_difference}`);
    if (ss.by_cashier?.length) {
      console.log('  By cashier:');
      ss.by_cashier.forEach(c => {
        console.log(`    ${c.cashier_name}: ${c.shift_count} shifts, diff=${c.total_difference}`);
      });
    }
    if (ss.by_currency && Object.keys(ss.by_currency).length) {
      console.log('  By currency:');
      Object.entries(ss.by_currency).forEach(([curr, d]) => {
        console.log(`    ${curr}: diff=${d.total_difference}`);
      });
    }
    if (ss.by_method && Object.keys(ss.by_method).length) {
      console.log('  By method:');
      Object.entries(ss.by_method).forEach(([m, d]) => {
        console.log(`    ${m}: in=${d.in}, out=${d.out}`);
      });
    }
  } catch (e) { console.log(`  Error: ${e.message}`); }

  // 9. Check post_order_entries and void_journal_entry RPCs  
  console.log('\n─── RPC Signatures (missing from first pass) ───');
  for (const fname of ['post_order_entries', 'void_journal_entry', 'get_sales_report_summary']) {
    try {
      // Just call with clearly wrong args to see if it exists
      const { error } = await supabase.rpc(fname, {});
      if (error && error.message.includes('Could not find')) {
        console.log(`  ❌ ${fname} — NOT FOUND`);
      } else {
        console.log(`  ✅ ${fname} — exists${error ? ` (expected arg error: ${error.message.slice(0, 60)})` : ''}`);
      }
    } catch (e) {
      console.log(`  ⚠ ${fname}: ${e.message.slice(0, 80)}`);
    }
  }

  console.log('\n─── SUPPLEMENTARY AUDIT COMPLETE ───');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
