const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://pmhivhtaoydfolseelyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec'
);

async function identifyTestOrders() {
  await supabase.auth.signInWithPassword({ email: 'owner@azta.com', password: 'AhmedZ#123456' });

  // Get orders from today
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, status, created_at, payment_method, data')
    .gte('created_at', '2026-05-09T00:00:00Z')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching orders:', error);
    return;
  }

  console.log(`Found ${orders.length} orders from today.`);
  
  for (const o of orders) {
    const isTest = o.data?.isTestOrder || JSON.stringify(o.data).includes('test') || o.data?.customerName?.toLowerCase().includes('test');
    console.log(`Order ID: ${o.id.slice(-6)} | Status: ${o.status} | Total: ${o.data?.total || 0} ${o.data?.currency || 'YER'} | isTestFlag/Keyword: ${isTest ? 'YES' : 'NO'} | created: ${o.created_at}`);
  }
}

identifyTestOrders();
