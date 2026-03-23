const { Client } = require('pg');
const fs = require('fs');

async function main() {
  const client = new Client({
    host: 'aws-1-ap-south-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.pmhivhtaoydfolseelyc',
    password: process.env.DBPW,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const r = await client.query(`
    select id::text as id, name::text as name_text, data::text as data_text, created_at, updated_at
    from public.menu_items
    where name::text ilike '%ميرا%'
       or data::text ilike '%ميرا%'
    order by updated_at desc nulls last, created_at desc nulls last
    limit 100
  `);
  fs.writeFileSync('tmp_list_mira_items_result.json', JSON.stringify(r.rows, null, 2), 'utf8');
  console.log('MIRA_LIST_OK');
  await client.end();
}

main().catch((e) => {
  console.error(e?.message || String(e));
  process.exit(1);
});
