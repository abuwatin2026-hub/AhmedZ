/**
 * DEEP audit — uses ACTUAL function names from OrderContext.tsx
 */
const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
const P = '✅', F = '❌', W = '⚠️';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(t); }
  return r.json();
}

const checkFn = async (name) => {
  const r = await sql(`SELECT pronargs, proargtypes::text as args FROM pg_proc WHERE proname='${name}' AND pronamespace='public'::regnamespace;`);
  return r;
};
const countTbl = async (name) => {
  const r = await sql(`SELECT COUNT(*) as n, pg_size_pretty(pg_total_relation_size('public.${name}')) as sz FROM public.${name};`).catch(() => [{ n: 'ERR', sz: 'N/A' }]);
  return r[0];
};

async function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  فحص عميق — نظام الطلبات الأونلاين (بأسماء الدوال الحقيقية)');
  console.log('══════════════════════════════════════════════════════════\n');

  // ── 1. ACTUAL RPCs called from OrderContext.tsx ───────────────
  console.log('【1】 الدوال الحقيقية المُستدعاة من OrderContext.tsx\n');
  const realFns = [
    'record_order_payment_v2',      // primary payment fn
    'record_order_payment',          // legacy fallback
    'reserve_stock_for_order',       // stock reservation
    'confirm_order_delivery',        // delivery confirmation
    'confirm_order_delivery_with_credit', // credit sale delivery
    'rpc_create_in_store_sale',      // in-store sale wrapper
    'cancel_order',
    'request_order_payment_purge',
    'approve_order_payment_purge',
    'bulk_request_order_payment_purge',
    'get_auto_purge_candidates',
    'get_warehouse_item_alerts',
    'list_item_uom_units',
    'process_sales_return',
    'release_reserved_stock_for_order',
    'issue_invoice_now',
    'get_credit_limit_summary',
    'confirm_order_delivery_and_record_payment',
  ];

  for (const f of realFns) {
    const r = await checkFn(f);
    if (r.length === 0) {
      console.log(`  ${F} ${f}: ❌ غير موجودة في الـ DB`);
    } else {
      console.log(`  ${P} ${f}: موجودة (${r.length} نسخة)`);
    }
  }

  // ── 2. Core tables with actual row counts ─────────────────────
  console.log('\n【2】 الجداول الأساسية — أعداد السجلات\n');
  // Orders uses JSONB data column
  const ordersSchema = await sql(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'orders' AND table_schema = 'public'
    ORDER BY ordinal_position;
  `);
  console.log(`  ${P} orders — الأعمدة الرئيسية:`);
  for (const c of ordersSchema) {
    console.log(`    ├─ ${c.column_name}: ${c.data_type} ${c.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
  }

  // payments table (used for order payments)
  const payTbl = await sql(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='payments'`);
  if (payTbl.length) {
    const s = await countTbl('payments');
    console.log(`\n  ${P} payments (جدول الدفعات الفعلي): ${s.n} سجل | ${s.sz}`);
    const cols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='payments' AND table_schema='public' ORDER BY ordinal_position LIMIT 10`);
    console.log(`    أعمدة: ${cols.map(c=>c.column_name).join(', ')}`);
  }

  // stock table
  const stockTbl = await sql(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%stock%' ORDER BY tablename`);
  console.log(`\n  ${P} جداول المخزون الموجودة:`);
  for (const t of stockTbl) {
    const s = await countTbl(t.tablename).catch(() => ({ n: 'N/A', sz: 'N/A' }));
    console.log(`    ├─ ${t.tablename}: ${s.n} سجل`);
  }

  // order events
  const evtTbl = await sql(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='order_events'`);
  if (evtTbl.length) {
    const s = await countTbl('order_events');
    console.log(`\n  ${P} order_events: ${s.n} حدث`);
  }

  // ── 3. JSONB data column — what's actually inside orders ──────
  console.log('\n【3】 بنية البيانات داخل عمود data (JSONB)\n');
  const jsonbKeys = await sql(`
    SELECT key, COUNT(*) as frequency
    FROM public.orders, jsonb_object_keys(data) as key
    GROUP BY key
    ORDER BY frequency DESC
    LIMIT 30;
  `).catch(() => []);
  if (jsonbKeys.length) {
    console.log('  مفاتيح الـ JSONB الأكثر استخداماً:');
    for (const k of jsonbKeys.slice(0, 20)) {
      console.log(`    ${P} ${k.key}: ${k.frequency} طلب`);
    }
  }

  // ── 4. Offline queue / RPC fallback patterns ──────────────────
  console.log('\n【4】 نظام Resilience — Fallback Patterns\n');
  // does offline_pos_queue table exist?
  const offlineTbl = await sql(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%offline%'`);
  if (offlineTbl.length) {
    for (const t of offlineTbl) {
      const s = await countTbl(t.tablename).catch(() => ({ n: 'N/A' }));
      console.log(`  ${P} ${t.tablename}: ${s.n} سجل`);
    }
  } else {
    console.log(`  ${W} لا توجد جداول offline queue في الـ DB (الـ queue يعمل في الـ frontend memory/localStorage)`);
  }

  // ── 5. RLS deep check ─────────────────────────────────────────
  console.log('\n【5】 RLS المتعمق — كل الجداول المرتبطة بالطلبات\n');
  const rlsCheck = await sql(`
    SELECT c.relname as tbl, c.relrowsecurity as rls, 
           (SELECT COUNT(*) FROM pg_policies p WHERE p.tablename=c.relname AND p.schemaname='public') as policies
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND (c.relname LIKE '%order%' OR c.relname LIKE '%payment%' OR c.relname LIKE '%stock%' 
           OR c.relname IN ('sales_returns','delivery_zones','payments'))
    ORDER BY c.relname;
  `);
  for (const r of rlsCheck) {
    const ok = r.rls && r.policies > 0;
    console.log(`  ${ok ? P : W} ${r.tbl}: RLS ${r.rls ? 'مُفعَّل' : 'مُعطَّل'} | ${r.policies} سياسة`);
  }

  // ── 6. Publication / Realtime ─────────────────────────────────
  console.log('\n【6】 Supabase Realtime — فحص متعمق\n');
  const pubs = await sql(`
    SELECT schemaname, tablename, pubname
    FROM pg_publication_tables
    WHERE tablename IN ('orders','payments','stock','delivery_zones')
    ORDER BY tablename;
  `).catch(() => []);
  if (pubs.length) {
    for (const p of pubs) {
      console.log(`  ${P} ${p.tablename} → publication: ${p.pubname || 'N/A'}`);
    }
  } else {
    // Check what publications exist
    const allPubs = await sql(`SELECT pubname, puballtables FROM pg_publication;`).catch(() => []);
    for (const p of allPubs) {
      console.log(`  ${P} publication موجود: "${p.pubname}" | alltables: ${p.puballtables}`);
    }
    if (!allPubs.length) console.log(`  ${F} لا توجد publications — Supabase Realtime معطَّل!`);
  }

  // ── 7. Triggers quality check ─────────────────────────────────
  console.log('\n【7】 جودة الـ Triggers — التحقق من الوظائف الحيوية\n');
  const criticalTrgs = [
    { tbl: 'orders', name: 'trg_orders_post_delivery', purpose: 'إصدار القيود المحاسبية عند التوصيل' },
    { tbl: 'orders', name: 'trg_issue_invoice_on_delivery', purpose: 'إصدار الفاتورة عند التوصيل' },
    { tbl: 'orders', name: 'trg_audit_orders', purpose: 'سجل التدقيق' },
    { tbl: 'orders', name: 'trg_orders_forbid_posted_updates', purpose: 'منع تعديل الطلبات المرحّلة' },
    { tbl: 'orders', name: 'trg_enforce_discount_approval', purpose: 'اعتماد الخصومات' },
    { tbl: 'orders', name: 'trg_set_order_fx', purpose: 'سعر الصرف التلقائي' },
    { tbl: 'orders', name: 'trg_delivered_order_requires_journal_entry', purpose: 'إلزامية القيد المحاسبي' },
    { tbl: 'orders', name: 'trg_sync_order_line_items', purpose: 'مزامنة بنود الطلب' },
    { tbl: 'orders', name: 'trg_notify_order_created', purpose: 'إشعارات لحظية' },
    { tbl: 'orders', name: 'trg_set_order_party_id', purpose: 'ربط الطرف المالي' },
  ];
  for (const t of criticalTrgs) {
    const r = await sql(`
      SELECT trigger_name FROM information_schema.triggers 
      WHERE event_object_table='${t.tbl}' AND trigger_name='${t.name}' AND trigger_schema='public'
    `);
    const exists = r.length > 0;
    console.log(`  ${exists ? P : F} ${t.name}: ${t.purpose}`);
  }

  // ── 8. Outstanding issues in existing orders ──────────────────
  console.log('\n【8】 فحص سلامة البيانات\n');
  
  // Delivered without journal entry
  const noJe = await sql(`
    SELECT COUNT(*) as n FROM public.orders o
    WHERE o.status = 'delivered'
    AND NOT EXISTS (
      SELECT 1 FROM public.journal_entries je 
      WHERE je.source_table = 'orders' AND je.source_id = o.id::text AND je.status = 'posted'
    );
  `).catch(() => [{ n: 'N/A' }]);
  const noJeN = +noJe[0].n;
  console.log(`  ${noJeN === 0 ? P : F} طلبات مسلَّمة بدون قيد محاسبي: ${noJe[0].n}`);

  // Reserved stock not released
  const stockTbls = await sql(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='stock_reservations'`);
  if (stockTbls.length) {
    const unreleased = await sql(`
      SELECT COUNT(*) as n FROM public.stock_reservations WHERE status = 'reserved' AND order_id IN (
        SELECT id FROM public.orders WHERE status IN ('delivered','cancelled')
      );
    `).catch(() => [{ n: 'N/A' }]);
    console.log(`  ${+unreleased[0].n === 0 ? P : W} حجوزات مخزون لم تُحرَّر لطلبات منتهية: ${unreleased[0].n}`);
  }

  // Orders with null status
  const nullStatus = await sql(`SELECT COUNT(*) as n FROM public.orders WHERE status IS NULL`);
  console.log(`  ${+nullStatus[0].n === 0 ? P : F} طلبات بحالة NULL: ${nullStatus[0].n}`);

  // Cancelled with payments
  const cancelPaid = await sql(`
    SELECT COUNT(*) as n FROM public.orders o
    WHERE o.status = 'cancelled'
    AND EXISTS (
      SELECT 1 FROM public.payments p 
      WHERE p.reference_id = o.id::text AND p.direction = 'in'
    );
  `).catch(() => [{ n: 'N/A' }]);
  console.log(`  ${W} طلبات ملغاة لها دفعات مسجلة: ${cancelPaid[0].n} (تحتاج مراجعة)`);

  // ── 9. Delivery system ────────────────────────────────────────
  console.log('\n【9】 نظام التوصيل والمناطق\n');
  const zones = await sql(`
    SELECT id, name, is_active, delivery_fee, min_order_amount,
           ST_IsValid(coverage_area) as area_valid
    FROM public.delivery_zones
    ORDER BY is_active DESC, name;
  `).catch(() => []);
  for (const z of zones) {
    console.log(`  ${z.is_active ? P : W} ${z.name}: رسوم ${z.delivery_fee} | حد أدنى ${z.min_order_amount} | المنطقة صحيحة: ${z.area_valid}`);
  }

  // ── 10. System audit logs for orders ──────────────────────────
  console.log('\n【10】 سجل التدقيق للطلبات\n');
  const auditLogs = await sql(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN module = 'orders' THEN 1 END) as order_logs,
      COUNT(CASE WHEN risk_level IN ('HIGH','CRITICAL') THEN 1 END) as high_risk
    FROM public.system_audit_logs
    WHERE created_at > now() - interval '30 days';
  `).catch(() => [{ total: 0, order_logs: 0, high_risk: 0 }]);
  const al = auditLogs[0];
  console.log(`  ${P} سجلات التدقيق (30 يوم): ${al.total} إجمالي | ${al.order_logs} طلبات | ${al.high_risk} مخاطر عالية`);

  // ── 11. Conflicts / anomalies ─────────────────────────────────
  console.log('\n【11】 فحص التعارضات والشذوذات\n');

  // Duplicate invoice numbers
  const dupInv = await sql(`
    SELECT data->>'invoiceNumber' as inv, COUNT(*) as n
    FROM public.orders
    WHERE data->>'invoiceNumber' IS NOT NULL
    GROUP BY inv HAVING COUNT(*) > 1
    LIMIT 10;
  `).catch(() => []);
  console.log(`  ${dupInv.length === 0 ? P : F} أرقام فواتير مكررة: ${dupInv.length}`);

  // Orders stuck in preparing > 24h
  const stuckPreparing = await sql(`
    SELECT COUNT(*) as n FROM public.orders
    WHERE status = 'preparing'
    AND created_at < now() - interval '24 hours';
  `).catch(() => [{ n: 0 }]);
  console.log(`  ${+stuckPreparing[0].n === 0 ? P : W} طلبات عالقة في قيد التجهيز > 24 ساعة: ${stuckPreparing[0].n}`);

  // Orders out_for_delivery > 12h
  const stuckDelivery = await sql(`
    SELECT COUNT(*) as n FROM public.orders
    WHERE status = 'out_for_delivery'
    AND created_at < now() - interval '12 hours';
  `).catch(() => [{ n: 0 }]);
  console.log(`  ${+stuckDelivery[0].n === 0 ? P : W} طلبات عالقة "في الطريق" > 12 ساعة: ${stuckDelivery[0].n}`);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  انتهى الفحص العميق');
  console.log('══════════════════════════════════════════════════════════\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
