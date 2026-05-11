const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.production', 'utf-8');
const VITE_SUPABASE_URL = envContent.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const VITE_SUPABASE_ANON_KEY = envContent.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data: menu_items, error } = await supabase.from('menu_items')
    .select('id, name, created_at')
    .order('created_at', { ascending: false });

  if (error) return console.error(error);

  const testItems = menu_items.filter(i => {
    const nameEn = i.name?.en || '';
    const nameAr = i.name?.ar || '';
    return nameEn.toLowerCase().includes('uat') || nameAr.toLowerCase().includes('uat');
  });

  const itemIds = testItems.map(i => i.id);

  console.log(`Found ${itemIds.length} UAT items`);

  // check order_items
  const { data: orderItems } = await supabase.from('order_items').select('order_id').in('item_id', itemIds);
  const orderIdsFromItems = [...new Set(orderItems?.map(oi => oi.order_id) || [])];
  
  console.log(`Found ${orderIdsFromItems.length} orders referencing these UAT items`);

  // Check for ANY orders with "UAT" or created on May 9th that look like tests
  const { data: orders } = await supabase.from('orders')
    .select('id, created_at')
    .gte('created_at', '2026-05-09T00:00:00Z')
    .lte('created_at', '2026-05-09T23:59:59Z');

  const orderIds = [...new Set([...orderIdsFromItems, ...(orders?.map(o => o.id) || [])])];
  console.log(`Total test orders from May 9th or linked to UAT items: ${orderIds.length}`);

  // We should print the item_ids and order_ids to use them in a purge script
  fs.writeFileSync('uat_items_to_purge.json', JSON.stringify({ itemIds, orderIds }, null, 2));
}

run();
