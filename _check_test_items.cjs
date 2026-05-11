const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.production', 'utf-8');
const VITE_SUPABASE_URL = envContent.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const VITE_SUPABASE_ANON_KEY = envContent.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabase.from('menu_items')
    .select('id, name, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Error fetching items:", error);
    return;
  }

  console.log(`Total items in DB: ${data.length}`);
  // Let's just dump ALL items to a file so we can inspect them
  fs.writeFileSync('all_menu_items_dump.json', JSON.stringify(data, null, 2));
  console.log("Dumped all items to all_menu_items_dump.json");
  
  // Also print the 30 most recently created items to the console
  console.log("30 most recently created items:");
  data.slice(0, 30).forEach(i => {
    console.log(`[${i.created_at}] ID: ${i.id} | EN: ${i.name?.en} | AR: ${i.name?.ar}`);
  });
}

run();
