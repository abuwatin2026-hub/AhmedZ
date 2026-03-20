// Comprehensive audit of both settlement screens
const SBP_TOKEN = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP_TOKEN}` },
    body: JSON.stringify({ query: q }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(t); }
  return r.json();
}

const PASS = '✅', FAIL = '❌', WARN = '⚠️';

async function checkFunction(name) {
  try {
    const r = await sql(`SELECT proname, pronargs, prosrc IS NOT NULL as has_body FROM pg_proc WHERE proname = '${name}' AND pronamespace = 'public'::regnamespace;`);
    if (r.length === 0) return { ok: false, msg: 'غير موجودة' };
    return { ok: true, msg: `موجودة (${r.length} تعريف)` };
  } catch(e) { return { ok: false, msg: e.message.slice(0, 80) }; }
}

async function checkView(name) {
  try {
    const r = await sql(`SELECT viewname FROM pg_views WHERE viewname = '${name}' AND schemaname = 'public';`);
    return r.length > 0 ? { ok: true } : { ok: false, msg: 'غير موجود' };
  } catch(e) { return { ok: false, msg: e.message.slice(0,80) }; }
}

async function checkTable(name) {
  try {
    const r = await sql(`SELECT tablename FROM pg_tables WHERE tablename = '${name}' AND schemaname = 'public';`);
    return r.length > 0 ? { ok: true } : { ok: false, msg: 'غير موجود' };
  } catch(e) { return { ok: false, msg: e.message.slice(0,80) }; }
}

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  فحص شامل لقسمي التسويات — مساحة التسويات + COD');
  console.log('══════════════════════════════════════════════\n');

  // ── 1. Settlement Workspace RPCs ──────────────────
  console.log('【1】 مساحة التسويات المالية — RPCs والدوال\n');
  const settlementFunctions = [
    'list_party_open_items',
    'create_settlement',
    'auto_settle_party_items',
    'void_settlement',
    'backfill_party_open_items_for_party',
  ];
  for (const fn of settlementFunctions) {
    const r = await checkFunction(fn);
    console.log(`  ${r.ok ? PASS : FAIL} ${fn}: ${r.msg || 'موجودة'}`);
  }

  // ── 2. Settlement Tables ──────────────────────────
  console.log('\n【2】 جداول مساحة التسويات\n');
  const settlementTables = [
    'settlement_headers',
    'settlement_lines',
    'party_open_items',
    'party_ledger_entries',
    'financial_parties',
    'journal_entries',
    'journal_lines',
  ];
  for (const t of settlementTables) {
    const r = await checkTable(t);
    console.log(`  ${r.ok ? PASS : FAIL} ${t}: ${r.ok ? 'موجود' : r.msg}`);
  }

  // ── 3. COD Screen dependencies ────────────────────
  console.log('\n【3】 تسوية COD — الدوال والجداول\n');
  const codFn = await checkFunction('cod_settle_orders');
  console.log(`  ${codFn.ok ? PASS : FAIL} cod_settle_orders: ${codFn.msg || 'موجودة'}`);
  const codView = await checkView('v_cod_unsettled_orders');
  console.log(`  ${codView.ok ? PASS : FAIL} v_cod_unsettled_orders (view): ${codView.ok ? 'موجود' : codView.msg}`);

  // ── 4. Data sanity checks ─────────────────────────
  console.log('\n【4】 فحص البيانات الحالية\n');

  // Open items
  const openItems = await sql(`SELECT COUNT(*) as n, SUM(open_base_amount) as total FROM public.party_open_items WHERE status = 'open_active';`);
  console.log(`  ${PASS} party_open_items (مفتوحة): ${openItems[0].n} عنصر | إجمالي: ${Number(openItems[0].total||0).toFixed(2)}`);

  // Settlement headers
  const headers = await sql(`SELECT COUNT(*) as n, COUNT(CASE WHEN settlement_type='reversal' THEN 1 END) as reversals FROM public.settlement_headers;`);
  console.log(`  ${PASS} settlement_headers: ${headers[0].n} تسوية (منها ${headers[0].reversals} عكس)`);

  // COD unsettled
  try {
    const cod = await sql(`SELECT COUNT(*) as orders, SUM(remaining_amount) as total FROM public.v_cod_unsettled_orders;`);
    console.log(`  ${PASS} v_cod_unsettled_orders: ${cod[0].orders} طلب غير مسوَّى | إجمالي: ${Number(cod[0].total||0).toFixed(2)}`);
  } catch(e) {
    console.log(`  ${FAIL} v_cod_unsettled_orders: ${e.message.slice(0,100)}`);
  }

  // Financial parties
  const parties = await sql(`SELECT COUNT(*) as n FROM public.financial_parties WHERE is_active = true;`);
  console.log(`  ${PASS} financial_parties (نشطة): ${parties[0].n}`);

  // ── 5. Data flow: party_ledger → party_open_items ─
  console.log('\n【5】 تدفق البيانات: دفتر الأستاذ → العناصر المفتوحة\n');

  const plRows = await sql(`SELECT COUNT(*) as n FROM public.party_ledger_entries;`);
  console.log(`  ${PASS} party_ledger_entries: ${plRows[0].n} سطر`);

  const openLinked = await sql(`
    SELECT COUNT(*) as n
    FROM public.party_open_items poi
    WHERE poi.journal_line_id IS NOT NULL;
  `);
  console.log(`  ${PASS} عناصر مفتوحة مربوطة بقيد: ${openLinked[0].n}`);

  // ── 6. Trigger check ─────────────────────────────
  console.log('\n【6】 التحقق من الـ Triggers\n');
  const triggers = await sql(`
    SELECT trigger_name, event_object_table, event_manipulation, action_timing
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND (event_object_table IN ('journal_entries','party_open_items','party_ledger_entries') 
           OR trigger_name LIKE '%settle%' OR trigger_name LIKE '%party%')
    ORDER BY event_object_table, trigger_name;
  `);
  if (triggers.length === 0) {
    console.log(`  ${WARN} لا توجد triggers مرتبطة`);
  } else {
    for (const t of triggers) {
      console.log(`  ${PASS} ${t.event_object_table}.${t.trigger_name} [${t.event_manipulation} ${t.action_timing}]`);
    }
  }

  // ── 7. Permission checks ──────────────────────────
  console.log('\n【7】 صلاحيات الدوال (authenticated)\n');
  const permFns = ['list_party_open_items','create_settlement','auto_settle_party_items','void_settlement','cod_settle_orders','backfill_party_open_items_for_party'];
  for (const fn of permFns) {
    const r = await sql(`
      SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as granted;
    `).catch(() => [{ granted: null }]);
    const granted = r[0]?.granted;
    console.log(`  ${granted ? PASS : FAIL} ${fn}: ${granted ? 'مصرح (authenticated)' : 'غير مصرح أو غير موجودة'}`);
  }

  // ── 8. RLS check ─────────────────────────────────
  console.log('\n【8】 سياسات RLS\n');
  const rlsTables = ['financial_parties','party_ledger_entries','party_open_items','settlement_headers','settlement_lines'];
  for (const t of rlsTables) {
    const r = await sql(`SELECT relrowsecurity FROM pg_class WHERE relname = '${t}' AND relnamespace = 'public'::regnamespace;`);
    const enabled = r[0]?.relrowsecurity;
    const policies = await sql(`SELECT COUNT(*) as n FROM pg_policies WHERE tablename = '${t}' AND schemaname = 'public';`);
    const n = policies[0]?.n || 0;
    console.log(`  ${enabled ? PASS : WARN} ${t}: RLS ${enabled ? 'مُفعَّل' : 'غير مُفعَّل'} | ${n} سياسة`);
  }

  // ── 9. Integration: invoices / orders / purchases ─
  console.log('\n【9】 تكامل مع الأقسام الأخرى\n');
  const sourceCheck = await sql(`
    SELECT source_table, COUNT(*) as items, SUM(open_base_amount) as balance
    FROM public.party_open_items
    WHERE status = 'open_active'
    GROUP BY source_table
    ORDER BY balance DESC NULLS LAST;
  `);
  if (sourceCheck.length === 0) {
    console.log(`  ${WARN} لا توجد عناصر مفتوحة حالياً (قد تكون كلها مُسوَّاة)`);
  } else {
    console.log('  مصادر العناصر المفتوحة:');
    for (const r of sourceCheck) {
      console.log(`    ${PASS} ${r.source_table || 'manual'}: ${r.items} عنصر | رصيد: ${Number(r.balance||0).toFixed(2)}`);
    }
  }

  // ── Summary ───────────────────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log('  انتهى الفحص الشامل');
  console.log('══════════════════════════════════════════════\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
