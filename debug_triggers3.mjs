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
const fs = await import('fs');

async function main() {
  // Read validate_sales_return_inventory_reference body
  const body = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='validate_sales_return_inventory_reference' LIMIT 1`);
  console.log('=== validate_sales_return_inventory_reference ===');
  console.log(body[0]?.def || 'NOT FOUND');
  
  // Read trg_set_qty_base_inventory_movements body
  const qb = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='trg_set_qty_base_inventory_movements' LIMIT 1`);
  console.log('\n=== trg_set_qty_base_inventory_movements ===');
  console.log(qb[0]?.def || 'NOT FOUND');
  
  // Read trg_inventory_movement_requires_journal_entry
  const je = await sql(`SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname='trg_inventory_movement_requires_journal_entry' LIMIT 1`);
  console.log('\n=== trg_inventory_movement_requires_journal_entry ===');
  console.log(je[0]?.def?.slice(0, 1500) || 'NOT FOUND');
  
  // Try real return ID
  const draft = await sql(`SELECT id FROM public.sales_returns WHERE status='draft' LIMIT 1`);
  const returnId = draft[0]?.id;
  const batch = await sql(`SELECT b.id, b.item_id, b.warehouse_id, b.unit_cost FROM public.batches b WHERE b.unit_cost > 0 LIMIT 1`);
  const batchId = batch[0]?.id;
  const itemId = batch[0]?.item_id;
  const warehouseId = batch[0]?.warehouse_id;
  const unitCost = batch[0]?.unit_cost;
  
  console.log(`\nTesting with real return: ${returnId}`);
  
  const testInsert = await sql(`
    INSERT INTO public.inventory_movements(
      item_id, movement_type, quantity, unit_cost, total_cost,
      reference_table, reference_id, occurred_at, created_by, data,
      batch_id, warehouse_id
    )
    VALUES (
      '${itemId}'::text,
      'return_in',
      1,
      ${unitCost},
      ${unitCost},
      'sales_returns',
      '${returnId}',
      now(),
      null,
      jsonb_build_object('orderId', '00000000-0000-0000-0000-000000000000', 'sourceMovementId', '00000000-0000-0000-0000-000000000000'),
      '${batchId}'::uuid,
      '${warehouseId}'::uuid
    )
    RETURNING id
  `).catch(e => ({ error: e.message }));
  
  if (testInsert.error) {
    console.log('\n❌ Real return ID insert FAILED:', testInsert.error.slice(0, 500));
  } else {
    console.log('\n✅ Real return ID insert SUCCESS:', testInsert[0]?.id);
    await sql(`DELETE FROM public.inventory_movements WHERE id='${testInsert[0].id}'`).catch(()=>{});
    console.log('  (cleaned up)');
  }
}

main().catch(console.error);
