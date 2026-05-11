const { Client } = require('pg');
const fs = require('fs');

const connectionString = 'postgresql://postgres.pmhivhtaoydfolseelyc:AhmadZangah1%23123455@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

async function runPurge() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected to Postgres.');

    const sqlFile = fs.readFileSync('supabase/migrations/20260509204000_admin_purge_uat_tests.sql', 'utf8');
    
    console.log('Deploying SQL...');
    await client.query(sqlFile);
    console.log('Deployed.');

    console.log('Executing purge function...');
    const res = await client.query('select public.admin_purge_uat_tests_20260509()');
    console.log('Purge successful:', JSON.stringify(res.rows, null, 2));

  } catch (err) {
    console.error('Error during purge:', err);
  } finally {
    await client.end();
    console.log('Disconnected.');
  }
}

runPurge();
