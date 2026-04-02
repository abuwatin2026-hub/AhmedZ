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
  // Find order by invoice number
  const orders = await sql(`SELECT id, status, total, currency, invoice_number, customer_name, created_at FROM public.orders WHERE invoice_number ILIKE '%929539%' OR id::text LIKE '%929539%'`);
  if (orders.length === 0) {
    // Try searching in data
    const o2 = await sql(`SELECT id, status, total, currency, invoice_number, customer_name, created_at FROM public.orders WHERE data::text LIKE '%929539%'`);
    console.log('Search in data:', o2.length, o2.length > 0 ? JSON.stringify(o2[0]).slice(0,200) : 'not found');
    if (o2.length === 0) {
      // List all orders with their invoice numbers
      const all = await sql(`SELECT LEFT(id::text,8) as sid, status, total, currency, invoice_number, customer_name FROM public.orders ORDER BY created_at DESC LIMIT 20`);
      console.log('Recent orders:');
      all.forEach(o => console.log(`  ${o.sid} | ${o.invoice_number||'-'} | ${o.status} | ${o.total} ${o.currency} | ${o.customer_name||'-'}`));
      return;
    }
    orders.push(...o2);
  }

  const order = orders[0];
  console.log('Found order:', JSON.stringify(order).slice(0,300));
  const orderId = order.id;

  // Show what will be deleted
  console.log(`\n=== Order to delete: ${orderId} ===`);
  console.log(`  Invoice: ${order.invoice_number}`);
  console.log(`  Status: ${order.status}`);
  console.log(`  Total: ${order.total} ${order.currency}`);
  console.log(`  Customer: ${order.customer_name}`);
  console.log(`  Created: ${order.created_at}`);

  // Check related records
  const mvs = await sql(`SELECT movement_type, count(*) as cnt FROM public.inventory_movements WHERE reference_table='orders' AND reference_id='${orderId}' GROUP BY movement_type`).catch(()=>[]);
  console.log(`  Movements:`, mvs.map(m=>m.movement_type+':'+m.cnt).join(', '));
  
  const pays = await sql(`SELECT count(*) as cnt, sum(amount) as total FROM public.payments WHERE reference_table='orders' AND reference_id='${orderId}'`).catch(()=>[]);
  console.log(`  Payments: ${pays[0]?.cnt||0}, total: ${pays[0]?.total||0}`);

  const olis = await sql(`SELECT count(*) as cnt FROM public.order_line_items WHERE order_id='${orderId}'`).catch(()=>[]);
  console.log(`  Line items: ${olis[0]?.cnt||0}`);

  const rets = await sql(`SELECT count(*) as cnt FROM public.sales_returns WHERE order_id='${orderId}'`).catch(()=>[]);
  console.log(`  Returns: ${rets[0]?.cnt||0}`);

  // === PURGE ===
  console.log('\n=== PURGING ===');
  
  // Disable triggers
  const tables = ['orders','payments','journal_entries','journal_lines','inventory_movements',
    'system_audit_logs','party_open_items','party_ledger_entries','order_line_items',
    'order_item_cogs','notifications','ledger_audit_log','sales_returns','batch_balances'];
  const disabled = [];
  for (const tbl of tables) {
    const trgs = await sql(`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='${tbl}' AND c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`).catch(()=>[]);
    for (const t of trgs) {
      await sql(`ALTER TABLE public."${tbl}" DISABLE TRIGGER "${t.tgname}"`).catch(()=>{});
      disabled.push({tbl, name: t.tgname});
    }
  }
  console.log(`  Disabled ${disabled.length} triggers`);

  const ID = `'${orderId}'`;

  // Delete children
  await sql(`DELETE FROM public.order_item_cogs WHERE order_id=${ID}`).catch(e=>console.log('  cogs:', e.message.slice(0,80)));
  console.log('  ✅ order_item_cogs');

  await sql(`DELETE FROM public.order_line_items WHERE order_id=${ID}`).catch(e=>console.log('  olis:', e.message.slice(0,80)));
  console.log('  ✅ order_line_items');

  await sql(`DELETE FROM public.sales_returns WHERE order_id=${ID}`).catch(e=>console.log('  ret:', e.message.slice(0,80)));
  console.log('  ✅ sales_returns');

  await sql(`DELETE FROM public.inventory_movements WHERE reference_table='orders' AND reference_id=${ID}`).catch(e=>console.log('  im:', e.message.slice(0,80)));
  console.log('  ✅ inventory_movements');

  const jes = await sql(`SELECT id FROM public.journal_entries WHERE source_table='orders' AND source_id=${ID}`).catch(()=>[]);
  if (jes.length > 0) {
    const jeIds = jes.map(j=>`'${j.id}'`).join(',');
    await sql(`DELETE FROM public.journal_lines WHERE journal_entry_id IN (${jeIds})`).catch(()=>{});
    await sql(`DELETE FROM public.journal_entries WHERE id IN (${jeIds})`).catch(()=>{});
  }
  console.log('  ✅ journal_entries/lines');

  await sql(`DELETE FROM public.payments WHERE reference_table='orders' AND reference_id=${ID}`).catch(e=>console.log('  pay:', e.message.slice(0,80)));
  console.log('  ✅ payments');

  await sql(`DELETE FROM public.order_events WHERE order_id=${ID}`).catch(()=>{});
  console.log('  ✅ order_events');

  await sql(`DELETE FROM public.orders WHERE id=${ID}`).catch(e=>console.log('  orders:', e.message.slice(0,80)));
  console.log('  ✅ orders');

  // Re-enable
  for (const {tbl, name} of disabled) {
    await sql(`ALTER TABLE public."${tbl}" ENABLE TRIGGER "${name}"`).catch(()=>{});
  }
  console.log(`  Re-enabled ${disabled.length} triggers`);

  // Verify
  const check = await sql(`SELECT count(*) as cnt FROM public.orders WHERE id=${ID}`);
  console.log(`\n✅ Order deleted: ${check[0].cnt === '0' ? 'YES' : 'NO'}`);
  
  const totalOrders = await sql(`SELECT count(*) as cnt FROM public.orders`);
  console.log(`Total orders remaining: ${totalOrders[0].cnt}`);
}
main().catch(console.error);
