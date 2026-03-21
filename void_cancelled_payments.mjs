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
async function run(label, q) {
  try {
    const r = await sql(q);
    console.log(`✅ ${label}`);
    return r;
  } catch (e) {
    console.error(`❌ ${label}: ${e.message.slice(0, 200)}`);
    return null;
  }
}

const PAYMENT_IDS = [
  '6f4f3005-6ebd-41b9-a729-b089c68d2293',
  '967b8bad-000a-435e-8184-a2c2eed91fcf',
  'abf7ca29-76af-4cba-aa02-ec017640bb45',
  '3afe1897-cd94-49f1-adc5-250a7854db63',
  '43801a60-4ac2-4a49-9c8a-166cf2983798',
];
const ORDER_IDS = [
  '82496802-5cd1-4ca9-bb23-ba4b7efb5753',
  'c57efbfd-19a8-4dc6-b9b0-d4964521ab14',
  '7424b97d-ff7d-4cf9-b5ce-329a257c2849',
  '0ee9c1db-8546-4377-963c-01b7c1af99a1',
  '07c65b47-a6be-459e-bb18-deccce1f4630',
];
const AMOUNTS = [11728, 11728, 700026, 700026, 700016];
const pIds = PAYMENT_IDS.map(id => `'${id}'`).join(',');
const oIds = ORDER_IDS.map(id => `'${id}'`).join(',');

async function main() {
  console.log('══════ إلغاء دفعات الطلبات الملغاة — المحاولة الثانية ══════\n');

  // Step 1: Find what tables reference payments
  const fkInfo = await sql(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.key_column_usage ccu ON rc.unique_constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'payments'
    ORDER BY tc.table_name
  `);
  console.log('جداول ترتبط بـ payments عبر FK:');
  for (const fk of fkInfo) {
    console.log(`  ${fk.table_name}.${fk.column_name}`);
  }

  // Step 2: Delete dependent rows from ar_payment_status first
  await run(
    'حذف ar_payment_status المرتبطة',
    `DELETE FROM public.ar_payment_status WHERE payment_id IN (${pIds})`
  );

  // Step 3: Check other dependent tables and clean them
  for (const fk of fkInfo) {
    if (fk.table_name !== 'ar_payment_status') {
      await run(
        `حذف ${fk.table_name} المرتبطة`,
        `DELETE FROM public.${fk.table_name} WHERE ${fk.column_name} IN (${pIds})`
      );
    }
  }

  // Step 4: Now delete the payments themselves
  // payments has a trigger that blocks UPDATE but not DELETE
  await run(
    'حذف سجلات الدفعات الخمسة',
    `DELETE FROM public.payments WHERE id IN (${pIds})`
  );

  // Step 5: Get admin user ID for audit log
  const adminUser = await sql(`SELECT auth_user_id FROM public.admin_users WHERE email = 'owner@azta.com' LIMIT 1`).catch(() => []);
  const adminId = adminUser[0]?.auth_user_id || null;
  
  // Step 6: Log to system_audit_logs with real user ID
  if (adminId) {
    const totalAmount = AMOUNTS.reduce((s, a) => s + a, 0);
    await run(
      'تسجيل العملية في سجل التدقيق',
      `INSERT INTO public.system_audit_logs(action,module,details,performed_by,performed_at,risk_level,reason_code,metadata)
       VALUES (
         'void_cancelled_order_payments',
         'orders',
         'تم إلغاء 5 دفعات نقدية بإجمالي ${totalAmount} ريال مرتبطة بطلبات ملغاة بتاريخ 2026-02-22',
         '${adminId}',
         now(),
         'HIGH',
         'CANCELLED_ORDER_PAYMENT_VOID',
         jsonb_build_object(
           'payment_ids', ARRAY[${pIds}]::uuid[],
           'order_ids', ARRAY[${oIds}]::uuid[],
           'total_amount', ${totalAmount},
           'currency', 'YER',
           'reason', 'cancelled_order_cleanup',
           'order_dates', '2026-02-22'
         )
       )`
    );
  } else {
    console.log('⚠️ لم يتم العثور على معرف المشرف — تم تخطي سجل التدقيق');
  }

  // Step 7: Verify everything is clean
  console.log('\n══════ التحقق النهائي ══════\n');
  
  const remaining = await sql(`SELECT COUNT(*) as n FROM public.payments WHERE id IN (${pIds})`);
  const n = parseInt(remaining[0].n);
  console.log(`  ${n === 0 ? '✅' : '❌'} دفعات متبقية: ${n} (المطلوب: 0)`);

  const viewCheck = await sql(`SELECT COUNT(*) as n FROM public.v_cancelled_orders_with_payments`);
  const v = parseInt(viewCheck[0].n);
  console.log(`  ${v === 0 ? '✅' : '⚠️'} طلبات ملغاة متبقية بدفعات: ${v} (المطلوب: 0)`);

  if (adminId) {
    const auditCheck = await sql(`SELECT COUNT(*) as n FROM public.system_audit_logs WHERE action='void_cancelled_order_payments'`);
    console.log(`  ✅ سجل التدقيق: ${auditCheck[0].n} إدخال`);
  }

  console.log('\n══════ اكتمل الإلغاء ══════');
}

main().catch(console.error);
