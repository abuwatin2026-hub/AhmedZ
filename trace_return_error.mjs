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
  // First find orders matching E27F4C
  const orders = await sql(`SELECT id, status, currency, total, data->>'currency' as dcurr FROM public.orders WHERE id::text ILIKE '%E27F4C%' OR id::text ILIKE '%e27f4c%' LIMIT 3`);
  console.log('Order E27F4C:', JSON.stringify(orders));
  
  // Also try by short code
  const orders2 = await sql(`SELECT id, status, currency, total, data->>'orderSource' src FROM public.orders WHERE upper(id::text) LIKE '%E27F4C%' LIMIT 5`);
  console.log('Orders matching E27F4C:', orders2.map(o => `${o.id} | ${o.status} | ${o.total}`).join('\n'));

  // Find draft sales_returns
  const drafts = await sql(`
    SELECT sr.id as return_id, sr.order_id, sr.refund_method, sr.total_refund_amount, sr.status,
           o.total as order_total, o.status as order_status, o.currency
    FROM public.sales_returns sr
    JOIN public.orders o ON o.id = sr.order_id
    WHERE sr.status = 'draft'
    ORDER BY sr.created_at DESC
    LIMIT 5
  `);
  console.log('\nDraft returns:', drafts.map(d => `${d.return_id.slice(-8)} | order:${d.order_id.slice(-8)} | ${d.refund_method} | ${d.total_refund_amount} | orderTotal:${d.order_total} ${d.currency} | orderStatus:${d.order_status}`).join('\n'));
  
  // Let's try to simulate what happens in process_sales_return for a specific return
  if (drafts.length > 0) {
    const ret = drafts[0];
    console.log(`\nSimulating process for return ${ret.return_id}...`);
    
    // Step by step simulation
    const orderData = await sql(`
      SELECT o.*, 
        coalesce(nullif((o.data->>'subtotal')::numeric,null), o.subtotal, 0) as subtotal_calc,
        coalesce(nullif((o.data->>'discountAmount')::numeric,null), o.discount, 0) as discount_calc,
        o.data->>'currency' as data_currency,
        o.data->>'fxRate' as data_fxrate,
        o.fx_rate
      FROM public.orders o WHERE o.id = '${ret.order_id}'
    `);
    const ord = orderData[0];
    console.log(`Order: subtotal=${ord.subtotal_calc} | discount=${ord.discount_calc} | currency=${ord.currency || ord.data_currency} | fx=${ord.fx_rate || ord.data_fxrate}`);
    
    // Check if get_base_currency works
    const baseCurr = await sql(`SELECT public.get_base_currency() as base`);
    console.log('Base currency:', baseCurr[0].base);
    
    // Check payments for this order
    const payments = await sql(`
      SELECT direction, method, amount, currency, status
      FROM public.payments 
      WHERE reference_table = 'orders' AND reference_id = '${ret.order_id}'
    `);
    console.log('Order payments:', JSON.stringify(payments));
    
    // Check refund_method mapping
    const rm = ret.refund_method;
    const mappedMethod = rm === 'ar' ? 'ar' : rm === 'store_credit' ? 'store_credit' : rm;
    console.log('Refund method:', rm, '→', mappedMethod);
    
    // Check items in the return
    const retItems = await sql(`SELECT items, jsonb_typeof(items) as items_type FROM public.sales_returns WHERE id = '${ret.return_id}'`);
    console.log('Items type:', retItems[0].items_type, '| items:', JSON.stringify(retItems[0].items).slice(0, 300));
    
    // Try calling process_sales_return as service role (this will bypass auth check)
    // But first check if items is the problem
    if (retItems[0].items_type === 'array') {
      const firstItem = Array.isArray(retItems[0].items) ? retItems[0].items[0] : JSON.parse(retItems[0].items)[0];
      console.log('\nFirst item keys:', Object.keys(firstItem || {}).join(', '));
      console.log('First item:', JSON.stringify(firstItem).slice(0, 200));
      
      // Check inventory for this item
      if (firstItem?.itemId) {
        const invMov = await sql(`
          SELECT id, quantity, batch_id, warehouse_id FROM public.inventory_movements 
          WHERE reference_table='orders' AND reference_id='${ret.order_id}' 
          AND item_id='${firstItem.itemId}' AND movement_type='sale_out'
          LIMIT 5
        `);
        console.log('\nSale_out movements for item:', JSON.stringify(invMov));
      }
    }
  }
  
  // Most importantly: test the SalesReturnContext createReturn API call
  // to see what payload is sent and where 22023 comes from
  const fnCheck = await sql(`
    SELECT pg_get_functiondef(oid) as def FROM pg_proc
    WHERE proname='process_sales_return' AND pronamespace='public'::regnamespace
    LIMIT 1
  `);
  const newFn = fnCheck[0].def;
  const hasJsonbGuard = newFn.includes('v_items_jsonb');
  const hasUomPriority = newFn.includes('uomQtyInBase');
  console.log('\nFixed function deployed:');
  console.log('  v_items_jsonb guard:', hasJsonbGuard ? '✅' : '❌');
  console.log('  uomQtyInBase priority:', hasUomPriority ? '✅' : '❌');
}
main().catch(console.error);
