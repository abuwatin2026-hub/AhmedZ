const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://pmhivhtaoydfolseelyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec'
);

(async () => {
  try {
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: 'owner@azta.com',
      password: 'AhmedZ#123456'
    });
    if (authError) { console.error('Auth error:', authError.message); return; }

    const targetDate = '2026-05-10T00:00:00Z'; // Today and yesterday

    console.log(`=== AUDIT TEST DATA CREATED SINCE ${targetDate} ===\n`);

    // 1. Orders
    const { data: orders } = await supabase.from('orders')
      .select('id, status, total, data, created_at')
      .gte('created_at', targetDate)
      .order('created_at', { ascending: false });
    
    console.log(`[ORDERS] Found ${orders?.length || 0} orders created since ${targetDate}`);
    const pendingOrders = orders?.filter(o => o.status === 'pending') || [];
    const deliveredOrders = orders?.filter(o => o.status === 'delivered') || [];
    console.log(`  - Pending: ${pendingOrders.length}`);
    console.log(`  - Delivered: ${deliveredOrders.length}`);
    
    // Check if delivered orders have stock_movements
    let ordersWithMovements = 0;
    for (const o of deliveredOrders) {
      const { count } = await supabase.from('stock_movements').select('id', { count: 'exact', head: true }).eq('order_id', o.id);
      if (count > 0) ordersWithMovements++;
    }
    console.log(`  - Delivered with stock_movements: ${ordersWithMovements}`);

    // 2. Menu Items
    const { data: items } = await supabase.from('menu_items')
      .select('id, name, created_at')
      .gte('created_at', targetDate);
    
    console.log(`\n[MENU ITEMS] Found ${items?.length || 0} items created since ${targetDate}`);
    if (items?.length > 0) {
      items.forEach(i => console.log(`  - ${i.name?.ar || 'Unknown'} (created: ${i.created_at})`));
    }

    // 3. Batches (if new items were received)
    const { data: batches } = await supabase.from('batches')
      .select('id, item_id, quantity_received, created_at')
      .gte('created_at', targetDate);
    
    console.log(`\n[BATCHES] Found ${batches?.length || 0} batches created since ${targetDate}`);

    // 4. Customers (if any test customers created)
    const { data: customers } = await supabase.from('customers')
      .select('auth_user_id, full_name, created_at')
      .gte('created_at', targetDate);
    
    console.log(`\n[CUSTOMERS] Found ${customers?.length || 0} customers created since ${targetDate}`);
    if (customers?.length > 0) {
      customers.forEach(c => console.log(`  - ${c.full_name} (created: ${c.created_at})`));
    }

    // 5. Financial Parties
    const { data: parties } = await supabase.from('financial_parties')
      .select('id, name_ar, created_at')
      .gte('created_at', targetDate);
    
    console.log(`\n[FINANCIAL PARTIES] Found ${parties?.length || 0} parties created since ${targetDate}`);
    if (parties?.length > 0) {
      parties.forEach(p => console.log(`  - ${p.name_ar} (created: ${p.created_at})`));
    }

    // 6. Cash Shifts
    const { data: shifts } = await supabase.from('cash_shifts')
      .select('id, opened_at, closed_at')
      .gte('opened_at', targetDate);
    
    console.log(`\n[CASH SHIFTS] Found ${shifts?.length || 0} cash shifts created since ${targetDate}`);

  } catch (e) { console.error('Error:', e.message); }
})();
