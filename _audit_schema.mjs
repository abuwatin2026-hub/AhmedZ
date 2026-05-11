import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  'https://pmhivhtaoydfolseelyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec'
);

async function run() {
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: 'owner@azta.com', password: 'AhmedZ#123456'
  });
  if (authErr) { console.error('Auth Error:', authErr.message); return; }

  // List all functions
  console.log('=== All Public Functions (via pg_proc) ===');
  const { data, error } = await supabase.rpc('exec_debug_sql', {
    p_sql: `SELECT p.proname, pg_catalog.pg_get_function_arguments(p.oid) as args
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      AND p.proname LIKE '%order%'
      OR p.proname LIKE '%stock%'
      OR p.proname LIKE '%fefo%'
      OR p.proname LIKE '%payment%'
      OR p.proname LIKE '%invoice%'
      OR p.proname LIKE '%warehouse%'
      OR p.proname LIKE '%fx%'
      OR p.proname LIKE '%uom%'
      ORDER BY p.proname`
  });
  if (error) {
    console.log('exec_debug_sql not available, trying direct approach...');
    // Try REST API approach to check schema
    const resp = await fetch('https://pmhivhtaoydfolseelyc.supabase.co/rest/v1/rpc/exec_debug_sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec',
        'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
      },
      body: JSON.stringify({ p_sql: "SELECT proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY p.proname" })
    });
    const text = await resp.text();
    console.log('Direct REST response:', text.substring(0, 2000));
  } else {
    (data || []).forEach(r => console.log(`  ${r.proname}(${r.args})`));
  }

  // Check table schemas
  console.log('\n=== Payments Table Columns ===');
  const { data: paySchema } = await supabase
    .from('payments')
    .select('*')
    .limit(1);
  if (paySchema?.[0]) {
    console.log('  Columns:', Object.keys(paySchema[0]).join(', '));
  }

  // Check what tables exist
  console.log('\n=== Check Key Tables ===');
  const tables = ['orders', 'payments', 'inventory_movements', 'stock_movements', 'journal_entries', 'gl_entries', 'financial_parties', 'warehouses', 'menu_items', 'customers'];
  for (const t of tables) {
    try {
      const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
      if (error) {
        console.log(`  ${t}: ERROR - ${error.message.substring(0, 60)}`);
      } else {
        console.log(`  ${t}: EXISTS ✅ (${count} rows)`);
      }
    } catch (e) {
      console.log(`  ${t}: EXCEPTION - ${e.message}`);
    }
  }

  // Check inventory movements instead of stock_movements
  console.log('\n=== Inventory Movements for Orders (last 10) ===');
  const { data: im, error: imErr } = await supabase
    .from('inventory_movements')
    .select('*')
    .not('order_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);
  if (imErr) {
    console.log('inventory_movements Error:', imErr.message);
  } else {
    for (const m of im || []) {
      console.log(`  type:${m.movement_type} qty:${m.quantity} item:${(m.item_id||'').slice(-6)} order:${(m.order_id||'').slice(-6)} wh:${(m.warehouse_id||'').slice(-6)}`);
    }
  }

  // Check GL entries
  console.log('\n=== GL Entries for Orders (last 10) ===');
  const { data: gl, error: glErr } = await supabase
    .from('gl_entries')
    .select('*')
    .eq('reference_table', 'orders')
    .order('created_at', { ascending: false })
    .limit(10);
  if (glErr) {
    console.log('gl_entries Error:', glErr.message);
    // Try journal_entries without reference_table
    const { data: je2, error: je2Err } = await supabase
      .from('journal_entries')
      .select('*')
      .limit(1);
    if (je2Err) console.log('journal_entries Error:', je2Err.message);
    else if (je2?.[0]) console.log('  journal_entries columns:', Object.keys(je2[0]).join(', '));
  } else {
    for (const g of gl || []) {
      console.log(`  type:${g.entry_type} amount:${g.amount} order:${(g.reference_id||'').slice(-6)}`);
    }
  }

  console.log('\n=== SCHEMA AUDIT COMPLETE ===');
}
run().catch(e => console.error('Fatal:', e));
