// ================================================================
// اختبار دخان E2E: بيع حضوري آجل → مراجعة لتعدد المستودعات
// ================================================================
const { Client } = require('pg');
const connectionString = 'postgresql://postgres.pmhivhtaoydfolseelyc:AhmadZangah1%23123455@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';
const client = new Client({ connectionString });

async function sql(q) {
  const r = await client.query(q);
  return r.rows || [];
}

const L = (m) => console.log(`  ${m}`);
const S = (n, m) => console.log(`\n━━━ ${n}. ${m} ━━━`);
const ar = (j) => j?.ar || j || '';

async function main() {
  await client.connect();
  
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   اختبار دخان E2E: بيع حضوري (تعدد مستودعات فعلي)     ║');
  console.log(`║   ${new Date().toISOString().slice(0,19)}                         ║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  S(0,'استكشاف أصناف متوافقة تماماً مع شروط الحجز FEFO');

  const whs = await sql(`SELECT id::text, name FROM warehouses ORDER BY name`);
  const whSharka = whs.find(w=>JSON.stringify(w.name).includes('مستودع الشركة') || JSON.stringify(w.name).includes('الكترونيات'));
  const whRaisi  = whs.find(w=>JSON.stringify(w.name).includes('رئيسي') && w.id !== whSharka?.id);
  
  const rules = `
    AND greatest(coalesce(bb.quantity_received,0) - coalesce(bb.quantity_consumed,0), 0) > 1 
    AND sm.available_quantity > 1
    AND bb.status = 'active' AND coalesce(bb.qc_status, 'released') = 'released'
    AND (
      (SELECT coalesce(mi.category,'') FROM menu_items mi WHERE mi.id::text = bb.item_id::text) != 'food'
      OR (bb.expiry_date IS NOT NULL AND bb.expiry_date >= current_date)
    )
    AND NOT EXISTS (SELECT 1 FROM batch_recalls br WHERE br.batch_id = bb.id AND br.status = 'active')
  `;

  const cand1 = await sql(`
    SELECT DISTINCT ON (bb.item_id)
      bb.item_id::text, bb.id::text as batch_id, bb.warehouse_id::text,
      greatest(coalesce(bb.quantity_received,0) - coalesce(bb.quantity_consumed,0), 0) as batch_qty,
      sm.available_quantity,
      (SELECT mi.name FROM menu_items mi WHERE mi.id::text=bb.item_id::text) as name
    FROM batches bb
    JOIN stock_management sm ON sm.item_id::text=bb.item_id::text AND sm.warehouse_id=bb.warehouse_id
    WHERE bb.warehouse_id='${whSharka?.id || whs[1]?.id}' ${rules}
    ORDER BY bb.item_id, greatest(coalesce(bb.quantity_received,0) - coalesce(bb.quantity_consumed,0), 0) DESC
    LIMIT 1
  `);
  const c1 = cand1[0];
  if(!c1) throw new Error('لا يوجد صنف 1 متوفر');

  const cand2 = await sql(`
    SELECT DISTINCT ON (bb.item_id)
      bb.item_id::text, bb.id::text as batch_id, bb.warehouse_id::text,
      greatest(coalesce(bb.quantity_received,0) - coalesce(bb.quantity_consumed,0), 0) as batch_qty,
      sm.available_quantity,
      (SELECT mi.name FROM menu_items mi WHERE mi.id::text=bb.item_id::text) as name
    FROM batches bb
    JOIN stock_management sm ON sm.item_id::text=bb.item_id::text AND sm.warehouse_id=bb.warehouse_id
    WHERE bb.warehouse_id='${whRaisi?.id || whs[0]?.id}' AND bb.warehouse_id != '${c1.warehouse_id}' ${rules}
    ORDER BY bb.item_id, greatest(coalesce(bb.quantity_received,0) - coalesce(bb.quantity_consumed,0), 0) DESC
    LIMIT 1
  `);
  const c2 = cand2[0];
  if(!c2) throw new Error('لا يوجد صنف 2 متوفر');

  const name1 = ar(c1.name), name2 = ar(c2.name);
  const company = (await sql(`SELECT id::text FROM companies LIMIT 1`))[0];
  const branch  = (await sql(`SELECT id::text FROM branches LIMIT 1`))[0];
  const realUser = (await sql(`SELECT id::text FROM auth.users LIMIT 1`))[0] || {id: 'cefc9b2c-6ca5-4d2b-ae3d-71b53e7bf9d6'};
  const realUserId = realUser.id;

  L(`✅ صنف 1: ${name1?.slice(0,35)} | id=${c1.warehouse_id?.slice(0,8)} | batch=${c1.batch_id?.slice(0,8)}`);
  L(`✅ صنف 2: ${name2?.slice(0,35)} | id=${c2.warehouse_id?.slice(0,8)} | batch=${c2.batch_id?.slice(0,8)}`);
  L(`✅ Mock User: ${realUserId}`);

  S(1,'تجهيز الطلب');
  const orderId = 'a1fbd91a-0000-4000-a000-000000000010';
  await sql(`DELETE FROM orders WHERE id='${orderId}'`).catch(()=>null);

  await sql(`
    INSERT INTO orders(id, status, invoice_number, total, subtotal, payment_method, 
      invoice_terms, net_days, company_id, branch_id, warehouse_id, data, created_at, updated_at) 
    VALUES(
      '${orderId}', 'pending', 'TEST-MULTI', 25, 25, 'cash', 
      'cash', 0, '${company.id}', '${branch.id}', '${c1.warehouse_id}', '{"orderSource": "in_store"}'::jsonb, now(), now()
    )
  `);

  const itemsJSON = JSON.stringify([
    { itemId: c1.item_id, quantity: 1, batchId: c1.batch_id, warehouseId: c1.warehouse_id },
    { itemId: c2.item_id, quantity: 1, batchId: c2.batch_id, warehouseId: c2.warehouse_id },
  ]);

  S(2,'تأكيد التسليم!');

  L('⚡ reserve_stock_for_order ...');
  await sql(`
    BEGIN;
    set local role authenticated;
    set local "request.jwt.claims" to '{"sub": "${realUserId}", "role": "authenticated"}';
    SELECT public.reserve_stock_for_order('${itemsJSON}'::jsonb, '${orderId}'::uuid, '${c1.warehouse_id}'::uuid);
    COMMIT;
  `);
  L('✅ تم حجز المخزون أوتوماتيكياً!');

  L('⚡ deduct_stock_on_delivery_v2 ...');
  await sql(`
    BEGIN;
    set local role authenticated;
    set local "request.jwt.claims" to '{"sub": "${realUserId}", "role": "authenticated"}';
    SELECT public.deduct_stock_on_delivery_v2('${orderId}'::uuid, '${itemsJSON}'::jsonb, '${c1.warehouse_id}'::uuid);
    COMMIT;
  `);
  L('✅ تم سحب المخزون والإصدار!');

  S(3,'مراجعة حركات المخزون الفعلية (COGS & Movement)');

  const movs = await sql(`SELECT item_id::text, warehouse_id::text, batch_id::text, movement_type, quantity FROM inventory_movements WHERE reference_id='${orderId}'`);
  movs.forEach(m => L(`📦 Movement: Item=${m.item_id?.slice(0,8)} | Warehouse=${m.warehouse_id?.slice(0,8)} | Batch=${m.batch_id?.slice(0,8)} | Qty=${m.quantity}`));

  if (movs.length === 2 && movs[0].warehouse_id !== movs[1].warehouse_id) {
    console.log('\n✅ PASS — الخادم تعامل مع مستودعين مختلفين في فاتورة واحدة بنجاح!');
  } else {
    console.log('\n❌ FAIL — الحركات لا تعكس مستودعين مختلفين!');
  }

  // Clean
  await sql(`DELETE FROM inventory_movements WHERE reference_id='${orderId}'`);
  await sql(`DELETE FROM order_item_reservations WHERE order_id='${orderId}'`);
  await sql(`DELETE FROM order_item_cogs WHERE order_id='${orderId}'`);
  await sql(`DELETE FROM orders WHERE id='${orderId}'`);
  
  await client.end();
}

main().catch(async (e) => { 
  console.error('\n❌ Error:', e.message); 
  try { await client.query(`DELETE FROM orders WHERE id='a1fbd91a-0000-4000-a000-000000000010'`); await client.end(); } catch(ex){}
  process.exit(1); 
});
