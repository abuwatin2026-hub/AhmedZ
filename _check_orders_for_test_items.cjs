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
    return nameEn.toLowerCase().includes('test') || 
           nameEn.toLowerCase().includes('smoke') || 
           nameAr.includes('تجريب') ||
           nameAr.includes('دخان') ||
           nameAr.includes('جديد');
  });

  const itemIds = testItems.map(i => i.id);

  console.log(`Found ${itemIds.length} test items`);
  console.log(itemIds.map(id => `'${id}'::uuid,`).join('\n'));

  // check order_items
  const { data: orderItems } = await supabase.from('order_items').select('order_id').in('item_id', itemIds);
  const orderIds = [...new Set(orderItems?.map(oi => oi.order_id) || [])];
  
  console.log(`Found ${orderIds.length} orders referencing these items`);
  if (orderIds.length > 0) {
    console.log("Order IDs:");
    console.log(orderIds.map(id => `'${id}'::uuid,`).join('\n'));
  }
}

run();
