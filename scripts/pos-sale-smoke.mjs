import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.AZTA_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.AZTA_SUPABASE_ANON_KEY || '').trim();

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

  const { data: rows, error } = await supabase
    .from('v_sellable_products')
    .select('id, available_quantity')
    .gt('available_quantity', 0)
    .limit(50);
  if (error) throw new Error(error.message);
  const ids = (rows || []).map(r => String(r.id)).filter(isUuid);

  if (ids.length) {
    const { data: batches, error: bErr } = await supabase
      .from('batches')
      .select('item_id, quantity_received, quantity_consumed, quantity_transferred, status')
      .eq('warehouse_id', warehouseId)
      .eq('status', 'active')
      .in('item_id', ids)
      .limit(200);
    if (bErr) throw new Error(bErr.message);
    const ok = new Set(
      (batches || [])
        .filter(b => Number(b.quantity_received || 0) - Number(b.quantity_consumed || 0) - Number(b.quantity_transferred || 0) > 0)
        .map(b => String(b.item_id))
    );
    const okIds = ids.filter(id => ok.has(id));
    if (!okIds.length) {
      // fall through to create
    } else {
    const { data: priced, error: pErr } = await supabase
      .from('menu_items')
      .select('id, price, cost_price')
        .in('id', okIds)
      .gt('price', 0)
      .order('price', { ascending: false })
      .limit(10);
    if (pErr) throw new Error(pErr.message);
    const pick = (priced || []).find(r => Number(r.price) >= Number(r.cost_price || 0));
      if (pick?.id) {
        const baseUomId = await ensureBaseUomId();
        const { error: iuErr } = await supabase.from('item_uom').upsert(
          { item_id: String(pick.id), base_uom_id: baseUomId, purchase_uom_id: baseUomId, sales_uom_id: baseUomId },
          { onConflict: 'item_id' }
        );
        if (iuErr) throw new Error(iuErr.message);
        return String(pick.id);
      }
    }
  }

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
      email: 'owner@azta.com',
      password: 'Owner@123',
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

  const itemId = await must('ensure.item+stock', async () => await ensureSellableItemWithStock(scope.warehouseId));

  const unitPrice = await must('rpc.get_item_price_with_discount', async () => {
    const { data, error } = await supabase.rpc('get_item_price_with_discount', {
      p_item_id: itemId,
      p_customer_id: null,
      p_quantity: 1,
    });
    if (error) throw new Error(error.message);
    const n = Number(data);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`bad price ${String(data)}`);
    return n;
  });

  const orderId = await must('sale.create+deliver+pay', async () => {
    const id = crypto.randomUUID();
    orderIdForCleanup = id;

    const orderData = {
      id,
      orderSource: 'in_store',
      warehouseId: scope.warehouseId,
      deliveryZoneId: IN_STORE_ZONE_ID,
      currency: baseCurrency,
      subtotal: unitPrice,
      discountAmount: 0,
      total: unitPrice,
      status: 'delivered',
      createdAt: nowIso,
      deliveredAt: nowIso,
      paidAt: nowIso,
      paymentMethod: 'card',
      invoiceTerms: 'cash',
      netDays: 0,
      dueDate: ymd,
      customerName: 'زبون حضوري',
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
      warehouse_id: scope.warehouseId,
      data: { ...orderData, status: 'pending', paidAt: undefined, deliveredAt: undefined },
    });
    if (insErr) throw new Error(insErr.message);

    const { data: invNum, error: invErr } = await supabase.rpc('assign_invoice_number_if_missing', { p_order_id: id });
    if (invErr) throw new Error(invErr.message);
    if (typeof invNum === 'string' && invNum) {
      orderData.invoiceNumber = invNum;
    }

    const { error: cErr } = await supabase.rpc('confirm_order_delivery_with_credit', {
      p_order_id: id,
      p_items: [{ itemId, quantity: 1 }],
      p_updated_data: orderData,
      p_warehouse_id: scope.warehouseId,
    });
    if (cErr) throw new Error(cErr.message);

    const { error: payErr } = await supabase.rpc('record_order_payment', {
      p_order_id: id,
      p_amount: unitPrice,
      p_method: 'card',
      p_occurred_at: nowIso,
      p_currency: baseCurrency,
      p_idempotency_key: `pos-sale:${id}:${nowIso}`,
    });
    if (payErr) throw new Error(payErr.message);

    return id;
  });

  await must('sale.verify.currency', async () => {
    const { data, error } = await supabase.from('orders').select('data,status').eq('id', orderId).maybeSingle();
    if (error) throw new Error(error.message);
    const code = String(data?.data?.currency || '').trim().toUpperCase();
    if (!code) throw new Error('currency missing in orders.data');
    const st = String(data?.status || '');
    return `${st}:${code}`;
  });
} catch {
} finally {
  if (orderIdForCleanup) {
    try {
      await supabase.from('orders').delete().eq('id', orderIdForCleanup);
    } catch {
    }
  }
}

for (const r of out) {
  console.log(`${r.ok ? 'OK' : 'FAIL'} ${r.name}${r.extra ? ` | ${r.extra}` : ''}`);
}

const failed = out.filter(x => !x.ok);
process.exit(failed.length ? 1 : 0);
