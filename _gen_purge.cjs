const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  'https://pmhivhtaoydfolseelyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec'
);

(async () => {
  try {
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: 'owner@azta.com',
      password: 'AhmedZ#123456'
    });
    if (authError) { console.error('Auth error:', authError.message); return; }

    const targetDate = '2026-05-10T00:00:00Z';

    // 1. Get Orders
    const { data: orders } = await supabase.from('orders').select('id').gte('created_at', targetDate);
    const orderIds = (orders || []).map(o => o.id);
    
    // 2. Get Batches
    const { data: batches } = await supabase.from('batches').select('id').gte('created_at', targetDate);
    const batchIds = (batches || []).map(b => b.id);

    // 3. Get Menu Items
    const { data: items } = await supabase.from('menu_items').select('id').gte('created_at', targetDate);
    const itemIds = (items || []).map(i => i.id);

    // 4. Get Customers
    const { data: customers } = await supabase.from('customers').select('auth_user_id').gte('created_at', targetDate);
    const customerIds = (customers || []).map(c => c.auth_user_id);

    // Generate SQL
    let sql = `-- Migration: Purge test data from ${targetDate} onwards\n\n`;
    sql += `set app.allow_ledger_ddl = '1';\n\n`;
    sql += `do $$\n`;
    sql += `declare\n`;
    
    if (orderIds.length > 0) {
      sql += `  v_order_ids uuid[] := array[\n    ${orderIds.map(id => `'${id}'::uuid`).join(',\n    ')}\n  ];\n`;
    } else {
      sql += `  v_order_ids uuid[] := array[]::uuid[];\n`;
    }

    if (itemIds.length > 0) {
      sql += `  v_item_ids uuid[] := array[\n    ${itemIds.map(id => `'${id}'::uuid`).join(',\n    ')}\n  ];\n`;
    } else {
      sql += `  v_item_ids uuid[] := array[]::uuid[];\n`;
    }

    if (batchIds.length > 0) {
      sql += `  v_batch_ids uuid[] := array[\n    ${batchIds.map(id => `'${id}'::uuid`).join(',\n    ')}\n  ];\n`;
    } else {
      sql += `  v_batch_ids uuid[] := array[]::uuid[];\n`;
    }

    if (customerIds.length > 0) {
      sql += `  v_customer_ids uuid[] := array[\n    ${customerIds.map(id => `'${id}'::uuid`).join(',\n    ')}\n  ];\n`;
    } else {
      sql += `  v_customer_ids uuid[] := array[]::uuid[];\n`;
    }

    sql += `  v_payment_ids uuid[];\n`;
    sql += `  v_mov_ids uuid[];\n`;
    sql += `  v_je_ids uuid[];\n`;
    sql += `  v_batch record;\n`;
    
    sql += `begin\n`;
    sql += `  raise notice 'Starting purge...';\n\n`;

    sql += `  -- Restore batch quantities for delivered orders (if the batch itself is NOT being deleted)\n`;
    sql += `  for v_batch in\n`;
    sql += `    select im.batch_id, sum(im.quantity) as qty\n`;
    sql += `    from public.inventory_movements im\n`;
    sql += `    where im.reference_id = any(v_order_ids::text[])\n`;
    sql += `      and im.movement_type = 'sale_out'\n`;
    sql += `      and im.batch_id is not null\n`;
    sql += `      and not (im.batch_id = any(v_batch_ids))\n`;
    sql += `    group by im.batch_id\n`;
    sql += `  loop\n`;
    sql += `    update public.batches\n`;
    sql += `    set quantity_consumed = greatest(0, coalesce(quantity_consumed, 0) - coalesce(v_batch.qty, 0))\n`;
    sql += `    where id = v_batch.batch_id;\n`;
    sql += `    raise notice 'Restored % units to batch %', v_batch.qty, v_batch.batch_id;\n`;
    sql += `  end loop;\n\n`;

    sql += `  -- Collect payment IDs\n`;
    sql += `  select array_agg(id) into v_payment_ids\n`;
    sql += `  from public.payments where reference_id = any(v_order_ids::text[]);\n\n`;

    sql += `  -- Collect inventory movement IDs\n`;
    sql += `  select array_agg(id) into v_mov_ids\n`;
    sql += `  from public.inventory_movements where reference_id = any(v_order_ids::text[]);\n\n`;

    sql += `  -- Collect journal entry IDs\n`;
    sql += `  select array_agg(id) into v_je_ids\n`;
    sql += `  from public.journal_entries\n`;
    sql += `  where source_id = any(\n`;
    sql += `    array(\n`;
    sql += `      select id::text from public.orders where id = any(v_order_ids)\n`;
    sql += `      union all\n`;
    sql += `      select id::text from public.payments where id = any(v_payment_ids)\n`;
    sql += `      union all\n`;
    sql += `      select id::text from public.inventory_movements where id = any(v_mov_ids)\n`;
    sql += `    )\n  );\n\n`;

    sql += `  -- 1. ar_open_items\n`;
    sql += `  delete from public.ar_open_items where invoice_id = any(v_order_ids);\n`;
    
    sql += `  -- 2. ar_payment_status\n`;
    sql += `  if v_payment_ids is not null and array_length(v_payment_ids,1) > 0 then\n`;
    sql += `    delete from public.ar_payment_status where payment_id = any(v_payment_ids);\n`;
    sql += `  end if;\n`;

    sql += `  -- 3. batch_sales_trace\n`;
    sql += `  delete from public.batch_sales_trace where order_id = any(v_order_ids);\n`;

    sql += `  -- 4. journal_lines & journal_entries\n`;
    sql += `  if v_je_ids is not null and array_length(v_je_ids,1) > 0 then\n`;
    sql += `    delete from public.journal_lines where journal_entry_id = any(v_je_ids);\n`;
    sql += `    delete from public.journal_entries where id = any(v_je_ids);\n`;
    sql += `  end if;\n`;

    sql += `  -- 5. inventory_movements\n`;
    sql += `  if v_mov_ids is not null and array_length(v_mov_ids,1) > 0 then\n`;
    sql += `    delete from public.inventory_movements where id = any(v_mov_ids);\n`;
    sql += `  end if;\n`;

    sql += `  -- 6. order_item_cogs\n`;
    sql += `  delete from public.order_item_cogs where order_id = any(v_order_ids);\n`;

    sql += `  -- 7. payments\n`;
    sql += `  if v_payment_ids is not null and array_length(v_payment_ids,1) > 0 then\n`;
    sql += `    delete from public.payments where id = any(v_payment_ids);\n`;
    sql += `  end if;\n`;

    sql += `  -- 8. order_item_reservations\n`;
    sql += `  delete from public.order_item_reservations where order_id = any(v_order_ids);\n`;

    sql += `  -- 9. party_credit_overrides\n`;
    sql += `  delete from public.party_credit_overrides where order_id = any(v_order_ids);\n`;

    sql += `  -- 10. orders\n`;
    sql += `  delete from public.orders where id = any(v_order_ids);\n\n`;

    sql += `  -- 11. item_uom, item_uom_units\n`;
    sql += `  if v_item_ids is not null and array_length(v_item_ids,1) > 0 then\n`;
    sql += `    delete from public.item_uom where item_id = any(v_item_ids::text[]);\n`;
    sql += `    delete from public.item_uom_units where item_id = any(v_item_ids::text[]);\n`;
    sql += `  end if;\n\n`;

    sql += `  -- 12. batches\n`;
    sql += `  if v_batch_ids is not null and array_length(v_batch_ids,1) > 0 then\n`;
    sql += `    delete from public.batches where id = any(v_batch_ids);\n`;
    sql += `  end if;\n\n`;

    sql += `  -- 13. stock_management\n`;
    sql += `  if v_item_ids is not null and array_length(v_item_ids,1) > 0 then\n`;
    sql += `    delete from public.stock_management where item_id = any(v_item_ids::text[]);\n`;
    sql += `  end if;\n\n`;

    sql += `  -- 14. menu_items\n`;
    sql += `  if v_item_ids is not null and array_length(v_item_ids,1) > 0 then\n`;
    sql += `    delete from public.menu_items where id = any(v_item_ids);\n`;
    sql += `  end if;\n\n`;

    sql += `  -- 15. customers\n`;
    sql += `  if v_customer_ids is not null and array_length(v_customer_ids,1) > 0 then\n`;
    sql += `    delete from public.customers where auth_user_id = any(v_customer_ids);\n`;
    sql += `  end if;\n\n`;

    sql += `  raise notice '✅ Purge complete';\n`;
    sql += `end $$;\n`;

    // Save migration file
    const timestamp = '20260511000000'; // Make it very recent
    const filename = `${timestamp}_purge_yesterday_today_test_data.sql`;
    const filepath = path.join(__dirname, 'supabase', 'migrations', filename);
    
    fs.writeFileSync(filepath, sql);
    console.log(`\nCreated migration file: ${filepath}`);

  } catch (e) { console.error('Error:', e.message); }
})();
