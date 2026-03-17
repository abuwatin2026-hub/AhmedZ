/**
 * Comprehensive Accounting Section Audit – Production
 * Authenticates using owner credentials, then runs all queries via Supabase client SDK.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pmhivhtaoydfolseelyc.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';
const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Use Supabase Management API with personal access token for direct SQL
const SB_PAT = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
const PROJECT_REF = 'pmhivhtaoydfolseelyc';

const results = {};

// ─── Auth ───
async function login() {
  console.log('  Logging in as owner...');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'owner@azta.com',
    password: 'AhmedZ#123456',
  });
  if (error) throw new Error(`Login failed: ${error.message}`);
  console.log(`  ✅ Logged in as ${data.user?.email}`);
  return data;
}

// Execute SQL via Supabase Management API
async function sqlDirect(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SB_PAT}`,
    },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`SQL API failed (${resp.status}): ${txt.slice(0, 300)}`);
  }
  return await resp.json();
}

// Execute SQL via exec_sql RPC if available, otherwise via Management API
async function sql(query) {
  try {
    return await sqlDirect(query);
  } catch (e) {
    // Fallback: try exec_debug_sql RPC
    const { data, error } = await supabase.rpc('exec_debug_sql', { sql_text: query });
    if (error) throw new Error(`SQL fallback failed: ${error.message}`);
    return data;
  }
}

async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`RPC ${name} failed: ${error.message}`);
  return data;
}

// ─── 1. Chart of Accounts Health ───
async function auditCOA() {
  console.log('\n══ 1. Chart of Accounts (دليل الحسابات) ══');
  try {
    const rows = await rpc('list_chart_of_accounts', { p_include_inactive: true });
    const arr = Array.isArray(rows) ? rows : [];
    const active = arr.filter(r => r.is_active);
    const inactive = arr.filter(r => !r.is_active);
    console.log(`  Total accounts: ${arr.length} (Active: ${active.length}, Inactive: ${inactive.length})`);

    const codes = arr.map(r => r.code);
    const dups = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dups.length) console.log(`  ⚠ DUPLICATE CODES: ${[...new Set(dups)].join(', ')}`);
    else console.log('  ✅ No duplicate account codes');

    const byType = {};
    arr.forEach(r => { byType[r.account_type] = (byType[r.account_type] || 0) + 1; });
    console.log('  Distribution:', JSON.stringify(byType));

    const mandatory = ['1010', '1020', '1030', '1200', '1300', '2010', '2020', '3000', '4000', '5000', '6110'];
    const existing = new Set(arr.map(r => r.code));
    const missing = mandatory.filter(c => !existing.has(c));
    if (missing.length) console.log(`  ⚠ MISSING mandatory accounts: ${missing.join(', ')}`);
    else console.log('  ✅ All mandatory system accounts present');

    // List all accounts for reference
    console.log('\n  Full Account List:');
    arr.sort((a, b) => a.code.localeCompare(b.code)).forEach(a => {
      console.log(`    ${a.code.padEnd(10)} ${a.name.padEnd(40)} ${a.account_type.padEnd(10)} ${a.is_active ? '✓' : '✗'}`);
    });

    results.coa = { total: arr.length, active: active.length, inactive: inactive.length, dups, missing, byType };
  } catch (e) { console.log('  ❌ ERROR:', e.message); results.coa = { error: e.message }; }
}

// ─── 2. Journal Entries Balance Check ───
async function auditJournalBalance() {
  console.log('\n══ 2. Journal Entries Balance (توازن القيود) ══');
  try {
    const { count: totalEntries } = await supabase
      .from('journal_entries')
      .select('id', { count: 'exact', head: true });

    const { count: totalLines } = await supabase
      .from('journal_lines')
      .select('id', { count: 'exact', head: true });

    console.log(`  Total journal entries: ${totalEntries}`);
    console.log(`  Total journal lines: ${totalLines}`);

    // Check for unbalanced entries
    try {
      const ubResult = await sql(`
        SELECT je.id, je.description, 
               SUM(jl.debit_amount) as total_debit, 
               SUM(jl.credit_amount) as total_credit,
               ABS(SUM(jl.debit_amount) - SUM(jl.credit_amount)) as imbalance
        FROM journal_entries je
        JOIN journal_lines jl ON jl.entry_id = je.id
        GROUP BY je.id, je.description
        HAVING ABS(SUM(jl.debit_amount) - SUM(jl.credit_amount)) > 0.01
        ORDER BY imbalance DESC
        LIMIT 20
      `);
      const ubArr = Array.isArray(ubResult) ? ubResult : [];
      if (ubArr.length === 0) {
        console.log('  ✅ All journal entries are balanced (debit = credit)');
      } else {
        console.log(`  ⚠ UNBALANCED entries found: ${ubArr.length}`);
        ubArr.slice(0, 10).forEach(r => {
          console.log(`    Entry ${String(r.id).slice(0, 8)}: D=${Number(r.total_debit).toFixed(2)} C=${Number(r.total_credit).toFixed(2)} (diff=${Number(r.imbalance).toFixed(2)}) — ${String(r.description || '').slice(0, 50)}`);
        });
      }
      results.journalBalance = { totalEntries, totalLines, unbalanced: ubArr.length };
    } catch (e) {
      console.log(`  ⚠ Balance check: ${e.message}`);
      results.journalBalance = { totalEntries, totalLines, unbalanced: 'unknown' };
    }

    // Entries by status
    try {
      const statusResult = await sql(`
        SELECT status, COUNT(*) as cnt FROM journal_entries GROUP BY status ORDER BY cnt DESC
      `);
      console.log('  Entries by status:', JSON.stringify(statusResult));
    } catch {}

  } catch (e) { console.log('  ❌ ERROR:', e.message); results.journalBalance = { error: e.message }; }
}

// ─── 3. Trial Balance & Dashboard Summary ───
async function auditTrialBalance() {
  console.log('\n══ 3. Trial Balance (ميزان المراجعة) ══');
  try {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();
    const endNow = now.toISOString();

    let tbData;
    try {
      tbData = await rpc('get_accountant_dashboard_summary', {
        p_start_date: startOfYear,
        p_end_date: endNow,
      });
    } catch (e) {
      console.log(`  ⚠ get_accountant_dashboard_summary: ${e.message}`);
    }

    if (tbData?.trial_balance) {
      const tb = tbData.trial_balance;
      const totalDebit = tb.reduce((s, a) => s + (Number(a.total_debit) || 0), 0);
      const totalCredit = tb.reduce((s, a) => s + (Number(a.total_credit) || 0), 0);
      const diff = Math.abs(totalDebit - totalCredit);
      console.log(`  Total Debit:  ${totalDebit.toFixed(2)}`);
      console.log(`  Total Credit: ${totalCredit.toFixed(2)}`);
      console.log(`  Difference:   ${diff.toFixed(2)}`);
      if (diff < 0.01) console.log('  ✅ Trial Balance is balanced!');
      else console.log(`  ⚠ IMBALANCE of ${diff.toFixed(2)} detected!`);

      const sorted = [...tb].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
      console.log('  Top 10 accounts by |balance|:');
      sorted.slice(0, 10).forEach(a => {
        console.log(`    ${a.code} ${a.name}: ${Number(a.balance).toFixed(2)} (${a.account_type})`);
      });
      results.trialBalance = { totalDebit, totalCredit, diff, accounts: tb.length };
    }

    if (tbData?.sales) {
      console.log('\n  === Sales Summary (YTD) ===');
      const s = tbData.sales;
      console.log(`  Total Orders: ${s.total_orders}, Delivered: ${s.delivered_orders}, Cancelled: ${s.cancelled_orders}, Returned: ${s.returned_orders}, Pending: ${s.pending_orders}`);
      console.log(`  Total Sales: ${Number(s.total_sales).toFixed(2)}, Tax: ${Number(s.total_tax).toFixed(2)}, Discount: ${Number(s.total_discount).toFixed(2)}`);
      if (s.by_payment_method) {
        console.log('  By Payment Method:');
        Object.entries(s.by_payment_method).forEach(([m, d]) => console.log(`    ${m}: ${d.count} orders, total=${Number(d.total).toFixed(2)}`));
      }
      results.salesSummary = s;
    }

    if (tbData?.purchases) {
      console.log('\n  === Purchases Summary (YTD) ===');
      const p = tbData.purchases;
      console.log(`  Total POs: ${p.total_pos}, Completed: ${p.completed_pos}, Draft: ${p.draft_pos}, Cancelled: ${p.cancelled_pos}`);
      console.log(`  Total Amount: ${Number(p.total_amount).toFixed(2)}, Paid: ${Number(p.total_paid).toFixed(2)}, Unpaid: ${Number(p.total_unpaid).toFixed(2)}`);
      results.purchasesSummary = p;
    }

    if (tbData?.parties) {
      console.log('\n  === AR/AP Summary ===');
      const pt = tbData.parties;
      console.log(`  Customers: ${pt.total_customers}, Suppliers: ${pt.total_suppliers}, Employees: ${pt.total_employees}`);
      console.log(`  AR Balance: ${Number(pt.ar_balance).toFixed(2)}, AP Balance: ${Number(pt.ap_balance).toFixed(2)}`);
      if (pt.top_debtors?.length) {
        console.log('  Top Debtors:');
        pt.top_debtors.forEach(d => console.log(`    ${d.name} (${d.party_type}): ${Number(d.balance).toFixed(2)}`));
      }
      if (pt.top_creditors?.length) {
        console.log('  Top Creditors:');
        pt.top_creditors.forEach(c => console.log(`    ${c.name} (${c.party_type}): ${Number(c.balance).toFixed(2)}`));
      }
      results.partiesSummary = pt;
    }

  } catch (e) { console.log('  ❌ ERROR:', e.message); results.trialBalance = { error: e.message }; }
}

// ─── 4. Multi-Currency Health ───
async function auditMultiCurrency() {
  console.log('\n══ 4. Multi-Currency (تعدد العملات) ══');
  try {
    const { data: appSettings } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['base_currency', 'secondary_currencies', 'enable_multi_currency']);
    console.log('  App Settings:');
    (appSettings || []).forEach(s => console.log(`    ${s.key}: ${JSON.stringify(s.value)}`));

    const { data: fxRates, count: fxCount } = await supabase
      .from('fx_rates')
      .select('*', { count: 'exact' })
      .order('effective_date', { ascending: false })
      .limit(20);
    console.log(`\n  Total FX rate records: ${fxCount}`);
    if (fxRates?.length) {
      console.log('  Latest FX rates:');
      fxRates.slice(0, 10).forEach(r => {
        console.log(`    ${r.from_currency} → ${r.to_currency}: ${r.rate} (effective: ${r.effective_date})`);
      });
    }

    // Currencies in journal_lines via SQL
    try {
      const currResult = await sql(`
        SELECT currency, COUNT(*) as cnt, 
               SUM(debit_amount) as total_debit, SUM(credit_amount) as total_credit
        FROM journal_lines
        WHERE currency IS NOT NULL AND currency != ''
        GROUP BY currency ORDER BY cnt DESC
      `);
      console.log('\n  Currencies in journal_lines:');
      (Array.isArray(currResult) ? currResult : []).forEach(r => {
        console.log(`    ${r.currency}: ${r.cnt} lines, D=${Number(r.total_debit).toFixed(2)}, C=${Number(r.total_credit).toFixed(2)}`);
      });
    } catch (e) { console.log(`  ⚠ ${e.message}`); }

    // FX mismatch check  
    try {
      const fxCheck = await sql(`
        SELECT COUNT(*) as cnt FROM journal_lines
        WHERE foreign_amount IS NOT NULL AND foreign_amount != 0
          AND fx_rate IS NOT NULL AND fx_rate > 0
          AND ABS((debit_amount + credit_amount) - ABS(foreign_amount * fx_rate)) > 1
      `);
      const cnt = Number(fxCheck?.[0]?.cnt || 0);
      if (cnt > 0) console.log(`\n  ⚠ FX conversion mismatches (>1 unit): ${cnt}`);
      else console.log('\n  ✅ No significant FX conversion mismatches');
    } catch (e) { console.log(`  ⚠ ${e.message}`); }

    // Currencies in orders
    try {
      const oCurr = await sql(`
        SELECT data->>'currency' as currency, COUNT(*) as cnt
        FROM orders WHERE data->>'currency' IS NOT NULL
        GROUP BY data->>'currency' ORDER BY cnt DESC
      `);
      console.log('\n  Currencies in orders:');
      (Array.isArray(oCurr) ? oCurr : []).forEach(r => console.log(`    ${r.currency || '(null)'}: ${r.cnt} orders`));
    } catch {}

    results.multiCurrency = { appSettings, fxCount };
  } catch (e) { console.log('  ❌ ERROR:', e.message); }
}

// ─── 5. Cash Shifts ───
async function auditCashShifts() {
  console.log('\n══ 5. Cash Shifts (ورديات الصندوق) ══');
  try {
    const { count: total } = await supabase.from('cash_shifts').select('id', { count: 'exact', head: true });
    const { count: openCnt } = await supabase.from('cash_shifts').select('id', { count: 'exact', head: true }).eq('status', 'open');
    const { count: closedCnt } = await supabase.from('cash_shifts').select('id', { count: 'exact', head: true }).eq('status', 'closed');
    console.log(`  Total: ${total}, Open: ${openCnt}, Closed: ${closedCnt}`);
    if (openCnt > 1) console.log(`  ⚠ Multiple open shifts (${openCnt})`);

    // Review status
    try {
      const rev = await sql(`SELECT review_status, COUNT(*)::int as cnt FROM cash_shifts WHERE status='closed' GROUP BY review_status`);
      console.log('  Review status:', JSON.stringify(rev));
    } catch {}

    // Large variances  
    try {
      const lv = await sql(`
        SELECT id, cashier_id, difference, opened_at FROM cash_shifts
        WHERE status='closed' AND ABS(COALESCE(difference,0)) > 100
        ORDER BY ABS(difference) DESC LIMIT 10
      `);
      const arr = Array.isArray(lv) ? lv : [];
      if (arr.length) {
        console.log(`  ⚠ Large variances (|diff|>100): ${arr.length}`);
        arr.forEach(r => console.log(`    ${String(r.id).slice(0, 8)}: diff=${r.difference} (${new Date(r.opened_at).toLocaleDateString()})`));
      } else console.log('  ✅ No large variances');
    } catch {}

    results.cashShifts = { total, openCnt, closedCnt };
  } catch (e) { console.log('  ❌ ERROR:', e.message); }
}

// ─── 6. Payments ───
async function auditPayments() {
  console.log('\n══ 6. Payments (المدفوعات) ══');
  try {
    const { count: total } = await supabase.from('payments').select('id', { count: 'exact', head: true });
    console.log(`  Total Payments: ${total}`);

    try {
      const pm = await sql(`SELECT payment_method, COUNT(*)::int as cnt, SUM(amount)::numeric as total FROM payments GROUP BY payment_method ORDER BY total DESC`);
      console.log('  By method:');
      (Array.isArray(pm) ? pm : []).forEach(r => console.log(`    ${r.payment_method}: ${r.cnt} txns, total=${Number(r.total).toFixed(2)}`));
    } catch {}

    // Orphan check
    try {
      const orp = await sql(`SELECT COUNT(*)::int as cnt FROM payments p LEFT JOIN orders o ON o.id=p.order_id WHERE p.order_id IS NOT NULL AND o.id IS NULL`);
      const oc = Number(orp?.[0]?.cnt || 0);
      if (oc > 0) console.log(`  ⚠ ORPHAN payments: ${oc}`);
      else console.log('  ✅ No orphan payments');
    } catch (e) { console.log(`  ⚠ ${e.message}`); }

    // By currency
    try {
      const pc = await sql(`SELECT currency, COUNT(*)::int as cnt, SUM(amount)::numeric as total FROM payments WHERE currency IS NOT NULL AND currency!='' GROUP BY currency ORDER BY total DESC`);
      if (Array.isArray(pc) && pc.length > 0) {
        console.log('  By currency:');
        pc.forEach(r => console.log(`    ${r.currency}: ${r.cnt} txns, total=${Number(r.total).toFixed(2)}`));
      }
    } catch {}

    results.payments = { total };
  } catch (e) { console.log('  ❌ ERROR:', e.message); }
}

// ─── 7. AR/AP ───
async function auditARAP() {
  console.log('\n══ 7. Financial Parties (الأطراف المالية) ══');
  try {
    const { data: parties, count } = await supabase
      .from('financial_parties')
      .select('id, party_type, name, balance, credit_limit, preferred_currency', { count: 'exact' })
      .order('balance', { ascending: false }).limit(200);
    console.log(`  Total parties: ${count}`);
    const byType = {};
    (parties || []).forEach(p => { byType[p.party_type] = (byType[p.party_type] || 0) + 1; });
    console.log('  By type:', JSON.stringify(byType));

    const arTotal = (parties || []).filter(p => p.party_type === 'customer').reduce((s, p) => s + Number(p.balance || 0), 0);
    const apTotal = (parties || []).filter(p => p.party_type === 'supplier').reduce((s, p) => s + Number(p.balance || 0), 0);
    console.log(`  AR (customers): ${arTotal.toFixed(2)}, AP (suppliers): ${apTotal.toFixed(2)}`);

    const currP = {};
    (parties || []).forEach(p => { if (p.preferred_currency) currP[p.preferred_currency] = (currP[p.preferred_currency] || 0) + 1; });
    if (Object.keys(currP).length) console.log('  By preferred currency:', JSON.stringify(currP));

    results.arAp = { count, arTotal, apTotal, byType };
  } catch (e) { console.log('  ❌ ERROR:', e.message); }
}

// ─── 8. Journals ───
async function auditJournals() {
  console.log('\n══ 8. Journals (دفاتر اليومية) ══');
  try {
    const { data: journals, count } = await supabase.from('journals').select('*', { count: 'exact' });
    console.log(`  Total: ${count}`);
    (journals || []).forEach(j => console.log(`    ${j.code} - ${j.name} (default:${j.is_default}, active:${j.is_active})`));
    const defs = (journals || []).filter(j => j.is_default);
    if (defs.length === 0) console.log('  ⚠ No default journal!');
    else if (defs.length > 1) console.log(`  ⚠ Multiple defaults: ${defs.map(d => d.code).join(', ')}`);
    else console.log(`  ✅ Default: ${defs[0].code}`);
    results.journals = { total: count };
  } catch (e) { console.log('  ❌ ERROR:', e.message); }
}

// ─── 9. RPCs ───
async function auditRPCs() {
  console.log('\n══ 9. Key Accounting RPCs ══');
  const rpcs = [
    'get_shift_reconciliation_summary', 'get_accountant_dashboard_summary',
    'review_cash_shift', 'list_chart_of_accounts', 'create_chart_account',
    'update_chart_account', 'set_chart_account_active', 'trial_balance',
    'post_cash_shift_close', 'ensure_cashier_cash_account', 'get_fx_rate',
    'set_default_journal', 'post_order_entries', 'void_journal_entry',
    'get_sales_report_summary',
  ];
  for (const name of rpcs) {
    try {
      const r = await sql(`
        SELECT p.proname, pg_get_function_arguments(p.oid) as args
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='${name}'
      `);
      const arr = Array.isArray(r) ? r : [];
      if (arr.length > 0) console.log(`  ✅ ${name} (${arr.length} overload${arr.length>1?'s':''})`);
      else console.log(`  ❌ ${name} — NOT FOUND`);
    } catch (e) { console.log(`  ⚠ ${name}: ${e.message.slice(0, 80)}`); }
  }
}

// ─── 10. Cross-Reconciliation ───
async function auditCrossReconciliation() {
  console.log('\n══ 10. Cross-Reconciliation ══');
  try {
    const ot = await sql(`SELECT COUNT(*)::int as cnt, SUM((data->>'total')::numeric) as total FROM orders WHERE data->>'status' NOT IN ('cancelled','voided')`);
    const pt = await sql(`SELECT COUNT(*)::int as cnt, SUM(amount)::numeric as total FROM payments`);
    const oT = Number(ot?.[0]?.total || 0);
    const pT = Number(pt?.[0]?.total || 0);
    console.log(`  Orders (non-cancelled): ${oT.toFixed(2)} (${ot?.[0]?.cnt})`);
    console.log(`  Payments total: ${pT.toFixed(2)} (${pt?.[0]?.cnt})`);
    console.log(`  Difference: ${Math.abs(oT - pT).toFixed(2)}`);
  } catch (e) { console.log(`  ⚠ ${e.message}`); }

  try {
    const noGL = await sql(`
      SELECT COUNT(*)::int as cnt FROM orders o
      WHERE o.data->>'status' IN ('delivered','completed')
        AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type='order' AND je.source_id=o.id::text)
    `);
    const c = Number(noGL?.[0]?.cnt || 0);
    if (c > 0) console.log(`  ⚠ Delivered orders without GL: ${c}`);
    else console.log('  ✅ All delivered orders have GL entries');
  } catch (e) { console.log(`  ⚠ ${e.message}`); }
}

// ─── 11. Triggers ───
async function auditTriggers() {
  console.log('\n══ 11. Accounting Triggers ══');
  try {
    const t = await sql(`
      SELECT trigger_name, event_manipulation, event_object_table, action_timing
      FROM information_schema.triggers WHERE trigger_schema='public'
        AND (trigger_name ILIKE '%account%' OR trigger_name ILIKE '%cash%' 
             OR trigger_name ILIKE '%journal%' OR trigger_name ILIKE '%fx%'
             OR trigger_name ILIKE '%shift%' OR trigger_name ILIKE '%payment%')
      ORDER BY event_object_table, trigger_name
    `);
    const arr = Array.isArray(t) ? t : [];
    console.log(`  Found ${arr.length} triggers:`);
    arr.forEach(r => console.log(`    ${r.action_timing} ${r.event_manipulation} ON ${r.event_object_table}: ${r.trigger_name}`));
  } catch (e) { console.log(`  ❌ ${e.message}`); }
}

// ─── 12. Data Consistency ───
async function auditConsistency() {
  console.log('\n══ 12. Data Consistency ══');
  try {
    const ni = await sql(`SELECT COUNT(*)::int as cnt FROM batches WHERE quantity < 0`);
    const nc = Number(ni?.[0]?.cnt || 0);
    if (nc > 0) console.log(`  ⚠ Negative batches: ${nc}`);
    else console.log('  ✅ No negative batches');
  } catch {}

  try {
    const zl = await sql(`SELECT COUNT(*)::int as cnt FROM journal_lines WHERE debit_amount=0 AND credit_amount=0`);
    const zc = Number(zl?.[0]?.cnt || 0);
    if (zc > 0) console.log(`  ⚠ Zero-value journal lines: ${zc}`);
    else console.log('  ✅ No zero-value journal lines');
  } catch {}

  try {
    const op = await sql(`SELECT COUNT(*)::int as cnt FROM purchase_orders WHERE status='completed' AND paid_amount > total_amount + 10`);
    const oc = Number(op?.[0]?.cnt || 0);
    if (oc > 0) console.log(`  ⚠ Overpaid POs: ${oc}`);
    else console.log('  ✅ No overpaid POs');
  } catch {}
}

// ─── MAIN ───
async function main() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  COMPREHENSIVE ACCOUNTING AUDIT – PRODUCTION  ║');
  console.log('║  Date: ' + new Date().toISOString().slice(0, 19) + '              ║');
  console.log('╚═══════════════════════════════════════════════╝');

  await login();
  
  await auditCOA();
  await auditJournalBalance();
  await auditTrialBalance();
  await auditMultiCurrency();
  await auditCashShifts();
  await auditPayments();
  await auditARAP();
  await auditJournals();
  await auditRPCs();
  await auditCrossReconciliation();
  await auditTriggers();
  await auditConsistency();

  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║            AUDIT COMPLETE                  ║');
  console.log('╚═══════════════════════════════════════════╝');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
