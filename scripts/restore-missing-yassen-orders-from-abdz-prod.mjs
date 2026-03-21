import fs from 'node:fs';
import JSZip from 'jszip';
import { Client } from 'pg';

const backup = process.argv[2];
if (!backup) throw new Error('Usage: node scripts/restore-missing-yassen-orders-from-abdz-prod.mjs <abdz>');
const password = String(process.env.DBPW || process.env.SUPABASE_DB_PASSWORD || '').trim();
if (!password) throw new Error('Missing DBPW or SUPABASE_DB_PASSWORD');

const zip = await JSZip.loadAsync(fs.readFileSync(backup));
const parsed = JSON.parse(await zip.file('database.json').async('string'));
const data = parsed?.data || {};
const orders = Array.isArray(data.orders) ? data.orders : [];
const payments = Array.isArray(data.payments) ? data.payments : [];

const asText = (v) => (v === null || v === undefined ? '' : String(v));
const uniq = (arr) => [...new Set(arr.filter(Boolean))];

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
  const u = await client.query(`select auth_user_id from public.admin_users where lower(username)='yassen' and is_active=true limit 1`);
  const s = await client.query(`select id from public.cash_shifts where cashier_id=$1 and status='open' order by opened_at desc limit 1`, [u.rows[0].auth_user_id]);
  const shiftId = asText(s.rows[0].id);

  const targetOrderIds = uniq(
    payments
      .filter((p) => asText(p.shift_id) === shiftId && asText(p.reference_table) === 'orders' && asText(p.direction) === 'in')
      .map((p) => asText(p.reference_id))
      .filter((id) => {
        const o = orders.find((x) => asText(x.id) === id);
        return o && asText(o?.data?.orderSource || '') === 'in_store';
      }),
  );

  const existsRes = await client.query(`select id::text as id from public.orders where id = any($1::uuid[])`, [targetOrderIds]);
  const exists = new Set(existsRes.rows.map((r) => asText(r.id)));
  const missing = targetOrderIds.filter((id) => !exists.has(id));
  const rows = missing.map((id) => orders.find((o) => asText(o.id) === id)).filter(Boolean);

  console.log(JSON.stringify({ target: targetOrderIds.length, existing: exists.size, missing: missing.length }, null, 2));
  if (!rows.length) process.exit(0);

  await client.query(`set session_replication_role = replica`);
  let inserted = 0;
  const errors = [];
  for (const row of rows) {
    try {
      const cols = Object.keys(row);
      const vals = cols.map((c) => {
        const v = row[c];
        if (v === undefined || v === null) return null;
        return typeof v === 'object' ? JSON.stringify(v) : v;
      });
      const sql = `insert into public.orders (${cols.map((c) => `"${c}"`).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) on conflict do nothing`;
      const r = await client.query(sql, vals);
      inserted += r.rowCount || 0;
    } catch (e) {
      if (errors.length < 10) errors.push({ id: row?.id, error: String(e?.message || e) });
    }
  }
  await client.query(`set session_replication_role = origin`);

  const finalRes = await client.query(`select count(*)::int as c from public.orders where id = any($1::uuid[])`, [targetOrderIds]);
  console.log(JSON.stringify({ inserted, finalExisting: finalRes.rows[0]?.c || 0, errors }, null, 2));
} finally {
  await client.end();
}
