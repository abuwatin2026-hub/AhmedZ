/**
 * Deep COGS verification - check actual costs, currencies, ratios
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pmhivhtaoydfolseelyc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: 'owner@azta.com', password: 'AhmedZ#123456',
  });
  if (authErr) { console.error('AUTH FAILED:', authErr.message); process.exit(1); }
  console.log('✅ Auth OK\n');

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // ══ 1: What currencies are in delivered orders? ══
  console.log('══ 1: توزيع العملات في الطلبات المسلمة ══');
  const { data: orders } = await sb
    .from('orders').select('id, data')
    .eq('status', 'delivered').gte('created_at', since);

  const currencyTotals = {};
  for (const o of (orders||[])) {
    const d = o.data || {};
    const cur = d.currency || d.baseCurrency || 'YER';
    const total = Number(d.total || 0);
    const fxRate = Number(d.fxRate || 1);
    const totalInBase = cur !== 'YER' ? total * fxRate : total;
    if (!currencyTotals[cur]) currencyTotals[cur] = { count: 0, total: 0, totalBase: 0 };
    currencyTotals[cur].count++;
    currencyTotals[cur].total += total;
    currencyTotals[cur].totalBase += totalInBase;
  }
  let grandTotalBase = 0;
  for (const [cur, v] of Object.entries(currencyTotals)) {
    console.log(`  ${cur}: ${v.count} طلب | إجمالي: ${v.total.toLocaleString()} | بالـ YER: ${v.totalBase.toLocaleString()}`);
    grandTotalBase += v.totalBase;
  }
  console.log(`  إجمالي الإيرادات (YER): ${grandTotalBase.toLocaleString()}`);

  // ══ 2: order_item_cogs — what are actual costs per order? ══
  console.log('\n══ 2: order_item_cogs — تفاصيل دقيقة لأول 10 طلبات ══');
  for (const order of (orders||[]).slice(0, 10)) {
    const d = order.data || {};
    const rev = Number(d.total || 0);
    const cur = d.currency || 'YER';
    const { data: cogsRows } = await sb
      .from('order_item_cogs').select('quantity, unit_cost, total_cost, item_id')
      .eq('order_id', order.id);
    const totalCogs = (cogsRows||[]).reduce((s,r) => s + Number(r.total_cost||0), 0);
    const margin = rev > 0 ? (((rev - totalCogs) / rev) * 100).toFixed(0) : '?';
    const hasZeroCost = (cogsRows||[]).some(r => Number(r.unit_cost||0) === 0);
    console.log(`  ${order.id.slice(0,8)} | ${cur} | rev:${rev.toLocaleString()} | COGS:${totalCogs.toLocaleString()} | margin:${margin}% | zero_cost:${hasZeroCost} | items:${(cogsRows||[]).length}`);
  }

  // ══ 3: Compare revenue vs COGS in SAME currency ══
  console.log('\n══ 3: COGS vs إيرادات بنفس العملة ══');
  const { data: allCogs } = await sb
    .from('order_item_cogs').select('order_id, quantity, unit_cost, total_cost')
    .gte('created_at', since);
  
  const cogsByOrder = {};
  for (const r of (allCogs||[])) {
    cogsByOrder[r.order_id] = (cogsByOrder[r.order_id]||0) + Number(r.total_cost||0);
  }

  let totalRevYER = 0, totalCogsYER = 0;
  let zeroCogsOrders = 0;
  for (const o of (orders||[])) {
    const d = o.data || {};
    const cur = d.currency || 'YER';
    const fxRate = Number(d.fxRate || 1);
    const rev = Number(d.total || 0);
    const cogs = cogsByOrder[o.id] || 0;
    // Convert to YER if SAR
    const factor = (cur === 'SAR' || cur === 'USD') ? fxRate : 1;
    totalRevYER += rev * factor;
    totalCogsYER += cogs * factor;
    if (cogs === 0) zeroCogsOrders++;
  }

  console.log(`  إجمالي إيرادات (YER محوّل): ${totalRevYER.toLocaleString()}`);
  console.log(`  إجمالي COGS (YER محوّل): ${totalCogsYER.toLocaleString()}`);
  console.log(`  طلبات COGS = 0: ${zeroCogsOrders}`);
  if (totalRevYER > 0) {
    console.log(`  نسبة COGS: ${(totalCogsYER/totalRevYER*100).toFixed(2)}%`);
    console.log(`  هامش الربح الإجمالي: ${((1 - totalCogsYER/totalRevYER)*100).toFixed(2)}%`);
  }

  // ══ 4: Check actual sale_out movements unit_cost distribution ══
  console.log('\n══ 4: توزيع unit_cost في حركات sale_out ══');
  const { data: saleOuts } = await sb
    .from('inventory_movements')
    .select('id, item_id, quantity, unit_cost, total_cost, data')
    .eq('movement_type', 'sale_out').gte('created_at', since);

  const costDist = { zero: 0, low: 0, normal: 0 };
  let totalSaleOutCost = 0;
  for (const m of (saleOuts||[])) {
    const uc = Number(m.unit_cost || 0);
    totalSaleOutCost += Number(m.total_cost || 0);
    if (uc === 0) costDist.zero++;
    else if (uc < 100) costDist.low++;
    else costDist.normal++;
  }
  console.log(`  إجمالي حركات sale_out: ${(saleOuts||[]).length}`);
  console.log(`  unit_cost = 0: ${costDist.zero}`);
  console.log(`  unit_cost < 100: ${costDist.low}`);
  console.log(`  unit_cost >= 100: ${costDist.normal}`);
  console.log(`  إجمالي total_cost (من الحركات): ${totalSaleOutCost.toLocaleString()}`);

  // Sample of actual unit_cost values
  console.log('\n  عينة من الحركات وأسعارها:');
  for (const m of (saleOuts||[]).slice(0, 10)) {
    const isBackfill = m.data?.backfill === true || m.data?.backfill === 'true';
    console.log(`    item:${(m.item_id||'').slice(0,8)} | qty:${m.quantity} | unit_cost:${m.unit_cost} | total:${m.total_cost} | ${isBackfill?'[backfill]':'[original]'}`);
  }

  // ══ 5: Check avg_cost history using menu_items ══
  console.log('\n══ 5: تكلفة الأصناف الأكثر مبيعاً ══');
  const itemFreq = {};
  for (const o of (orders||[])) {
    for (const it of (o.data?.items||[])) {
      if (it.id) itemFreq[it.id] = (itemFreq[it.id]||{ name: it.name?.ar||it.name||'?', count: 0 });
      if (it.id) itemFreq[it.id].count++;
    }
  }
  const topItems = Object.entries(itemFreq).sort((a,b)=>b[1].count-a[1].count).slice(0,8);
  
  for (const [itemId, info] of topItems) {
    const { data: mi } = await sb.from('menu_items')
      .select('cost_price, buying_price, price').eq('id', itemId).limit(1);
    const { data: sm } = await sb.from('stock_management')
      .select('avg_cost').eq('item_id', itemId).limit(1);
    const item = mi?.[0];
    const stock = sm?.[0];
    console.log(`  ${info.name.slice(0,30)} | price:${item?.price||'?'} | cost:${item?.cost_price||'?'} | avg_cost:${stock?.avg_cost||'?'} | مبيع: ${info.count} مرة`);
  }

  // ══ 6: journal_entries for backfill — what amounts? ══
  console.log('\n══ 6: مبالغ القيود المحاسبية للـ backfill ══');
  const { data: backfillMovs } = await sb
    .from('inventory_movements').select('id, total_cost')
    .eq('movement_type', 'sale_out').filter('data->>backfill', 'eq', 'true')
    .gte('created_at', since).limit(5);

  for (const m of (backfillMovs||[])) {
    const { data: je } = await sb.from('journal_entries')
      .select('id').eq('source_table', 'inventory_movements').eq('source_id', m.id).limit(1);
    if (je?.[0]) {
      const { data: lines } = await sb.from('journal_lines')
        .select('account_id, debit, credit, line_memo').eq('journal_entry_id', je[0].id);
      console.log(`  movement ${m.id.slice(0,8)} total_cost:${m.total_cost}`);
      for (const l of (lines||[])) {
        console.log(`    D:${l.debit} C:${l.credit} — ${l.line_memo}`);
      }
    }
  }

  process.exit(0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
