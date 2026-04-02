import { createClient } from '@supabase/supabase-js';

const s = createClient(
  'https://pmhivhtaoydfolseelyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec'
);
await s.auth.signInWithPassword({ email: 'owner@azta.com', password: 'AhmedZ#123456' });

const today = new Date().toISOString().split('T')[0];
const sixMonthsAgo = new Date();
sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
const sixMonthsAgoStr = sixMonthsAgo.toISOString().split('T')[0];

// ============================================================
// 1. order_item_cogs table stats
// ============================================================
console.log('='.repeat(60));
console.log('1. ORDER_ITEM_COGS TABLE STATE');
console.log('='.repeat(60));

const { data: cogsStats, error: e1 } = await s.from('order_item_cogs')
  .select('order_id, item_id, quantity, unit_cost, total_cost, created_at')
  .order('created_at', { ascending: false })
  .limit(10);
if (e1) { console.log('ERROR:', e1.message); }
else {
  console.log(`Total records (top 10 shown):`);
  cogsStats?.forEach(r => console.log(`  ${new Date(r.created_at).toLocaleDateString()} | order:${r.order_id.slice(-6)} | qty:${r.quantity} | unit_cost:${r.unit_cost} | total:${r.total_cost}`));
}

// Count total records
const { count: cogsCount } = await s.from('order_item_cogs').select('*', { count: 'exact', head: true });
console.log(`  Total COGS records: ${cogsCount}`);

// ============================================================
// 2. Orders WITHOUT COGS records
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('2. DELIVERED ORDERS WITHOUT COGS');
console.log('='.repeat(60));

const { data: deliveredOrders } = await s.from('orders')
  .select('id, created_at, data')
  .eq('status', 'delivered')
  .gte('created_at', sixMonthsAgoStr)
  .order('created_at', { ascending: false })
  .limit(100);

let ordersWithCogs = 0;
let ordersWithoutCogs = 0;
let ordersWithZeroCogs = 0;

for (const order of (deliveredOrders || [])) {
  const { count } = await s.from('order_item_cogs').select('*', { count: 'exact', head: true }).eq('order_id', order.id);
  if (!count || count === 0) ordersWithoutCogs++;
  else ordersWithCogs++;
  
  // check for zeros
  const { data: cogsRows } = await s.from('order_item_cogs').select('unit_cost, total_cost').eq('order_id', order.id);
  if (cogsRows?.some(r => Number(r.unit_cost) === 0 || Number(r.total_cost) === 0)) ordersWithZeroCogs++;
}

console.log(`  Delivered orders checked: ${deliveredOrders?.length || 0}`);
console.log(`  WITH COGS: ${ordersWithCogs}`);
console.log(`  WITHOUT COGS: ${ordersWithoutCogs}`);
console.log(`  WITH ZERO COGS: ${ordersWithZeroCogs}`);

// ============================================================
// 3. Test get_sales_report_summary COGS field
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('3. get_sales_report_summary COGS FIELD');
console.log('='.repeat(60));

const startISO = new Date(sixMonthsAgoStr).toISOString();
const endISO = new Date().toISOString();
const { data: summary, error: sErr } = await s.rpc('get_sales_report_summary', {
  p_start_date: startISO,
  p_end_date: endISO,
  p_zone_id: null,
  p_invoice_only: false,
});
if (sErr) console.log('SUMMARY ERROR:', sErr.message);
else {
  console.log('  total_sales_accrual:', summary?.total_sales_accrual);
  console.log('  cogs:', summary?.cogs);
  console.log('  gross_profit (derived):', Number(summary?.total_sales_accrual||0) - Number(summary?.cogs||0));
  console.log('  wastage:', summary?.wastage);
  console.log('  expenses:', summary?.expenses);
  console.log('  COGS/Revenue ratio:', summary?.total_sales_accrual > 0 ? ((Number(summary?.cogs||0)/Number(summary?.total_sales_accrual||1))*100).toFixed(1)+'%' : 'N/A');
  console.log('  All keys:', Object.keys(summary||{}).join(', '));
}

// ============================================================
// 4. test get_sales_report_orders to check order_cogs per order
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('4. ORDER-LEVEL COGS CHECK');
console.log('='.repeat(60));

const { data: orderReport, error: orErr } = await s.rpc('get_sales_report_orders', {
  p_start_date: startISO,
  p_end_date: endISO,
  p_zone_id: null,
  p_invoice_only: false,
  p_limit: 20,
  p_offset: 0,
});
if (orErr) console.log('ORDER REPORT ERROR:', orErr.message);
else {
  const rows = orderReport as any[];
  const withCogs = rows.filter(r => Number(r.order_cogs||0) > 0);
  const withoutCogs = rows.filter(r => Number(r.order_cogs||0) === 0);
  console.log(`  Orders in report: ${rows.length} | WITH cogs: ${withCogs.length} | WITHOUT (0): ${withoutCogs.length}`);
  
  // Show sample
  rows.slice(0, 5).forEach(r => {
    console.log(`  ${r.id?.slice(-6)} | total:${r.total} | cogs:${r.order_cogs} | source:${r.order_source} | status:${r.status}`);
  });
  
  // Check if in-store orders have cogs
  const inStore = rows.filter(r => r.order_source === 'in_store');
  const inStoreWithCogs = inStore.filter(r => Number(r.order_cogs||0) > 0);
  console.log(`\n  In-Store: ${inStore.length} | WITH cogs: ${inStoreWithCogs.length}`);
}

// ============================================================
// 5. COGS reconciliation function
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('5. COGS RECONCILIATION (expected vs actual GL)');
console.log('='.repeat(60));

const { data: recon, error: rErr } = await s.rpc('cogs_reconciliation_by_range', {
  p_start: sixMonthsAgoStr,
  p_end: today,
});
if (rErr) {
  console.log('RECON ERROR:', rErr.message, rErr.code);
} else {
  const rows = (recon as any[]) || [];
  const total_expected = rows.reduce((s, r) => s + Number(r.expected_cogs||0), 0);
  const total_actual = rows.reduce((s, r) => s + Number(r.actual_cogs||0), 0);
  const total_delta = rows.reduce((s, r) => s + Number(r.delta||0), 0);
  console.log(`  Items with discrepancy: ${rows.filter(r => Math.abs(Number(r.delta||0)) > 0.01).length} / ${rows.length}`);
  console.log(`  Total expected COGS: ${total_expected.toFixed(2)}`);
  console.log(`  Total actual GL COGS (5010): ${total_actual.toFixed(2)}`);
  console.log(`  Total delta: ${total_delta.toFixed(2)}`);
  // Top discrepancies
  rows.slice(0, 5).forEach(r => console.log(`  item:${String(r.item_id).slice(-6)} | exp:${r.expected_cogs} | act:${r.actual_cogs} | delta:${r.delta}`));
}

// ============================================================
// 6. Check GL account 5010 (COGS) balance
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('6. GL ACCOUNT 5010 (COGS) BALANCE');
console.log('='.repeat(60));

const { data: ledger, error: lErr } = await s.rpc('general_ledger', {
  p_account_code: '5010',
  p_start: sixMonthsAgoStr,
  p_end: today,
  p_cost_center_id: null,
  p_journal_id: null,
});
if (lErr) console.log('LEDGER ERROR:', lErr.message);
else {
  const rows = (ledger as any[]) || [];
  const totalDebit = rows.reduce((s, r) => s + Number(r.debit||0), 0);
  const totalCredit = rows.reduce((s, r) => s + Number(r.credit||0), 0);
  console.log(`  GL 5010 entries: ${rows.length}`);
  console.log(`  Total Debit (COGS expense): ${totalDebit.toFixed(2)}`);
  console.log(`  Total Credit (COGS reversal): ${totalCredit.toFixed(2)}`);
  console.log(`  Net COGS (5010): ${(totalDebit - totalCredit).toFixed(2)}`);
  
  // Check if all entries have source linkage
  const withSource = rows.filter(r => r.source_id && r.source_table);
  const withoutSource = rows.filter(r => !r.source_id || !r.source_table);
  console.log(`  Entries WITH source: ${withSource.length} | WITHOUT source: ${withoutSource.length}`);
}

// ============================================================
// 7. ProductReports COGS check
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('7. PRODUCT-LEVEL COGS (top items)');
console.log('='.repeat(60));

// Try get_product_sales_report or similar RPC
const { data: prodCogs, error: pcErr } = await s.from('order_item_cogs')
  .select('item_id, quantity, unit_cost, total_cost')
  .gte('created_at', sixMonthsAgoStr);
if (pcErr) console.log('PROD COGS ERROR:', pcErr.message);
else {
  const byItem = new Map();
  for (const r of (prodCogs || [])) {
    const k = r.item_id;
    const prev = byItem.get(k) || { qty: 0, total: 0, rows: 0 };
    byItem.set(k, { qty: prev.qty + Number(r.quantity), total: prev.total + Number(r.total_cost), rows: prev.rows + 1 });
  }
  // Sort by total COGS desc
  const sorted = Array.from(byItem.entries()).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  console.log(`  Items tracked: ${byItem.size}`);
  for (const [itemId, stats] of sorted) {
    const { data: mi } = await s.from('menu_items').select('name').eq('id', itemId).maybeSingle();
    const name = (mi as any)?.name?.ar?.substring(0, 30) || itemId.slice(-6);
    console.log(`  ${name} | qty:${stats.qty.toFixed(2)} | total_cogs:${stats.total.toFixed(2)} | avg_unit:${(stats.total/stats.qty).toFixed(3)}`);
  }
}

// ============================================================
// 8. ShiftReports COGS check
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('8. SHIFT REPORT COGS RPC');
console.log('='.repeat(60));

// get shift summary for a recent shift
const { data: shifts } = await s.from('cash_shifts').select('id, opened_at, closed_at').order('opened_at', { ascending: false }).limit(3);
for (const sh of (shifts || []).filter(s => s.closed_at)) {
  const { data: shiftSummary, error: shErr } = await s.rpc('get_shift_summary_v2', { p_shift_id: sh.id });
  if (shErr) {
    console.log(`  Shift ${sh.id.slice(-6)}: ERROR - ${shErr.message}`);
  } else {
    console.log(`  Shift ${sh.id.slice(-6)} | cogs: ${(shiftSummary as any)?.cogs || 0} | revenue: ${(shiftSummary as any)?.total_sales || (shiftSummary as any)?.total_revenue || 0}`);
  }
  break;  // Just check first closed shift
}

process.exit(0);
