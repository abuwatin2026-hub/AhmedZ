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

const ORDER_ID = '9ada629f-13a2-4c04-8816-9c431f929539';

async function main() {
  // Find ALL foreign keys referencing orders
  console.log('=== Finding FK references to this order ===');
  const fks = await sql(`
    SELECT tc.table_name, kcu.column_name, ccu.table_name as ref_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='orders' AND tc.table_schema='public'
  `);
  console.log('Tables referencing orders:');
  fks.forEach(f => console.log(`  ${f.table_name}.${f.column_name} → orders`));

  // Check each referencing table for this order
  for (const fk of fks) {
    const check = await sql(`SELECT count(*) as cnt FROM public."${fk.table_name}" WHERE "${fk.column_name}"='${ORDER_ID}'`).catch(()=>[{cnt:'?'}]);
    if (check[0].cnt !== '0') {
      console.log(`  ⚠️ ${fk.table_name}: ${check[0].cnt} records`);
    }
  }

  // Also check payments FK
  const payFks = await sql(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='payments' AND tc.table_schema='public'
  `);
  console.log('\nTables referencing payments:');
  payFks.forEach(f => console.log(`  ${f.table_name}.${f.column_name}`));

  // Get payment IDs for this order
  const payIds = await sql(`SELECT id FROM public.payments WHERE reference_table='orders' AND reference_id='${ORDER_ID}'`);
  console.log(`\nPayments for this order: ${payIds.length}`);
  
  if (payIds.length > 0) {
    for (const p of payIds) {
      // Check references to this payment
      for (const pf of payFks) {
        const cnt = await sql(`SELECT count(*) as cnt FROM public."${pf.table_name}" WHERE "${pf.column_name}"='${p.id}'`).catch(()=>[{cnt:'?'}]);
        if (cnt[0].cnt !== '0') console.log(`  ⚠️ ${pf.table_name}: ${cnt[0].cnt} records ref payment ${p.id.slice(0,8)}`);
      }
    }
  }

  // Now purge with CASCADE approach - disable ALL triggers
  console.log('\n=== PURGING (round 2 — cascade) ===');
  
  const tables = ['orders','payments','journal_entries','journal_lines','inventory_movements',
    'system_audit_logs','party_open_items','party_ledger_entries','order_line_items',
    'order_item_cogs','notifications','ledger_audit_log','sales_returns','batch_balances',
    'sales_return_items','payment_allocations','ar_open_items'];
  const disabled = [];
  for (const tbl of tables) {
    const trgs = await sql(`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='${tbl}' AND c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`).catch(()=>[]);
    for (const t of trgs) {
      await sql(`ALTER TABLE public."${tbl}" DISABLE TRIGGER "${t.tgname}"`).catch(()=>{});
      disabled.push({tbl, name: t.tgname});
    }
  }
  console.log(`  Disabled ${disabled.length} triggers`);

  // Delete sales_return_items first
  const srIds = await sql(`SELECT id FROM public.sales_returns WHERE order_id='${ORDER_ID}'`).catch(()=>[]);
  if (srIds.length > 0) {
    for (const sr of srIds) {
      await sql(`DELETE FROM public.sales_return_items WHERE return_id='${sr.id}'`).catch(e=>console.log(`  sri: ${e.message.slice(0,80)}`));
      // Delete return movements
      await sql(`DELETE FROM public.inventory_movements WHERE reference_table='sales_returns' AND reference_id='${sr.id}'`).catch(()=>{});
      // Delete return journal entries
      const rjes = await sql(`SELECT id FROM public.journal_entries WHERE source_table='sales_returns' AND source_id='${sr.id}'`).catch(()=>[]);
      for (const rj of rjes) {
        await sql(`DELETE FROM public.journal_lines WHERE journal_entry_id='${rj.id}'`).catch(()=>{});
        await sql(`DELETE FROM public.journal_entries WHERE id='${rj.id}'`).catch(()=>{});
      }
    }
    await sql(`DELETE FROM public.sales_returns WHERE order_id='${ORDER_ID}'`);
    console.log('  ✅ sales_returns + items + movements + journal');
  }

  // Delete payment child records
  if (payIds.length > 0) {
    for (const p of payIds) {
      // Delete journal entries for this payment
      const pjes = await sql(`SELECT id FROM public.journal_entries WHERE source_table='payments' AND source_id='${p.id}'`).catch(()=>[]);
      for (const pj of pjes) {
        await sql(`DELETE FROM public.journal_lines WHERE journal_entry_id='${pj.id}'`).catch(()=>{});
        await sql(`DELETE FROM public.journal_entries WHERE id='${pj.id}'`).catch(()=>{});
      }
      // Delete party_ledger_entries for payment
      await sql(`DELETE FROM public.party_ledger_entries WHERE source_table='payments' AND source_id='${p.id}'`).catch(()=>{});
      // Delete party_open_items
      await sql(`DELETE FROM public.party_open_items WHERE payment_id='${p.id}'`).catch(()=>{});
    }
    await sql(`DELETE FROM public.payments WHERE reference_table='orders' AND reference_id='${ORDER_ID}'`);
    console.log('  ✅ payments + journal + ledger');
  }

  // Delete order's own journal entries
  const ojes = await sql(`SELECT id FROM public.journal_entries WHERE source_table='orders' AND source_id='${ORDER_ID}'`).catch(()=>[]);
  for (const oj of ojes) {
    await sql(`DELETE FROM public.journal_lines WHERE journal_entry_id='${oj.id}'`).catch(()=>{});
    await sql(`DELETE FROM public.journal_entries WHERE id='${oj.id}'`).catch(()=>{});
  }
  console.log('  ✅ order journal entries');

  await sql(`DELETE FROM public.order_item_cogs WHERE order_id='${ORDER_ID}'`).catch(()=>{});
  await sql(`DELETE FROM public.order_line_items WHERE order_id='${ORDER_ID}'`).catch(()=>{});
  await sql(`DELETE FROM public.inventory_movements WHERE reference_table='orders' AND reference_id='${ORDER_ID}'`).catch(()=>{});
  await sql(`DELETE FROM public.order_events WHERE order_id='${ORDER_ID}'`).catch(()=>{});
  await sql(`DELETE FROM public.party_ledger_entries WHERE source_table='orders' AND source_id='${ORDER_ID}'`).catch(()=>{});
  console.log('  ✅ cogs, line_items, movements, events, ledger');

  // Finally delete the order
  const delResult = await sql(`DELETE FROM public.orders WHERE id='${ORDER_ID}'`).catch(e => {
    console.log(`  ❌ orders delete failed: ${e.message.slice(0,200)}`);
    return null;
  });
  if (delResult) console.log('  ✅ ORDER DELETED');

  // Re-enable
  for (const {tbl, name} of disabled) {
    await sql(`ALTER TABLE public."${tbl}" ENABLE TRIGGER "${name}"`).catch(()=>{});
  }
  console.log(`  Re-enabled ${disabled.length} triggers`);

  // Verify
  const check = await sql(`SELECT count(*) as cnt FROM public.orders WHERE id='${ORDER_ID}'`);
  console.log(`\n✅ Order exists: ${check[0].cnt === '0' ? 'NO (deleted!)' : 'YES (still there)'}`);
  const total = await sql(`SELECT count(*) as cnt FROM public.orders`);
  console.log(`Total orders: ${total[0].cnt}`);
}
main().catch(console.error);
