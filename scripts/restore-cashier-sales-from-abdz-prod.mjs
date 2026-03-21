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

const uniq = (arr) => [...new Set(arr.filter((x) => x !== null && x !== undefined && x !== ''))];
const asText = (v) => (v === null || v === undefined ? '' : String(v));

const readBackup = async (filePath) => {
  const abs = path.resolve(filePath);
  const buf = fs.readFileSync(abs);
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file('database.json');
  if (!file) throw new Error('database.json not found in backup');
  const raw = await file.async('string');
  const parsed = JSON.parse(raw);
  const data = parsed?.data || {};
  return data;
};

const asArray = (x) => (Array.isArray(x) ? x : []);

const byIdSet = (rows, key, set) => rows.filter((r) => set.has(asText(r?.[key])));

const getTableMeta = async (table) => {
  const r = await client.query(
    `
    select column_name, data_type, udt_name
    from information_schema.columns
    where table_schema='public' and table_name=$1
    order by ordinal_position
    `,
    [table],
  );
  return r.rows;
};

const convertVal = (v, colType) => {
  if (v === undefined) return null;
  if (v === null) return null;
  if (colType === 'json' || colType === 'jsonb') return typeof v === 'string' ? v : JSON.stringify(v);
  if (colType === 'ARRAY') return Array.isArray(v) ? v : null;
  return v;
};

const insertRows = async (table, rows) => {
  if (!rows.length) return 0;
  const meta = await getTableMeta(table);
  if (!meta.length) return 0;
  const cols = meta.map((m) => m.column_name);
  const types = Object.fromEntries(meta.map((m) => [m.column_name, m.udt_name === '_text' || m.udt_name?.startsWith('_') ? 'ARRAY' : m.data_type]));
  let inserted = 0;
  for (const row of rows) {
    const rowCols = cols.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
    if (!rowCols.length) continue;
    const params = [];
    const valsSql = rowCols.map((c, i) => {
      params.push(convertVal(row[c], types[c]));
      return `$${i + 1}`;
    });
    const sql = `insert into public.${table} (${rowCols.map((c) => `"${c}"`).join(',')}) values (${valsSql.join(',')}) on conflict do nothing`;
    const res = await client.query(sql, params);
    inserted += res.rowCount || 0;
  }
  return inserted;
};

const main = async () => {
  const data = await readBackup(backupPath);
  const T = {
    admin_users: asArray(data.admin_users),
    cash_shifts: asArray(data.cash_shifts),
    orders: asArray(data.orders),
    payments: asArray(data.payments),
    inventory_movements: asArray(data.inventory_movements),
    order_events: asArray(data.order_events),
    order_item_cogs: asArray(data.order_item_cogs),
    order_item_reservations: asArray(data.order_item_reservations),
    sales_returns: asArray(data.sales_returns),
    journal_entries: asArray(data.journal_entries),
    journal_lines: asArray(data.journal_lines),
    ar_open_items: asArray(data.ar_open_items),
    party_open_items: asArray(data.party_open_items),
    party_ledger_entries: asArray(data.party_ledger_entries),
    ar_allocations: asArray(data.ar_allocations),
    ar_payment_status: asArray(data.ar_payment_status),
    bank_reconciliation_matches: asArray(data.bank_reconciliation_matches),
    settlement_lines: asArray(data.settlement_lines),
    settlement_headers: asArray(data.settlement_headers),
    accounting_documents: asArray(data.accounting_documents),
  };

  await client.connect();
  try {
    const who = await client.query(
      `
      select au.auth_user_id, au.username, au.full_name, au.email, au.role
      from public.admin_users au
      where au.is_active=true and lower(coalesce(au.username,''))=$1
      order by au.created_at desc
      limit 1
      `,
      [cashierUsername],
    );
    const user = who.rows[0];
    if (!user) throw new Error(`cashier/admin user not found: ${cashierUsername}`);

    const shift = await client.query(
      `
      select id, cashier_id, status, opened_at
      from public.cash_shifts
      where cashier_id=$1 and status='open'
      order by opened_at desc
      limit 1
      `,
      [user.auth_user_id],
    );
    const openShift = shift.rows[0];
    if (!openShift) throw new Error(`open shift not found for ${cashierUsername}`);
    const openShiftId = asText(openShift.id);

    const inPayments = T.payments.filter(
      (p) => asText(p.shift_id) === openShiftId && asText(p.reference_table) === 'orders' && asText(p.direction) === 'in',
    );
    const targetOrderIds = uniq(
      inPayments.map((p) => asText(p.reference_id)).filter((id) => {
        const o = T.orders.find((x) => asText(x.id) === asText(id));
        return o && asText(o?.data?.orderSource || o?.data?.order_source) === 'in_store';
      }),
    );
    const orderIdSet = new Set(targetOrderIds);

    const salesReturns = T.sales_returns.filter((sr) => orderIdSet.has(asText(sr.order_id)));
    const salesReturnIds = uniq(salesReturns.map((sr) => asText(sr.id)));
    const salesReturnSet = new Set(salesReturnIds);

    const targetPayments = T.payments.filter((p) => {
      const rt = asText(p.reference_table);
      const rid = asText(p.reference_id);
      return (rt === 'orders' || rt === 'order_voids') && orderIdSet.has(rid) || (rt === 'sales_returns' && salesReturnSet.has(rid));
    });
    const paymentIds = uniq(targetPayments.map((p) => asText(p.id)));
    const paymentSet = new Set(paymentIds);

    const targetMovements = T.inventory_movements.filter((im) => {
      const rt = asText(im.reference_table);
      const rid = asText(im.reference_id);
      return (rt === 'orders' || rt === 'order_voids') && orderIdSet.has(rid) || (rt === 'sales_returns' && salesReturnSet.has(rid));
    });
    const movementIds = uniq(targetMovements.map((im) => asText(im.id)));
    const movementSet = new Set(movementIds);

    const targetJEs = T.journal_entries.filter((je) => {
      const st = asText(je.source_table);
      const sid = asText(je.source_id);
      return (st === 'orders' && orderIdSet.has(sid)) ||
        (st === 'payments' && paymentSet.has(sid)) ||
        (st === 'inventory_movements' && movementSet.has(sid)) ||
        (st === 'sales_returns' && salesReturnSet.has(sid));
    });
    const jeIds = uniq(targetJEs.map((je) => asText(je.id)));
    const jeSet = new Set(jeIds);

    const targetJLs = T.journal_lines.filter((jl) => jeSet.has(asText(jl.journal_entry_id)));
    const jlIds = uniq(targetJLs.map((jl) => asText(jl.id)));
    const jlSet = new Set(jlIds);

    const targetOrders = T.orders.filter((o) => orderIdSet.has(asText(o.id)));
    const targetEvents = T.order_events.filter((e) => orderIdSet.has(asText(e.order_id)));
    const targetOIC = T.order_item_cogs.filter((x) => orderIdSet.has(asText(x.order_id)));
    const targetReservations = T.order_item_reservations.filter((x) => orderIdSet.has(asText(x.order_id)));
    const targetAROpen = T.ar_open_items.filter(
      (x) => orderIdSet.has(asText(x.order_id)) || orderIdSet.has(asText(x.invoice_id)) || jeSet.has(asText(x.journal_entry_id)),
    );
    const targetPOI = T.party_open_items.filter((x) => jlSet.has(asText(x.journal_line_id)));
    const poiIds = new Set(uniq(targetPOI.map((x) => asText(x.id))));
    const targetPLE = T.party_ledger_entries.filter((x) => jlSet.has(asText(x.journal_line_id)));
    const targetAlloc = T.ar_allocations.filter((x) => paymentSet.has(asText(x.payment_id)));
    const targetPayStatus = T.ar_payment_status.filter((x) => paymentSet.has(asText(x.payment_id)));
    const targetBR = T.bank_reconciliation_matches.filter((x) => paymentSet.has(asText(x.payment_id)));
    const targetSettleLines = T.settlement_lines.filter(
      (x) => poiIds.has(asText(x.from_open_item_id)) || poiIds.has(asText(x.to_open_item_id)),
    );
    const settleHeaderIds = new Set(uniq(targetSettleLines.map((x) => asText(x.settlement_id))));
    const targetSettleHeaders = T.settlement_headers.filter((x) => settleHeaderIds.has(asText(x.id)));
    const docIds = new Set(uniq(targetJEs.map((x) => asText(x.document_id))));
    const targetDocs = T.accounting_documents.filter((x) => docIds.has(asText(x.id)));

    const summary = {
      user: { id: asText(user.auth_user_id), username: user.username, role: user.role, email: user.email },
      openShift: { id: openShiftId, openedAt: openShift.opened_at },
      restoreCounts: {
        orders: targetOrders.length,
        payments: targetPayments.length,
        inventory_movements: targetMovements.length,
        journal_entries: targetJEs.length,
        journal_lines: targetJLs.length,
      },
      execute,
    };
    console.log(JSON.stringify({ phase: 'plan', ...summary }, null, 2));

    if (!execute) return;

    await client.query('begin');
    await client.query(`select set_config('app.allow_ledger_ddl', '1', true)`);

    const triggerTables = [
      'orders',
      'payments',
      'inventory_movements',
      'journal_entries',
      'journal_lines',
      'party_ledger_entries',
      'party_open_items',
      'ar_open_items',
      'ar_allocations',
      'ar_payment_status',
      'bank_reconciliation_matches',
      'accounting_documents',
      'settlement_headers',
      'settlement_lines',
      'sales_returns',
      'order_events',
      'order_item_cogs',
      'order_item_reservations',
    ];
    for (const t of triggerTables) {
      try {
        await client.query(`alter table public.${t} disable trigger user`);
      } catch {}
    }

    const inserted = {};
    inserted.orders = await insertRows('orders', targetOrders);
    inserted.sales_returns = await insertRows('sales_returns', salesReturns);
    inserted.order_events = await insertRows('order_events', targetEvents);
    inserted.order_item_reservations = await insertRows('order_item_reservations', targetReservations);
    inserted.order_item_cogs = await insertRows('order_item_cogs', targetOIC);
    inserted.inventory_movements = await insertRows('inventory_movements', targetMovements);
    inserted.payments = await insertRows('payments', targetPayments);
    inserted.accounting_documents = await insertRows('accounting_documents', targetDocs);
    inserted.journal_entries = await insertRows('journal_entries', targetJEs);
    inserted.journal_lines = await insertRows('journal_lines', targetJLs);
    inserted.ar_open_items = await insertRows('ar_open_items', targetAROpen);
    inserted.party_open_items = await insertRows('party_open_items', targetPOI);
    inserted.party_ledger_entries = await insertRows('party_ledger_entries', targetPLE);
    inserted.ar_allocations = await insertRows('ar_allocations', targetAlloc);
    inserted.ar_payment_status = await insertRows('ar_payment_status', targetPayStatus);
    inserted.bank_reconciliation_matches = await insertRows('bank_reconciliation_matches', targetBR);
    inserted.settlement_headers = await insertRows('settlement_headers', targetSettleHeaders);
    inserted.settlement_lines = await insertRows('settlement_lines', targetSettleLines);

    for (const t of triggerTables) {
      try {
        await client.query(`alter table public.${t} enable trigger user`);
      } catch {}
    }
    await client.query('commit');

    const verify = await client.query(
      `
      with target_orders as (
        select distinct o.id
        from public.orders o
        join public.payments p
          on p.reference_table='orders'
         and p.reference_id=o.id::text
         and p.direction='in'
         and p.shift_id=$1
        where coalesce(o.data->>'orderSource','')='in_store'
      )
      select jsonb_build_object(
        'orders', (select count(*) from target_orders),
        'payments', (select count(*) from public.payments p join target_orders t on p.reference_table='orders' and p.reference_id=t.id::text),
        'inventoryMovements', (select count(*) from public.inventory_movements im join target_orders t on im.reference_table='orders' and im.reference_id=t.id::text),
        'journalOrders', (select count(*) from public.journal_entries je join target_orders t on je.source_table='orders' and je.source_id=t.id::text)
      ) as payload
      `,
      [openShiftId],
    );

    console.log(JSON.stringify({ phase: 'restored', inserted, verify: verify.rows[0]?.payload || {} }, null, 2));
  } finally {
    await client.end();
  }
};

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
});
