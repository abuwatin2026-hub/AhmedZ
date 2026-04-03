const { Client } = require('pg');
const fs = require('fs');

const connectionString = 'postgresql://postgres.pmhivhtaoydfolseelyc:AhmadZangah1%23123455@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

async function run() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected via pg!');
    
    const sql = fs.readFileSync('apply_multi_wh.sql', 'utf8');
    await client.query(sql);
    console.log('SQL Migration Applied Successfully!');
    
  } catch(e) {
    console.error('Migration failed:', e.message);
  } finally {
    await client.end();
  }
}

run();
