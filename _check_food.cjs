const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.production', 'utf-8');
const VITE_SUPABASE_URL = envContent.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const VITE_SUPABASE_ANON_KEY = envContent.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabase.from('menu_items')
    .select('*')
    .eq('id', '336131f7-738e-4dcb-a65b-55f0b122fe1a');
    
  if (error) console.error(error);
  else console.log(data);
}

run();
