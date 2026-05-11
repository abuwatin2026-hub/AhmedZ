const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.pmhivhtaoydfolseelyc:AhmadZangah1%23123455@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
  });
  
  try {
    await client.connect();
    const res = await client.query(`
      SELECT pid, state, wait_event_type, wait_event, query 
      FROM pg_stat_activity 
      WHERE state = 'active'
    `);
    console.log("Active queries:");
    console.log(res.rows);
  } catch (err) {
    console.error("DB connection error:", err.message);
  } finally {
    await client.end();
  }
}

run();
