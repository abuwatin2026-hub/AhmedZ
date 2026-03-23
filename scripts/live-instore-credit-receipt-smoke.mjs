import fs from "fs";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const envText = fs.readFileSync(".env.production", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 1) continue;
  env[t.slice(0, i)] = t.slice(i + 1);
}

const SUPABASE_URL = String(env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_KEY = String(env.VITE_SUPABASE_ANON_KEY || "").trim();
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing supabase env");

const OWNER_EMAIL = process.env.AZTA_SMOKE_OWNER_EMAIL || "owner@azta.com";
const OWNER_PASSWORD = process.env.AZTA_SMOKE_OWNER_PASSWORD || "";
if (!OWNER_PASSWORD) throw new Error("missing AZTA_SMOKE_OWNER_PASSWORD");

const IN_STORE_ZONE_ID = "11111111-1111-4111-8111-111111111111";
const nowIso = new Date().toISOString();
const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const testTag = `smoke_live_${Date.now()}`;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const report = { testTag, startedAt: nowIso, steps: [], ids: {}, checks: {} };
const step = (name, ok, detail = "") => report.steps.push({ name, ok, detail });

const must = async (name, fn) => {
  try {
    const v = await fn();
    step(name, true, typeof v === "string" ? v : "OK");
    return v;
  } catch (e) {
    step(name, false, e?.message || String(e));
    throw e;
  }
};

const ensureUom = async (code, name) => {
  const { data: found } = await sb.from("uom").select("id,code").eq("code", code).limit(1).maybeSingle();
  if (found?.id) return String(found.id);
  const { data, error } = await sb.from("uom").insert({ code, name }).select("id").single();
  if (error) throw error;
  return String(data.id);
};

const ensureWarehouses = async () => {
  const { data, error } = await sb.from("warehouses").select("id, code, company_id, branch_id, is_active").eq("is_active", true).order("created_at", { ascending: true }).limit(10);
  if (error) throw error;
  const rows = data || [];
  if (rows.length >= 2) return [String(rows[0].id), String(rows[1].id)];
  const { data: c } = await sb.from("companies").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
  const { data: b } = await sb.from("branches").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!c?.id || !b?.id) throw new Error("missing default company/branch for warehouse creation");
  const insertPayload = {
    code: `SMK-${String(Date.now()).slice(-6)}`,
    name: `Smoke WH ${String(Date.now()).slice(-4)}`,
    type: "branch",
    is_active: true,
    company_id: c.id,
    branch_id: b.id,
  };
  const { data: ins, error: iErr } = await sb.from("warehouses").insert(insertPayload).select("id").single();
  if (iErr) throw iErr;
  if (!rows.length) return [String(ins.id), String(ins.id)];
  return [String(rows[0].id), String(ins.id)];
};

const createItemWithStockAndUom = async ({ warehouseId, altUomId, altUomCode, altQtyInBase, arName }) => {
  const itemId = crypto.randomUUID();
  const sku = `SMK-${itemId.slice(0, 8)}`;
  const { error: miErr } = await sb.from("menu_items").insert({
    id: itemId,
    name: { ar: arName, en: arName },
    price: 10,
    cost_price: 4,
    is_food: false,
    expiry_required: false,
    data: { createdFor: testTag, sku },
  });
  if (miErr) throw miErr;

  const pieceId = await ensureUom("piece", "Piece");
  const { error: iuErr } = await sb.from("item_uom").upsert({
    item_id: itemId,
    base_uom_id: pieceId,
    purchase_uom_id: pieceId,
    sales_uom_id: altUomId,
  }, { onConflict: "item_id" });
  if (iuErr) throw iuErr;

  const { error: unitsErr } = await sb.from("item_uom_units").upsert([
    { item_id: itemId, uom_id: pieceId, qty_in_base: 1, is_active: true, is_default_purchase: true, is_default_sales: false },
    { item_id: itemId, uom_id: altUomId, qty_in_base: altQtyInBase, is_active: true, is_default_purchase: false, is_default_sales: true },
  ], { onConflict: "item_id,uom_id" });
  if (unitsErr) throw unitsErr;

  const { error: smErr } = await sb.from("stock_management").insert({
    item_id: itemId,
    warehouse_id: warehouseId,
    available_quantity: 200,
    reserved_quantity: 0,
    avg_cost: 4,
    unit: "piece",
  });
  if (smErr) throw smErr;

  const { error: bErr } = await sb.from("batches").insert({
    id: crypto.randomUUID(),
    item_id: itemId,
    warehouse_id: warehouseId,
    batch_code: `B-${itemId.slice(0, 6)}`,
    quantity_received: 200,
    quantity_consumed: 0,
    quantity_transferred: 0,
    unit_cost: 4,
    status: "active",
    qc_status: "released",
    data: { createdFor: testTag },
  });
  if (bErr) throw bErr;

  return { itemId, altUomCode, altQtyInBase, unitPrice: 10 };
};

try {
  await must("auth.signIn.owner", async () => {
    const { data, error } = await sb.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    if (error || !data.session) throw new Error(error?.message || "no session");
    return String(data.user?.id || "ok");
  });

  const [wh1, wh2] = await must("prepare.two.warehouses", ensureWarehouses);
  report.ids.warehouse1 = wh1;
  report.ids.warehouse2 = wh2;

  const box12Id = await must("ensure.uom.box12", async () => await ensureUom("box12", "Box 12"));
  const pack6Id = await must("ensure.uom.pack6", async () => await ensureUom("pack6", "Pack 6"));

  const item1 = await must("create.item1.wh1.box12", async () => await createItemWithStockAndUom({ warehouseId: wh1, altUomId: box12Id, altUomCode: "box12", altQtyInBase: 12, arName: `دخان صنف 1 ${testTag}` }));
  const item2 = await must("create.item2.wh2.pack6", async () => await createItemWithStockAndUom({ warehouseId: wh2, altUomId: pack6Id, altUomCode: "pack6", altQtyInBase: 6, arName: `دخان صنف 2 ${testTag}` }));
  report.ids.item1 = item1.itemId;
  report.ids.item2 = item2.itemId;

  const { data: baseCurRows } = await sb.from("currencies").select("code").eq("is_base", true).limit(1);
  const currency = String(baseCurRows?.[0]?.code || "YER").toUpperCase();
  report.checks.currency = currency;

  const { data: party, error: partyErr } = await sb.from("financial_parties").insert({
    name: `طرف دخان ${testTag}`,
    party_type: "generic",
    currency_preference: currency,
    is_active: true,
    credit_limit_base: 100000,
    credit_net_days: 30,
    credit_hold: false,
  }).select("id").single();
  if (partyErr) throw partyErr;
  report.ids.partyId = String(party.id);
  step("create.financial.party", true, String(party.id));

  const qty1 = 2;
  const qty2 = 3;
  const total1 = item1.unitPrice * qty1;
  const total2 = item2.unitPrice * qty2;
  const grand = total1 + total2;

  const orderId = crypto.randomUUID();
  report.ids.orderId = orderId;

  const pendingData = {
    id: orderId,
    orderSource: "in_store",
    warehouseId: wh1,
    deliveryZoneId: IN_STORE_ZONE_ID,
    currency,
    subtotal: grand,
    discountAmount: 0,
    total: grand,
    status: "pending",
    createdAt: nowIso,
    customerName: `عميل دخان ${testTag}`,
    phoneNumber: "",
    address: "داخل المحل",
    paymentMethod: "ar",
    invoiceTerms: "credit",
    netDays: 30,
    dueDate,
    partyId: String(party.id),
    items: [
      { id: item1.itemId, itemId: item1.itemId, quantity: qty1, price: item1.unitPrice, unitType: "piece", uomCode: item1.altUomCode, uomQtyInBase: item1.altQtyInBase, warehouseId: wh1, selectedAddons: {}, cartItemId: crypto.randomUUID() },
      { id: item2.itemId, itemId: item2.itemId, quantity: qty2, price: item2.unitPrice, unitType: "piece", uomCode: item2.altUomCode, uomQtyInBase: item2.altQtyInBase, warehouseId: wh2, selectedAddons: {}, cartItemId: crypto.randomUUID() },
    ],
  };

  const { error: insErr } = await sb.from("orders").insert({
    id: orderId,
    status: "pending",
    delivery_zone_id: IN_STORE_ZONE_ID,
    warehouse_id: wh1,
    party_id: String(party.id),
    payment_method: "ar",
    invoice_terms: "credit",
    net_days: 30,
    due_date: dueDate,
    currency,
    total: grand,
    subtotal: grand,
    data: pendingData,
  });
  if (insErr) throw insErr;
  step("order.pending.insert", true, orderId);

  const reserveItems = [
    { itemId: item1.itemId, quantity: qty1, uomCode: item1.altUomCode, uomQtyInBase: item1.altQtyInBase, warehouseId: wh1 },
    { itemId: item2.itemId, quantity: qty2, uomCode: item2.altUomCode, uomQtyInBase: item2.altQtyInBase, warehouseId: wh2 },
  ];

  const { error: rsErr } = await sb.rpc("reserve_stock_for_order", {
    p_items: reserveItems,
    p_order_id: orderId,
    p_warehouse_id: wh1,
  });
  if (rsErr) throw rsErr;
  step("order.reserve.stock", true, "reserved");

  const deliveredData = {
    ...pendingData,
    status: "delivered",
    deliveredAt: nowIso,
    paymentMethod: "ar",
    invoiceTerms: "credit",
    netDays: 30,
    dueDate,
    partyId: String(party.id),
  };

  const { error: confErr } = await sb.rpc("confirm_order_delivery_with_credit", {
    p_order_id: orderId,
    p_items: reserveItems,
    p_updated_data: deliveredData,
    p_warehouse_id: wh1,
  });
  if (confErr) throw confErr;
  step("order.confirm.delivery.credit", true, "delivered");

  const { data: orderAfterDel, error: oErr } = await sb.from("orders").select("id,status,data,total").eq("id", orderId).single();
  if (oErr) throw oErr;
  report.checks.afterDeliveryStatus = orderAfterDel.status;
  report.checks.afterDeliveryPaidAt = orderAfterDel?.data?.paidAt || null;

  const payAmount = Number(orderAfterDel.total || grand);
  const idempotency = `smoke-receipt:${orderId}:${Date.now()}`;
  const { error: payErr } = await sb.rpc("record_order_payment_v2", {
    p_order_id: orderId,
    p_amount: payAmount,
    p_method: "card",
    p_occurred_at: new Date().toISOString(),
    p_currency: currency,
    p_idempotency_key: idempotency,
    p_data: { smoke: true, testTag, note: "receipt voucher settlement" },
  });
  if (payErr) throw payErr;
  step("payment.receipt.record_order_payment_v2", true, `amount=${payAmount}`);

  const { data: payRows, error: prErr } = await sb
    .from("payments")
    .select("id,amount,currency,method,direction,reference_id,created_at")
    .eq("reference_table", "orders")
    .eq("reference_id", orderId)
    .eq("direction", "in")
    .order("created_at", { ascending: true });
  if (prErr) throw prErr;
  const paidSum = (payRows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  report.checks.paymentsCount = (payRows || []).length;
  report.checks.paymentsSum = paidSum;
  report.checks.orderTotal = Number(orderAfterDel.total || grand);
  report.checks.outstanding = Number((orderAfterDel.total || grand) - paidSum);

  const { data: mvRows, error: mvErr } = await sb
    .from("inventory_movements")
    .select("id,movement_type,reference_id,warehouse_id,item_id,quantity,qty_base,uom_id")
    .eq("reference_table", "orders")
    .eq("reference_id", orderId)
    .eq("movement_type", "sale_out");
  if (mvErr) throw mvErr;
  const whSet = new Set((mvRows || []).map((x) => String(x.warehouse_id || "")));
  report.checks.saleOutRows = (mvRows || []).length;
  report.checks.saleOutDistinctWarehouses = Array.from(whSet);

  const paymentIds = (payRows || []).map((p) => String(p.id));
  let paymentJournalCount = 0;
  if (paymentIds.length) {
    const { data: jePay, error: jePayErr } = await sb
      .from("journal_entries")
      .select("id,source_table,source_id")
      .eq("source_table", "payments")
      .in("source_id", paymentIds);
    if (jePayErr) throw jePayErr;
    paymentJournalCount = (jePay || []).length;
  }
  const { data: jeOrd, error: jeOrdErr } = await sb
    .from("journal_entries")
    .select("id,source_table,source_id,source_event")
    .eq("source_table", "orders")
    .eq("source_id", orderId);
  if (jeOrdErr) throw jeOrdErr;
  report.checks.orderJournalCount = (jeOrd || []).length;
  report.checks.paymentJournalCount = paymentJournalCount;

  const { data: orderAfterPay, error: o2Err } = await sb.from("orders").select("status,data").eq("id", orderId).single();
  if (o2Err) throw o2Err;
  report.checks.afterPaymentStatus = orderAfterPay.status;
  report.checks.afterPaymentPaidAt = orderAfterPay?.data?.paidAt || null;

  report.ids.paymentIds = paymentIds;
  report.ids.orderJournalIds = (jeOrd || []).map((x) => String(x.id));

  report.pass = String(orderAfterDel.status) === "delivered"
    && (mvRows || []).length >= 2
    && whSet.size >= 2
    && (payRows || []).length >= 1
    && Math.abs(Number(orderAfterDel.total || grand) - paidSum) < 0.0001;
} catch (e) {
  report.pass = false;
  report.error = e?.message || String(e);
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync("backups/live_instore_credit_receipt_smoke_report.json", JSON.stringify(report, null, 2));
  console.log("backups/live_instore_credit_receipt_smoke_report.json");
}
