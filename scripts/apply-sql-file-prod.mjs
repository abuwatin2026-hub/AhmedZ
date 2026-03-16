import fs from 'node:fs';
import { Client } from 'pg';

const sqlFile = process.argv[2];
if (!sqlFile) {
  throw new Error('Usage: node scripts/apply-sql-file-prod.mjs <sql-file-path>');
}

const password = String(process.env.DBPW || process.env.SUPABASE_DB_PASSWORD || '').trim();
if (!password) {
  throw new Error('Missing DBPW or SUPABASE_DB_PASSWORD');
}

const sql = fs.readFileSync(sqlFile, 'utf8');
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
  await client.query(sql);
  console.log(JSON.stringify({ applied: true, sqlFile }, null, 2));
} finally {
  await client.end();
}
