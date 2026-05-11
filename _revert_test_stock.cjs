const { Client } = require('pg');
const connectionString = 'postgresql://postgres.pmhivhtaoydfolseelyc:AhmadZangah1%23123455@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';
const client = new Client({ connectionString });

async function run() {
  await client.connect();
  console.log('Connected to Prod DB for Reverting specific test stock...');
  
  try {
    const res = await client.query("UPDATE batches SET quantity_consumed = greatest(0, quantity_consumed - 1) WHERE id::text LIKE '390685d2%' OR id::text LIKE 'a9f8ec54%' RETURNING id, quantity_consumed");
    
    // Trigger recalculation of stock_management by updating stock_management available_quantity directly
    const res2 = await client.query("UPDATE stock_management SET available_quantity = available_quantity + 1 WHERE item_id::text LIKE '1cf3cb91%' AND warehouse_id::text LIKE '7628598d%' RETURNING available_quantity");
    const res3 = await client.query("UPDATE stock_management SET available_quantity = available_quantity + 1 WHERE item_id::text LIKE '81e85ebf%' AND warehouse_id::text LIKE '1637d5cc%' RETURNING available_quantity");
    
    console.log('✅ Reverted test stock natively.');
  } catch(e) {
    console.error('Failed', e.message);
  }
  
  await client.end();
}

run();
