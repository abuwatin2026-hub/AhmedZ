const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:AhmadZangah1%23123455@db.pmhivhtaoydfolseelyc.supabase.co:5432/postgres",
  });
  
  await client.connect();
  
  const res = await client.query(`
    SELECT id, status, notes, created_at, trace_id
    FROM public.orders 
    ORDER BY created_at DESC 
    LIMIT 3
  `);
  
  console.log("Recent Orders:");
  console.log(res.rows);
  
  if (res.rows.length > 0) {
    const orderId = res.rows[0].id;
    const itemsRes = await client.query(`SELECT * FROM public.order_items WHERE order_id = $1`, [orderId]);
    console.log(`Order Items for ${orderId}:`);
    console.log(itemsRes.rows);
  }
  
  await client.end();
}

run().catch(console.error);
