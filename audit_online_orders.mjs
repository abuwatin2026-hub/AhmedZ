const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
const P = '✅', F = '❌', W = '⚠️';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${SBP}`},
    body:JSON.stringify({query:q})});
  if(!r.ok){const t=await r.text();throw new Error(t);}
  return r.json();
}
const fn = async n => {
  const r = await sql(`SELECT COUNT(*) as n FROM pg_proc WHERE proname='${n}' AND pronamespace='public'::regnamespace`);
  return +r[0].n > 0;
};
const tbl = async n => {
  const r = await sql(`SELECT COUNT(*) as n FROM pg_tables WHERE tablename='${n}' AND schemaname='public'`);
  return +r[0].n > 0;
};

async function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  فحص شامل لنظام طلبات الأونلاين');
  console.log('══════════════════════════════════════════════════════════\n');

  // ── 1. Core tables ────────────────────────────────────────────
  console.log('【1】 الجداول الأساسية للطلبات\n');
  const tables = ['orders','order_items','order_status_history','order_audit_events',
    'order_purge_requests','order_payments','order_payment_lines',
    'sales_returns','sales_return_items','delivery_zones','journal_entries'];
  for(const t of tables){
    const ok = await tbl(t);
    console.log(`  ${ok?P:F} ${t}`);
  }

  // ── 2. Key RPCs ───────────────────────────────────────────────
  console.log('\n【2】 الدوال والـ RPCs الحيوية\n');
  const fns = [
    'create_in_store_sale','update_order_status','assign_order_to_delivery',
    'mark_order_delivered','mark_order_paid','record_order_payment_partial',
    'issue_invoice_now','cancel_order','request_order_payment_purge',
    'approve_order_payment_purge','bulk_request_order_payment_purge',
    'get_warehouse_item_alerts','list_item_uom_units',
    'create_sales_return','process_sales_return','get_returns_by_order',
    'get_auto_purge_candidates','accept_delivery_assignment',
    'resume_in_store_pending_order','cancel_in_store_pending_order',
  ];
  for(const f of fns){
    const ok = await fn(f);
    console.log(`  ${ok?P:F} ${f}`);
  }

  // ── 3. Order stats ────────────────────────────────────────────
  console.log('\n【3】 إحصائيات الطلبات الحالية\n');
  const stats = await sql(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status='pending' THEN 1 END) as pending,
      COUNT(CASE WHEN status='preparing' THEN 1 END) as preparing,
      COUNT(CASE WHEN status='out_for_delivery' THEN 1 END) as out_for_delivery,
      COUNT(CASE WHEN status='delivered' THEN 1 END) as delivered,
      COUNT(CASE WHEN status='cancelled' THEN 1 END) as cancelled,
      COUNT(CASE WHEN status='scheduled' THEN 1 END) as scheduled
    FROM public.orders;
  `);
  const s = stats[0];
  console.log(`  ${P} إجمالي الطلبات: ${s.total}`);
  console.log(`  ${P} قيد الانتظار: ${s.pending} | قيد التجهيز: ${s.preparing} | في الطريق: ${s.out_for_delivery}`);
  console.log(`  ${P} تم التوصيل: ${s.delivered} | ملغي: ${s.cancelled} | مجدول: ${s.scheduled}`);

  // ── 4. Source split ───────────────────────────────────────────
  console.log('\n【4】 مصدر الطلبات (أونلاين / محل)\n');
  const sources = await sql(`
    SELECT 
      COALESCE(data->>'orderSource', 'online') as source,
      COUNT(*) as n,
      SUM((data->>'total')::numeric) as revenue
    FROM public.orders
    WHERE created_at > now() - interval '30 days'
    GROUP BY source
    ORDER BY n DESC;
  `);
  for(const r of sources){
    console.log(`  ${P} ${r.source}: ${r.n} طلب | إيرادات: ${Number(r.revenue||0).toFixed(0)}`);
  }

  // ── 5. Payment coverage ───────────────────────────────────────
  console.log('\n【5】 تغطية المدفوعات\n');
  const payStats = await sql(`
    SELECT 
      COUNT(*) as total_delivered,
      COUNT(CASE WHEN payment_status='paid' THEN 1 END) as paid,
      COUNT(CASE WHEN payment_status='partial' THEN 1 END) as partial,
      COUNT(CASE WHEN payment_status IS NULL OR payment_status='unpaid' THEN 1 END) as unpaid
    FROM public.orders WHERE status='delivered';
  `).catch(()=>[{total_delivered:0,paid:0,partial:0,unpaid:0}]);
  const ps = payStats[0];
  console.log(`  ${P} المسلَّمة: ${ps.total_delivered} | مدفوعة: ${ps.paid} | جزئية: ${ps.partial} | غير مدفوعة: ${ps.unpaid}`);

  // ── 6. Returns ────────────────────────────────────────────────
  console.log('\n【6】 نظام المرتجعات\n');
  const returns = await sql(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status='pending' THEN 1 END) as pending,
      COUNT(CASE WHEN status='processed' THEN 1 END) as processed,
      COUNT(CASE WHEN status='cancelled' THEN 1 END) as cancelled
    FROM public.sales_returns;
  `).catch(()=>[{total:0,pending:0,processed:0,cancelled:0}]);
  const ret = returns[0];
  console.log(`  ${P} إجمالي المرتجعات: ${ret.total} | منتظرة: ${ret.pending} | منفذة: ${ret.processed} | ملغية: ${ret.cancelled}`);

  // ── 7. Purge system ───────────────────────────────────────────
  console.log('\n【7】 نظام حذف الدفعات (Purge)\n');
  const purge = await sql(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status='pending_approval' THEN 1 END) as pending,
      COUNT(CASE WHEN status='approved' THEN 1 END) as approved,
      COUNT(CASE WHEN status='rejected' THEN 1 END) as rejected
    FROM public.order_purge_requests;
  `).catch(()=>[{total:0,pending:0,approved:0,rejected:0}]);
  const pur = purge[0];
  console.log(`  ${P} طلبات الحذف: ${pur.total} | منتظرة موافقة: ${pur.pending} | موافق عليها: ${pur.approved} | مرفوضة: ${pur.rejected}`);

  // ── 8. Delivery zones ─────────────────────────────────────────
  console.log('\n【8】 مناطق التوصيل\n');
  const zones = await sql(`SELECT COUNT(*) as n, COUNT(CASE WHEN is_active THEN 1 END) as active FROM public.delivery_zones;`).catch(()=>[{n:0,active:0}]);
  console.log(`  ${P} مناطق التوصيل: ${zones[0].n} (منها نشطة: ${zones[0].active})`);

  // ── 9. Triggers on orders ─────────────────────────────────────
  console.log('\n【9】 الـ Triggers على جدول الطلبات\n');
  const trgs = await sql(`
    SELECT trigger_name, event_manipulation, action_timing
    FROM information_schema.triggers
    WHERE event_object_table='orders' AND trigger_schema='public'
    ORDER BY trigger_name;
  `);
  for(const t of trgs){
    console.log(`  ${P} orders.${t.trigger_name} [${t.event_manipulation} ${t.action_timing}]`);
  }
  if(trgs.length===0) console.log(`  ${W} لا توجد triggers مباشرة على الطلبات`);

  // ── 10. Realtime replication ──────────────────────────────────
  console.log('\n【10】 إعداد Realtime للطلبات\n');
  const rt = await sql(`
    SELECT publication_name, tablename
    FROM pg_publication_tables
    WHERE tablename = 'orders';
  `).catch(()=>[]);
  if(rt.length > 0){
    console.log(`  ${P} جدول orders مُضاف لـ publication: ${rt.map(r=>r.publication_name).join(', ')}`);
  } else {
    console.log(`  ${W} orders غير مُضاف لأي Postgres publication — Realtime قد لا يعمل`);
  }

  // ── 11. Accounting integration ────────────────────────────────
  console.log('\n【11】 الربط المحاسبي — القيود المالية\n');
  const jeOrders = await sql(`
    SELECT COUNT(*) as n
    FROM public.journal_entries je
    WHERE je.source_table = 'orders' AND je.status = 'posted';
  `).catch(()=>[{n:0}]);
  console.log(`  ${P} قيود محاسبية مرحّلة من الطلبات: ${jeOrders[0].n}`);

  // ── 12. Stock reservation ─────────────────────────────────────
  console.log('\n【12】 حجوزات المخزون\n');
  const stockTbls = ['stock_reservations','stock_journal','stock_movements'];
  for(const t of stockTbls){
    const ok = await tbl(t);
    if(ok){
      const cnt = await sql(`SELECT COUNT(*) as n FROM public.${t};`).catch(()=>[{n:'N/A'}]);
      console.log(`  ${P} ${t}: ${cnt[0].n} سجل`);
    } else {
      console.log(`  ${W} ${t}: غير موجود`);
    }
  }

  // ── 13. RLS ───────────────────────────────────────────────────
  console.log('\n【13】 سياسات RLS\n');
  const rlsCheck = ['orders','order_payments','order_purge_requests','sales_returns'];
  for(const t of rlsCheck){
    const r = await sql(`SELECT relrowsecurity FROM pg_class WHERE relname='${t}' AND relnamespace='public'::regnamespace`).catch(()=>[{relrowsecurity:null}]);
    const pol = await sql(`SELECT COUNT(*) as n FROM pg_policies WHERE tablename='${t}' AND schemaname='public'`).catch(()=>[{n:0}]);
    console.log(`  ${r[0]?.relrowsecurity ? P : W} ${t}: RLS ${r[0]?.relrowsecurity ? 'مُفعَّل' : 'غير مُفعَّل'} | ${pol[0]?.n} سياسة`);
  }

  // ── 14. Last 7 days performance ───────────────────────────────
  console.log('\n【14】 أداء آخر 7 أيام\n');
  const perf = await sql(`
    SELECT 
      DATE(created_at) as day,
      COUNT(*) as orders,
      SUM((data->>'total')::numeric) as revenue
    FROM public.orders
    WHERE created_at > now() - interval '7 days'
    GROUP BY day
    ORDER BY day DESC;
  `).catch(()=>[]);
  if(perf.length === 0){
    console.log(`  ${W} لا توجد طلبات في آخر 7 أيام`);
  } else {
    for(const d of perf){
      console.log(`  ${P} ${d.day}: ${d.orders} طلب | ${Number(d.revenue||0).toFixed(0)} ر.س`);
    }
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  انتهى الفحص الشامل لنظام الطلبات الأونلاين');
  console.log('══════════════════════════════════════════════════════════\n');
}
main().catch(e=>{console.error('Fatal:',e.message);process.exit(1);});
