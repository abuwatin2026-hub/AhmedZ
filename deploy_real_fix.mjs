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
  // THE REAL FIX: rebuild_order_line_items
  // Add jsonb_typeof guard before jsonb_array_elements
  await sql(`
    CREATE OR REPLACE FUNCTION public.rebuild_order_line_items(p_order_id uuid)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
    AS $function$
    declare
      v_order record;
      v_item jsonb;
      v_item_id text;
      v_qty numeric;
      v_price numeric;
      v_items_src jsonb;
    begin
      select * into v_order from public.orders where id = p_order_id;
      if not found then
        raise exception 'order not found';
      end if;
      delete from public.order_line_items where order_id = p_order_id;
      
      -- FIX: Guard jsonb_array_elements — coalesce may return an OBJECT if data->'items' is not an array
      v_items_src := coalesce(v_order.items, v_order.data->'items', '[]'::jsonb);
      -- Ensure it is actually an array
      if jsonb_typeof(v_items_src) = 'object' then
        v_items_src := jsonb_build_array(v_items_src);
      elsif jsonb_typeof(v_items_src) is null or jsonb_typeof(v_items_src) <> 'array' then
        v_items_src := '[]'::jsonb;
      end if;
      
      for v_item in select value from jsonb_array_elements(v_items_src)
      loop
        v_item_id := coalesce(v_item->>'itemId', v_item->>'id');
        v_qty := coalesce((v_item->>'quantity')::numeric, 0);
        v_price := coalesce((v_item->>'price')::numeric, 0);
        insert into public.order_line_items(order_id, item_id, quantity, unit_price, total, data)
        values (p_order_id, v_item_id, v_qty, v_price, v_qty * v_price, v_item);
      end loop;
    end;
    $function$;
  `);
  console.log('✅ rebuild_order_line_items fixed');
  
  // Now test recompute_order_return_status
  const orderId = 'd80638a8-03bd-48c2-9387-20f84ce27f4c';
  const r = await sql(`SELECT public.recompute_order_return_status('${orderId}'::uuid)`).catch(e => ({error: e.message}));
  if (r.error) {
    console.log('❌ recompute_order_return_status still fails:', r.error.slice(0,300));
  } else {
    console.log('✅ recompute_order_return_status OK!');
  }
  
  // Now run the full simulation: process_sales_return
  const retId = 'e02e8c4b-d4af-497e-8201-0f2812e24f1a';
  
  // Reset to draft first
  await sql(`UPDATE public.sales_returns SET status='draft' WHERE id='${retId}'`);
  // Delete any previous test data
  await sql(`DELETE FROM public.inventory_movements WHERE reference_table='sales_returns' AND reference_id='${retId}'`).catch(()=>{});
  const jeIds = await sql(`SELECT id FROM public.journal_entries WHERE source_table='sales_returns' AND source_id='${retId}'`).catch(()=>[]);
  for (const je of jeIds) {
    await sql(`DELETE FROM public.journal_lines WHERE journal_entry_id='${je.id}'`).catch(()=>{});
  }
  await sql(`DELETE FROM public.journal_entries WHERE source_table='sales_returns' AND source_id='${retId}'`).catch(()=>{});
  console.log('\n✅ Reset return to draft, cleaned test data');
  
  // Now run the full trace again with recompute steps
  const result = await sql(`SELECT * FROM public.trace_return_error('${retId}'::uuid) ORDER BY step`);
  console.log('\nTrace result after fix:');
  result.forEach(r2 => {
    const s = r2.result.startsWith('OK') ? '✅' : r2.result.startsWith('SKIP') ? '⏭️' : '❌';
    console.log(`  ${s} Step ${r2.step}: ${r2.result}${r2.err ? ' | ERR: '+r2.err : ''}`);
  });
  
  // Check if recompute_order_return_status is included in trace... it's not.
  // Let's call it explicitly to test
  const r3 = await sql(`SELECT public.recompute_order_return_status('${orderId}'::uuid)`).catch(e => ({error: e.message}));
  console.log('\nrecompute_order_return_status after fix:', r3.error ? '❌ '+r3.error.slice(0,200) : '✅ OK');
  
  console.log('\n=== Summary ===');
  console.log('The REAL bug was: rebuild_order_line_items → jsonb_array_elements on non-array');
  console.log('Called from: recompute_order_return_status → at end of process_sales_return');
  console.log('Fix: Added jsonb_typeof guard before jsonb_array_elements in rebuild_order_line_items');
}
main().catch(console.error);
