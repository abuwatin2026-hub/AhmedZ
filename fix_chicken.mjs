const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${SBP}`},
    body:JSON.stringify({query:q}),
  });
  const b = await r.json();
  if(!r.ok) throw new Error(JSON.stringify(b).slice(0,600));
  return b;
}
async function main(){
  const itemId = '31a40daa-afa1-48e5-9de1-17864a33e00c';

  // Full movement trace
  console.log('=== حركات دجاج برازيلي سياره 1400 ===');
  const mvs = await sql(`
    SELECT movement_type, SUM(quantity) as total, COUNT(*) as cnt, warehouse_id
    FROM inventory_movements WHERE item_id='${itemId}'
    GROUP BY movement_type, warehouse_id
    ORDER BY warehouse_id, movement_type
  `);
  mvs.forEach(m=>console.log(`  ${m.warehouse_id?.slice(0,8)} | ${m.movement_type}: ${m.total} (${m.cnt} حركات)`));

  // Net per warehouse
  console.log('\n=== صافي per warehouse ===');
  const nets = await sql(`
    SELECT im.warehouse_id,
      SUM(CASE WHEN im.movement_type IN ('purchase_in','transfer_in','return_in','adjust_in') THEN im.quantity ELSE -im.quantity END) as net
    FROM inventory_movements im WHERE im.item_id='${itemId}' GROUP BY im.warehouse_id
  `);
  let grandNet = 0;
  nets.forEach(n=>{
    grandNet += parseFloat(n.net);
    console.log(`  ${n.warehouse_id?.slice(0,8)}: net=${n.net}${parseFloat(n.net)<0?' ❌ سالب':''}`);
  });
  console.log(`  الإجمالي: ${grandNet}`);

  // Current SM
  console.log('\n=== SM الحالي ===');
  const sm = await sql(`SELECT warehouse_id, available_quantity FROM stock_management WHERE item_id='${itemId}'`);
  let smTotal = 0;
  sm.forEach(s=>{smTotal+=parseFloat(s.available_quantity);console.log(`  ${s.warehouse_id?.slice(0,8)}: ${s.available_quantity}`);});
  console.log(`  SM total: ${smTotal}`);
  console.log(`  Expected: ${grandNet}`);
  console.log(`  Diff: ${smTotal - grandNet}`);

  // The recalculation should set SM = net per warehouse (with GREATEST(0))
  // But one had negative. Let me check which:
  const negativeWHs = nets.filter(n=>parseFloat(n.net)<0);
  const positiveWHs = nets.filter(n=>parseFloat(n.net)>0).sort((a,b)=>parseFloat(b.net)-parseFloat(a.net));
  
  if(negativeWHs.length > 0){
    const deficit = negativeWHs.reduce((s,n)=>s+Math.abs(parseFloat(n.net)),0);
    console.log(`\n=== الإصلاح ===`);
    console.log(`  مستودعات سالبة: ${negativeWHs.map(n=>n.warehouse_id?.slice(0,8)+'='+n.net).join(', ')}`);
    console.log(`  العجز الكلي: ${deficit}`);
    console.log(`  أكبر مستودع موجب: ${positiveWHs[0]?.warehouse_id?.slice(0,8)}=${positiveWHs[0]?.net}`);
    
    // Fix: set each SM to correct net (GREATEST(net,0))
    // Then deduct deficit from biggest
    for(const n of nets){
      const correctVal = Math.max(parseFloat(n.net), 0);
      await sql(`UPDATE stock_management SET available_quantity=${correctVal}, updated_at=now() WHERE item_id='${itemId}' AND warehouse_id='${n.warehouse_id}'`);
      console.log(`  → ${n.warehouse_id?.slice(0,8)}: set to ${correctVal}`);
    }
    
    // Now deduct deficit from biggest positive
    if(positiveWHs[0]){
      const newVal = Math.max(parseFloat(positiveWHs[0].net) - deficit, 0);
      await sql(`UPDATE stock_management SET available_quantity=${newVal}, updated_at=now() WHERE item_id='${itemId}' AND warehouse_id='${positiveWHs[0].warehouse_id}'`);
      console.log(`  → ${positiveWHs[0].warehouse_id?.slice(0,8)}: adjusted to ${newVal} (deficit ${deficit} deducted)`);
    }
  } else {
    // No negatives — just set each to its net
    for(const n of nets){
      const correctVal = parseFloat(n.net);
      await sql(`UPDATE stock_management SET available_quantity=${correctVal}, updated_at=now() WHERE item_id='${itemId}' AND warehouse_id='${n.warehouse_id}'`);
    }
  }

  // Verify
  console.log('\n=== بعد الإصلاح ===');
  const sm2 = await sql(`SELECT warehouse_id, available_quantity FROM stock_management WHERE item_id='${itemId}'`);
  let t2 = 0;
  sm2.forEach(s=>{t2+=parseFloat(s.available_quantity);console.log(`  ${s.warehouse_id?.slice(0,8)}: ${s.available_quantity}`);});
  console.log(`  المجموع: ${t2} (المتوقع: ${grandNet}) ${Math.abs(t2-grandNet)<1?'✅':'❌'}`);
}
main().catch(console.error);
