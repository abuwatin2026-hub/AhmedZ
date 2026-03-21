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
  const fn = await sql(`SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname='recompute_order_return_status' AND pronamespace='public'::regnamespace LIMIT 1`);
  const body = fn[0]?.def || '';
  console.log(body);
  
  // Also check: what does o.data->>'items' look like for orders?
  const orderCheck = await sql(`
    SELECT id, jsonb_typeof(data->'items') as items_type,
           jsonb_typeof(data) as data_type,
           data->'items' IS NULL as items_null
    FROM public.orders
    WHERE id IN (SELECT order_id FROM public.sales_returns WHERE status='draft')
    LIMIT 3
  `);
  console.log('\nOrder data structure:');
  orderCheck.forEach(o => console.log(`  ${o.id}: data type=${o.data_type} | items type=${o.items_type} | items null=${o.items_null}`));
}
main().catch(console.error);
