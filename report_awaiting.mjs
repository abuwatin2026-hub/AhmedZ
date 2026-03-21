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
  // Find orders awaiting collection
  // Check what statuses exist
  const statuses = await sql(`SELECT status, count(*) as cnt FROM public.orders GROUP BY status ORDER BY cnt DESC`);
  console.log('=== Order Statuses ===');
  statuses.forEach(s => console.log(`  ${s.status}: ${s.cnt}`));

  // Check payment_status or terms
  const payStatuses = await sql(`
    SELECT payment_status, count(*) as cnt FROM public.orders 
    WHERE payment_status IS NOT NULL
    GROUP BY payment_status ORDER BY cnt DESC
  `).catch(() => []);
  if (payStatuses.length > 0) {
    console.log('\n=== Payment Statuses ===');
    payStatuses.forEach(s => console.log(`  ${s.payment_status}: ${s.cnt}`));
  }

  // Check terms field
  const terms = await sql(`
    SELECT payment_terms, count(*) as cnt FROM public.orders 
    WHERE payment_terms IS NOT NULL
    GROUP BY payment_terms ORDER BY cnt DESC
  `).catch(() => []);
  if (terms.length > 0) {
    console.log('\n=== Payment Terms ===');
    terms.forEach(t => console.log(`  ${t.payment_terms}: ${t.cnt}`));
  }

  // Orders with آجل/credit status (awaiting payment)
  console.log('\n=== Orders Awaiting Collection (آجل) ===');
  const awaitingOrders = await sql(`
    SELECT 
      o.id,
      LEFT(o.id::text, 8) as short_id,
      o.status,
      o.payment_terms,
      o.payment_status,
      coalesce(o.total, (o.data->>'total')::numeric, (o.data->>'subtotal')::numeric, 0) as total,
      o.currency,
      o.created_at::date as order_date,
      c.name as customer_name,
      c.phone as customer_phone,
      coalesce(o.paid_at::text, 'لم يُدفع') as paid_at,
      coalesce(
        (SELECT sum(p.amount) FROM public.payments p WHERE p.reference_table='orders' AND p.reference_id=o.id::text AND p.direction='in'),
        0
      ) as paid_amount
    FROM public.orders o
    LEFT JOIN public.customers c ON c.auth_user_id = o.customer_auth_user_id OR c.id::text = (o.data->>'customerId')
    WHERE 
      (o.payment_terms IN ('credit','آجل','deferred') 
       OR o.payment_status IN ('pending','unpaid','partial','awaiting')
       OR (o.status = 'delivered' AND o.paid_at IS NULL))
    ORDER BY o.created_at DESC
  `);
  
  console.log(`\nFound ${awaitingOrders.length} orders awaiting collection:`);
  let totalAwaiting = 0;
  let totalPaid = 0;
  awaitingOrders.forEach(o => {
    const remaining = o.total - o.paid_amount;
    totalAwaiting += parseFloat(o.total) || 0;
    totalPaid += parseFloat(o.paid_amount) || 0;
    console.log(`  #${o.short_id} | ${o.customer_name || 'بدون عميل'} | ${o.total} ${o.currency || 'SAR'} | paid: ${o.paid_amount} | remaining: ${remaining} | ${o.order_date} | status: ${o.status} | terms: ${o.payment_terms || '-'}`);
  });
  console.log(`\n  TOTAL: ${totalAwaiting} | PAID: ${totalPaid} | REMAINING: ${totalAwaiting - totalPaid}`);
  
  // Also check ar_open_items for unpaid invoices
  console.log('\n=== AR Open Items (ذمم مدينة مفتوحة) ===');
  const arOpen = await sql(`
    SELECT 
      poi.id, poi.invoice_id, poi.party_id, poi.original_amount, poi.open_balance, 
      poi.status, poi.due_date::text, poi.created_at::date as created,
      p.name as party_name
    FROM public.party_open_items poi
    LEFT JOIN public.parties p ON p.id = poi.party_id
    WHERE poi.status = 'open' AND poi.open_balance > 0
    ORDER BY poi.open_balance DESC
  `).catch(() => []);
  
  let totalOpen = 0;
  arOpen.forEach(a => {
    totalOpen += parseFloat(a.open_balance) || 0;
    console.log(`  ${a.party_name || a.party_id?.slice(0,8)} | original: ${a.original_amount} | balance: ${a.open_balance} | due: ${a.due_date || '-'} | ${a.created}`);
  });
  console.log(`  TOTAL OPEN: ${totalOpen}`);
}
main().catch(console.error);
