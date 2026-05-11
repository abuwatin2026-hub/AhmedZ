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

  console.log('=== Checking Specific Orders ===');
  // The orders mentioned are c3df7e and 50fe87
  const { data: orders } = await supabase
    .from('orders')
    .select('id, status, created_at, currency, data')
    .or('id.ilike.c3df7e%,id.ilike.50fe87%');

  if (!orders || orders.length === 0) {
    console.log('Orders not found. Let us check the most recent in-store orders.');
    const { data: recent } = await supabase
      .from('orders')
      .select('id, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    console.log(recent);
    return;
  }

  for (const o of orders) {
    console.log(`\nOrder: ${o.id}`);
    console.log(`Status: ${o.status}`);
    console.log(`Created: ${o.created_at}`);
    
    // Check payments
    const { data: payments } = await supabase
      .from('payments')
      .select('id, amount, method, created_at')
      .eq('reference_table', 'orders')
      .eq('reference_id', o.id);
    
    console.log(`Payments Count: ${payments?.length || 0}`);
    if (payments?.length) console.log('Payments:', payments);

    // Check inventory movements
    const { data: ims } = await supabase
      .from('inventory_movements')
      .select('id, movement_type, quantity, item_id')
      .eq('source_id', o.id);
      
    console.log(`Inventory Movements Count: ${ims?.length || 0}`);
    if (ims?.length) console.log('Movements:', ims);
    
    // If pending, check for failure reason in data
    if (o.status === 'pending') {
      console.log('Failure Reason (if any):', o.data?.inStoreFailureReason);
      console.log('Background Probe Status:', o.data?.paymentRecordOk);
    }
  }
}

run().catch(console.error);
