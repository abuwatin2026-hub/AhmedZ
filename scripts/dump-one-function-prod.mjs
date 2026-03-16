import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const name = String(process.env.FN_NAME || 'get_product_sales_report_v10').trim();
const password = String(process.env.DBPW || process.env.SUPABASE_DB_PASSWORD || '').trim();
if (!password) throw new Error('Missing DBPW or SUPABASE_DB_PASSWORD');

const client = new Client({
  host: process.env.DB_HOST || 'aws-1-ap-south-1.pooler.supabase.com',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres.pmhivhtaoydfolseelyc',
  password,
  database: process.env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const q = await client.query(
    `select p.oid::regprocedure::text as signature, pg_get_functiondef(p.oid) as def
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname=$1
     order by 1`,
    [name]
  );
  fs.mkdirSync(path.join(process.cwd(), 'backups'), { recursive: true });
  const outPath = path.join(process.cwd(), 'backups', `prod_${name}_defs.json`);
  fs.writeFileSync(outPath, JSON.stringify(q.rows, null, 2), 'utf8');
  console.log(outPath);
} finally {
  await client.end();
}
