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
  const orders = await sql(`
    SELECT 
      o.id, LEFT(o.id::text, 8) as short_id, o.status,
      o.invoice_terms, o.payment_method, o.net_days, o.due_date::text,
      coalesce(o.total, 0) as order_total, o.currency,
      o.created_at::date as order_date,
      o.customer_name, o.phone_number,
      coalesce(
        (SELECT sum(p.amount) FROM public.payments p WHERE p.reference_table='orders' AND p.reference_id=o.id::text AND p.direction='in'),
        0
      ) as paid_amount
    FROM public.orders o
    WHERE o.status = 'delivered'
    ORDER BY o.created_at DESC
  `);

  const awaiting = orders.filter(o => {
    const total = parseFloat(o.order_total) || 0;
    const paid = parseFloat(o.paid_amount) || 0;
    return total > 0 && paid < total;
  });

  console.log(`إجمالي الطلبات المسلّمة: ${orders.length} | بانتظار التحصيل: ${awaiting.length}\n`);
  
  let grandTotal = 0, grandPaid = 0;
  awaiting.forEach((o, i) => {
    const total = parseFloat(o.order_total) || 0;
    const paid = parseFloat(o.paid_amount) || 0;
    const remaining = total - paid;
    grandTotal += total;
    grandPaid += paid;
    console.log(`${i+1}. #${o.short_id} | ${o.customer_name || '-'} | ${o.phone_number || '-'} | المبلغ: ${total} ${o.currency||'SAR'} | مدفوع: ${paid} | متبقي: ${remaining} | ${o.order_date} | ${o.invoice_terms||o.payment_method||'-'} | استحقاق: ${o.due_date||'-'}`);
  });
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  عدد الطلبات بانتظار التحصيل: ${awaiting.length}`);
  console.log(`  إجمالي المبالغ: ${grandTotal}`);
  console.log(`  إجمالي المدفوع: ${grandPaid}`);
  console.log(`  إجمالي المتبقي: ${grandTotal - grandPaid}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}
main().catch(console.error);
