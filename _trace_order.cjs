const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.production', 'utf-8');
const VITE_SUPABASE_URL = envContent.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const VITE_SUPABASE_SERVICE_ROLE_KEY = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1].trim() || envContent.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: orders, error } = await supabase.from('orders')
    .select('id, status, created_at, notes, branch_id')
    .gte('created_at', '2026-05-11T00:00:00Z');
    
  if (error) {
    console.error("Error fetching order:", error);
    return;
  }

  console.log("Orders from today:");
  console.log(orders);
  
  if (orders.length > 0) {
    for (const order of orders) {
      const { data: orderItems } = await supabase.from('order_items').select('*').eq('order_id', order.id);
      console.log(`Order ${order.id} items:`);
      console.log(orderItems);
    }
  }
}

run();
