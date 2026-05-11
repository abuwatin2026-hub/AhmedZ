import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://pmhivhtaoydfolseelyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec'
);

async function run() {
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: 'owner@azta.com', password: 'AhmedZ#123456'
  });

  const { data: recent } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);
    
  for (const o of recent || []) {
    console.log(`\nOrder: ${o.id} - Status: ${o.status}`);
    
    // Check payments
    const { data: payments } = await supabase
      .from('payments')
      .select('id, amount, method, created_at')
      .eq('reference_table', 'orders')
      .eq('reference_id', o.id);
    
    console.log(`Payments: ${payments?.length || 0}`);
    
    // Check inventory_movements via reference_id
    const { data: ims } = await supabase
      .from('inventory_movements')
      .select('id, movement_type, quantity, item_id')
      .eq('reference_id', o.id);
      
    console.log(`Inventory Movements: ${ims?.length || 0}`);
  }
}
run();
