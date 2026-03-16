import { Client } from 'pg';

const password = String(process.env.DBPW || '').trim();
if (!password) throw new Error('Missing DBPW');
const itemId = 'efa91e13-9cb2-4fb1-b3f0-4f711c22e59a';

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.pmhivhtaoydfolseelyc',
  password,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const q = await client.query(`
    with lines as (
      select
        o.id as order_id,
        o.status,
        o.created_at,
        it as item
      from public.orders o
      cross join lateral jsonb_array_elements(coalesce(o.data->'items','[]'::jsonb)) it
      where o.status='delivered'
        and nullif(trim(coalesce(o.data->>'voidedAt','')), '') is null
    )
    select
      coalesce(sum(coalesce((item->>'quantity')::numeric,0)),0)::numeric as delivered_order_qty,
      count(*)::int as lines_count
    from lines
    where coalesce(item->>'id','')=$1
  `,[itemId]);
  console.log(JSON.stringify(q.rows, null, 2));
} finally {
  await client.end();
}
