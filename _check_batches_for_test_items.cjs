const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.production', 'utf-8');
const VITE_SUPABASE_URL = envContent.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const VITE_SUPABASE_ANON_KEY = envContent.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY);

async function run() {
  const itemIds = [
    'baa36164-0b1d-4991-8ac6-c7870ab0db1e',
    '4992e25a-d858-46ee-a7da-101c3e9b0c83',
    'c3de5ec5-178e-4e50-9538-50e5a819f2cc',
    'd52e0ca0-c309-4a4c-853a-0015b3018e30',
    '579d786a-48df-46e2-a911-003300c91000',
    '9ebd72e5-54c2-4a0d-a6de-89e02eefdfd6',
    'de759985-cd23-4217-9f04-12aaac226414',
    '0b0ac6de-8728-4ee3-bac6-401468d28b56',
    '4489d164-f733-4b92-8e81-bfa0f876e347',
    '3c314e25-fdd7-4b1f-aa30-c33e0e822d62',
    'b164abbe-fe51-40ef-a3cf-4c59ef2e33ed',
    'aa945140-15b1-47ea-87fc-9d7bf88cf6b0',
    'bb0b2020-1989-47d4-a14e-2f0a419d2167',
    'e8d78af7-86b4-4e9a-be6b-0a28073b55f2',
    '8a453702-d2eb-4854-a81f-c346d99e4e4f',
    '5e93704f-2fb5-4488-a9d6-3c1caefa0f45',
    '94ec4f68-398b-4600-bd57-67f06eb7d7bc',
    '105a8c81-3e65-4e09-95d8-ee888a33737d',
    'ff436679-aac9-41ae-92c5-db7ecf8547fd',
    '6c7e75c3-a86a-4e1c-8c4d-7e549fead676',
    'b804172d-68a2-435d-87ac-b1b85d70f0e8',
    '1cf3cb91-2056-4160-b5d3-8002df6392a1'
  ];

  // check inventory_movements
  const { data: movs } = await supabase.from('inventory_movements').select('id, batch_id').in('item_id', itemIds);
  console.log(`Found ${movs?.length || 0} inventory movements for these items`);

  // check batches
  const { data: batches } = await supabase.from('batches').select('id').in('item_id', itemIds);
  console.log(`Found ${batches?.length || 0} batches for these items`);
}

run();
