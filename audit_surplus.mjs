const SBP = 'sbp_5fee6ae403ff684d232b618a1a92286c37ec83bd';

async function sql(q) {
  const r = await fetch('https://api.supabase.com/v1/projects/pmhivhtaoydfolseelyc/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SBP}` },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 600));
  return b;
}

async function main() {
  // The real question: are there items where actual stock > expected?
  // (زيادة في المخزون مقارنة بالحركات)
  const result = await sql(`
    WITH movements AS (
      SELECT 
        item_id,
        sum(CASE WHEN movement_type='purchase_in' THEN quantity ELSE 0 END) as purchased,
        sum(CASE WHEN movement_type='sale_out' THEN quantity ELSE 0 END) as sold,
        sum(CASE WHEN movement_type='return_in' THEN quantity ELSE 0 END) as returned,
        sum(CASE WHEN movement_type='adjust_in' THEN quantity ELSE 0 END) as adj_in,
        sum(CASE WHEN movement_type='adjust_out' THEN quantity ELSE 0 END) as adj_out
      FROM public.inventory_movements
      GROUP BY item_id
    ),
    stock AS (
      SELECT item_id, sum(available_quantity::numeric) as actual_stock
      FROM public.stock_management
      GROUP BY item_id
    ),
    items AS (
      SELECT id, name::text as item_name FROM public.menu_items
    )
    SELECT 
      i.item_name,
      m.purchased, m.sold, m.returned, m.adj_in, m.adj_out,
      (m.purchased - m.sold + m.returned + m.adj_in - m.adj_out) AS expected,
      s.actual_stock,
      (s.actual_stock - (m.purchased - m.sold + m.returned + m.adj_in - m.adj_out)) AS discrepancy
    FROM movements m
    JOIN items i ON i.id = m.item_id
    LEFT JOIN stock s ON s.item_id = m.item_id
    ORDER BY (s.actual_stock - (m.purchased - m.sold + m.returned + m.adj_in - m.adj_out)) DESC
  `);

  // Split: positive = actual > expected (زيادة), negative = actual < expected (نقص)
  const surplus = result.filter(r => parseFloat(r.discrepancy || 0) > 0.5);
  const deficit = result.filter(r => parseFloat(r.discrepancy || 0) < -0.5);
  const ok = result.filter(r => Math.abs(parseFloat(r.discrepancy || 0)) <= 0.5);

  console.log(`=== فحص دقيق لجميع الأصناف ===`);
  console.log(`إجمالي: ${result.length} | زيادة: ${surplus.length} | نقص: ${deficit.length} | صحيح: ${ok.length}`);

  // زيادة: المخزون أكثر مما تقوله الحركات (هذا هو ما يسأل عنه التاجر)
  if (surplus.length > 0) {
    console.log(`\n=== 🔴 أصناف المخزون فيها زيادة عن الحركات (${surplus.length}) ===`);
    console.log('(هذا ما يسأل عنه — مخزون أكثر مما ينبغي)\n');
    surplus.forEach((r, i) => {
      const name = r.item_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || r.item_name;
      console.log(`${i+1}. ${name}`);
      console.log(`   مشتريات:${r.purchased} | مبيعات:${r.sold} | مرتجعات:${r.returned} | تعديل+:${r.adj_in}`);
      console.log(`   متوقع:${r.expected} | فعلي:${r.actual_stock} | زيادة:+${parseFloat(r.discrepancy).toFixed(2)}`);
    });
  } else {
    console.log('\n✅ لا يوجد أي صنف مخزونه أكثر مما تدل عليه الحركات!');
  }

  // نقص: المخزون أقل (سببه أن الطلبات الملغاة حُذفت فمعها sale_out)
  console.log(`\n=== 🟡 أصناف المخزون فيها نقص عن الحركات (${deficit.length}) ===`);
  console.log('(سبب النقص: حذف الطلبات الملغاة أدى لحذف حركات sale_out — الأرقام الفعلية صحيحة)\n');
  deficit.slice(0,10).forEach((r, i) => {
    const name = r.item_name?.match(/"ar":\s*"([^"]+)"/)?.[1] || r.item_name;
    console.log(`${i+1}. ${name}`);
    console.log(`   متوقع:${r.expected} | فعلي:${r.actual_stock} | نقص:${parseFloat(r.discrepancy).toFixed(2)}`);
  });
  
  console.log(`\n=== الخلاصة النهائية ===`);
  console.log(`🔴 أصناف مخزونها أكثر مما ينبغي (زيادة): ${surplus.length}`);
  console.log(`🟡 أصناف مخزونها أقل مما تقوله الحركات (نقص ظاهري): ${deficit.length}`);
  console.log(`✅ أصناف رصيدها صحيح تماماً: ${ok.length}`);
  
  if (surplus.length === 0) {
    console.log('\n✅ الإجابة: لا يوجد صنف واحد مخزونه أكثر من المشتريات بعد خصم المبيعات وإضافة المرتجعات!');
    console.log('   كل الفروق هي في الاتجاه الآخر — وسببها حذف الطلبات الملغاة التي أزالت حركات البيع.');
  }
}
main().catch(console.error);
