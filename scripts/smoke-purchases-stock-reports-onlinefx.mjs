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
const SMOKE_BASE_CURRENCY = String(process.env.AZTA_SMOKE_BASE_CURRENCY || 'SAR').trim().toUpperCase();
const SMOKE_OPERATIONAL_CURRENCIES = String(process.env.AZTA_SMOKE_OPERATIONAL_CURRENCIES || 'USD,YER')
  .split(',')
  .map((c) => String(c || '').trim().toUpperCase())
  .filter(Boolean);
const SMOKE_HIGH_INFLATION_CURRENCIES = String(process.env.AZTA_SMOKE_HIGH_INFLATION_CURRENCIES || 'YER')
  .split(',')
  .map((c) => String(c || '').trim().toUpperCase())
  .filter(Boolean);

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

const ensureCurrencyAndFx = async (currencyCode, { operationalRate = null, accountingRate = null } = {}) => {
  const code = String(currencyCode || '').trim().toUpperCase();
  if (!code) return;
  const base = String((await getBaseCurrency()) || '').trim().toUpperCase();
  if (!base) return;
  if (code === base) return;

  await upsertWithFallback({
    table: 'currencies',
    onConflict: 'code',
    rows: [{ code, name: code, is_base: false, is_high_inflation: SMOKE_HIGH_INFLATION_CURRENCIES.includes(code) }],
    fallbacks: [['is_base']],
  });

  const today = new Date().toISOString().slice(0, 10);
  if (operationalRate != null) {
    await upsertWithFallback({
      table: 'fx_rates',
      onConflict: 'currency_code,rate_date,rate_type',
      rows: [{ currency_code: code, rate_date: today, rate_type: 'operational', rate: Number(operationalRate) }],
      fallbacks: [],
    });
  }
  if (accountingRate != null) {
    await upsertWithFallback({
      table: 'fx_rates',
      onConflict: 'currency_code,rate_date,rate_type',
      rows: [{ currency_code: code, rate_date: today, rate_type: 'accounting', rate: Number(accountingRate) }],
      fallbacks: [],
    });
  }
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

const normalizeAppSettingsData = (raw) => {
  const nowIso = new Date().toISOString();
  if (!raw || typeof raw !== 'object') return { id: 'app', settings: {}, updatedAt: nowIso };

  const obj = raw;
  if (obj.settings && typeof obj.settings === 'object') {
    return {
      id: String(obj.id || 'app'),
      settings: obj.settings,
      updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : nowIso,
    };
  }

  const { id, updatedAt, ...rest } = obj;
  return {
    id: String(id || 'app'),
    settings: rest && typeof rest === 'object' ? rest : {},
    updatedAt: typeof updatedAt === 'string' ? updatedAt : nowIso,
  };
};

const mergeSettingsForApp = (existingData, patchSettings) => {
  const base = normalizeAppSettingsData(existingData);
  const settings = base.settings && typeof base.settings === 'object' ? base.settings : {};
  return {
    id: String(base.id || 'app'),
    settings: { ...settings, ...patchSettings },
    updatedAt: new Date().toISOString(),
  };
};

const ensureOperationalCurrencies = async (codes) => {
  const normalized = Array.from(new Set((codes || []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)));
  const { data: appRow, error: readErr } = await supabase.from('app_settings').select('id,data').eq('id', 'app').maybeSingle();
  if (readErr) throw readErr;
  const existing = appRow?.data && typeof appRow.data === 'object' ? appRow.data : {};
  const nextData = mergeSettingsForApp(existing, { operationalCurrencies: normalized });
  const { error: upErr } = await supabase.from('app_settings').upsert({ id: 'app', data: nextData }, { onConflict: 'id' });
  if (upErr) throw upErr;
};

const setBaseCurrencyIfPossible = async (code) => {
  const next = String(code || '').trim().toUpperCase();
  if (!next) throw new Error('missing base currency code');
  const { error } = await supabase.rpc('set_base_currency', { p_code: next });
  if (error) throw error;
  return next;
};

const getFxRate = async (currencyCode, rateType = 'operational') => {
  const code = String(currencyCode || '').trim().toUpperCase();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc('get_fx_rate', { p_currency: code, p_date: today, p_rate_type: rateType });
  if (error) throw error;
  const v = Number(data);
  if (!Number.isFinite(v) || !(v > 0)) throw new Error(`invalid fx_rate for ${code} (${rateType})`);
  return v;
};

const createAndDeliverOrder = async ({ currency, itemId, warehouseId, deliveryZoneId, phoneNumber, customerName = 'Smoke Customer', qty = 1, customerAuthUserId = null }) => {
  const nowIso = new Date().toISOString();
  const baseCurrency = await getBaseCurrency();
  const fxRate = currency === baseCurrency ? 1 : await getFxRate(currency, 'operational');
  const { data: sessionData } = await supabase.auth.getSession();
  const sessionUserId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : null;
  const userId = customerAuthUserId ? String(customerAuthUserId) : sessionUserId;
  if (!isUuid(userId)) throw new Error('missing authenticated user for order insert');

  const orderId = crypto.randomUUID();
  const payloadItems = [{ itemId, quantity: qty }];
  const { data: itemRow, error: itemErr } = await supabase
    .from('menu_items')
    .select('price')
    .eq('id', itemId)
    .maybeSingle();
  if (itemErr) throw itemErr;
  const basePrice = Number(itemRow?.price || 0) || 0;
  if (!(basePrice > 0)) throw new Error('menu item price missing');
  const totalForeign = currency === baseCurrency ? basePrice * qty : (basePrice * qty) / fxRate;
  const totalForeignRounded = Math.round(totalForeign * 100) / 100;
  const orderData = {
    id: orderId,
    userId,
    orderSource: 'in_store',
    items: payloadItems.map((it) => ({ ...it, weight: 0, selectedAddons: {} })),
    subtotal: totalForeignRounded,
    deliveryFee: 0,
    discountAmount: 0,
    total: totalForeignRounded,
    taxAmount: 0,
    taxRate: 0,
    paymentMethod: 'cash',
    notes: `Smoke Order ${currency}`,
    address: 'داخل المحل',
    location: null,
    customerName,
    phoneNumber,
    deliveryZoneId: deliveryZoneId || null,
    status: 'pending',
    createdAt: nowIso,
    currency,
    fxRate,
  };

  const insertRow = {
    id: orderId,
    customer_auth_user_id: userId,
    status: 'pending',
    invoice_number: null,
    currency,
    fx_rate: fxRate,
    subtotal: totalForeignRounded,
    total: totalForeignRounded,
    items: orderData.items,
    data: orderData,
    delivery_zone_id: deliveryZoneId || null,
    warehouse_id: warehouseId,
  };

  await insertWithFallback({
    table: 'orders',
    rows: [insertRow],
    primarySelect: 'id',
    fallbacks: [
      ['invoice_number', 'warehouse_id'],
      ['invoice_number'],
      ['delivery_zone_id', 'warehouse_id'],
      ['delivery_zone_id'],
      ['items', 'subtotal', 'total'],
      ['currency', 'fx_rate'],
    ],
  });

  const { data: row, error: rowErr } = await supabase
    .from('orders')
    .select('id,status,data,currency,fx_rate,base_total,total,delivery_zone_id')
    .eq('id', orderId)
    .maybeSingle();
  if (rowErr) throw rowErr;
  if (!row?.id) throw new Error('failed to read back inserted order');

  const updatedData = { ...(row.data || orderData), status: 'delivered', deliveredAt: nowIso, paidAt: nowIso, paymentMethod: 'cash' };
  const { error: delErr } = await supabase.rpc('confirm_order_delivery', {
    p_payload: {
      p_order_id: orderId,
      p_items: payloadItems,
      p_updated_data: updatedData,
      p_warehouse_id: warehouseId,
    },
  });
  if (delErr) throw delErr;

  const { data: delivered, error: readAfterErr } = await supabase
    .from('orders')
    .select('id,status,data,currency,fx_rate,base_total,total')
    .eq('id', orderId)
    .maybeSingle();
  if (readAfterErr) throw readAfterErr;

  return delivered || row;
};

const createAndProcessSalesReturn = async ({ orderRow, itemId, qty = 1 }) => {
  const orderId = String(orderRow?.id || '');
  if (!isUuid(orderId)) throw new Error('invalid order id for return');
  const totalForeign = Number(orderRow?.total || orderRow?.data?.total || 0) || 0;
  const refund = Math.max(1, totalForeign * 0.5);
  const returnId = crypto.randomUUID();
  const payload = {
    id: returnId,
    order_id: orderId,
    return_date: new Date().toISOString(),
    reason: `Smoke return ${String(orderRow?.currency || orderRow?.data?.currency || '')}`,
    refund_method: 'cash',
    total_refund_amount: refund,
    items: [{ itemId, quantity: qty, total: refund, unitPrice: refund / Math.max(1, qty) }],
    status: 'draft',
    created_by: null,
  };
  const { error: insErr } = await supabase.from('sales_returns').insert(payload);
  if (insErr) throw insErr;
  const { error: procErr } = await supabase.rpc('process_sales_return', { p_return_id: returnId });
  if (procErr) throw procErr;
  return returnId;
};

const createPurchaseOrderAndReceive = async ({ currency, supplierId, itemId, warehouseId, qty = 2, unitCostForeign = 10 }) => {
  const purchaseDate = new Date().toISOString().slice(0, 10);
  const poId = crypto.randomUUID();
  const fxRate = currency === (await getBaseCurrency()) ? 1 : await getFxRate(currency, 'operational');
  const totalAmount = Number(unitCostForeign) * Number(qty);
  const poPayload = {
    id: poId,
    supplier_id: supplierId,
    purchase_date: purchaseDate,
    currency,
    fx_rate: fxRate,
    total_amount: totalAmount,
    status: 'draft',
    created_at: new Date().toISOString(),
    warehouse_id: warehouseId,
    payment_terms: 'cash',
    net_days: 0,
    due_date: purchaseDate,
    reference_number: `SMOKE-${currency}-${poId.slice(0, 8)}`,
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
    quantity: qty,
    unit_cost: unitCostForeign,
    unit_cost_foreign: unitCostForeign,
    total_cost: totalAmount,
  };
  await insertWithFallback({
    table: 'purchase_items',
    rows: [purchaseItemPayload],
    fallbacks: [
      ['unit_cost_foreign'],
      ['id'],
    ],
  });

  const occurredAtIso = new Date().toISOString();
  const expiry = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
  const harvest = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const idempotencyKey = `smoke_${poId}_${itemId}_${currency}`.slice(0, 120);
  const { data: receiptId, error: rcvErr } = await supabase.rpc('receive_purchase_order_partial', {
    p_order_id: poId,
    p_items: [{
      itemId,
      quantity: qty,
      expiryDate: expiry,
      harvestDate: harvest,
      idempotencyKey,
    }],
    p_occurred_at: occurredAtIso,
  });
  if (rcvErr) throw rcvErr;
  return { poId, receiptId: String(receiptId || '') };
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

  info(`Smoke: configure currencies base=${SMOKE_BASE_CURRENCY} operational=${SMOKE_OPERATIONAL_CURRENCIES.join(',') || '—'}`);
  await setBaseCurrencyIfPossible(SMOKE_BASE_CURRENCY);
  await upsertWithFallback({
    table: 'currencies',
    onConflict: 'code',
    rows: [{ code: SMOKE_BASE_CURRENCY, name: SMOKE_BASE_CURRENCY, is_base: true, is_high_inflation: SMOKE_HIGH_INFLATION_CURRENCIES.includes(SMOKE_BASE_CURRENCY) }],
    fallbacks: [['is_base']],
  });
  await ensureOperationalCurrencies(SMOKE_OPERATIONAL_CURRENCIES);

  const base = await getBaseCurrency();
  ok(`baseCurrency=${base || '—'}`);
  if (base !== SMOKE_BASE_CURRENCY) warn(`baseCurrency mismatch expected=${SMOKE_BASE_CURRENCY} got=${base || '—'}`);

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

  const today = new Date().toISOString().slice(0, 10);
  await upsertWithFallback({
    table: 'fx_rates',
    onConflict: 'currency_code,rate_date,rate_type',
    rows: [
      { currency_code: SMOKE_BASE_CURRENCY, rate_date: today, rate_type: 'operational', rate: 1 },
      { currency_code: SMOKE_BASE_CURRENCY, rate_date: today, rate_type: 'accounting', rate: 1 },
    ],
    fallbacks: [],
  });
  await ensureCurrencyAndFx('USD', { operationalRate: 3.75, accountingRate: 3.8 });
  await ensureCurrencyAndFx('YER', { operationalRate: 250, accountingRate: 300 });
  await upsertWithFallback({
    table: 'currencies',
    onConflict: 'code',
    rows: [
      { code: 'USD', name: 'USD', is_base: false, is_high_inflation: SMOKE_HIGH_INFLATION_CURRENCIES.includes('USD') },
      { code: 'YER', name: 'YER', is_base: false, is_high_inflation: true },
    ],
    fallbacks: [['is_base']],
  });

  info('Smoke: online order multi-currency (admin insert + deliver)');
  const onlineLat = 15.3694;
  const onlineLng = 44.191;
  const zoneId = await ensureValidDeliveryZone({ lat: onlineLat, lng: onlineLng });
  ok(`deliveryZoneId=${zoneId}`);
  const ts = Date.now();
  const randomSuffix = Math.floor(Math.random() * 900000) + 100000;
  const tempPhone = `777${randomSuffix}`;

  const orderRows = [];
  for (const ccy of [SMOKE_BASE_CURRENCY, 'USD', 'YER']) {
    info(`Smoke: order.create+deliver currency=${ccy}`);
    const row = await createAndDeliverOrder({
      currency: ccy,
      itemId,
      warehouseId,
      deliveryZoneId: zoneId,
      phoneNumber: tempPhone,
      customerName: `Smoke Customer ${ccy}`,
      qty: 1,
    });
    const currencyDb = String(row?.currency || row?.data?.currency || '').trim().toUpperCase();
    const fxDb = row?.fx_rate == null ? null : Number(row.fx_rate);
    const totalDb = Number(row?.total || row?.data?.total || 0) || 0;
    const baseTotalDb = row?.base_total == null ? null : Number(row.base_total);
    ok(`order.delivered id=${String(row?.id || '').slice(0, 8)} currency=${currencyDb || '—'} total=${totalDb} base_total=${baseTotalDb == null ? '—' : baseTotalDb}`);
    if (currencyDb && currencyDb !== ccy) warn(`order.currency mismatch expected=${ccy} got=${currencyDb}`);
    if (ccy === SMOKE_BASE_CURRENCY) {
      if (fxDb != null && Math.abs(fxDb - 1) > 1e-6) warn(`order.fx_rate expected 1 got ${fxDb}`);
    } else {
      const expectedFx = await getFxRate(ccy, 'operational');
      if (fxDb != null && Math.abs(fxDb - expectedFx) > 1e-6) warn(`order.fx_rate mismatch expected=${expectedFx} got=${fxDb}`);
      if (baseTotalDb != null && Math.abs(baseTotalDb - (totalDb * expectedFx)) > 0.01) warn(`order.base_total mismatch expected≈${totalDb * expectedFx} got=${baseTotalDb}`);
    }
    orderRows.push(row);
  }

  info('Smoke: auth.owner.reSignIn');
  const { error: ownerAgainErr } = await supabase.auth.signInWithPassword({
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
  });
  if (ownerAgainErr) throw ownerAgainErr;
  ok('auth.owner.reSignIn');

  info('Smoke: purchases in all currencies (create PO + receive)');
  const purchaseRuns = [];
  for (const ccy of [SMOKE_BASE_CURRENCY, 'USD', 'YER']) {
    info(`Smoke: purchase.create+receive currency=${ccy}`);
    const { poId, receiptId } = await createPurchaseOrderAndReceive({
      currency: ccy,
      supplierId: supplier.id,
      itemId,
      warehouseId,
      qty: 2,
      unitCostForeign: 10,
    });
    ok(`purchase.received poId=${poId.slice(0, 8)} receiptId=${String(receiptId || '').slice(0, 8)}`);
    purchaseRuns.push({ poId, currency: ccy });
  }

  info('Smoke: purchase returns in all currencies');
  for (const run of purchaseRuns) {
    const { data: retId, error: retErr } = await supabase.rpc('create_purchase_return', {
      p_order_id: run.poId,
      p_items: [{ itemId, quantity: 1 }],
      p_reason: `Smoke purchase return ${run.currency}`,
      p_occurred_at: new Date().toISOString(),
    });
    if (retErr) throw retErr;
    ok(`purchase.return created id=${String(retId || '').slice(0, 8)} currency=${run.currency}`);
  }

  info('Smoke: sales returns in all currencies');
  for (const row of orderRows) {
    const currencyDb = String(row?.currency || row?.data?.currency || '').trim().toUpperCase() || '—';
    const rid = await createAndProcessSalesReturn({ orderRow: row, itemId, qty: 1 });
    ok(`sales.return processed id=${String(rid).slice(0, 8)} orderCurrency=${currencyDb}`);
  }

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

  info('Smoke: reports (sales/products/financial) in base currency');
  const start = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 1 * 86400_000).toISOString().slice(0, 10);
  const [{ data: daily }, { data: pay }, { data: prod }, { data: tb }, { data: isData }, { data: bsData }] = await Promise.all([
    supabase.rpc('get_daily_sales_stats', { p_start_date: `${start}T00:00:00Z`, p_end_date: `${end}T23:59:59Z`, p_zone_id: null }),
    supabase.rpc('get_payment_method_stats', { p_start_date: `${start}T00:00:00Z`, p_end_date: `${end}T23:59:59Z`, p_zone_id: null }),
    supabase.rpc('get_product_sales_report', { p_start_date: `${start}T00:00:00Z`, p_end_date: `${end}T23:59:59Z`, p_zone_id: null }),
    supabase.rpc('trial_balance', { p_start: start, p_end: end, p_cost_center_id: null, p_journal_id: null }),
    supabase.rpc('income_statement', { p_start: start, p_end: end, p_cost_center_id: null, p_journal_id: null }),
    supabase.rpc('balance_sheet', { p_as_of: end, p_cost_center_id: null, p_journal_id: null }),
  ]);
  ok(`reports.sales.daily rows=${Array.isArray(daily) ? daily.length : 0}`);
  ok(`reports.sales.paymentMethods rows=${Array.isArray(pay) ? pay.length : 0}`);
  ok(`reports.products rows=${Array.isArray(prod) ? prod.length : 0}`);
  ok(`reports.financial.trialBalance rows=${Array.isArray(tb) ? tb.length : 0}`);
  ok(`reports.financial.incomeStatement ok=${Array.isArray(isData) && isData.length > 0}`);
  ok(`reports.financial.balanceSheet ok=${Array.isArray(bsData) && bsData.length > 0}`);

  info('Smoke: validate high inflation flag and FX inversion safety');
  const { data: curRows, error: curErr } = await supabase.from('currencies').select('code,is_base,is_high_inflation').in('code', ['USD', 'YER', SMOKE_BASE_CURRENCY]);
  if (curErr) throw curErr;
  const yerRow = (curRows || []).find((r) => String(r?.code || '').toUpperCase() === 'YER');
  if (!yerRow || !yerRow.is_high_inflation) warn('YER is not marked as high inflation');
  const yerFx = await getFxRate('YER', 'operational');
  if (!(yerFx > 0 && yerFx < 1)) warn(`expected YER fx_rate < 1 when base is not high inflation, got ${yerFx}`);

  ok('Smoke: done');
}

run().catch((e) => {
  fail(e?.message || String(e));
  if (e?.details) fail(String(e.details));
  if (e?.hint) fail(String(e.hint));
  process.exit(1);
});
