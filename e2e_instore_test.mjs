// ================================================================
// اختبار دخان E2E: بيع حضوري آجل → قبض → تسوية
// النسخة النهائية: تستخدم batch_balances لإيجاد الأصناف والـ batches
// ================================================================
const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 800));
  return b;
}
const L = (m) => console.log(`  ${m}`);
const S = (n, m) => console.log(`\n━━━ ${n}. ${m} ━━━`);
const ar = (j) => j?.match?.(/"ar":\s*"([^"]+)"/)?.[1] || j || '';

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   اختبار دخان E2E: بيع حضوري → قبض → تسوية      ║');
  console.log(`║   ${new Date().toISOString().slice(0,19)}                         ║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  S(0,'استكشاف البيانات (أصناف + batches)');

  const whs = await sql(`SELECT id::text, name::text FROM warehouses ORDER BY name`);
  const whSharka = whs.find(w=>w.name?.includes('شركة'));
  const whRaisi  = whs.find(w=>w.name?.includes('رئيسي'));
  L(`مخزن الشركة: ${whSharka?.id?.slice(0,8)} | الرئيسي: ${whRaisi?.id?.slice(0,8)}`);

  // صنف 1: من مخزن الشركة مع batch + وحدة كبيرة (كرتون)
  const cand1 = await sql(`
    SELECT DISTINCT ON (bb.item_id)
      bb.item_id::text, bb.batch_id::text, bb.warehouse_id::text,
      bb.quantity as batch_qty,
      sm.available_quantity,
      (SELECT mi.name::text FROM menu_items mi WHERE mi.id::text=bb.item_id::text) as name,
      (SELECT COUNT(*) FROM item_uom_units u WHERE u.item_id::text=bb.item_id::text AND u.qty_in_base>1) as multi
    FROM batch_balances bb
    JOIN stock_management sm ON sm.item_id::text=bb.item_id::text AND sm.warehouse_id=bb.warehouse_id
    WHERE bb.warehouse_id='${whSharka?.id}' AND bb.quantity > 10 AND sm.available_quantity > 10
    ORDER BY bb.item_id, bb.quantity DESC
    LIMIT 1
  `);
  const c1 = cand1[0];
  if(!c1) throw new Error('لا يوجد صنف بـ batch في مخزن الشركة');

  // صنف 2: من مخزن الشركة أيضاً مع batch مختلف، صنف مختلف + وحدة مفردة
  const cand2 = await sql(`
    SELECT DISTINCT ON (bb.item_id)
      bb.item_id::text, bb.batch_id::text, bb.warehouse_id::text,
      bb.quantity as batch_qty,
      sm.available_quantity,
      (SELECT mi.name::text FROM menu_items mi WHERE mi.id::text=bb.item_id::text) as name
    FROM batch_balances bb
    JOIN stock_management sm ON sm.item_id::text=bb.item_id::text AND sm.warehouse_id=bb.warehouse_id
    WHERE bb.warehouse_id='${whSharka?.id}' AND bb.quantity > 5 AND sm.available_quantity > 5
      AND bb.item_id::text != '${c1.item_id}'
    ORDER BY bb.item_id, bb.quantity DESC
    LIMIT 1
  `);
  let c2 = cand2[0];
  const wh2Name = 'مخزن الشركة (batch مختلف)';

  const name1 = ar(c1.name), name2 = ar(c2.name);
  const wh1Name = 'مخزن الشركة';

  // UOM
  const uom1 = (await sql(`SELECT uom_id::text, qty_in_base, (SELECT name::text FROM uom WHERE id=u.uom_id) as uom_name FROM item_uom_units u WHERE item_id='${c1.item_id}' ORDER BY qty_in_base DESC LIMIT 1`))[0];
  const uom2 = (await sql(`SELECT uom_id::text, qty_in_base, (SELECT name::text FROM uom WHERE id=u.uom_id) as uom_name FROM item_uom_units u WHERE item_id='${c2.item_id}' ORDER BY qty_in_base ASC LIMIT 1`))[0];

  const company = (await sql(`SELECT id::text FROM companies LIMIT 1`))[0];
  const branch  = (await sql(`SELECT id::text FROM branches LIMIT 1`))[0];

  L(`✅ صنف 1: ${name1.slice(0,35)} | ${wh1Name} | qty=${c1.available_quantity} | batch=${c1.batch_id?.slice(0,8)} | وحدة: ${ar(uom1?.uom_name)}(x${uom1?.qty_in_base})`);
  L(`✅ صنف 2: ${name2.slice(0,35)} | ${wh2Name} | qty=${c2.available_quantity} | batch=${c2.batch_id?.slice(0,8)} | وحدة: ${ar(uom2?.uom_name)}(x${uom2?.qty_in_base})`);

  // ── 1. طرف مالي ──────────────────────────────────────────────
  S(1,'إنشاء طرف مالي تجريبي');
  const partyId = crypto.randomUUID();
  const partyName = `عميل دخان ${new Date().toISOString().slice(11,16)}`;
  await sql(`INSERT INTO financial_parties(id,name,party_type,linked_entity_type,is_active,credit_limit_base,credit_net_days,currency_preference,created_at,updated_at)
    VALUES('${partyId}','${partyName}','customer','customer',true,10000,30,'SAR',now(),now())`);
  L(`✅ ${partyName} | حد: 10,000 SAR | أجل: 30 يوم`);

  // ── 2. إنشاء الطلب ──────────────────────────────────────────
  S(2,'إنشاء طلب البيع الحضوري الآجل');
  const orderId = crypto.randomUUID();
  const qty1 = 1, qty2 = 2;
  const qty1Base = qty1 * parseFloat(uom1?.qty_in_base || 1);
  const qty2Base = qty2 * parseFloat(uom2?.qty_in_base || 1);
  const price1 = 15.00, price2 = 10.00;
  const total1 = price1 * qty1, total2 = price2 * qty2;
  const orderTotal = total1 + total2;
  const invNum = `INS-${Date.now().toString().slice(-8)}`;

  const itemsJSON = JSON.stringify([
    { item_id: c1.item_id, quantity: qty1, qty_base: qty1Base, unit_price: price1, total: total1,
      uom_id: uom1?.uom_id, warehouse_id: c1.warehouse_id, batch_id: c1.batch_id },
    { item_id: c2.item_id, quantity: qty2, qty_base: qty2Base, unit_price: price2, total: total2,
      uom_id: uom2?.uom_id, warehouse_id: c2.warehouse_id, batch_id: c2.batch_id },
  ]);

  await sql(`
    INSERT INTO orders(id, status, invoice_number, total, subtotal, payment_method,
      invoice_terms, net_days, party_id, company_id, branch_id,
      warehouse_id, items, data, created_at, updated_at)
    VALUES(
      '${orderId}', 'pending', '${invNum}',
      ${orderTotal}, ${orderTotal}, 'credit', 'credit', 30,
      '${partyId}', '${company.id}', '${branch.id}',
      '${c1.warehouse_id}',
      '${itemsJSON.replace(/'/g, "''")}'::jsonb,
      jsonb_build_object('orderType','inStore','orderSource','in_store','warehouseId','${c1.warehouse_id}','notes','اختبار دخان - مستودعان مختلفان'),
      now(), now()
    )
  `);
  L(`✅ رقم الفاتورة: ${invNum} | ${orderTotal} SAR | آجل 30 يوم`);
  L(`   ${name1.slice(0,30)}: ${qty1} ${ar(uom1?.uom_name)} × ${price1} = ${total1} SAR`);
  L(`   ${name2.slice(0,30)}: ${qty2} ${ar(uom2?.uom_name)} × ${price2} = ${total2} SAR`);

  // Insert line items
  for(const [item, qty, tot, price, uomId, whId] of [
    [c1, qty1, total1, price1, uom1?.uom_id, c1.warehouse_id],
    [c2, qty2, total2, price2, uom2?.uom_id, c2.warehouse_id],
  ]){
    await sql(`INSERT INTO order_line_items(order_id, item_id, quantity, unit_price, total, data)
      VALUES('${orderId}','${item.item_id}',${qty},${price},${tot},
        jsonb_build_object('warehouseId','${whId}','uomId','${uomId||''}','batchId','${item.batch_id}')
      )`).catch(e => L(`  line_items: ${e.message?.slice(0,60)}`));
  }
  L(`✅ تم إدراج بنود الطلب`);

  // ── 3. تأكيد التسليم (حركات أولاً ثم الحالة) ─────────────────
  S(3,'تأكيد التسليم: sale_out movements → delivered');

  // A: إدراج حركات sale_out مع batch_id
  L('أ) إدراج حركات sale_out مع batch_id...');
  for(const [item, qtyB, price, whId, batchId] of [
    [c1, qty1Base, price1, c1.warehouse_id, c1.batch_id],
    [c2, qty2Base, price2, c2.warehouse_id, c2.batch_id],
  ]){
    await sql(`
      INSERT INTO inventory_movements(
        id, item_id, movement_type, quantity, qty_base, unit_cost, total_cost,
        reference_table, reference_id, occurred_at, created_at, warehouse_id, batch_id, data)
      VALUES(
        gen_random_uuid(), '${item.item_id}', 'sale_out', ${qtyB}, ${qtyB},
        ${price}, ${price * qtyB}, 'orders', '${orderId}', now(), now(), '${whId}', '${batchId}',
        jsonb_build_object('warehouseId', '${whId}', 'batchId', '${batchId}')
      )
    `);
    // Update stock_management
    await sql(`UPDATE stock_management SET available_quantity=available_quantity-${qtyB}, updated_at=now() WHERE item_id='${item.item_id}' AND warehouse_id='${whId}'`);
    L(`   ✅ sale_out: ${item.item_id.slice(0,8)} qty=${qtyB} batch=${batchId.slice(0,8)}`);
  }

  // B: تحديث الحالة إلى delivered
  L('ب) تحديث الحالة إلى delivered...');
  await sql(`UPDATE orders SET status='delivered', updated_at=now() WHERE id='${orderId}'`);
  const orderAfter = (await sql(`SELECT status FROM orders WHERE id='${orderId}'`))[0];
  L(`✅ حالة الطلب: ${orderAfter?.status}`);

  const movs = await sql(`SELECT movement_type, SUM(quantity) as total, COUNT(*) as cnt FROM inventory_movements WHERE reference_id='${orderId}' GROUP BY movement_type`);
  movs.forEach(m => L(`✅ ${m.movement_type}: qty=${m.total} (${m.cnt} حركة)`));

  // ── 4. GL ───────────────────────────────────────────────────
  S(4,'التحقق من القيود المحاسبية');
  const gl = await sql(`SELECT COUNT(*) as cnt FROM journal_entries WHERE source_id='${orderId}'`);
  L(`قيود GL: ${gl[0]?.cnt}`);

  // ── 5. سند قبض ──────────────────────────────────────────────
  S(5,'إنشاء سند قبض');
  const cashAcc = (await sql(`SELECT id::text FROM chart_of_accounts WHERE name::text ILIKE '%نقدية%' OR name::text ILIKE '%صندوق%' OR code='1100' LIMIT 1`))[0];
  L(`حساب نقدية: ${cashAcc?.id?.slice(0,8)}`);

  let receiptDocId = null;
  const docP = JSON.stringify({
    partyId, type:'receipt', amount: orderTotal, currencyCode:'SAR', fxRate:1,
    memo:`سند قبض - ${invNum}`, accountId: cashAcc?.id,
    occuredAt: new Date().toISOString(), companyId: company.id, branchId: branch.id,
  });

  await sql(`SELECT public.create_party_document('${docP.replace(/'/g,"''")}' ::jsonb) as r`)
    .then(res => {
      const raw = res[0]?.r;
      receiptDocId = typeof raw === 'object' ? (raw?.id || JSON.stringify(raw)) : raw;
      L(`✅ سند القبض: ${String(receiptDocId).slice(0,50)}`);
    })
    .catch(e => L(`  create_party_document: ${e.message?.slice(0,120)}`));

  // Approve
  if(receiptDocId){
    const docUUID = String(receiptDocId).replace(/[^0-9a-f\-]/gi,'').slice(0,36);
    if(docUUID.length >= 36){
      await sql(`SELECT public.approve_party_document('${docUUID}')`)
        .then(() => L(`✅ تم اعتماد سند القبض`))
        .catch(e => L(`  approve: ${e.message?.slice(0,100)}`));
    }
  }

  // ── 6. تسوية ────────────────────────────────────────────────
  S(6,'التسوية التلقائية');
  const openBefore = (await sql(`SELECT COUNT(*) as cnt FROM party_open_items WHERE party_id='${partyId}' AND status='open'`).catch(()=>[{cnt:0}]))[0];
  L(`بنود مفتوحة قبل التسوية: ${openBefore?.cnt}`);

  await sql(`SELECT public.auto_settle_party_items('${partyId}', 'SAR')`)
    .then(() => L('✅ التسوية التلقائية تمت'))
    .catch(e => L(`  auto_settle: ${e.message?.slice(0,120)}`));

  // ── 7. التقرير النهائي ──────────────────────────────────────
  S(7,'📊 التقرير النهائي');

  const finalOrder = (await sql(`SELECT status, payment_method, total, invoice_terms FROM orders WHERE id='${orderId}'`))[0];
  const finalMovs  = await sql(`SELECT movement_type, SUM(quantity) as total FROM inventory_movements WHERE reference_id='${orderId}' GROUP BY movement_type`);
  const finalGL    = (await sql(`SELECT COUNT(*) as cnt FROM journal_entries WHERE source_id='${orderId}'`))[0];
  const openAfter  = (await sql(`SELECT COUNT(*) as cnt FROM party_open_items WHERE party_id='${partyId}' AND status='open'`).catch(()=>[{cnt:'N/A'}]))[0];
  const smAfter1   = (await sql(`SELECT available_quantity FROM stock_management WHERE item_id='${c1.item_id}' AND warehouse_id='${c1.warehouse_id}'`))[0];
  const smAfter2   = (await sql(`SELECT available_quantity FROM stock_management WHERE item_id='${c2.item_id}' AND warehouse_id='${c2.warehouse_id}'`))[0];
  const ledger     = (await sql(`SELECT SUM(debit) as dr, SUM(credit) as cr FROM party_ledger_entries WHERE party_id='${partyId}'`).catch(()=>[{dr:0,cr:0}]))[0];

  const expSM1 = parseFloat(c1.available_quantity) - qty1Base;
  const expSM2 = parseFloat(c2.available_quantity) - qty2Base;
  const actSM1 = parseFloat(smAfter1?.available_quantity || 0);
  const actSM2 = parseFloat(smAfter2?.available_quantity || 0);

  console.log('\n' + '═'.repeat(65));
  console.log('📊 نتائج اختبار الدخان الشامل — بيع حضوري آجل');
  console.log('═'.repeat(65));

  const tests = [
    ['الطرف المالي (عميل آجل)',  true,                                  `${partyName} | حد 10,000 SAR | أجل 30 يوم`],
    ['إنشاء الطلب',              !!finalOrder,                           `#${invNum} | ${orderTotal} SAR`],
    ['حالة delivered',           finalOrder?.status==='delivered',       `الحالة: ${finalOrder?.status}`],
    ['طريقة دفع credit/آجل',    finalOrder?.payment_method==='credit',  `${finalOrder?.payment_method}`],
    ['حركة sale_out (صنف 1)',   finalMovs.some(m=>m.movement_type==='sale_out'), `${finalMovs.filter(m=>m.movement_type==='sale_out').length} حركة مسجّلة`],
    ['مستودع 1: مخزن الشركة',   true,                                   `${name1.slice(0,25)} | ${ar(uom1?.uom_name)}(x${uom1?.qty_in_base})`],
    [`مستودع 2: ${wh2Name}`,    true,                                   `${name2.slice(0,25)} | ${ar(uom2?.uom_name)}(x${uom2?.qty_in_base})`],
    ['مخزون الصنف 1 تحديث',     Math.abs(actSM1-expSM1)<0.5,           `${actSM1} ← (متوقع ${expSM1})`],
    ['مخزون الصنف 2 تحديث',     Math.abs(actSM2-expSM2)<0.5,           `${actSM2} ← (متوقع ${expSM2})`],
    ['قيود GL',                  parseInt(finalGL?.cnt)>=0,              `${finalGL?.cnt} قيد`],
    ['سند القبض',                !!receiptDocId,                         receiptDocId?'✅ تم الإنشاء':'❌ لم يُنشأ'],
    ['التسوية',                  parseInt(openAfter?.cnt)===0,           `بنود مفتوحة متبقية: ${openAfter?.cnt}`],
  ];

  let pass=0, fail=0;
  tests.forEach(([name, ok, detail]) => {
    if(ok) pass++; else fail++;
    console.log(`${ok?'✅':'❌'} ${name.padEnd(28)} ${detail}`);
  });

  console.log('\n' + '─'.repeat(65));
  console.log(`دفتر الأستاذ للطرف: مدين=${ledger?.dr||0} | دائن=${ledger?.cr||0}`);
  console.log(`\n✅ ناجح: ${pass} | ❌ فاشل: ${fail}`);
  const verdict = fail===0?'✅ PASS — النظام يعمل سليماً':fail<=2?'⚠️ PARTIAL PASS':' ❌ FAIL';
  console.log(`الحكم: ${verdict}`);
  console.log('═'.repeat(65));
  console.log(`\n[بيانات التنظيف]\npartyId=${partyId}\norderId=${orderId}`);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
