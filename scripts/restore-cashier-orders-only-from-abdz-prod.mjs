import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { Client } from 'pg';

const args = process.argv.slice(2);
const val = (flag, fallback = '') => {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return typeof v === 'string' ? v : fallback;
};
const has = (flag) => args.includes(flag);

const backupPath = String(val('--backup', '')).trim();
const cashierUsername = String(val('--cashier', 'yassen')).trim().toLowerCase();
const limit = Math.max(0, Number(val('--limit', '0')) || 0);
const offset = Math.max(0, Number(val('--offset', '0')) || 0);
const execute = has('--execute');
if (!backupPath) throw new Error('Missing --backup path');

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

const asArray = (x) => (Array.isArray(x) ? x : []);
const asText = (v) => (v === null || v === undefined ? '' : String(v));
const uniq = (arr) => [...new Set(arr.filter(Boolean))];

const readBackupData = async (filePath) => {
  const abs = path.resolve(filePath);
  const zip = await JSZip.loadAsync(fs.readFileSync(abs));
  const file = zip.file('database.json');
  if (!file) throw new Error('database.json not found in backup');
  const parsed = JSON.parse(await file.async('string'));
  return parsed?.data || {};
};

const insertRows = async (table, rows) => {
  if (!rows.length) return 0;
  const colsRes = await client.query(
    `select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`,
    [table],
  );
  const cols = colsRes.rows.map((r) => r.column_name);
  const types = Object.fromEntries(colsRes.rows.map((r) => [r.column_name, r.data_type]));
  let n = 0;
  for (const row of rows) {
    const rc = cols.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
    if (!rc.length) continue;
    const vals = rc.map((c) => {
      const v = row[c];
      if (v === undefined || v === null) return null;
      if (types[c] === 'json' || types[c] === 'jsonb') return typeof v === 'string' ? v : JSON.stringify(v);
      return v;
    });
    const ph = rc.map((_, i) => `$${i + 1}`).join(',');
    const sql = `insert into public.${table} (${rc.map((c) => `"${c}"`).join(',')}) values (${ph}) on conflict do nothing`;
    const res = await client.query(sql, vals);
    n += res.rowCount || 0;
  }
  return n;
};

const main = async () => {
  const data = await readBackupData(backupPath);
  const orders = asArray(data.orders);
  const payments = asArray(data.payments);
  const orderEvents = asArray(data.order_events);

  await client.connect();
  try {
    const u = await client.query(
      `select auth_user_id, username from public.admin_users where is_active=true and lower(coalesce(username,''))=$1 limit 1`,
      [cashierUsername],
    );
    if (!u.rows[0]) throw new Error(`cashier not found: ${cashierUsername}`);
    const cashierId = asText(u.rows[0].auth_user_id);

    const s = await client.query(
      `select id from public.cash_shifts where cashier_id=$1 and status='open' order by opened_at desc limit 1`,
      [cashierId],
    );
    if (!s.rows[0]) throw new Error(`open shift not found for ${cashierUsername}`);
    const shiftId = asText(s.rows[0].id);

    const targetOrderIds = uniq(
      payments
        .filter((p) => asText(p.shift_id) === shiftId && asText(p.reference_table) === 'orders' && asText(p.direction) === 'in')
        .map((p) => asText(p.reference_id))
        .filter((oid) => {
          const o = orders.find((x) => asText(x.id) === oid);
          return o && asText(o?.data?.orderSource || o?.data?.order_source) === 'in_store';
        }),
    );
    const set = new Set(targetOrderIds);
    const targetOrdersAll = orders.filter((o) => set.has(asText(o.id)));
    const sliced = targetOrdersAll.slice(offset);
    const targetOrders = limit > 0 ? sliced.slice(0, limit) : sliced;
    const targetSet = new Set(targetOrders.map((o) => asText(o.id)));
    const targetEvents = orderEvents.filter((e) => targetSet.has(asText(e.order_id)));

    console.log(JSON.stringify({
      phase: 'plan',
      cashier: cashierUsername,
      shiftId,
      backupOrders: targetOrders.length,
      backupEvents: targetEvents.length,
      offset,
      limit,
      execute,
    }, null, 2));

    if (!execute) return;

    await client.query(`set statement_timeout = 0`);
    await client.query(`set lock_timeout = 0`);
    await client.query(`set session_replication_role = replica`);

    let insertedOrders = 0;
    let insertedEvents = 0;
    let failedOrders = 0;
    let failedEvents = 0;
    const orderErrors = [];
    const eventErrors = [];

    for (const row of targetOrders) {
      try {
        insertedOrders += await insertRows('orders', [row]);
      } catch (e) {
        failedOrders += 1;
        if (orderErrors.length < 5) orderErrors.push({ id: row?.id, error: String(e?.message || e) });
      }
    }

    for (const row of targetEvents) {
      try {
        insertedEvents += await insertRows('order_events', [row]);
      } catch (e) {
        failedEvents += 1;
        if (eventErrors.length < 5) eventErrors.push({ id: row?.id, error: String(e?.message || e) });
      }
    }

    await client.query(`set session_replication_role = origin`);

    const verify = await client.query(
      `select count(*)::int as c from public.orders where id = any($1::uuid[])`,
      [targetOrderIds],
    );
    console.log(JSON.stringify({
      phase: 'restored_orders_only',
      insertedOrders,
      insertedEvents,
      failedOrders,
      failedEvents,
      orderErrors,
      eventErrors,
      verifiedOrdersInDb: verify.rows[0]?.c || 0,
    }, null, 2));
  } catch (e) {
    try { await client.query('rollback'); } catch {}
    throw e;
  } finally {
    await client.end();
  }
};

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
});
