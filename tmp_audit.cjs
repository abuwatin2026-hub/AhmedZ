const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://pmhivhtaoydfolseelyc.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtaGl2aHRhb3lkZm9sc2VlbHljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMjkyNzYsImV4cCI6MjA4NTgwNTI3Nn0.S4y-P0oA26xBCkzyYKWRreetcDd1Qo6Pbd80b7hltec';
const supabase = createClient(SUPABASE_URL, ANON_KEY);

(async () => {
  await supabase.auth.signInWithPassword({ email: 'owner@azta.com', password: 'AhmedZ#123456' });

  // Check what fields the expanded_items uses for the report
  // The SQL uses: ei.item->>'price' as price, ei.item->>'quantity' as quantity
  // Let's examine the raw JSON for order 4ba327a6 (جوي سفن, scale=1.61)

  const { data: orders } = await supabase.from('orders').select('*');
  const o = (orders || []).find(o => o.id.startsWith('4ba327a6'));
  if (!o) { console.log('Not found'); return; }

  const d = o.data || {};
  const snap = d.invoiceSnapshot || {};
  
  console.log('=== Order 4ba327a6 Raw ===');
  console.log('data keys:', Object.keys(d).join(', '));
  console.log('snap keys:', Object.keys(snap).join(', '));
  console.log('subtotal (data):', d.subtotal);
  console.log('subtotal (snap):', snap.subtotal);
  console.log('discount (data):', d.discount, d.discountAmount, d.discountTotal);
  console.log('currency:', d.currency, o.currency);
  console.log('fx_rate:', o.fx_rate);

  const items = snap.items || d.items || [];
  console.log('\nItems:');
  for (const oi of items) {
    const name = (oi.name?.ar || oi.name || '').substring(0, 30);
    console.log(`  ${name}: qty=${oi.quantity}, price=${oi.price}, line_total=${oi.line_total}`);
  }

  // The report SQL reads:
  // discount: nullif(o.data->>'discountAmount','')::numeric or discountTotal or discount
  // subtotal: nullif(o.data->>'subtotal','')::numeric
  // price from item: ei.item->>'price'
  // quantity from item: ei.item->>'quantity'
  // The items are from: jsonb_array_elements(jsonb_path_query_array(o.data, '$.items[*]') ||
  //                                          jsonb_path_query_array(o.data, '$.invoiceSnapshot.items[*]'))

  console.log('\nReport SQL would read:');
  console.log('  discount = data.discountAmount =', d.discountAmount);
  console.log('  discount = data.discountTotal =', d.discountTotal);
  console.log('  discount = data.discount =', d.discount);
  console.log('  subtotal = data.subtotal =', d.subtotal);

  await supabase.auth.signOut();
})();
