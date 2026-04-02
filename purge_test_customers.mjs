const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 600));
  return b;
}

async function main() {
  const testNames = ['newclient2026', 'freshtest2026', 'zabon2028customer2026'];
  
  // 1. Get customer columns first
  const cols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='customers' ORDER BY ordinal_position`);
  console.log('customers cols:', cols.map(c=>c.column_name).join(', '));
  const bizCols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='customers_business' ORDER BY ordinal_position`);
  console.log('customers_business cols:', bizCols.map(c=>c.column_name).join(', '));

  // 2. Get test customers
  const custs = await sql(`SELECT * FROM customers WHERE full_name IN ('${testNames.join("','")}')`);
  console.log(`\nFound ${custs.length} test customers:`);
  custs.forEach(c => console.log(`  ${JSON.stringify(c).slice(0,200)}`));

  if (custs.length === 0) { console.log('Nothing to delete!'); return; }

  const authIds = custs.map(c => c.auth_user_id).filter(Boolean);
  const custIds = custs.map(c => c.customer_id || c.id).filter(Boolean);
  console.log(`\nAuth IDs: ${authIds}`);
  console.log(`Customer IDs: ${custIds}`);

  // 3. Find their business records
  let bizIds = [];
  if (authIds.length > 0) {
    const biz = await sql(`SELECT * FROM customers_business WHERE auth_user_id IN ('${authIds.join("','")}')`).catch(()=>[]);
    bizIds = biz.map(b => b.customer_id || b.id).filter(Boolean);
    console.log(`Business IDs: ${bizIds}`);
  }

  // 4. Check orders
  if (authIds.length > 0) {
    const orders = await sql(`SELECT id::text, status FROM orders WHERE customer_auth_user_id IN ('${authIds.join("','")}')`);
    console.log(`\nOrders: ${orders.length}`);
    
    if (orders.length > 0) {
      const oidList = orders.map(o=>`'${o.id}'`).join(',');
      // Delete order children
      for (const tbl of ['ar_payment_status', 'sales_returns']) {
        try { await sql(`DELETE FROM ${tbl} WHERE order_id IN (${oidList})`); console.log(`  ✅ ${tbl}`); }
        catch(e) { console.log(`  ⏭️ ${tbl}`); }
      }
      // payments by reference
      try { await sql(`DELETE FROM payments WHERE reference_id IN (${oidList})`); console.log('  ✅ payments'); }
      catch(e) { console.log('  ⏭️ payments'); }
      // inventory_movements
      try { await sql(`DELETE FROM inventory_movements WHERE reference_id IN (${oidList})`); console.log('  ✅ inventory_movements'); }
      catch(e) { console.log('  ⏭️ inventory_movements'); }
      // journal_entries
      try { await sql(`DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE reference_id IN (${oidList}))`); console.log('  ✅ journal_lines'); }
      catch(e) { console.log('  ⏭️ journal_lines'); }
      try { await sql(`DELETE FROM journal_entries WHERE reference_id IN (${oidList})`); console.log('  ✅ journal_entries'); }
      catch(e) { console.log('  ⏭️ journal_entries'); }
      // Delete orders
      await sql(`DELETE FROM orders WHERE customer_auth_user_id IN ('${authIds.join("','")}')`);
      console.log('  ✅ orders');
    }
  }

  // 5. FK tables referencing customers
  const fkCust = await sql(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='customers' AND tc.table_schema='public'
  `);
  
  for (const fk of fkCust) {
    if (custIds.length > 0) {
      try {
        await sql(`DELETE FROM public."${fk.table_name}" WHERE "${fk.column_name}" IN (${custIds.map(i=>`'${i}'`).join(',')})`);
        console.log(`  ✅ ${fk.table_name}.${fk.column_name}`);
      } catch(e) { /* skip */ }
    }
  }

  // 6. Delete customers_business
  if (bizIds.length > 0) {
    try { await sql(`DELETE FROM customers_business WHERE auth_user_id IN ('${authIds.join("','")}')`); console.log('  ✅ customers_business'); }
    catch(e) { console.log(`  ⚠️ customers_business: ${e.message.slice(0,80)}`); }
  }

  // 7. Delete customers
  await sql(`DELETE FROM customers WHERE full_name IN ('${testNames.join("','")}')`);
  console.log('  ✅ customers');

  // 8. Delete auth users
  for (const aid of authIds) {
    try {
      await sql(`DELETE FROM auth.identities WHERE user_id='${aid}'`).catch(()=>{});
      await sql(`DELETE FROM auth.sessions WHERE user_id='${aid}'`).catch(()=>{});
      await sql(`DELETE FROM auth.refresh_tokens WHERE user_id='${aid}'`).catch(()=>{});
      await sql(`DELETE FROM auth.mfa_factors WHERE user_id='${aid}'`).catch(()=>{});
      await sql(`DELETE FROM auth.users WHERE id='${aid}'`);
      console.log(`  ✅ auth.users ${aid.slice(0,8)}`);
    } catch(e) { console.log(`  ⚠️ auth ${aid.slice(0,8)}: ${e.message.slice(0,80)}`); }
  }

  // 9. Verify
  console.log('\n=== Verify ===');
  const rem = await sql(`SELECT count(*) as c FROM customers WHERE full_name IN ('${testNames.join("','")}')`);
  console.log(`Test customers remaining: ${rem[0].c}`);
  const total = await sql(`SELECT count(*) as c FROM customers`);
  console.log(`Total customers: ${total[0].c}`);
}
main().catch(console.error);
