import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.AZTA_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.AZTA_SUPABASE_ANON_KEY || '').trim();
const OWNER_EMAIL = (process.env.AZTA_SMOKE_OWNER_EMAIL || 'owner@azta.com').trim();
const OWNER_PASSWORD = (process.env.AZTA_SMOKE_OWNER_PASSWORD || 'Owner@123').trim();
const KEEP_ORDER = ['1', 'true', 'yes'].includes(String(process.env.AZTA_SMOKE_KEEP_ORDER || '').trim().toLowerCase());
const CREDIT_LIMIT = Number(process.env.AZTA_SMOKE_CREDIT_LIMIT || 500000);

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
    name: { ar: 'منتج دخان أجل', en: 'Credit Smoke Item' },
    price: 100,
    cost_price: 10,
    is_food: false,
    expiry_required: false,
    data: { group: 'SMOKE', createdFor: 'credit-smoke-test' },
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
    batch_code: `CREDIT-${itemId.slice(0, 8)}`,
    quantity_received: 50,
    quantity_consumed: 0,
    quantity_transferred: 0,
    unit_cost: 10,
    status: 'active',
    qc_status: 'released',
    data: { createdFor: 'credit-smoke-test' },
  });
  if (batchErr) throw new Error(batchErr.message);

  return itemId;
};

const createWholesaleCustomerWithCredit = async (fullName, phone, creditLimit) => {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token || '';
  if (!accessToken) throw new Error('no access token');

  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'x-user-token': accessToken };
  const result = await supabase.functions.invoke('create-admin-customer', {
    body: { fullName, phone, customerType: 'wholesale', creditLimit },
    headers,
  });
  if (result.error) {
    const msg = String((result.error).message || '');
    throw new Error(msg || 'create-admin-customer failed');
  }
  const customer = (result.data || {}).customer || null;
  if (!customer?.auth_user_id) throw new Error('create-admin-customer returned no customer');
  return String(customer.auth_user_id);
};

const findExistingWholesaleCustomer = async () => {
  const { data, error } = await supabase
    .from('customers')
    .select('auth_user_id, customer_type, credit_limit')
    .eq('customer_type', 'wholesale')
    .gt('credit_limit', 0)
    .limit(1);
  if (error) throw new Error(error.message);
  const c = (data || [])[0];
  return c?.auth_user_id ? String(c.auth_user_id) : null;
};

const findAnyCustomer = async () => {
  const { data, error } = await supabase
    .from('customers')
    .select('auth_user_id, customer_type, credit_limit')
    .limit(1);
  if (error) throw new Error(error.message);
  const c = (data || [])[0];
  return c?.auth_user_id ? String(c.auth_user_id) : null;
};

const promoteCustomerToWholesaleWithCredit = async (customerId, creditLimit) => {
  const { error } = await supabase
    .from('customers')
    .update({ customer_type: 'wholesale', credit_limit: Number(creditLimit) || 1000, payment_terms: 'net_30' })
    .eq('auth_user_id', customerId);
  if (error) throw new Error(error.message);
  return customerId;
};

const ensureOwnerCustomerWholesaleWithCredit = async (creditLimit) => {
  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw new Error(uErr.message);
  const ownerId = String(u?.user?.id || '');
  if (!ownerId) throw new Error('no auth user id');
  const { error: upErr } = await supabase
    .from('customers')
    .upsert({
      auth_user_id: ownerId,
      full_name: 'اختبار جملة',
      phone_number: null,
      customer_type: 'wholesale',
      payment_terms: 'net_30',
      credit_limit: Number(creditLimit) || 1000,
      current_balance: 0,
      data: { createdFor: 'credit-smoke-test' },
    }, { onConflict: 'auth_user_id' });
  if (upErr) throw new Error(upErr.message);
  return ownerId;
};

const createCustomerViaSignUpAndInsert = async (fullName, phone, creditLimit) => {
  const email = `manual-${crypto.randomUUID()}@azta.com`;
  const password = 'Test@12345';
  const { data: signup, error: sErr } = await supabase.auth.signUp({ email, password });
  if (sErr) throw new Error(sErr.message);
  const newUserId = String(signup?.user?.id || '');
  if (!newUserId || !signup.session) {
    throw new Error('signUp did not return session');
  }
  const { error: insErr } = await supabase
    .from('customers')
    .insert({
      auth_user_id: newUserId,
      full_name: fullName || null,
      phone_number: phone,
      customer_type: 'wholesale',
      payment_terms: 'net_30',
      credit_limit: Number(creditLimit) || 1000,
      current_balance: 0,
      data: { isManual: true, createdFor: 'credit-smoke-test' },
    });
  if (insErr) throw new Error(insErr.message);
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  const { data, error } = await supabase.auth.signInWithPassword({
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
  });
  if (error || !data.session) throw new Error(error?.message || 'owner re-login failed');
  return newUserId;
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

  const itemId = await must('ensure.item+stock', async () => await ensureSellableItemWithStock(scope.warehouseId));

  const unitPrice = await must('rpc.get_item_price_with_discount', async () => {
    const { data, error } = await supabase.rpc('get_item_price_with_discount', {
      p_item_id: itemId,
      p_customer_id: null,
      p_quantity: 1,
    });
    if (error) {
      const msg = String(error.message || '');
      if (!msg.includes('Could not choose the best candidate function')) {
        throw new Error(msg);
      }
      const { data: menuItem, error: mErr } = await supabase
        .from('menu_items')
        .select('price')
        .eq('id', itemId)
        .maybeSingle();
      if (mErr) throw new Error(mErr.message);
      const fallback = Number(menuItem?.price || 0);
      if (!Number.isFinite(fallback) || fallback <= 0) {
        throw new Error(`bad fallback price ${String(menuItem?.price)}`);
      }
      return fallback;
    }
    const n = Number(data);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`bad price ${String(data)}`);
    return n;
  });

  const customerId = await must('customer.create_or_pick', async () => {
    const phoneSuffix = String(Math.floor(Math.random() * 900000) + 100000);
    const fullName = `عميل جملة دخان ${phoneSuffix}`;
    const phone = `777${phoneSuffix}`;
    try {
      try {
        return await createWholesaleCustomerWithCredit(fullName, phone, CREDIT_LIMIT);
      } catch {
        return await createCustomerViaSignUpAndInsert(fullName, phone, CREDIT_LIMIT);
      }
    } catch {
      const existing = await findExistingWholesaleCustomer();
      if (existing) return existing;
      const any = await findAnyCustomer();
      if (!any) {
        return await ensureOwnerCustomerWholesaleWithCredit(CREDIT_LIMIT);
      }
      return await promoteCustomerToWholesaleWithCredit(any, CREDIT_LIMIT);
    }
  });

  const orderId = await must('creditSale.create+deliver', async () => {
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
      paidAt: undefined,
      paymentMethod: 'ar',
      invoiceTerms: 'credit',
      creditOverrideReason: 'اختبار بيع حضوري آجل على الإنتاج',
      netDays: 30,
      dueDate: ymd,
      customerId,
      customerName: 'عميل جملة دخان',
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
      customer_auth_user_id: customerId,
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

    return id;
  });

  await must('creditSale.verify.order_status_terms', async () => {
    const { data, error } = await supabase.from('orders').select('status, invoice_terms, net_days, due_date, data').eq('id', orderId).maybeSingle();
    if (error) throw new Error(error.message);
    const st = String(data?.status || data?.data?.status || '');
    if (st !== 'delivered') throw new Error(`expected delivered, got ${st}`);
    const terms = String(data?.invoice_terms || '').trim();
    if (terms !== 'credit') throw new Error(`expected invoice_terms=credit, got ${terms || 'N/A'}`);
    const nd = Number(data?.net_days || 0);
    if (nd < 0) throw new Error(`bad net_days ${nd}`);
    const dd = String(data?.due_date || '');
    if (!dd) throw new Error('missing due_date');
    return `${st}:${terms}:${nd}:${dd}`;
  });

  await must('creditSale.verify.customer_summary', async () => {
    const { data: summary, error } = await supabase.rpc('get_customer_credit_summary', { p_customer_id: customerId });
    if (error) throw new Error(error.message);
    const cur = Number(summary?.current_balance || 0);
    const lim = Number(summary?.credit_limit || 0);
    const avail = Number(summary?.available_credit || 0);
    if (!Number.isFinite(cur) || !Number.isFinite(lim) || !Number.isFinite(avail)) throw new Error('bad summary numbers');
    if (lim <= 0) throw new Error('credit_limit must be > 0');
    if (cur <= 0) throw new Error('current_balance should increase after credit sale');
    return `balance=${cur.toFixed(2)} limit=${lim.toFixed(2)} avail=${avail.toFixed(2)}`;
  });
  
  await must('creditSale.verify.operational_postings', async () => {
    const { data: order, error: oErr } = await supabase
      .from('orders')
      .select('id, party_id, status')
      .eq('id', orderId)
      .maybeSingle();
    if (oErr) throw new Error(oErr.message);
    if (!order?.id) throw new Error('order not found');
    if (String(order.status || '').toLowerCase() !== 'delivered') {
      throw new Error(`order not delivered (${String(order.status || 'unknown')})`);
    }

    const { count: saleOutCount, error: sErr } = await supabase
      .from('inventory_movements')
      .select('id', { count: 'exact', head: true })
      .eq('reference_table', 'orders')
      .eq('reference_id', orderId)
      .eq('movement_type', 'sale_out');
    if (sErr) throw new Error(sErr.message);
    if ((saleOutCount || 0) < 1) throw new Error('missing sale_out movement');

    const { data: entries, error: jeErr } = await supabase
      .from('journal_entries')
      .select('id')
      .eq('source_table', 'orders')
      .eq('source_id', orderId)
      .in('source_event', ['invoiced', 'delivered']);
    if (jeErr) throw new Error(jeErr.message);
    if (!Array.isArray(entries) || entries.length < 1) throw new Error('missing journal entry');

    const { count: arCount, error: arErr } = await supabase
      .from('ar_open_items')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId);
    if (arErr) throw new Error(arErr.message);
    if ((arCount || 0) < 1) throw new Error('missing ar_open_item');

    const jeIds = entries.map((e) => String(e.id));
    const { count: pleCount, error: pleErr } = await supabase
      .from('party_ledger_entries')
      .select('id', { count: 'exact', head: true })
      .in('journal_entry_id', jeIds);
    if (pleErr) throw new Error(pleErr.message);
    if ((pleCount || 0) < 1) throw new Error('missing party_ledger_entries');

    return `sale_out=${saleOutCount || 0} je=${entries.length} ar=${arCount || 0} ple=${pleCount || 0}`;
  });
} catch (e) {
  fatalError = e;
  push('fatal', false, e?.message || String(e));
} finally {
  if (orderIdForCleanup && !KEEP_ORDER) {
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
process.exit(failed.length || fatalError ? 1 : 0);
