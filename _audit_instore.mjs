import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  'https://pmhivhtaoydfolseelyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec'
);

async function run() {
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'owner@azta.com', password: 'AhmedZ#123456'
  });
  if (authErr) { console.error('Auth Error:', authErr.message); return; }
  console.log('Auth OK:', auth.user?.email);

  // 1. Check RPC functions
  const rpcs = [
    'confirm_order_delivery', 'confirm_order_delivery_with_credit',
    'reserve_stock_for_order', 'get_fefo_pricing',
    'record_order_payment', 'record_order_payment_v2',
    'assign_invoice_number_if_missing', 'get_warehouse_item_alerts',
    'list_item_uom_units', 'get_fx_rate_rpc'
  ];
  console.log('\n=== RPC Functions Check ===');
  for (const rpc of rpcs) {
    try {
      const { error } = await supabase.rpc(rpc, {});
      if (error) {
        const code = error.code || '';
        if (code === 'PGRST202' || code === '42883') {
          console.log(`  ${rpc}: NOT FOUND ❌`);
        } else {
          console.log(`  ${rpc}: EXISTS ✅ (err: ${code})`);
        }
      } else {
        console.log(`  ${rpc}: EXISTS ✅`);
      }
    } catch (e) {
      console.log(`  ${rpc}: EXCEPTION: ${e.message}`);
    }
  }

  // 2. Recent orders
  console.log('\n=== Recent 10 Orders ===');
  const { data: orders, error: oErr } = await supabase
    .from('orders')
    .select('id, status, created_at, currency, fx_rate, base_total, data')
    .order('created_at', { ascending: false })
    .limit(10);
  if (oErr) console.error('Orders Error:', oErr.message);
  else {
    for (const o of orders || []) {
      const d = o.data || {};
      const src = d.orderSource || 'N/A';
      const total = d.total || 0;
      const method = d.paymentMethod || 'N/A';
      const name = d.customerName || '';
      const inv = d.invoiceNumber || '';
      const paidAt = d.paidAt || 'NOT PAID';
      const deliveredAt = d.deliveredAt || 'NOT DELIVERED';
      const hasInvSnapshot = d.invoiceSnapshot ? 'YES' : 'NO';
      const failReason = d.inStoreFailureReason || '';
      console.log(`  #${o.id.slice(-6)} | ${o.status} | ${src} | ${total} ${o.currency || ''} | pay:${method} | inv:${inv} | invSnap:${hasInvSnapshot} | paid:${paidAt !== 'NOT PAID' ? 'YES' : 'NO'} | delivered:${deliveredAt !== 'NOT DELIVERED' ? 'YES' : 'NO'}${failReason ? ' | FAIL:' + failReason.substring(0, 50) : ''}`);
    }
  }

  // 3. In-store orders specifically
  console.log('\n=== In-Store Orders (last 10) ===');
  const { data: isOrders } = await supabase
    .from('orders')
    .select('id, status, created_at, currency, data')
    .contains('data', { orderSource: 'in_store' })
    .order('created_at', { ascending: false })
    .limit(10);
  for (const o of isOrders || []) {
    const d = o.data || {};
    console.log(`  #${o.id.slice(-6)} | ${o.status} | total:${d.total} ${o.currency||''} | pay:${d.paymentMethod} | items:${(d.items||[]).length} | paid:${d.paidAt?'YES':'NO'} | inv:${d.invoiceNumber||'NONE'}`);
  }

  // 4. Check payments linked to orders
  console.log('\n=== Payments (last 10) ===');
  const { data: payments, error: pErr } = await supabase
    .from('payments')
    .select('id, reference_id, amount, method, direction, currency_code, created_at')
    .eq('reference_table', 'orders')
    .order('created_at', { ascending: false })
    .limit(10);
  if (pErr) console.error('Payments Error:', pErr.message);
  else {
    for (const p of payments || []) {
      console.log(`  Pay:#${p.id.slice(-6)} -> order:#${p.reference_id.slice(-6)} | ${p.amount} ${p.currency_code||''} | ${p.method} | ${p.direction}`);
    }
  }

  // 5. Check stock_movements for recent orders
  console.log('\n=== Stock Movements (last 10) ===');
  const { data: sm, error: smErr } = await supabase
    .from('stock_movements')
    .select('id, item_id, warehouse_id, movement_type, quantity, order_id, created_at')
    .not('order_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);
  if (smErr) console.error('SM Error:', smErr.message);
  else {
    for (const s of sm || []) {
      console.log(`  SM:${s.movement_type} | qty:${s.quantity} | item:#${(s.item_id||'').slice(-6)} | order:#${(s.order_id||'').slice(-6)} | wh:#${(s.warehouse_id||'').slice(-6)}`);
    }
  }

  // 6. Check journal_entries for recent orders
  console.log('\n=== Journal Entries for Orders (last 10) ===');
  const { data: je, error: jeErr } = await supabase
    .from('journal_entries')
    .select('id, reference_table, reference_id, amount, account_id, entry_type, created_at')
    .eq('reference_table', 'orders')
    .order('created_at', { ascending: false })
    .limit(10);
  if (jeErr) console.error('JE Error:', jeErr.message);
  else {
    for (const j of je || []) {
      console.log(`  JE:${j.entry_type} | amount:${j.amount} | order:#${(j.reference_id||'').slice(-6)} | acct:#${(j.account_id||'').slice(-6)}`);
    }
  }

  // 7. Check orders table schema columns
  console.log('\n=== Orders Table Columns ===');
  const { data: cols } = await supabase.rpc('exec_debug_sql', {
    p_sql: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders' AND table_schema = 'public' ORDER BY ordinal_position"
  });
  if (cols) {
    for (const c of cols) console.log(`  ${c.column_name}: ${c.data_type}`);
  }

  // 8. Check for orphaned orders (no payments, no stock movements)
  console.log('\n=== Integrity Check: Delivered Orders Without Payments ===');
  const { data: deliveredOrders } = await supabase
    .from('orders')
    .select('id, status, currency, data')
    .eq('status', 'delivered')
    .order('created_at', { ascending: false })
    .limit(50);
  let orphanCount = 0;
  for (const o of deliveredOrders || []) {
    const { count } = await supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('reference_table', 'orders')
      .eq('reference_id', o.id);
    if (count === 0) {
      orphanCount++;
      const d = o.data || {};
      console.log(`  ⚠️ Order #${o.id.slice(-6)} delivered but NO payments! total:${d.total} ${o.currency||''} pay:${d.paymentMethod}`);
    }
  }
  if (orphanCount === 0) console.log('  ✅ All delivered orders have payment records.');

  // 9. Check for pending in-store orders (stuck)
  console.log('\n=== Stuck Pending In-Store Orders ===');
  const { data: stuckOrders } = await supabase
    .from('orders')
    .select('id, status, created_at, data')
    .eq('status', 'pending')
    .contains('data', { orderSource: 'in_store' })
    .order('created_at', { ascending: false })
    .limit(20);
  if (!stuckOrders?.length) {
    console.log('  ✅ No stuck pending in-store orders.');
  } else {
    for (const o of stuckOrders) {
      const d = o.data || {};
      const fail = d.inStoreFailureReason || '';
      const age = Math.round((Date.now() - new Date(o.created_at).getTime()) / 60000);
      console.log(`  ⚠️ Stuck #${o.id.slice(-6)} | age:${age}min | fail:${fail || 'none'} | total:${d.total}`);
    }
  }

  console.log('\n=== AUDIT COMPLETE ===');
}
run().catch(e => console.error('Fatal:', e));
