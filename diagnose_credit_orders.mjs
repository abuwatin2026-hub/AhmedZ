/**
 * Diagnostic: query production DB via Supabase Management API
 * Find credit orders incorrectly marked as fully paid.
 */
const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error('SQL ERROR:', t);
    throw new Error(`HTTP ${r.status}: ${t}`);
  }
  return r.json();
}

async function main() {
  console.log('=== Diagnosing Credit Orders Incorrectly Marked as Paid ===\n');

  // Step 1: Count all delivered credit orders with paidAt set
  const count = await sql(`
    SELECT COUNT(*) as total
    FROM public.orders o
    WHERE o.status = 'delivered'
      AND (o.data->>'paidAt') IS NOT NULL
      AND (
        lower(coalesce(o.data->>'invoiceTerms','')) = 'credit'
        OR (o.data->>'isCreditSale')::boolean = true
      )
  `);
  console.log(`Delivered credit orders with paidAt set: ${count[0].total}`);

  // Step 2: Of those, which have ONLY AR payments (no real cash)
  const falselyPaid = await sql(`
    SELECT 
      o.id,
      o.data->>'invoiceNumber' as invoice_number,
      o.data->>'customerName' as customer_name,
      o.data->>'total' as total,
      o.data->>'currency' as currency,
      o.data->>'paidAt' as paid_at,
      o.data->>'invoiceTerms' as invoice_terms,
      o.data->>'isCreditSale' as is_credit_sale,
      (
        SELECT COALESCE(SUM(CASE WHEN p.method <> 'ar' THEN p.amount ELSE 0 END), 0)
        FROM public.payments p
        WHERE p.reference_table = 'orders'
          AND p.reference_id = o.id::text
          AND p.direction = 'in'
      ) as real_payment_total,
      (
        SELECT COALESCE(SUM(CASE WHEN p.method = 'ar' THEN p.amount ELSE 0 END), 0)
        FROM public.payments p
        WHERE p.reference_table = 'orders'
          AND p.reference_id = o.id::text
          AND p.direction = 'in'
      ) as ar_payment_total,
      (
        SELECT json_agg(json_build_object('method', p.method, 'amount', p.amount))
        FROM public.payments p
        WHERE p.reference_table = 'orders'
          AND p.reference_id = o.id::text
          AND p.direction = 'in'
      ) as payments_list
    FROM public.orders o
    WHERE o.status = 'delivered'
      AND (o.data->>'paidAt') IS NOT NULL
      AND (
        lower(coalesce(o.data->>'invoiceTerms','')) = 'credit'
        OR (o.data->>'isCreditSale')::boolean = true
      )
    ORDER BY o.updated_at DESC
    LIMIT 100
  `);

  console.log(`\nTotal credit orders with paidAt: ${falselyPaid.length}`);

  // Categorize
  const onlyAr = falselyPaid.filter(o => 
    Number(o.real_payment_total) === 0 && Number(o.ar_payment_total) > 0
  );
  const mixed = falselyPaid.filter(o => 
    Number(o.real_payment_total) > 0 && Number(o.ar_payment_total) > 0
  );
  const noPayments = falselyPaid.filter(o =>
    Number(o.real_payment_total) === 0 && Number(o.ar_payment_total) === 0
  );

  console.log(`\n✅ With real payments (truly paid): ${mixed.length}`);
  console.log(`❌ Only AR payments (no real cash - FALSELY MARKED AS PAID): ${onlyAr.length}`);
  console.log(`⚠️  No payments at all but paidAt set: ${noPayments.length}`);

  if (onlyAr.length > 0) {
    console.log('\n--- Orders with ONLY AR payments (falsely marked as paid) ---');
    for (const o of onlyAr.slice(0, 20)) {
      console.log(`  ID: ${o.id}`);
      console.log(`  Invoice: ${o.invoice_number || 'N/A'}, Customer: ${o.customer_name || 'N/A'}`);
      console.log(`  Total: ${o.total} ${o.currency}, paidAt: ${o.paid_at}`);
      console.log(`  Payments: ${JSON.stringify(o.payments_list)}`);
      console.log('');
    }
  }

  // Save results
  const { writeFileSync } = await import('fs');
  writeFileSync('credit_orders_diagnosis.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    totalWithPaidAt: falselyPaid.length,
    onlyArPayments: onlyAr.length,
    mixedPayments: mixed.length,
    noPayments: noPayments.length,
    falselyPaidOrders: onlyAr,
  }, null, 2));
  console.log('\nSaved to credit_orders_diagnosis.json');
}

main().catch(console.error);
