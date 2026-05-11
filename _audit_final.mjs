import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://pmhivhtaoydfolseelyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec'
);

async function run() {
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: 'owner@azta.com', password: 'AhmedZ#123456'
  });
  if (authErr) { console.error('Auth Error:', authErr.message); return; }

  // 1. Payment coverage
  console.log('=== Payment Coverage Analysis ===');
  const { data: orders } = await supabase
    .from('orders')
    .select('id, status, currency, data')
    .eq('status', 'delivered')
    .order('created_at', { ascending: false });
  
  let cashPaid = 0, cashNoPay = 0, arPaid = 0, arNoPay = 0;
  const arNoPay_list = [];
  const cashNoPay_list = [];
  for (const o of orders || []) {
    const d = o.data || {};
    const method = d.paymentMethod || '';
    const { count } = await supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('reference_table', 'orders')
      .eq('reference_id', o.id);
    const isCreditSale = d.isCreditSale || method === 'ar';
    if (isCreditSale) {
      if (count > 0) arPaid++; else { arNoPay++; arNoPay_list.push({ id: o.id, total: d.total, currency: o.currency }); }
    } else {
      if (count > 0) cashPaid++; else { cashNoPay++; cashNoPay_list.push({ id: o.id, total: d.total, method, currency: o.currency }); }
    }
  }
  console.log(`  Total delivered orders: ${(orders||[]).length}`);
  console.log(`  Cash/Non-credit WITH payment records: ${cashPaid}`);
  console.log(`  Cash/Non-credit WITHOUT payment records: ${cashNoPay}`);
  console.log(`  AR (Credit) WITH payment records: ${arPaid}`);
  console.log(`  AR (Credit) WITHOUT payment records: ${arNoPay}`);
  
  if (cashNoPay > 0) {
    console.log('\n  ⚠️ Cash orders without payment records:');
    for (const x of cashNoPay_list) {
      console.log(`    #${x.id.slice(-6)} total:${x.total} ${x.currency} method:${x.method}`);
    }
  }

  // 2. Inventory Movement coverage
  console.log('\n=== Inventory Movement Coverage ===');
  const { data: imSample } = await supabase.from('inventory_movements').select('*').limit(1);
  const imCols = imSample?.[0] ? Object.keys(imSample[0]) : [];
  console.log('  Columns:', imCols.join(', '));
  
  // Check if inventory_movements has an order reference
  const hasSourceId = imCols.includes('source_id');
  const hasOrderId = imCols.includes('order_id');
  const hasReferenceId = imCols.includes('reference_id');
  console.log(`  Has source_id: ${hasSourceId}, order_id: ${hasOrderId}, reference_id: ${hasReferenceId}`);
  
  // Find inventory movements for a recent order
  const lastDelivered = (orders || []).find(o => (o.data||{}).paymentMethod !== 'ar');
  if (lastDelivered) {
    console.log(`\n  Checking inventory for order #${lastDelivered.id.slice(-6)}...`);
    if (hasSourceId) {
      const { data: ims, count } = await supabase
        .from('inventory_movements')
        .select('id, item_id, quantity, movement_type, warehouse_id', { count: 'exact' })
        .eq('source_id', lastDelivered.id);
      console.log(`  Found ${count} movements via source_id`);
      for (const m of (ims||[]).slice(0, 5)) {
        console.log(`    ${m.movement_type} qty:${m.quantity} item:${(m.item_id||'').slice(-6)} wh:${(m.warehouse_id||'').slice(-6)}`);
      }
    }
    // Also try text search on data column
    const { data: ims2, count: c2 } = await supabase
      .from('inventory_movements')
      .select('id, item_id, quantity, movement_type', { count: 'exact' })
      .textSearch('source_id', lastDelivered.id)
      .limit(5);
  }

  // 3. Payments table analysis  
  console.log('\n=== Payments Analysis ===');
  const { data: allPayments } = await supabase
    .from('payments')
    .select('id, reference_id, amount, method, direction, currency, occurred_at, shift_id')
    .eq('reference_table', 'orders')
    .order('occurred_at', { ascending: false })
    .limit(15);
  
  const methodCounts = {};
  for (const p of allPayments || []) {
    methodCounts[p.method] = (methodCounts[p.method] || 0) + 1;
  }
  console.log('  Payment methods used:', JSON.stringify(methodCounts));
  console.log('  Recent 5 payments:');
  for (const p of (allPayments||[]).slice(0, 5)) {
    console.log(`    #${p.id.slice(-6)} -> order:#${p.reference_id.slice(-6)} | ${p.amount} ${p.currency||''} | ${p.method} | shift:${p.shift_id ? p.shift_id.slice(-6) : 'none'}`);
  }

  // 4. Check the order data structure for completeness
  console.log('\n=== Order Data Structure Completeness ===');
  const sampleOrder = (orders || [])[0];
  if (sampleOrder) {
    const d = sampleOrder.data || {};
    const checks = {
      'orderSource': !!d.orderSource,
      'items array': Array.isArray(d.items) && d.items.length > 0,
      'invoiceNumber': !!d.invoiceNumber,
      'invoiceSnapshot': !!d.invoiceSnapshot,
      'invoiceIssuedAt': !!d.invoiceIssuedAt,
      'total': typeof d.total === 'number',
      'subtotal': typeof d.subtotal === 'number',
      'discountAmount': d.discountAmount !== undefined,
      'paymentMethod': !!d.paymentMethod,
      'paymentBreakdown': Array.isArray(d.paymentBreakdown),
      'customerName': !!d.customerName,
      'currency': !!d.currency || !!sampleOrder.currency,
      'fxRate': d.fxRate !== undefined,
      'baseCurrency': !!d.baseCurrency,
      'warehouseId': !!d.warehouseId,
      'deliveryZoneId': !!d.deliveryZoneId,
      'createdAt': !!d.createdAt,
      'deliveredAt': !!d.deliveredAt,
      'paidAt': d.paidAt !== undefined,
      'isCreditSale': d.isCreditSale !== undefined,
      'invoiceTerms': !!d.invoiceTerms,
    };
    
    for (const [k, v] of Object.entries(checks)) {
      console.log(`  ${v ? '✅' : '❌'} ${k}`);
    }
  }

  // 5. Check if all RPC functions needed by the frontend exist
  console.log('\n=== Critical RPC Functions Test (with proper params) ===');
  
  // Test get_fefo_pricing with valid params
  const { data: items } = await supabase.from('menu_items').select('id').limit(1);
  const { data: whs } = await supabase.from('warehouses').select('id').limit(1);
  if (items?.[0] && whs?.[0]) {
    const { data: pricing, error: prErr } = await supabase.rpc('get_fefo_pricing', {
      p_item_id: items[0].id,
      p_warehouse_id: whs[0].id,
      p_quantity: 1,
      p_customer_id: null,
      p_currency_code: 'SAR',
      p_batch_id: null
    });
    if (prErr) {
      if (prErr.code === 'PGRST202' || prErr.code === '42883') {
        console.log('  get_fefo_pricing: NOT DEPLOYED ❌');
      } else {
        console.log(`  get_fefo_pricing: EXISTS but error: ${prErr.code} ${prErr.message.substring(0, 60)}`);
      }
    } else {
      console.log('  get_fefo_pricing: WORKING ✅', JSON.stringify(pricing));
    }
  }

  // Test reserve_stock_for_order
  const { error: rsErr } = await supabase.rpc('reserve_stock_for_order', {
    p_items: [], p_order_id: null, p_warehouse_id: null
  });
  console.log(`  reserve_stock_for_order: ${rsErr?.code === 'PGRST202' || rsErr?.code === '42883' ? 'NOT DEPLOYED ❌' : `EXISTS (${rsErr?.code || 'OK'}) ✅`}`);

  // Test confirm_order_delivery_with_credit
  const { error: cdErr } = await supabase.rpc('confirm_order_delivery_with_credit', {
    p_order_id: '00000000-0000-0000-0000-000000000000',
    p_items: [],
    p_updated_data: {},
    p_warehouse_id: '00000000-0000-0000-0000-000000000000'
  });
  console.log(`  confirm_order_delivery_with_credit: ${cdErr?.code === 'PGRST202' || cdErr?.code === '42883' ? 'NOT DEPLOYED ❌' : `EXISTS (${cdErr?.code || 'OK'}: ${(cdErr?.message||'').substring(0,40)}) ✅`}`);

  // Test record_order_payment_v2
  const { error: rpErr } = await supabase.rpc('record_order_payment_v2', {
    p_order_id: '00000000-0000-0000-0000-000000000000',
    p_amount: 0,
    p_method: 'test',
    p_occurred_at: new Date().toISOString(),
    p_data: {}
  });
  console.log(`  record_order_payment_v2: ${rpErr?.code === 'PGRST202' || rpErr?.code === '42883' ? 'NOT DEPLOYED ❌' : `EXISTS (${rpErr?.code || 'OK'}: ${(rpErr?.message||'').substring(0,40)}) ✅`}`);

  // Test assign_invoice_number_if_missing
  const { error: ainErr } = await supabase.rpc('assign_invoice_number_if_missing', {
    p_order_id: '00000000-0000-0000-0000-000000000000'
  });
  console.log(`  assign_invoice_number_if_missing: ${ainErr?.code === 'PGRST202' || ainErr?.code === '42883' ? 'NOT DEPLOYED ❌' : `EXISTS (${ainErr?.code || 'OK'}) ✅`}`);

  console.log('\n=== COMPREHENSIVE AUDIT COMPLETE ===');
}
run().catch(e => console.error('Fatal:', e));
