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

try {
  await must('auth.owner.signIn', async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'owner@azta.com',
      password: 'Owner@123',
    });
    if (error || !data.session) throw new Error(error?.message || 'no session');
    return data.user?.id;
  });

  const scope = await must('rpc.get_admin_session_scope', async () => {
    const { data, error } = await supabase.rpc('get_admin_session_scope');
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    const warehouseId = row?.warehouse_id || row?.warehouseId;
    if (!warehouseId) throw new Error('warehouse_id missing');
    return { warehouseId: String(warehouseId) };
  });

  const baseCurrency = await must('baseCurrency', async () => {
    const { data, error } = await supabase.from('currencies').select('code').eq('is_base', true).limit(1);
    if (error) throw new Error(error.message);
    return String(data?.[0]?.code || 'YER').toUpperCase();
  });

  const itemId = await must('pick.item', async () => {
    const { data: rows, error } = await supabase
      .from('v_sellable_products')
      .select('id, available_quantity')
      .gt('available_quantity', 0)
      .limit(50);
    if (error) throw new Error(error.message);
    const ids = (rows || []).map(r => String(r.id));
    if (!ids.length) throw new Error('no sellable item with stock');

    const { data: priced, error: pErr } = await supabase
      .from('menu_items')
      .select('id, price, cost_price')
      .in('id', ids)
      .gt('price', 0)
      .order('price', { ascending: false })
      .limit(10);
    if (pErr) throw new Error(pErr.message);
    const pick = (priced || []).find(r => Number(r.price) >= Number(r.cost_price || 0));
    if (!pick?.id) throw new Error('no in-stock item with price >= cost');
    return String(pick.id);
  });

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
      paymentMethod: 'cash',
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
      p_method: 'cash',
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

