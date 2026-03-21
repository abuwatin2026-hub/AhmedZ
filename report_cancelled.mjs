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

async function main() {
  const cancelled = await sql(`
    SELECT 
      o.id, LEFT(o.id::text, 8) as short_id,
      coalesce(o.total, 0) as order_total, o.currency,
      o.created_at::date as order_date,
      o.customer_name, o.phone_number,
      o.invoice_terms, o.payment_method,
      o.data->>'cancelledAt' as cancelled_at,
      o.data->>'cancelReason' as cancel_reason,
      -- Check if order was delivered before cancellation
      CASE 
        WHEN EXISTS (
          SELECT 1 FROM public.inventory_movements im 
          WHERE im.reference_table='orders' AND im.reference_id=o.id::text 
            AND im.movement_type='sale_out'
        ) THEN 'بعد التسليم'
        WHEN o.data->>'deliveredAt' IS NOT NULL THEN 'بعد التسليم'
        ELSE 'قبل التسليم'
      END as cancel_timing,
      -- Check if there were payments
      coalesce(
        (SELECT sum(p.amount) FROM public.payments p WHERE p.reference_table='orders' AND p.reference_id=o.id::text),
        0
      ) as total_payments,
      -- Check if has returns
      (SELECT count(*) FROM public.sales_returns sr WHERE sr.order_id = o.id) as return_count
    FROM public.orders o
    WHERE o.status = 'cancelled'
    ORDER BY o.created_at DESC
  `);

  const beforeDelivery = cancelled.filter(o => o.cancel_timing === 'قبل التسليم');
  const afterDelivery = cancelled.filter(o => o.cancel_timing === 'بعد التسليم');

  console.log(`إجمالي الطلبات الملغاة: ${cancelled.length}`);
  console.log(`  قبل التسليم: ${beforeDelivery.length}`);
  console.log(`  بعد التسليم: ${afterDelivery.length}`);

  console.log(`\n━━━ طلبات ملغاة قبل التسليم (${beforeDelivery.length}) ━━━`);
  let totalBefore = 0;
  beforeDelivery.forEach((o, i) => {
    const total = parseFloat(o.order_total) || 0;
    totalBefore += total;
    console.log(`${i+1}. #${o.short_id} | ${o.customer_name||'-'} | ${o.phone_number||'-'} | ${total} ${o.currency||'SAR'} | ${o.order_date} | ${o.payment_method||'-'} | سبب: ${o.cancel_reason||'-'} | مرتجعات: ${o.return_count}`);
  });
  console.log(`  إجمالي: ${totalBefore}`);

  console.log(`\n━━━ طلبات ملغاة بعد التسليم (${afterDelivery.length}) ━━━`);
  let totalAfter = 0;
  afterDelivery.forEach((o, i) => {
    const total = parseFloat(o.order_total) || 0;
    totalAfter += total;
    console.log(`${i+1}. #${o.short_id} | ${o.customer_name||'-'} | ${o.phone_number||'-'} | ${total} ${o.currency||'SAR'} | ${o.order_date} | مدفوعات: ${o.total_payments} | مرتجعات: ${o.return_count} | سبب: ${o.cancel_reason||'-'}`);
  });
  console.log(`  إجمالي: ${totalAfter}`);
}
main().catch(console.error);
