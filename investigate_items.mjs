const SBP = 'sbp_7034822f291b12df0a1c95b1130f3a6fe5818dfd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 500));
  return b;
}

// Check what items look like in real returns
async function investigateItems() {
  const samples = await sql(`
    SELECT id, status, refund_method,
           jsonb_typeof(items) as items_type,
           items
    FROM public.sales_returns
    WHERE status = 'completed'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log('Sample completed return items:');
  for (const s of samples) {
    const items = s.items;
    const parsed = typeof items === 'string' ? JSON.parse(items) : items;
    console.log(`\n  return ${s.id} | type: ${s.items_type} | method: ${s.refund_method}`);
    console.log(`  sample item keys:`, Array.isArray(parsed) ? Object.keys(parsed[0] || {}).join(', ') : Object.keys(parsed || {}).join(', '));
    if (Array.isArray(parsed) && parsed[0]) {
      console.log('  first item:', JSON.stringify(parsed[0]).slice(0, 200));
    }
  }
  
  // Check what the failing order's items look like
  const failing = await sql(`
    SELECT sr.id, sr.status, sr.refund_method,
           jsonb_typeof(sr.items) as items_type,
           sr.items,
           o.data->'items'->0 as first_order_item
    FROM public.sales_returns sr
    JOIN public.orders o ON o.id = sr.order_id
    WHERE sr.status = 'draft'
    LIMIT 3
  `);
  console.log('\n\nDraft returns (the ones causing errors):');
  for (const s of failing) {
    const items = s.items;
    const parsed = typeof items === 'string' ? JSON.parse(items) : items;
    console.log(`\n  return ${s.id} | type: ${s.items_type} | method: ${s.refund_method}`);
    console.log(`  items content:`, JSON.stringify(parsed).slice(0, 300));
    console.log(`  first order item keys:`, s.first_order_item ? Object.keys(s.first_order_item).join(', ') : 'N/A');
  }
}

investigateItems().catch(console.error);
