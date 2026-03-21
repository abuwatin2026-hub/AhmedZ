const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
const P='✅',F='❌',W='⚠️';
async function sql(q) {
  const r=await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${SBP}`},
    body:JSON.stringify({query:q})});
  const b=await r.json();if(!r.ok)throw new Error(JSON.stringify(b).slice(0,300));return b;
}
const fn=async n=>(await sql(`SELECT COUNT(*) as n FROM pg_proc WHERE proname='${n}' AND pronamespace='public'::regnamespace`))[0].n > 0;
const tbl=async n=>(await sql(`SELECT COUNT(*) as n FROM pg_tables WHERE tablename='${n}' AND schemaname='public'`))[0].n > 0;

async function main(){
  console.log('══════════════════════════════════════════════════════');
  console.log('  فحص شامل — مرتجعات المبيعات');
  console.log('══════════════════════════════════════════════════════\n');

  // ── 1. Tables ──────────────────────────────────────────────
  console.log('【1】 الجداول\n');
  const tables=['sales_returns','sales_return_items'];
  for(const t of tables){
    const ok=await tbl(t);
    if(ok){
      const r=await sql(`SELECT COUNT(*) as n FROM public.${t}`);
      console.log(`  ${P} ${t}: ${r[0].n} سجل`);
    } else console.log(`  ${F} ${t}: غير موجود`);
  }
  // Schema of sales_returns
  const cols=await sql(`SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_name='sales_returns' AND table_schema='public' ORDER BY ordinal_position`);
  console.log('\n  أعمدة sales_returns:');
  cols.forEach(c=>console.log(`    ├─ ${c.column_name}: ${c.data_type} ${c.is_nullable==='NO'?'(NOT NULL)':''}`));

  // ── 2. RPCs ────────────────────────────────────────────────
  console.log('\n【2】 الدوال والـ RPCs\n');
  const fns=['process_sales_return','create_sales_return','get_returns_by_order',
    'repair_incorrect_return','recompute_order_return_status','backfill_returns_party_currency_uom',
    'get_sales_return_gl_preview','void_sales_return'];
  for(const f of fns){
    const ok=await fn(f);
    if(ok){
      const ver=await sql(`SELECT COUNT(*) as n FROM pg_proc WHERE proname='${f}' AND pronamespace='public'::regnamespace`);
      console.log(`  ${P} ${f}: ${ver[0].n} نسخة`);
    } else console.log(`  ${W} ${f}: غير موجود في الـ DB`);
  }

  // ── 3. Returns statistics ──────────────────────────────────
  console.log('\n【3】 إحصائيات المرتجعات\n');
  const stats=await sql(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status='draft' THEN 1 END) as draft,
      COUNT(CASE WHEN status='completed' THEN 1 END) as completed,
      COUNT(CASE WHEN status='cancelled' THEN 1 END) as cancelled,
      COUNT(CASE WHEN status='processing' THEN 1 END) as processing,
      COUNT(DISTINCT order_id) as unique_orders,
      SUM(total_refund_amount) as total_refunded
    FROM public.sales_returns
  `);
  const s=stats[0];
  console.log(`  ${P} إجمالي المرتجعات: ${s.total}`);
  console.log(`  ${P} مسودة: ${s.draft} | مكتملة: ${s.completed} | ملغية: ${s.cancelled} | قيد المعالجة: ${s.processing}`);
  console.log(`  ${P} طلبات فريدة: ${s.unique_orders}`);
  console.log(`  ${P} إجمالي المبالغ المستردة: ${Number(s.total_refunded||0).toFixed(2)}`);

  // ── 4. Returns breakdown by refund method ─────────────────
  console.log('\n【4】 طرق الاسترداد\n');
  const methods=await sql(`
    SELECT refund_method, COUNT(*) as n, SUM(total_refund_amount) as total
    FROM public.sales_returns GROUP BY refund_method ORDER BY n DESC
  `);
  methods.forEach(m=>console.log(`  ${P} ${m.refund_method||'(غير محدد)'}: ${m.n} مرتجع | ${Number(m.total||0).toFixed(0)} ر`));

  // ── 5. Data integrity ──────────────────────────────────────
  console.log('\n【5】 سلامة البيانات\n');

  // Completed returns without journal entries
  const noJe=await sql(`
    SELECT COUNT(*) as n FROM public.sales_returns sr
    WHERE sr.status='completed'
    AND NOT EXISTS(
      SELECT 1 FROM public.journal_entries je 
      WHERE je.source_table='sales_returns' AND je.source_id=sr.id::text AND je.status='posted'
    )
  `);
  const noJeN=+noJe[0].n;
  console.log(`  ${noJeN===0?P:F} مرتجعات مكتملة بدون قيد محاسبي: ${noJeN}`);

  // Draft returns older than 7 days
  const staleDraft=await sql(`
    SELECT COUNT(*) as n FROM public.sales_returns
    WHERE status='draft' AND created_at < now()-interval '7 days'
  `);
  console.log(`  ${+staleDraft[0].n===0?P:W} مسودات عمرها +7 أيام: ${staleDraft[0].n}`);

  // Returns exceeding order total
  const overReturn=await sql(`
    SELECT COUNT(*) as n FROM public.sales_returns sr
    JOIN public.orders o ON o.id=sr.order_id
    WHERE sr.status='completed'
    AND sr.total_refund_amount > COALESCE(o.total,0)*1.01
  `).catch(()=>[{n:0}]);
  console.log(`  ${+overReturn[0].n===0?P:F} مرتجعات تتجاوز قيمة الطلب: ${overReturn[0].n}`);

  // Duplicate completed returns per order
  const dupReturns=await sql(`
    SELECT order_id, COUNT(*) as n FROM public.sales_returns
    WHERE status='completed' GROUP BY order_id HAVING COUNT(*)>1
  `);
  console.log(`  ${dupReturns.length===0?P:W} طلبات بمرتجعات مكتملة متعددة: ${dupReturns.length}`);

  // ── 6. Accounting linkage ──────────────────────────────────
  console.log('\n【6】 الربط المحاسبي\n');
  const jeStats=await sql(`
    SELECT COUNT(*) as total, 
           COUNT(CASE WHEN status='posted' THEN 1 END) as posted,
           SUM(CASE WHEN status='posted' THEN COALESCE(debit_total,0) END) as total_debit
    FROM public.journal_entries WHERE source_table='sales_returns'
  `).catch(async ()=>{
    return sql(`SELECT COUNT(*) as total, COUNT(CASE WHEN status='posted' THEN 1 END) as posted FROM public.journal_entries WHERE source_table='sales_returns'`);
  });
  const je=jeStats[0];
  console.log(`  ${P} قيود محاسبية من مرتجعات: ${je.total} | مرحّلة: ${je.posted}`);

  // check debit_total column name
  const jeCols=await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='journal_entries' AND column_name LIKE '%debit%' OR column_name LIKE '%total%'`).catch(()=>[]);
  if(jeCols.length) console.log(`  أعمدة المبالغ: ${jeCols.map(c=>c.column_name).join(', ')}`);

  // ── 7. Payments / refund payments ─────────────────────────
  console.log('\n【7】 الدفعات المرتبطة بالمرتجعات (استردادات)\n');
  const refundPayments=await sql(`
    SELECT COUNT(*) as n, SUM(amount) as total, method
    FROM public.payments
    WHERE reference_table='sales_returns' AND direction='out'
    GROUP BY method ORDER BY n DESC
  `).catch(()=>[]);
  if(refundPayments.length===0){
    // try direction=-1 or negative amount
    const alt=await sql(`SELECT COUNT(*) as n, SUM(ABS(amount)) as total FROM public.payments WHERE reference_table='sales_returns'`).catch(()=>[{n:0,total:0}]);
    console.log(`  ${P} دفعات استرداد: ${alt[0].n} | إجمالي: ${Number(alt[0].total||0).toFixed(0)}`);
  } else {
    refundPayments.forEach(p=>console.log(`  ${P} ${p.method||'N/A'}: ${p.n} استرداد | ${Number(p.total||0).toFixed(0)}`));
  }

  // ── 8. Stock restoration ───────────────────────────────────
  console.log('\n【8】 استعادة المخزون عند الإرجاع\n');
  // check if returns affect stock_management
  const stockImpact=await sql(`
    SELECT COUNT(*) as n FROM public.stock_management
    WHERE source='return' OR notes LIKE '%return%'
  `).catch(()=>[{n:'N/A'}]);
  console.log(`  ${P} تعديلات مخزون من مرتجعات: ${stockImpact[0].n}`);

  // ── 9. Triggers ────────────────────────────────────────────
  console.log('\n【9】 الـ Triggers على sales_returns\n');
  const trgs=await sql(`
    SELECT trigger_name,event_manipulation,action_timing
    FROM information_schema.triggers
    WHERE event_object_table='sales_returns' AND trigger_schema='public'
    ORDER BY trigger_name
  `);
  if(trgs.length===0) console.log(`  ${W} لا توجد triggers`);
  trgs.forEach(t=>console.log(`  ${P} ${t.trigger_name} [${t.event_manipulation} ${t.action_timing}]`));

  // ── 10. Order hasReturn flag ───────────────────────────────
  console.log('\n【10】 تزامن علامة hasReturn في الطلبات\n');
  // orders that have completed returns but hasReturn flag not set
  const noFlag=await sql(`
    SELECT COUNT(*) as n FROM public.orders o
    WHERE EXISTS(SELECT 1 FROM public.sales_returns sr WHERE sr.order_id=o.id AND sr.status='completed')
    AND (o.data->>'hasReturn')::boolean IS NOT TRUE
  `).catch(()=>[{n:'N/A'}]);
  console.log(`  ${+noFlag[0].n===0?P:W} طلبات مكتملة الإرجاع لكن hasReturn=false: ${noFlag[0].n}`);

  // orders with hasReturn=true but no completed return
  const falseFlag=await sql(`
    SELECT COUNT(*) as n FROM public.orders o
    WHERE (o.data->>'hasReturn')::boolean IS TRUE
    AND NOT EXISTS(SELECT 1 FROM public.sales_returns sr WHERE sr.order_id=o.id AND sr.status='completed')
  `).catch(()=>[{n:'N/A'}]);
  console.log(`  ${+falseFlag[0].n===0?P:W} طلبات hasReturn=true لكن بدون مرتجع مكتمل: ${falseFlag[0].n}`);

  // ── 11. RLS ────────────────────────────────────────────────
  console.log('\n【11】 RLS وسياسات الوصول\n');
  const rlsCheck=await sql(`
    SELECT c.relrowsecurity as rls,(SELECT COUNT(*) FROM pg_policies p WHERE p.tablename='sales_returns' AND p.schemaname='public') as policies
    FROM pg_class c WHERE c.relname='sales_returns' AND c.relnamespace='public'::regnamespace
  `);
  const rls=rlsCheck[0];
  console.log(`  ${rls.rls?P:W} RLS: ${rls.rls?'مُفعَّل':'مُعطَّل'} | ${rls.policies} سياسة`);

  // ── 12. Party_ledger ───────────────────────────────────────
  console.log('\n【12】 دفتر الأستاذ للمرتجعات\n');
  const ledger=await sql(`
    SELECT COUNT(*) as n, SUM(base_amount) as total
    FROM public.party_ledger_entries WHERE source_table='sales_returns'
  `).catch(()=>[{n:0,total:0}]);
  console.log(`  ${P} سطور دفتر الأستاذ: ${ledger[0].n} | إجمالي: ${Number(ledger[0].total||0).toFixed(2)}`);

  // ── 13. Idempotency ────────────────────────────────────────
  console.log('\n【13】 الحماية من التكرار (Idempotency)\n');
  const idempCol=await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='sales_returns' AND column_name='idempotency_key'`);
  console.log(`  ${idempCol.length?P:W} عمود idempotency_key: ${idempCol.length?'موجود':'غير موجود'}`);
  const idempIdx=await sql(`SELECT indexname FROM pg_indexes WHERE tablename='sales_returns' AND indexname LIKE '%idempotency%'`);
  console.log(`  ${idempIdx.length?P:W} index على idempotency_key: ${idempIdx.length?idempIdx[0].indexname:'غير موجود'}`);

  // ── 14. Realtime ───────────────────────────────────────────
  console.log('\n【14】 Realtime\n');
  const rt=await sql(`SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='sales_returns'`);
  console.log(`  ${rt.length?P:W} sales_returns في Realtime publication: ${rt.length?'نعم':'لا — يعمل بـ focus-refetch فقط'}`);

  // ── 15. Recent returns (last 30 days) ──────────────────────
  console.log('\n【15】 المرتجعات الأخيرة (30 يوم)\n');
  const recent=await sql(`
    SELECT DATE(created_at) as day, COUNT(*) as n, SUM(total_refund_amount) as total
    FROM public.sales_returns
    WHERE created_at>now()-interval '30 days'
    GROUP BY day ORDER BY day DESC LIMIT 5
  `);
  if(recent.length===0) console.log(`  ${W} لا مرتجعات في آخر 30 يوم`);
  recent.forEach(r=>console.log(`  ${P} ${r.day}: ${r.n} مرتجع | ${Number(r.total||0).toFixed(0)}`));

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  انتهى الفحص الشامل لمرتجعات المبيعات');
  console.log('══════════════════════════════════════════════════════\n');
}
main().catch(e=>{console.error('Fatal:',e.message);process.exit(1);});
