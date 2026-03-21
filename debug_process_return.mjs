const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 1000));
  return b;
}

async function main() {
  // Get a real draft return ID
  const drafts = await sql(`SELECT id, order_id, refund_method, total_refund_amount FROM public.sales_returns WHERE status='draft' LIMIT 3`);
  console.log('Draft returns:');
  drafts.forEach(d => console.log(`  ${d.id} | order: ${d.order_id} | ${d.refund_method} | ${d.total_refund_amount}`));
  
  // Try calling process_sales_return through a test wrapper that shows which line fails
  // We'll add detailed debug tracing by running parts of the function manually
  
  const draftId = drafts[0]?.id;
  if (!draftId) { console.log('No draft returns found'); return; }
  
  console.log(`\nTesting with return: ${draftId}`);
  
  // Test step 1: Get the return record
  const retRec = await sql(`SELECT *, jsonb_typeof(items) as items_type FROM public.sales_returns WHERE id='${draftId}'`);
  console.log('\nReturn record:', JSON.stringify(retRec[0]).slice(0, 300));
  console.log('items_type:', retRec[0].items_type);
  
  // Test step 2: Get the order
  const ordRec = await sql(`SELECT id, status, currency, fx_rate, data->>'currency' as data_currency FROM public.orders WHERE id='${retRec[0].order_id}'`);
  console.log('\nOrder status:', ordRec[0]?.status);
  
  // Test step 3: Try jsonb_array_elements manually
  const arrTest = await sql(`SELECT value FROM jsonb_array_elements('${JSON.stringify(retRec[0].items).replace(/'/g,"''")}'::jsonb) LIMIT 1`).catch(e => { return [{error: e.message}]; });
  console.log('\njsonb_array_elements test:', JSON.stringify(arrTest[0]).slice(0, 200));
  
  // Test step 4: Check if account codes exist
  const accts = await sql(`
    SELECT code, name FROM public.chart_of_accounts 
    WHERE code IN ('1010','1020','1200','2050','4026','2020')
    ORDER BY code
  `).catch(() => []);
  console.log('\nAccount codes found:', accts.map(a => `${a.code}:${a.name}`).join(' | '));
  
  // Test step 5: Check _require_staff function
  const staffFn = await sql(`SELECT proname FROM pg_proc WHERE proname='_require_staff'`).catch(()=>[]);
  console.log('\n_require_staff exists:', staffFn.length > 0);
  
  // Test step 6: Check has_admin_permission and can_manage_orders
  const permFns = await sql(`SELECT proname FROM pg_proc WHERE proname IN ('has_admin_permission','can_manage_orders') ORDER BY proname`).catch(()=>[]);
  console.log('Permission functions:', permFns.map(f=>f.proname).join(', '));

  // Test step 7: Check _resolve_open_shift_for_cash
  const shiftFn = await sql(`SELECT proname FROM pg_proc WHERE proname='_resolve_open_shift_for_cash'`).catch(()=>[]);
  console.log('_resolve_open_shift_for_cash exists:', shiftFn.length > 0);
  
  // Test step 8: Check get_account_id_by_code
  const acctIdFn = await sql(`SELECT proname FROM pg_proc WHERE proname='get_account_id_by_code'`).catch(()=>[]);
  console.log('get_account_id_by_code exists:', acctIdFn.length > 0);
  
  // Test step 9: Check get_fx_rate
  const fxFn = await sql(`SELECT proname FROM pg_proc WHERE proname='get_fx_rate'`).catch(()=>[]);
  console.log('get_fx_rate exists:', fxFn.length > 0);
  
  // Test step 10: Check _money_round
  const roundFn = await sql(`SELECT proname FROM pg_proc WHERE proname='_money_round'`).catch(()=>[]);
  console.log('_money_round exists:', roundFn.length > 0);
  
  // Test step 11: Check inventory_movements columns
  const imCols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='inventory_movements' AND table_schema='public' ORDER BY ordinal_position LIMIT 20`).catch(()=>[]);
  console.log('\ninventory_movements columns:', imCols.map(c=>c.column_name).join(', '));
  
  // Test step 12: Is there an open shift?
  const shifts = await sql(`SELECT id, status FROM public.cashier_shifts WHERE status='open' LIMIT 2`).catch(()=>[]);
  console.log('Open shifts:', shifts.length, shifts.map(s=>s.id.slice(-6)).join(', '));
  
  // Test step 13: Try calling the RPC via management API (as service_role)
  console.log('\n\nAttempting to call process_sales_return via RPC...');
  try {
    const result = await sql(`SELECT public.process_sales_return('${draftId}'::uuid)`);
    console.log('✅ SUCCESS:', JSON.stringify(result));
  } catch(e) {
    console.log('❌ ERROR:', e.message);
  }
}

main().catch(console.error);
