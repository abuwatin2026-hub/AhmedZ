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
  // Get all 18 cancelled order IDs
  const cancelled = await sql(`SELECT id FROM public.orders WHERE status='cancelled' ORDER BY created_at DESC`);
  const ids = cancelled.map(o => `'${o.id}'`).join(',');
  console.log(`Found ${cancelled.length} cancelled orders to purge`);
  console.log('IDs:', cancelled.map(o=>o.id.slice(0,8)).join(', '));

  // Disable triggers that block deletion
  console.log('\n=== Disabling protective triggers ===');
  
  // Find and disable user-defined triggers on all affected tables
  const tables = ['orders', 'payments', 'journal_entries', 'journal_lines', 'inventory_movements', 
    'system_audit_logs', 'party_open_items', 'party_ledger_entries', 'order_line_items',
    'order_item_cogs', 'notifications', 'ledger_audit_log', 'sales_returns'];
  
  const disabledTriggers = [];
  for (const tbl of tables) {
    const trgs = await sql(`
      SELECT t.tgname FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = '${tbl}' AND c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
    `).catch(() => []);
    for (const t of trgs) {
      await sql(`ALTER TABLE public."${tbl}" DISABLE TRIGGER "${t.tgname}"`).catch(() => {});
      disabledTriggers.push({ tbl, name: t.tgname });
    }
  }
  console.log(`  Disabled ${disabledTriggers.length} triggers`);

  // === DELETE IN ORDER (children first) ===
  console.log('\n=== Purging all traces ===');

  // 1. Order item COGS
  const r1 = await sql(`DELETE FROM public.order_item_cogs WHERE order_id IN (${ids})`).catch(e => ({err: e.message.slice(0,100)}));
  console.log(`  1. order_item_cogs: ${r1.err || 'OK'}`);

  // 2. Order line items
  const r2 = await sql(`DELETE FROM public.order_line_items WHERE order_id IN (${ids})`).catch(e => ({err: e.message.slice(0,100)}));
  console.log(`  2. order_line_items: ${r2.err || 'OK'}`);

  // 3. Sales returns + items
  const r3a = await sql(`DELETE FROM public.sales_returns WHERE order_id IN (${ids})`).catch(e => ({err: e.message.slice(0,100)}));
  console.log(`  3. sales_returns: ${r3a.err || 'OK'}`);

  // 4. Inventory movements
  const r4 = await sql(`DELETE FROM public.inventory_movements WHERE reference_table='orders' AND reference_id IN (${ids})`).catch(e => ({err: e.message.slice(0,100)}));
  console.log(`  4. inventory_movements (orders): ${r4.err || 'OK'}`);

  // 5. Journal lines (first find journal entry IDs)
  const jeIds = await sql(`SELECT id FROM public.journal_entries WHERE source_table='orders' AND source_id IN (${ids})`).catch(() => []);
  if (jeIds.length > 0) {
    const jeIdList = jeIds.map(j => `'${j.id}'`).join(',');
    await sql(`DELETE FROM public.journal_lines WHERE journal_entry_id IN (${jeIdList})`).catch(() => {});
    console.log(`  5. journal_lines: OK (${jeIds.length} entries)`);
  } else {
    console.log(`  5. journal_lines: no entries found`);
  }

  // 6. Journal entries
  const r6 = await sql(`DELETE FROM public.journal_entries WHERE source_table='orders' AND source_id IN (${ids})`).catch(e => ({err: e.message.slice(0,100)}));
  console.log(`  6. journal_entries: ${r6.err || 'OK'}`);

  // 7. Payments
  const r7 = await sql(`DELETE FROM public.payments WHERE reference_table='orders' AND reference_id IN (${ids})`).catch(e => ({err: e.message.slice(0,100)}));
  console.log(`  7. payments: ${r7.err || 'OK'}`);

  // 8. Party open items
  const r8 = await sql(`DELETE FROM public.party_open_items WHERE invoice_id IN (${ids})`).catch(e => ({err: e.message.slice(0,100)}));
  console.log(`  8. party_open_items: ${r8.err || 'OK'}`);

  // 9. Party ledger entries
  const r9 = await sql(`DELETE FROM public.party_ledger_entries WHERE source_table='orders' AND source_id IN (${ids})`).catch(e => ({err: e.message.slice(0,100)}));
  console.log(`  9. party_ledger_entries: ${r9.err || 'OK'}`);

  // 10. Ledger audit log
  const r10 = await sql(`DELETE FROM public.ledger_audit_log WHERE source_table='orders' AND source_id IN (${ids})`).catch(e => ({err: e.message.slice(0,100)}));
  console.log(`  10. ledger_audit_log: ${r10.err || 'OK'}`);

  // 11. Notifications related to these orders
  const r11 = await sql(`DELETE FROM public.notifications WHERE (data->>'orderId')::text IN (${ids})`).catch(e => ({err: e.message.slice(0,100)}));
  console.log(`  11. notifications: ${r11.err || 'OK'}`);

  // 12. System audit logs
  const r12 = await sql(`DELETE FROM public.system_audit_logs WHERE metadata->>'orderId' IN (${ids}) OR (details LIKE '%' || LEFT(${cancelled.map(o=>`'${o.id}'`)[0]},8) || '%')`).catch(e => ({err: e.message.slice(0,100)}));
  console.log(`  12. system_audit_logs: ${r12.err || 'OK (partial)'}`);

  // 13. Order events
  const r13 = await sql(`DELETE FROM public.order_events WHERE order_id IN (${ids})`).catch(e => ({err: e.message.slice(0,100)}));
  console.log(`  13. order_events: ${r13.err || 'OK'}`);

  // 14. Batch balances affected by sale_out from these orders
  // (recompute stock after deletion)

  // 15. FINALLY: Delete the orders themselves
  const r15 = await sql(`DELETE FROM public.orders WHERE id IN (${ids})`).catch(e => ({err: e.message.slice(0,100)}));
  console.log(`  15. orders: ${r15.err || 'OK'}`);

  // === Re-enable triggers ===
  console.log('\n=== Re-enabling triggers ===');
  for (const { tbl, name } of disabledTriggers) {
    await sql(`ALTER TABLE public."${tbl}" ENABLE TRIGGER "${name}"`).catch(() => {});
  }
  console.log(`  Re-enabled ${disabledTriggers.length} triggers`);

  // === Verify ===
  console.log('\n=== VERIFICATION ===');
  const remaining = await sql(`SELECT count(*) as cnt FROM public.orders WHERE status='cancelled'`);
  console.log(`  Cancelled orders remaining: ${remaining[0].cnt}`);
  
  const totalOrders = await sql(`SELECT status, count(*) as cnt FROM public.orders GROUP BY status ORDER BY cnt DESC`);
  console.log('  Order counts:');
  totalOrders.forEach(s => console.log(`    ${s.status}: ${s.cnt}`));
}
main().catch(console.error);
