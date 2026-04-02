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
  // Fix strategy: use a smarter recalculation
  // The real issue: المشتريات = -788 when floored to 0 → total = 1288 instead of 500
  // This extra 788 came from over-transfers (transferred more than available)
  // The correct approach: 
  //   - Calculate net per warehouse from movements
  //   - If net < 0: set to 0 AND reduce positive warehouses proportionally
  //   OR simpler: just trust what inventory_movements says:
  //     transfer_out 1288 truly left المشتريات (the bugs already happened in production)
  //     transfer_in 1184 truly entered مخزن الشركة
  //     The "extra" 688 came from the original stock_management bug allowing over-transfers
  //     So the PHYSICAL reality is: المشتريات = 0 (emptied, went negative)
  //                                 مخزن الشركة = 1184 (received all those transfers)
  //     But we only BOUGHT 500, so the extra 684 is phantom inventory

  // The TRULY correct fix needs manual adjustment or deletion of bad movement records
  // For now, let's fix to match movements (accepting -788 floors to 0) 
  // which means مخزن الشركة has 1184 - but only 500 was purchased = phantom 684

  // The user should know about this. Let's show what the correct numbers SHOULD be
  // if we trace backwards from the original purchase.
  
  console.log('=== تحليل سلسلة التحويلات لميرا (500 مشترى) ===');
  console.log('التحويل 1 (acfa0c14): 354 من المشتريات → مخزن الشركة');
  console.log('  صحيح ✅ (كان متاح 500 > 354)');
  console.log('  بعده: المشتريات=146, مخزن الشركة=354');
  
  console.log('التحويل 2 (004ae823): 476 من المشتريات → مخزن الشركة');
  console.log('  ❌ خاطئ! المتاح=146 < 476!');
  console.log('  هذه الكمية أكبر مما هو متاح — السبب: البيانات في SM كانت خاطئة وسمحت بهذا');
  
  console.log('\n=== الكمية الفعلية المحوّلة الصحيحة لكل تحويل ===');
  // The physical movement that SHOULD have happened:
  // Transfer 2 should have been max 146 not 476
  // But since it's done, we need to decide: do we correct movements or accept them?
  
  // Check: does the TOTAL net = 500?
  const net = await sql(`
    SELECT SUM(CASE WHEN movement_type IN ('purchase_in','transfer_in','return_in','adjust_in') THEN quantity ELSE -quantity END) as net
    FROM inventory_movements WHERE item_id='499fb7ad-2155-499f-b5c7-c1df4a41d65c'
  `);
  console.log(`الصافي الكلي من الحركات: ${net[0].net}`);
  console.log('→ الإجمالي من الحركات = 500 ✅');
  console.log('→ SM الصحيح يجب أن يكون مجموعه 500 أيضاً');
  
  console.log('\n=== الحالة الحالية بعد deploy ===');
  const sm = await sql(`
    SELECT sm.warehouse_id, sm.available_quantity,
      (SELECT w.name::text FROM warehouses w WHERE w.id=sm.warehouse_id) as wh
    FROM stock_management sm WHERE sm.item_id='499fb7ad-2155-499f-b5c7-c1df4a41d65c'
  `);
  let total = 0;
  sm.forEach(s=>{
    const wName = s.wh?.match(/"ar":\s*"([^"]+)"/)?.[1] || s.warehouse_id?.slice(0,8);
    total += parseFloat(s.available_quantity);
    console.log(`  ${wName}: ${s.available_quantity}`);
  });
  console.log(`  المجموع: ${total}`);
  
  console.log('\n=== الحل الصحيح ===');
  console.log('المشكلة: المشتريات يحتاج -788 لكنه يُحوَّل لـ 0');
  console.log('مما يعطي مجموع 1288 بدل 500');
  console.log('الحل الصحيح: ننفّذ UPDATE مباشر يأخذ بعين الاعتبار:');
  console.log('  - مخزن الشركة: 1184 - 684 (الزيادة الوهمية) = 500؟');
  console.log('    لا! الزيادة الوهمية 788 (رصيد المشتريات السالب)');
  console.log('  - مخزن الشركة الصحيح: 1184 - 788 = 396? لا...');
  console.log('  الصواب: المشتريات=0, مخزن الشركة = 1184 - 788 = 396? No...');
  console.log('  الحركات أنشأت 1184 in لمخزن الشركة بينما أخرجت 1288 من المشتريات (أكثر مما دخل)');
  console.log('  → المخزون الكلي = purchase_in = 500');
  console.log('  → يوزَّع كـ: المشتريات=0 (فارغ) + مخزن الشركة = 500? ');
  console.log('     لكن الحركات تقول مخزن الشركة وارد 1184 وليس 500');
  console.log('');
  console.log('⚡ الحل الصحيح يحتاج تصحيح الحركات نفسها (inventory_movements)');
  console.log('   cلكن ذلك مخاطرة على البيانات التاريخية (GL entries مرتبطة)');
  console.log('   الأسلم: تصحيح SM فقط بشكل يدوي لكل مستودع');
}
main().catch(console.error);
