import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pmhivhtaoydfolseelyc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';
const OWNER_EMAIL = process.env.AZTA_SMOKE_OWNER_EMAIL || 'owner@azta.com';
const OWNER_PASSWORD = process.env.AZTA_SMOKE_OWNER_PASSWORD || 'AhmedZ#123456';
const IN_STORE_ZONE_ID = '11111111-1111-4111-8111-111111111111';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const tag = `live_cycle_${Date.now()}`;
const nowIso = new Date().toISOString();
const ymd = nowIso.slice(0, 10);

const report = {
  tag,
  startedAt: nowIso,
  pass: false,
  context: {},
  scenarios: [],
  errors: [],
};

const must = async (name, fn) => {
  try {
    return await fn();
  } catch (e) {
    throw new Error(`${name}: ${e?.message || String(e)}`);
  }
};

const getBaseCurrency = async () => {
  const { data, error } = await sb.from('currencies').select('code').eq('is_base', true).limit(1);
  if (error) throw error;
  return String(data?.[0]?.code || 'SAR').toUpperCase();
};

const getFx = async (code) => {
  const wanted = String(code || '').toUpperCase();
  const { data, error } = await sb.rpc('get_fx_rate_rpc', { p_currency_code: wanted });
  if (error) throw error;
  const n = Number(data || 0);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`bad fx for ${wanted}: ${String(data)}`);
  return n;
};

const ensureUom = async (code, name) => {
  const { data: found, error: fErr } = await sb.from('uom').select('id').eq('code', code).limit(1).maybeSingle();
  if (fErr) throw fErr;
  if (found?.id) return String(found.id);
  const { data, error } = await sb.from('uom').insert({ code, name }).select('id').single();
  if (error) throw error;
  return String(data.id);
};

const ensureAdminScopeAndWarehouses = async () => {
  const { data: scopeData, error: sErr } = await sb.rpc('get_admin_session_scope');
  if (sErr) throw sErr;
  const scope = Array.isArray(scopeData) ? scopeData[0] : scopeData;
  const sessionWarehouse = String(scope?.warehouse_id || scope?.warehouseId || '');
  if (!sessionWarehouse) throw new Error('session warehouse is missing');

  const { data: whRows, error: wErr } = await sb
    .from('warehouses')
    .select('id, code, is_active')
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (wErr) throw wErr;

  const all = (whRows || []).map((w) => String(w.id));
  const nonSession = all.filter((w) => w !== sessionWarehouse);
  if (nonSession.length < 2) {
    throw new Error('need at least 2 active warehouses different from session warehouse');
  }

  return {
    sessionWarehouse,
    wh1: nonSession[0],
    wh2: nonSession[1],
    allWarehouses: all,
  };
};

const createItemWithStock = async ({ warehouseId, uomId, uomCode, qtyInBase, arName, unitPrice, avgCost }) => {
  const itemId = crypto.randomUUID();
  const pieceId = await ensureUom('piece', 'Piece');

  const { error: miErr } = await sb.from('menu_items').insert({
    id: itemId,
    name: { ar: arName, en: arName },
    price: unitPrice,
    cost_price: avgCost,
    is_food: false,
    expiry_required: false,
    data: { createdFor: tag },
  });
  if (miErr) throw miErr;

  const { error: iuErr } = await sb.from('item_uom').upsert(
    {
      item_id: itemId,
      base_uom_id: pieceId,
      purchase_uom_id: pieceId,
      sales_uom_id: uomId,
    },
    { onConflict: 'item_id' }
  );
  if (iuErr) throw iuErr;

  const { error: unitsErr } = await sb.from('item_uom_units').upsert(
    [
      { item_id: itemId, uom_id: pieceId, qty_in_base: 1, is_active: true, is_default_purchase: true, is_default_sales: false },
      { item_id: itemId, uom_id: uomId, qty_in_base: qtyInBase, is_active: true, is_default_purchase: false, is_default_sales: true },
    ],
    { onConflict: 'item_id,uom_id' }
  );
  if (unitsErr) throw unitsErr;

  const { error: smErr } = await sb.from('stock_management').insert({
    item_id: itemId,
    warehouse_id: warehouseId,
    available_quantity: 500,
    reserved_quantity: 0,
    avg_cost: avgCost,
    unit: 'piece',
  });
  if (smErr) throw smErr;

  const { error: bErr } = await sb.from('batches').insert({
    id: crypto.randomUUID(),
    item_id: itemId,
    warehouse_id: warehouseId,
    batch_code: `${tag.slice(-8)}-${itemId.slice(0, 6)}`,
    quantity_received: 500,
    quantity_consumed: 0,
    quantity_transferred: 0,
    unit_cost: avgCost,
    status: 'active',
    qc_status: 'released',
    data: { createdFor: tag },
  });
  if (bErr) throw bErr;

  return { itemId, warehouseId, uomCode, uomQtyInBase: qtyInBase, unitPrice };
};

const verifyOrder = async ({ orderId, expectedCurrency, expectedWarehouses, expectedByItemQtyBase, expectPartyCredit }) => {
  const { data: order, error: oErr } = await sb
    .from('orders')
    .select('id,status,currency,fx_rate,total,base_total,party_id,data,updated_at')
    .eq('id', orderId)
    .single();
  if (oErr) throw oErr;

  const { data: mov, error: mErr } = await sb
    .from('inventory_movements')
    .select('id,item_id,warehouse_id,movement_type,quantity,qty_base,uom_id,reference_id')
    .eq('reference_table', 'orders')
    .eq('reference_id', orderId)
    .eq('movement_type', 'sale_out');
  if (mErr) throw mErr;

  const whSet = Array.from(new Set((mov || []).map((r) => String(r.warehouse_id || ''))));
  const qtyBaseByItem = {};
  for (const r of mov || []) {
    const key = String(r.item_id);
    qtyBaseByItem[key] = Number(qtyBaseByItem[key] || 0) + Number(r.qty_base || 0);
  }

  const warehouseCheck = expectedWarehouses.every((w) => whSet.includes(String(w))) && expectedWarehouses.length === whSet.length;
  const qtyChecks = Object.entries(expectedByItemQtyBase).map(([itemId, expected]) => ({
    itemId,
    expected: Number(expected),
    actual: Number(qtyBaseByItem[itemId] || 0),
    ok: Math.abs(Number(qtyBaseByItem[itemId] || 0) - Number(expected)) < 0.0001,
  }));

  const { data: orderJEs, error: jeErr } = await sb
    .from('journal_entries')
    .select('id,source_table,source_id,source_event,created_at')
    .eq('source_table', 'orders')
    .eq('source_id', orderId);
  if (jeErr) throw jeErr;

  let arCount = 0;
  let partyLedgerCount = 0;
  if (expectPartyCredit) {
    const { count: arC, error: arErr } = await sb.from('ar_open_items').select('id', { count: 'exact', head: true }).eq('order_id', orderId);
    if (arErr) throw arErr;
    arCount = Number(arC || 0);

    const jeIds = (orderJEs || []).map((x) => String(x.id));
    if (jeIds.length) {
      const { count: pleC, error: pleErr } = await sb
        .from('party_ledger_entries')
        .select('id', { count: 'exact', head: true })
        .in('journal_entry_id', jeIds);
      if (pleErr) throw pleErr;
      partyLedgerCount = Number(pleC || 0);
    }
  }

  const qtyPass = qtyChecks.every((x) => x.ok);
  return {
    order,
    saleOutRows: (mov || []).length,
    saleOutDistinctWarehouses: whSet,
    warehouseCheck,
    qtyChecks,
    qtyPass,
    orderJournalCount: (orderJEs || []).length,
    arCount,
    partyLedgerCount,
    pass:
      String(order?.status || '').toLowerCase() === 'delivered' &&
      String(order?.currency || '').toUpperCase() === String(expectedCurrency).toUpperCase() &&
      warehouseCheck &&
      qtyPass &&
      (mov || []).length >= 2,
  };
};

const payOrder = async ({ orderId, amount, currency, note }) => {
  const idempotency = `${tag}:${orderId}:cash:${Date.now()}`;
  const { error } = await sb.rpc('record_order_payment_v2', {
    p_order_id: orderId,
    p_amount: amount,
    p_method: 'cash',
    p_occurred_at: new Date().toISOString(),
    p_currency: currency,
    p_idempotency_key: idempotency,
    p_data: { smoke: true, tag, note },
  });
  if (error) throw error;

  const { data: pays, error: pErr } = await sb
    .from('payments')
    .select('id,amount,currency,method,direction,reference_id,created_at')
    .eq('reference_table', 'orders')
    .eq('reference_id', orderId)
    .eq('direction', 'in');
  if (pErr) throw pErr;

  const paymentIds = (pays || []).map((p) => String(p.id));
  let paymentJECount = 0;
  if (paymentIds.length) {
    const { count, error: jeErr } = await sb
      .from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('source_table', 'payments')
      .in('source_id', paymentIds);
    if (jeErr) throw jeErr;
    paymentJECount = Number(count || 0);
  }

  const paidSum = (pays || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);
  return {
    paymentCount: (pays || []).length,
    paymentJECount,
    paidSum,
    payments: pays || [],
  };
};

const createFinancialParty = async (currencyCode) => {
  const { data, error } = await sb
    .from('financial_parties')
    .insert({
      name: `طرف مالي اختبار ${tag.slice(-6)} ${currencyCode}`,
      party_type: 'customer',
      currency_preference: currencyCode,
      is_active: true,
      credit_limit_base: 500000,
      credit_net_days: 30,
      credit_hold: false,
    })
    .select('id')
    .single();
  if (error) throw error;
  return String(data.id);
};

const createAndRunScenario = async ({ name, currency, paymentMode, settleCredit }) => {
  const fxRate = await getFx(currency);
  const orderWarehouse = report.context.wh1;
  const uomAcode = `bx12_${tag.slice(-4)}_${name.slice(0, 3)}`.toLowerCase();
  const uomBcode = `pk6_${tag.slice(-4)}_${name.slice(0, 3)}`.toLowerCase();
  const uomA = await ensureUom(uomAcode, `Box12 ${name}`);
  const uomB = await ensureUom(uomBcode, `Pack6 ${name}`);

  const line1 = await createItemWithStock({
    warehouseId: report.context.wh1,
    uomId: uomA,
    uomCode: uomAcode,
    qtyInBase: 12,
    arName: `صنف ${name} 1 ${tag}`,
    unitPrice: 50,
    avgCost: 20,
  });
  const line2 = await createItemWithStock({
    warehouseId: report.context.wh2,
    uomId: uomB,
    uomCode: uomBcode,
    qtyInBase: 6,
    arName: `صنف ${name} 2 ${tag}`,
    unitPrice: 40,
    avgCost: 15,
  });

  const q1 = 2;
  const q2 = 3;
  const total = line1.unitPrice * q1 + line2.unitPrice * q2;
  const baseTotal = Number((total * fxRate).toFixed(6));

  let partyId = null;
  let invoiceTerms = 'cash';
  let paymentMethod = 'cash';
  if (paymentMode === 'credit') {
    partyId = await createFinancialParty(currency);
    invoiceTerms = 'credit';
    paymentMethod = 'ar';
  }

  const orderId = crypto.randomUUID();
  const payloadItems = [
    { itemId: line1.itemId, quantity: q1, uomCode: line1.uomCode, uomQtyInBase: line1.uomQtyInBase, warehouseId: line1.warehouseId },
    { itemId: line2.itemId, quantity: q2, uomCode: line2.uomCode, uomQtyInBase: line2.uomQtyInBase, warehouseId: line2.warehouseId },
  ];

  const dataOrder = {
    id: orderId,
    orderSource: 'in_store',
    warehouseId: orderWarehouse,
    deliveryZoneId: IN_STORE_ZONE_ID,
    currency,
    fxRate,
    baseTotal,
    subtotal: total,
    discountAmount: 0,
    total,
    status: 'pending',
    createdAt: nowIso,
    paymentMethod,
    invoiceTerms,
    netDays: paymentMode === 'credit' ? 30 : 0,
    dueDate: ymd,
    address: 'داخل المحل',
    customerName: `اختبار ${name} ${tag}`,
    partyId: partyId || undefined,
    items: [
      {
        id: line1.itemId,
        itemId: line1.itemId,
        quantity: q1,
        unitType: 'piece',
        price: line1.unitPrice,
        uomCode: line1.uomCode,
        uomQtyInBase: line1.uomQtyInBase,
        warehouseId: line1.warehouseId,
        selectedAddons: {},
        cartItemId: crypto.randomUUID(),
      },
      {
        id: line2.itemId,
        itemId: line2.itemId,
        quantity: q2,
        unitType: 'piece',
        price: line2.unitPrice,
        uomCode: line2.uomCode,
        uomQtyInBase: line2.uomQtyInBase,
        warehouseId: line2.warehouseId,
        selectedAddons: {},
        cartItemId: crypto.randomUUID(),
      },
    ],
  };

  const row = {
    id: orderId,
    status: 'pending',
    delivery_zone_id: IN_STORE_ZONE_ID,
    warehouse_id: orderWarehouse,
    party_id: partyId || null,
    payment_method: paymentMethod,
    invoice_terms: invoiceTerms,
    net_days: paymentMode === 'credit' ? 30 : 0,
    due_date: ymd,
    currency,
    fx_rate: fxRate,
    subtotal: total,
    total,
    base_total: baseTotal,
    data: dataOrder,
  };

  const { error: insErr } = await sb.from('orders').insert(row);
  if (insErr) throw insErr;

  const { error: invErr } = await sb.rpc('assign_invoice_number_if_missing', { p_order_id: orderId });
  if (invErr) throw invErr;

  const { error: rsErr } = await sb.rpc('reserve_stock_for_order', {
    p_items: payloadItems,
    p_order_id: orderId,
    p_warehouse_id: orderWarehouse,
  });
  if (rsErr) throw rsErr;

  const deliveredData = {
    ...dataOrder,
    status: 'delivered',
    deliveredAt: new Date().toISOString(),
  };

  const { error: cErr } = await sb.rpc('confirm_order_delivery_with_credit', {
    p_order_id: orderId,
    p_items: payloadItems,
    p_updated_data: deliveredData,
    p_warehouse_id: orderWarehouse,
  });
  if (cErr) throw cErr;

  const verifyBeforePay = await verifyOrder({
    orderId,
    expectedCurrency: currency,
    expectedWarehouses: [report.context.wh1, report.context.wh2],
    expectedByItemQtyBase: {
      [line1.itemId]: q1 * line1.uomQtyInBase,
      [line2.itemId]: q2 * line2.uomQtyInBase,
    },
    expectPartyCredit: paymentMode === 'credit',
  });

  let paymentResult = null;
  if (paymentMode === 'cash' || settleCredit) {
    paymentResult = await payOrder({
      orderId,
      amount: total,
      currency,
      note: `scenario ${name}`,
    });
  }

  const scenario = {
    name,
    orderId,
    partyId,
    currency,
    fxRate,
    baseCurrency: report.context.baseCurrency,
    paymentMode,
    sessionWarehouse: report.context.sessionWarehouse,
    lineWarehouses: [report.context.wh1, report.context.wh2],
    lines: [
      { itemId: line1.itemId, warehouseId: line1.warehouseId, uomCode: line1.uomCode, uomQtyInBase: line1.uomQtyInBase, qty: q1 },
      { itemId: line2.itemId, warehouseId: line2.warehouseId, uomCode: line2.uomCode, uomQtyInBase: line2.uomQtyInBase, qty: q2 },
    ],
    totals: { total, baseTotal },
    verifyBeforePay,
    paymentResult,
    pass: Boolean(verifyBeforePay?.pass) && (paymentResult ? paymentResult.paymentCount >= 1 : true),
  };

  if (paymentMode === 'credit') {
    scenario.creditChecks = {
      arOpenItemsPresent: (verifyBeforePay.arCount || 0) > 0,
      partyLedgerPresent: (verifyBeforePay.partyLedgerCount || 0) > 0,
      settledNow: Boolean(settleCredit),
    };
    scenario.pass = scenario.pass && scenario.creditChecks.arOpenItemsPresent && scenario.creditChecks.partyLedgerPresent;
  }

  report.scenarios.push(scenario);
};

try {
  await must('auth.signIn.owner', async () => {
    const { data, error } = await sb.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    if (error || !data.session) throw new Error(error?.message || 'login failed');
    report.context.ownerUserId = String(data.user?.id || '');
  });

  report.context.baseCurrency = await getBaseCurrency();
  Object.assign(report.context, await ensureAdminScopeAndWarehouses());

  const runScenario = async (cfg) => {
    try {
      await createAndRunScenario(cfg);
    } catch (e) {
      report.scenarios.push({
        name: cfg.name,
        currency: cfg.currency,
        paymentMode: cfg.paymentMode,
        pass: false,
        error: e?.message || String(e),
      });
    }
  };

  await runScenario({ name: 'CASH_SAR_MULTI_WH_UOM', currency: 'SAR', paymentMode: 'cash', settleCredit: false });
  await runScenario({ name: 'CREDIT_SAR_PARTY_MULTI_WH_UOM', currency: 'SAR', paymentMode: 'credit', settleCredit: true });
  await runScenario({ name: 'CASH_USD_MULTI_WH_UOM', currency: 'USD', paymentMode: 'cash', settleCredit: false });
  await runScenario({ name: 'CASH_YER_MULTI_WH_UOM', currency: 'YER', paymentMode: 'cash', settleCredit: false });

  report.pass = report.scenarios.length === 4 && report.scenarios.every((s) => s.pass);
} catch (e) {
  report.errors.push(e?.message || String(e));
  report.pass = false;
}

report.finishedAt = new Date().toISOString();
const stamp = Date.now();
const outPath = `backups/live_real_sales_cycle_${stamp}.json`;
const latestPath = 'backups/live_real_sales_cycle_latest.json';
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
console.log(outPath);
console.log(latestPath);
