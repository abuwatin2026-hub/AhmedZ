const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
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
  // 1. Get _apply_ar_open_item_credit body
  const fn = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='_apply_ar_open_item_credit' AND pronamespace='public'::regnamespace LIMIT 1`);
  const body = fn[0]?.def || '';
  console.log('=== _apply_ar_open_item_credit ===');
  console.log(body.slice(0, 3000));
  
  // 2. Get trg_journal_entries_party_ledger_on_approve body  
  const fn2 = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='trg_journal_entries_party_ledger_on_approve' AND pronamespace='public'::regnamespace LIMIT 1`);
  const body2 = fn2[0]?.def || '';
  const suspLines2 = body2.split('\n').filter(l => l.includes('jsonb_array_elements') || l.includes('raise exception'));
  console.log('\n=== trg_journal_entries_party_ledger_on_approve suspicious lines ===');
  suspLines2.forEach(l => console.log(' ', l.trim()));
  
  // 3. Get check_journal_entry_balance body
  const fn3 = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='check_journal_entry_balance' AND pronamespace='public'::regnamespace LIMIT 1`);
  const body3 = fn3[0]?.def || '';
  const suspLines3 = body3.split('\n').filter(l => l.includes('jsonb_array_elements') || l.includes('raise exception') || l.includes('22023'));
  console.log('\n=== check_journal_entry_balance suspicious lines ===');
  suspLines3.slice(0, 10).forEach(l => console.log(' ', l.trim()));
  
  // 4. Test: call _apply_ar_open_item_credit directly for the draft order
  const draft = await sql(`SELECT sr.id, sr.order_id FROM public.sales_returns sr WHERE sr.status='draft' LIMIT 1`);
  const ordId = draft[0]?.order_id;
  console.log(`\nTesting _apply_ar_open_item_credit for order ${ordId}`);
  const test = await sql(`SELECT public._apply_ar_open_item_credit('${ordId}'::uuid, 100) as result`).catch(e => ({error: e.message}));
  if (test.error) {
    console.log('❌ _apply_ar_open_item_credit FAILED:', test.error.slice(0, 400));
  } else {
    console.log('✅ _apply_ar_open_item_credit OK:', JSON.stringify(test[0]));
  }
  
  // 5. Check ar_open_items table for the order
  const arItems = await sql(`SELECT * FROM public.ar_open_items WHERE order_id='${ordId}'::uuid LIMIT 3`).catch(() => []);
  console.log('\nAR open items for order:', JSON.stringify(arItems).slice(0,300));
}
main().catch(console.error);
