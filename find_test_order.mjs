const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 400));
  return b;
}

async function main() {
  console.log('══════ البحث عن طلب قابل لاختبار الإرجاع ══════\n');

  // Find recent delivered orders that DON'T already have a return
  const candidates = await sql(`
    SELECT o.id, o.status, o.customer_name, o.total, o.currency,
           o.data->>'total' as data_total,
           o.data->>'subtotal' as data_subtotal,
           o.data->>'orderSource' as source,
           o.data->>'returnStatus' as return_status,
           (SELECT COUNT(*) FROM public.sales_returns sr WHERE sr.order_id=o.id) as existing_returns,
           o.created_at::date as order_date
    FROM public.orders o
    WHERE o.status = 'delivered'
    ORDER BY o.created_at DESC
    LIMIT 15
  `);

  console.log('آخر 15 طلب مسلَّم:\n');
  candidates.forEach(c => {
    const hasReturn = c.existing_returns > 0 ? '⚠️ له مرتجع' : '✅ قابل للإرجاع';
    console.log(`  ${c.order_date} | ${String(c.id).slice(-8)} | ${c.customer_name || 'غير محدد'} | ${c.total} ${c.currency || 'YER'} | ${c.source} | ${hasReturn} | returnStatus: ${c.return_status || 'none'}`);
  });

  // Find one without returns
  const testCandidate = candidates.find(c => c.existing_returns === 0);
  if (testCandidate) {
    console.log(`\n🎯 طلب مرشح للاختبار: ${testCandidate.id}`);
    console.log(`   ${testCandidate.customer_name} | ${testCandidate.total} ${testCandidate.currency}`);
    
    // Get items in this order
    const orderData = await sql(`SELECT data->'items' as items FROM public.orders WHERE id='${testCandidate.id}'`);
    const items = typeof orderData[0]?.items === 'string' ? JSON.parse(orderData[0].items) : orderData[0]?.items;
    if (Array.isArray(items)) {
      console.log(`   عدد الأصناف: ${items.length}`);
      items.slice(0, 3).forEach((item, i) => {
        console.log(`   ├─ صنف ${i+1}: ${item.name || item.menuItemName || 'N/A'} | كمية: ${item.quantity || item.weight || 0} | سعر: ${item.total || item.price || 0}`);
      });
    }
  } else {
    console.log('\n⚠️ جميع الطلبات المسلَّمة لها مرتجعات — سنختبر على طلب له مرتجع');
    const withReturn = candidates[0];
    if (withReturn) {
      console.log(`   سنختبر العرض على: ${withReturn.id}`);
    }
  }

  // Get the app URL
  console.log('\n══════ معلومات الوصول ══════');
  console.log('URL: https://ahmedz.pages.dev');
}

main().catch(console.error);
