const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 500));
  return b;
}

async function main() {
  console.log('══════ تحقيق في الدفعات المرتبطة بالطلبات الملغاة ══════\n');

  // 1. Full details of the 5 cancelled orders with payments
  const orders = await sql(`
    SELECT 
      o.id, o.status, o.customer_name,
      o.total AS order_total,
      o.payment_method,
      o.created_at,
      o.data->>'cancellationReason' AS cancel_reason,
      o.data->>'orderSource' AS source
    FROM public.orders o
    WHERE o.status = 'cancelled'
    AND EXISTS (SELECT 1 FROM public.payments p WHERE p.reference_id = o.id::text AND p.direction = 'in')
    ORDER BY o.total DESC
  `);
  
  console.log('【الطلبات الملغاة الخمسة】');
  for (const o of orders) {
    console.log(`\n  طلب: ${o.id}`);
    console.log(`  العميل: ${o.customer_name || 'غير محدد'}`);
    console.log(`  الإجمالي: ${o.order_total}`);
    console.log(`  طريقة الدفع: ${o.payment_method}`);
    console.log(`  تاريخ الإنشاء: ${String(o.created_at).slice(0,10)}`);
    console.log(`  سبب الإلغاء: ${o.cancel_reason || 'غير مذكور'}`);
    console.log(`  المصدر: ${o.source}`);
  }

  // 2. The exact payment records
  const payments = await sql(`
    SELECT 
      p.id AS payment_id,
      p.reference_id AS order_id,
      p.amount,
      p.method,
      p.currency,
      p.occurred_at,
      p.data
    FROM public.payments p
    WHERE p.reference_id IN (
      SELECT o.id::text FROM public.orders o
      WHERE o.status = 'cancelled'
      AND EXISTS (SELECT 1 FROM public.payments p2 WHERE p2.reference_id = o.id::text AND p2.direction = 'in')
    )
    AND p.direction = 'in'
    ORDER BY p.occurred_at DESC
  `);
  
  console.log('\n\n【سجلات الدفعات】');
  for (const p of payments) {
    console.log(`\n  دفعة: ${p.payment_id}`);
    console.log(`  الطلب: ${String(p.order_id).slice(-6)}`);
    console.log(`  المبلغ: ${p.amount} ${p.currency || ''}`);
    console.log(`  الطريقة: ${p.method}`);
    console.log(`  التاريخ: ${String(p.occurred_at).slice(0,10)}`);
  }

  // 3. Check if any journal entries exist for these payments
  const orderIds = orders.map(o => `'${o.id}'`).join(',');
  const paymentIds = payments.map(p => `'${p.payment_id}'`).join(',');
  
  const journalEntries = await sql(`
    SELECT 
      je.id, je.status, je.source_table, je.source_id,
      je.description, je.total_debit, je.created_at
    FROM public.journal_entries je
    WHERE 
      (je.source_table = 'orders' AND je.source_id IN (${orderIds}))
      OR (je.source_table = 'payments' AND je.source_id IN (${paymentIds}))
    ORDER BY je.created_at DESC
  `);
  
  console.log('\n\n【القيود المحاسبية المرتبطة】');
  if (journalEntries.length === 0) {
    console.log('  ✅ لا توجد قيود محاسبية مرتبطة بهذه الدفعات');
    console.log('  ← يمكن حذف الدفعات مباشرة بأمان');
  } else {
    console.log(`  ⚠️ يوجد ${journalEntries.length} قيد محاسبي:`);
    for (const je of journalEntries) {
      console.log(`    قيد: ${je.id} | الحالة: ${je.status} | المبلغ: ${je.total_debit} | ${je.description}`);
    }
    console.log('  ← يجب عكس القيود قبل حذف الدفعات');
  }

  // 4. Check party_ledger_entries for these orders
  const ledgerEntries = await sql(`
    SELECT COUNT(*) as n, SUM(base_amount) as total
    FROM public.party_ledger_entries
    WHERE source_table = 'orders'
    AND source_id::uuid IN (${orderIds})
  `).catch(() => [{ n: 0, total: 0 }]);
  
  console.log(`\n  دفتر الأستاذ: ${ledgerEntries[0].n} سطر | مجموع: ${ledgerEntries[0].total || 0}`);
  
  // Summary
  const totalToVoid = payments.reduce((s, p) => s + Number(p.amount), 0);
  console.log(`\n\n══════ ملخص ══════`);
  console.log(`  عدد الطلبات الملغاة: ${orders.length}`);
  console.log(`  عدد الدفعات لإلغائها: ${payments.length}`);
  console.log(`  إجمالي المبالغ: ${totalToVoid.toFixed(2)}`);
  console.log(`  قيود محاسبية: ${journalEntries.length}`);
}

main().catch(console.error);
