const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${SBP}`},
    body:JSON.stringify({query:q}),
  });
  const b=await r.json();
  if(!r.ok) throw new Error(JSON.stringify(b).slice(0,600));
  return b;
}
async function main(){
  // Compare SM total per item vs expected (purchase-sales net) for ALL items
  const report = await sql(`
    WITH movements_net AS (
      SELECT
        im.item_id::text as item_id,
        SUM(CASE
          WHEN im.movement_type IN ('purchase_in','transfer_in','return_in','adjust_in') THEN im.quantity
          ELSE -im.quantity
        END) as net_total,
        SUM(CASE WHEN im.movement_type = 'purchase_in' THEN im.quantity ELSE 0 END) as purchased,
        SUM(CASE WHEN im.movement_type = 'sale_out' THEN im.quantity ELSE 0 END) as sold,
        SUM(CASE WHEN im.movement_type = 'return_in' THEN im.quantity ELSE 0 END) as returned
      FROM public.inventory_movements im
      WHERE im.item_id IS NOT NULL
      GROUP BY im.item_id
    ),
    sm_totals AS (
      SELECT item_id::text as item_id, SUM(available_quantity) as sm_total
      FROM public.stock_management
      GROUP BY item_id
    )
    SELECT
      mn.item_id,
      mn.purchased,
      mn.sold,
      mn.returned,
      mn.net_total as expected,
      st.sm_total as actual,
      ABS(mn.net_total - COALESCE(st.sm_total, 0)) as diff,
      (SELECT mi.name::text FROM menu_items mi WHERE mi.id::text = mn.item_id) as item_name
    FROM movements_net mn
    LEFT JOIN sm_totals st ON st.item_id = mn.item_id
    ORDER BY diff DESC
  `);

  let totalOk = 0, totalWrong = 0;
  console.log('=== تقرير كامل لجميع الأصناف ===');
  console.log(`${'الصنف'.padEnd(35)} | مشترى | مباع | مرتجع | متوقع | فعلي | فرق`);
  console.log('-'.repeat(100));
  
  report.forEach(r => {
    const name = r.item_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || r.item_id?.slice(0,8);
    const diff = parseFloat(r.diff);
    const ok = diff < 0.5;
    if (ok) totalOk++; else totalWrong++;
    const status = ok ? '✅' : '❌';
    const displayName = name.slice(0,33).padEnd(35);
    const exp = parseFloat(r.expected).toFixed(0);
    const act = parseFloat(r.actual||0).toFixed(0);
    const d = diff.toFixed(1);
    console.log(`${status} ${displayName} | ${r.purchased} | ${r.sold} | ${r.returned} | ${exp} | ${act} | ${d}`);
  });

  console.log('-'.repeat(100));
  console.log(`\n✅ صحيح: ${totalOk} صنف`);
  console.log(`❌ به فرق: ${totalWrong} صنف`);
  
  if (totalWrong > 0) {
    console.log('\n=== الأصناف التي بها فرق (تفصيل) ===');
    report.filter(r=>parseFloat(r.diff)>=0.5).forEach(r=>{
      const name = r.item_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || r.item_id?.slice(0,8);
      console.log(`  ${name}: متوقع=${r.expected} فعلي=${r.actual||0} فرق=${r.diff}`);
    });
  }
}
main().catch(console.error);
