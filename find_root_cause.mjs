const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';
async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query',{
    method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${SBP}`},
    body:JSON.stringify({query:q}),
  });
  const b=await r.json();
  if(!r.ok) throw new Error(JSON.stringify(b).slice(0,600));
  return b;
}
async function main(){
  const itemId='499fb7ad-2155-499f-b5c7-c1df4a41d65c';
  const whMash = '7628598d'; // المشتريات (first 8 chars)
  const whSharka = '69c3aa8a'; // مخزن الشركة (first 8 chars)

  // الفكرة: تتبع حالة stock_management بعد كل تحويل
  // من خلال التحقق من status كل تحويل ومتى اكتمل

  // 1. ترتيب التحويلات
  const transfers = [
    {ref:'acfa0c14', qty:354, from:'7628598d', to:'69c3aa8a'},
    {ref:'004ae823', qty:476, from:'7628598d', to:'69c3aa8a'},
    {ref:'ae246367', qty:100, from:'7628598d', to:'1637d5cc'},
    {ref:'1598227d', qty:4,   from:'7628598d', to:'f461cf1c'},
    {ref:'7283583b', qty:354, from:'7628598d', to:'69c3aa8a'},
  ];

  // 2. Get full transfer IDs
  console.log('=== تحديد IDs كاملة للتحويلات ===');
  for(const t of transfers){
    const res = await sql(`SELECT id, status, created_at, completed_at FROM warehouse_transfers WHERE id::text LIKE '${t.ref}%'`);
    if(res.length){
      t.fullId = res[0].id;
      t.status = res[0].status;
      t.completedAt = res[0].completed_at;
      console.log(`  ${t.ref}: ${t.qty} | ${res[0].status} | اكتمل: ${res[0].completed_at?.slice(0,16)||'-'}`);
    }
  }

  // 3. هل SM صحيح بعد كل تحويل؟ نحسب يدوياً
  console.log('\n=== تتبع stock_management المتوقع خطوة بخطوة ===');
  const smSim = {'7628598d':500, '69c3aa8a':0, '1637d5cc':0, 'f461cf1c':0};
  console.log(`  البداية: المشتريات=${smSim['7628598d']} مخزن الشركة=${smSim['69c3aa8a']}`);
  
  for(const t of transfers){
    const fromPrev = smSim[t.from] || 0;
    const canTransfer = fromPrev >= t.qty;
    smSim[t.from] = (smSim[t.from]||0) - t.qty;
    smSim[t.to] = (smSim[t.to]||0) + t.qty;
    console.log(`  ${t.ref}: ${t.from.slice(0,8)}(${fromPrev})→(-${t.qty})=${smSim[t.from]} | ${t.to.slice(0,8)}(${smSim[t.to]-t.qty})→(+${t.qty})=${smSim[t.to]} | كافي:${canTransfer?'✅':'❌ !!!'}`);
  }
  console.log(`  النهاية (متوقع): المشتريات=${smSim['7628598d']} مخزن الشركة=${smSim['69c3aa8a']} رئيسي=${smSim['1637d5cc']} مكتب=${smSim['f461cf1c']}`);
  
  // 4. مقارنة مع الفعلي
  console.log('\n=== SM الفعلي vs المتوقع ===');
  const sm = await sql(`SELECT warehouse_id, available_quantity FROM stock_management WHERE item_id='${itemId}'`);
  sm.forEach(s=>{
    const wh8 = s.warehouse_id.slice(0,8);
    const exp = smSim[wh8];
    const act = parseFloat(s.available_quantity);
    const diff = act - exp;
    console.log(`  ${wh8}: متوقع=${exp} | فعلي=${act} | فرق=${diff>0?'+':''}${diff} ${Math.abs(diff)<0.5?'✅':'❌'}`);
  });

  // 5. هل التحويل 004ae823 نُفِّذ رغم نقص الكمية؟
  console.log('\n=== فحص التحويل 004ae823 (476 من مستودع يملك 146 فقط!) ===');
  const t2 = transfers.find(t=>t.ref==='004ae823');
  if(t2?.fullId){
    // ما هي الحركات التي نشأت منه؟
    const mvs2 = await sql(`SELECT movement_type, quantity, warehouse_id FROM inventory_movements WHERE reference_id='${t2.fullId}'`);
    mvs2.forEach(m=>console.log(`  ${m.movement_type}: qty=${m.quantity} wh=${m.warehouse_id?.slice(0,8)}`));
    // هل تم الخصم فعلاً من المشتريات؟
    const outMv = mvs2.filter(m=>m.movement_type==='transfer_out');
    const inMv = mvs2.filter(m=>m.movement_type==='transfer_in');
    console.log(`  خرج: ${outMv.map(m=>m.quantity).join('+')||0} | دخل: ${inMv.map(m=>m.quantity).join('+')||0}`);
    
    // كيف نجح رغم أن المخزون أقل؟
    console.log('  → السبب: يبدو أن دالة complete_warehouse_transfer');
    console.log('    قرأت v_sm_from من مستودع غير المشتريات (fallback) ورأت رصيداً كافياً');
    console.log('    بينما خصمت من المشتريات التي تصبح سالبة!');
  }

  // 6. فحص: هل stock_management لمخزن الشركة تراجع؟
  console.log('\n=== هل SM لمخزن الشركة يتطابق مع آخر transfer_in فقط؟ ===');
  const lastTransferIn = 354; // آخر تحويل دخل مخزن الشركة (7283583b)
  const smSharka = sm.find(s=>s.warehouse_id.slice(0,8)==='69c3aa8a');
  const actual = parseFloat(smSharka?.available_quantity||0);
  console.log(`  آخر transfer_in لمخزن الشركة: 354 | SM الفعلي: ${actual}`);
  console.log(`  تطابق: ${actual===lastTransferIn?'✅ نعم — يعني SM يُكتب بدل أن يُجمع':'❌'}`);
  
  console.log('\n=== الخلاصة ===');
  console.log('السبب المرجح: في دالة complete_warehouse_transfer');
  console.log('عند تحديث مخزن الوجهة (الإضافة):');
  console.log('  INSERT ... ON CONFLICT DO UPDATE SET available_quantity = SM.available_quantity + excluded.available_quantity');
  console.log('هذا يجمع ← صحيح من الناحية النظرية');
  console.log('');
  console.log('لكن: هل يوجد trigger على SM يتدخل ويعيد الكتابة؟');
  
  const smTriggers = await sql(`
    SELECT trigger_name, event_manipulation, action_statement
    FROM information_schema.triggers
    WHERE event_object_table = 'stock_management'
    ORDER BY trigger_name
  `);
  if(smTriggers.length){
    console.log('\nTrigers على stock_management:');
    smTriggers.forEach(t=>console.log(`  ${t.action_timing||''} ${t.event_manipulation}: ${t.trigger_name}`));
  } else {
    console.log('  لا توجد triggers على stock_management');
  }
}
main().catch(console.error);
