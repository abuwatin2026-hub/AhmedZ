const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.production', 'utf-8');
const VITE_SUPABASE_URL = envContent.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const VITE_SUPABASE_ANON_KEY = envContent.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data: items, error } = await supabase.from('menu_items')
    .select('id, name')
    .ilike('name->>ar', '%تمر برني فاخر%');
    
  if (error) {
    console.error("Error fetching items:", error);
    return;
  }

  console.log("Items:");
  console.log(items);
  
  if (items.length > 0) {
    const itemId = items[0].id;
    const { data: batches } = await supabase.from('batches').select('*').eq('item_id', itemId);
    console.log(`Batches for ${itemId}:`);
    console.log(batches);
    
    const { data: uoms } = await supabase.from('item_uom_units').select('*').eq('item_id', itemId);
    console.log(`UOMs for ${itemId}:`);
    console.log(uoms);
  }
}

run();
