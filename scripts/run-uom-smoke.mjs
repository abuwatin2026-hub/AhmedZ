import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

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
  } catch {}
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

const must = async (label, fn) => {
  try {
    const res = await fn();
    console.log(`OK|${label}|${JSON.stringify(res)}`);
    return res;
  } catch (err) {
    console.error(`ERR|${label}|${String(err?.message || err)}`);
    throw err;
  }
};

const signInOwner = async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
  });
  if (error || !data.session) throw new Error(error?.message || 'no session');
  return data.user?.id;
};

const ensureWarehouseScope = async () => {
  try {
    const { data, error } = await supabase.rpc('get_admin_session_scope');
    if (!error) {
      const row = Array.isArray(data) ? (data[0] || {}) : (data || {});
      const wid = String(row?.warehouse_id || row?.warehouseId || '').trim();
      if (wid) return { warehouseId: wid };
    }
  } catch {}
  const { data: ws } = await supabase.from('warehouses').select('id,code,is_active').eq('is_active', true).order('code', { ascending: true }).limit(1);
  const wid = String(ws?.[0]?.id || '').trim();
  if (wid) return { warehouseId: wid };
  const ins = await supabase.from('warehouses').insert({ code: 'MAIN', name: 'Main Warehouse', type: 'main', is_active: true }).select('id').single();
  if (ins.error) throw ins.error;
  return { warehouseId: String(ins.data.id) };
};

const ensureCurrencies = async () => {
  const baseRows = await supabase.from('currencies').select('code').eq('is_base', true).limit(1);
  if (baseRows.error) throw baseRows.error;
  const base = String(baseRows.data?.[0]?.code || '').toUpperCase();
  const usdRate = 3.75;
  const yerRate = 0.002336;
  const today = new Date().toISOString().slice(0, 10);
  const upsert = async (code, rate) => {
    await supabase.from('currencies').upsert({ code, name: code, is_base: code === base, is_high_inflation: code === 'YER' });
    await supabase.from('fx_rates').upsert({ currency_code: code, rate: rate, rate_date: today, rate_type: 'operational' }, { onConflict: 'currency_code,rate_date,rate_type' });
    await supabase.from('fx_rates').upsert({ currency_code: code, rate: rate, rate_date: today, rate_type: 'accounting' }, { onConflict: 'currency_code,rate_date,rate_type' });
  };
  await upsert('USD', usdRate);
  await upsert('YER', yerRate);
  return { base, usdRate, yerRate, today };
};

const ensureSupplier = async () => {
  const { data, error } = await supabase.from('suppliers').select('id').eq('name', 'مورد دخان محلي').limit(1);
  if (error) throw error;
  if (Array.isArray(data) && data.length > 0) return String(data[0].id);
  const ins = await supabase.from('suppliers').insert({ name: 'مورد دخان محلي', contact_person: 'SMK', phone: '711111111', email: 'smk-supplier@example.com', address: 'صنعاء' }).select('id').single();
  if (ins.error) throw ins.error;
  return String(ins.data.id);
};

const createItemWithUom = async () => {
  const itemId = 'SMOKE-ITEM-' + crypto.randomUUID().replace(/-/g, '');
  const ins = await supabase.from('menu_items').insert({
    id: itemId,
    name: { ar: 'صنف دخان متعدد الوحدات', en: 'Smoke Multi-UOM Item' },
    price: 0,
    cost_price: 0,
    is_food: false,
    expiry_required: false,
    data: { group: 'SMOKE', createdFor: 'smoke_local_uom' },
    base_unit: 'piece',
    unit_type: 'piece',
  });
  if (ins.error) throw ins.error;

  // Ensure base UOM 'piece'
  let { data: uomRow } = await supabase.from('uom').select('id').eq('code', 'piece').maybeSingle();
  if (!uomRow?.id) {
    const created = await supabase.from('uom').insert({ code: 'piece', name: 'Piece' }).select('id').single();
    if (created.error) throw created.error;
    uomRow = created.data;
  }
  const baseUomId = String(uomRow.id);
  const iu = await supabase.from('item_uom').insert({ item_id: itemId, base_uom_id: baseUomId, purchase_uom_id: null, sales_uom_id: null });
  if (iu.error && !/duplicate key|unique/i.test(String(iu.error.message || ''))) throw iu.error;

  const pack = 6;
  const carton = 24;
  const up = await supabase.rpc('upsert_item_packaging_uom', { p_item_id: itemId, p_pack_size: pack, p_carton_size: carton });
  if (up.error) throw up.error;
  return { itemId, pack, carton, uom: up.data };
};

const createShipmentWithExpenses = async ({ supplierId, warehouseId, itemId, carton }) => {
  const ref = `SMK-SHIP-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  const ins = await supabase.from('import_shipments').insert({
    reference_number: ref,
    supplier_id: supplierId,
    status: 'draft',
    origin_country: 'CN',
    destination_warehouse_id: warehouseId,
    shipping_carrier: 'SMK',
    tracking_number: 'TRK-' + crypto.randomUUID().slice(0, 8),
    departure_date: new Date().toISOString().slice(0, 10),
    expected_arrival_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    notes: 'local smoke shipment',
  }).select('id').single();
  if (ins.error) throw ins.error;
  const shipmentId = String(ins.data.id);

  const uoms = await supabase.rpc('list_item_uom_units', { p_item_id: itemId });
  if (uoms.error) throw uoms.error;
  const cartonRow = (uoms.data || []).find(r => String(r.uom_code).toLowerCase() === 'carton');
  const qtyInBase = Number(cartonRow?.qty_in_base || carton);

  const itemsIns = await supabase.from('import_shipments_items').insert({
    shipment_id: shipmentId,
    item_id: itemId,
    quantity: qtyInBase,
    unit_price_fob: 5,
    currency: 'USD',
    notes: 'carton FOB (demo)',
  });
  if (itemsIns.error) throw itemsIns.error;

  const exp1 = await supabase.from('import_expenses').insert({
    shipment_id: shipmentId,
    expense_type: 'shipping',
    amount: 1,
    currency: 'USD',
    exchange_rate: 3.75,
    description: 'Sea freight',
    paid_at: new Date().toISOString().slice(0, 10),
    payment_method: 'bank',
  });
  if (exp1.error) throw exp1.error;

  const exp2 = await supabase.from('import_expenses').insert({
    shipment_id: shipmentId,
    expense_type: 'customs',
    amount: 1,
    currency: 'YER',
    exchange_rate: 0.002336,
    description: 'Customs',
    paid_at: new Date().toISOString().slice(0, 10),
    payment_method: 'bank',
  });
  if (exp2.error) throw exp2.error;

  const lc = await supabase.rpc('calculate_shipment_landed_cost', { p_shipment_id: shipmentId });
  if (lc.error) throw lc.error;
  return { shipmentId, qtyInBase };
};

const main = async () => {
  await must('auth.owner', signInOwner);
  const scope = await must('session.scope', ensureWarehouseScope);
  const fx = await must('fx.seed', ensureCurrencies);
  const supplierId = await must('supplier.ensure', ensureSupplier);
  const { itemId, carton } = await must('item.uom', createItemWithUom);
  const ship = await must('shipment.create', () => createShipmentWithExpenses({ supplierId, warehouseId: scope.warehouseId, itemId, carton }));

  // Read back pricing rows from UI data source equivalents
  const { data: pricingRows, error } = await supabase
    .from('import_shipments_items')
    .select('landing_cost_per_unit,item_id,quantity')
    .eq('shipment_id', ship.shipmentId);
  if (error) throw error;
  const lcUnit = Number(pricingRows?.[0]?.landing_cost_per_unit || 0);
  console.log(`OK|shipment.landed_cost_per_unit|${lcUnit}`);
};

main().catch(err => {
  console.error('FAILED', err);
  process.exit(1);
});
