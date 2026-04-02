/**
 * MAXIMUM DEPTH verification:
 * 1. GL journal entries for missing orders
 * 2. Batch balances impact check
 * 3. cogs_status column check
 * 4. stock_management expected vs actual
 * 5. reservation_ledger check
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

  // Load all delivered orders
  const { data: allOrders } = await sb
    .from('orders').select('id, status, created_at, data')
    .eq('status', 'delivered').gte('created_at', since)
    .order('created_at', { ascending: true });

  // Load sale_outs
  const { data: allSaleOuts } = await sb
    .from('inventory_movements')
    .select('id, reference_id, item_id, quantity, created_at')
    .eq('movement_type', 'sale_out').gte('created_at', since);

  const saleOutRefIds = new Set((allSaleOuts||[]).map(m => m.reference_id));
  const missingOrders = (allOrders||[]).filter(o => !saleOutRefIds.has(o.id));
  const missingIds = missingOrders.map(o => o.id);

  console.log(`طلبات مفقودة: ${missingIds.length}`);

  // ═══ TEST A: GL Journal Lines for missing orders ═══
  console.log('\n══════════════════════════════════');
  console.log('A: هل للطلبات المفقودة قيود محاسبية (GL)?');
  console.log('══════════════════════════════════');
  const missingIdsSample = missingIds.slice(0, 10);
  const { data: glLines, error: glErr } = await sb
    .from('journal_lines')
    .select('id, journal_entry_id, source_type, source_id, debit, credit, created_at')
    .or(missingIdsSample.map(id => `source_id.eq.${id}`).join(','))
    .limit(20);

  if (glErr) {
    console.log('  ⚠️ GL access error:', glErr.message);
    // try different table name
    const { data: gl2, error: gl2Err } = await sb
      .from('accounting_light_entries')
      .select('id, source_id, source_type, debit, credit')
      .or(missingIdsSample.map(id => `source_id.eq.${id}`).join(','))
      .limit(20);
    if (gl2Err) console.log('  ⚠️ accounting_light_entries error:', gl2Err.message);
    else console.log(`  قيود محاسبية found (accounting_light_entries): ${(gl2||[]).length}`);
  } else {
    console.log(`  قيود GL للطلبات المفقودة (عينة 10): ${(glLines||[]).length}`);
    for (const l of (glLines||[]).slice(0,5)) {
      console.log(`    ${l.source_type} | ${(l.source_id||'').slice(0,8)} | D:${l.debit} C:${l.credit}`);
    }
  }

  // Try accounting_light_entries
  const { data: aleLines } = await sb
    .from('accounting_light_entries')
    .select('id, source_id, source_type, account_code, debit, credit')
    .or(missingIdsSample.map(id => `source_id.eq.${id}`).join(','))
    .limit(30);
  console.log(`  accounting_light_entries للعينة: ${(aleLines||[]).length}`);
  const cogs = (aleLines||[]).filter(l => l.account_code?.startsWith('5'));
  const revenue = (aleLines||[]).filter(l => l.account_code?.startsWith('4'));
  console.log(`    - إدخالات COGS (5xxx): ${cogs.length}`);
  console.log(`    - إدخالات إيرادات (4xxx): ${revenue.length}`);

  // ═══ TEST B: cogs_status field ═══
  console.log('\n══════════════════════════════════');
  console.log('B: فحص حقل cogs_status في الطلبات');
  console.log('══════════════════════════════════');
  const cogsStatuses = {};
  for (const o of missingOrders) {
    const cs = o.data?.cogs_status || o.data?.cogsStatus || 'غير موجود';
    cogsStatuses[cs] = (cogsStatuses[cs]||0) + 1;
  }
  console.log('  توزيع cogs_status في الطلبات المفقودة:');
  for (const [k,v] of Object.entries(cogsStatuses)) console.log(`    ${k}: ${v}`);

  // Do orders WITH movements have cogs_status?
  const ordersWithMov = (allOrders||[]).filter(o => saleOutRefIds.has(o.id));
  const cogsStatusesWith = {};
  for (const o of ordersWithMov) {
    const cs = o.data?.cogs_status || o.data?.cogsStatus || 'غير موجود';
    cogsStatusesWith[cs] = (cogsStatusesWith[cs]||0) + 1;
  }
  console.log('  توزيع cogs_status في الطلبات السليمة:');
  for (const [k,v] of Object.entries(cogsStatusesWith)) console.log(`    ${k}: ${v}`);

  // ═══ TEST C: batch_balances impact ═══
  console.log('\n══════════════════════════════════');
  console.log('C: فحص batch_balances للأصناف المعنية');
  console.log('══════════════════════════════════');
  // Get item IDs from missing orders
  const missingItemIds = new Set();
  for (const o of missingOrders.slice(0, 5)) {
    for (const it of (o.data?.items||[])) {
      if (it.id) missingItemIds.add(it.id);
    }
  }
  console.log(`  أصناف من أول 5 طلبات مفقودة: ${missingItemIds.size}`);

  if (missingItemIds.size > 0) {
    const itemIdsList = [...missingItemIds];
    const { data: batches, error: bErr } = await sb
      .from('inventory_batches')
      .select('id, item_id, quantity_on_hand, quantity_reserved, quantity_consumed, unit_cost, expiry_date, status')
      .in('item_id', itemIdsList)
      .order('expiry_date', { ascending: true });

    if (bErr) console.log('  ⚠️ batch error:', bErr.message);
    else {
      console.log(`  دُفعات الأصناف المعنية: ${(batches||[]).length}`);
      for (const b of (batches||[]).slice(0,8)) {
        console.log(`    batch ${b.id?.slice(0,8)} | item:${(b.item_id||'').slice(0,8)} | on_hand:${b.quantity_on_hand} | reserved:${b.quantity_reserved} | consumed:${b.quantity_consumed} | status:${b.status}`);
      }
    }
  }

  // ═══ TEST D: Current stock vs expected ═══
  console.log('\n══════════════════════════════════');
  console.log('D: مقارنة المخزون الحالي مع المتوقع');
  console.log('══════════════════════════════════');
  // For each item in missing orders, how much SHOULD have been deducted?
  const shouldDeductByItem = {};
  for (const o of missingOrders) {
    for (const it of (o.data?.items||[])) {
      const key = it.id;
      if (!key) continue;
      shouldDeductByItem[key] = shouldDeductByItem[key] || { name: it.name?.ar || it.name || '?', qty: 0 };
      shouldDeductByItem[key].qty += Number(it.quantity || it.qty || 0);
    }
  }

  const topItems = Object.entries(shouldDeductByItem)
    .sort((a,b) => b[1].qty - a[1].qty)
    .slice(0, 10);

  console.log('  أعلى 10 أصناف يجب خصمها (من الطلبات المفقودة):');
  console.log('  الصنف  | الاسم | الكمية المفترض خصمها | المخزون الحالي');
  for (const [itemId, info] of topItems) {
    const { data: stock } = await sb
      .from('stock_management')
      .select('available_quantity, reserved_quantity')
      .eq('item_id', itemId)
      .limit(1);
    const s = (stock||[])[0];
    const current = s ? s.available_quantity : 'غير موجود';
    const reserved = s ? s.reserved_quantity : '—';
    console.log(`  ${itemId.slice(0,8)} | ${info.name.slice(0,25)} | يجب خصم: ${info.qty} | حالي: ${current} | محجوز: ${reserved}`);
  }

  // ═══ TEST E: reservation_ledger check ═══
  console.log('\n══════════════════════════════════');
  console.log('E: فحص reservation_ledger للطلبات المفقودة');
  console.log('══════════════════════════════════');
  const { data: reservations, error: rErr } = await sb
    .from('reservation_ledger')
    .select('id, order_id, item_id, quantity, action, created_at')
    .in('order_id', missingIds.slice(0, 10))
    .order('created_at');

  if (rErr) console.log('  ⚠️ reservation_ledger error:', rErr.message);
  else {
    console.log(`  سجلات الحجز لأول 10 طلبات مفقودة: ${(reservations||[]).length}`);
    const byAction = {};
    for (const r of (reservations||[])) {
      byAction[r.action] = (byAction[r.action]||0) + 1;
    }
    for (const [a,n] of Object.entries(byAction)) console.log(`    ${a}: ${n}`);
    // Check if they have 'released' or 'deducted'
    const hasDeducted = (reservations||[]).some(r => r.action === 'deducted' || r.action === 'deduct');
    const hasReleased = (reservations||[]).some(r => r.action === 'released');
    const hasReserved = (reservations||[]).some(r => r.action === 'reserved');
    console.log(`  has_deducted_action: ${hasDeducted} | has_released: ${hasReleased} | has_reserved: ${hasReserved}`);
  }

  // ═══ TEST F: orders table has cogs_status column? ═══
  console.log('\n══════════════════════════════════');
  console.log('F: هل جدول orders لديه عمود cogs_status?');
  console.log('══════════════════════════════════');
  const { data: cogsOrders, error: cogsErr } = await sb
    .from('orders')
    .select('id, cogs_status')
    .eq('status', 'delivered')
    .gte('created_at', since)
    .limit(5);

  if (cogsErr) {
    console.log('  ❌ عمود cogs_status غير موجود:', cogsErr.message);
  } else {
    console.log('  ✅ عمود cogs_status موجود:');
    const statusDist = {};
    for (const o of (cogsOrders||[])) {
      statusDist[o.cogs_status||'null'] = (statusDist[o.cogs_status||'null']||0)+1;
    }
    for (const [k,v] of Object.entries(statusDist)) console.log(`    ${k}: ${v}`);

    // Get full distribution
    const { data: allCogsStatus } = await sb
      .from('orders')
      .select('id, cogs_status')
      .eq('status', 'delivered')
      .gte('created_at', since);
    const fullDist = {};
    for (const o of (allCogsStatus||[])) {
      fullDist[o.cogs_status||'null'] = (fullDist[o.cogs_status||'null']||0)+1;
    }
    console.log('  توزيع cogs_status في كل الطلبات المسلمة:');
    for (const [k,v] of Object.entries(fullDist)) console.log(`    ${k}: ${v}`);
  }

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
