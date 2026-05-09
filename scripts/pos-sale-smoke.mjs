import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.AZTA_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.AZTA_SUPABASE_ANON_KEY || '').trim();
const OWNER_EMAIL = (process.env.AZTA_SMOKE_OWNER_EMAIL || 'owner@azta.com').trim();
const OWNER_PASSWORD = (process.env.AZTA_SMOKE_OWNER_PASSWORD || 'Owner@123').trim();
const MULTI_WAREHOUSE = String(process.env.AZTA_SMOKE_MULTI_WAREHOUSE || '').trim() === '1';
const FORCED_WAREHOUSE_ID = String(process.env.AZTA_SMOKE_FORCE_WAREHOUSE_ID || '').trim();
const FORCED_WAREHOUSES = String(process.env.AZTA_SMOKE_WAREHOUSES || '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);
const KEEP_ORDERS = String(process.env.AZTA_SMOKE_KEEP_ORDERS || '').trim() === '1';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing AZTA_SUPABASE_URL / AZTA_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const out = [];
const push = (name, ok, extra = '') => out.push({ name, ok, extra });

const must = async (name, fn) => {
  try {
    const res = await fn();
    push(name, true, res ? String(res) : '');
    return res;
  } catch (e) {
    push(name, false, e?.message || String(e));
    throw e;
  }
};

const nowIso = new Date().toISOString();
const ymd = nowIso.slice(0, 10);
const IN_STORE_ZONE_ID = '11111111-1111-4111-8111-111111111111';

let orderIdForCleanup = null;
const orderIdsForCleanup = [];
let fatalError = null;

const fetchDefaultCompanyBranch = async () => {
  const { data: company, error: cErr } = await supabase.from('companies').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (cErr) throw new Error(cErr.message);
  const { data: branch, error: bErr } = await supabase.from('branches').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (bErr) throw new Error(bErr.message);
  if (!company?.id || !branch?.id) throw new Error('missing default company/branch');
  return { companyId: String(company.id), branchId: String(branch.id) };
};

const ensureWarehouseScope = async () => {
  const { data, error } = await supabase.rpc('get_admin_session_scope');
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  const w = row?.warehouse_id || row?.warehouseId;
  if (w) return { warehouseId: String(w) };

  const defaults = await fetchDefaultCompanyBranch();

  const { data: existing, error: wErr } = await supabase
    .from('warehouses')
    .select('id, code, is_active')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(10);
  if (wErr) throw new Error(wErr.message);
  let warehouseId = String((existing || []).find(x => String(x.code || '').toUpperCase() === 'MAIN')?.id || (existing || [])[0]?.id || '');

  if (!warehouseId) {
    const { data: inserted, error: insErr } = await supabase
      .from('warehouses')
      .insert({
        code: 'MAIN',
        name: 'Main Warehouse',
        type: 'main',
        is_active: true,
        company_id: defaults.companyId,
        branch_id: defaults.branchId,
      })
      .select('id')
      .single();
    if (insErr) throw new Error(insErr.message);
    warehouseId = String(inserted?.id || '');
  }

  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw new Error(uErr.message);
  const authUserId = String(u?.user?.id || '');
  if (!authUserId) throw new Error('no auth user id');

  const { error: upErr } = await supabase
    .from('admin_users')
    .update({ warehouse_id: warehouseId, company_id: defaults.companyId, branch_id: defaults.branchId })
    .eq('auth_user_id', authUserId);
  if (upErr) throw new Error(upErr.message);

  return { warehouseId };
};

const setWarehouseScope = async (warehouseId) => {
  const wid = String(warehouseId || '').trim();
  if (!wid) throw new Error('warehouseId is required');
  const defaults = await fetchDefaultCompanyBranch();
  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw new Error(uErr.message);
  const authUserId = String(u?.user?.id || '');
  if (!authUserId) throw new Error('no auth user id');
  const { error: upErr } = await supabase
    .from('admin_users')
    .update({ warehouse_id: wid, company_id: defaults.companyId, branch_id: defaults.branchId })
    .eq('auth_user_id', authUserId);
  if (upErr) throw new Error(upErr.message);
  return wid;
};

const getCandidateWarehouses = async (fallbackWarehouseId) => {
  const { data, error } = await supabase
    .from('stock_management')
    .select('warehouse_id, available_quantity')
    .gt('available_quantity', 0)
    .limit(500);
  if (error) throw new Error(error.message);
  const counts = new Map();
  for (const row of (data || [])) {
    const wid = String(row?.warehouse_id || '').trim();
    if (!wid) continue;
    counts.set(wid, (counts.get(wid) || 0) + 1);
  }
  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([wid]) => wid);
  if (fallbackWarehouseId && !ranked.includes(fallbackWarehouseId)) ranked.unshift(fallbackWarehouseId);
  return ranked.slice(0, 5);
};

const createOneInStoreSale = async ({ warehouseId, baseCurrency, label }) => {
  await setWarehouseScope(warehouseId);
  const itemId = await must(`ensure.item+stock.${label}`, async () => await ensureSellableItemWithStock(warehouseId));
  const unitPrice = 100;
  const orderId = await must(`sale.create+deliver+pay.${label}`, async () => {
    const id = crypto.randomUUID();
    orderIdForCleanup = id;
    orderIdsForCleanup.push(id);

    const orderData = {
      id,
      orderSource: 'in_store',
      warehouseId,
      deliveryZoneId: IN_STORE_ZONE_ID,
      currency: baseCurrency,
      subtotal: unitPrice,
      discountAmount: 0,
      total: unitPrice,
      status: 'delivered',
      createdAt: nowIso,
      deliveredAt: nowIso,
      paidAt: nowIso,
      paymentMethod: 'cash',
      invoiceTerms: 'cash',
      netDays: 0,
      dueDate: ymd,
      customerName: `زبون حضوري ${label}`,
      phoneNumber: '',
      address: 'داخل المحل',
      items: [
        {
          id: itemId,
          itemId: itemId,
          quantity: 1,
          unitType: 'piece',
          price: unitPrice,
          selectedAddons: {},
          cartItemId: crypto.randomUUID(),
        },
      ],
    };

    const { error: insErr } = await supabase.from('orders').insert({
      id,
      status: 'pending',
      delivery_zone_id: IN_STORE_ZONE_ID,
      warehouse_id: warehouseId,
      data: { ...orderData, status: 'pending', paidAt: undefined, deliveredAt: undefined },
    });
    if (insErr) throw new Error(insErr.message);

    const { data: invNum, error: invErr } = await supabase.rpc('assign_invoice_number_if_missing', { p_order_id: id });
    if (invErr) throw new Error(invErr.message);
    if (typeof invNum === 'string' && invNum) {
      orderData.invoiceNumber = invNum;
    }

    try {
      const { error: cErr } = await supabase.rpc('confirm_order_delivery_with_credit', {
        p_order_id: id,
        p_items: [{ itemId, quantity: 1 }],
        p_updated_data: orderData,
        p_warehouse_id: warehouseId,
      });
      if (cErr) throw new Error(cErr.message);
    } catch (e) {
      if (!String(e).includes('posting already exists') && !String(e).includes('already delivered')) {
        throw e;
      }
    }

    const { error: payErr } = await supabase.rpc('record_order_payment_v2', {
      p_order_id: id,
      p_amount: unitPrice,
      p_method: 'cash',
      p_occurred_at: nowIso,
      p_currency: baseCurrency,
      p_idempotency_key: `pos-sale:${label}:${id}:${nowIso}`,
      p_data: { smoke: true, source: 'pos-sale-smoke' },
    });
    if (payErr) throw new Error(payErr.message);

    return id;
  });

  await must(`sale.verify.currency.${label}`, async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('id, data, status')
      .eq('id', orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const st = String(data?.status || '').toLowerCase();
    if (st !== 'delivered') throw new Error(`expected delivered, got ${st || 'unknown'}`);
    const code = String(data?.data?.currency || '').trim().toUpperCase();
    if (!code) throw new Error('currency missing in orders.data');

    const { count: saleOutCount, error: sErr } = await supabase
      .from('inventory_movements')
      .select('id', { count: 'exact', head: true })
      .eq('reference_table', 'orders')
      .eq('reference_id', orderId)
      .eq('movement_type', 'sale_out');
    if (sErr) throw new Error(sErr.message);
    if ((saleOutCount || 0) < 1) throw new Error('missing sale_out movement');

    const { count: jeCount, error: jeErr } = await supabase
      .from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('source_table', 'orders')
      .eq('source_id', orderId)
      .in('source_event', ['invoiced', 'delivered']);
    if (jeErr) throw new Error(jeErr.message);
    if ((jeCount || 0) < 1) throw new Error('missing journal entry');

    const { count: paymentCount, error: pErr } = await supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('reference_table', 'orders')
      .eq('reference_id', orderId)
      .eq('direction', 'in');
    if (pErr) throw new Error(pErr.message);
    if ((paymentCount || 0) < 1) throw new Error('missing payment row');

    return `delivered:${code}:sale_out=${saleOutCount || 0}:je=${jeCount || 0}:pay=${paymentCount || 0}`;
  });

  return orderId;
};

const ensureSellableItemWithStock = async (warehouseId) => {
  const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '').trim());
  const ensureBaseUomId = async () => {
    const { data: uomRow, error: uErr } = await supabase.from('uom').select('id, code').eq('code', 'piece').limit(1).maybeSingle();
    if (uErr) throw new Error(uErr.message);
    if (uomRow?.id) return String(uomRow.id);
    const { data: inserted, error: iErr } = await supabase.from('uom').insert({ code: 'piece', name: 'Piece' }).select('id').single();
    if (iErr) throw new Error(iErr.message);
    return String(inserted?.id || '');
  };

  // Use an isolated test item to avoid batch availability flakiness from live items.

  const itemId = crypto.randomUUID();
  const { error: miErr } = await supabase.from('menu_items').insert({
    id: itemId,
    name: { ar: 'منتج دخان', en: 'Smoke Item' },
    price: 100,
    cost_price: 10,
    is_food: false,
    expiry_required: false,
    data: { group: 'SMOKE', createdFor: 'smoke-test' },
  });
  if (miErr) throw new Error(miErr.message);

  const baseUomId = await ensureBaseUomId();
  const { error: iuErr } = await supabase.from('item_uom').upsert(
    { item_id: itemId, base_uom_id: baseUomId, purchase_uom_id: baseUomId, sales_uom_id: baseUomId },
    { onConflict: 'item_id' }
  );
  if (iuErr) throw new Error(iuErr.message);

  const { error: smErr } = await supabase.from('stock_management').insert({
    item_id: itemId,
    warehouse_id: warehouseId,
    available_quantity: 50,
    reserved_quantity: 0,
    avg_cost: 10,
    unit: 'piece',
  });
  if (smErr) throw new Error(smErr.message);

  const batchId = crypto.randomUUID();
  const { error: batchErr } = await supabase.from('batches').insert({
    id: batchId,
    item_id: itemId,
    warehouse_id: warehouseId,
    batch_code: `SMOKE-${itemId.slice(0, 8)}`,
    quantity_received: 50,
    quantity_consumed: 0,
    quantity_transferred: 0,
    unit_cost: 10,
    status: 'active',
    qc_status: 'released',
    data: { createdFor: 'smoke-test' },
  });
  if (batchErr) throw new Error(batchErr.message);

  return itemId;
};

try {
  await must('auth.owner.signIn', async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
    });
    if (error || !data.session) throw new Error(error?.message || 'no session');
    return data.user?.id;
  });

  const scope = await must('rpc.ensure_admin_session_scope', async () => await ensureWarehouseScope());

  const baseCurrency = await must('baseCurrency', async () => {
    const { data, error } = await supabase.from('currencies').select('code').eq('is_base', true).limit(1);
    if (error) throw new Error(error.message);
    return String(data?.[0]?.code || 'YER').toUpperCase();
  });

  if (MULTI_WAREHOUSE) {
    const candidates = await must('multiwarehouse.candidates', async () => {
      const discovered = await getCandidateWarehouses(scope.warehouseId);
      const list = FORCED_WAREHOUSES.length > 0 ? FORCED_WAREHOUSES : discovered;
      const unique = Array.from(new Set(list));
      if (unique.length < 2) {
        throw new Error('need at least 2 distinct warehouses with stock');
      }
      return unique.join(',');
    });
    const selected = String(candidates).split(',').map((x) => x.trim()).filter(Boolean);
    if (selected.length < 2 || selected[0] === selected[1]) {
      throw new Error('multiwarehouse selection invalid');
    }
    await createOneInStoreSale({ warehouseId: selected[0], baseCurrency, label: 'W1' });
    await createOneInStoreSale({ warehouseId: selected[1], baseCurrency, label: 'W2' });
    await must('multiwarehouse.summary', async () => `completed:${selected.slice(0, 2).join(',')}`);
  } else {
    const targetWarehouseId = FORCED_WAREHOUSE_ID || scope.warehouseId;
    await must('singlewarehouse.target', async () => targetWarehouseId);
    await createOneInStoreSale({ warehouseId: targetWarehouseId, baseCurrency, label: 'W1' });
  }
} catch (e) {
  fatalError = e;
  push('fatal', false, e?.message || String(e));
} finally {
  const cleanupList = Array.from(new Set([...(orderIdForCleanup ? [orderIdForCleanup] : []), ...orderIdsForCleanup]));
  if (!KEEP_ORDERS) {
    for (const oid of cleanupList) {
      try {
        await supabase.from('orders').delete().eq('id', oid);
      } catch {
      }
    }
  }
}

for (const r of out) {
  console.log(`${r.ok ? 'OK' : 'FAIL'} ${r.name}${r.extra ? ` | ${r.extra}` : ''}`);
}

const failed = out.filter(x => !x.ok);
process.exit(failed.length || fatalError ? 1 : 0);
