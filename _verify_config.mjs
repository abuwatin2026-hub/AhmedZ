import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  'https://pmhivhtaoydfolseelyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec'
);
async function run() {
  await supabase.auth.signInWithPassword({ email: 'owner@azta.com', password: 'AhmedZ#123456' });

  // 1. Check currencies table for exchange rates
  console.log('=== Currencies Table ===');
  const { data: currencies } = await supabase.from('currencies').select('*');
  for (const c of currencies || []) {
    console.log(`  ${c.code}: rate=${c.current_exchange_rate}, is_base=${c.is_base_currency}, active=${c.is_active}`);
  }

  // 2. Check chart_of_accounts for destination accounts (1020=kuraimi, 1030=network)
  console.log('\n=== Bank/Network Destination Accounts ===');
  const { data: accounts } = await supabase
    .from('chart_of_accounts')
    .select('id, code, name, is_active, parent_id')
    .or('code.like.1020%,code.like.1030%')
    .eq('is_active', true);
  for (const a of accounts || []) {
    console.log(`  ${a.code}: ${JSON.stringify(a.name)} active=${a.is_active}`);
  }

  // 3. Check if there are parent accounts 1020 and 1030
  console.log('\n=== Parent Account Check (1020/1030) ===');
  const { data: parents } = await supabase
    .from('chart_of_accounts')
    .select('id, code, name')
    .in('code', ['1020', '1030']);
  for (const p of parents || []) {
    console.log(`  Parent: ${p.code} = ${JSON.stringify(p.name)} (id: ${p.id})`);
    // Check children
    const { data: children } = await supabase
      .from('chart_of_accounts')
      .select('id, code, name, is_active')
      .eq('parent_id', p.id)
      .eq('is_active', true);
    for (const ch of children || []) {
      console.log(`    Child: ${ch.code} = ${JSON.stringify(ch.name)} active=${ch.is_active}`);
    }
  }

  // 4. Check if multi-warehouse orders exist historically
  console.log('\n=== Historical Multi-Warehouse Success Check ===');
  const { data: allOrders } = await supabase
    .from('orders')
    .select('id, status, data, warehouse_id')
    .eq('status', 'delivered')
    .order('created_at', { ascending: false });
  let multiWhCount = 0;
  for (const o of allOrders || []) {
    const items = (o.data?.items || []);
    const warehouses = new Set(items.map((i) => i.warehouseId).filter(Boolean));
    if (warehouses.size > 1) {
      multiWhCount++;
      console.log(`  Order #${o.id.slice(-6)}: ${warehouses.size} warehouses = ${[...warehouses].map(w => w.slice(-6)).join(', ')}`);
    }
  }
  console.log(`  Total multi-warehouse delivered orders: ${multiWhCount}`);

  // 5. Check historical foreign currency orders
  console.log('\n=== Historical Foreign Currency Orders ===');
  const { data: fxOrders } = await supabase
    .from('orders')
    .select('id, status, currency, data')
    .eq('status', 'delivered')
    .neq('currency', 'SAR');
  console.log(`  Total non-SAR delivered orders: ${(fxOrders || []).length}`);
  for (const o of (fxOrders || []).slice(0, 5)) {
    console.log(`  #${o.id.slice(-6)}: ${o.currency} fxRate=${o.data?.fxRate} total=${o.data?.total}`);
  }

  console.log('\n=== DONE ===');
}
run();
