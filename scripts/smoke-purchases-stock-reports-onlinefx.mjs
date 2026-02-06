import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const tryLoadEnvFile = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const k = trimmed.slice(0, eq).trim();
      let v = trimmed.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k && process.env[k] == null) process.env[k] = v;
    }
  } catch {
  }
};

if (!process.env.AZTA_SUPABASE_URL && !process.env.VITE_SUPABASE_URL) {
  tryLoadEnvFile(path.join(process.cwd(), '.env.local'));
  tryLoadEnvFile(path.join(process.cwd(), '.env.development.local'));
  tryLoadEnvFile(path.join(process.cwd(), '.env.production'));
}

const SUPABASE_URL = (process.env.AZTA_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.AZTA_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const OWNER_EMAIL = (process.env.AZTA_SMOKE_OWNER_EMAIL || 'owner@azta.com').trim();
const OWNER_PASSWORD = (process.env.AZTA_SMOKE_OWNER_PASSWORD || 'Owner@123').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing AZTA_SUPABASE_URL/AZTA_SUPABASE_ANON_KEY or VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ok = (msg) => console.log(`✅ ${msg}`);
const info = (msg) => console.log(`ℹ️ ${msg}`);
const warn = (msg) => console.log(`⚠️ ${msg}`);
const fail = (msg) => console.error(`❌ ${msg}`);

const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '').trim());

const missingColumn = (err) => {
  const msg = String(err?.message || '');
  const code = String(err?.code || '');
  return code === '42703' || /column .* does not exist/i.test(msg);
};

const insertWithFallback = async ({ table, rows, primarySelect = 'id', fallbacks = [] }) => {
  let lastErr = null;
  for (const keysToDrop of [null, ...fallbacks]) {
    const payload = (rows || []).map((r) => {
      if (!keysToDrop) return r;
      const next = { ...r };
      for (const k of keysToDrop) delete next[k];
      return next;
    });
    const { data, error } = await supabase.from(table).insert(payload).select(primarySelect);
    if (!error) return { data };
    lastErr = error;
    if (!missingColumn(error)) throw error;
  }
  throw lastErr || new Error('insert failed');
};

const upsertWithFallback = async ({ table, rows, onConflict, fallbacks = [] }) => {
  let lastErr = null;
  for (const keysToDrop of [null, ...fallbacks]) {
    const payload = (rows || []).map((r) => {
      if (!keysToDrop) return r;
      const next = { ...r };
      for (const k of keysToDrop) delete next[k];
      return next;
    });
    const { error } = await supabase.from(table).upsert(payload, { onConflict });
    if (!error) return;
    lastErr = error;
    if (!missingColumn(error)) throw error;
  }
  throw lastErr || new Error('upsert failed');
};

const pickWarehouseId = async () => {
  try {
    const { data, error } = await supabase.rpc('_resolve_default_warehouse_id');
    if (!error && data && isUuid(data)) return String(data);
  } catch {
  }
  const { data, error } = await supabase.from('warehouses').select('id,code,is_active').eq('is_active', true).limit(20);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const main = rows.find((r) => String(r?.code || '').toUpperCase() === 'MAIN');
  const id = String(main?.id || rows[0]?.id || '');
  if (isUuid(id)) return id;

  const { data: company, error: cErr } = await supabase.from('companies').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (cErr) throw cErr;
  const { data: branch, error: bErr } = await supabase.from('branches').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (bErr) throw bErr;
  const companyId = String(company?.id || '');
  const branchId = String(branch?.id || '');
  if (!isUuid(companyId) || !isUuid(branchId)) throw new Error('missing default company/branch');

  const insertedId = crypto.randomUUID();
  const { data: inserted, error: insErr } = await supabase
    .from('warehouses')
    .insert({
      id: insertedId,
      code: 'MAIN',
      name: 'Main Warehouse',
      type: 'main',
      is_active: true,
      company_id: companyId,
      branch_id: branchId,
    })
    .select('id')
    .single();
  if (insErr) throw insErr;
  const finalId = String(inserted?.id || insertedId);
  if (!isUuid(finalId)) throw new Error('no active warehouse');
  return finalId;
};

const ensureBaseUomId = async () => {
  const { data: uomRow, error: uErr } = await supabase.from('uom').select('id,code').eq('code', 'piece').limit(1).maybeSingle();
  if (uErr) throw uErr;
  if (uomRow?.id) return String(uomRow.id);
  const { data: inserted, error: iErr } = await supabase.from('uom').insert({ code: 'piece', name: 'Piece' }).select('id').single();
  if (iErr) throw iErr;
  return String(inserted?.id || '');
};

const pickOrCreateSellableItemWithStock = async (warehouseId) => {
  const { data, error } = await supabase.from('v_sellable_products').select('id,available_quantity').gt('available_quantity', 0).limit(25);
  if (!error && Array.isArray(data)) {
    const id = String(data.find((r) => isUuid(r?.id))?.id || '');
    if (isUuid(id)) return id;
  }

  const baseUomId = await ensureBaseUomId();
  const itemId = crypto.randomUUID();
  const miPayload = {
    id: itemId,
    name: { ar: 'منتج دخان غذائي', en: 'Smoke Food Item' },
    price: 100,
    cost_price: 10,
    is_food: true,
    expiry_required: true,
    data: { group: 'SMOKE_FOOD', createdFor: 'smoke-test' },
  };
  const { error: miErr } = await supabase.from('menu_items').insert(miPayload);
  if (miErr) throw miErr;

  const { error: iuErr } = await supabase.from('item_uom').upsert(
    { item_id: itemId, base_uom_id: baseUomId, purchase_uom_id: baseUomId, sales_uom_id: baseUomId },
    { onConflict: 'item_id' }
  );
  if (iuErr) throw iuErr;

  const { error: smErr } = await supabase.from('stock_management').insert({
    item_id: itemId,
    warehouse_id: warehouseId,
    available_quantity: 10,
    reserved_quantity: 0,
    avg_cost: 10,
    unit: 'piece',
  });
  if (smErr) throw smErr;

  const batchId = crypto.randomUUID();
  const expiry = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
  const harvest = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const { error: batchErr } = await supabase.from('batches').insert({
    id: batchId,
    item_id: itemId,
    warehouse_id: warehouseId,
    batch_code: `SMOKE-${itemId.slice(0, 8)}`,
    quantity_received: 10,
    quantity_consumed: 0,
    quantity_transferred: 0,
    unit_cost: 10,
    status: 'active',
    qc_status: 'released',
    expiry_date: expiry,
    production_date: harvest,
    data: { createdFor: 'smoke-test' },
  });
  if (batchErr) throw batchErr;

  return itemId;
};

const ensureSupplier = async () => {
  const { data, error } = await supabase.from('suppliers').select('id,name').limit(5);
  if (!error && Array.isArray(data) && data.length > 0) return { id: String(data[0].id), name: String(data[0].name || '') };

  const id = crypto.randomUUID();
  const name = `مورد دخان ${id.slice(0, 6)}`;
  const payload = { id, name, phone: '777000000', contact_person: 'Smoke', address: '—' };
  const { error: insErr } = await supabase.from('suppliers').insert(payload);
  if (insErr) throw insErr;
  return { id, name };
};

const ensureCurrencyAndFx = async (currencyCode) => {
  const code = String(currencyCode || '').trim().toUpperCase();
  if (!code) return;
  const base = String((await getBaseCurrency()) || '').trim().toUpperCase();
  if (!base) return;
  if (code === base) return;

  await upsertWithFallback({
    table: 'currencies',
    onConflict: 'code',
    rows: [{ code, name: code, is_base: false }],
    fallbacks: [['is_base']],
  });

  const today = new Date().toISOString().slice(0, 10);
  await upsertWithFallback({
    table: 'fx_rates',
    onConflict: 'currency_code,rate_date,rate_type',
    rows: [{ currency_code: code, rate_date: today, rate_type: 'operational', rate: 2.0 }],
    fallbacks: [],
  });
};

const ensureValidDeliveryZone = async ({ lat, lng }) => {
  const { data, error } = await supabase
    .from('delivery_zones')
    .select('id,name,is_active,data')
    .eq('is_active', true)
    .limit(50);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const pick = rows.find((z) => {
    const coords = z?.data?.coordinates;
    const zl = Number(coords?.lat);
    const zg = Number(coords?.lng);
    const r = Number(coords?.radius);
    return Number.isFinite(zl) && Number.isFinite(zg) && Number.isFinite(r) && r > 0;
  });
  if (pick?.id && isUuid(pick.id)) return String(pick.id);

  const id = crypto.randomUUID();
  const payload = {
    id,
    name: `منطقة دخان ${id.slice(0, 6)}`,
    is_active: true,
    delivery_fee: 0,
    data: {
      coordinates: {
        lat,
        lng,
        radius: 1_000_000,
      },
    },
  };

  const { data: inserted, error: insErr } = await supabase.from('delivery_zones').insert(payload).select('id').single();
  if (insErr) throw insErr;
  const finalId = String(inserted?.id || id);
  if (!isUuid(finalId)) throw new Error('failed to create delivery zone');
  return finalId;
};

const getBaseCurrency = async () => {
  try {
    const { data, error } = await supabase.rpc('get_base_currency');
    if (!error) {
      const c = String(data || '').trim().toUpperCase();
      if (c) return c;
    }
  } catch {
  }
  const { data, error } = await supabase.from('currencies').select('code').eq('is_base', true).limit(1);
  if (error) return null;
  return String((data && data[0] && data[0].code) || '').trim().toUpperCase() || null;
};

async function run() {
  info('Smoke: auth.owner.signIn');
  const { data: ownerAuth, error: ownerAuthErr } = await supabase.auth.signInWithPassword({
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
  });
  if (ownerAuthErr || !ownerAuth?.session) {
    fail(`Owner Sign In Failed: ${ownerAuthErr?.message || 'no session'}`);
    process.exit(1);
  }
  ok('auth.owner.signIn');

  const base = await getBaseCurrency();
  ok(`baseCurrency=${base || '—'}`);

  info('Smoke: stock tables readable');
  const stockRead = await supabase.from('stock_management').select('item_id').limit(1);
  if (stockRead.error) {
    warn(`stock_management read failed: ${stockRead.error.message}`);
  } else {
    ok('stock_management read');
  }

  const warehouseId = await pickWarehouseId();
  ok(`warehouseId=${warehouseId}`);

  const supplier = await ensureSupplier();
  ok(`supplier=${supplier.name || supplier.id}`);

  const itemId = await pickOrCreateSellableItemWithStock(warehouseId);
  ok(`sellableItemId=${itemId}`);

  await ensureCurrencyAndFx('USD');

  info('Smoke: online order multi-currency (customer)');
  const onlineLat = 15.3694;
  const onlineLng = 44.191;
  const zoneId = await ensureValidDeliveryZone({ lat: onlineLat, lng: onlineLng });
  ok(`deliveryZoneId=${zoneId}`);
  const ts = Date.now();
  const tempEmail = `smoke_${ts}@example.com`;
  const tempPass = 'Test@123456';
  const randomSuffix = Math.floor(Math.random() * 900000) + 100000;
  const tempPhone = `777${randomSuffix}`;

  const { data: signupData, error: signupErr } = await supabase.auth.signUp({
    email: tempEmail,
    password: tempPass,
    options: {
      data: {
        full_name: 'Smoke Customer',
        phone_number: tempPhone,
      },
    },
  });
  if (signupErr) throw signupErr;
  if (!signupData?.user?.id) throw new Error('signup returned no user');

  const orderPayload = {
    p_items: [{
      itemId,
      quantity: 1,
      weight: 0,
      selectedAddons: {},
    }],
    p_delivery_zone_id: zoneId,
    p_payment_method: 'cash',
    p_notes: 'Smoke Online Order',
    p_address: 'Smoke Address',
    p_location: { lat: onlineLat, lng: onlineLng },
    p_customer_name: 'Smoke Customer',
    p_phone_number: tempPhone,
    p_is_scheduled: false,
    p_scheduled_at: null,
    p_coupon_code: null,
    p_points_redeemed_value: 0,
    p_payment_proof_type: null,
    p_payment_proof: null,
    p_order_source: 'online',
    p_explicit_customer_id: null,
    p_currency: 'USD',
  };

  const { data: createdOrder, error: orderErr } = await supabase.rpc('create_order_secure_with_payment_proof', orderPayload);
  if (orderErr) throw orderErr;
  const createdOrderId = String(createdOrder?.id || '');
  if (!createdOrderId) throw new Error('online order returned no id');
  const createdOrderCurrency = String(createdOrder?.currency || createdOrder?.data?.currency || '').trim().toUpperCase();
  ok(`onlineOrder.created id=${createdOrderId} currency=${createdOrderCurrency || '—'}`);
  if (createdOrderCurrency && createdOrderCurrency !== 'USD') warn(`onlineOrder currency is ${createdOrderCurrency} (expected USD)`);

  info('Smoke: auth.owner.reSignIn');
  const { error: ownerAgainErr } = await supabase.auth.signInWithPassword({
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
  });
  if (ownerAgainErr) throw ownerAgainErr;
  ok('auth.owner.reSignIn');

  info('Smoke: purchases (create PO + receive with dates)');
  const poId = crypto.randomUUID();
  const purchaseDate = new Date().toISOString().slice(0, 10);
  const poPayload = {
    id: poId,
    supplier_id: supplier.id,
    purchase_date: purchaseDate,
    currency: base || 'YER',
    fx_rate: 1,
    status: 'draft',
    created_by: ownerAuth.user.id,
    warehouse_id: warehouseId,
    payment_terms: 'cash',
    net_days: 0,
    due_date: purchaseDate,
    reference_number: `SMOKE-${poId.slice(0, 8)}`,
  };
  await insertWithFallback({
    table: 'purchase_orders',
    rows: [poPayload],
    fallbacks: [
      ['warehouse_id', 'payment_terms', 'net_days', 'due_date', 'currency', 'fx_rate'],
      ['warehouse_id', 'payment_terms', 'net_days', 'due_date'],
      ['warehouse_id'],
      ['reference_number'],
    ],
  });

  const piId = crypto.randomUUID();
  const purchaseItemPayload = {
    id: piId,
    purchase_order_id: poId,
    item_id: itemId,
    quantity: 2,
    unit_cost: 10,
    unit_cost_foreign: 10,
    total_cost: 20,
  };
  await insertWithFallback({
    table: 'purchase_items',
    rows: [purchaseItemPayload],
    fallbacks: [
      ['unit_cost_foreign'],
      ['id'],
    ],
  });
  ok(`purchaseOrder.created id=${poId}`);

  const occurredAtIso = new Date().toISOString();
  const expiry = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
  const harvest = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const idempotencyKey = `smoke_${poId}_${itemId}`.slice(0, 120);
  const { data: receiptId, error: rcvErr } = await supabase.rpc('receive_purchase_order_partial', {
    p_order_id: poId,
    p_items: [{
      itemId,
      quantity: 2,
      expiryDate: expiry,
      harvestDate: harvest,
      idempotencyKey,
    }],
    p_occurred_at: occurredAtIso,
  });
  if (rcvErr) throw rcvErr;
  ok(`purchase.received receiptId=${String(receiptId)}`);

  info('Smoke: inventory stock report RPC');
  const inv = await supabase.rpc('get_inventory_stock_report', {
    p_warehouse_id: warehouseId,
    p_category: null,
    p_group: null,
    p_supplier_id: null,
    p_stock_filter: 'all',
    p_search: null,
    p_limit: 20,
    p_offset: 0,
  });
  if (inv.error) throw inv.error;
  ok(`inventoryStockReport.ok rows=${Array.isArray(inv.data) ? inv.data.length : 0}`);

  info('Smoke: supplier stock report RPC');
  const supRep = await supabase.rpc('get_supplier_stock_report', {
    p_supplier_id: supplier.id,
    p_warehouse_id: warehouseId,
    p_days: 7,
  });
  if (supRep.error) throw supRep.error;
  ok(`supplierStockReport.ok rows=${Array.isArray(supRep.data) ? supRep.data.length : 0}`);

  ok('Smoke: done');
}

run().catch((e) => {
  fail(e?.message || String(e));
  if (e?.details) fail(String(e.details));
  if (e?.hint) fail(String(e.hint));
  process.exit(1);
});
