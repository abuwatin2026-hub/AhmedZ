import { createClient } from '@supabase/supabase-js';

// Use service_role key to query pg_proc directly
const supabase = createClient(
  'https://pmhivhtaoydfolseelyc.supabase.co',
  'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd'
);

async function run() {
  // 1. List all RPC-relevant functions
  console.log('=== All Public Functions Related to Orders/Sales ===');
  const { data: funcs, error: funcErr } = await supabase.rpc('exec_debug_sql', {
    p_sql: `SELECT p.proname, pg_catalog.pg_get_function_arguments(p.oid) as args
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      AND (p.proname LIKE '%order%'
        OR p.proname LIKE '%stock%'
        OR p.proname LIKE '%fefo%'
        OR p.proname LIKE '%payment%'
        OR p.proname LIKE '%invoice%'
        OR p.proname LIKE '%reserve%'
        OR p.proname LIKE '%fx%'
        OR p.proname LIKE '%uom%'
        OR p.proname LIKE '%delivery%'
        OR p.proname LIKE '%warehouse_item%')
      ORDER BY p.proname`
  });
  if (funcErr) {
    console.log('exec_debug_sql Error:', funcErr.message);
    console.log('Trying alternative approach...');
    
    // Try direct SQL via management API
    const { data: f2, error: f2Err } = await supabase
      .from('pg_catalog.pg_proc')
      .select('proname')
      .limit(10);
    if (f2Err) console.log('pg_proc direct Error:', f2Err.message);
  } else {
    for (const f of funcs || []) {
      console.log(`  ${f.proname}(${f.args})`);
    }
  }

  // 2. Check orders table full schema
  console.log('\n=== Orders Table Full Schema ===');
  const { data: orderCols, error: ocErr } = await supabase.rpc('exec_debug_sql', {
    p_sql: `SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'orders' AND table_schema = 'public' 
      ORDER BY ordinal_position`
  });
  if (ocErr) {
    console.log('Error:', ocErr.message);
    // Fallback: just select one order
    const { data: sample } = await supabase.from('orders').select('*').limit(1);
    if (sample?.[0]) {
      console.log('  Order columns (from data):', Object.keys(sample[0]).join(', '));
    }
  } else {
    for (const c of orderCols || []) {
      console.log(`  ${c.column_name}: ${c.data_type} ${c.is_nullable === 'NO' ? 'NOT NULL' : ''} ${c.column_default || ''}`);
    }
  }

  // 3. Check what payments exist for each order
  console.log('\n=== Payment Coverage Analysis ===');
  const { data: orders } = await supabase
    .from('orders')
    .select('id, status, currency, data')
    .eq('status', 'delivered')
    .order('created_at', { ascending: false });
  
  let cashPaid = 0, cashNoPay = 0, arPaid = 0, arNoPay = 0;
  for (const o of orders || []) {
    const d = o.data || {};
    const method = d.paymentMethod || '';
    const { count } = await supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('reference_table', 'orders')
      .eq('reference_id', o.id);
    if (method === 'ar') {
      if (count > 0) arPaid++; else arNoPay++;
    } else {
      if (count > 0) cashPaid++; else cashNoPay++;
    }
  }
  console.log(`  Cash/Other with payments: ${cashPaid}`);
  console.log(`  Cash/Other WITHOUT payments: ${cashNoPay}`);
  console.log(`  AR (Credit) with payments: ${arPaid}`);
  console.log(`  AR (Credit) WITHOUT payments: ${arNoPay}`);

  // 4. Inventory movements schema check
  console.log('\n=== Inventory Movements Schema ===');
  const { data: imSample } = await supabase.from('inventory_movements').select('*').limit(1);
  if (imSample?.[0]) {
    console.log('  Columns:', Object.keys(imSample[0]).join(', '));
  }

  // 5. Check inventory_movements linked to orders (via source_id or other field)
  console.log('\n=== Inventory Movements for Recent Delivered Orders ===');
  const lastOrder = (orders || [])[0];
  if (lastOrder) {
    const { data: ims, error: imsErr } = await supabase
      .from('inventory_movements')
      .select('*')
      .eq('source_id', lastOrder.id)
      .limit(5);
    if (imsErr) {
      console.log('  Error with source_id:', imsErr.message);
      // Try other approaches
      const { data: ims2 } = await supabase
        .from('inventory_movements')
        .select('*')
        .or(`source_id.eq.${lastOrder.id},reference_id.eq.${lastOrder.id}`)
        .limit(5);
      if (ims2?.length) {
        console.log(`  Found ${ims2.length} movements for order #${lastOrder.id.slice(-6)}`);
      } else {
        console.log(`  No movements found for order #${lastOrder.id.slice(-6)}`);
      }
    } else {
      console.log(`  Found ${(ims||[]).length} movements for order #${lastOrder.id.slice(-6)}`);
      for (const m of ims || []) {
        console.log(`    type:${m.movement_type} qty:${m.quantity} item:${(m.item_id||'').slice(-6)}`);
      }
    }
  }

  // 6. Journal entries linked to orders
  console.log('\n=== Journal Entries for Recent Orders ===');
  if (lastOrder) {
    const { data: jes } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('source_id', lastOrder.id)
      .limit(5);
    if (jes?.length) {
      console.log(`  Found ${jes.length} journal entries for order #${lastOrder.id.slice(-6)}`);
      for (const j of jes) {
        console.log(`    memo:${(j.memo||'').substring(0, 40)} source:${j.source_event} status:${j.status}`);
      }
    } else {
      console.log(`  No journal entries for order #${lastOrder.id.slice(-6)}`);
    }
  }

  // 7. Triggers on orders table
  console.log('\n=== Triggers on Orders Table ===');
  const { data: triggers, error: trigErr } = await supabase.rpc('exec_debug_sql', {
    p_sql: `SELECT trigger_name, event_manipulation, action_timing 
      FROM information_schema.triggers 
      WHERE event_object_table = 'orders' AND event_object_schema = 'public'`
  });
  if (trigErr) {
    console.log('  Could not query triggers:', trigErr.message);
  } else {
    for (const t of triggers || []) {
      console.log(`  ${t.action_timing} ${t.event_manipulation}: ${t.trigger_name}`);
    }
    if (!(triggers||[]).length) console.log('  No triggers found.');
  }

  console.log('\n=== DEEP AUDIT COMPLETE ===');
}
run().catch(e => console.error('Fatal:', e));
