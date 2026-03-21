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
  console.log('══════ التحقق من دقة التقرير السابق ══════\n');

  // ── CHECK 1: 601K vs 22K discrepancy ─────────────────────────
  console.log('【1】 فحص التناقض: 601K دفعات vs 22K مبلغ مسترد\n');
  
  // What does the payments table actually contain for sales_returns?
  const refundDetails = await sql(`
    SELECT p.id, p.amount, p.currency, p.method, p.reference_id, p.occurred_at,
           sr.total_refund_amount, sr.status as return_status
    FROM public.payments p
    LEFT JOIN public.sales_returns sr ON sr.id::text = p.reference_id
    WHERE p.reference_table = 'sales_returns'
    ORDER BY p.amount DESC
    LIMIT 15
  `);
  console.log('  أكبر 15 دفعة مرتبطة بمرتجعات:');
  let totalPaid = 0;
  refundDetails.forEach(r => {
    totalPaid += Number(r.amount);
    console.log(`    ${Number(r.amount).toFixed(0)} ${r.currency} | ${r.method} | return_refund: ${Number(r.total_refund_amount||0).toFixed(0)} | status: ${r.return_status} | ${String(r.occurred_at).slice(0,10)}`);
  });
  
  const allRefunds = await sql(`
    SELECT COUNT(*) as n, SUM(amount) as total, SUM(ABS(amount)) as abs_total,
           MIN(amount) as min_amt, MAX(amount) as max_amt
    FROM public.payments WHERE reference_table='sales_returns'
  `);
  console.log(`\n  إجمالي دفعات المرتجعات: ${allRefunds[0].n} | مجموع: ${Number(allRefunds[0].total).toFixed(0)} | abs: ${Number(allRefunds[0].abs_total).toFixed(0)}`);
  console.log(`  أصغر دفعة: ${allRefunds[0].min_amt} | أكبر دفعة: ${allRefunds[0].max_amt}`);

  // ── CHECK 2: Are the 3 "overreturns" real? ───────────────────
  console.log('\n\n【2】 التحقق من 3 مرتجعات "تتجاوز قيمة الطلب"\n');
  const overReturns = await sql(`
    SELECT sr.id as return_id, sr.total_refund_amount as refund,
           o.total as order_total, o.subtotal as order_subtotal,
           o.data->>'total' as data_total, o.data->>'subtotal' as data_subtotal,
           o.data->>'discountAmount' as discount,
           o.data->>'deliveryFee' as delivery_fee,
           sr.total_refund_amount - COALESCE(o.total,0) as diff
    FROM public.sales_returns sr
    JOIN public.orders o ON o.id = sr.order_id
    WHERE sr.status = 'completed'
    AND sr.total_refund_amount > COALESCE(o.total, 0) * 1.01
    ORDER BY diff DESC
  `);
  if (overReturns.length === 0) {
    console.log('  ✅ لا توجد مرتجعات تتجاوز فعلاً — الفحص السابق غير دقيق');
  } else {
    console.log(`  ⚠️ ${overReturns.length} مرتجع يتجاوز قيمة الطلب:`);
    overReturns.forEach(r => {
      console.log(`    مرتجع: ${String(r.return_id).slice(-6)} | استرداد: ${Number(r.refund).toFixed(2)} | total: ${r.order_total} | subtotal: ${r.order_subtotal} | data.total: ${r.data_total} | data.subtotal: ${r.data_subtotal} | خصم: ${r.discount} | توصيل: ${r.delivery_fee} | فرق: ${Number(r.diff).toFixed(2)}`);
    });
  }

  // ── CHECK 3: hasReturn flag — is it in JSONB or column? ──────
  console.log('\n\n【3】 التحقق من hasReturn — هل هي JSONB أم عمود؟\n');
  
  // Check if hasReturn exists as a column
  const hasReturnCol = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name='has_return'`);
  console.log(`  عمود has_return في orders: ${hasReturnCol.length ? 'موجود' : 'غير موجود'}`);
  
  // Check if it's in data JSONB
  const hasReturnData = await sql(`
    SELECT COUNT(*) as total,
           COUNT(CASE WHEN data ? 'hasReturn' THEN 1 END) as has_key,
           COUNT(CASE WHEN (data->>'hasReturn')::boolean IS TRUE THEN 1 END) as is_true
    FROM public.orders
    WHERE id IN (SELECT order_id FROM public.sales_returns WHERE status='completed')
  `);
  console.log(`  طلبات ذات مرتجعات مكتملة: ${hasReturnData[0].total}`);
  console.log(`  منها تحتوي data.hasReturn: ${hasReturnData[0].has_key}`);
  console.log(`  منها hasReturn=true: ${hasReturnData[0].is_true}`);
  
  // Check if recompute_order_return_status uses different flag
  const returnFlags = await sql(`
    SELECT data->>'returnStatus' as return_status, COUNT(*) as n
    FROM public.orders
    WHERE id IN (SELECT order_id FROM public.sales_returns WHERE status='completed')
    GROUP BY return_status ORDER BY n DESC
  `).catch(() => []);
  console.log(`  returnStatus distribution:`, returnFlags.map(r => `${r.return_status}:${r.n}`).join(' | ') || '(لا يوجد)');

  // ── CHECK 4: store_credit returns — why 0 amount? ────────────
  console.log('\n\n【4】 مرتجعات الـ store_credit بمبلغ 0\n');
  const storeCreditReturns = await sql(`
    SELECT sr.id, sr.total_refund_amount, sr.items,
           o.total as order_total, o.data->>'total' as data_total
    FROM public.sales_returns sr
    JOIN public.orders o ON o.id = sr.order_id
    WHERE sr.refund_method = 'store_credit'
    ORDER BY sr.created_at DESC
    LIMIT 5
  `);
  storeCreditReturns.forEach(r => {
    const items = typeof r.items === 'string' ? JSON.parse(r.items) : r.items;
    const itemCount = Array.isArray(items) ? items.length : 0;
    console.log(`  مرتجع ${String(r.id).slice(-6)}: refund=${Number(r.total_refund_amount).toFixed(2)} | items: ${itemCount} | order total: ${r.order_total}`);
  });

  // ── CHECK 5: process_sales_return — what does it actually do? ─
  console.log('\n\n【5】 ما الذي يفعله process_sales_return بالفعل؟\n');
  const funcBody = await sql(`
    SELECT pg_get_functiondef(oid) as def
    FROM pg_proc
    WHERE proname = 'process_sales_return' AND pronamespace = 'public'::regnamespace
    LIMIT 1
  `);
  if (funcBody.length) {
    const def = funcBody[0].def;
    // Extract key operations from the function
    const hasStockRevert = /stock/i.test(def);
    const hasJournal = /journal/i.test(def);
    const hasPayment = /payment/i.test(def);
    const hasPartyLedger = /party_ledger/i.test(def);
    const hasInvoice = /invoice/i.test(def);
    console.log(`  ├─ المخزون (stock): ${hasStockRevert ? '✅' : '❌'}`);
    console.log(`  ├─ القيود المحاسبية (journal): ${hasJournal ? '✅' : '❌'}`);
    console.log(`  ├─ سجل الدفعات (payment): ${hasPayment ? '✅' : '❌'}`);
    console.log(`  ├─ دفتر الأستاذ (party_ledger): ${hasPartyLedger ? '✅' : '❌'}`);
    console.log(`  ├─ الفاتورة (invoice): ${hasInvoice ? '✅' : '❌'}`);
    // Print first 300 chars
    console.log(`\n  أول 500 حرف من الدالة:`);
    console.log(`  ${def.slice(0, 500).replace(/\n/g, '\n  ')}`);
  }

  // ── CHECK 6: Journal entries amounts vs return amounts ───────
  console.log('\n\n【6】 مطابقة مبالغ القيود vs المرتجعات\n');
  const jeSums = await sql(`
    SELECT 
      je.source_id,
      SUM(jl.debit) as total_debit,
      SUM(jl.credit) as total_credit,
      sr.total_refund_amount
    FROM public.journal_entries je
    JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
    JOIN public.sales_returns sr ON sr.id::text = je.source_id
    WHERE je.source_table = 'sales_returns' AND je.status = 'posted'
    GROUP BY je.source_id, sr.total_refund_amount
    HAVING ABS(SUM(jl.debit) - sr.total_refund_amount) > 1
    LIMIT 10
  `).catch(async () => {
    // Try simpler query
    return sql(`SELECT COUNT(*) as n FROM public.journal_entries WHERE source_table='sales_returns' AND status='posted'`);
  });
  
  if (Array.isArray(jeSums) && jeSums.length > 0 && jeSums[0].source_id) {
    console.log(`  ⚠️ ${jeSums.length} قيود مبالغها لا تتطابق مع المرتجع:`);
    jeSums.forEach(r => console.log(`    return ${String(r.source_id).slice(-6)}: JE debit=${Number(r.total_debit).toFixed(0)} vs refund=${Number(r.total_refund_amount).toFixed(0)}`));
  } else {
    console.log(`  ✅ (الفحص لم يجد تناقضات أو الجدول مختلف)`);
  }

  console.log('\n══════ انتهى التحقق ══════');
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
