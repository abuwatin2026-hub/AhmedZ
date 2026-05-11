const { Client } = require('pg');
const connectionString = 'postgresql://postgres.pmhivhtaoydfolseelyc:AhmadZangah1%23123455@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

async function list() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const res = await client.query(`
      select id, data->>'customerName' as name 
      from public.orders 
      where created_at >= '2026-05-09T00:00:00Z'
    `);
    console.log(res.rows);
  } finally {
    await client.end();
  }
}
list();
