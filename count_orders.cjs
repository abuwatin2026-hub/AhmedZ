const { Client } = require('pg');
const connectionString = 'postgresql://postgres.pmhivhtaoydfolseelyc:AhmadZangah1%23123455@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

async function count() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const res = await client.query(`
      select count(*) as count from public.orders
    `);
    console.log(res.rows[0]);
  } finally {
    await client.end();
  }
}
count();
