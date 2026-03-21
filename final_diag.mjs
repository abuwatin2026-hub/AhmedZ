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
  // 1. Verify the deployed function has the bypass
  const fn = await sql(`SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname='process_sales_return' AND pronamespace='public'::regnamespace LIMIT 1`);
  const body = fn[0].def;
  console.log('Deployed function checks:');
  console.log('  accounting_bypass:', body.includes('accounting_bypass') ? '✅' : '❌');
  console.log('  v_items_jsonb guard:', body.includes('v_items_jsonb') ? '✅' : '❌');
  console.log('  uomQtyInBase:', body.includes('uomQtyInBase') ? '✅' : '❌');
  
  // 2. Actually run step-by-step with accounting bypass
  const draft = await sql(`SELECT id, order_id, refund_method, items FROM public.sales_returns WHERE status='draft' ORDER BY created_at DESC LIMIT 1`);
  const retId = draft[0]?.id;
  const ordId = draft[0]?.order_id;
  console.log(`\nTesting return: ${retId}`);
  console.log(`Order: ${ordId}`);
  console.log(`refund_method: ${draft[0]?.refund_method}`);
  
  // 3. Test: Can we insert a journal entry with old date and bypass?
  const bypass = await sql(`
    DO $$
    BEGIN
      PERFORM set_config('app.accounting_bypass', '1', true);
      INSERT INTO public.journal_entries(entry_date, memo, source_table, source_id, source_event, created_by, status)
      VALUES ('2026-02-01'::timestamptz, 'bypass test', 'sales_returns', '${retId}', 'bypass_debug', null, 'draft')
      ON CONFLICT (source_table, source_id, source_event) DO UPDATE SET memo = 'bypass test updated';
    END;
    $$ LANGUAGE plpgsql;
  `).catch(e => ({error: e.message}));
  
  if (bypass.error) {
    console.log('\n❌ Bypass test FAILED:', bypass.error.slice(0, 300));
  } else {
    console.log('\n✅ Bypass test OK - backdated insert succeeded');
    // Clean up
    await sql(`DELETE FROM public.journal_entries WHERE source_table='sales_returns' AND source_id='${retId}' AND source_event='bypass_debug'`).catch(()=>{});
  }
  
  // 4. Check where 22023 comes from - test each jsonb operation on the actual items
  const ret = draft[0];
  const items = ret.items;
  console.log(`\nItems type: ${typeof items} | isArray: ${Array.isArray(items)}`);
  
  if (items) {
    const firstItem = Array.isArray(items) ? items[0] : items;
    console.log('First item:', JSON.stringify(firstItem).slice(0, 300));
    
    // Check if uomQtyInBase field exists
    const qty = firstItem?.uomQtyInBase || firstItem?.quantity || firstItem?.qty;
    console.log('Quantity to return:', qty);
    
    // Check sale_out movements for the order
    if (firstItem?.itemId) {
      const movements = await sql(`
        SELECT id, quantity, batch_id, warehouse_id, item_id 
        FROM public.inventory_movements 
        WHERE reference_table='orders' AND reference_id='${ordId}' 
        AND movement_type='sale_out' AND item_id='${firstItem.itemId}'
        LIMIT 5
      `);
      console.log(`\nSale_out movements for item ${firstItem.itemId}:`, movements.length, JSON.stringify(movements).slice(0, 300));
    }
  }
  
  // 5. Is there something with batch_balances that might cause 22023?
  const bbCols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='batch_balances' AND table_schema='public' ORDER BY ordinal_position`).catch(()=>[]);
  console.log('\nbatch_balances columns:', bbCols.map(c=>c.column_name).join(', '));
  
  // 6. Check post_inventory_movement_core function
  const pimCore = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='post_inventory_movement_core' AND pronamespace='public'::regnamespace LIMIT 1`);
  const coreBody = pimCore[0]?.def || '';
  const coreLines = coreBody.split('\n').filter(l => l.includes('jsonb_array_elements') || l.includes('22023') || l.includes('raise exception'));
  console.log('\npost_inventory_movement_core suspicious lines:', coreLines.slice(0,5).join('\n  '));
}
main().catch(console.error);
